import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import models  # noqa: F401
from database import SessionLocal, Base, engine
from db_migrations import run_sqlite_migrations
from services.credito_ingest import sync_credito_files_to_db
from services.credito_reconcile import reconcile_credito_to_cases


def main() -> None:
    base_dir = ROOT_DIR
    credito_dir = base_dir / "credito"
    run_sqlite_migrations(engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        sync_summary = sync_credito_files_to_db(db, credito_dir)
        reconcile_summary = reconcile_credito_to_cases(db)
        print("Sincronizacao da base de credito concluida.")
        print("Sync:")
        for key, value in sync_summary.items():
            print(f"- {key}: {value}")
        print("Reconciliacao:")
        for key, value in reconcile_summary.items():
            print(f"- {key}: {value}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
