import os
import shutil
import uuid
import unicodedata
import io
import mimetypes
from datetime import datetime, date, timezone, timedelta
from typing import List, Optional
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from PIL import Image, UnidentifiedImageError

from database import get_db
import models, schemas
from auth import get_current_user, get_current_user_download, require_roles
from utils.pdf_compiler import compile_pdf
from services.auditoria import gerar_diff, registrar_evento_auditoria
from services.signature_store import (
    decode_signature_data_url,
    salvar_assinatura_usuario,
    carregar_assinatura_usuario_bytes,
)

router = APIRouter()

# Diretório base para uploads
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
COMPILED_DIR = os.path.join(BASE_DIR, "compiled")
SIGNATURES_SUBDIR = "assinaturas"

DOCS_OBRIGATORIOS = {
    "categoria_remessa_dronepro",
    "categoria_remessa_huada",
}

DOCS_OPCIONAIS = {
    "categoria_nf_remessa_dronepro",
    "categoria_nf_remessa_huada",
    "categoria_relatorio_tecnico",
}

STATUS_AGUARDANDO_IMPRESSAO = "Aguardando Impressão Oficina"
STATUS_AGUARDANDO_ESTOQUE = "Aguardando Conferência Estoque"
STATUS_AGUARDANDO_VIDEO_DESCARTE_LEGADO = "Aguardando Vídeo Descarte"
STATUS_ETAPA_ESTOQUE_COMPAT = {
    STATUS_AGUARDANDO_ESTOQUE,
    STATUS_AGUARDANDO_IMPRESSAO,  # compatibilidade para casos legados
    STATUS_AGUARDANDO_VIDEO_DESCARTE_LEGADO,  # legado de fluxo antigo de bateria
}
STATUS_BLOQUEIA_EDICAO = {
    "Aguardando Aprovação Diretoria",
    STATUS_AGUARDANDO_ESTOQUE,
    STATUS_AGUARDANDO_IMPRESSAO,
    "Finalizado",
    "Reprovado",
}
STATUS_AGUARDANDO_DOCUMENTOS = "Aguardando Documentos"
STATUS_AGUARDANDO_POS_VENDA = "Aguardando Aprovação Pós-Venda"
STATUS_AGUARDANDO_DIRETORIA = "Aguardando Aprovação Diretoria"

STATUS_FLOW = {
    "Aguardando Documentos": 0,
    "Aguardando Aprovação Pós-Venda": 1,
    "Aguardando Aprovação Diretoria": 2,
    STATUS_AGUARDANDO_ESTOQUE: 3,
    STATUS_AGUARDANDO_IMPRESSAO: 4,
    "Finalizado": 5,
    "Reprovado": 6,
    STATUS_AGUARDANDO_VIDEO_DESCARTE_LEGADO: 3,  # legado
}

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

APP_TIMEZONE = os.getenv("APP_TIMEZONE", "America/Sao_Paulo")
_APP_TZ = None
if ZoneInfo is not None:
    try:
        _APP_TZ = ZoneInfo(APP_TIMEZONE)
    except Exception:
        _APP_TZ = None

# Fallback para ambientes sem base IANA (comum no Windows sem tzdata):
# garante horário local do sistema no Brasil (UTC-03) para exibição.
if _APP_TZ is None:
    _APP_TZ = timezone(timedelta(hours=-3), name="BRT")


def _normalizar_texto(valor: Optional[str]) -> str:
    texto = unicodedata.normalize("NFD", valor or "")
    return "".join(ch for ch in texto if unicodedata.category(ch) != "Mn").strip().lower()


def _categorizar_tipo_documento(tipo_documento: Optional[str]) -> str:
    tipo = _normalizar_texto(tipo_documento)
    if not tipo:
        return "categoria_outros"
    if "foto" in tipo and "pedido" in tipo and "estoque" in tipo:
        return "categoria_foto_pedido_estoque"
    if (
        (("nota fiscal" in tipo and "remessa" in tipo) or "nf remessa" in tipo)
        and "huada" in tipo
    ):
        return "categoria_nf_remessa_huada"
    if ("nota fiscal" in tipo and "remessa" in tipo) or "nf remessa" in tipo:
        return "categoria_nf_remessa_dronepro"
    if (
        ("remessa" in tipo and "huada" in tipo)
        or "nota huada" in tipo
    ):
        return "categoria_remessa_huada"
    if (
        ("remessa" in tipo and ("dronepro" in tipo or "drone pro" in tipo))
        or "nota drone pro" in tipo
        or "nota droneprop" in tipo
        or "nota drone prop" in tipo
    ):
        return "categoria_remessa_dronepro"
    if "relatorio tecnico" in tipo:
        return "categoria_relatorio_tecnico"
    if "remessa" in tipo:
        return "categoria_remessa_dronepro"
    return "categoria_outros"


def _mime_generico(mime_type: Optional[str]) -> bool:
    valor = (mime_type or "").split(";")[0].strip().lower()
    if not valor:
        return True
    return valor in {"application/octet-stream", "binary/octet-stream", "application/binary"}


def _resolver_mime_type(
    nome_arquivo: Optional[str],
    path_arquivo: Optional[str],
    mime_reportado: Optional[str],
) -> str:
    if not _mime_generico(mime_reportado):
        return (mime_reportado or "").split(";")[0].strip().lower()
    guessed = None
    if nome_arquivo:
        guessed = mimetypes.guess_type(nome_arquivo)[0]
    if not guessed and path_arquivo:
        guessed = mimetypes.guess_type(path_arquivo)[0]
    return guessed or "application/octet-stream"


def _arquivo_parece_imagem(
    nome_arquivo: Optional[str],
    mime_reportado: Optional[str],
    content: bytes,
) -> bool:
    mime = (mime_reportado or "").split(";")[0].strip().lower()
    if mime.startswith("image/"):
        return True

    guessed = mimetypes.guess_type(nome_arquivo or "")[0]
    if guessed and guessed.startswith("image/"):
        return True

    if not content:
        return False

    try:
        with Image.open(io.BytesIO(content)) as img:
            img.verify()
        return True
    except (UnidentifiedImageError, OSError, ValueError):
        return False


def _content_disposition(filename: str, disposition: str) -> str:
    safe_name = (filename or "arquivo").replace('"', "")
    encoded_name = quote(safe_name)
    return f"{disposition}; filename=\"{safe_name}\"; filename*=UTF-8''{encoded_name}"


def _check_docs_completos(caso: models.CasoGarantia) -> bool:
    """Verifica se há pelo menos uma remessa anexada para liberar assinatura."""
    categorias_enviadas = {_categorizar_tipo_documento(doc.tipo_documento) for doc in (caso.documentos or [])}
    return len(categorias_enviadas.intersection(DOCS_OBRIGATORIOS)) > 0


def _documento_exige_assinatura(doc: models.Documento) -> bool:
    """Toda remessa anexada (DronePro/Huada) exige assinatura no fluxo."""
    return _categorizar_tipo_documento(doc.tipo_documento) in {
        "categoria_remessa_dronepro",
        "categoria_remessa_huada",
    }


def _documentos_assinaveis(caso: models.CasoGarantia) -> List[models.Documento]:
    return [
        doc for doc in (caso.documentos or [])
        if _documento_exige_assinatura(doc)
    ]


def _documento_foto_pedido_estoque(doc: models.Documento) -> bool:
    return _categorizar_tipo_documento(doc.tipo_documento) == "categoria_foto_pedido_estoque"


def _check_foto_pedido_estoque(caso: models.CasoGarantia) -> bool:
    return any(_documento_foto_pedido_estoque(doc) for doc in (caso.documentos or []))


def _etapas_requeridas_para_dossie(caso: models.CasoGarantia) -> List[str]:
    etapas = ["Pos-venda", "Diretoria"]
    possui_assinatura_estoque = any(sig.etapa_fluxo == "Estoque" for sig in (caso.assinaturas or []))
    if possui_assinatura_estoque:
        etapas.append("Estoque")
    return etapas


