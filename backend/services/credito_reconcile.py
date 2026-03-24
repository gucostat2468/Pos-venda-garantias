from __future__ import annotations

import json
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy import extract
from sqlalchemy.orm import Session

import models


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.split())


def _token_set(text: str) -> set[str]:
    return {t for t in text.split(" ") if t}


def _score_nome(dealer: str, cliente: str) -> tuple[float, dict[str, Any]]:
    dealer_n = _normalize_text(dealer)
    cliente_n = _normalize_text(cliente)
    if not dealer_n or not cliente_n:
        return 0.0, {"ratio": 0.0, "jaccard": 0.0, "containment": False}

    ratio = SequenceMatcher(None, dealer_n, cliente_n).ratio()
    dealer_tokens = _token_set(dealer_n)
    cliente_tokens = _token_set(cliente_n)
    union = dealer_tokens | cliente_tokens
    inter = dealer_tokens & cliente_tokens
    jaccard = (len(inter) / len(union)) if union else 0.0
    containment = dealer_n in cliente_n or cliente_n in dealer_n

    score = 0.6 * ratio + 0.4 * jaccard
    if containment:
        score = max(score, 0.92)
    if dealer_n == cliente_n:
        score = 1.0

    return min(score, 1.0), {
        "ratio": ratio,
        "jaccard": jaccard,
        "containment": containment,
        "dealer_norm": dealer_n,
        "cliente_norm": cliente_n,
    }


def _infer_tipo_from_descricao(descricao: str | None) -> str | None:
    norm = _normalize_text(descricao)
    if not norm:
        return None
    if "battery" in norm or "doa" in norm:
        return "Bateria"
    if "parts" in norm or "partes" in norm or "peca" in norm or "spare part" in norm:
        return "Peca"
    return None


def _find_cliente_for_extrato(
    extrato: models.CreditoExtrato, clientes: list[models.Cliente]
) -> tuple[models.Cliente | None, float, dict[str, Any]]:
    best: models.Cliente | None = None
    best_score = 0.0
    best_details: dict[str, Any] = {}
    for cliente in clientes:
        score, details = _score_nome(extrato.dealer_nome or "", cliente.razao_social or "")
        if score > best_score:
            best = cliente
            best_score = score
            best_details = details
    if best_score < 0.55:
        return None, best_score, best_details
    return best, best_score, best_details


def _find_or_create_cliente_by_dealer(db: Session, dealer_nome: str) -> models.Cliente | None:
    dealer_norm = _normalize_text(dealer_nome)
    if not dealer_norm:
        return None

    clientes = db.query(models.Cliente).all()
    for cliente in clientes:
        if _normalize_text(cliente.razao_social) == dealer_norm:
            return cliente

    novo = models.Cliente(razao_social=dealer_nome.strip())
    db.add(novo)
    db.flush()
    return novo


def _load_case_candidates(
    db: Session,
    cliente_id: int,
    ano: int | None,
    mes: int | None,
    tipo_preferido: str | None,
) -> tuple[list[models.CasoGarantia], str]:
    q = db.query(models.CasoGarantia).filter(models.CasoGarantia.cliente_id == cliente_id)

    if ano and mes:
        exact = (
            q.filter(
                extract("year", models.CasoGarantia.data_entrada) == ano,
                extract("month", models.CasoGarantia.data_entrada) == mes,
            )
            .order_by(models.CasoGarantia.data_entrada.asc(), models.CasoGarantia.id.asc())
            .all()
        )
        if exact:
            if tipo_preferido:
                filtered = [c for c in exact if c.tipo_processo == tipo_preferido]
                if filtered:
                    return filtered, "same_month_tipo"
            return exact, "same_month"

        near_months = {mes - 1, mes + 1}
        near = (
            q.filter(
                extract("year", models.CasoGarantia.data_entrada) == ano,
                extract("month", models.CasoGarantia.data_entrada).in_(list(near_months)),
            )
            .order_by(models.CasoGarantia.data_entrada.asc(), models.CasoGarantia.id.asc())
            .all()
        )
        if near:
            if tipo_preferido:
                filtered = [c for c in near if c.tipo_processo == tipo_preferido]
                if filtered:
                    return filtered, "near_month_tipo"
            return near, "near_month"

    all_cases = q.order_by(models.CasoGarantia.data_entrada.asc(), models.CasoGarantia.id.asc()).all()
    if tipo_preferido:
        filtered = [c for c in all_cases if c.tipo_processo == tipo_preferido]
        if filtered:
            return filtered, "all_time_tipo"
    return all_cases, "all_time"


