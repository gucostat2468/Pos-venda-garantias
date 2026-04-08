import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { casosAPI, clientesAPI } from '../api'
import { StatusBadge, TipoBadge, RebateBadge } from '../components/StatusBadge'
import useMediaQuery from '../hooks/useMediaQuery'
import useRealtimeRefresh from '../hooks/useRealtimeRefresh'
import { useAuth } from '../contexts/AuthContext'

const STATUS_OPTIONS = [
  'Aguardando Documentos',
  'Aguardando Aprovação Pós-Venda',
  'Aguardando Aprovação Diretoria',
  'Aguardando Conferência Estoque',
  'Aguardando Impressão Oficina',
  'Aguardando Vídeo Descarte',
  'Finalizado',
  'Reprovado',
]

const FILA_PARAM_TO_STATUS = {
  pos_venda: 'Aguardando Aprovação Pós-Venda',
  diretoria: 'Aguardando Aprovação Diretoria',
  estoque: 'Aguardando Conferência Estoque',
  impressao: 'Aguardando Impressão Oficina',
}

const STATUS_TO_FILA_PARAM = Object.entries(FILA_PARAM_TO_STATUS).reduce((acc, [fila, status]) => {
  acc[status] = fila
  return acc
}, {})

const normalizeStatus = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()

const STATUS_NORMALIZADO_TO_CANONICO = STATUS_OPTIONS.reduce((acc, status) => {
  acc[normalizeStatus(status)] = status
  return acc
}, {})

const resolverStatusBusca = (searchParams) => {
  const fila = String(searchParams.get('fila') || '').trim().toLowerCase()
  if (FILA_PARAM_TO_STATUS[fila]) return FILA_PARAM_TO_STATUS[fila]
  const statusRaw = searchParams.get('status') || ''
  const canonico = STATUS_NORMALIZADO_TO_CANONICO[normalizeStatus(statusRaw)]
  return canonico || statusRaw
}

const FILA_ASSINATURA_CONFIG = {
  'Aguardando Aprovação Pós-Venda': {
    etapaApi: 'Pos-venda',
    titulo: 'Fila Pós-venda',
    subtitulo: 'Esteira de solicitações pendentes para assinatura e histórico de assinados',
    pendentesTitulo: 'Esteira de Pendentes para Assinatura',
    pendentesHint: 'Casos aguardando assinatura do gerente de pós-venda.',
    historicoTitulo: 'Histórico de Assinados',
    historicoHint: 'Casos já assinados na etapa de Pós-venda e que seguiram no fluxo.',
    historicoStatus: new Set([
      'Aguardando Aprovação Diretoria',
      'Aguardando Conferência Estoque',
      'Aguardando Impressão Oficina',
      'Finalizado',
      'Reprovado',
    ]),
    acaoPendencia: 'Assinar Agora',
  },
  'Aguardando Aprovação Diretoria': {
    etapaApi: 'Diretoria',
    titulo: 'Fila Diretor Comercial',
    subtitulo: 'Esteira de solicitações pendentes para assinatura e histórico de assinados',
    pendentesTitulo: 'Esteira de Pendentes para Assinatura',
    pendentesHint: 'Casos aguardando assinatura do diretor comercial.',
    historicoTitulo: 'Histórico de Assinados',
    historicoHint: 'Casos já assinados na etapa de Diretoria e que seguiram no fluxo.',
    historicoStatus: new Set([
      'Aguardando Conferência Estoque',
      'Aguardando Impressão Oficina',
      'Finalizado',
      'Reprovado',
    ]),
    acaoPendencia: 'Assinar Agora',
  },
  'Aguardando Conferência Estoque': {
    etapaApi: 'Estoque',
    titulo: 'Sessão Gestor de Estoque',
    subtitulo: 'Esteira exclusiva do estoque com pendências de assinatura e histórico de conclusões',
    pendentesTitulo: 'Pendentes da Conferência de Estoque',
    pendentesHint: 'Casos aguardando assinatura final do gestor de estoque.',
    historicoTitulo: 'Histórico da Sessão de Estoque',
    historicoHint: 'Casos já assinados pelo gestor de estoque e movidos para concluído.',
    historicoStatus: new Set([
      'Finalizado',
      'Reprovado',
    ]),
    acaoPendencia: 'Conferir e Concluir',
  },
}
const STATUS_LEGADO_IMPRESSAO = 'Aguardando Impressão Oficina'
const STATUS_ETAPA_ESTOQUE_COMPAT = new Set(['Aguardando Conferência Estoque', STATUS_LEGADO_IMPRESSAO])