def _resolver_etapa_assinatura(caso: models.CasoGarantia, current_user: models.Usuario) -> str:
    if current_user.papel == "gerente_pos_venda":
        if caso.status != STATUS_AGUARDANDO_POS_VENDA:
            raise HTTPException(
                status_code=400,
                detail=f"Caso não está aguardando aprovação do Pós-venda. Status atual: {caso.status}"
            )
        return "Pos-venda"
    if current_user.papel == "diretor_comercial":
        if caso.status != STATUS_AGUARDANDO_DIRETORIA:
            raise HTTPException(
                status_code=400,
                detail=f"Caso não está aguardando aprovação do diretor comercial. Status atual: {caso.status}"
            )
        return "Diretoria"
    if current_user.papel == "gestor_estoque":
        if caso.status not in STATUS_ETAPA_ESTOQUE_COMPAT:
            raise HTTPException(
                status_code=400,
                detail=f"Caso não está aguardando etapa do gestor de estoque. Status atual: {caso.status}"
            )
        return "Estoque"
    if current_user.papel == "admin":
        if caso.status == STATUS_AGUARDANDO_POS_VENDA:
            return "Pos-venda"
        if caso.status == STATUS_AGUARDANDO_DIRETORIA:
            return "Diretoria"
        if caso.status in STATUS_ETAPA_ESTOQUE_COMPAT:
            return "Estoque"
        raise HTTPException(status_code=400, detail=f"Caso não está aguardando aprovação. Status: {caso.status}")
    raise HTTPException(status_code=403, detail="Você não tem permissão para assinar este caso")


def _validar_assinaturas_documentos(caso: models.CasoGarantia, etapa: str, usuario_id: int) -> None:
    docs = _documentos_assinaveis(caso)
    if not docs:
        raise HTTPException(
            status_code=400,
            detail="Não há documento de Remessa anexado para assinatura neste caso.",
        )

    assinados_ids = {
        assinatura.documento_id
        for assinatura in (caso.documento_assinaturas or [])
        if assinatura.etapa_fluxo == etapa and assinatura.usuario_id == usuario_id
    }
    pendentes = [doc.nome_arquivo for doc in docs if doc.id not in assinados_ids]
    if pendentes:
        raise HTTPException(
            status_code=400,
            detail=f"Assine todos os documentos de Remessa anexados antes de concluir a etapa. Pendente(s): {', '.join(pendentes)}"
        )


