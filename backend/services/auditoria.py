import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

import models


def _serialize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _serialize_value(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_serialize_value(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"
    return value


def _serialize_mapping(data: Dict[str, Any]) -> Dict[str, Any]:
    return {key: _serialize_value(val) for key, val in data.items()}


def gerar_diff(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    diff: Dict[str, Dict[str, Any]] = {}
    for key in sorted(set(before.keys()) | set(after.keys())):
        old = _serialize_value(before.get(key))
        new = _serialize_value(after.get(key))
        if old != new:
            diff[key] = {"de": old, "para": new}
    return diff


def registrar_evento_auditoria(
    db: Session,
    *,
    acao: str,
    modulo: str,
    descricao: str,
    status: str = "sucesso",
    usuario: Optional[models.Usuario] = None,
    usuario_id: Optional[int] = None,
    case_id: Optional[int] = None,
    entidade: Optional[str] = None,
    entidade_id: Optional[int] = None,
    detalhes: Optional[Dict[str, Any]] = None,
) -> models.AuditoriaEvento:
    resolved_usuario_id = usuario_id or (usuario.id if usuario else None)
    detalhes_json = None
    if detalhes is not None:
        detalhes_json = json.dumps(_serialize_mapping(detalhes), ensure_ascii=False)

    evento = models.AuditoriaEvento(
        usuario_id=resolved_usuario_id,
        case_id=case_id,
        acao=acao,
        modulo=modulo,
        entidade=entidade,
        entidade_id=entidade_id,
        descricao=descricao,
        status=status,
        detalhes_json=detalhes_json,
        criado_em=datetime.utcnow(),
    )
    db.add(evento)
    return evento
