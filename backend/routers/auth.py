from typing import List
import unicodedata
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
import models, schemas, auth as auth_utils

router = APIRouter()


def _strip_accents(value: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", value or "")
        if unicodedata.category(ch) != "Mn"
    )


def _normalize_login_handle(raw_value: str) -> str:
    base = _strip_accents((raw_value or "").strip().lower())
    if not base:
        return ""
    if "@" not in base:
        return f"{base}@dronepro"
    local, domain = base.split("@", 1)
    if not local:
        return ""
    if domain in {"dronepro", "dronepro.com.br", ""}:
        return f"{local}@dronepro"
    return f"{local}@{domain}"


def _candidate_usernames(raw_value: str) -> List[str]:
    base = (raw_value or "").strip().lower()
    if not base:
        return []
    base_no_accents = _strip_accents(base)
    candidates: List[str] = [base, base_no_accents]
    local = base.split("@", 1)[0]
    local_no_accents = _strip_accents(local)

    if local:
        candidates.append(f"{local}@dronepro")
        candidates.append(f"{local}@dronepro.com.br")
    if local_no_accents:
        candidates.append(f"{local_no_accents}@dronepro")
        candidates.append(f"{local_no_accents}@dronepro.com.br")

    if base.endswith("@dronepro"):
        candidates.append(f"{base}.com.br")
    if base_no_accents.endswith("@dronepro"):
        candidates.append(f"{base_no_accents}.com.br")
    if base.endswith("@dronepro.com.br"):
        candidates.append(base.replace("@dronepro.com.br", "@dronepro"))
    if base_no_accents.endswith("@dronepro.com.br"):
        candidates.append(base_no_accents.replace("@dronepro.com.br", "@dronepro"))

    # Remove duplicados preservando ordem
    seen = set()
    ordered: List[str] = []
    for value in candidates:
        if value not in seen:
            seen.add(value)
            ordered.append(value)
    return ordered


@router.post("/login", response_model=schemas.TokenResponse)
def login(request: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = None
    for candidate in _candidate_usernames(request.email):
        user = db.query(models.Usuario).filter(models.Usuario.email == candidate).first()
        if user:
            break

    # Fallback resiliente para variações com/sem acento e @dronepro / @dronepro.com.br.
    if not user:
        normalized_target = _normalize_login_handle(request.email)
        if normalized_target:
            all_users = db.query(models.Usuario).all()
            for candidate_user in all_users:
                if _normalize_login_handle(candidate_user.email) == normalized_target:
                    user = candidate_user
                    break

    if not user or not auth_utils.verify_password(request.senha, user.senha_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nome de usuário ou senha incorretos"
        )
    if not user.ativo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário inativo. Contate o administrador."
        )
    token = auth_utils.create_access_token({"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "usuario": user
    }


@router.get("/me", response_model=schemas.UsuarioOut)
def get_me(current_user: models.Usuario = Depends(auth_utils.get_current_user)):
    return current_user


@router.post("/alterar-senha")
def alterar_senha(
    body: schemas.PasswordChange,
    current_user: models.Usuario = Depends(auth_utils.get_current_user),
    db: Session = Depends(get_db)
):
    if not auth_utils.verify_password(body.senha_atual, current_user.senha_hash):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    current_user.senha_hash = auth_utils.get_password_hash(body.nova_senha)
    db.commit()
    return {"message": "Senha alterada com sucesso"}
