import base64
import binascii
import os
from datetime import datetime
from typing import Optional


SIGNATURE_DATA_URL_PREFIX = "data:image/png;base64,"
SIGNATURE_MIN_BYTES = 300
SIGNATURE_MAX_BYTES = 2 * 1024 * 1024
USER_SIGNATURES_SUBDIR = "assinaturas_usuarios"


def decode_signature_data_url(assinatura_data_url: Optional[str]) -> bytes:
    assinatura_raw = assinatura_data_url or ""
    if not assinatura_raw.startswith(SIGNATURE_DATA_URL_PREFIX):
        raise ValueError("Assinatura invalida. Envie imagem PNG em base64.")

    try:
        assinatura_bytes = base64.b64decode(
            assinatura_raw[len(SIGNATURE_DATA_URL_PREFIX):],
            validate=True,
        )
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Assinatura invalida (base64 malformado).") from exc

    if len(assinatura_bytes) < SIGNATURE_MIN_BYTES:
        raise ValueError("Assinatura muito pequena. Desenhe a assinatura antes de confirmar.")
    if len(assinatura_bytes) > SIGNATURE_MAX_BYTES:
        raise ValueError("Assinatura muito grande. Limite de 2MB.")
    return assinatura_bytes


def _path_assinatura_usuario(usuario_id: int, uploads_dir: str) -> str:
    user_dir = os.path.join(uploads_dir, USER_SIGNATURES_SUBDIR, str(usuario_id))
    os.makedirs(user_dir, exist_ok=True)
    return os.path.join(user_dir, "assinatura_padrao.png")


def salvar_assinatura_usuario(usuario, assinatura_bytes: bytes, uploads_dir: str) -> str:
    if not assinatura_bytes:
        raise ValueError("Assinatura vazia.")
    if len(assinatura_bytes) < SIGNATURE_MIN_BYTES:
        raise ValueError("Assinatura muito pequena. Desenhe a assinatura antes de confirmar.")
    if len(assinatura_bytes) > SIGNATURE_MAX_BYTES:
        raise ValueError("Assinatura muito grande. Limite de 2MB.")

    path_destino = _path_assinatura_usuario(int(usuario.id), uploads_dir)
    with open(path_destino, "wb") as f:
        f.write(assinatura_bytes)

    usuario.assinatura_padrao_path = path_destino
    usuario.assinatura_padrao_atualizada_em = datetime.utcnow()
    return path_destino


def carregar_assinatura_usuario_bytes(usuario) -> bytes:
    path = (usuario.assinatura_padrao_path or "").strip()
    if not path:
        raise FileNotFoundError("Assinatura padrao nao cadastrada.")
    if not os.path.exists(path):
        raise FileNotFoundError("Arquivo da assinatura padrao nao encontrado.")
    with open(path, "rb") as f:
        assinatura_bytes = f.read()
    if len(assinatura_bytes) < SIGNATURE_MIN_BYTES:
        raise ValueError("Arquivo de assinatura salvo esta invalido (muito pequeno).")
    if len(assinatura_bytes) > SIGNATURE_MAX_BYTES:
        raise ValueError("Arquivo de assinatura salvo esta invalido (muito grande).")
    return assinatura_bytes


def remover_assinatura_usuario(usuario) -> None:
    path = (usuario.assinatura_padrao_path or "").strip()
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
    usuario.assinatura_padrao_path = None
    usuario.assinatura_padrao_atualizada_em = None