def _validar_documentos_assinados_por_etapas(
    caso: models.CasoGarantia,
    etapas_requeridas: List[str],
    contexto: str,
) -> None:
    docs = _documentos_assinaveis(caso)
    if not docs:
        raise HTTPException(
            status_code=400,
            detail="Não há documento de Remessa anexado para assinatura neste caso.",
        )

    assinaturas_por_doc: dict[int, set[str]] = {}
    for assinatura in (caso.documento_assinaturas or []):
        assinaturas_por_doc.setdefault(assinatura.documento_id, set()).add(assinatura.etapa_fluxo)

    etapa_label = {
        "Pos-venda": "Gerente Pós-venda",
        "Diretoria": "Diretor Comercial",
        "Estoque": "Gestor de Estoque",
    }

    pendencias: List[str] = []
    for doc in docs:
        etapas_doc = assinaturas_por_doc.get(doc.id, set())
        faltantes = [etapa_label.get(etapa, etapa) for etapa in etapas_requeridas if etapa not in etapas_doc]
        if faltantes:
            pendencias.append(f"{doc.nome_arquivo} (faltando: {', '.join(faltantes)})")

    if pendencias:
        raise HTTPException(
            status_code=400,
            detail=f"Fluxo bloqueado para {contexto}. Todos os documentos de Remessa anexados devem estar assinados por todas as etapas exigidas. Pendências: {'; '.join(pendencias)}",
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
    if caso.status == STATUS_AGUARDANDO_VIDEO_DESCARTE_LEGADO:
        # Migração automática de status legado para manter a esteira atual
        # (Diretoria -> Gestor de Estoque -> conclusão).
        caso.status = STATUS_AGUARDANDO_ESTOQUE
        caso.atualizado_em = datetime.utcnow()
        db.flush()
    return caso


def _migrar_status_legado_video_para_estoque(db: Session) -> None:
    atualizados = (
        db.query(models.CasoGarantia)
        .filter(models.CasoGarantia.status == STATUS_AGUARDANDO_VIDEO_DESCARTE_LEGADO)
        .update(
            {
                models.CasoGarantia.status: STATUS_AGUARDANDO_ESTOQUE,
                models.CasoGarantia.atualizado_em: datetime.utcnow(),
            },
            synchronize_session=False,
        )
    )
    if atualizados:
        db.commit()


def _codigo_caso(caso: models.CasoGarantia) -> str:
    return caso.dji_case_id or f"Caso #{caso.id}"


def _nome_usuario(usuario: Optional[models.Usuario]) -> str:
    if usuario and usuario.nome:
        return usuario.nome
    if usuario and usuario.id:
        return f"Usuário #{usuario.id}"
    return "Usuário"


def _criar_notificacao(
    db: Session,
    usuario_id: int,
    tipo: str,
    titulo: str,
    mensagem: str,
    case_id: Optional[int] = None,
) -> None:
    db.add(
        models.Notificacao(
            usuario_id=usuario_id,
            case_id=case_id,
            tipo=tipo,
            titulo=titulo,
            mensagem=mensagem,
            lida=0,
            criado_em=datetime.utcnow(),
        )
    )


def _notificar_papel(
    db: Session,
    papel: str,
    tipo: str,
    titulo: str,
    mensagem: str,
    case_id: Optional[int] = None,
    excluir_usuario_id: Optional[int] = None,
) -> None:
    usuarios = db.query(models.Usuario).filter(
        models.Usuario.papel == papel,
        models.Usuario.ativo == 1,
    ).all()
    for usuario in usuarios:
        if excluir_usuario_id is not None and usuario.id == excluir_usuario_id:
            continue
        _criar_notificacao(
            db=db,
            usuario_id=usuario.id,
            tipo=tipo,
            titulo=titulo,
            mensagem=mensagem,
            case_id=case_id,
        )


def _notificar_operacao_todos(
    db: Session,
    tipo: str,
    titulo: str,
    mensagem: str,
    case_id: Optional[int] = None,
    excluir_usuario_id: Optional[int] = None,
) -> None:
    usuarios = db.query(models.Usuario).filter(models.Usuario.ativo == 1).all()
    for usuario in usuarios:
        if excluir_usuario_id is not None and usuario.id == excluir_usuario_id:
            continue
        _criar_notificacao(
            db=db,
            usuario_id=usuario.id,
            tipo=tipo,
            titulo=titulo,
            mensagem=mensagem,
            case_id=case_id,
        )


def _snapshot_caso_para_exclusao(caso: models.CasoGarantia) -> dict:
    docs = list(caso.documentos or [])
    assinaturas_caso = list(caso.assinaturas or [])
    assinaturas_doc = list(caso.documento_assinaturas or [])
    docs_map = {doc.id: doc for doc in docs}

    return {
        "caso": {
            "id": caso.id,
            "codigo": _codigo_caso(caso),
            "tipo_processo": caso.tipo_processo,
            "status": caso.status,
            "status_rebate": caso.status_rebate,
            "cliente_id": caso.cliente_id,
            "cliente_razao_social": caso.cliente.razao_social if caso.cliente else None,
            "produto_nome": caso.produto_nome,
            "produto_modelo": caso.produto_modelo,
            "produto_sn": caso.produto_sn,
            "data_entrada": caso.data_entrada,
            "observacoes": caso.observacoes,
            "criado_em": caso.criado_em,
            "atualizado_em": caso.atualizado_em,
        },
        "qtd_documentos": len(docs),
        "documentos": [
            {
                "id": doc.id,
                "tipo_documento": doc.tipo_documento,
                "nome_arquivo": doc.nome_arquivo,
                "mime_type": doc.mime_type,
                "tamanho_bytes": doc.tamanho_bytes,
                "data_upload": doc.data_upload,
                "path_arquivo": doc.path_arquivo,
            }
            for doc in docs
        ],
        "qtd_assinaturas_caso": len(assinaturas_caso),
        "assinaturas_caso": [
            {
                "id": sig.id,
                "usuario_id": sig.usuario_id,
                "usuario_nome": sig.usuario.nome if sig.usuario else None,
                "etapa_fluxo": sig.etapa_fluxo,
                "status_decisao": sig.status_decisao,
                "observacao": sig.observacao,
                "data_assinatura": sig.data_assinatura,
            }
            for sig in assinaturas_caso
        ],
        "qtd_assinaturas_documento": len(assinaturas_doc),
        "assinaturas_documento": [
            {
                "id": sig.id,
                "documento_id": sig.documento_id,
                "documento_nome": docs_map.get(sig.documento_id).nome_arquivo if docs_map.get(sig.documento_id) else None,
                "usuario_id": sig.usuario_id,
                "usuario_nome": sig.usuario.nome if sig.usuario else None,
                "etapa_fluxo": sig.etapa_fluxo,
                "data_assinatura": sig.data_assinatura,
                "path_assinatura": sig.path_assinatura,
            }
            for sig in assinaturas_doc
        ],
    }


def _remover_assinaturas_documento(documento_id: int, db: Session) -> List[dict]:
    assinaturas = (
        db.query(models.DocumentoAssinatura)
        .options(joinedload(models.DocumentoAssinatura.usuario))
        .filter(models.DocumentoAssinatura.documento_id == documento_id)
        .all()
    )
    snapshot: List[dict] = []
    for assinatura_doc in assinaturas:
        snapshot.append(
            {
                "id": assinatura_doc.id,
                "usuario_id": assinatura_doc.usuario_id,
                "usuario_nome": assinatura_doc.usuario.nome if assinatura_doc.usuario else None,
                "etapa_fluxo": assinatura_doc.etapa_fluxo,
                "data_assinatura": assinatura_doc.data_assinatura,
                "path_assinatura": assinatura_doc.path_assinatura,
            }
        )
    for assinatura_doc in assinaturas:
        if assinatura_doc.path_assinatura and os.path.exists(assinatura_doc.path_assinatura):
            try:
                os.remove(assinatura_doc.path_assinatura)
            except OSError:
                pass
        db.delete(assinatura_doc)
    return snapshot


def _path_pdf_original(path_arquivo: str) -> str:
    return f"{path_arquivo}.orig"


def _obter_fonte_pdf(path_arquivo: str) -> str:
    orig = _path_pdf_original(path_arquivo)
    if os.path.exists(orig):
        return orig
    return path_arquivo


def _garantir_backup_pdf_original(path_arquivo: str) -> str:
    origem = _obter_fonte_pdf(path_arquivo)
    backup = _path_pdf_original(path_arquivo)
    if not os.path.exists(backup):
        shutil.copy2(origem, backup)
    return backup


def _remover_backup_pdf_original(path_arquivo: str) -> None:
    backup = _path_pdf_original(path_arquivo)
    if os.path.exists(backup):
        try:
            os.remove(backup)
        except OSError:
            pass


def _fmt_data_hora_br(data_hora: Optional[datetime]) -> str:
    if not data_hora:
        return "—"
    dt = data_hora
    try:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if _APP_TZ is not None:
            dt = dt.astimezone(_APP_TZ)
    except Exception:
        pass
    return dt.strftime("%d/%m/%Y %H:%M:%S")


def _etapa_ordem(etapa_fluxo: str) -> int:
    if etapa_fluxo == "Pos-venda":
        return 0
    if etapa_fluxo == "Diretoria":
        return 1
    if etapa_fluxo == "Estoque":
        return 2
    return 9


def _carimbar_assinaturas_no_pdf_documento(
    doc: models.Documento,
    assinaturas: List[models.DocumentoAssinatura],
    source_path: Optional[str] = None,
) -> bytes:
    """Carimba as assinaturas na 1ª página do PDF do documento."""
    assinaturas_ordenadas = sorted(
        assinaturas,
        key=lambda s: (_etapa_ordem(s.etapa_fluxo), s.data_assinatura or datetime.min),
    )

    pdf_source_path = source_path or doc.path_arquivo
    reader = PdfReader(pdf_source_path)
    if not reader.pages:
        with open(pdf_source_path, "rb") as f:
            return f.read()

    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if i == 0 and assinaturas_ordenadas:
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)

            overlay_buf = io.BytesIO()
            c = canvas.Canvas(overlay_buf, pagesize=(page_width, page_height))

            # Banner superior para sinalizar assinatura digital no próprio documento.
            c.setFillColorRGB(0.98, 0.96, 0.87)
            c.roundRect(24, page_height - 34, page_width - 48, 18, 4, stroke=0, fill=1)
            c.setFillColorRGB(0.36, 0.24, 0.02)
            c.setFont("Helvetica-Bold", 8)
            c.drawString(30, page_height - 28, f"Documento assinado digitalmente ({len(assinaturas_ordenadas)} assinatura(s))")

            # Bloco inferior com carimbo das assinaturas
            margem = 24
            gap = 10
            colunas = 2
            box_w = (page_width - (margem * 2) - gap) / colunas
            box_h = 94

            max_itens = min(len(assinaturas_ordenadas), 4)
            for idx, assinatura in enumerate(assinaturas_ordenadas[:max_itens]):
                col = idx % colunas
                row = idx // colunas
                x = margem + col * (box_w + gap)
                y = margem + row * (box_h + 8)

                c.setStrokeColorRGB(0.16, 0.26, 0.40)
                c.setFillColorRGB(0.95, 0.98, 1.0)
                c.roundRect(x, y, box_w, box_h, 6, stroke=1, fill=1)

                etapa = (
                    "Gerente Pós-venda" if assinatura.etapa_fluxo == "Pos-venda"
                    else "Diretor Comercial" if assinatura.etapa_fluxo == "Diretoria"
                    else "Gestor de Estoque" if assinatura.etapa_fluxo == "Estoque"
                    else assinatura.etapa_fluxo
                )
                nome = assinatura.usuario.nome if assinatura.usuario else f"Usuário #{assinatura.usuario_id}"
                when = _fmt_data_hora_br(assinatura.data_assinatura)

                c.setFillColorRGB(0.12, 0.20, 0.30)
                c.setFont("Helvetica-Bold", 8.6)
                c.drawString(x + 6, y + box_h - 13, etapa)
                c.setFont("Helvetica", 7.8)
                c.drawString(x + 6, y + box_h - 25, nome[:58])
                c.drawString(x + 6, y + box_h - 36, f"Assinado em {when}")

                assinatura_x = x + 6
                assinatura_y = y + 7
                assinatura_w = box_w - 12
                assinatura_h = box_h - 48
                c.setStrokeColorRGB(0.74, 0.83, 0.94)
                c.setFillColorRGB(1, 1, 1)
                c.roundRect(assinatura_x, assinatura_y, assinatura_w, assinatura_h, 4, stroke=1, fill=1)
                c.setFillColorRGB(0.42, 0.50, 0.60)
                c.setFont("Helvetica-Oblique", 7.3)
                c.drawString(assinatura_x + 5, assinatura_y + assinatura_h - 10, "Assinatura capturada")

                if assinatura.path_assinatura and os.path.exists(assinatura.path_assinatura):
                    try:
                        img = ImageReader(assinatura.path_assinatura)
                        c.drawImage(
                            img,
                            assinatura_x + 4,
                            assinatura_y + 4,
                            width=assinatura_w - 8,
                            height=max(assinatura_h - 16, 16),
                            preserveAspectRatio=True,
                            mask="auto",
                        )
                    except Exception:
                        c.setFillColorRGB(0.70, 0.12, 0.12)
                        c.setFont("Helvetica", 7.5)
                        c.drawString(assinatura_x + 5, assinatura_y + 7, "Falha ao renderizar assinatura")

            c.save()
            overlay_buf.seek(0)
            overlay_pdf = PdfReader(overlay_buf)
            page.merge_page(overlay_pdf.pages[0])

        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    out.seek(0)
    return out.getvalue()


