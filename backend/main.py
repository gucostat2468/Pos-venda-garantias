import os
from pathlib import Path
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database import engine, Base, SessionLocal
from db_migrations import run_sqlite_migrations
import models  # noqa: F401 – garante que as tabelas são registradas
from routers import auth, casos, clientes, usuarios, credito
from services.credito_ingest import sync_credito_files_to_db
from services.credito_reconcile import reconcile_credito_to_cases

# Criar tabelas
run_sqlite_migrations(engine)
Base.metadata.create_all(bind=engine)

# Criar diretórios necessários
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(BASE_DIR, "uploads"), exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, "compiled"), exist_ok=True)

app = FastAPI(
    title="Sistema de Gerenciamento de Garantias – DronePro",
    version="1.0.0",
    description="Plataforma de aprovação de garantias DJI Agriculture"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rotas da API
app.include_router(auth.router, prefix="/api/auth", tags=["Autenticação"])
app.include_router(casos.router, prefix="/api/casos", tags=["Casos de Garantia"])
app.include_router(clientes.router, prefix="/api/clientes", tags=["Clientes"])
app.include_router(usuarios.router, prefix="/api/usuarios", tags=["Usuários"])
app.include_router(credito.router, prefix="/api/credito", tags=["Crédito"])


@app.on_event("startup")
def startup_sync_credito_data():
    db = SessionLocal()
    try:
        sync_credito_files_to_db(db, Path(BASE_DIR) / "credito")
        reconcile_credito_to_cases(db)
    except Exception as exc:
        print(f"Erro ao sincronizar/reconciliar base de credito no startup: {exc}")
    finally:
        db.close()

# Servir o frontend React (build estático)
FRONTEND_DIST = os.path.join(BASE_DIR, "..", "frontend", "dist")
if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str = ""):
        # Não interceptar rotas /api
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        index = os.path.join(FRONTEND_DIST, "index.html")
        return FileResponse(index)


if __name__ == "__main__":
    import uvicorn
    # Importar e executar o seed
    from seed_data import seed_database
    seed_database()
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
