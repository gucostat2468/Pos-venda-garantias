from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user
import models, schemas

router = APIRouter()


@router.get("", response_model=List[schemas.NotificacaoOut], include_in_schema=False)
@router.get("/", response_model=List[schemas.NotificacaoOut])
def listar_notificacoes(
    apenas_nao_lidas: bool = Query(False),
    limite: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    q = db.query(models.Notificacao).filter(
        models.Notificacao.usuario_id == current_user.id
    )
    if apenas_nao_lidas:
        q = q.filter(models.Notificacao.lida == 0)
    return (
        q.order_by(models.Notificacao.criado_em.desc(), models.Notificacao.id.desc())
        .limit(limite)
        .all()
    )


@router.get("/resumo", response_model=schemas.NotificacaoResumoOut)
def resumo_notificacoes(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    total = db.query(models.Notificacao).filter(
        models.Notificacao.usuario_id == current_user.id
    ).count()
    nao_lidas = db.query(models.Notificacao).filter(
        models.Notificacao.usuario_id == current_user.id,
        models.Notificacao.lida == 0,
    ).count()
    return {"total": total, "nao_lidas": nao_lidas}


@router.post("/{notificacao_id}/marcar-lida", response_model=schemas.NotificacaoOut)
def marcar_notificacao_lida(
    notificacao_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    notificacao = db.query(models.Notificacao).filter(
        models.Notificacao.id == notificacao_id,
        models.Notificacao.usuario_id == current_user.id,
    ).first()
    if not notificacao:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")

    if not notificacao.lida:
        notificacao.lida = 1
        notificacao.lida_em = datetime.utcnow()
        db.commit()
        db.refresh(notificacao)
    return notificacao


@router.post("/marcar-todas-lidas", response_model=schemas.NotificacaoMarcarTodasOut)
def marcar_todas_notificacoes_lidas(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    notificacoes = db.query(models.Notificacao).filter(
        models.Notificacao.usuario_id == current_user.id,
        models.Notificacao.lida == 0,
    ).all()

    now = datetime.utcnow()
    total = 0
    for notificacao in notificacoes:
        notificacao.lida = 1
        notificacao.lida_em = now
        total += 1

    if total:
        db.commit()

    return {"message": "Notificações atualizadas", "total": total}