def _gerar_pdf_com_pagina_assinaturas(
    doc: models.Documento,
    assinaturas: List[models.DocumentoAssinatura],
    source_path: Optional[str] = None,
) -> bytes:
    """Fallback seguro: mantém PDF original e adiciona uma página final com assinaturas."""
    pdf_source_path = source_path or doc.path_arquivo
    reader = PdfReader(pdf_source_path)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    if assinaturas:
        first_page = reader.pages[0] if reader.pages else None
        page_width = float(first_page.mediabox.width) if first_page else 595.27
        page_height = float(first_page.mediabox.height) if first_page else 841.89

        overlay_buf = io.BytesIO()
        c = canvas.Canvas(overlay_buf, pagesize=(page_width, page_height))
        c.setFont("Helvetica-Bold", 14)
        c.setFillColorRGB(0.12, 0.20, 0.30)
        c.drawString(30, page_height - 40, "Comprovante de Assinaturas Digitais")

        c.setFont("Helvetica", 10)
        c.setFillColorRGB(0.25, 0.31, 0.39)
        c.drawString(30, page_height - 58, f"Documento: {doc.nome_arquivo}")
        c.drawString(30, page_height - 74, f"Total de assinaturas: {len(assinaturas)}")

        y = page_height - 110
        for assinatura in sorted(
            assinaturas,
            key=lambda s: (_etapa_ordem(s.etapa_fluxo), s.data_assinatura or datetime.min),
        ):
            if y < 130:
                c.showPage()
                y = page_height - 40

            etapa = (
                "Gerente Pós-venda" if assinatura.etapa_fluxo == "Pos-venda"
                else "Diretor Comercial" if assinatura.etapa_fluxo == "Diretoria"
                else "Gestor de Estoque" if assinatura.etapa_fluxo == "Estoque"
                else assinatura.etapa_fluxo
            )
            nome = assinatura.usuario.nome if assinatura.usuario else f"Usuário #{assinatura.usuario_id}"
            when = _fmt_data_hora_br(assinatura.data_assinatura)

            c.setStrokeColorRGB(0.16, 0.26, 0.40)
            c.setFillColorRGB(0.95, 0.98, 1.0)
            c.roundRect(30, y - 80, page_width - 60, 76, 6, stroke=1, fill=1)

            c.setFillColorRGB(0.12, 0.20, 0.30)
            c.setFont("Helvetica-Bold", 9)
            c.drawString(40, y - 20, etapa)
            c.setFont("Helvetica", 8.6)
            c.drawString(40, y - 34, nome[:76])
            c.drawString(40, y - 47, f"Assinado em {when}")

            assinatura_x = 40
            assinatura_y = y - 74
            assinatura_w = page_width - 80
            assinatura_h = 22
            c.setStrokeColorRGB(0.74, 0.83, 0.94)
            c.setFillColorRGB(1, 1, 1)
            c.roundRect(assinatura_x, assinatura_y, assinatura_w, assinatura_h, 3, stroke=1, fill=1)
            c.setFillColorRGB(0.42, 0.50, 0.60)
            c.setFont("Helvetica-Oblique", 7.3)
            c.drawString(assinatura_x + 5, assinatura_y + assinatura_h - 9, "Assinatura capturada")

            if assinatura.path_assinatura and os.path.exists(assinatura.path_assinatura):
                try:
                    img = ImageReader(assinatura.path_assinatura)
                    c.drawImage(
                        img,
                        assinatura_x + 3,
                        assinatura_y + 2,
                        width=assinatura_w - 6,
                        height=assinatura_h - 8,
                        preserveAspectRatio=True,
                        mask="auto",
                    )
                except Exception:
                    pass

            y -= 92

        c.save()
        overlay_buf.seek(0)
        sig_pages = PdfReader(overlay_buf)
        for page in sig_pages.pages:
            writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    out.seek(0)
    return out.getvalue()


def _persistir_pdf_assinado_documento(
    doc: models.Documento,
    assinaturas: List[models.DocumentoAssinatura],
) -> None:
    """Gera e salva a versão assinada do PDF no próprio arquivo do documento."""
    ext = Path(doc.path_arquivo).suffix.lower() if doc.path_arquivo else ""
    if ext != ".pdf" or not assinaturas:
        return

    pdf_fonte = _garantir_backup_pdf_original(doc.path_arquivo)
    try:
        pdf_assinado_bytes = _carimbar_assinaturas_no_pdf_documento(doc, assinaturas, source_path=pdf_fonte)
    except Exception:
        pdf_assinado_bytes = _gerar_pdf_com_pagina_assinaturas(doc, assinaturas, source_path=pdf_fonte)

    with open(doc.path_arquivo, "wb") as f:
        f.write(pdf_assinado_bytes)
    doc.tamanho_bytes = len(pdf_assinado_bytes)


