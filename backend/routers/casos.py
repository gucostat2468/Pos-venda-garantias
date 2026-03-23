import os
import shutil
import uuid
import unicodedata
import base64
import binascii
from datetime import datetime, date
from typing import List, Optional
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from database import get_db
import models, schemas
from auth import get_current_user, get_current_user_download, require_roles
from utils.pdf_compiler import compile_pdf

router = APIRouter()

# Diretório base para uploads
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
COMPILED_DIR = os.path.join(BASE_DIR, "compiled")
SIGNATURES_SUBDIR = "assinaturas"

DOCS_OBRIGATORIOS = {
    "categoria_remessa",
}

DOCS_OPCIONAIS = {
    "categoria_nf_remessa",
    "categoria_relatorio_tecnico",
}

STATUS_AGUARDANDO_IMPRESSAO = "Aguardando Impressão Oficina"
STATUS_BLOQUEIA_EDICAO = {STATUS_AGUARDANDO_IMPRESSAO, "Finalizado", "Reprovado"}

STATUS_FLOW = {
    "Aguardando Documentos": 0,
    "Aguardando Aprovação Pós-Venda": 1,
    "Aguardando Aprovação Diretoria": 2,
    STATUS_AGUARDANDO_IMPRESSAO: 3,
    "Finalizado": 4,
    "Reprovado": 5,
    "Aguardando Vídeo Descarte": 3,  # legado
}


def _normalizar_texto(valor: Optional[str]) -> str:
    texto = unicodedata.normalize("NFD", valor or "")
    return "".join(ch for ch in texto if unicodedata.category(ch) != "Mn").strip().lower()


def _categorizar_tipo_documento(tipo_documento: Optional[str]) -> str:
    tipo = _normalizar_texto(tipo_documento)
    if not tipo:
        return "categoria_outros"
    if ("nota fiscal" in tipo and "remessa" in tipo) or "nf remessa" in tipo:
        return "categoria_nf_remessa"
    if "relatorio tecnico" in tipo:
        return "categoria_relatorio_tecnico"
    if "remessa" in tipo:
        return "categoria_remessa"
    return "categoria_outros"


def _check_docs_completos(caso: models.CasoGarantia) -> bool:
    """Verifica se todos os documentos obrigatórios foram enviados."""
    categorias_enviadas = {_categorizar_tipo_documento(doc.tipo_documento) for doc in (caso.documentos or [])}
    return DOCS_OBRIGATORIOS.issubset(categorias_enviadas)


def _documentos_assinaveis(caso: models.CasoGarantia) -> List[models.Documento]:
    return [
        doc for doc in (caso.documentos or [])
        if _normalizar_texto(doc.tipo_documento) != _normalizar_texto("Vídeo de Descarte")
    ]


def _resolver_etapa_assinatura(caso: models.CasoGarantia, current_user: models.Usuario) -> str:
    if current_user.papel == "gerente_pos_venda":
        if caso.status != "Aguardando Aprovação Pós-Venda":
            raise HTTPException(
                status_code=400,
                detail=f"Caso não está aguardando aprovação do Pós-venda. Status atual: {caso.status}"
            )
        return "Pos-venda"
    if current_user.papel == "diretor_comercial":
        if caso.status != "Aguardando Aprovação Diretoria":
            raise HTTPException(
                status_code=400,
                detail=f"Caso não está aguardando aprovação do diretor comercial. Status atual: {caso.status}"
            )
        return "Diretoria"
    if current_user.papel == "admin":
        if caso.status == "Aguardando Aprovação Pós-Venda":
            return "Pos-venda"
        if caso.status == "Aguardando Aprovação Diretoria":
            return "Diretoria"
        raise HTTPException(status_code=400, detail=f"Caso não está aguardando aprovação. Status: {caso.status}")
    raise HTTPException(status_code=403, detail="Você não tem permissão para assinar este caso")


