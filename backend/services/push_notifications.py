import json
import os
import base64
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

import models
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

try:  # pragma: no cover - depende de pacote opcional no ambiente
    from pywebpush import webpush, WebPushException  # type: ignore
    _PUSH_LIB_AVAILABLE = True
except Exception:  # pragma: no cover
    webpush = None
    WebPushException = Exception
    _PUSH_LIB_AVAILABLE = False


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def _public_key() -> str:
    keys = _obter_chaves_vapid()
    return keys.get("public") or ""


def _private_key() -> str:
    keys = _obter_chaves_vapid()
    return keys.get("private") or ""


def _subject() -> str:
    return _env("WEB_PUSH_VAPID_SUBJECT", "mailto:suporte@dronepro.local")


BASE_DIR = Path(__file__).resolve().parents[1]
LOCAL_VAPID_FILE = BASE_DIR / "push_vapid_keys.json"

_CACHED_KEYS: Optional[Dict[str, str]] = None


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _gerar_chaves_vapid_locais() -> Dict[str, str]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return {"public": _b64url(public_key), "private": private_pem}


def _ler_chaves_locais_arquivo() -> Optional[Dict[str, str]]:
    if not LOCAL_VAPID_FILE.is_file():
        return None
    try:
        payload = json.loads(LOCAL_VAPID_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None
    public_key = str(payload.get("public") or "").strip()
    private_key = str(payload.get("private") or "").strip()
    if not public_key or not private_key:
        return None
    return {"public": public_key, "private": private_key}


def _persistir_chaves_locais_arquivo(chaves: Dict[str, str]) -> None:
    data = {
        "public": chaves.get("public"),
        "private": chaves.get("private"),
        "generated_at_utc": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }
    LOCAL_VAPID_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _obter_chaves_vapid() -> Dict[str, str]:
    global _CACHED_KEYS
    if _CACHED_KEYS is not None:
        return _CACHED_KEYS

    env_public = _env("WEB_PUSH_VAPID_PUBLIC_KEY")
    env_private = _env("WEB_PUSH_VAPID_PRIVATE_KEY")
    if env_public and env_private:
        _CACHED_KEYS = {"public": env_public, "private": env_private}
        return _CACHED_KEYS

    locais = _ler_chaves_locais_arquivo()
    if locais:
        _CACHED_KEYS = locais
        return _CACHED_KEYS

    geradas = _gerar_chaves_vapid_locais()
    try:
        _persistir_chaves_locais_arquivo(geradas)
    except Exception:
        pass
    _CACHED_KEYS = geradas
    return _CACHED_KEYS


def push_habilitado() -> bool:
    return bool(_public_key() and _private_key() and _PUSH_LIB_AVAILABLE)


def config_push_publico() -> Dict[str, Any]:
    if not _PUSH_LIB_AVAILABLE:
        return {
            "enabled": False,
            "public_vapid_key": None,
            "reason": "Dependência pywebpush não instalada no backend.",
        }
    public_key = _public_key()
    private_key = _private_key()
    if not public_key or not private_key:
        return {
            "enabled": False,
            "public_vapid_key": None,
            "reason": "Não foi possível carregar/gerar chaves VAPID.",
        }
    return {
        "enabled": True,
        "public_vapid_key": public_key,
        "reason": None,
    }


def _payload_notificacao(notificacao: models.Notificacao) -> Dict[str, Any]:
    case_id = notificacao.case_id
    url = "/casos"
    if case_id:
        url = f"/casos/{case_id}"
    return {
        "id": notificacao.id,
        "tipo": notificacao.tipo,
        "titulo": notificacao.titulo,
        "mensagem": notificacao.mensagem,
        "case_id": case_id,
        "url": url,
        "criado_em": notificacao.criado_em.isoformat() if notificacao.criado_em else None,
    }


def _status_code_from_push_exc(exc: Exception) -> Optional[int]:
    try:
        response = getattr(exc, "response", None)
        if response is None:
            return None
        return int(getattr(response, "status_code", None) or 0) or None
    except Exception:
        return None


def enviar_push_para_notificacao(db: Session, notificacao: models.Notificacao) -> Dict[str, int]:
    """
    Envia push para todas as inscrições ativas do usuário da notificação.
    Nunca levanta exceção para não quebrar o fluxo principal da esteira.
    """
    if not push_habilitado():
        return {"sent": 0, "failed": 0, "deactivated": 0}

    subs = (
        db.query(models.PushSubscription)
        .filter(
            models.PushSubscription.usuario_id == notificacao.usuario_id,
            models.PushSubscription.ativo == 1,
        )
        .all()
    )
    if not subs:
        return {"sent": 0, "failed": 0, "deactivated": 0}

    payload = json.dumps(_payload_notificacao(notificacao), ensure_ascii=False)
    vapid_claims = {"sub": _subject()}

    sent = 0
    failed = 0
    deactivated = 0
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=_private_key(),
                vapid_claims=vapid_claims,
            )
            sub.ultimo_envio_em = datetime.utcnow()
            sub.ultimo_erro = None
            sub.atualizado_em = datetime.utcnow()
            sent += 1
        except Exception as exc:
            failed += 1
            status_code = _status_code_from_push_exc(exc)
            sub.ultimo_erro = str(exc)[:500]
            sub.atualizado_em = datetime.utcnow()
            # Endpoint inválido/expirado: desativa para manter base limpa.
            if status_code in {404, 410} or "410" in str(exc) or "404" in str(exc):
                sub.ativo = 0
                deactivated += 1
    return {"sent": sent, "failed": failed, "deactivated": deactivated}
