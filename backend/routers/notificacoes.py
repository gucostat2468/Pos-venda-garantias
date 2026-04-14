from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user
import models, schemas
from services.auditoria import registrar_evento_auditoria
from services.push_notifications import config_push_publico

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


@router.get("/push/config", response_model=schemas.PushConfigOut)
def push_config(
    current_user: models.Usuario = Depends(get_current_user),
):
    _ = current_user
    return config_push_publico()


@router.post("/push/subscribe", response_model=schemas.PushSubscriptionOut)
def registrar_push_subscription(
    body: schemas.PushSubscriptionRegisterIn,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    endpoint = (body.endpoint or "").strip()
    p256dh = (body.keys.p256dh or "").strip()
    auth = (body.keys.auth or "").strip()
    if not endpoint or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="Subscription inválida para push.")
    if len(endpoint) > 1024:
        raise HTTPException(status_code=400, detail="Endpoint de push excede tamanho permitido.")

    now = datetime.utcnow()
    # Um endpoint deve ficar vinculado a um único usuário ativo por vez.
    db.query(models.PushSubscription).filter(
        models.PushSubscription.endpoint == endpoint,
        models.PushSubscription.usuario_id != current_user.id,
    ).update(
        {
            models.PushSubscription.ativo: 0,
            models.PushSubscription.atualizado_em: now,
            models.PushSubscription.ultimo_erro: "Endpoint reatribuído para outro usuário.",
        },
        synchronize_session=False,
    )

    sub = db.query(models.PushSubscription).filter(
        models.PushSubscription.usuario_id == current_user.id,
        models.PushSubscription.endpoint == endpoint,
    ).first()
    if sub:
        sub.p256dh = p256dh
        sub.auth = auth
        sub.user_agent = (body.user_agent or "")[:255] or None
        sub.ativo = 1
        sub.atualizado_em = now
        sub.ultimo_erro = None
    else:
        sub = models.PushSubscription(
            usuario_id=current_user.id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            user_agent=(body.user_agent or "")[:255] or None,
            ativo=1,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(sub)

    db.flush()
    registrar_evento_auditoria(
        db,
        acao="push_subscription_registrada",
        modulo="notificacoes_push",
        descricao=f"Inscrição push registrada para usuário #{current_user.id}.",
        usuario=current_user,
        entidade="push_subscription",
        entidade_id=sub.id,
        detalhes={"endpoint_prefix": endpoint[:80], "ativo": sub.ativo},
    )
    db.commit()
    db.refresh(sub)
    return sub


@router.post("/push/unsubscribe")
def remover_push_subscription(
    body: schemas.PushSubscriptionRemoveIn,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    endpoint = (body.endpoint or "").strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="Endpoint inválido.")

    now = datetime.utcnow()
    total = db.query(models.PushSubscription).filter(
        models.PushSubscription.usuario_id == current_user.id,
        models.PushSubscription.endpoint == endpoint,
        models.PushSubscription.ativo == 1,
    ).update(
        {
            models.PushSubscription.ativo: 0,
            models.PushSubscription.atualizado_em: now,
            models.PushSubscription.ultimo_erro: "Subscription removida pelo usuário.",
        },
        synchronize_session=False,
    )

    if total > 0:
        registrar_evento_auditoria(
            db,
            acao="push_subscription_removida",
            modulo="notificacoes_push",
            descricao=f"Inscrição push removida para usuário #{current_user.id}.",
            usuario=current_user,
            entidade="push_subscription",
            detalhes={"endpoint_prefix": endpoint[:80], "total": total},
        )
        db.commit()
    return {"message": "Subscription removida", "total": total}


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
        registrar_evento_auditoria(
            db,
            acao="notificacao_marcada_lida",
            modulo="notificacoes",
            descricao=f"Notificação #{notificacao.id} marcada como lida.",
            usuario=current_user,
            case_id=notificacao.case_id,
            entidade="notificacao",
            entidade_id=notificacao.id,
            detalhes={"tipo": notificacao.tipo},
        )
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
        registrar_evento_auditoria(
            db,
            acao="notificacoes_marcadas_lidas",
            modulo="notificacoes",
            descricao=f"{total} notificação(ões) marcadas como lidas.",
            usuario=current_user,
            entidade="notificacao",
            detalhes={"total": total},
        )
        db.commit()

    return {"message": "Notificações atualizadas", "total": total}