def _validar_assinaturas_documentos(caso: models.CasoGarantia, etapa: str, usuario_id: int) -> None:
    docs = _documentos_assinaveis(caso)
    if not docs:
        raise HTTPException(status_code=400, detail="Não há documentos para assinatura neste caso.")

    assinados_ids = {
        assinatura.documento_id
        for assinatura in (caso.documento_assinaturas or [])
        if assinatura.etapa_fluxo == etapa and assinatura.usuario_id == usuario_id
    }
    pendentes = [doc.nome_arquivo for doc in docs if doc.id not in assinados_ids]
    if pendentes:
        raise HTTPException(
            status_code=400,
            detail=f"Assine todos os documentos antes de concluir a etapa. Pendentes: {', '.join(pendentes)}"
        )


def _load_caso(caso_id: int, db: Session) -> models.CasoGarantia:
    caso = (
        db.query(models.CasoGarantia)
        .options(
            joinedload(models.CasoGarantia.cliente),
            joinedload(models.CasoGarantia.documentos),
            joinedload(models.CasoGarantia.documento_assinaturas).joinedload(models.DocumentoAssinatura.usuario),
            joinedload(models.CasoGarantia.assinaturas).joinedload(models.Assinatura.usuario)
        )
        .filter(models.CasoGarantia.id == caso_id)
        .first()
    )
    if not caso:
        raise HTTPException(status_code=404, detail="Caso não encontrado")
    return caso


