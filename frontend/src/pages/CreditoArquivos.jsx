import React, { useEffect, useMemo, useState } from 'react'
import { creditoAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'
import useMediaQuery from '../hooks/useMediaQuery'

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

function formatDate(isoValue) {
  if (!isoValue) return '—'
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR')
}

function formatMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function CreditoArquivos() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const { isAdmin, isOperador } = useAuth()
  const podeSincronizar = isAdmin || isOperador

  const [arquivos, setArquivos] = useState([])
  const [extratos, setExtratos] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')
  const [filtroLancamento, setFiltroLancamento] = useState('')

  const load = async () => {
    setLoading(true)
    setErro('')
    try {
      const [arqRes, extRes] = await Promise.all([
        creditoAPI.listarArquivos(),
        creditoAPI.listarExtratos(),
      ])

      const arquivosData = Array.isArray(arqRes.data) ? arqRes.data : []
      const extratosData = Array.isArray(extRes.data) ? extRes.data : []
      setArquivos(arquivosData)
      setExtratos(extratosData)

      if (!selectedId && extratosData.length > 0) {
        setSelectedId(extratosData[0].id)
      } else if (selectedId && !extratosData.some((x) => x.id === selectedId)) {
        setSelectedId(extratosData.length > 0 ? extratosData[0].id : null)
      }
    } catch (err) {
      console.error(err)
      setArquivos([])
      setExtratos([])
      setErro(err?.response?.data?.detail || 'Erro ao carregar a base de créditos.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const extratoSelecionado = useMemo(() => {
    if (!extratos.length) return null
    return extratos.find((x) => x.id === selectedId) || extratos[0]
  }, [extratos, selectedId])

  const lancamentosFiltrados = useMemo(() => {
    const lista = extratoSelecionado?.lancamentos || []
    const termo = filtroLancamento.trim().toLowerCase()
    if (!termo) return lista
    return lista.filter((l) => {
      return (
        (l.descricao || '').toLowerCase().includes(termo) ||
        (l.secao || '').toLowerCase().includes(termo) ||
        (l.observacao || '').toLowerCase().includes(termo)
      )
    })
  }, [extratoSelecionado, filtroLancamento])

  const handleSync = async () => {
    setSyncing(true)
    setMsg('')
    setErro('')
    try {
      const { data } = await creditoAPI.sincronizarDados()
      const resumo = `Sync concluído: processados ${data.sync?.processed ?? 0}, importados ${data.sync?.imported ?? 0}, já existentes ${data.sync?.already_present ?? 0}, falhas ${data.sync?.failed ?? 0}. Reconciliação: vínculos de caso ${data.reconciliacao?.vinculos_caso_criados ?? 0}.`
      setMsg(resumo)
      await load()
    } catch (err) {
      console.error(err)
      setErro(err?.response?.data?.detail || 'Erro ao sincronizar planilhas para o banco.')
    } finally {
      setSyncing(false)
    }
  }

  const handleReconcile = async () => {
    setReconciling(true)
    setMsg('')
    setErro('')
    try {
      const { data } = await creditoAPI.reconciliar()
      const resumo = `Reconciliação concluída: extratos ${data.extratos_processados}, com cliente ${data.extratos_com_cliente}, vínculos de caso ${data.vinculos_caso_criados}.`
      setMsg(resumo)
      await load()
    } catch (err) {
      console.error(err)
      setErro(err?.response?.data?.detail || 'Erro ao reconciliar créditos com casos.')
    } finally {
      setReconciling(false)
    }
  }

  return (
    <div>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Base de Créditos</h1>
            <p style={s.subtitle}>
              {extratos.length} extrato(s) no banco • {arquivos.length} arquivo(s) de origem
            </p>
          </div>
          {podeSincronizar && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
            <button onClick={handleSync} style={s.syncBtn} disabled={syncing || reconciling}>
              {syncing ? 'Sincronizando...' : 'Sincronizar Planilhas'}
            </button>
            <button onClick={handleReconcile} style={s.reconcileBtn} disabled={syncing || reconciling}>
              {reconciling ? 'Reconciliando...' : 'Reconciliar com Casos'}
            </button>
          </div>
        )}
      </div>

      {msg && <div style={s.successBox}>{msg}</div>}

      {loading ? (
        <div style={s.card}>Carregando base de créditos...</div>
      ) : erro ? (
        <div style={s.errorBox}>{erro}</div>
      ) : extratos.length === 0 ? (
        <div style={s.card}>
          Nenhum extrato no banco ainda. {podeSincronizar ? 'Clique em "Sincronizar Planilhas".' : 'Peça ao administrador para sincronizar.'}
        </div>
      ) : (
        <div style={{ ...s.grid, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
          <div style={{ ...s.leftCard, ...(isMobile ? { minHeight: 'auto' } : {}) }}>
            <h2 style={s.sectionTitle}>Extratos Mensais</h2>
            <div style={s.extratoList}>
              {extratos.map((ext) => (
                <button
                  key={ext.id}
                  onClick={() => setSelectedId(ext.id)}
                  style={{
                    ...s.extratoBtn,
                    ...(extratoSelecionado?.id === ext.id ? s.extratoBtnActive : {}),
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{ext.competencia_nome || ext.arquivo_nome}</div>
                  <div style={s.extratoMeta}>{ext.dealer_nome || 'Dealer não informado'}</div>
                  <div style={s.extratoMeta}>{formatMoney(ext.credit_balance)}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={s.rightCard}>
            <h2 style={s.sectionTitle}>
              {extratoSelecionado?.competencia_nome || extratoSelecionado?.arquivo_nome}
            </h2>

            <div style={{ ...s.metaGrid, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
              <Meta label="Dealer" value={extratoSelecionado?.dealer_nome || '—'} />
              <Meta label="Cliente vinculado" value={extratoSelecionado?.cliente_id ? `ID ${extratoSelecionado.cliente_id}` : 'Não vinculado'} />
              <Meta label="Conta" value={extratoSelecionado?.dealer_account || '—'} />
              <Meta label="Total Expenditure" value={formatMoney(extratoSelecionado?.total_expenditure)} />
              <Meta label="Total Income" value={formatMoney(extratoSelecionado?.total_income)} />
              <Meta label="Credit Balance" value={formatMoney(extratoSelecionado?.credit_balance)} />
              <Meta label="Pre-payment" value={formatMoney(extratoSelecionado?.total_prepayment)} />
              <Meta label="Arquivo" value={extratoSelecionado?.arquivo_nome || '—'} />
              <Meta label="Importado em" value={formatDate(extratoSelecionado?.importado_em)} />
            </div>

            <div style={{ ...s.filterRow, ...(isMobile ? { flexDirection: 'column', alignItems: 'stretch' } : {}) }}>
              <input
                type="text"
                value={filtroLancamento}
                onChange={(e) => setFiltroLancamento(e.target.value)}
                style={{ ...s.input, ...(isMobile ? { minWidth: '100%' } : {}) }}
              />
              {extratoSelecionado?.arquivo_caminho_relativo && (
                <a href={creditoAPI.downloadArquivo(extratoSelecionado.arquivo_caminho_relativo)} style={s.downloadBtn}>
                  Baixar planilha
                </a>
              )}
            </div>

            <div style={s.tableWrap}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={s.thead}>
                    <th style={s.th}>Linha</th>
                    <th style={s.th}>Seção</th>
                    <th style={s.th}>Item</th>
                    <th style={s.th}>Descrição</th>
                    <th style={s.th}>Valor</th>
                    <th style={s.th}>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosFiltrados.length === 0 ? (
                    <tr>
                      <td style={s.emptyTd} colSpan={6}>Nenhum lançamento encontrado.</td>
                    </tr>
                  ) : (
                    lancamentosFiltrados.map((l) => (
                      <tr key={l.id} style={s.tr}>
                        <td style={s.td}>{l.linha_planilha}</td>
                        <td style={s.td}>{l.secao || '—'}</td>
                        <td style={s.td}>{l.indice_item ?? '—'}</td>
                        <td style={s.td}>{l.descricao || '—'}</td>
                        <td style={s.td}>{formatMoney(l.valor)}</td>
                        <td style={s.td}>{l.observacao || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={s.filesInfo}>
              Arquivo de origem: {extratoSelecionado ? formatBytes(arquivos.find((a) => a.nome_arquivo === extratoSelecionado.arquivo_nome)?.tamanho_bytes || 0) : '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Meta({ label, value }) {
  return (
    <div style={s.metaCard}>
      <div style={s.metaLabel}>{label}</div>
      <div style={s.metaValue}>{value}</div>
    </div>
  )
}

const s = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    gap: 12,
    flexWrap: 'wrap',
  },
  title: { fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'var(--text-muted)' },
  syncBtn: {
    background: 'var(--primary)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  reconcileBtn: {
    background: '#0f766e',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  successBox: {
    background: '#ecfdf5',
    color: '#065f46',
    border: '1px solid #a7f3d0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontWeight: 600,
    fontSize: 13,
  },
  errorBox: {
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: 16,
    fontWeight: 600,
  },
  card: {
    background: '#fff',
    borderRadius: 10,
    boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)',
    padding: 20,
    color: 'var(--text-muted)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '300px 1fr',
    gap: 14,
  },
  leftCard: {
    background: '#fff',
    borderRadius: 10,
    boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)',
    padding: 14,
    minHeight: 480,
  },
  rightCard: {
    background: '#fff',
    borderRadius: 10,
    boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)',
    padding: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 10,
  },
  extratoList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  extratoBtn: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: '#fff',
    textAlign: 'left',
    padding: '10px 12px',
    cursor: 'pointer',
  },
  extratoBtnActive: {
    border: '1px solid var(--primary-light)',
    background: '#f0f7ff',
  },
  extratoMeta: {
    fontSize: 12,
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  metaCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 10px',
    background: '#fafafa',
  },
  metaLabel: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 13,
    color: 'var(--text)',
    fontWeight: 600,
    lineHeight: 1.2,
  },
  filterRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  input: {
    flex: 1,
    minWidth: 220,
    padding: '8px 10px',
    borderRadius: 7,
    border: '1.5px solid var(--border)',
    background: '#f8fafc',
    fontSize: 13,
    outline: 'none',
  },
  downloadBtn: {
    color: 'var(--primary-light)',
    fontWeight: 700,
    textDecoration: 'none',
    fontSize: 13,
    background: '#f0f7ff',
    borderRadius: 7,
    padding: '8px 10px',
    whiteSpace: 'nowrap',
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid var(--border)',
    borderRadius: 8,
  },
  thead: {
    background: '#f8fafc',
    borderBottom: '1px solid var(--border)',
  },
  th: {
    padding: '9px 10px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '9px 10px',
    fontSize: 12,
    color: 'var(--text)',
    verticalAlign: 'top',
  },
  emptyTd: {
    padding: '14px 10px',
    textAlign: 'center',
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  filesInfo: {
    marginTop: 10,
    fontSize: 12,
    color: 'var(--text-muted)',
  },
}
