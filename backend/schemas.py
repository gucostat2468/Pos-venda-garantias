from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict
from datetime import datetime, date


# ─── Auth ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    senha: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    usuario: "UsuarioOut"

class PasswordChange(BaseModel):
    senha_atual: str
    nova_senha: str


# ─── Usuario ─────────────────────────────────────────────────────────────────

class UsuarioCreate(BaseModel):
    nome: str
    email: str
    senha: str
    papel: str  # operador(time oficina) | gerente_pos_venda | diretor_comercial | admin

class UsuarioUpdate(BaseModel):
    nome: Optional[str] = None
    email: Optional[str] = None
    papel: Optional[str] = None
    ativo: Optional[int] = None

class UsuarioOut(BaseModel):
    id: int
    nome: str
    email: str
    papel: str
    ativo: int
    criado_em: Optional[datetime] = None

    class Config:
        from_attributes = True


# ─── Cliente ──────────────────────────────────────────────────────────────────

class ClienteCreate(BaseModel):
    razao_social: str
    cnpj: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None

class ClienteUpdate(BaseModel):
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None

class ClienteOut(BaseModel):
    id: int
    razao_social: str
    cnpj: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    criado_em: Optional[datetime] = None

    class Config:
        from_attributes = True


# ─── Documento ────────────────────────────────────────────────────────────────

class DocumentoOut(BaseModel):
    id: int
    case_id: int
    tipo_documento: str
    nome_arquivo: str
    mime_type: Optional[str] = None
    tamanho_bytes: Optional[int] = None
    data_upload: Optional[datetime] = None

    class Config:
        from_attributes = True


class DocumentoAssinaturaCreate(BaseModel):
    assinatura_data_url: str


class DocumentoAssinaturaOut(BaseModel):
    id: int
    case_id: int
    documento_id: int
    usuario_id: int
    etapa_fluxo: str
    data_assinatura: Optional[datetime] = None
    usuario: Optional[UsuarioOut] = None

    class Config:
        from_attributes = True


# ─── Assinatura ───────────────────────────────────────────────────────────────

class AssinarRequest(BaseModel):
    status_decisao: str   # Aprovado | Reprovado
    observacao: Optional[str] = None

class AssinaturaOut(BaseModel):
    id: int
    case_id: int
    etapa_fluxo: str
    status_decisao: str
    observacao: Optional[str] = None
    data_assinatura: Optional[datetime] = None
    usuario: Optional[UsuarioOut] = None

    class Config:
        from_attributes = True


# ─── Caso de Garantia ─────────────────────────────────────────────────────────

class CasoCreate(BaseModel):
    dji_case_id: Optional[str] = None
    tipo_processo: str           # Peca | Bateria
    cliente_id: int
    produto_nome: Optional[str] = None
    produto_modelo: Optional[str] = None
    produto_sn: Optional[str] = None
    data_entrada: date
    observacoes: Optional[str] = None

class CasoUpdate(BaseModel):
    dji_case_id: Optional[str] = None
    tipo_processo: Optional[str] = None
    cliente_id: Optional[int] = None
    produto_nome: Optional[str] = None
    produto_modelo: Optional[str] = None
    produto_sn: Optional[str] = None
    data_entrada: Optional[date] = None
    observacoes: Optional[str] = None
    status_rebate: Optional[str] = None

class CasoOut(BaseModel):
    id: int
    dji_case_id: Optional[str] = None
    tipo_processo: str
    cliente_id: int
    produto_nome: Optional[str] = None
    produto_modelo: Optional[str] = None
    produto_sn: Optional[str] = None
    data_entrada: date
    status: str
    status_rebate: str
    link_pdf_compilado: Optional[str] = None
    observacoes: Optional[str] = None
    criado_em: Optional[datetime] = None
    atualizado_em: Optional[datetime] = None
    cliente: Optional[ClienteOut] = None
    documentos: Optional[List[DocumentoOut]] = []
    documento_assinaturas: Optional[List[DocumentoAssinaturaOut]] = []
    assinaturas: Optional[List[AssinaturaOut]] = []

    class Config:
        from_attributes = True