const criarResumoCasoLista = (caso) => [
  caso?.id ?? '',
  caso?.dji_case_id ?? '',
  caso?.status ?? '',
  caso?.status_rebate ?? '',
  caso?.tipo_processo ?? '',
  caso?.produto_nome ?? '',
  caso?.produto_modelo ?? '',
  caso?.produto_sn ?? '',
  caso?.data_entrada ?? '',
  caso?.atualizado_em ?? '',
  caso?.criado_em ?? '',
  caso?.assinatura_etapa ?? '',
  caso?.cliente?.id ?? '',
  caso?.cliente?.razao_social ?? '',
].join('|')

const mesmaListaCasos = (atual, proxima) => {
  if (atual === proxima) return true
  if (!Array.isArray(atual) || !Array.isArray(proxima)) return false
  if (atual.length !== proxima.length) return false
  for (let i = 0; i < atual.length; i += 1) {
    if (criarResumoCasoLista(atual[i]) !== criarResumoCasoLista(proxima[i])) {
      return false
    }
  }
  return true
}

export default function CasosList() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const { user, podeAssinar } = useAuth()
  const isGestorEstoque = user?.papel === 'gestor_estoque' || user?.papel === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const searchParamsKey = searchParams.toString()
  const [casos, setCasos] = useState([])
  const [historicoAssinados, setHistoricoAssinados] = useState([])
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState('')
  const [deletingCases, setDeletingCases] = useState({})
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState(() => resolverStatusBusca(searchParams))
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const filaConfig = FILA_ASSINATURA_CONFIG[filtroStatus] || null
  const ultimoScrollYRef = useRef(0)

  const memorizarScrollAtual = useCallback(() => {
    if (typeof window === 'undefined') return
    ultimoScrollYRef.current = window.scrollY || window.pageYOffset || 0
  }, [])

  const restaurarScrollSeSaltou = useCallback(() => {
    if (typeof window === 'undefined') return
    const scrollAlvo = ultimoScrollYRef.current || 0
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollAtual = window.scrollY || window.pageYOffset || 0
        if (scrollAlvo - scrollAtual > 120) {
          window.scrollTo({ top: scrollAlvo, behavior: 'auto' })
        }
      })
    })
  }, [])

  const atualizarFiltroStatus = useCallback((novoStatus) => {
    setFiltroStatus(novoStatus)
    const next = new URLSearchParams(searchParamsKey)
    if (novoStatus) {
      next.set('status', novoStatus)
      const fila = STATUS_TO_FILA_PARAM[novoStatus]
      if (fila) next.set('fila', fila)
      else next.delete('fila')
    } else {
      next.delete('status')
      next.delete('fila')
    }
    if (next.toString() !== searchParamsKey) {
      setSearchParams(next, { replace: true, preventScrollReset: true })
    }
  }, [searchParamsKey, setSearchParams])

  const fetchCasos = useCallback(async ({ silent = false } = {}) => {
    if (silent) memorizarScrollAtual()
    const acessoFilaEstoqueBloqueado =
      filtroStatus === 'Aguardando Conferência Estoque' && !isGestorEstoque
    if (acessoFilaEstoqueBloqueado) {
      setCasos((prev) => (prev.length === 0 ? prev : []))
      setHistoricoAssinados((prev) => (prev.length === 0 ? prev : []))
      if (!silent) setErroLista('')
      if (!silent) setLoading(false)
      if (silent) restaurarScrollSeSaltou()
      return
    }
    if (!silent) setLoading(true)
    if (!silent) setErroLista('')
    try {
      const baseParams = {}
      if (filtroTipo) baseParams.tipo_processo = filtroTipo
      if (filtroCliente) baseParams.cliente_id = filtroCliente
      if (busca) baseParams.busca = busca

      if (filaConfig) {
        const isFilaEstoque = filtroStatus === 'Aguardando Conferência Estoque'
        const [pendRes, pendResLegado, histRes] = await Promise.all([
          casosAPI.listar({ ...baseParams, status: filtroStatus }),
          isFilaEstoque
            ? casosAPI.listar({ ...baseParams, status: STATUS_LEGADO_IMPRESSAO })
            : Promise.resolve({ data: [] }),
          casosAPI.listar({ ...baseParams, assinatura_etapa: filaConfig.etapaApi }),
        ])

        const pendDataBase = Array.isArray(pendRes.data) ? pendRes.data : []
        const pendDataLegado = Array.isArray(pendResLegado.data) ? pendResLegado.data : []
        const pendMap = new Map()
        const pendDataMerge = [...pendDataBase, ...pendDataLegado]
        pendDataMerge
          .filter((caso) => !isFilaEstoque || STATUS_ETAPA_ESTOQUE_COMPAT.has(caso.status))
          .forEach((caso) => pendMap.set(caso.id, caso))
        const pendData = [...pendMap.values()]
        const histData = Array.isArray(histRes.data) ? histRes.data : []

        const historicoMap = new Map()
        histData
          .filter((caso) => filaConfig.historicoStatus.has(caso.status) && caso.status !== filtroStatus)
          .forEach((caso) => {
            historicoMap.set(caso.id, caso)
          })

        const pendSorted = [...pendData].sort(
          (a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0)
        )
        const histSorted = [...historicoMap.values()].sort((a, b) => {
          const da = new Date(a.atualizado_em || a.criado_em || 0)
          const db = new Date(b.atualizado_em || b.criado_em || 0)
          return db - da
        })

        setCasos((prev) => (mesmaListaCasos(prev, pendSorted) ? prev : pendSorted))
        setHistoricoAssinados((prev) => (mesmaListaCasos(prev, histSorted) ? prev : histSorted))
      } else {
        const params = { ...baseParams }
        if (filtroStatus) params.status = filtroStatus
        const res = await casosAPI.listar(params)
        const lista = Array.isArray(res.data) ? res.data : []
        setCasos((prev) => (mesmaListaCasos(prev, lista) ? prev : lista))
        setHistoricoAssinados((prev) => (prev.length === 0 ? prev : []))
      }
    } catch (e) {
      console.error(e)
      if (!silent) {
        setErroLista('Falha ao carregar os casos desta fila. Verifique a conexão e tente novamente.')
      }
    } finally {
      if (silent) restaurarScrollSeSaltou()
      if (!silent) setLoading(false)
    }
  }, [
    filtroStatus,
    filtroTipo,
    filtroCliente,
    busca,
    filaConfig,
    isGestorEstoque,
    memorizarScrollAtual,
    restaurarScrollSeSaltou,
  ])

  useEffect(() => {
    const statusUrl = resolverStatusBusca(new URLSearchParams(searchParamsKey))
    if (statusUrl !== filtroStatus) {
      setFiltroStatus(statusUrl)
    }
  }, [searchParamsKey, filtroStatus])

  useEffect(() => {
    clientesAPI.listar().then(r => setClientes(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const timer = setTimeout(fetchCasos, 300)
    return () => clearTimeout(timer)
  }, [fetchCasos])

  useRealtimeRefresh(
    () => fetchCasos({ silent: true }),
    { enabled: true, intervalMs: 2000 }
  )

  const handleLimpar = () => {
    setBusca('')
    setFiltroTipo('')
    setFiltroCliente('')
    if (!filaConfig) {
      atualizarFiltroStatus('')
    }
  }

  const canDeleteCase = Boolean(user)

  const handleDeleteCase = async (caso) => {
    if (!canDeleteCase) return
    const codigo = caso.dji_case_id || `Caso #${caso.id}`
    if (!window.confirm(`Excluir ${codigo}?\n\nEsta ação remove o caso e os arquivos enviados.`)) return
    setDeletingCases((prev) => ({ ...prev, [caso.id]: true }))
    try {
      await casosAPI.deletar(caso.id)
      await fetchCasos()
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao excluir caso')
    } finally {
      setDeletingCases((prev) => ({ ...prev, [caso.id]: false }))
    }
  }

  const totalEncontrados = filaConfig ? casos.length + historicoAssinados.length : casos.length
  const acessoFilaEstoqueBloqueado =
    filtroStatus === 'Aguardando Conferência Estoque' && !isGestorEstoque
  const filaEstoqueAtiva = filtroStatus === 'Aguardando Conferência Estoque'

  return (
    <div>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>{filaConfig ? filaConfig.titulo : 'Casos de Garantia'}</h1>
          <p style={s.pageSubtitle}>
            {filaConfig ? filaConfig.subtitulo : `${casos.length} caso(s) encontrado(s)`}
          </p>
          {filaConfig && (
            <p style={{ ...s.pageSubtitle, marginTop: 4 }}>
              {totalEncontrados} caso(s) considerando pendentes e histórico da etapa
            </p>
          )}
        </div>
        <Link to="/casos/novo" style={s.newBtn}>+ Novo Caso</Link>
      </div>

      <div style={s.filtersCard}>
        <div style={{ ...s.filtersRow, ...(isMobile ? s.filtersRowMobile : {}) }}>
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{ ...s.input, flex: 1, minWidth: isMobile ? '100%' : 220 }}
          />
          <select value={filtroStatus} onChange={e => atualizarFiltroStatus(e.target.value)} style={s.select}>
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={s.select}>
            <option value="">Todos os tipos</option>
            <option value="Peca">🔧 Peça</option>
            <option value="Bateria">🔋 Bateria</option>
          </select>
          <select value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)} style={s.select}>
            <option value="">Todos os clientes</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
          </select>
          {(busca || filtroStatus || filtroTipo || filtroCliente) && (
            <button onClick={handleLimpar} style={s.clearBtn}>✕ Limpar</button>
          )}
        </div>
      </div>

      {erroLista && (
        <div style={{ ...s.tableCard, marginBottom: 12, color: '#9f1239', background: '#fff1f2', borderColor: '#fecdd3' }}>
          {erroLista}
        </div>
      )}

      {acessoFilaEstoqueBloqueado && (
        <div style={{ ...s.tableCard, marginBottom: 12, color: '#9a3412', background: '#fff7ed', borderColor: '#fdba74' }}>
          Esta sessão é exclusiva do Gestor de Estoque.
        </div>
      )}

      {filaConfig && !acessoFilaEstoqueBloqueado ? (
        <>
          <div style={{ ...s.queueKpis, ...(isMobile ? s.queueKpisMobile : {}) }}>
            <div style={s.queueKpiCard}>
              <div style={s.queueKpiLabel}>Pendentes para Assinatura</div>
              <div style={s.queueKpiValue}>{casos.length}</div>
            </div>
            <div style={s.queueKpiCard}>
              <div style={s.queueKpiLabel}>Histórico de Assinados</div>
              <div style={s.queueKpiValue}>{historicoAssinados.length}</div>
            </div>
          </div>

          <section style={s.tableCard}>
            <div style={s.sectionHead}>
              <h2 style={s.sectionTitle}>{filaConfig.pendentesTitulo}</h2>
              <span style={s.sectionCount}>{casos.length}</span>
            </div>
            <p style={s.sectionHint}>{filaConfig.pendentesHint}</p>
            {filaEstoqueAtiva && (
              <div style={s.photoShortcutWrap}>
                {casos.length > 0 ? (
                  <Link to={`/casos/${casos[0].id}?foto_estoque=1`} style={s.photoShortcutBtn}>
                    📸 Anexar Foto do Estoque (Atalho)
                  </Link>
                ) : (
                  <>
                    <button type="button" disabled style={{ ...s.photoShortcutBtn, ...s.photoShortcutBtnDisabled }}>
                      📸 Anexar Foto do Estoque (Atalho)
                    </button>
                    <div style={s.photoShortcutHint}>
                      Sem pendências no momento. Quando entrar um caso nesta fila, use este atalho para abrir direto na área de anexo.
                    </div>
                  </>
                )}
              </div>
            )}

            {loading ? (
              <div style={s.loading}>Carregando pendências...</div>
            ) : casos.length === 0 ? (
              <div style={s.empty}>Nenhum caso pendente para assinatura com o filtro atual.</div>
            ) : isMobile ? (
              <div style={s.mobileList}>
                {casos.map((caso) => (
                  <article key={caso.id} style={s.mobileCard}>
                    <div style={s.mobileTop}>
                      <Link to={`/casos/${caso.id}`} style={s.mobileId}>
                        {caso.dji_case_id || `Caso #${caso.id}`}
                      </Link>
                      <StatusBadge status={caso.status} />
                    </div>
                    <div style={s.mobileMetaRow}>
                      <TipoBadge tipo={caso.tipo_processo} />
                      <RebateBadge status={caso.status_rebate} />
                    </div>
                    <div style={s.mobileLine}><span style={s.mobileLabel}>Produto:</span><span>{caso.produto_nome || '—'}</span></div>
                    <div style={s.mobileLine}><span style={s.mobileLabel}>Cliente:</span><span>{caso.cliente?.razao_social || '—'}</span></div>
                    <div style={s.mobileLine}><span style={s.mobileLabel}>Entrada:</span><span>{new Date(`${caso.data_entrada}T00:00:00`).toLocaleDateString('pt-BR')}</span></div>
                    <div style={s.mobileActionRow}>
                      <Link to={`/casos/${caso.id}`} style={s.mobileAction}>Ver caso</Link>
                      {filaEstoqueAtiva && (
                        <Link to={`/casos/${caso.id}?foto_estoque=1`} style={s.mobilePhotoBtn}>📸</Link>
                      )}
                      {podeAssinar(caso) && (
                        <Link to={`/casos/${caso.id}?assinar=1`} style={s.mobileSignBtn}>✍️</Link>
                      )}
                      {canDeleteCase && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCase(caso)}
                          disabled={!!deletingCases[caso.id]}
                          style={s.mobileDeleteBtn}
                        >
                          {deletingCases[caso.id] ? '...' : '🗑'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={s.thead}>
                      <th style={s.th}>Caso</th>
                      <th style={s.th}>Cliente</th>
                      <th style={s.th}>Produto</th>
                      <th style={s.th}>Tipo</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Data</th>
                      <th style={s.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {casos.map((caso) => (
                      <tr key={caso.id} style={s.tr}>
                        <td style={s.td}>
                          <Link to={`/casos/${caso.id}`} style={{ color: 'var(--primary-light)', fontWeight: 700, fontSize: 13 }}>
                            {caso.dji_case_id || `Caso #${caso.id}`}
                          </Link>
                        </td>
                        <td style={s.td}>{caso.cliente?.razao_social || '—'}</td>
                        <td style={s.td}>{caso.produto_nome || '—'}</td>
                        <td style={s.td}><TipoBadge tipo={caso.tipo_processo} /></td>
                        <td style={s.td}><StatusBadge status={caso.status} /></td>
                        <td style={s.td}>{new Date(`${caso.data_entrada}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                        <td style={s.td}>
                          <div style={s.actionRow}>
                            <Link to={`/casos/${caso.id}`} style={s.viewBtn}>Ver caso</Link>
                            {filaEstoqueAtiva && (
                              <Link to={`/casos/${caso.id}?foto_estoque=1`} style={s.photoBtn}>📸 Anexar Foto</Link>
                            )}
                            {podeAssinar(caso) && (
                              <Link to={`/casos/${caso.id}?assinar=1`} style={s.signBtn}>✍️ {filaConfig.acaoPendencia}</Link>
                            )}
                            {canDeleteCase && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCase(caso)}
                                disabled={!!deletingCases[caso.id]}
                                style={s.delBtn}
                              >
                                {deletingCases[caso.id] ? '...' : '🗑'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={{ ...s.tableCard, marginTop: 16 }}>
            <div style={s.sectionHead}>
              <h2 style={s.sectionTitle}>{filaConfig.historicoTitulo}</h2>
              <span style={s.sectionCount}>{historicoAssinados.length}</span>
            </div>
            <p style={s.sectionHint}>{filaConfig.historicoHint}</p>

            {loading ? (
              <div style={s.loading}>Carregando histórico...</div>
            ) : historicoAssinados.length === 0 ? (
              <div style={s.empty}>Ainda não há casos assinados nesta etapa para o filtro atual.</div>
            ) : isMobile ? (
              <div style={s.mobileList}>
                {historicoAssinados.map((caso) => (
                  <article key={caso.id} style={s.mobileCard}>
                    <div style={s.mobileTop}>
                      <Link to={`/casos/${caso.id}`} style={s.mobileId}>
                        {caso.dji_case_id || `Caso #${caso.id}`}
                      </Link>
                      <StatusBadge status={caso.status} />
                    </div>
                    <div style={s.mobileMetaRow}>
                      <TipoBadge tipo={caso.tipo_processo} />
                      <RebateBadge status={caso.status_rebate} />
                    </div>
                    <div style={s.mobileLine}><span style={s.mobileLabel}>Produto:</span><span>{caso.produto_nome || '—'}</span></div>
                    <div style={s.mobileLine}><span style={s.mobileLabel}>Cliente:</span><span>{caso.cliente?.razao_social || '—'}</span></div>
                    <div style={s.mobileLine}><span style={s.mobileLabel}>Atualizado:</span><span>{new Date(caso.atualizado_em || caso.criado_em || `${caso.data_entrada}T00:00:00`).toLocaleDateString('pt-BR')}</span></div>
                    <div style={s.mobileActionRow}>
                      <Link to={`/casos/${caso.id}`} style={s.mobileAction}>Ver caso</Link>
                      {canDeleteCase && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCase(caso)}
                          disabled={!!deletingCases[caso.id]}
                          style={s.mobileDeleteBtn}
                        >
                          {deletingCases[caso.id] ? '...' : '🗑'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={s.thead}>
                      <th style={s.th}>Caso</th>
                      <th style={s.th}>Cliente</th>
                      <th style={s.th}>Produto</th>
                      <th style={s.th}>Tipo</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Rebate</th>
                      <th style={s.th}>Últ. Movimentação</th>
                      <th style={s.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historicoAssinados.map((caso) => (
                      <tr key={caso.id} style={s.tr}>
                        <td style={s.td}>
                          <Link to={`/casos/${caso.id}`} style={{ color: 'var(--primary-light)', fontWeight: 700, fontSize: 13 }}>
                            {caso.dji_case_id || `Caso #${caso.id}`}
                          </Link>
                        </td>
                        <td style={s.td}>{caso.cliente?.razao_social || '—'}</td>
                        <td style={s.td}>{caso.produto_nome || '—'}</td>
                        <td style={s.td}><TipoBadge tipo={caso.tipo_processo} /></td>
                        <td style={s.td}><StatusBadge status={caso.status} /></td>
                        <td style={s.td}><RebateBadge status={caso.status_rebate} /></td>
                        <td style={s.td}>{new Date(caso.atualizado_em || caso.criado_em || `${caso.data_entrada}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                        <td style={s.td}>
                          <div style={s.actionRow}>
                            <Link to={`/casos/${caso.id}`} style={s.viewBtn}>Ver caso</Link>
                            {canDeleteCase && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCase(caso)}
                                disabled={!!deletingCases[caso.id]}
                                style={s.delBtn}
                              >
                                {deletingCases[caso.id] ? '...' : '🗑'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <div style={s.tableCard}>
          {loading ? (
            <div style={s.loading}>Carregando casos...</div>
          ) : casos.length === 0 ? (
            <div style={s.empty}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
              <p style={{ marginBottom: 8 }}>Nenhum caso encontrado</p>
              {(busca || filtroStatus || filtroTipo || filtroCliente)
                ? <button onClick={handleLimpar} style={s.linkBtn}>Limpar filtros</button>
                : <Link to="/casos/novo" style={s.linkBtn}>Criar primeiro caso</Link>
              }
            </div>
          ) : (
            isMobile ? (
              <div style={s.mobileList}>
                {casos.map((caso) => (
                  <article key={caso.id} style={s.mobileCard}>
                    <div style={s.mobileTop}>
                      <Link to={`/casos/${caso.id}`} style={s.mobileId}>
                        {caso.dji_case_id || `Caso #${caso.id}`}
                      </Link>
                      <StatusBadge status={caso.status} />
                    </div>
                    <div style={s.mobileMetaRow}>
                      <TipoBadge tipo={caso.tipo_processo} />
                      <RebateBadge status={caso.status_rebate} />
                    </div>
                    <div style={s.mobileLine}>
                      <span style={s.mobileLabel}>Produto:</span>
                      <span>{caso.produto_nome || '—'}</span>
                    </div>
                    <div style={s.mobileLine}>
                      <span style={s.mobileLabel}>Modelo/SN:</span>
                      <span>{caso.produto_modelo || '—'} · {caso.produto_sn || '—'}</span>
                    </div>
                    <div style={s.mobileLine}>
                      <span style={s.mobileLabel}>Cliente:</span>
                      <span>{caso.cliente?.razao_social || '—'}</span>
                    </div>
                    <div style={s.mobileLine}>
                      <span style={s.mobileLabel}>Data:</span>
                      <span>{new Date(`${caso.data_entrada}T00:00:00`).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div style={s.mobileActionRow}>
                      <Link to={`/casos/${caso.id}`} style={s.mobileAction}>Abrir caso</Link>
                      {podeAssinar(caso) && (
                        <Link to={`/casos/${caso.id}?assinar=1`} style={s.mobileSignBtn}>✍️</Link>
                      )}
                      {canDeleteCase && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCase(caso)}
                          disabled={!!deletingCases[caso.id]}
                          style={s.mobileDeleteBtn}
                        >
                          {deletingCases[caso.id] ? 'Excluindo...' : '🗑'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={s.thead}>
                      <th style={s.th}>ID / Caso DJI</th>
                      <th style={s.th}>Tipo</th>
                      <th style={s.th}>Produto</th>
                      <th style={s.th}>SN</th>
                      <th style={s.th}>Cliente</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Rebate</th>
                      <th style={s.th}>Data</th>
                      <th style={s.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {casos.map((caso, i) => (
                      <tr key={caso.id} style={{ ...s.tr, background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={s.td}>
                          <Link to={`/casos/${caso.id}`} style={{ color: 'var(--primary-light)', fontWeight: 700, fontSize: 13 }}>
                            {caso.dji_case_id || `Caso #${caso.id}`}
                          </Link>
                          {caso.dji_case_id && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{caso.id}</div>}
                        </td>
                        <td style={s.td}><TipoBadge tipo={caso.tipo_processo} /></td>
                        <td style={s.td}>
                          <div style={{ fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {caso.produto_nome || '—'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{caso.produto_modelo || ''}</div>
                        </td>
                        <td style={s.td}>
                          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{caso.produto_sn || '—'}</span>
                        </td>
                        <td style={s.td}>{caso.cliente?.razao_social || '—'}</td>
                        <td style={s.td}><StatusBadge status={caso.status} /></td>
                        <td style={s.td}><RebateBadge status={caso.status_rebate} /></td>
                        <td style={s.td}>{new Date(`${caso.data_entrada}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                        <td style={s.td}>
                          <div style={s.actionRow}>
                            <Link to={`/casos/${caso.id}`} style={s.viewBtn}>Ver →</Link>
                            {podeAssinar(caso) && (
                              <Link to={`/casos/${caso.id}?assinar=1`} style={s.signBtn}>✍️ Assinar</Link>
                            )}
                            {canDeleteCase && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCase(caso)}
                                disabled={!!deletingCases[caso.id]}
                                style={s.delBtn}
                              >
                                {deletingCases[caso.id] ? '...' : '🗑'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

const s = {
  pageHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 20, flexWrap: 'wrap', gap: 12,
  },
  pageTitle: { fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 2 },
  pageSubtitle: { color: 'var(--text-muted)', fontSize: 13 },
  newBtn: {
    background: 'var(--primary)', color: '#fff', padding: '9px 18px',
    borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: 'none',
  },
  filtersCard: {
    background: '#fff', borderRadius: 10, padding: '16px',
    boxShadow: 'var(--shadow)', border: '1px solid var(--border)', marginBottom: 16,
  },
  filtersRow: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  filtersRowMobile: { flexDirection: 'column', alignItems: 'stretch' },
  input: {
    padding: '8px 12px', borderRadius: 7, border: '1.5px solid var(--border)',
    fontSize: 13, outline: 'none', background: '#f8fafc',
  },
  select: {
    padding: '8px 10px', borderRadius: 7, border: '1.5px solid var(--border)',
    fontSize: 13, background: '#f8fafc', cursor: 'pointer', minWidth: 140,
  },
  clearBtn: {
    padding: '8px 12px', borderRadius: 7, border: '1.5px solid var(--border)',
    background: '#fff', fontSize: 13, cursor: 'pointer', color: 'var(--text-muted)',
  },
  queueKpis: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 12 },
  queueKpisMobile: { gridTemplateColumns: '1fr' },
  queueKpiCard: {
    background: '#fff', borderRadius: 10, boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)', padding: 12,
  },
  queueKpiLabel: { fontSize: 12, color: 'var(--text-muted)' },
  queueKpiValue: { fontSize: 28, fontWeight: 800, color: 'var(--text)' },
  photoShortcutWrap: { marginBottom: 12 },
  photoShortcutBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #fdba74',
    background: '#fff7ed',
    color: '#9a3412',
    fontSize: 12,
    fontWeight: 700,
    textDecoration: 'none',
  },
  photoShortcutHint: {
    marginTop: 8,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #fdba74',
    background: '#fff7ed',
    color: '#9a3412',
    fontSize: 12,
    fontWeight: 600,
  },
  photoShortcutBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  },
  tableCard: {
    background: '#fff', borderRadius: 10, boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)', overflow: 'hidden', padding: 12,
  },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 800, color: 'var(--text)' },
  sectionCount: { fontSize: 12, fontWeight: 700, color: '#1e40af', background: '#e0ecff', borderRadius: 999, padding: '3px 9px' },
  sectionHint: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  thead: { background: '#f8fafc', borderBottom: '2px solid var(--border)' },
  th: { padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 14px', fontSize: 13, color: 'var(--text)', verticalAlign: 'middle' },
  viewBtn: {
    color: 'var(--primary-light)', fontWeight: 600, fontSize: 13,
    textDecoration: 'none', padding: '4px 8px', borderRadius: 6,
    background: '#f0f7ff', whiteSpace: 'nowrap',
  },
  signBtn: {
    color: '#065f46',
    fontWeight: 700,
    fontSize: 12,
    textDecoration: 'none',
    padding: '4px 8px',
    borderRadius: 6,
    background: '#ecfdf5',
    border: '1px solid #bbf7d0',
    whiteSpace: 'nowrap',
  },
  photoBtn: {
    color: '#9a3412',
    fontWeight: 700,
    fontSize: 12,
    textDecoration: 'none',
    padding: '4px 8px',
    borderRadius: 6,
    background: '#fff7ed',
    border: '1px solid #fdba74',
    whiteSpace: 'nowrap',
  },
  actionRow: { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  delBtn: {
    border: '1px solid #fecaca',
    background: '#fff',
    color: '#b91c1c',
    borderRadius: 6,
    padding: '4px 7px',
    fontSize: 12,
    cursor: 'pointer',
    minWidth: 34,
  },
  linkBtn: { color: 'var(--primary-light)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 },
  mobileList: { display: 'grid', gap: 10, padding: 10 },
  mobileCard: {
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: '#fff',
    padding: 12,
    display: 'grid',
    gap: 8,
  },
  mobileTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  mobileId: { color: 'var(--primary-light)', fontWeight: 800, fontSize: 13, textDecoration: 'none' },
  mobileMetaRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  mobileLine: { display: 'grid', gap: 2 },
  mobileLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' },
  mobileAction: {
    marginTop: 2,
    display: 'inline-flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: '#f0f7ff',
    border: '1px solid #cfe0fb',
    borderRadius: 8,
    padding: '8px 10px',
    color: 'var(--primary-light)',
    fontWeight: 700,
    textDecoration: 'none',
  },
  mobileActionRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'stretch' },
  mobileDeleteBtn: {
    border: '1px solid #fecaca',
    background: '#fff',
    color: '#b91c1c',
    borderRadius: 8,
    minWidth: 46,
    padding: '0 10px',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
  },
  mobileSignBtn: {
    border: '1px solid #bbf7d0',
    background: '#ecfdf5',
    color: '#065f46',
    borderRadius: 8,
    minWidth: 46,
    padding: '0 10px',
    fontSize: 16,
    fontWeight: 700,
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobilePhotoBtn: {
    border: '1px solid #fdba74',
    background: '#fff7ed',
    color: '#9a3412',
    borderRadius: 8,
    minWidth: 46,
    padding: '0 10px',
    fontSize: 16,
    fontWeight: 700,
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
}
