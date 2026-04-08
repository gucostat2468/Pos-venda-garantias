import base64
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from database import get_db
import models, schemas
from auth import get_current_user, get_password_hash, require_roles
from services.auditoria import gerar_diff, registrar_evento_auditoria
from services.signature_store import (
    decode_signature_data_url,
    salvar_assinatura_usuario,
    carregar_assinatura_usuario_bytes,
    remover_assinatura_usuario,
    SIGNATURE_DATA_URL_PREFIX,
)

router = APIRouter()

PAPEIS_VALIDOS = ["operador", "gerente_pos_venda", "diretor_comercial", "gestor_estoque", "admin"]
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")


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
    db.flush()
    registrar_evento_auditoria(
        db,
        acao="usuario_criado",
        modulo="usuarios",
        descricao=f"Usuário {usuario.email} criado.",
        usuario=current_user,
        entidade="usuario",
        entidade_id=usuario.id,
        detalhes={
            "nome": usuario.nome,
            "email": usuario.email,
            "papel": usuario.papel,
        },
    )
    db.commit()
    db.refresh(usuario)
    return usuario


@router.get("/minha-assinatura", response_model=schemas.MinhaAssinaturaOut)
def obter_minha_assinatura(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    try:
        assinatura_bytes = carregar_assinatura_usuario_bytes(current_user)
    except FileNotFoundError:
        return {
            "tem_assinatura": False,
            "assinatura_data_url": None,
            "atualizado_em": current_user.assinatura_padrao_atualizada_em,
        }
    except ValueError:
        return {
            "tem_assinatura": False,
            "assinatura_data_url": None,
            "atualizado_em": current_user.assinatura_padrao_atualizada_em,
        }

    assinatura_data_url = f"{SIGNATURE_DATA_URL_PREFIX}{base64.b64encode(assinatura_bytes).decode('ascii')}"
    return {
        "tem_assinatura": True,
        "assinatura_data_url": assinatura_data_url,
        "atualizado_em": current_user.assinatura_padrao_atualizada_em,
    }


@router.post("/minha-assinatura", response_model=schemas.MinhaAssinaturaOut)
def salvar_minha_assinatura(
    body: schemas.MinhaAssinaturaSaveIn,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    try:
        assinatura_bytes = decode_signature_data_url(body.assinatura_data_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    salvar_assinatura_usuario(current_user, assinatura_bytes, UPLOADS_DIR)

    registrar_evento_auditoria(
        db,
        acao="assinatura_padrao_salva",
        modulo="usuarios",
        descricao=f"Assinatura padrao salva por {current_user.email}.",
        usuario=current_user,
        entidade="usuario",
        entidade_id=current_user.id,
    )
    db.commit()
    db.refresh(current_user)

    assinatura_data_url = f"{SIGNATURE_DATA_URL_PREFIX}{base64.b64encode(assinatura_bytes).decode('ascii')}"
    return {
        "tem_assinatura": True,
        "assinatura_data_url": assinatura_data_url,
        "atualizado_em": current_user.assinatura_padrao_atualizada_em,
    }


@router.delete("/minha-assinatura")
def excluir_minha_assinatura(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    possuia_assinatura = bool((current_user.assinatura_padrao_path or "").strip())
    remover_assinatura_usuario(current_user)

    registrar_evento_auditoria(
        db,
        acao="assinatura_padrao_removida",
        modulo="usuarios",
        descricao=f"Assinatura padrao removida por {current_user.email}.",
        usuario=current_user,
        entidade="usuario",
        entidade_id=current_user.id,
        detalhes={"possuia_assinatura": possuia_assinatura},
    )
    db.commit()
    return {"message": "Assinatura padrão removida com sucesso"}


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

    before = {
        "nome": usuario.nome,
        "email": usuario.email,
        "papel": usuario.papel,
        "ativo": usuario.ativo,
    }
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(usuario, field, value)
    after = {
        "nome": usuario.nome,
        "email": usuario.email,
        "papel": usuario.papel,
        "ativo": usuario.ativo,
    }
    registrar_evento_auditoria(
        db,
        acao="usuario_atualizado",
        modulo="usuarios",
        descricao=f"Usuário {usuario.email} atualizado.",
        usuario=current_user,
        entidade="usuario",
        entidade_id=usuario.id,
        detalhes={"alteracoes": gerar_diff(before, after)},
    )
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
    registrar_evento_auditoria(
        db,
        acao="usuario_desativado",
        modulo="usuarios",
        descricao=f"Usuário {usuario.email} desativado.",
        usuario=current_user,
        entidade="usuario",
        entidade_id=usuario.id,
    )
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
    registrar_evento_auditoria(
        db,
        acao="usuario_reset_senha",
        modulo="usuarios",
        descricao=f"Senha do usuário {usuario.email} redefinida por administrador.",
        usuario=current_user,
        entidade="usuario",
        entidade_id=usuario.id,
    )
    db.commit()
    return {"message": "Senha redefinida com sucesso"}
