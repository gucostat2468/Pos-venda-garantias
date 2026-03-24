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

        if not _table_exists(conn, "notificacoes"):
            conn.execute(text("""
                CREATE TABLE notificacoes (
                    id INTEGER PRIMARY KEY,
                    usuario_id INTEGER NOT NULL,
                    case_id INTEGER,
                    tipo VARCHAR(80) NOT NULL,
                    titulo VARCHAR(180) NOT NULL,
                    mensagem VARCHAR(600) NOT NULL,
                    lida INTEGER DEFAULT 0,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                    lida_em DATETIME,
                    FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
                    FOREIGN KEY(case_id) REFERENCES casos_garantia(id) ON DELETE SET NULL
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notificacoes_usuario_id ON notificacoes(usuario_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notificacoes_case_id ON notificacoes(case_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notificacoes_lida ON notificacoes(lida)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notificacoes_criado_em ON notificacoes(criado_em)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notificacoes_tipo ON notificacoes(tipo)"))