class CasoListOut(BaseModel):
    id: int
    dji_case_id: Optional[str] = None
    tipo_processo: str
    produto_nome: Optional[str] = None
    produto_modelo: Optional[str] = None
    produto_sn: Optional[str] = None
    data_entrada: date
    status: str
    status_rebate: str
    criado_em: Optional[datetime] = None
    atualizado_em: Optional[datetime] = None
    cliente: Optional[ClienteOut] = None

    class Config:
        from_attributes = True


# ─── Dashboard ────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_casos: int
    aguardando_documentos: int
    aguardando_aprovacao: int
    finalizados: int
    reprovados: int
    rebate_aguardando_apuracao: int


# ─── Notificações ────────────────────────────────────────────────────────────

class NotificacaoOut(BaseModel):
    id: int
    usuario_id: int
    case_id: Optional[int] = None
    tipo: str
    titulo: str
    mensagem: str
    lida: int
    criado_em: Optional[datetime] = None
    lida_em: Optional[datetime] = None

    class Config:
        from_attributes = True


class NotificacaoResumoOut(BaseModel):
    total: int
    nao_lidas: int


class NotificacaoMarcarTodasOut(BaseModel):
    message: str
    total: int


# ─── Auditoria ───────────────────────────────────────────────────────────────

class AuditoriaEventoOut(BaseModel):
    id: int
    usuario_id: Optional[int] = None
    case_id: Optional[int] = None
    acao: str
    modulo: str
    entidade: Optional[str] = None
    entidade_id: Optional[int] = None
    descricao: str
    status: str
    detalhes_json: Optional[str] = None
    criado_em: Optional[datetime] = None
    usuario: Optional[UsuarioOut] = None

    class Config:
        from_attributes = True


class AuditoriaResumoOut(BaseModel):
    total: int
    total_sucesso: int
    total_falha: int
    por_modulo: Dict[str, int]
    por_acao: Dict[str, int]
    ultimo_evento_em: Optional[datetime] = None


# ─── Credito ─────────────────────────────────────────────────────────────────

class CreditoArquivoOut(BaseModel):
    nome_arquivo: str
    caminho_relativo: str
    tamanho_bytes: int
    sha256: str
    atualizado_em: Optional[datetime] = None


class CreditoLancamentoOut(BaseModel):
    id: int
    linha_planilha: int
    secao: Optional[str] = None
    indice_item: Optional[int] = None
    descricao: Optional[str] = None
    valor: Optional[float] = None
    observacao: Optional[str] = None

    class Config:
        from_attributes = True


class CreditoExtratoOut(BaseModel):
    id: int
    arquivo_nome: str
    arquivo_caminho_relativo: str
    cliente_id: Optional[int] = None
    competencia_nome: Optional[str] = None
    competencia_mes: Optional[int] = None
    competencia_ano: Optional[int] = None
    competencia_data: Optional[date] = None
    dealer_nome: Optional[str] = None
    dealer_account: Optional[str] = None
    total_expenditure: Optional[float] = None
    total_income: Optional[float] = None
    credit_balance: Optional[float] = None
    total_prepayment: Optional[float] = None
    importado_em: Optional[datetime] = None
    lancamentos: Optional[List[CreditoLancamentoOut]] = []

    class Config:
        from_attributes = True


class CreditoExtratoResumoOut(BaseModel):
    id: int
    arquivo_nome: str
    competencia_nome: Optional[str] = None
    competencia_mes: Optional[int] = None
    competencia_ano: Optional[int] = None
    dealer_nome: Optional[str] = None

    class Config:
        from_attributes = True


class CreditoClienteVinculoOut(BaseModel):
    id: int
    extrato_id: int
    cliente_id: int
    score: Optional[float] = None
    metodo: Optional[str] = None
    criado_em: Optional[datetime] = None
    cliente: Optional[ClienteOut] = None
    extrato: Optional[CreditoExtratoResumoOut] = None

    class Config:
        from_attributes = True


class CreditoCasoVinculoOut(BaseModel):
    id: int
    extrato_id: int
    lancamento_id: int
    cliente_id: int
    caso_id: int
    valor_lancamento: Optional[float] = None
    valor_alocado: Optional[float] = None
    score: Optional[float] = None
    metodo: Optional[str] = None
    criado_em: Optional[datetime] = None
    extrato: Optional[CreditoExtratoResumoOut] = None
    lancamento: Optional[CreditoLancamentoOut] = None

    class Config:
        from_attributes = True

TokenResponse.model_rebuild()
