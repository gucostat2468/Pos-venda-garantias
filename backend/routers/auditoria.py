from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy import text
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from auth import require_roles
from database import get_db

router = APIRouter()


def _aplicar_filtros_base(
    q,
    *,
    case_id: Optional[int],
    usuario_id: Optional[int],
    modulo: Optional[str],
    acao: Optional[str],
    status: Optional[str],
    dias: int,
):
    if case_id:
        q = q.filter(models.AuditoriaEvento.case_id == case_id)
    if usuario_id:
        q = q.filter(models.AuditoriaEvento.usuario_id == usuario_id)
    if modulo:
        q = q.filter(models.AuditoriaEvento.modulo == modulo)
    if acao:
        q = q.filter(models.AuditoriaEvento.acao == acao)
    if status:
        q = q.filter(models.AuditoriaEvento.status == status)
    if dias > 0:
        limite_data = datetime.utcnow() - timedelta(days=dias)
        q = q.filter(models.AuditoriaEvento.criado_em >= limite_data)
    return q


@router.get("/", response_model=List[schemas.AuditoriaEventoOut])
def listar_eventos_auditoria(
    case_id: Optional[int] = Query(None),
    usuario_id: Optional[int] = Query(None),
    modulo: Optional[str] = Query(None),
    acao: Optional[str] = Query(None),
    status: Optional[str] = Query(None, pattern="^(sucesso|falha)$"),
    dias: int = Query(0, ge=0, le=3650),
    limite: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "gerente_pos_venda", "diretor_comercial")),
):
    q = db.query(models.AuditoriaEvento).options(
        joinedload(models.AuditoriaEvento.usuario)
    )
    q = _aplicar_filtros_base(
        q,
        case_id=case_id,
        usuario_id=usuario_id,
        modulo=modulo,
        acao=acao,
        status=status,
        dias=dias,
    )
    return (
        q.order_by(models.AuditoriaEvento.criado_em.desc(), models.AuditoriaEvento.id.desc())
        .offset(offset)
        .limit(limite)
        .all()
    )


@router.get("/resumo", response_model=schemas.AuditoriaResumoOut)
def resumo_auditoria(
    case_id: Optional[int] = Query(None),
    usuario_id: Optional[int] = Query(None),
    modulo: Optional[str] = Query(None),
    acao: Optional[str] = Query(None),
    dias: int = Query(0, ge=0, le=3650),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "gerente_pos_venda", "diretor_comercial")),
):
    base_q = db.query(models.AuditoriaEvento)
    base_q = _aplicar_filtros_base(
        base_q,
        case_id=case_id,
        usuario_id=usuario_id,
        modulo=modulo,
        acao=acao,
        status=None,
        dias=dias,
    )

    total = base_q.count()
    total_sucesso = base_q.filter(models.AuditoriaEvento.status == "sucesso").count()
    total_falha = base_q.filter(models.AuditoriaEvento.status == "falha").count()

    por_modulo_rows = (
        base_q.with_entities(models.AuditoriaEvento.modulo, func.count(models.AuditoriaEvento.id))
        .group_by(models.AuditoriaEvento.modulo)
        .all()
    )
    por_acao_rows = (
        base_q.with_entities(models.AuditoriaEvento.acao, func.count(models.AuditoriaEvento.id))
        .group_by(models.AuditoriaEvento.acao)
        .all()
    )

    ultimo_evento_em = (
        base_q.with_entities(func.max(models.AuditoriaEvento.criado_em))
        .scalar()
    )

    por_modulo: Dict[str, int] = {str(mod): int(qtd) for mod, qtd in por_modulo_rows if mod}
    por_acao: Dict[str, int] = {str(ac): int(qtd) for ac, qtd in por_acao_rows if ac}

    return {
        "total": total,
        "total_sucesso": total_sucesso,
        "total_falha": total_falha,
        "por_modulo": por_modulo,
        "por_acao": por_acao,
        "ultimo_evento_em": ultimo_evento_em,
    }


@router.get("/integridade")
def integridade_auditoria(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin", "gerente_pos_venda", "diretor_comercial")),
):
    total_eventos = db.query(models.AuditoriaEvento).count()
    primeiro_evento_em = db.query(func.min(models.AuditoriaEvento.criado_em)).scalar()
    ultimo_evento_em = db.query(func.max(models.AuditoriaEvento.criado_em)).scalar()

    db_dialect = db.bind.dialect.name if db.bind is not None else "desconhecido"
    quick_check = "indisponivel"
    append_only_protegido = False
    triggers_presentes: List[str] = []

    if db_dialect == "sqlite":
        quick_check_row = db.execute(text("PRAGMA quick_check")).fetchone()
        quick_check = str(quick_check_row[0]) if quick_check_row else "erro"
        trigger_rows = db.execute(
            text(
                """
                SELECT name
                FROM sqlite_master
                WHERE type='trigger'
                  AND name IN ('trg_auditoria_eventos_block_update', 'trg_auditoria_eventos_block_delete')
                ORDER BY name
                """
            )
        ).fetchall()
        triggers_presentes = [str(row[0]) for row in trigger_rows]
        append_only_protegido = {
            "trg_auditoria_eventos_block_update",
            "trg_auditoria_eventos_block_delete",
        }.issubset(set(triggers_presentes))

    return {
        "db_dialect": db_dialect,
        "quick_check": quick_check,
        "auditoria_append_only_protegido": append_only_protegido,
        "triggers_auditoria_presentes": triggers_presentes,
        "total_eventos": total_eventos,
        "primeiro_evento_em": primeiro_evento_em,
        "ultimo_evento_em": ultimo_evento_em,
    }
