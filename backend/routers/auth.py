from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
import models, schemas, auth as auth_utils

router = APIRouter()


def _candidate_usernames(raw_value: str) -> List[str]:
    base = (raw_value or "").strip().lower()
    if not base:
        return []
    candidates: List[str] = [base]
    local = base.split("@", 1)[0]

    if local:
        candidates.append(f"{local}@dronepro")
        candidates.append(f"{local}@dronepro.com.br")

    if base.endswith("@dronepro"):
        candidates.append(f"{base}.com.br")
    if base.endswith("@dronepro.com.br"):
        candidates.append(base.replace("@dronepro.com.br", "@dronepro"))

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