def _load_case_candidates_any_client(
    db: Session,
    ano: int | None,
    mes: int | None,
    tipo_preferido: str | None,
) -> tuple[list[models.CasoGarantia], str]:
    q = db.query(models.CasoGarantia)
    if ano and mes:
        same_month = (
            q.filter(
                extract("year", models.CasoGarantia.data_entrada) == ano,
                extract("month", models.CasoGarantia.data_entrada) == mes,
            )
            .order_by(models.CasoGarantia.data_entrada.asc(), models.CasoGarantia.id.asc())
            .all()
        )
        if same_month:
            if tipo_preferido:
                filtered = [c for c in same_month if c.tipo_processo == tipo_preferido]
                if filtered:
                    return filtered, "fallback_same_month_any_client_tipo"
            return same_month, "fallback_same_month_any_client"

        near = (
            q.filter(
                extract("year", models.CasoGarantia.data_entrada) == ano,
                extract("month", models.CasoGarantia.data_entrada).in_([mes - 1, mes + 1]),
            )
            .order_by(models.CasoGarantia.data_entrada.asc(), models.CasoGarantia.id.asc())
            .all()
        )
        if near:
            if tipo_preferido:
                filtered = [c for c in near if c.tipo_processo == tipo_preferido]
                if filtered:
                    return filtered, "fallback_near_month_any_client_tipo"
            return near, "fallback_near_month_any_client"
    return [], "no_candidates"


def reconcile_credito_to_cases(db: Session) -> dict[str, Any]:
    summary = {
        "extratos_processados": 0,
        "extratos_com_cliente": 0,
        "extratos_sem_cliente": 0,
        "lancamentos_processados": 0,
        "vinculos_caso_criados": 0,
    }

    try:
        # Reconciliação é recalculada do zero para manter consistência com mudanças de dados.
        # Mantemos tudo em uma única transação para evitar estado parcial.
        db.query(models.CreditoCasoVinculo).delete()
        db.query(models.CreditoClienteVinculo).delete()

        extratos = (
            db.query(models.CreditoExtrato)
            .order_by(models.CreditoExtrato.competencia_ano.asc(), models.CreditoExtrato.competencia_mes.asc())
            .all()
        )

        for extrato in extratos:
            clientes = db.query(models.Cliente).all()
            summary["extratos_processados"] += 1
            cliente, cliente_score, score_details = _find_cliente_for_extrato(extrato, clientes)
            if not cliente:
                cliente_auto = _find_or_create_cliente_by_dealer(db, extrato.dealer_nome or "")
                if cliente_auto:
                    cliente = cliente_auto
                    cliente_score = 0.65
                    score_details = {"auto_created_by_dealer": True}
                else:
                    summary["extratos_sem_cliente"] += 1
                    extrato.cliente_id = None
                    continue

            summary["extratos_com_cliente"] += 1
            extrato.cliente_id = cliente.id
            db.add(
                models.CreditoClienteVinculo(
                    extrato_id=extrato.id,
                    cliente_id=cliente.id,
                    score=round(cliente_score, 4),
                    metodo="dealer_nome_similarity",
                    detalhes_json=json.dumps(score_details, ensure_ascii=False),
                )
            )
            db.flush()

            lancamentos = (
                db.query(models.CreditoLancamento)
                .filter(
                    models.CreditoLancamento.extrato_id == extrato.id,
                    models.CreditoLancamento.secao.in_(["income", "expenditure"]),
                )
                .order_by(models.CreditoLancamento.linha_planilha.asc())
                .all()
            )

            for lanc in lancamentos:
                summary["lancamentos_processados"] += 1
                if lanc.valor is None or abs(lanc.valor) == 0:
                    continue

                tipo_preferido = _infer_tipo_from_descricao(lanc.descricao)
                candidatos, scope = _load_case_candidates(
                    db,
                    cliente_id=cliente.id,
                    ano=extrato.competencia_ano,
                    mes=extrato.competencia_mes,
                    tipo_preferido=tipo_preferido,
                )
                if not candidatos:
                    candidatos, scope = _load_case_candidates_any_client(
                        db,
                        ano=extrato.competencia_ano,
                        mes=extrato.competencia_mes,
                        tipo_preferido=tipo_preferido,
                    )
                    if not candidatos:
                        continue

                base_score = cliente_score
                if scope.startswith("same_month"):
                    base_score += 0.2
                elif scope.startswith("near_month"):
                    base_score += 0.1
                elif scope.startswith("fallback_same_month"):
                    base_score = min(base_score, 0.35)
                elif scope.startswith("fallback_near_month"):
                    base_score = min(base_score, 0.3)
                if scope.endswith("_tipo"):
                    base_score += 0.1
                base_score = min(base_score, 0.99)

                valor_unit = float(lanc.valor) / len(candidatos)
                metodo = "single_case_exact" if len(candidatos) == 1 else "equal_split_by_scope"

                for caso in candidatos:
                    detalhes = {
                        "scope": scope,
                        "tipo_preferido": tipo_preferido,
                        "competencia_mes": extrato.competencia_mes,
                        "competencia_ano": extrato.competencia_ano,
                        "num_candidatos": len(candidatos),
                    }
                    db.add(
                        models.CreditoCasoVinculo(
                            extrato_id=extrato.id,
                            lancamento_id=lanc.id,
                            cliente_id=cliente.id,
                            caso_id=caso.id,
                            valor_lancamento=float(lanc.valor),
                            valor_alocado=valor_unit,
                            score=round(base_score, 4),
                            metodo=metodo,
                            detalhes_json=json.dumps(detalhes, ensure_ascii=False),
                        )
                    )
                    summary["vinculos_caso_criados"] += 1

        db.commit()
        return summary
    except Exception:
        db.rollback()
        raise
