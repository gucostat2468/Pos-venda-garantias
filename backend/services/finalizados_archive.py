import hashlib
import json
import os
import shutil
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session, joinedload

import models


BASE_DIR = Path(__file__).resolve().parents[1]
ARCHIVE_FINALIZADOS_DIR = BASE_DIR / "archive_finalizados"


def _utc_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _serialize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _serialize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_serialize_value(v) for v in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"
    return value


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_file(src: Path, dst: Path) -> Dict[str, Any]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return {
        "sha256": _sha256_file(dst),
        "tamanho_bytes": dst.stat().st_size,
    }


def ensure_archive_root() -> Path:
    ARCHIVE_FINALIZADOS_DIR.mkdir(parents=True, exist_ok=True)
    return ARCHIVE_FINALIZADOS_DIR


def _case_archive_dir(case_id: int) -> Path:
    return ensure_archive_root() / f"caso_{int(case_id)}"


def _safe_ext(path_like: Optional[str], nome_arquivo: Optional[str], default: str = ".bin") -> str:
    ext = Path(path_like or "").suffix.lower()
    if not ext:
        ext = Path(nome_arquivo or "").suffix.lower()
    if not ext:
        ext = default
    if len(ext) > 12:
        ext = default
    return ext


def archive_caso_finalizado(
    caso: models.CasoGarantia,
    *,
    strict_required: bool = True,
) -> Dict[str, Any]:
    """
    Cria snapshot imutável com todos os arquivos de um caso finalizado.
    """
    case_dir = _case_archive_dir(caso.id)
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    snapshot_dir = case_dir / "snapshots" / stamp

    documentos_dir = snapshot_dir / "documentos"
    documentos_orig_dir = snapshot_dir / "documentos_originais_pdf"
    assinaturas_doc_dir = snapshot_dir / "assinaturas_documentos"
    dossie_dir = snapshot_dir / "dossie"

    documentos_dir.mkdir(parents=True, exist_ok=False)
    documentos_orig_dir.mkdir(parents=True, exist_ok=True)
    assinaturas_doc_dir.mkdir(parents=True, exist_ok=True)
    dossie_dir.mkdir(parents=True, exist_ok=True)

    manifest: Dict[str, Any] = {
        "versao": 1,
        "gerado_em_utc": _utc_iso(),
        "caso": {
            "id": caso.id,
            "codigo": caso.dji_case_id or f"#{caso.id}",
            "status": caso.status,
            "status_rebate": caso.status_rebate,
            "tipo_processo": caso.tipo_processo,
            "cliente_id": caso.cliente_id,
            "cliente_razao_social": caso.cliente.razao_social if caso.cliente else None,
            "criado_por_usuario_id": caso.criado_por_usuario_id,
            "criado_por_nome": caso.criado_por.nome if caso.criado_por else None,
            "produto_nome": caso.produto_nome,
            "produto_modelo": caso.produto_modelo,
            "produto_sn": caso.produto_sn,
            "data_entrada": caso.data_entrada,
            "criado_em": caso.criado_em,
            "atualizado_em": caso.atualizado_em,
        },
        "documentos": [],
        "assinaturas_documentos": [],
        "assinaturas_caso": [],
        "dossie": {},
        "integridade": {
            "missing_required_files": [],
            "missing_required_count": 0,
        },
    }
    missing_required: list[str] = []

    documentos_ordenados = sorted(list(caso.documentos or []), key=lambda d: (d.id or 0))
    for doc in documentos_ordenados:
        ext = _safe_ext(doc.path_arquivo, doc.nome_arquivo)
        entry: Dict[str, Any] = {
            "id": doc.id,
            "tipo_documento": doc.tipo_documento,
            "nome_arquivo": doc.nome_arquivo,
            "mime_type": doc.mime_type,
            "tamanho_bytes": doc.tamanho_bytes,
            "data_upload": doc.data_upload,
            "path_origem": doc.path_arquivo,
            "arquivo_arquivado_rel": None,
            "arquivo_arquivado_sha256": None,
            "arquivo_arquivado_tamanho_bytes": None,
            "arquivo_original_pdf_rel": None,
            "arquivo_original_pdf_sha256": None,
            "arquivo_original_pdf_tamanho_bytes": None,
        }
        src = Path(doc.path_arquivo or "")
        if src.is_file():
            dst = documentos_dir / f"doc_{doc.id}{ext}"
            copied = _copy_file(src, dst)
            entry["arquivo_arquivado_rel"] = dst.relative_to(snapshot_dir).as_posix()
            entry["arquivo_arquivado_sha256"] = copied["sha256"]
            entry["arquivo_arquivado_tamanho_bytes"] = copied["tamanho_bytes"]
        else:
            missing_required.append(f"documento:{doc.id}:{doc.nome_arquivo}")

        src_orig = Path(f"{doc.path_arquivo}.orig") if doc.path_arquivo else None
        if src_orig and src_orig.is_file():
            dst_orig = documentos_orig_dir / f"doc_{doc.id}.pdf"
            copied_orig = _copy_file(src_orig, dst_orig)
            entry["arquivo_original_pdf_rel"] = dst_orig.relative_to(snapshot_dir).as_posix()
            entry["arquivo_original_pdf_sha256"] = copied_orig["sha256"]
            entry["arquivo_original_pdf_tamanho_bytes"] = copied_orig["tamanho_bytes"]

        manifest["documentos"].append(entry)

    assinaturas_doc_ordenadas = sorted(list(caso.documento_assinaturas or []), key=lambda s: (s.id or 0))
    for assinatura_doc in assinaturas_doc_ordenadas:
        ext = _safe_ext(assinatura_doc.path_assinatura, None, default=".png")
        entry = {
            "id": assinatura_doc.id,
            "documento_id": assinatura_doc.documento_id,
            "usuario_id": assinatura_doc.usuario_id,
            "usuario_nome": assinatura_doc.usuario.nome if assinatura_doc.usuario else None,
            "etapa_fluxo": assinatura_doc.etapa_fluxo,
            "data_assinatura": assinatura_doc.data_assinatura,
            "path_origem": assinatura_doc.path_assinatura,
            "arquivo_arquivado_rel": None,
            "arquivo_arquivado_sha256": None,
            "arquivo_arquivado_tamanho_bytes": None,
        }
        src_sig = Path(assinatura_doc.path_assinatura or "")
        if src_sig.is_file():
            dst_sig = assinaturas_doc_dir / f"docsig_{assinatura_doc.id}{ext}"
            copied_sig = _copy_file(src_sig, dst_sig)
            entry["arquivo_arquivado_rel"] = dst_sig.relative_to(snapshot_dir).as_posix()
            entry["arquivo_arquivado_sha256"] = copied_sig["sha256"]
            entry["arquivo_arquivado_tamanho_bytes"] = copied_sig["tamanho_bytes"]
        else:
            missing_required.append(f"assinatura_documento:{assinatura_doc.id}")

        manifest["assinaturas_documentos"].append(entry)

    assinaturas_caso_ordenadas = sorted(list(caso.assinaturas or []), key=lambda s: (s.id or 0))
    for assinatura in assinaturas_caso_ordenadas:
        manifest["assinaturas_caso"].append(
            {
                "id": assinatura.id,
                "usuario_id": assinatura.usuario_id,
                "usuario_nome": assinatura.usuario.nome if assinatura.usuario else None,
                "etapa_fluxo": assinatura.etapa_fluxo,
                "status_decisao": assinatura.status_decisao,
                "observacao": assinatura.observacao,
                "data_assinatura": assinatura.data_assinatura,
            }
        )

    dossie_entry = {
        "path_origem": caso.link_pdf_compilado,
        "arquivo_arquivado_rel": None,
        "arquivo_arquivado_sha256": None,
        "arquivo_arquivado_tamanho_bytes": None,
    }
    dossie_path = Path(caso.link_pdf_compilado or "")
    if dossie_path.is_file():
        dossie_dst = dossie_dir / f"caso_{caso.id}_dossie.pdf"
        copied_dossie = _copy_file(dossie_path, dossie_dst)
        dossie_entry["arquivo_arquivado_rel"] = dossie_dst.relative_to(snapshot_dir).as_posix()
        dossie_entry["arquivo_arquivado_sha256"] = copied_dossie["sha256"]
        dossie_entry["arquivo_arquivado_tamanho_bytes"] = copied_dossie["tamanho_bytes"]
    else:
        missing_required.append("dossie_pdf_compilado")
    manifest["dossie"] = dossie_entry

    manifest["integridade"]["missing_required_files"] = missing_required
    manifest["integridade"]["missing_required_count"] = len(missing_required)

    if strict_required and missing_required:
        shutil.rmtree(snapshot_dir, ignore_errors=True)
        raise FileNotFoundError(
            "Não foi possível arquivar o caso finalizado. Arquivos ausentes: "
            + ", ".join(missing_required)
        )

    manifest_path = snapshot_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(_serialize_value(manifest), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    latest_dir = case_dir / "latest"
    if latest_dir.exists():
        shutil.rmtree(latest_dir, ignore_errors=True)
    shutil.copytree(snapshot_dir, latest_dir)

    latest_meta = {
        "atualizado_em_utc": _utc_iso(),
        "snapshot_rel": snapshot_dir.relative_to(case_dir).as_posix(),
        "manifest_rel": (snapshot_dir / "manifest.json").relative_to(case_dir).as_posix(),
    }
    (case_dir / "latest_snapshot.json").write_text(
        json.dumps(latest_meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return manifest


def _load_latest_manifest(case_id: int) -> Optional[Dict[str, Any]]:
    manifest_path = _case_archive_dir(case_id) / "latest" / "manifest.json"
    if not manifest_path.is_file():
        return None
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _resolve_rel_path(case_id: int, rel_path: Optional[str]) -> Optional[str]:
    if not rel_path:
        return None
    latest_dir = _case_archive_dir(case_id) / "latest"
    latest_resolved = latest_dir.resolve()

    # Compatibilidade entre separadores de path (Windows/Linux) em manifests legados.
    rel_raw = str(rel_path).strip()
    normalized = rel_raw.replace("\\", "/")
    variants = [rel_raw]
    if normalized != rel_raw:
        variants.append(normalized)

    for rel_variant in variants:
        rel_norm = rel_variant.replace("\\", "/")
        parts = [p for p in rel_norm.split("/") if p and p != "."]
        if not parts or any(p == ".." for p in parts):
            continue
        candidate = (latest_dir.joinpath(*parts)).resolve()
        try:
            candidate.relative_to(latest_resolved)
        except ValueError:
            continue
        if candidate.is_file():
            return str(candidate)

    # Fallback: busca pelo nome do arquivo em toda a pasta latest.
    # Útil quando o manifest legado trouxe separadores/caminhos inválidos.
    file_name = os.path.basename(normalized)
    if file_name:
        for found in latest_dir.rglob(file_name):
            try:
                found_resolved = found.resolve()
                found_resolved.relative_to(latest_resolved)
            except ValueError:
                continue
            if found_resolved.is_file():
                return str(found_resolved)
    return None


def _find_latest_file_by_names(base_dir: Path, names: list[str]) -> Optional[str]:
    if not base_dir.exists():
        return None
    for name in names:
        if not name:
            continue
        matches = []
        for found in base_dir.rglob(name):
            if found.is_file():
                try:
                    matches.append((found.stat().st_mtime, found.resolve()))
                except OSError:
                    continue
        if matches:
            matches.sort(key=lambda item: item[0], reverse=True)
            return str(matches[0][1])
    return None


def resolve_documento_arquivado(case_id: int, documento_id: int) -> Optional[str]:
    manifest = _load_latest_manifest(case_id)
    if not manifest:
        return None
    for doc in manifest.get("documentos") or []:
        if int(doc.get("id") or 0) == int(documento_id):
            return _resolve_rel_path(case_id, doc.get("arquivo_arquivado_rel"))
    return None


def resolve_documento_original_pdf_arquivado(case_id: int, documento_id: int) -> Optional[str]:
    manifest = _load_latest_manifest(case_id)
    if not manifest:
        return None
    for doc in manifest.get("documentos") or []:
        if int(doc.get("id") or 0) == int(documento_id):
            return _resolve_rel_path(case_id, doc.get("arquivo_original_pdf_rel"))
    return None


def resolve_dossie_arquivado(case_id: int) -> Optional[str]:
    manifest = _load_latest_manifest(case_id)
    if manifest:
        dossie = manifest.get("dossie") or {}
        resolved = _resolve_rel_path(case_id, dossie.get("arquivo_arquivado_rel"))
        if resolved:
            return resolved

    case_dir = _case_archive_dir(case_id)
    preferred_names = [f"caso_{int(case_id)}_dossie.pdf", "dossie.pdf"]

    latest_dir = case_dir / "latest"
    found_latest = _find_latest_file_by_names(latest_dir, preferred_names)
    if found_latest:
        return found_latest

    snapshots_dir = case_dir / "snapshots"
    found_snapshots = _find_latest_file_by_names(snapshots_dir, preferred_names)
    if found_snapshots:
        return found_snapshots
    return None


def backfill_archives_for_finalizados(db: Session) -> Dict[str, Any]:
    """
    Reprocessa todos os casos finalizados para criar/atualizar arquivos de retenção.
    """
    casos = (
        db.query(models.CasoGarantia)
        .options(
            joinedload(models.CasoGarantia.cliente),
            joinedload(models.CasoGarantia.criado_por),
            joinedload(models.CasoGarantia.documentos),
            joinedload(models.CasoGarantia.documento_assinaturas).joinedload(models.DocumentoAssinatura.usuario),
            joinedload(models.CasoGarantia.assinaturas).joinedload(models.Assinatura.usuario),
        )
        .filter(models.CasoGarantia.status == "Finalizado")
        .all()
    )

    summary: Dict[str, Any] = {
        "total_finalizados": len(casos),
        "arquivados_ok": 0,
        "arquivados_com_alerta": 0,
        "ja_existiam_ok": 0,
        "erros": [],
    }

    for caso in casos:
        try:
            manifest_existente = _load_latest_manifest(caso.id)
            missing_existente = int(((manifest_existente or {}).get("integridade") or {}).get("missing_required_count") or 0)
            if manifest_existente and missing_existente == 0:
                summary["arquivados_ok"] += 1
                summary["ja_existiam_ok"] += 1
                continue
            manifest = archive_caso_finalizado(caso, strict_required=False)
            missing_count = int((manifest.get("integridade") or {}).get("missing_required_count") or 0)
            if missing_count > 0:
                summary["arquivados_com_alerta"] += 1
            else:
                summary["arquivados_ok"] += 1
        except Exception as exc:
            summary["erros"].append(
                {
                    "case_id": caso.id,
                    "codigo": caso.dji_case_id or f"#{caso.id}",
                    "erro": str(exc),
                }
            )

    return summary