# ─── CRUD Básico ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[schemas.CasoListOut], include_in_schema=False)
@router.get("/", response_model=List[schemas.CasoListOut])
def listar_casos(
    status: Optional[str] = Query(None),
    tipo_processo: Optional[str] = Query(None),
    cliente_id: Optional[int] = Query(None),
    busca: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    q = (
        db.query(models.CasoGarantia)
        .options(joinedload(models.CasoGarantia.cliente))
        .order_by(models.CasoGarantia.criado_em.desc())
    )
    if status:
        q = q.filter(models.CasoGarantia.status == status)
    if tipo_processo:
        q = q.filter(models.CasoGarantia.tipo_processo == tipo_processo)
    if cliente_id:
        q = q.filter(models.CasoGarantia.cliente_id == cliente_id)
    if busca:
        q = q.filter(
            models.CasoGarantia.dji_case_id.ilike(f"%{busca}%") |
            models.CasoGarantia.produto_nome.ilike(f"%{busca}%") |
            models.CasoGarantia.produto_sn.ilike(f"%{busca}%")
        )
    return q.all()


@router.get("/stats", response_model=schemas.DashboardStats)
def dashboard_stats(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    total = db.query(models.CasoGarantia).count()
    aguardando_docs = db.query(models.CasoGarantia).filter(
        models.CasoGarantia.status == "Aguardando Documentos"
    ).count()
    aguardando_aprov = db.query(models.CasoGarantia).filter(
        models.CasoGarantia.status.in_([
            "Aguardando Aprovação Pós-Venda",
            "Aguardando Aprovação Diretoria",
        ])
    ).count()
    finalizados = db.query(models.CasoGarantia).filter(
        models.CasoGarantia.status.in_([
            STATUS_AGUARDANDO_IMPRESSAO,
            "Finalizado",
        ])
    ).count()
    reprovados = db.query(models.CasoGarantia).filter(
        models.CasoGarantia.status == "Reprovado"
    ).count()
    rebate_aguardando = db.query(models.CasoGarantia).filter(
        models.CasoGarantia.status_rebate == "Aguardando Apuração"
    ).count()

    return {
        "total_casos": total,
        "aguardando_documentos": aguardando_docs,
        "aguardando_aprovacao": aguardando_aprov,
        "finalizados": finalizados,
        "reprovados": reprovados,
        "rebate_aguardando_apuracao": rebate_aguardando
    }


@router.post("", response_model=schemas.CasoOut, include_in_schema=False)
@router.post("/", response_model=schemas.CasoOut)
def criar_caso(
    body: schemas.CasoCreate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    cliente = db.query(models.Cliente).filter(models.Cliente.id == body.cliente_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    if body.tipo_processo not in ["Peca", "Bateria"]:
        raise HTTPException(status_code=400, detail="Tipo de processo inválido. Use: Peca | Bateria")

    caso = models.CasoGarantia(**body.model_dump())
    db.add(caso)
    db.commit()
    db.refresh(caso)
    return _load_caso(caso.id, db)


@router.get("/{caso_id}", response_model=schemas.CasoOut)
def obter_caso(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    return _load_caso(caso_id, db)


@router.get("/{caso_id}/credito-vinculos", response_model=List[schemas.CreditoCasoVinculoOut])
def listar_credito_vinculos_do_caso(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    _load_caso(caso_id, db)
    return (
        db.query(models.CreditoCasoVinculo)
        .options(
            joinedload(models.CreditoCasoVinculo.extrato),
            joinedload(models.CreditoCasoVinculo.lancamento),
        )
        .filter(models.CreditoCasoVinculo.caso_id == caso_id)
        .order_by(
            models.CreditoCasoVinculo.extrato_id.desc(),
            models.CreditoCasoVinculo.lancamento_id.asc(),
        )
        .all()
    )


@router.get("/{caso_id}/credito-resumo")
def resumo_credito_do_caso(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    _load_caso(caso_id, db)
    total_alocado = (
        db.query(func.coalesce(func.sum(models.CreditoCasoVinculo.valor_alocado), 0.0))
        .filter(models.CreditoCasoVinculo.caso_id == caso_id)
        .scalar()
    )
    qtd_vinculos = (
        db.query(models.CreditoCasoVinculo.id)
        .filter(models.CreditoCasoVinculo.caso_id == caso_id)
        .count()
    )
    qtd_lancamentos = (
        db.query(models.CreditoCasoVinculo.lancamento_id)
        .filter(models.CreditoCasoVinculo.caso_id == caso_id)
        .distinct()
        .count()
    )
    return {
        "caso_id": caso_id,
        "qtd_vinculos": qtd_vinculos,
        "qtd_lancamentos": qtd_lancamentos,
        "total_alocado": float(total_alocado or 0.0),
    }


@router.put("/{caso_id}", response_model=schemas.CasoOut)
def atualizar_caso(
    caso_id: int,
    body: schemas.CasoUpdate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    caso = _load_caso(caso_id, db)
    if caso.status in STATUS_BLOQUEIA_EDICAO:
        raise HTTPException(status_code=400, detail="Caso em etapa final não pode ser editado")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(caso, field, value)
    caso.atualizado_em = datetime.utcnow()
    db.commit()
    return _load_caso(caso_id, db)


@router.delete("/{caso_id}")
def deletar_caso(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    caso = db.query(models.CasoGarantia).filter(models.CasoGarantia.id == caso_id).first()
    if not caso:
        raise HTTPException(status_code=404, detail="Caso não encontrado")
    # Remover arquivos físicos
    case_dir = os.path.join(UPLOADS_DIR, str(caso_id))
    if os.path.exists(case_dir):
        shutil.rmtree(case_dir)
    db.delete(caso)
    db.commit()
    return {"message": "Caso excluído com sucesso"}


# ─── Documentos ───────────────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".webp", ".mp4", ".mov", ".avi"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/{caso_id}/documentos", response_model=schemas.DocumentoOut)
async def upload_documento(
    caso_id: int,
    tipo_documento: str = Form(...),
    arquivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    caso = _load_caso(caso_id, db)
    if caso.status in STATUS_BLOQUEIA_EDICAO:
        raise HTTPException(status_code=400, detail="Caso em etapa final. Não é possível adicionar documentos.")

    ext = Path(arquivo.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Extensão não permitida: {ext}")

    # Criar diretório do caso
    case_dir = os.path.join(UPLOADS_DIR, str(caso_id))
    os.makedirs(case_dir, exist_ok=True)

    # Nome único para o arquivo
    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(case_dir, unique_name)

    content = await arquivo.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Arquivo muito grande. Máximo: 50MB")

    with open(file_path, "wb") as f:
        f.write(content)

    # Verificar se já existe documento do mesmo tipo e substituir
    existing = db.query(models.Documento).filter(
        models.Documento.case_id == caso_id,
        models.Documento.tipo_documento == tipo_documento
    ).first()
    if existing:
        if os.path.exists(existing.path_arquivo):
            os.remove(existing.path_arquivo)
        db.delete(existing)
        db.flush()

    doc = models.Documento(
        case_id=caso_id,
        tipo_documento=tipo_documento,
        nome_arquivo=arquivo.filename,
        path_arquivo=file_path,
        mime_type=arquivo.content_type,
        tamanho_bytes=len(content)
    )
    db.add(doc)

    # Atualizar status para assinatura do gerente de pós-venda ao atingir documentação mínima
    db.commit()
    db.refresh(doc)
    caso_refreshed = _load_caso(caso_id, db)
    if caso_refreshed.status == "Aguardando Documentos" and _check_docs_completos(caso_refreshed):
        caso_refreshed.status = "Aguardando Aprovação Pós-Venda"
        db.commit()

    return doc


@router.get("/{caso_id}/documentos", response_model=List[schemas.DocumentoOut])
def listar_documentos(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    _load_caso(caso_id, db)
    return db.query(models.Documento).filter(models.Documento.case_id == caso_id).all()


@router.get("/{caso_id}/documentos/{doc_id}/download")
def download_documento(
    caso_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user_download)
):
    doc = db.query(models.Documento).filter(
        models.Documento.id == doc_id,
        models.Documento.case_id == caso_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    if not os.path.exists(doc.path_arquivo):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado no servidor")
    return FileResponse(doc.path_arquivo, filename=doc.nome_arquivo, media_type=doc.mime_type or "application/octet-stream")


@router.post("/{caso_id}/documentos/{doc_id}/assinar", response_model=schemas.DocumentoAssinaturaOut)
def assinar_documento_individual(
    caso_id: int,
    doc_id: int,
    body: schemas.DocumentoAssinaturaCreate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    caso = _load_caso(caso_id, db)
    etapa = _resolver_etapa_assinatura(caso, current_user)

    doc = db.query(models.Documento).filter(
        models.Documento.id == doc_id,
        models.Documento.case_id == caso_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado para assinatura")

    if _normalizar_texto(doc.tipo_documento) == _normalizar_texto("Vídeo de Descarte"):
        raise HTTPException(status_code=400, detail="Vídeo de descarte não participa da assinatura documental")

    prefix = "data:image/png;base64,"
    assinatura_raw = body.assinatura_data_url or ""
    if not assinatura_raw.startswith(prefix):
        raise HTTPException(status_code=400, detail="Assinatura inválida. Envie imagem PNG em base64")

    try:
        assinatura_bytes = base64.b64decode(assinatura_raw[len(prefix):], validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Assinatura inválida (base64 malformado)")

    if len(assinatura_bytes) < 300:
        raise HTTPException(status_code=400, detail="Assinatura muito pequena. Desenhe a assinatura antes de confirmar")
    if len(assinatura_bytes) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Assinatura muito grande. Limite de 2MB")

    assinatura_dir = os.path.join(UPLOADS_DIR, str(caso_id), SIGNATURES_SUBDIR)
    os.makedirs(assinatura_dir, exist_ok=True)

    existing = db.query(models.DocumentoAssinatura).filter(
        models.DocumentoAssinatura.case_id == caso_id,
        models.DocumentoAssinatura.documento_id == doc_id,
        models.DocumentoAssinatura.usuario_id == current_user.id,
        models.DocumentoAssinatura.etapa_fluxo == etapa,
    ).first()

    filename = f"{uuid.uuid4().hex}_doc_{doc_id}_{etapa.replace('-', '_')}_{current_user.id}.png"
    assinatura_path = os.path.join(assinatura_dir, filename)
    with open(assinatura_path, "wb") as f:
        f.write(assinatura_bytes)

    if existing and existing.path_assinatura and os.path.exists(existing.path_assinatura):
        try:
            os.remove(existing.path_assinatura)
        except OSError:
            pass

    if existing:
        existing.path_assinatura = assinatura_path
        existing.data_assinatura = datetime.utcnow()
        assinatura = existing
    else:
        assinatura = models.DocumentoAssinatura(
            case_id=caso_id,
            documento_id=doc_id,
            usuario_id=current_user.id,
            etapa_fluxo=etapa,
            path_assinatura=assinatura_path,
            data_assinatura=datetime.utcnow(),
        )
        db.add(assinatura)

    db.commit()
    db.refresh(assinatura)
    return assinatura


@router.delete("/{caso_id}/documentos/{doc_id}")
def deletar_documento(
    caso_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    caso = _load_caso(caso_id, db)
    if caso.status in STATUS_BLOQUEIA_EDICAO:
        raise HTTPException(status_code=400, detail="Caso em etapa final.")

    doc = db.query(models.Documento).filter(
        models.Documento.id == doc_id,
        models.Documento.case_id == caso_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")

    doc_assinaturas = db.query(models.DocumentoAssinatura).filter(
        models.DocumentoAssinatura.documento_id == doc.id
    ).all()
    for assinatura_doc in doc_assinaturas:
        if assinatura_doc.path_assinatura and os.path.exists(assinatura_doc.path_assinatura):
            try:
                os.remove(assinatura_doc.path_assinatura)
            except OSError:
                pass
        db.delete(assinatura_doc)

    if os.path.exists(doc.path_arquivo):
        os.remove(doc.path_arquivo)
    db.delete(doc)
    db.flush()

    # Regressar status se remover documento obrigatório mínimo (remessa)
    caso_db = _load_caso(caso_id, db)
    if caso_db.status != "Reprovado" and not _check_docs_completos(caso_db):
        caso_db.status = "Aguardando Documentos"

    db.commit()
    return {"message": "Documento removido"}


# ─── Assinaturas / Aprovações ─────────────────────────────────────────────────

@router.post("/{caso_id}/assinar", response_model=schemas.CasoOut)
def assinar_caso(
    caso_id: int,
    body: schemas.AssinarRequest,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    caso = _load_caso(caso_id, db)

    if body.status_decisao not in ["Aprovado", "Reprovado"]:
        raise HTTPException(status_code=400, detail="Decisão inválida. Use: Aprovado | Reprovado")

    etapa = _resolver_etapa_assinatura(caso, current_user)
    _validar_assinaturas_documentos(caso, etapa, current_user.id)

    # Registrar assinatura
    assinatura = models.Assinatura(
        case_id=caso_id,
        usuario_id=current_user.id,
        etapa_fluxo=etapa,
        status_decisao=body.status_decisao,
        observacao=body.observacao,
        data_assinatura=datetime.utcnow()
    )
    db.add(assinatura)

    # Atualizar status do caso
    caso_db = db.query(models.CasoGarantia).filter(models.CasoGarantia.id == caso_id).first()

    if body.status_decisao == "Reprovado":
        caso_db.status = "Reprovado"
    elif etapa == "Pos-venda":
        caso_db.status = "Aguardando Aprovação Diretoria"
    elif etapa == "Diretoria":
        caso_db.status = STATUS_AGUARDANDO_IMPRESSAO
        caso_db.status_rebate = "Aguardando Apuração"

    db.commit()

    # Compilar PDF quando aprovado por ambos para impressão em 3 vias
    caso_final = _load_caso(caso_id, db)
    if caso_final.status == STATUS_AGUARDANDO_IMPRESSAO:
        _compilar_pdf(caso_final, db)

    return _load_caso(caso_id, db)


@router.post("/{caso_id}/confirmar-impressao", response_model=schemas.CasoOut)
def confirmar_impressao_oficina(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    """Confirma impressão em 3 vias pela oficina e encerra o caso."""
    caso = _load_caso(caso_id, db)
    if caso.status != STATUS_AGUARDANDO_IMPRESSAO:
        raise HTTPException(
            status_code=400,
            detail=f"Caso não está aguardando impressão da oficina. Status atual: {caso.status}"
        )

    caso_db = db.query(models.CasoGarantia).filter(models.CasoGarantia.id == caso_id).first()
    caso_db.status = "Finalizado"
    caso_db.atualizado_em = datetime.utcnow()
    if caso_db.status_rebate == "Não Aplicável":
        caso_db.status_rebate = "Aguardando Apuração"
    db.commit()

    caso_final = _load_caso(caso_id, db)
    if not caso_final.link_pdf_compilado:
        _compilar_pdf(caso_final, db)

    return _load_caso(caso_id, db)


@router.post("/{caso_id}/video-descarte", response_model=schemas.CasoOut)
async def upload_video_descarte(
    caso_id: int,
    arquivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    """Upload do vídeo de descarte para casos de bateria (etapa após aprovação diretoria)."""
    caso = _load_caso(caso_id, db)
    if caso.status != "Aguardando Vídeo Descarte":
        raise HTTPException(
            status_code=400,
            detail=f"Caso não está aguardando vídeo de descarte. Status atual: {caso.status}"
        )

    ext = Path(arquivo.filename).suffix.lower()
    if ext not in {".mp4", ".mov", ".avi", ".mkv", ".webm"}:
        raise HTTPException(status_code=400, detail="Formato de vídeo inválido")

    case_dir = os.path.join(UPLOADS_DIR, str(caso_id))
    os.makedirs(case_dir, exist_ok=True)

    unique_name = f"video_descarte_{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(case_dir, unique_name)

    content = await arquivo.read()
    with open(file_path, "wb") as f:
        f.write(content)

    doc = models.Documento(
        case_id=caso_id,
        tipo_documento="Vídeo de Descarte",
        nome_arquivo=arquivo.filename,
        path_arquivo=file_path,
        mime_type=arquivo.content_type,
        tamanho_bytes=len(content)
    )
    db.add(doc)

    caso_db = db.query(models.CasoGarantia).filter(models.CasoGarantia.id == caso_id).first()
    caso_db.status = "Finalizado"
    caso_db.status_rebate = "Aguardando Apuração"
    caso_db.atualizado_em = datetime.utcnow()
    db.commit()

    # Compilar PDF
    caso_final = _load_caso(caso_id, db)
    _compilar_pdf(caso_final, db)

    return _load_caso(caso_id, db)


@router.post("/{caso_id}/compilar-pdf")
def compilar_pdf_manual(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    """Recompila o PDF do dossiê manualmente."""
    caso = _load_caso(caso_id, db)
    result_path = _compilar_pdf(caso, db)
    return {"message": "PDF compilado com sucesso", "path": result_path}


@router.get("/{caso_id}/pdf")
def download_pdf_compilado(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user_download)
):
    caso = _load_caso(caso_id, db)
    if not caso.link_pdf_compilado or not os.path.exists(caso.link_pdf_compilado):
        raise HTTPException(status_code=404, detail="PDF compilado não disponível")
    filename = f"dossie_garantia_{caso.dji_case_id or caso.id}.pdf"
    return FileResponse(caso.link_pdf_compilado, filename=filename, media_type="application/pdf")


# ─── Helpers Internos ─────────────────────────────────────────────────────────

def _compilar_pdf(caso: models.CasoGarantia, db: Session) -> str:
    """Compila o PDF do dossiê e atualiza o campo link_pdf_compilado."""
    try:
        caso_data = {
            "dji_case_id": caso.dji_case_id,
            "tipo_processo": caso.tipo_processo,
            "produto_nome": caso.produto_nome,
            "produto_modelo": caso.produto_modelo,
            "produto_sn": caso.produto_sn,
            "data_entrada": caso.data_entrada,
            "cliente_razao_social": caso.cliente.razao_social if caso.cliente else None,
            "cliente_cnpj": caso.cliente.cnpj if caso.cliente else None,
            "assinaturas": [
                {
                    "etapa_fluxo": sig.etapa_fluxo,
                    "status_decisao": sig.status_decisao,
                    "data_assinatura": sig.data_assinatura,
                    "usuario_nome": sig.usuario.nome if sig.usuario else None
                }
                for sig in caso.assinaturas
            ],
            "documentos": [
                {"tipo_documento": d.tipo_documento, "nome_arquivo": d.nome_arquivo}
                for d in caso.documentos
            ]
        }

        document_paths = [
            {"path_arquivo": d.path_arquivo, "tipo_documento": d.tipo_documento, "nome_arquivo": d.nome_arquivo}
            for d in caso.documentos
        ]

        output_path = os.path.join(COMPILED_DIR, f"caso_{caso.id}_dossie.pdf")
        result = compile_pdf(caso_data, document_paths, output_path)

        # Atualizar link no banco
        caso_db = db.query(models.CasoGarantia).filter(models.CasoGarantia.id == caso.id).first()
        if caso_db:
            caso_db.link_pdf_compilado = result
            db.commit()
        return result
    except Exception as e:
        print(f"Erro ao compilar PDF do caso {caso.id}: {e}")
        return ""
