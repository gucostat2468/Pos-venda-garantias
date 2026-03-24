from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, Text, Float, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(150), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    senha_hash = Column(String(255), nullable=False)
    papel = Column(String(50), nullable=False)  # operador(time oficina) | gerente_pos_venda | diretor_comercial | admin
    ativo = Column(Integer, default=1)
    criado_em = Column(DateTime, default=func.now())

    assinaturas = relationship("Assinatura", back_populates="usuario")
    documento_assinaturas = relationship("DocumentoAssinatura", back_populates="usuario")
    notificacoes = relationship("Notificacao", back_populates="usuario", cascade="all, delete-orphan")


class Cliente(Base):
    __tablename__ = "clientes"

    id = Column(Integer, primary_key=True, index=True)
    razao_social = Column(String(200), nullable=False)
    cnpj = Column(String(20), unique=True, index=True)
    email = Column(String(150))
    telefone = Column(String(30))
    criado_em = Column(DateTime, default=func.now())

    casos = relationship("CasoGarantia", back_populates="cliente")


class CasoGarantia(Base):
    __tablename__ = "casos_garantia"

    id = Column(Integer, primary_key=True, index=True)
    dji_case_id = Column(String(50), index=True)
    tipo_processo = Column(String(20), nullable=False)  # Peca | Bateria
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=False)
    produto_nome = Column(String(200))
    produto_modelo = Column(String(100))
    produto_sn = Column(String(100))
    data_entrada = Column(Date, nullable=False)
    status = Column(String(50), default="Aguardando Documentos")
    # Status: Aguardando Documentos | Aguardando Aprovação Pós-Venda |
    #         Aguardando Aprovação Diretoria | Aguardando Impressão Oficina | Finalizado | Reprovado
    status_rebate = Column(String(50), default="Não Aplicável")
    # Status Rebate: Não Aplicável | Aguardando Apuração | Finalizado | Apurado
    link_pdf_compilado = Column(String(500))
    observacoes = Column(Text)
    criado_em = Column(DateTime, default=func.now())
    atualizado_em = Column(DateTime, default=func.now(), onupdate=func.now())

    cliente = relationship("Cliente", back_populates="casos")
    documentos = relationship("Documento", back_populates="caso", cascade="all, delete-orphan")
    assinaturas = relationship("Assinatura", back_populates="caso", cascade="all, delete-orphan")
    documento_assinaturas = relationship("DocumentoAssinatura", back_populates="caso", cascade="all, delete-orphan")
    notificacoes = relationship("Notificacao", back_populates="caso")


class Documento(Base):
    __tablename__ = "documentos"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("casos_garantia.id"), nullable=False)
    tipo_documento = Column(String(100), nullable=False)
    nome_arquivo = Column(String(255), nullable=False)
    path_arquivo = Column(String(500), nullable=False)
    mime_type = Column(String(100))
    tamanho_bytes = Column(Integer)
    data_upload = Column(DateTime, default=func.now())

    caso = relationship("CasoGarantia", back_populates="documentos")
    assinaturas_documento = relationship("DocumentoAssinatura", back_populates="documento", cascade="all, delete-orphan")


class DocumentoAssinatura(Base):
    __tablename__ = "documento_assinaturas"
    __table_args__ = (
        UniqueConstraint("case_id", "documento_id", "usuario_id", "etapa_fluxo", name="uq_doc_assinatura_unica"),
    )

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("casos_garantia.id"), nullable=False, index=True)
    documento_id = Column(Integer, ForeignKey("documentos.id"), nullable=False, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    etapa_fluxo = Column(String(50), nullable=False)  # Pos-venda | Diretoria
    path_assinatura = Column(String(500), nullable=False)
    data_assinatura = Column(DateTime, default=func.now())

    caso = relationship("CasoGarantia", back_populates="documento_assinaturas")
    documento = relationship("Documento", back_populates="assinaturas_documento")
    usuario = relationship("Usuario", back_populates="documento_assinaturas")


class Assinatura(Base):
    __tablename__ = "assinaturas"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("casos_garantia.id"), nullable=False)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    etapa_fluxo = Column(String(50), nullable=False)  # Pos-venda | Diretoria (diretor comercial)
    status_decisao = Column(String(20), nullable=False)  # Aprovado | Reprovado
    observacao = Column(Text)
    data_assinatura = Column(DateTime, default=func.now())

    caso = relationship("CasoGarantia", back_populates="assinaturas")
    usuario = relationship("Usuario", back_populates="assinaturas")