# ─── CRUD Básico ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[schemas.CasoListOut], include_in_schema=False)
@router.get("/", response_model=List[schemas.CasoListOut])
def listar_casos(
    status: Optional[str] = Query(None),
    tipo_processo: Optional[str] = Query(None),
    cliente_id: Optional[int] = Query(None),
    busca: Optional[str] = Query(None),
    assinatura_etapa: Optional[str] = Query(None, pattern="^(Pos-venda|Diretoria|Estoque)$"),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    _migrar_status_legado_video_para_estoque(db)
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
    if assinatura_etapa:
        q = (
            q.join(models.Assinatura, models.Assinatura.case_id == models.CasoGarantia.id)
            .filter(models.Assinatura.etapa_fluxo == assinatura_etapa)
            .distinct()
        )
    return q.all()


@router.get("/stats", response_model=schemas.DashboardStats)
def dashboard_stats(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    _migrar_status_legado_video_para_estoque(db)
    total = db.query(models.CasoGarantia).count()
    aguardando_docs = db.query(models.CasoGarantia).filter(
        models.CasoGarantia.status == "Aguardando Documentos"
    ).count()
    aguardando_aprov = db.query(models.CasoGarantia).filter(
        models.CasoGarantia.status.in_([
            "Aguardando Aprovação Pós-Venda",
            "Aguardando Aprovação Diretoria",
            STATUS_AGUARDANDO_ESTOQUE,
        ])
    ).count()
    finalizados = db.query(models.CasoGarantia).filter(
        models.CasoGarantia.status.in_([
            STATUS_AGUARDANDO_ESTOQUE,
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
    db.flush()
    registrar_evento_auditoria(
        db,
        acao="caso_criado",
        modulo="casos",
        descricao=f"Caso {_codigo_caso(caso)} criado.",
        usuario=current_user,
        case_id=caso.id,
        entidade="caso_garantia",
        entidade_id=caso.id,
        detalhes={
            "tipo_processo": caso.tipo_processo,
            "cliente_id": caso.cliente_id,
            "produto_nome": caso.produto_nome,
            "produto_modelo": caso.produto_modelo,
            "produto_sn": caso.produto_sn,
            "status_inicial": caso.status,
        },
    )
    db.commit()
    db.refresh(caso)

    # Notifica o gerente de pós-venda imediatamente quando uma nova solicitação é aberta
    # pela oficina, mesmo antes do envio da primeira remessa.
    codigo = _codigo_caso(caso)
    _notificar_papel(
        db,
        papel="gerente_pos_venda",
        tipo="solicitacao_aberta_oficina",
        titulo="Solicitação aberta pela oficina",
        mensagem=(
            f"{current_user.nome or 'Time Oficina'} abriu {codigo}. "
            "Aguardando anexação de pelo menos uma Remessa (DRONEPRO ou HUADA) para liberar a etapa de assinatura."
        ),
        case_id=caso.id,
    )
    _notificar_operacao_todos(
        db,
        tipo="operacao_caso_criado",
        titulo="Novo caso aberto na operação",
        mensagem=(
            f"{current_user.nome or 'Usuário'} abriu {codigo}. "
            f"Status inicial: {caso.status}."
        ),
        case_id=caso.id,
    )
    db.commit()

    return _load_caso(caso.id, db)


@router.get("/{caso_id}", response_model=schemas.CasoOut)
def obter_caso(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    _migrar_status_legado_video_para_estoque(db)
    caso = _load_caso(caso_id, db)
    if caso.status == STATUS_AGUARDANDO_DOCUMENTOS and _check_docs_completos(caso):
        codigo = _codigo_caso(caso)
        caso.status = STATUS_AGUARDANDO_POS_VENDA
        caso.atualizado_em = datetime.utcnow()
        _notificar_papel(
            db,
            papel="gerente_pos_venda",
            tipo="novo_caso_pos_venda",
            titulo="Solicitação pronta para assinatura do Pós-venda",
            mensagem=(
                f"{_nome_usuario(current_user)} confirmou documentação mínima no {codigo}. "
                "Aguardando assinatura do Gerente de Pós-venda."
            ),
            case_id=caso.id,
        )
        _notificar_operacao_todos(
            db,
            tipo="operacao_fluxo_movido",
            titulo="Caso avançou na esteira",
            mensagem=(
                f"{codigo} avançou de '{STATUS_AGUARDANDO_DOCUMENTOS}' para "
                f"'{STATUS_AGUARDANDO_POS_VENDA}'."
            ),
            case_id=caso.id,
        )
        registrar_evento_auditoria(
            db,
            acao="caso_movido_para_pos_venda_auto",
            modulo="casos_fluxo",
            descricao=f"Caso {codigo} avançou automaticamente para assinatura do Pós-venda.",
            usuario=current_user,
            case_id=caso.id,
            entidade="caso_garantia",
            entidade_id=caso.id,
            detalhes={
                "status_de": STATUS_AGUARDANDO_DOCUMENTOS,
                "status_para": STATUS_AGUARDANDO_POS_VENDA,
                "origem": "obter_caso_auto",
            },
        )
        db.commit()
        caso = _load_caso(caso_id, db)
    return caso


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
    before = {
        "dji_case_id": caso.dji_case_id,
        "tipo_processo": caso.tipo_processo,
        "cliente_id": caso.cliente_id,
        "produto_nome": caso.produto_nome,
        "produto_modelo": caso.produto_modelo,
        "produto_sn": caso.produto_sn,
        "data_entrada": caso.data_entrada,
        "observacoes": caso.observacoes,
        "status_rebate": caso.status_rebate,
    }
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(caso, field, value)
    caso.atualizado_em = datetime.utcnow()
    after = {
        "dji_case_id": caso.dji_case_id,
        "tipo_processo": caso.tipo_processo,
        "cliente_id": caso.cliente_id,
        "produto_nome": caso.produto_nome,
        "produto_modelo": caso.produto_modelo,
        "produto_sn": caso.produto_sn,
        "data_entrada": caso.data_entrada,
        "observacoes": caso.observacoes,
        "status_rebate": caso.status_rebate,
    }
    alteracoes = gerar_diff(before, after)
    registrar_evento_auditoria(
        db,
        acao="caso_atualizado",
        modulo="casos",
        descricao=f"Caso {_codigo_caso(caso)} atualizado.",
        usuario=current_user,
        case_id=caso.id,
        entidade="caso_garantia",
        entidade_id=caso.id,
        detalhes={"alteracoes": alteracoes},
    )
    if alteracoes:
        campos_alterados = sorted(alteracoes.keys())
        resumo_campos = ", ".join(campos_alterados[:5])
        if len(campos_alterados) > 5:
            resumo_campos += f" e mais {len(campos_alterados) - 5} campo(s)"
        _notificar_operacao_todos(
            db,
            tipo="operacao_caso_atualizado",
            titulo="Caso atualizado",
            mensagem=(
                f"{_nome_usuario(current_user)} atualizou {_codigo_caso(caso)}. "
                f"Campos alterados: {resumo_campos}."
            ),
            case_id=caso.id,
        )
    db.commit()
    return _load_caso(caso_id, db)


@router.delete("/{caso_id}")
def deletar_caso(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador", "gerente_pos_venda", "diretor_comercial", "gestor_estoque"))
):
    caso = _load_caso(caso_id, db)
    codigo = _codigo_caso(caso)
    snapshot = _snapshot_caso_para_exclusao(caso)
    # Remover arquivos físicos
    case_dir = os.path.join(UPLOADS_DIR, str(caso_id))
    if os.path.exists(case_dir):
        shutil.rmtree(case_dir)
    registrar_evento_auditoria(
        db,
        acao="caso_excluido",
        modulo="casos",
        descricao=f"Caso {codigo} excluído do sistema.",
        usuario=current_user,
        case_id=caso.id,
        entidade="caso_garantia",
        entidade_id=caso.id,
        detalhes={
            "status": caso.status,
            "status_rebate": caso.status_rebate,
            "cliente_id": caso.cliente_id,
            "snapshot_exclusao": snapshot,
        },
    )
    _notificar_operacao_todos(
        db,
        tipo="operacao_caso_excluido",
        titulo="Caso excluído da operação",
        mensagem=(
            f"{_nome_usuario(current_user)} excluiu {codigo}. "
            f"Último status conhecido: {caso.status}."
        ),
        case_id=caso.id,
    )
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
    current_user: models.Usuario = Depends(require_roles("admin", "operador", "gestor_estoque"))
):
    caso = _load_caso(caso_id, db)
    categoria_upload = _categorizar_tipo_documento(tipo_documento)
    upload_foto_estoque = categoria_upload == "categoria_foto_pedido_estoque"

    # A foto dos pedidos é exclusiva da etapa do Gestor de Estoque
    # (após assinatura da diretoria) e não faz parte dos anexos da oficina.
    if upload_foto_estoque:
        if current_user.papel not in {"gestor_estoque", "admin"}:
            raise HTTPException(
                status_code=400,
                detail=(
                    "A foto dos pedidos é exclusiva da sessão do Gestor de Estoque "
                    "após a assinatura da Diretoria Comercial."
                ),
            )
        if caso.status not in STATUS_ETAPA_ESTOQUE_COMPAT:
            raise HTTPException(
                status_code=400,
                detail=(
                    "A foto dos pedidos só pode ser anexada na etapa de conferência "
                    "do Gestor de Estoque."
                ),
            )

    permitido_estoque = (
        caso.status in STATUS_ETAPA_ESTOQUE_COMPAT
        and current_user.papel in {"gestor_estoque", "admin"}
        and upload_foto_estoque
    )
    if caso.status in STATUS_BLOQUEIA_EDICAO and not permitido_estoque:
        raise HTTPException(status_code=400, detail="Caso em etapa final. Não é possível adicionar documentos.")
    if current_user.papel == "gestor_estoque":
        if caso.status not in STATUS_ETAPA_ESTOQUE_COMPAT:
            raise HTTPException(status_code=400, detail="O Gestor de Estoque só pode anexar documentos na etapa de estoque.")
        if not upload_foto_estoque:
            raise HTTPException(
                status_code=400,
                detail="Nesta etapa o Gestor de Estoque só pode anexar a foto dos pedidos direcionados.",
            )
    status_anterior = caso.status

    content = await arquivo.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Arquivo muito grande. Máximo: 50MB")

    ext = Path(arquivo.filename).suffix.lower()
    if upload_foto_estoque:
        if not _arquivo_parece_imagem(arquivo.filename, arquivo.content_type, content):
            raise HTTPException(
                status_code=400,
                detail=(
                    "O anexo da sessão do Gestor de Estoque deve ser uma foto/imagem válida. "
                    "Envie um arquivo de imagem."
                ),
            )
    elif ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Extensão não permitida: {ext}")

    # Criar diretório do caso
    case_dir = os.path.join(UPLOADS_DIR, str(caso_id))
    os.makedirs(case_dir, exist_ok=True)

    # Nome único para o arquivo
    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(case_dir, unique_name)

    with open(file_path, "wb") as f:
        f.write(content)

    # Verificar se já existe documento do mesmo tipo e substituir
    existing = db.query(models.Documento).filter(
        models.Documento.case_id == caso_id,
        models.Documento.tipo_documento == tipo_documento
    ).first()
    substituiu_documento = existing is not None
    documento_substituido_snapshot = None
    if existing:
        assinaturas_removidas = _remover_assinaturas_documento(existing.id, db)
        documento_substituido_snapshot = {
            "id": existing.id,
            "tipo_documento": existing.tipo_documento,
            "nome_arquivo": existing.nome_arquivo,
            "mime_type": existing.mime_type,
            "tamanho_bytes": existing.tamanho_bytes,
            "data_upload": existing.data_upload,
            "path_arquivo": existing.path_arquivo,
            "qtd_assinaturas_documento_removidas": len(assinaturas_removidas),
            "assinaturas_documento_removidas": assinaturas_removidas,
        }
        if os.path.exists(existing.path_arquivo):
            os.remove(existing.path_arquivo)
        _remover_backup_pdf_original(existing.path_arquivo)
        db.delete(existing)
        db.flush()

    doc = models.Documento(
        case_id=caso_id,
        tipo_documento=tipo_documento,
        nome_arquivo=arquivo.filename,
        path_arquivo=file_path,
        mime_type=_resolver_mime_type(arquivo.filename, file_path, arquivo.content_type),
        tamanho_bytes=len(content)
    )
    db.add(doc)
    db.flush()
    registrar_evento_auditoria(
        db,
        acao="documento_anexado" if not substituiu_documento else "documento_substituido",
        modulo="casos_documentos",
        descricao=(
            f"Documento '{tipo_documento}' anexado no caso {_codigo_caso(caso)}."
            if not substituiu_documento
            else f"Documento '{tipo_documento}' substituído no caso {_codigo_caso(caso)}."
        ),
        usuario=current_user,
        case_id=caso_id,
        entidade="documento",
        entidade_id=doc.id,
        detalhes={
            "nome_arquivo": doc.nome_arquivo,
            "tipo_documento": tipo_documento,
            "tamanho_bytes": doc.tamanho_bytes,
            "status_antes_upload": status_anterior,
            "documento_substituido": documento_substituido_snapshot,
        },
    )
    _notificar_operacao_todos(
        db,
        tipo="operacao_documento_substituido" if substituiu_documento else "operacao_documento_anexado",
        titulo="Documento atualizado na esteira" if substituiu_documento else "Documento anexado na esteira",
        mensagem=(
            f"{_nome_usuario(current_user)} {'substituiu' if substituiu_documento else 'anexou'} "
            f"'{tipo_documento}' em {_codigo_caso(caso)} (arquivo: {doc.nome_arquivo})."
        ),
        case_id=caso_id,
    )

    # Atualizar status para assinatura do gerente de pós-venda ao atingir documentação mínima
    db.commit()
    db.refresh(doc)
    caso_refreshed = _load_caso(caso_id, db)
    status_pos_upload = caso_refreshed.status
    if _check_docs_completos(caso_refreshed):
        if status_pos_upload == STATUS_AGUARDANDO_DOCUMENTOS:
            caso_refreshed.status = STATUS_AGUARDANDO_POS_VENDA
            codigo = _codigo_caso(caso_refreshed)
            _notificar_papel(
                db,
                papel="gerente_pos_venda",
                tipo="novo_caso_pos_venda",
                titulo="Solicitação pronta para assinatura do Pós-venda",
                mensagem=(
                    f"{current_user.nome or 'Time Oficina'} anexou remessa(s) do {codigo}. "
                    "Aguardando assinatura do Gerente de Pós-venda."
                ),
                case_id=caso_refreshed.id,
            )
            _notificar_operacao_todos(
                db,
                tipo="operacao_fluxo_movido",
                titulo="Caso avançou na esteira",
                mensagem=(
                    f"{codigo} avançou de '{status_pos_upload}' para "
                    f"'{STATUS_AGUARDANDO_POS_VENDA}' após anexação de remessa."
                ),
                case_id=caso_refreshed.id,
            )
            registrar_evento_auditoria(
                db,
                acao="caso_movido_para_pos_venda",
                modulo="casos_fluxo",
                descricao=f"Caso {codigo} avançou para assinatura do Pós-venda.",
                usuario=current_user,
                case_id=caso_refreshed.id,
                entidade="caso_garantia",
                entidade_id=caso_refreshed.id,
                detalhes={"status_de": status_pos_upload, "status_para": caso_refreshed.status},
            )
            db.commit()
    elif status_pos_upload == STATUS_AGUARDANDO_POS_VENDA:
        caso_refreshed.status = STATUS_AGUARDANDO_DOCUMENTOS
        _notificar_operacao_todos(
            db,
            tipo="operacao_fluxo_retrocedido",
            titulo="Caso retornou etapa anterior",
            mensagem=(
                f"{_codigo_caso(caso_refreshed)} retornou de '{status_pos_upload}' para "
                f"'{STATUS_AGUARDANDO_DOCUMENTOS}' após atualização de documentos."
            ),
            case_id=caso_refreshed.id,
        )
        registrar_evento_auditoria(
            db,
            acao="caso_retrocedido_para_documentos",
            modulo="casos_fluxo",
            descricao=f"Caso {_codigo_caso(caso_refreshed)} voltou para etapa de documentos.",
            usuario=current_user,
            case_id=caso_refreshed.id,
            entidade="caso_garantia",
            entidade_id=caso_refreshed.id,
            detalhes={"status_de": status_pos_upload, "status_para": caso_refreshed.status},
        )
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
    disposition: str = Query("attachment", pattern="^(inline|attachment)$"),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user_download)
):
    _load_caso(caso_id, db)
    doc = db.query(models.Documento).filter(
        models.Documento.id == doc_id,
        models.Documento.case_id == caso_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    if not os.path.exists(doc.path_arquivo):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado no servidor")

    # Para PDFs assinados, anexar uma página com as assinaturas capturadas
    ext = Path(doc.path_arquivo).suffix.lower()
    if ext == ".pdf":
        assinaturas = (
            db.query(models.DocumentoAssinatura)
            .options(joinedload(models.DocumentoAssinatura.usuario))
            .filter(
                models.DocumentoAssinatura.case_id == caso_id,
                models.DocumentoAssinatura.documento_id == doc_id,
            )
            .order_by(models.DocumentoAssinatura.data_assinatura.asc())
            .all()
        )
        if assinaturas:
            pdf_fonte = _obter_fonte_pdf(doc.path_arquivo)
            try:
                pdf_assinado_bytes = _carimbar_assinaturas_no_pdf_documento(
                    doc,
                    assinaturas,
                    source_path=pdf_fonte,
                )
            except Exception:
                try:
                    # Fallback: mantém o documento original + página de assinaturas.
                    pdf_assinado_bytes = _gerar_pdf_com_pagina_assinaturas(
                        doc,
                        assinaturas,
                        source_path=pdf_fonte,
                    )
                except Exception as exc:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Falha ao gerar PDF assinado para download: {exc}",
                    ) from exc
            registrar_evento_auditoria(
                db,
                acao="documento_baixado",
                modulo="casos_documentos",
                descricao=f"Documento {doc.nome_arquivo} baixado.",
                usuario=current_user,
                case_id=caso_id,
                entidade="documento",
                entidade_id=doc.id,
            )
            db.commit()
            return Response(
                content=pdf_assinado_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": _content_disposition(doc.nome_arquivo, disposition)},
            )

    registrar_evento_auditoria(
        db,
        acao="documento_baixado",
        modulo="casos_documentos",
        descricao=f"Documento {doc.nome_arquivo} baixado.",
        usuario=current_user,
        case_id=caso_id,
        entidade="documento",
        entidade_id=doc.id,
    )
    db.commit()
    media_type = _resolver_mime_type(doc.nome_arquivo, doc.path_arquivo, doc.mime_type)
    return FileResponse(
        doc.path_arquivo,
        media_type=media_type,
        headers={"Content-Disposition": _content_disposition(doc.nome_arquivo, disposition)},
    )


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

    if not _documento_exige_assinatura(doc):
        raise HTTPException(
            status_code=400,
            detail="Somente documentos de Remessa (DRONEPRO/HUADA) participam da assinatura documental.",
        )

    assinatura_origem = "canvas"
    if body.usar_assinatura_salva:
        try:
            assinatura_bytes = carregar_assinatura_usuario_bytes(current_user)
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=400,
                detail="Nenhuma assinatura salva encontrada no seu perfil. Desenhe e salve uma assinatura primeiro.",
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Assinatura salva inválida: {exc}",
            ) from exc
        assinatura_origem = "assinatura_salva"
    else:
        try:
            assinatura_bytes = decode_signature_data_url(body.assinatura_data_url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.salvar_assinatura_usuario:
        try:
            salvar_assinatura_usuario(current_user, assinatura_bytes, UPLOADS_DIR)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        registrar_evento_auditoria(
            db,
            acao="assinatura_padrao_salva_via_fluxo",
            modulo="assinaturas",
            descricao=f"Assinatura padrão salva por {_nome_usuario(current_user)} durante assinatura de documento.",
            usuario=current_user,
            case_id=caso_id,
            entidade="usuario",
            entidade_id=current_user.id,
        )

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
    db.flush()

    ext = Path(doc.path_arquivo).suffix.lower() if doc.path_arquivo else ""
    if ext == ".pdf":
        assinaturas_doc = (
            db.query(models.DocumentoAssinatura)
            .options(joinedload(models.DocumentoAssinatura.usuario))
            .filter(
                models.DocumentoAssinatura.case_id == caso_id,
                models.DocumentoAssinatura.documento_id == doc_id,
            )
            .order_by(models.DocumentoAssinatura.data_assinatura.asc())
            .all()
        )
        try:
            _persistir_pdf_assinado_documento(doc, assinaturas_doc)
        except Exception as exc:
            db.rollback()
            if os.path.exists(assinatura_path):
                try:
                    os.remove(assinatura_path)
                except OSError:
                    pass
            raise HTTPException(
                status_code=500,
                detail=f"Falha ao persistir assinatura no documento PDF: {exc}",
            ) from exc

    registrar_evento_auditoria(
        db,
        acao="assinatura_documento_registrada",
        modulo="assinaturas",
        descricao=(
            f"Assinatura de {etapa} registrada no documento {doc.nome_arquivo} "
            f"do caso {_codigo_caso(caso)}."
        ),
        usuario=current_user,
        case_id=caso_id,
        entidade="documento_assinatura",
        entidade_id=assinatura.id,
        detalhes={
            "documento_id": doc.id,
            "documento_nome": doc.nome_arquivo,
            "etapa_fluxo": etapa,
            "assinatura_substituida": existing is not None,
            "assinatura_origem": assinatura_origem,
            "assinatura_salva_no_perfil": bool(body.salvar_assinatura_usuario),
        },
    )
    _notificar_operacao_todos(
        db,
        tipo="operacao_documento_assinado",
        titulo="Documento assinado na esteira",
        mensagem=(
            f"{_nome_usuario(current_user)} assinou '{doc.nome_arquivo}' "
            f"na etapa {etapa} do {_codigo_caso(caso)}."
        ),
        case_id=caso_id,
    )
    db.commit()
    db.refresh(assinatura)
    return assinatura


@router.delete("/{caso_id}/documentos/{doc_id}")
def deletar_documento(
    caso_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador", "gestor_estoque"))
):
    caso = _load_caso(caso_id, db)
    doc = db.query(models.Documento).filter(
        models.Documento.id == doc_id,
        models.Documento.case_id == caso_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    if _documento_foto_pedido_estoque(doc):
        if current_user.papel not in {"gestor_estoque", "admin"}:
            raise HTTPException(
                status_code=400,
                detail="Somente o Gestor de Estoque pode remover a foto dos pedidos nesta etapa.",
            )
        if caso.status not in STATUS_ETAPA_ESTOQUE_COMPAT:
            raise HTTPException(
                status_code=400,
                detail="A foto dos pedidos só pode ser gerenciada durante a etapa do Gestor de Estoque.",
            )
    if caso.status in STATUS_BLOQUEIA_EDICAO:
        permitido_estoque = (
            caso.status in STATUS_ETAPA_ESTOQUE_COMPAT
            and current_user.papel in {"gestor_estoque", "admin"}
            and _documento_foto_pedido_estoque(doc)
        )
        if not permitido_estoque:
            raise HTTPException(status_code=400, detail="Caso em etapa final.")
    status_anterior = caso.status

    assinaturas_removidas = _remover_assinaturas_documento(doc.id, db)

    if os.path.exists(doc.path_arquivo):
        os.remove(doc.path_arquivo)
    _remover_backup_pdf_original(doc.path_arquivo)
    doc_nome = doc.nome_arquivo
    doc_tipo = doc.tipo_documento
    doc_id_real = doc.id
    db.delete(doc)
    db.flush()

    # Regressar status se remover documento obrigatório mínimo (remessas DronePro/Huada)
    caso_db = _load_caso(caso_id, db)
    if caso_db.status != "Reprovado" and not _check_docs_completos(caso_db):
        caso_db.status = STATUS_AGUARDANDO_DOCUMENTOS

    registrar_evento_auditoria(
        db,
        acao="documento_excluido",
        modulo="casos_documentos",
        descricao=f"Documento '{doc_tipo}' removido do caso {_codigo_caso(caso_db)}.",
        usuario=current_user,
        case_id=caso_id,
        entidade="documento",
        entidade_id=doc_id_real,
        detalhes={
            "nome_arquivo": doc_nome,
            "tipo_documento": doc_tipo,
            "status_de": status_anterior,
            "status_para": caso_db.status,
            "qtd_assinaturas_documento_removidas": len(assinaturas_removidas),
            "assinaturas_documento_removidas": assinaturas_removidas,
        },
    )
    _notificar_operacao_todos(
        db,
        tipo="operacao_documento_excluido",
        titulo="Documento removido da esteira",
        mensagem=(
            f"{_nome_usuario(current_user)} removeu '{doc_tipo}' de {_codigo_caso(caso_db)}. "
            f"Status: {status_anterior} -> {caso_db.status}."
        ),
        case_id=caso_id,
    )

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
    status_anterior = caso.status

    if body.status_decisao not in ["Aprovado", "Reprovado"]:
        raise HTTPException(status_code=400, detail="Decisão inválida. Use: Aprovado | Reprovado")

    etapa = _resolver_etapa_assinatura(caso, current_user)
    _validar_assinaturas_documentos(caso, etapa, current_user.id)

    # Registrar assinatura (idempotente por usuário/etapa)
    assinatura = db.query(models.Assinatura).filter(
        models.Assinatura.case_id == caso_id,
        models.Assinatura.usuario_id == current_user.id,
        models.Assinatura.etapa_fluxo == etapa,
    ).first()
    if assinatura:
        assinatura.status_decisao = body.status_decisao
        assinatura.observacao = body.observacao
        assinatura.data_assinatura = datetime.utcnow()
    else:
        assinatura = models.Assinatura(
            case_id=caso_id,
            usuario_id=current_user.id,
            etapa_fluxo=etapa,
            status_decisao=body.status_decisao,
            observacao=body.observacao,
            data_assinatura=datetime.utcnow()
        )
        db.add(assinatura)
    db.flush()

    # Atualizar status do caso
    caso_db = db.query(models.CasoGarantia).filter(models.CasoGarantia.id == caso_id).first()
    codigo = _codigo_caso(caso)

    if body.status_decisao == "Reprovado":
        caso_db.status = "Reprovado"
    elif etapa == "Pos-venda":
        caso_db.status = STATUS_AGUARDANDO_DIRETORIA
        _notificar_papel(
            db,
            papel="diretor_comercial",
            tipo="pendencia_assinatura_diretoria",
            titulo="Assinatura pendente: Diretoria Comercial",
            mensagem=(
                f"{codigo} foi aprovado pelo Gerente de Pós-venda. "
                "Aguardando assinatura do Diretor Comercial para continuidade da esteira."
            ),
            case_id=caso_id,
        )
    elif etapa == "Diretoria":
        _validar_documentos_assinados_por_etapas(
            caso,
            ["Pos-venda", "Diretoria"],
            "aprovação final da diretoria",
        )
        caso_db.status = STATUS_AGUARDANDO_ESTOQUE
        caso_db.status_rebate = "Aguardando Apuração"
        _notificar_papel(
            db,
            papel="gestor_estoque",
            tipo="pendencia_assinatura_estoque",
            titulo="Assinatura pendente: Gestor de Estoque",
            mensagem=(
                f"{codigo} recebeu as assinaturas de Pós-venda e Diretoria Comercial. "
                "Aguardando conferência do Gestor de Estoque com anexo da foto dos pedidos e assinatura final."
            ),
            case_id=caso_id,
        )
    elif etapa == "Estoque":
        _validar_documentos_assinados_por_etapas(
            caso,
            ["Pos-venda", "Diretoria", "Estoque"],
            "conclusão do gestor de estoque",
        )
        if not _check_foto_pedido_estoque(caso):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Fluxo bloqueado para conclusão. "
                    "Anexe a foto dos pedidos direcionados pelo estoque antes de confirmar."
                ),
            )
        caso_db.status = "Finalizado"
        caso_db.status_rebate = "Finalizado"
        _notificar_papel(
            db,
            papel="operador",
            tipo="caso_finalizado_estoque",
            titulo="Caso concluído pelo Gestor de Estoque",
            mensagem=(
                f"{codigo} foi concluído pelo Gestor de Estoque com foto dos pedidos e assinatura final."
            ),
            case_id=caso_id,
        )

    registrar_evento_auditoria(
        db,
        acao="caso_assinado",
        modulo="assinaturas",
        descricao=(
            f"{current_user.nome} registrou decisão '{body.status_decisao}' "
            f"na etapa {etapa} do caso {codigo}."
        ),
        usuario=current_user,
        case_id=caso_id,
        entidade="assinatura_caso",
        entidade_id=assinatura.id if assinatura and assinatura.id else None,
        detalhes={
            "etapa_fluxo": etapa,
            "decisao": body.status_decisao,
            "observacao": body.observacao,
            "status_de": status_anterior,
            "status_para": caso_db.status,
        },
    )
    if body.status_decisao == "Reprovado":
        _notificar_operacao_todos(
            db,
            tipo="operacao_caso_reprovado",
            titulo="Caso reprovado na esteira",
            mensagem=(
                f"{_nome_usuario(current_user)} reprovou {codigo} na etapa {etapa}. "
                f"Status: {status_anterior} -> {caso_db.status}."
            ),
            case_id=caso_id,
        )
    else:
        tipo_notificacao = "operacao_caso_assinado"
        titulo_notificacao = "Assinatura de etapa registrada"
        if caso_db.status == "Finalizado":
            tipo_notificacao = "operacao_caso_finalizado"
            titulo_notificacao = "Caso finalizado na esteira"
        elif status_anterior != caso_db.status:
            tipo_notificacao = "operacao_fluxo_movido"
            titulo_notificacao = "Caso avançou na esteira"
        _notificar_operacao_todos(
            db,
            tipo=tipo_notificacao,
            titulo=titulo_notificacao,
            mensagem=(
                f"{_nome_usuario(current_user)} aprovou {codigo} na etapa {etapa}. "
                f"Status: {status_anterior} -> {caso_db.status}."
            ),
            case_id=caso_id,
        )

    db.commit()

    # Compilar PDF após etapas-chave do fluxo (diretoria, estoque e finalização).
    caso_final = _load_caso(caso_id, db)
    if caso_final.status in {STATUS_AGUARDANDO_ESTOQUE, STATUS_AGUARDANDO_IMPRESSAO, "Finalizado"}:
        try:
            _compilar_pdf(caso_final, db)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"A aprovação foi registrada, mas houve erro ao compilar o dossiê PDF: {exc}"
            ) from exc

    return _load_caso(caso_id, db)


@router.post("/{caso_id}/confirmar-impressao", response_model=schemas.CasoOut)
def confirmar_impressao_oficina(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    """Confirma impressão em 3 vias pela oficina e encerra o caso."""
    caso = _load_caso(caso_id, db)
    status_anterior = caso.status
    if caso.status != STATUS_AGUARDANDO_IMPRESSAO:
        raise HTTPException(
            status_code=400,
            detail=f"Caso não está aguardando impressão da oficina. Status atual: {caso.status}"
        )

    _validar_documentos_assinados_por_etapas(
        caso,
        ["Pos-venda", "Diretoria", "Estoque"],
        "impressão e finalização",
    )
    if not _check_foto_pedido_estoque(caso):
        raise HTTPException(
            status_code=400,
            detail=(
                "Fluxo bloqueado para finalização. "
                "Anexe a foto dos pedidos direcionados pelo estoque antes da impressão final."
            ),
        )

    try:
        pdf_path = _compilar_pdf(caso, db)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Não foi possível finalizar: falha ao gerar dossiê PDF. {exc}"
        ) from exc
    if not pdf_path or not os.path.exists(pdf_path):
        raise HTTPException(
            status_code=500,
            detail="Não foi possível finalizar: dossiê PDF não encontrado após compilação."
        )

    caso_db = db.query(models.CasoGarantia).filter(models.CasoGarantia.id == caso_id).first()
    caso_db.status = "Finalizado"
    caso_db.atualizado_em = datetime.utcnow()
    caso_db.status_rebate = "Finalizado"
    registrar_evento_auditoria(
        db,
        acao="caso_finalizado_impressao",
        modulo="casos_fluxo",
        descricao=f"Caso {_codigo_caso(caso)} impresso e finalizado pela oficina.",
        usuario=current_user,
        case_id=caso_id,
        entidade="caso_garantia",
        entidade_id=caso_id,
        detalhes={
            "status_de": status_anterior,
            "status_para": caso_db.status,
            "status_rebate_para": caso_db.status_rebate,
            "pdf_compilado_path": pdf_path,
        },
    )
    _notificar_operacao_todos(
        db,
        tipo="operacao_caso_finalizado",
        titulo="Caso finalizado pela oficina",
        mensagem=(
            f"{_nome_usuario(current_user)} finalizou {_codigo_caso(caso)} "
            "após confirmação de impressão em 3 vias."
        ),
        case_id=caso_id,
    )
    db.commit()

    return _load_caso(caso_id, db)


@router.post("/{caso_id}/compilar-pdf")
def compilar_pdf_manual(
    caso_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador"))
):
    """Recompila o PDF do dossiê manualmente."""
    caso = _load_caso(caso_id, db)
    if caso.status in {STATUS_AGUARDANDO_ESTOQUE, STATUS_AGUARDANDO_IMPRESSAO, "Finalizado"}:
        _validar_documentos_assinados_por_etapas(
            caso,
            _etapas_requeridas_para_dossie(caso),
            "compilação do dossiê final",
        )
    try:
        result_path = _compilar_pdf(caso, db)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao compilar PDF: {exc}") from exc
    registrar_evento_auditoria(
        db,
        acao="dossie_recompilado_manual",
        modulo="casos_pdf",
        descricao=f"Dossiê do caso {_codigo_caso(caso)} recompilado manualmente.",
        usuario=current_user,
        case_id=caso.id,
        entidade="caso_garantia",
        entidade_id=caso.id,
        detalhes={"pdf_compilado_path": result_path},
    )
    _notificar_operacao_todos(
        db,
        tipo="operacao_pdf_recompilado",
        titulo="Dossiê recompilado",
        mensagem=(
            f"{_nome_usuario(current_user)} recompilou o dossiê de {_codigo_caso(caso)}."
        ),
        case_id=caso.id,
    )
    db.commit()
    return {"message": "PDF compilado com sucesso", "path": result_path}


@router.get("/{caso_id}/pdf")
def download_pdf_compilado(
    caso_id: int,
    disposition: str = Query("attachment", pattern="^(inline|attachment)$"),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user_download)
):
    caso = _load_caso(caso_id, db)
    if caso.status in {STATUS_AGUARDANDO_ESTOQUE, STATUS_AGUARDANDO_IMPRESSAO, "Finalizado"}:
        _validar_documentos_assinados_por_etapas(
            caso,
            _etapas_requeridas_para_dossie(caso),
            "download do dossiê final",
        )
        try:
            _compilar_pdf(caso, db)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=f"Falha ao gerar dossiê atualizado: {exc}") from exc
        caso = _load_caso(caso_id, db)

    if not caso.link_pdf_compilado or not os.path.exists(caso.link_pdf_compilado):
        raise HTTPException(status_code=404, detail="PDF compilado não disponível")
    registrar_evento_auditoria(
        db,
        acao="dossie_baixado",
        modulo="casos_pdf",
        descricao=f"Dossiê compilado do caso {_codigo_caso(caso)} baixado.",
        usuario=current_user,
        case_id=caso.id,
        entidade="caso_garantia",
        entidade_id=caso.id,
        detalhes={"pdf_compilado_path": caso.link_pdf_compilado},
    )
    db.commit()
    filename = f"dossie_garantia_{caso.dji_case_id or caso.id}.pdf"
    return FileResponse(
        caso.link_pdf_compilado,
        media_type="application/pdf",
        headers={"Content-Disposition": _content_disposition(filename, disposition)},
    )


