from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import re
from database import get_db
import models, schemas
from auth import get_current_user
from services.auditoria import gerar_diff, registrar_evento_auditoria

router = APIRouter()


def _normalizar_cnpj(cnpj: Optional[str]) -> str:
    return re.sub(r"\D", "", cnpj or "")


def _buscar_cliente_por_cnpj_normalizado(
    db: Session,
    cnpj: Optional[str],
    *,
    excluir_id: Optional[int] = None,
) -> Optional[models.Cliente]:
    alvo = _normalizar_cnpj(cnpj)
    if not alvo:
        return None
    for cliente in db.query(models.Cliente).all():
        if excluir_id is not None and cliente.id == excluir_id:
            continue
        if _normalizar_cnpj(cliente.cnpj) == alvo:
            return cliente
    return None


@router.get("", response_model=List[schemas.ClienteOut], include_in_schema=False)
@router.get("/", response_model=List[schemas.ClienteOut])
def listar_clientes(
    busca: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    q = db.query(models.Cliente).filter(models.Cliente.ativo == 1)
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
    existente = _buscar_cliente_por_cnpj_normalizado(db, body.cnpj)
    if existente:
        raise HTTPException(
            status_code=400,
            detail=f"CNPJ já cadastrado em outro cliente (ID {existente.id}).",
        )
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
    novo_cnpj = body.model_dump(exclude_unset=True).get("cnpj")
    if novo_cnpj and _normalizar_cnpj(novo_cnpj) != _normalizar_cnpj(cliente.cnpj):
        existente = _buscar_cliente_por_cnpj_normalizado(db, novo_cnpj, excluir_id=cliente.id)
        if existente:
            raise HTTPException(
                status_code=400,
                detail=f"CNPJ já cadastrado em outro cliente (ID {existente.id}).",
            )
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
        if cliente.ativo != 0:
            cliente.ativo = 0
            registrar_evento_auditoria(
                db,
                acao="cliente_inativado",
                modulo="clientes",
                descricao=(
                    f"Cliente {cliente.razao_social} inativado porque possui "
                    f"{len(cliente.casos)} caso(s) vinculado(s)."
                ),
                usuario=current_user,
                entidade="cliente",
                entidade_id=cliente.id,
                detalhes={"motivo": "possui_casos_vinculados", "qtd_casos": len(cliente.casos)},
            )
            db.commit()
        return {
            "message": (
                "Cliente possui casos vinculados. Cadastro foi inativado e removido da lista de clientes ativos."
            )
        }
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