class Notificacao(Base):
    __tablename__ = "notificacoes"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    case_id = Column(Integer, ForeignKey("casos_garantia.id", ondelete="SET NULL"), nullable=True, index=True)
    tipo = Column(String(80), nullable=False, index=True)
    titulo = Column(String(180), nullable=False)
    mensagem = Column(String(600), nullable=False)
    lida = Column(Integer, default=0, index=True)
    criado_em = Column(DateTime, default=func.now(), index=True)
    lida_em = Column(DateTime, nullable=True)

    usuario = relationship("Usuario", back_populates="notificacoes")
    caso = relationship("CasoGarantia", back_populates="notificacoes")


class CreditoExtrato(Base):
    __tablename__ = "credito_extratos"
    __table_args__ = (
        UniqueConstraint("arquivo_caminho_relativo", "arquivo_sha256", name="uq_credito_arquivo_hash"),
    )

    id = Column(Integer, primary_key=True, index=True)
    arquivo_nome = Column(String(255), nullable=False)
    arquivo_caminho_relativo = Column(String(500), nullable=False, index=True)
    arquivo_sha256 = Column(String(64), nullable=False, index=True)
    arquivo_tamanho_bytes = Column(Integer, nullable=False)

    competencia_nome = Column(String(50), nullable=True)
    competencia_mes = Column(Integer, nullable=True, index=True)
    competencia_ano = Column(Integer, nullable=True, index=True)
    competencia_data = Column(Date, nullable=True, index=True)

    planilha_nome = Column(String(255), nullable=True)
    dealer_nome = Column(String(255), nullable=True, index=True)
    dealer_account = Column(String(120), nullable=True, index=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=True, index=True)

    total_expenditure = Column(Float, nullable=True)
    total_income = Column(Float, nullable=True)
    credit_balance = Column(Float, nullable=True)
    total_prepayment = Column(Float, nullable=True)

    raw_rows_json = Column(Text, nullable=True)
    importado_em = Column(DateTime, default=func.now(), index=True)

    cliente = relationship("Cliente")
    lancamentos = relationship(
        "CreditoLancamento",
        back_populates="extrato",
        cascade="all, delete-orphan",
    )
    vinculos_cliente = relationship(
        "CreditoClienteVinculo",
        back_populates="extrato",
        cascade="all, delete-orphan",
    )
    vinculos_caso = relationship(
        "CreditoCasoVinculo",
        back_populates="extrato",
        cascade="all, delete-orphan",
    )


class CreditoLancamento(Base):
    __tablename__ = "credito_lancamentos"

    id = Column(Integer, primary_key=True, index=True)
    extrato_id = Column(Integer, ForeignKey("credito_extratos.id"), nullable=False, index=True)
    linha_planilha = Column(Integer, nullable=False, index=True)
    secao = Column(String(50), nullable=True, index=True)  # expenditure | income | pre_payment | summary
    indice_item = Column(Integer, nullable=True)
    descricao = Column(String(255), nullable=True, index=True)
    valor = Column(Float, nullable=True)
    observacao = Column(String(500), nullable=True)
    raw_row_json = Column(Text, nullable=True)

    extrato = relationship("CreditoExtrato", back_populates="lancamentos")
    vinculos_caso = relationship(
        "CreditoCasoVinculo",
        back_populates="lancamento",
        cascade="all, delete-orphan",
    )


class CreditoClienteVinculo(Base):
    __tablename__ = "credito_cliente_vinculos"
    __table_args__ = (
        UniqueConstraint("extrato_id", "cliente_id", name="uq_credito_extrato_cliente"),
    )

    id = Column(Integer, primary_key=True, index=True)
    extrato_id = Column(Integer, ForeignKey("credito_extratos.id"), nullable=False, index=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=False, index=True)
    score = Column(Float, nullable=True)
    metodo = Column(String(50), nullable=True)
    detalhes_json = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=func.now(), index=True)

    extrato = relationship("CreditoExtrato", back_populates="vinculos_cliente")
    cliente = relationship("Cliente")


class CreditoCasoVinculo(Base):
    __tablename__ = "credito_caso_vinculos"
    __table_args__ = (
        UniqueConstraint("lancamento_id", "caso_id", name="uq_credito_lancamento_caso"),
    )

    id = Column(Integer, primary_key=True, index=True)
    extrato_id = Column(Integer, ForeignKey("credito_extratos.id"), nullable=False, index=True)
    lancamento_id = Column(Integer, ForeignKey("credito_lancamentos.id"), nullable=False, index=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=False, index=True)
    caso_id = Column(Integer, ForeignKey("casos_garantia.id"), nullable=False, index=True)
    valor_lancamento = Column(Float, nullable=True)
    valor_alocado = Column(Float, nullable=True)
    score = Column(Float, nullable=True)
    metodo = Column(String(50), nullable=True)
    detalhes_json = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=func.now(), index=True)

    extrato = relationship("CreditoExtrato", back_populates="vinculos_caso")
    lancamento = relationship("CreditoLancamento", back_populates="vinculos_caso")
    cliente = relationship("Cliente")
    caso = relationship("CasoGarantia")