# ─── Helpers Internos ─────────────────────────────────────────────────────────

def _compilar_pdf(caso: models.CasoGarantia, db: Session) -> str:
    """Compila o PDF do dossiê e atualiza o campo link_pdf_compilado."""
    try:
        caso = _load_caso(caso.id, db)
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
                    "data_assinatura_formatada": _fmt_data_hora_br(sig.data_assinatura),
                    "usuario_nome": sig.usuario.nome if sig.usuario else None
                }
                for sig in caso.assinaturas
            ],
            "documentos": [
                {"tipo_documento": d.tipo_documento, "nome_arquivo": d.nome_arquivo}
                for d in caso.documentos
            ]
        }

        assinaturas_por_documento: dict[int, List[models.DocumentoAssinatura]] = {}
        for assinatura_doc in (caso.documento_assinaturas or []):
            assinaturas_por_documento.setdefault(assinatura_doc.documento_id, []).append(assinatura_doc)

        document_paths = []
        for d in caso.documentos:
            doc_info = {
                "path_arquivo": d.path_arquivo,
                "tipo_documento": d.tipo_documento,
                "nome_arquivo": d.nome_arquivo,
            }
            ext = Path(d.path_arquivo).suffix.lower() if d.path_arquivo else ""
            if ext == ".pdf":
                assinaturas_doc = assinaturas_por_documento.get(d.id, [])
                if assinaturas_doc:
                    pdf_fonte = _obter_fonte_pdf(d.path_arquivo)
                    try:
                        doc_info["pdf_bytes"] = _carimbar_assinaturas_no_pdf_documento(
                            d,
                            assinaturas_doc,
                            source_path=pdf_fonte,
                        )
                    except Exception:
                        doc_info["pdf_bytes"] = _gerar_pdf_com_pagina_assinaturas(
                            d,
                            assinaturas_doc,
                            source_path=pdf_fonte,
                        )
            document_paths.append(doc_info)

        output_path = os.path.join(COMPILED_DIR, f"caso_{caso.id}_dossie.pdf")
        result = compile_pdf(caso_data, document_paths, output_path)
        if not result or not os.path.exists(result):
            raise RuntimeError("Arquivo de saída do PDF não foi gerado.")

        # Atualizar link no banco
        caso_db = db.query(models.CasoGarantia).filter(models.CasoGarantia.id == caso.id).first()
        if caso_db:
            caso_db.link_pdf_compilado = result
            db.commit()
        return result
    except Exception as e:
        db.rollback()
        raise RuntimeError(f"Falha ao compilar PDF do caso {caso.id}: {e}") from e
