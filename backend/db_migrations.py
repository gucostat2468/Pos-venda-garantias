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

        if not _table_exists(conn, "auditoria_eventos"):
            conn.execute(text("""
                CREATE TABLE auditoria_eventos (
                    id INTEGER PRIMARY KEY,
                    usuario_id INTEGER,
                    case_id INTEGER,
                    acao VARCHAR(120) NOT NULL,
                    modulo VARCHAR(80) NOT NULL,
                    entidade VARCHAR(80),
                    entidade_id INTEGER,
                    descricao VARCHAR(500) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'sucesso',
                    detalhes_json TEXT,
                    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
                )
            """))

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auditoria_eventos_usuario_id ON auditoria_eventos(usuario_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auditoria_eventos_case_id ON auditoria_eventos(case_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auditoria_eventos_acao ON auditoria_eventos(acao)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auditoria_eventos_modulo ON auditoria_eventos(modulo)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auditoria_eventos_entidade ON auditoria_eventos(entidade)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auditoria_eventos_entidade_id ON auditoria_eventos(entidade_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auditoria_eventos_status ON auditoria_eventos(status)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auditoria_eventos_criado_em ON auditoria_eventos(criado_em)"))
