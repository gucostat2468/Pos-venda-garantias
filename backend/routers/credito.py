import hashlib
import mimetypes
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from auth import get_current_user, get_current_user_download, require_roles
from database import get_db
from services.credito_ingest import sync_credito_files_to_db
from services.credito_reconcile import reconcile_credito_to_cases
from services.auditoria import registrar_evento_auditoria


router = APIRouter()

BASE_DIR = Path(__file__).resolve().parents[1]
CREDITO_DIR = BASE_DIR / "credito"


def _safe_relative_path(path_value: str) -> Path:
    posix_path = PurePosixPath(path_value)
    if posix_path.is_absolute() or ".." in posix_path.parts:
        raise HTTPException(status_code=400, detail="Caminho invalido")
    return Path(*posix_path.parts)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _content_disposition(filename: str, disposition: str) -> str:
    safe_name = (filename or "arquivo").replace('"', "")
    encoded_name = quote(safe_name)
    return f"{disposition}; filename=\"{safe_name}\"; filename*=UTF-8''{encoded_name}"


@router.get("/", response_model=List[schemas.CreditoArquivoOut])
def listar_arquivos_credito(
    current_user: models.Usuario = Depends(get_current_user),
):
    if not CREDITO_DIR.exists():
        return []

    arquivos: List[schemas.CreditoArquivoOut] = []
    for path in sorted(CREDITO_DIR.rglob("*")):
        if not path.is_file():
            continue
        if path.name.lower() == "manifest.json":
            continue
        stat = path.stat()
        arquivos.append(
            schemas.CreditoArquivoOut(
                nome_arquivo=path.name,
                caminho_relativo=path.relative_to(CREDITO_DIR).as_posix(),
                tamanho_bytes=stat.st_size,
                sha256=_sha256_file(path),
                atualizado_em=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            )
        )
    return arquivos


@router.post("/sync")
def sincronizar_planilhas_credito(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador")),
):
    sync_summary = sync_credito_files_to_db(db, CREDITO_DIR)
    reconcile_summary = reconcile_credito_to_cases(db)
    registrar_evento_auditoria(
        db,
        acao="credito_sync",
        modulo="credito",
        descricao="Sincronização de planilhas de crédito executada.",
        usuario=current_user,
        entidade="credito",
        detalhes={
            "sync": sync_summary,
            "reconciliacao": reconcile_summary,
        },
    )
    db.commit()
    return {
        "sync": sync_summary,
        "reconciliacao": reconcile_summary,
    }


@router.post("/reconciliar")
def reconciliar_credito_com_casos(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "operador")),
):
    reconcile_summary = reconcile_credito_to_cases(db)
    registrar_evento_auditoria(
        db,
        acao="credito_reconciliacao",
        modulo="credito",
        descricao="Reconciliação de crédito com casos executada.",
        usuario=current_user,
        entidade="credito",
        detalhes={"reconciliacao": reconcile_summary},
    )
    db.commit()
    return reconcile_summary


@router.get("/extratos", response_model=List[schemas.CreditoExtratoOut])
def listar_extratos_credito(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    extratos = (
        db.query(models.CreditoExtrato)
        .options(joinedload(models.CreditoExtrato.lancamentos))
        .order_by(
            models.CreditoExtrato.competencia_ano.desc(),
            models.CreditoExtrato.competencia_mes.desc(),
            models.CreditoExtrato.importado_em.desc(),
        )
        .all()
    )
    for ext in extratos:
        ext.lancamentos = sorted(ext.lancamentos, key=lambda x: (x.linha_planilha, x.id))
    return extratos


@router.get("/extratos/{extrato_id}", response_model=schemas.CreditoExtratoOut)
def obter_extrato_credito(
    extrato_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    extrato = (
        db.query(models.CreditoExtrato)
        .options(joinedload(models.CreditoExtrato.lancamentos))
        .filter(models.CreditoExtrato.id == extrato_id)
        .first()
    )
    if not extrato:
        raise HTTPException(status_code=404, detail="Extrato de credito nao encontrado")
    extrato.lancamentos = sorted(extrato.lancamentos, key=lambda x: (x.linha_planilha, x.id))
    return extrato


@router.get("/cliente-vinculos", response_model=List[schemas.CreditoClienteVinculoOut])
def listar_vinculos_cliente_credito(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    return (
        db.query(models.CreditoClienteVinculo)
        .options(
            joinedload(models.CreditoClienteVinculo.cliente),
            joinedload(models.CreditoClienteVinculo.extrato),
        )
        .order_by(models.CreditoClienteVinculo.criado_em.desc())
        .all()
    )


@router.get("/caso-vinculos", response_model=List[schemas.CreditoCasoVinculoOut])
def listar_vinculos_caso_credito(
    caso_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    q = (
        db.query(models.CreditoCasoVinculo)
        .options(
            joinedload(models.CreditoCasoVinculo.extrato),
            joinedload(models.CreditoCasoVinculo.lancamento),
        )
        .order_by(models.CreditoCasoVinculo.criado_em.desc())
    )
    if caso_id:
        q = q.filter(models.CreditoCasoVinculo.caso_id == caso_id)
    return q.all()


@router.get("/extratos/{extrato_id}/lancamentos", response_model=List[schemas.CreditoLancamentoOut])
def listar_lancamentos_credito(
    extrato_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    extrato = db.query(models.CreditoExtrato.id).filter(models.CreditoExtrato.id == extrato_id).first()
    if not extrato:
        raise HTTPException(status_code=404, detail="Extrato de credito nao encontrado")

    return (
        db.query(models.CreditoLancamento)
        .filter(models.CreditoLancamento.extrato_id == extrato_id)
        .order_by(models.CreditoLancamento.linha_planilha.asc(), models.CreditoLancamento.id.asc())
        .all()
    )


@router.get("/{arquivo_path:path}/download")
def download_arquivo_credito(
    arquivo_path: str,
    disposition: str = Query("attachment", pattern="^(inline|attachment)$"),
    current_user: models.Usuario = Depends(get_current_user_download),
):
    rel = _safe_relative_path(arquivo_path)
    full_path = CREDITO_DIR / rel
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="Arquivo nao encontrado")

    media_type = mimetypes.guess_type(full_path.name)[0] or "application/octet-stream"
    return FileResponse(
        path=str(full_path),
        media_type=media_type,
        headers={"Content-Disposition": _content_disposition(full_path.name, disposition)},
    )
