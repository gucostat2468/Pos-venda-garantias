"""
Seed inicial: cria usuários padrão e dados de exemplo.
Executado automaticamente no primeiro start do sistema.
"""
from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
import models
from auth import get_password_hash
from datetime import date


DEFAULT_USERS = [
    {
        "nome": "Administrador",
        "email": "admin@dronepro.com.br",
        "senha": "admin123",
        "papel": "admin",
        "aliases": ["admin@dronepro"],
    },
    {
        "nome": "Time Oficina",
        "email": "operador@dronepro.com.br",
        "senha": "operador123",
        "papel": "operador",
        "aliases": ["operador@dronepro"],
    },
    {
        "nome": "Operador Marabá",
        "email": "operadormaraba@dronepro.com.br",
        "senha": "operador123",
        "papel": "operador",
        "aliases": [
            "operadormaraba@dronepro",
            "operadormarabá@dronepro",
            "operadormarabá@dronepro.com.br",
        ],
    },
    {
        "nome": "Vanier Afonso",
        "email": "gerente@dronepro.com.br",
        "senha": "gerente123",
        "papel": "gerente_pos_venda",
        "aliases": ["gerente@dronepro"],
    },
    {
        "nome": "Marcus Lawder",
        "email": "diretor@dronepro.com.br",
        "senha": "diretor123",
        "papel": "diretor_comercial",
        "aliases": ["diretor@dronepro"],
    },
    {
        "nome": "Gestor Estoque",
        "email": "estoque@dronepro.com.br",
        "senha": "estoque123",
        "papel": "gestor_estoque",
        "aliases": ["estoque@dronepro"],
    },
    {
        "nome": "Gestor Estoque Marabá",
        "email": "estoquemaraba@dronepro.com.br",
        "senha": "estoque123",
        "papel": "gestor_estoque",
        "aliases": [
            "estoquemaraba@dronepro",
            "estoquemarabá@dronepro",
            "estoquemarabá@dronepro.com.br",
        ],
    },
]


def _find_user_by_aliases(db: Session, aliases):
    normalized = [str(v).strip().lower() for v in aliases if str(v).strip()]
    if not normalized:
        return None
    return db.query(models.Usuario).filter(models.Usuario.email.in_(normalized)).first()


def _ensure_default_users(db: Session):
    created = []
    for cfg in DEFAULT_USERS:
        aliases = [cfg["email"], *cfg.get("aliases", [])]
        user = _find_user_by_aliases(db, aliases)
        if user:
            continue
        new_user = models.Usuario(
            nome=cfg["nome"],
            email=cfg["email"],
            senha_hash=get_password_hash(cfg["senha"]),
            papel=cfg["papel"],
            ativo=1,
        )
        db.add(new_user)
        created.append((cfg["email"], cfg["senha"], cfg["papel"]))
    return created


def seed_database():
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        # Se já houver usuários, garante que os usuários padrão adicionais existam.
        if db.query(models.Usuario).count() > 0:
            created_users = _ensure_default_users(db)
            if created_users:
                db.commit()
                for email, senha, papel in created_users:
                    print(f"Usuário adicional criado: {email} / {senha} ({papel})")
            return

        print("Populando banco de dados com dados iniciais...")

        # ─── Usuários ────────────────────────────────────────────────────────
        for cfg in DEFAULT_USERS:
            db.add(models.Usuario(
                nome=cfg["nome"],
                email=cfg["email"],
                senha_hash=get_password_hash(cfg["senha"]),
                papel=cfg["papel"],
            ))
        db.flush()

        # ─── Clientes de Exemplo ──────────────────────────────────────────────
        clientes = [
            models.Cliente(
                razao_social="Pulveriza Drones Ltda",
                cnpj="51.162.926/0002-03",
                email="contabilidade@pulveriza.com.br",
                telefone="(63) 3414-0050"
            ),
            models.Cliente(
                razao_social="Agropecuária Amigos do Campo Ltda",
                cnpj="12.345.678/0001-90",
                email="financeiro@amigosdocampo.com.br",
                telefone="(94) 3456-7890"
            ),
            models.Cliente(
                razao_social="AgroTech Soluções S/A",
                cnpj="98.765.432/0001-10",
                email="suporte@agrotech.com.br",
                telefone="(65) 9876-5432"
            ),
        ]
        for c in clientes:
            db.add(c)
        db.flush()

        # ─── Casos de Exemplo ────────────────────────────────────────────────
        caso1 = models.CasoGarantia(
            dji_case_id="FWRC260216000065",
            tipo_processo="Peca",
            cliente_id=clientes[0].id,
            produto_nome="MOTOR M5 T50 PROPULSION 10033 - BC.AG.SS000668",
            produto_modelo="T50",
            produto_sn="63YBMB700200JD",
            data_entrada=date(2026, 2, 24),
            status="Aguardando Impressão Oficina",
            status_rebate="Aguardando Apuração"
        )
        caso2 = models.CasoGarantia(
            dji_case_id="CAS-30268866-G7Q2J8",
            tipo_processo="Bateria",
            cliente_id=clientes[1].id,
            produto_nome="DB1560 Intelligent Flight Battery",
            produto_modelo="DB1560",
            produto_sn="65VPM4EDA45704",
            data_entrada=date(2026, 3, 1),
            status="Aguardando Aprovação Pós-Venda",
            status_rebate="Não Aplicável"
        )
        caso3 = models.CasoGarantia(
            dji_case_id=None,
            tipo_processo="Peca",
            cliente_id=clientes[2].id,
            produto_nome="Radar Sensing System - Agras T40",
            produto_modelo="T40",
            produto_sn="4ATMD3A00200AB",
            data_entrada=date(2026, 3, 10),
            status="Aguardando Documentos",
            status_rebate="Não Aplicável"
        )
        db.add(caso1)
        db.add(caso2)
        db.add(caso3)
        db.flush()

        # Assinatura de exemplo para o caso1 (já finalizado)
        gerente = db.query(models.Usuario).filter(models.Usuario.papel == "gerente_pos_venda").first()
        diretor = db.query(models.Usuario).filter(models.Usuario.papel == "diretor_comercial").first()

        if gerente:
            db.add(models.Assinatura(
                case_id=caso1.id,
                usuario_id=gerente.id,
                etapa_fluxo="Pos-venda",
                status_decisao="Aprovado",
                observacao="Documentação completa e aprovada."
            ))
        if diretor:
            db.add(models.Assinatura(
                case_id=caso1.id,
                usuario_id=diretor.id,
                etapa_fluxo="Diretoria",
                status_decisao="Aprovado",
                observacao="Aprovado para rebate."
            ))

        db.commit()
        print("Seed concluido com sucesso!")
        print("\nUsuarios criados:")
        print("  admin@dronepro              / admin123     (Administrador)")
        print("  operador@dronepro           / operador123  (Time Oficina)")
        print("  operadormarabá@dronepro     / operador123  (Time Oficina - Marabá)")
        print("  gerente@dronepro            / gerente123   (Vanier Afonso - Gerente Pós-venda)")
        print("  diretor@dronepro            / diretor123   (Marcus Lawder - Diretor Comercial)")
        print("  estoque@dronepro            / estoque123   (Gestor de Estoque SP)")
        print("  estoquemarabá@dronepro      / estoque123   (Gestor de Estoque Marabá)")
        print("  Compatibilidade: também aceita @dronepro.com.br")

    except Exception as e:
        db.rollback()
        print(f"Erro no seed: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
