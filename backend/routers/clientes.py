from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from database import get_db
import models, schemas
from auth import get_current_user
from services.auditoria import gerar_diff, registrar_evento_auditoria

router = APIRouter()


@router.get("", response_model=List[schemas.ClienteOut], include_in_schema=False)
@router.get("/", response_model=List[schemas.ClienteOut])
def listar_clientes(
    busca: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    q = db.query(models.Cliente)
    if busca:
        q = q.filter(
            models.Cliente.razao_social.ilike(f"%{busca}%") |
            models.Cliente.cnpj.ilike(f"%{busca}%")
        )
    return q.order_by(models.Cliente.razao_social).all()


@router.post("", response_model=schemas.ClienteOut, include_in_schema=False)
@router.post("/", response_model=schemas.ClienteOut)
def criar_cliente(
    body: schemas.ClienteCreate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    if body.cnpj:
        if db.query(models.Cliente).filter(models.Cliente.cnpj == body.cnpj).first():
            raise HTTPException(status_code=400, detail="CNPJ já cadastrado")
    cliente = models.Cliente(**body.model_dump())
    db.add(cliente)
    db.flush()
    registrar_evento_auditoria(
        db,
        acao="cliente_criado",
        modulo="clientes",
        descricao=f"Cliente {cliente.razao_social} criado.",
        usuario=current_user,
        entidade="cliente",
        entidade_id=cliente.id,
        detalhes={
            "razao_social": cliente.razao_social,
            "cnpj": cliente.cnpj,
            "email": cliente.email,
            "telefone": cliente.telefone,
        },
    )
    db.commit()
    db.refresh(cliente)
    return cliente


@router.get("/{cliente_id}", response_model=schemas.ClienteOut)
def obter_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    cliente = db.query(models.Cliente).filter(models.Cliente.id == cliente_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return cliente


@router.put("/{cliente_id}", response_model=schemas.ClienteOut)
def atualizar_cliente(
    cliente_id: int,
    body: schemas.ClienteUpdate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    cliente = db.query(models.Cliente).filter(models.Cliente.id == cliente_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    before = {
        "razao_social": cliente.razao_social,
        "cnpj": cliente.cnpj,
        "email": cliente.email,
        "telefone": cliente.telefone,
    }
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(cliente, field, value)
    after = {
        "razao_social": cliente.razao_social,
        "cnpj": cliente.cnpj,
        "email": cliente.email,
        "telefone": cliente.telefone,
    }
    registrar_evento_auditoria(
        db,
        acao="cliente_atualizado",
        modulo="clientes",
        descricao=f"Cliente {cliente.razao_social} atualizado.",
        usuario=current_user,
        entidade="cliente",
        entidade_id=cliente.id,
        detalhes={"alteracoes": gerar_diff(before, after)},
    )
    db.commit()
    db.refresh(cliente)
    return cliente


@router.delete("/{cliente_id}")
def deletar_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    cliente = db.query(models.Cliente).filter(models.Cliente.id == cliente_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    if cliente.casos:
        raise HTTPException(status_code=400, detail="Cliente possui casos vinculados e não pode ser excluído")
    registrar_evento_auditoria(
        db,
        acao="cliente_excluido",
        modulo="clientes",
        descricao=f"Cliente {cliente.razao_social} excluído.",
        usuario=current_user,
        entidade="cliente",
        entidade_id=cliente.id,
    )
    db.delete(cliente)
    db.commit()
    return {"message": "Cliente excluído com sucesso"}
