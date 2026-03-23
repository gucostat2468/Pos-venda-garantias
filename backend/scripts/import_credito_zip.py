from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_TARGET_DIR = BASE_DIR / "credito"
DEFAULT_MANIFEST_PATH = DEFAULT_TARGET_DIR / "manifest.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_zip_entry(name: str) -> PurePosixPath | None:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        return None
    return path


def entry_to_relative_path(entry: PurePosixPath) -> Path | None:
    parts = list(entry.parts)
    if not parts:
        return None
    if parts[0].lower() == "credito":
        parts = parts[1:]
    if not parts:
        return None
    return Path(*parts)


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "version": 1,
            "created_at_utc": utc_now_iso(),
            "updated_at_utc": utc_now_iso(),
            "imports": [],
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {}

    imports = data.get("imports")
    if not isinstance(imports, list):
        imports = []

    created_at = data.get("created_at_utc") or utc_now_iso()
    return {
        "version": 1,
        "created_at_utc": created_at,
        "updated_at_utc": utc_now_iso(),
        "imports": imports,
    }


def ensure_unique_conflict_path(base_path: Path, content_hash: str) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = f".{timestamp}.{content_hash[:8]}"
    candidate = base_path.with_name(f"{base_path.stem}{suffix}{base_path.suffix}")
    index = 1
    while candidate.exists():
        candidate = base_path.with_name(
            f"{base_path.stem}{suffix}.{index}{base_path.suffix}"
        )
        index += 1
    return candidate


def import_zip(zip_path: Path, target_dir: Path, manifest_path: Path) -> dict[str, int]:
    if not zip_path.exists():
        raise FileNotFoundError(f"ZIP nao encontrado: {zip_path}")

    target_dir.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(manifest_path)

    summary = {
        "processed": 0,
        "imported_new": 0,
        "already_present": 0,
        "conflict_kept_both": 0,
        "skipped_invalid_path": 0,
        "skipped_directory": 0,
    }

    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in sorted(zf.infolist(), key=lambda x: x.filename.lower()):
            if info.is_dir():
                summary["skipped_directory"] += 1
                continue

            safe_entry = safe_zip_entry(info.filename)
            if safe_entry is None:
                summary["skipped_invalid_path"] += 1
                continue

            relative = entry_to_relative_path(safe_entry)
            if relative is None:
                summary["skipped_invalid_path"] += 1
                continue

            data = zf.read(info.filename)
            incoming_hash = sha256_bytes(data)
            final_path = target_dir / relative
            final_path.parent.mkdir(parents=True, exist_ok=True)

            if final_path.exists():
                existing_hash = sha256_file(final_path)
                if existing_hash == incoming_hash:
                    status = "already_present"
                    stored_path = final_path
                    summary["already_present"] += 1
                else:
                    stored_path = ensure_unique_conflict_path(final_path, incoming_hash)
                    stored_path.write_bytes(data)
                    status = "conflict_kept_both"
                    summary["conflict_kept_both"] += 1
            else:
                final_path.write_bytes(data)
                stored_path = final_path
                status = "imported_new"
                summary["imported_new"] += 1

            summary["processed"] += 1
            manifest["imports"].append(
                {
                    "imported_at_utc": utc_now_iso(),
                    "source_zip": str(zip_path),
                    "zip_entry": info.filename,
                    "stored_relative_path": stored_path.relative_to(target_dir).as_posix(),
                    "size_bytes": len(data),
                    "sha256": incoming_hash,
                    "status": status,
                }
            )

    manifest["updated_at_utc"] = utc_now_iso()
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Importa planilhas de credito a partir de um arquivo ZIP sem sobrescrever dados "
            "(mantem ambos em caso de conflito)."
        )
    )
    parser.add_argument(
        "--zip",
        required=True,
        help="Caminho do arquivo ZIP de origem.",
    )
    parser.add_argument(
        "--target-dir",
        default=str(DEFAULT_TARGET_DIR),
        help=f"Diretorio de destino (padrao: {DEFAULT_TARGET_DIR}).",
    )
    parser.add_argument(
        "--manifest",
        default=str(DEFAULT_MANIFEST_PATH),
        help=f"Arquivo de manifesto (padrao: {DEFAULT_MANIFEST_PATH}).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    zip_path = Path(args.zip)
    target_dir = Path(args.target_dir)
    manifest_path = Path(args.manifest)

    summary = import_zip(zip_path, target_dir, manifest_path)

    print("Importacao concluida.")
    for key, value in summary.items():
        print(f"- {key}: {value}")
    print(f"- destino: {target_dir}")
    print(f"- manifesto: {manifest_path}")


if __name__ == "__main__":
    main()

