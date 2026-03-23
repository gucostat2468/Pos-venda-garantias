import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import models  # noqa: F401
from database import SessionLocal, Base, engine
from db_migrations import run_sqlite_migrations
from services.credito_reconcile import reconcile_credito_to_cases


def main() -> None:
    run_sqlite_migrations(engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        summary = reconcile_credito_to_cases(db)
        print("Reconciliacao concluida.")
        for key, value in summary.items():
            print(f"- {key}: {value}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
