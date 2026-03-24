import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { casosAPI, clientesAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'
import useMediaQuery from '../hooks/useMediaQuery'

const DOCS_FLUXO_OFICINA = [
  {
    key: 'remessa',
    label: 'Remessa (Documento de separação dos itens no estoque)',
    tipo_documento: 'Remessa (Documento de separação dos itens no estoque)',
    obrigatorio: true,
    descricao: 'Obrigatório para liberar a etapa de assinatura.',
    accept: '.pdf',
  },
  {
    key: 'caso_aprovacao_dji',
    label: 'Caso de aprovação DJI',
    tipo_documento: 'Caso de aprovação DJI',
    obrigatorio: false,
    descricao: 'Opcional, anexar o documento oficial do caso de aprovação DJI quando disponível.',
    accept: '.pdf',
  },
  {
    key: 'nf_remessa',
    label: 'Nota Fiscal de remessa para garantia',
    tipo_documento: 'Nota Fiscal de Remessa para Garantia',
    obrigatorio: false,
    descricao: 'Opcional, anexar quando houver nota fiscal emitida pelo sub-dealer.',
    accept: '.pdf',
  },
  {
    key: 'relatorio_tecnico',
    label: 'Relatório técnico',
    tipo_documento: 'Relatório Técnico',
    obrigatorio: false,
    descricao: 'Opcional, anexar quando houver relatório técnico do atendimento.',
    accept: '.pdf',
  },
]

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '-'
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

export default function NovoCaso() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const navigate = useNavigate()
  const { isAdmin, isOperador } = useAuth()
  const podeAbrirCaso = isAdmin || isOperador

  const [clientes, setClientes] = useState([])
  const [form, setForm] = useState({
    dji_case_id: '',
    tipo_processo: 'Peca',
    cliente_id: '',
    produto_nome: '',
    produto_modelo: '',
    produto_sn: '',
    data_entrada: new Date().toISOString().split('T')[0],
    observacoes: '',
  })
  const [docs, setDocs] = useState({
    remessa: null,
    caso_aprovacao_dji: null,
    nf_remessa: null,
    relatorio_tecnico: null,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [novoClienteModal, setNovoClienteModal] = useState(false)
  const [novoCliente, setNovoCliente] = useState({ razao_social: '', cnpj: '', email: '', telefone: '' })
  const [criandoCliente, setCriandoCliente] = useState(false)

  useEffect(() => {
    clientesAPI.listar().then(r => setClientes(r.data)).catch(() => {})
  }, [])

  const handleChange = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  const handleDocChange = (key) => (e) => {
    const file = e.target.files?.[0] || null
    setDocs((prev) => ({ ...prev, [key]: file }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!podeAbrirCaso) {
      setError('Somente Time Oficina (ou administrador) pode abrir caso e anexar documentos.')
      return
    }
    if (!form.cliente_id) {
      setError('Selecione o cliente')
      return
    }
    if (!docs.remessa) {
      setError('Anexe a Remessa (obrigatória) para iniciar a esteira corretamente.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const payload = { ...form, cliente_id: parseInt(form.cliente_id, 10) }
      if (!payload.dji_case_id) delete payload.dji_case_id
      if (!payload.observacoes) delete payload.observacoes

      const res = await casosAPI.criar(payload)
      const novoCasoId = res.data.id

      const falhas = []
      const filaUpload = DOCS_FLUXO_OFICINA.filter((cfg) => docs[cfg.key]).map((cfg) => ({
        tipo_documento: cfg.tipo_documento,
        arquivo: docs[cfg.key],
        label: cfg.label,
      }))

      for (const item of filaUpload) {
        try {
          const formData = new FormData()
          formData.append('tipo_documento', item.tipo_documento)
          formData.append('arquivo', item.arquivo)
          await casosAPI.uploadDocumento(novoCasoId, formData)
        } catch (err) {
          falhas.push(`${item.label}: ${err.response?.data?.detail || 'falha no upload'}`)
        }
      }

      if (falhas.length > 0) {
        alert(`Caso criado, porém alguns documentos não foram anexados:\n\n${falhas.join('\n')}`)
      }

      navigate(`/casos/${novoCasoId}`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Erro ao criar caso')
    } finally {
      setLoading(false)
    }
  }

  const handleCriarCliente = async (e) => {
    e.preventDefault()
    setCriandoCliente(true)
    try {
      const res = await clientesAPI.criar(novoCliente)
      setClientes(prev => [...prev, res.data])
      setForm(prev => ({ ...prev, cliente_id: String(res.data.id) }))
      setNovoClienteModal(false)
      setNovoCliente({ razao_social: '', cnpj: '', email: '', telefone: '' })
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao criar cliente')
    } finally {
      setCriandoCliente(false)
    }
  }

  return (
    <div style={{ maxWidth: 840 }}>
      <div style={s.header}>
        <Link to="/casos" style={s.backBtn}>← Voltar</Link>
        <div>
          <h1 style={s.title}>Novo Caso de Garantia</h1>
          <p style={s.subtitle}>Time Oficina abre o caso, anexa documentos e libera a esteira de assinatura</p>
        </div>
      </div>

      {!podeAbrirCaso && (
        <div style={s.warnBox}>
          Abertura de caso e anexação inicial são permitidas apenas para Time Oficina e administrador.
        </div>
      )}

      {error && <div style={s.errorBox}>⚠️ {error}</div>}

      <form onSubmit={handleSubmit}>
        <div style={s.card}>
          <h3 style={s.cardTitle}>Esteira Oficial de Aprovação</h3>
          <div style={{ ...s.pipelineGrid, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
            <Step number={1} title="Time Oficina" text="Cria o caso e anexa os documentos obrigatórios." />
            <Step number={2} title="Gerente Pós-venda" text="Vanier Afonso assina digitalmente." />
            <Step number={3} title="Diretor Comercial" text="Marcus Lawder realiza a segunda assinatura." />
            <Step number={4} title="Time Oficina" text="Imprime em 3 vias: Financeiro, Estoque e Controle da Oficina." />
          </div>
        </div>

        <div style={s.card}>
          <h3 style={s.cardTitle}>Tipo de Processo</h3>
          <div style={{ ...s.tipoGrid, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
            {['Peca', 'Bateria'].map((tipo) => (
              <label
                key={tipo}
                style={{
                  ...s.tipoOption,
                  ...(form.tipo_processo === tipo ? s.tipoOptionActive : {}),
                }}
              >
                <input
                  type="radio"
                  name="tipo_processo"
                  value={tipo}
                  checked={form.tipo_processo === tipo}
                  onChange={handleChange('tipo_processo')}
                  style={{ display: 'none' }}
                  disabled={!podeAbrirCaso}
                />
                <span style={{ fontSize: 28, display: 'block', marginBottom: 6 }}>
                  {tipo === 'Peca' ? '🔧' : '🔋'}
                </span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  {tipo === 'Peca' ? 'Garantia de Peça' : 'Garantia de Bateria'}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div style={s.card}>
          <h3 style={s.cardTitle}>Cliente</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: isMobile ? '100%' : 260 }}>
              <label style={s.label}>Cliente *</label>
              <select
                value={form.cliente_id}
                onChange={handleChange('cliente_id')}
                required
                style={s.select}
                disabled={!podeAbrirCaso}
              >
                <option value="">Selecione o cliente...</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.razao_social}{c.cnpj ? ` (${c.cnpj})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => setNovoClienteModal(true)} style={s.outlineBtn} disabled={!podeAbrirCaso}>
              + Novo Cliente
            </button>
          </div>
        </div>

        <div style={s.card}>
          <h3 style={s.cardTitle}>Dados do Produto</h3>
          <div style={{ ...s.grid2, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
            <div>
              <label style={s.label}>ID do Caso DJI</label>
              <input type="text" value={form.dji_case_id} onChange={handleChange('dji_case_id')} style={s.input} disabled={!podeAbrirCaso} />
            </div>
            <div>
              <label style={s.label}>Data de Entrada *</label>
              <input type="date" value={form.data_entrada} onChange={handleChange('data_entrada')} required style={s.input} disabled={!podeAbrirCaso} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={s.label}>Nome Completo do Produto</label>
              <input type="text" value={form.produto_nome} onChange={handleChange('produto_nome')} style={s.input} disabled={!podeAbrirCaso} />
            </div>
            <div>
              <label style={s.label}>Modelo</label>
              <input type="text" value={form.produto_modelo} onChange={handleChange('produto_modelo')} style={s.input} disabled={!podeAbrirCaso} />
            </div>
            <div>
              <label style={s.label}>Número de Série (SN)</label>
              <input type="text" value={form.produto_sn} onChange={handleChange('produto_sn')} style={{ ...s.input, fontFamily: 'monospace' }} disabled={!podeAbrirCaso} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={s.label}>Observações</label>
              <textarea value={form.observacoes} onChange={handleChange('observacoes')} rows={3} style={{ ...s.input, resize: 'vertical' }} disabled={!podeAbrirCaso} />
            </div>
          </div>
        </div>

        <div style={s.card}>
          <h3 style={s.cardTitle}>Etapa 1: Anexação de Documentos (Time Oficina)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {DOCS_FLUXO_OFICINA.map((doc) => (
              <div key={doc.key} style={s.docRow}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {doc.label} {doc.obrigatorio ? '(Obrigatório)' : '(Opcional)'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{doc.descricao}</div>
                  {docs[doc.key] && (
                    <div style={{ fontSize: 12, color: '#065f46', marginTop: 5 }}>
                      Arquivo selecionado: {docs[doc.key].name} ({formatFileSize(docs[doc.key].size)})
                    </div>
                  )}
                </div>
                <label style={{ ...s.docBtn, ...(podeAbrirCaso ? {} : s.docBtnDisabled) }}>
                  Selecionar PDF
                  <input
                    type="file"
                    accept={doc.accept}
                    style={{ display: 'none' }}
                    onChange={handleDocChange(doc.key)}
                    disabled={!podeAbrirCaso}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Link to="/casos" style={s.cancelBtn}>Cancelar</Link>
          <button type="submit" disabled={loading || !podeAbrirCaso} style={s.submitBtn}>
            {loading ? 'Criando caso e enviando documentos...' : '✓ Criar Caso + Iniciar Esteira de Assinatura'}
          </button>
        </div>
      </form>

      {novoClienteModal && (
        <div style={s.modalOverlay}>
          <div style={s.modal}>
            <h3 style={{ marginBottom: 20, fontSize: 18, fontWeight: 700 }}>Novo Cliente</h3>
            <form onSubmit={handleCriarCliente}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={s.label}>Razão Social *</label>
                  <input
                    type="text"
                    required
                    value={novoCliente.razao_social}
                    onChange={e => setNovoCliente({ ...novoCliente, razao_social: e.target.value })}
                    style={s.input}
                  />
                </div>
                <div>
                  <label style={s.label}>CNPJ</label>
                  <input
                    type="text"
                    value={novoCliente.cnpj}
                    onChange={e => setNovoCliente({ ...novoCliente, cnpj: e.target.value })}
                    style={s.input}
                  />
                </div>
                <div>
                  <label style={s.label}>E-mail</label>
                  <input
                    type="email"
                    value={novoCliente.email}
                    onChange={e => setNovoCliente({ ...novoCliente, email: e.target.value })}
                    style={s.input}
                  />
                </div>
                <div>
                  <label style={s.label}>Telefone</label>
                  <input
                    type="text"
                    value={novoCliente.telefone}
                    onChange={e => setNovoCliente({ ...novoCliente, telefone: e.target.value })}
                    style={s.input}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setNovoClienteModal(false)} style={s.cancelBtn}>Cancelar</button>
                <button type="submit" disabled={criandoCliente} style={s.submitBtn}>
                  {criandoCliente ? 'Salvando...' : 'Salvar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Step({ number, title, text }) {
  return (
    <div style={s.stepCard}>
      <div style={s.stepNumber}>{number}</div>
      <div style={s.stepTitle}>{title}</div>
      <div style={s.stepText}>{text}</div>
    </div>
  )
}

const s = {
  header: { marginBottom: 24 },
  backBtn: { color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 8 },
  title: { fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 4 },
  subtitle: { color: 'var(--text-muted)', fontSize: 14 },
  errorBox: { background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, marginBottom: 20, fontSize: 14 },
  warnBox: { background: '#fff7ed', color: '#9a3412', padding: '12px 16px', borderRadius: 8, marginBottom: 20, fontSize: 14, border: '1px solid #fed7aa' },
  card: {
    background: '#fff', borderRadius: 10, padding: '20px 24px',
    boxShadow: 'var(--shadow)', border: '1px solid var(--border)', marginBottom: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' },
  pipelineGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  stepCard: { border: '1px solid #dbe7fb', borderRadius: 8, background: '#f7faff', padding: 10 },
  stepNumber: { width: 24, height: 24, borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, marginBottom: 6 },
  stepTitle: { fontSize: 13, fontWeight: 700, color: '#1e3a8a', marginBottom: 2 },
  stepText: { fontSize: 12, color: '#334155', lineHeight: 1.4 },
  tipoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  tipoOption: {
    display: 'block', padding: '16px', borderRadius: 8, border: '2px solid var(--border)',
    cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
  },
  tipoOptionActive: { borderColor: 'var(--primary)', background: '#f0f7ff' },
  label: { display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 6 },
  input: {
    width: '100%', padding: '9px 12px', borderRadius: 7,
    border: '1.5px solid var(--border)', fontSize: 13, outline: 'none', background: '#fff',
  },
  select: {
    width: '100%', padding: '9px 12px', borderRadius: 7,
    border: '1.5px solid var(--border)', fontSize: 13, background: '#fff', cursor: 'pointer',
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  docRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: '1px solid #e3e8f2',
    borderRadius: 8,
    background: '#fafcff',
    padding: '10px 12px',
    flexWrap: 'wrap',
  },
  docBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1.5px solid #3b82f6',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  docBtnDisabled: {
    borderColor: '#d1d5db',
    background: '#f3f4f6',
    color: '#6b7280',
    cursor: 'not-allowed',
  },
  outlineBtn: {
    padding: '9px 14px', borderRadius: 7, border: '1.5px solid var(--primary)',
    background: '#fff', color: 'var(--primary)', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  cancelBtn: {
    padding: '10px 20px', borderRadius: 8, border: '1.5px solid var(--border)',
    background: '#fff', color: 'var(--text)', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
  },
  submitBtn: {
    padding: '10px 24px', borderRadius: 8, border: 'none',
    background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  },
  modal: {
    background: '#fff', borderRadius: 12, padding: '28px 28px',
    width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  },
}
