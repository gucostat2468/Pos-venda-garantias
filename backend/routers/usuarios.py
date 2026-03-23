from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from database import get_db
import models, schemas
from auth import get_current_user, get_password_hash, require_roles

router = APIRouter()

PAPEIS_VALIDOS = ["operador", "gerente_pos_venda", "diretor_comercial", "admin"]


@router.get("", response_model=List[schemas.UsuarioOut], include_in_schema=False)
@router.get("/", response_model=List[schemas.UsuarioOut])
def listar_usuarios(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin"))
):
    return db.query(models.Usuario).all()


@router.post("", response_model=schemas.UsuarioOut, include_in_schema=False)
@router.post("/", response_model=schemas.UsuarioOut)
def criar_usuario(
    body: schemas.UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin"))
):
    if body.papel not in PAPEIS_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Papel inválido. Use: {', '.join(PAPEIS_VALIDOS)}")
    if db.query(models.Usuario).filter(models.Usuario.email == body.email).first():
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    usuario = models.Usuario(
        nome=body.nome,
        email=body.email,
        senha_hash=get_password_hash(body.senha),
        papel=body.papel
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return usuario


@router.get("/{usuario_id}", response_model=schemas.UsuarioOut)
def obter_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin"))
):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return usuario


@router.put("/{usuario_id}", response_model=schemas.UsuarioOut)
def atualizar_usuario(
    usuario_id: int,
    body: schemas.UsuarioUpdate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin"))
):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if body.papel and body.papel not in PAPEIS_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Papel inválido")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(usuario, field, value)
    db.commit()
    db.refresh(usuario)
    return usuario


@router.delete("/{usuario_id}")
def desativar_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin"))
):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if usuario.id == current_user.id:
        raise HTTPException(status_code=400, detail="Você não pode desativar sua própria conta")
    usuario.ativo = 0
    db.commit()
    return {"message": "Usuário desativado"}


@router.post("/{usuario_id}/reset-senha")
def reset_senha(
    usuario_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(require_roles("admin"))
):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    nova_senha = body.get("nova_senha")
    if not nova_senha or len(nova_senha) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter pelo menos 6 caracteres")
    usuario.senha_hash = get_password_hash(nova_senha)
    db.commit()
    return {"message": "Senha redefinida com sucesso"}
