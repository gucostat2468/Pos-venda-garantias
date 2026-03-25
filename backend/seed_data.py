"""
Seed inicial: cria usuários padrão e dados de exemplo.
Executado automaticamente no primeiro start do sistema.
"""
from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
import models
from auth import get_password_hash
from datetime import date


def seed_database():
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        # Se já houver usuários, garante que os usuários padrão adicionais existam.
        if db.query(models.Usuario).count() > 0:
            usuario_maraba = db.query(models.Usuario).filter(
                models.Usuario.email == "operadormarabá@dronepro"
            ).first()
            if not usuario_maraba:
                db.add(models.Usuario(
                    nome="Operador Marabá",
                    email="operadormarabá@dronepro",
                    senha_hash=get_password_hash("operador123"),
                    papel="operador",
                    ativo=1,
                ))
                db.commit()
                print("Usuário adicional criado: operadormarabá@dronepro / operador123")
            return

        print("Populando banco de dados com dados iniciais...")

        # ─── Usuários ────────────────────────────────────────────────────────
        usuarios = [
            models.Usuario(
                nome="Administrador",
                email="admin@dronepro",
                senha_hash=get_password_hash("admin123"),
                papel="admin"
            ),
            models.Usuario(
                nome="Time Oficina",
                email="operador@dronepro",
                senha_hash=get_password_hash("operador123"),
                papel="operador"
            ),
            models.Usuario(
                nome="Operador Marabá",
                email="operadormarabá@dronepro",
                senha_hash=get_password_hash("operador123"),
                papel="operador"
            ),
            models.Usuario(
                nome="Vanier Afonso",
                email="gerente@dronepro",
                senha_hash=get_password_hash("gerente123"),
                papel="gerente_pos_venda"
            ),
            models.Usuario(
                nome="Marcus Lawder",
                email="diretor@dronepro",
                senha_hash=get_password_hash("diretor123"),
                papel="diretor_comercial"
            ),
        ]
        for u in usuarios:
            db.add(u)
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

    except Exception as e:
        db.rollback()
        print(f"Erro no seed: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
