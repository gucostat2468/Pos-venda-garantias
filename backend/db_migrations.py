from __future__ import annotations

from sqlalchemy import text


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:name"),
        {"name": table_name},
    ).fetchone()
    return row is not None


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info('{table_name}')")).fetchall()
    return any(str(row[1]) == column_name for row in rows)


def run_sqlite_migrations(engine) -> None:
    if not str(engine.url).startswith("sqlite"):
        return

    with engine.begin() as conn:
        if _table_exists(conn, "credito_extratos") and not _column_exists(conn, "credito_extratos", "cliente_id"):
            conn.execute(text("ALTER TABLE credito_extratos ADD COLUMN cliente_id INTEGER"))

