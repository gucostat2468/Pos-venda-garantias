import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { casosAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { StatusBadge, TipoBadge, RebateBadge } from '../components/StatusBadge'
import useMediaQuery from '../hooks/useMediaQuery'
import useRealtimeRefresh from '../hooks/useRealtimeRefresh'
import { abrirImpressaoPdf } from '../utils/print'

function formatDate(value) {
  if (!value) return '—'
  const asDate = String(value).includes('T') ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(asDate.getTime())) return '—'
  return asDate.toLocaleDateString('pt-BR')
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const PAPEL_LABEL = {
  operador: 'Time Oficina',
  gerente_pos_venda: 'Gerente Pós-venda',
  diretor_comercial: 'Diretor Comercial',
  gestor_estoque: 'Gestor de Estoque',
  admin: 'Administrador',
}

function formatSolicitante(caso) {
  const nome = String(caso?.criado_por?.nome || '').trim()
  const papel = PAPEL_LABEL[caso?.criado_por?.papel] || ''
  if (nome && papel) return `${nome} (${papel})`
  if (nome) return nome
  if (caso?.criado_por_usuario_id) return `Usuário #${caso.criado_por_usuario_id}`
  return 'Não identificado'
}

export default function ImpressaoFinalizacao() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const { isAdmin, isOperador } = useAuth()
  const canFinalize = isAdmin || isOperador
  const [loading, setLoading] = useState(true)
  const [finalizando, setFinalizando] = useState({})
  const [deletingCases, setDeletingCases] = useState({})
  const [pendentes, setPendentes] = useState([])
  const [finalizados, setFinalizados] = useState([])
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')

  const carregar = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true)
      setErro('')
    }
    try {
      const [pendentesRes, finalizadosRes] = await Promise.all([
        casosAPI.listar({ status: 'Aguardando Impressão Oficina' }),
        casosAPI.listar({ status: 'Finalizado' }),
      ])

      const pendData = Array.isArray(pendentesRes.data) ? pendentesRes.data : []
      const finData = Array.isArray(finalizadosRes.data) ? finalizadosRes.data : []

      setPendentes(
        [...pendData].sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0))
      )
      setFinalizados(
        [...finData].sort((a, b) => {
          const da = new Date(a.atualizado_em || a.criado_em || 0)
          const db = new Date(b.atualizado_em || b.criado_em || 0)
          return db - da
        })
      )
      setErro('')
    } catch (err) {
      console.error(err)
      if (!silent) {
        setErro(err?.response?.data?.detail || 'Erro ao carregar dados de impressão/finalização.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar({ silent: false }).catch((err) => console.error(err))
  }, [carregar])

  useRealtimeRefresh(
    () => carregar({ silent: true }),
    { enabled: true, intervalMs: 2000 }
  )

  const prepararPdfAtualizado = async (casoId) => {
    await casosAPI.compilarPdf(casoId)
    return casosAPI.downloadPdfFile(casoId)
  }

  const handleImprimirEFinalizar = async (caso) => {
    if (!canFinalize) return
    const confirmar = window.confirm(
      `Abrir impressão e finalizar o caso ${caso.dji_case_id || `#${caso.id}`}?\n\n` +
      'Este botão executa a última etapa do fluxo.\n' +
      'O dossiê inclui todos os documentos anexados e assinados.\n' +
      'Imprima em 3 vias:\n' +
      '1ª via: Financeiro\n2ª via: Estoque\n3ª via: Controle da Oficina'
    )
    if (!confirmar) return

    setFinalizando((prev) => ({ ...prev, [caso.id]: true }))
    try {
      const pdfRes = await prepararPdfAtualizado(caso.id)
      abrirImpressaoPdf(pdfRes.data)
      await casosAPI.confirmarImpressao(caso.id)
      await carregar()
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Erro ao imprimir e finalizar caso.')
    } finally {
      setFinalizando((prev) => ({ ...prev, [caso.id]: false }))
    }
  }

  const handleDeleteCase = async (caso) => {
    if (!canFinalize) return
    const codigo = caso.dji_case_id || `Caso #${caso.id}`
    if (!window.confirm(`Excluir ${codigo}?\n\nEsta ação remove o caso e os arquivos enviados.`)) return
    setDeletingCases((prev) => ({ ...prev, [caso.id]: true }))
    try {
      await casosAPI.deletar(caso.id)
      await carregar()
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao excluir caso')
    } finally {
      setDeletingCases((prev) => ({ ...prev, [caso.id]: false }))
    }
  }

  const filtro = normalize(busca)
  const caseMatches = (caso) => {
    if (!filtro) return true
    const alvo = normalize([
      caso.dji_case_id,
      caso.id,
      caso.cliente?.razao_social,
      caso.criado_por?.nome,
      caso.criado_por?.papel,
      caso.criado_por_usuario_id,
      caso.produto_nome,
      caso.produto_modelo,
      caso.produto_sn,
    ].join(' '))
    return alvo.includes(filtro)
  }

  const pendentesFiltrados = useMemo(() => pendentes.filter(caseMatches), [pendentes, filtro])
  const finalizadosFiltrados = useMemo(() => finalizados.filter(caseMatches), [finalizados, filtro])

  return (
    <div>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Imprimir e Finalizar</h1>
          <p style={s.subtitle}>
            Sessão legada da oficina para casos antigos que ainda estão na etapa de impressão em 3 vias
          </p>
        </div>
      </div>

      <div style={{ ...s.kpis, ...(isMobile ? s.kpisMobile : {}) }}>
        <div style={s.kpiCard}>
          <div style={s.kpiLabel}>Pendentes de Impressão</div>
          <div style={s.kpiValue}>{pendentes.length}</div>
        </div>
        <div style={s.kpiCard}>
          <div style={s.kpiLabel}>Finalizados</div>
          <div style={s.kpiValue}>{finalizados.length}</div>
        </div>
      </div>

      <div style={s.filterCard}>
        <label style={{ ...s.sectionHint, marginBottom: 6, display: 'block' }}>
          Busca rápida por ID, cliente, produto ou número de série
        </label>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={s.input}
        />
      </div>

      {erro && <div style={s.errorBox}>⚠️ {erro}</div>}

      {loading ? (
        <div style={s.card}>Carregando sessão de impressão e finalização...</div>
      ) : (
        <>
          <section style={s.card}>
            <div style={s.sectionHeader}>
              <h2 style={s.sectionTitle}>Fila para Imprimir e Finalizar</h2>
              <span style={s.sectionCount}>{pendentesFiltrados.length}</span>
            </div>
            <p style={s.sectionHint}>
              Casos desta lista pertencem ao fluxo anterior. Após imprimir as 3 vias, confirme a finalização.
            </p>

            {pendentesFiltrados.length === 0 ? (
              <div style={s.empty}>Nenhum caso pendente de impressão para o filtro atual.</div>
            ) : isMobile ? (
              <div style={s.mobileList}>
                {pendentesFiltrados.map((caso) => (
                  <article key={caso.id} style={s.mobileCard}>
                    <div style={s.mobileTop}>
                      <Link to={`/casos/${caso.id}`} style={s.mobileId}>
                        {caso.dji_case_id || `Caso #${caso.id}`}
                      </Link>
                      <StatusBadge status={caso.status} />
                    </div>
                    <div style={s.mobileLine}><strong>Cliente:</strong> {caso.cliente?.razao_social || '—'}</div>
                    <div style={s.mobileLine}><strong>Solicitado por:</strong> {formatSolicitante(caso)}</div>
                    <div style={s.mobileLine}><strong>Produto:</strong> {caso.produto_nome || '—'}</div>
                    <div style={s.mobileLine}><strong>Entrada:</strong> {formatDate(caso.data_entrada)}</div>
                    <div style={s.mobileActions}>
                      <div style={s.mobileActionRow}>
                        <Link to={`/casos/${caso.id}`} style={{ ...s.viewBtn, ...s.mobileActionBtn }}>Ver caso</Link>
                        {canFinalize && (
                          <button
                            type="button"
                            style={{ ...s.deleteBtn, ...s.mobileDeleteBtn }}
                            onClick={() => handleDeleteCase(caso)}
                            disabled={!!deletingCases[caso.id]}
                          >
                            {deletingCases[caso.id] ? '...' : '🗑'}
                          </button>
                        )}
                      </div>
                      {canFinalize && (
                        <button
                          type="button"
                          style={{ ...s.finalizeBtn, ...s.mobileActionBtn }}
                          onClick={() => handleImprimirEFinalizar(caso)}
                          disabled={!!finalizando[caso.id]}
                        >
                          {finalizando[caso.id] ? 'Processando...' : 'Imprimir e Finalizar'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr style={s.thead}>
                      <th style={s.th}>Caso</th>
                      <th style={s.th}>Cliente</th>
                      <th style={s.th}>Solicitado por</th>
                      <th style={s.th}>Produto</th>
                      <th style={s.th}>Tipo</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Entrada</th>
                      <th style={s.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendentesFiltrados.map((caso) => (
                      <tr key={caso.id} style={s.tr}>
                        <td style={s.td}>
                          <Link to={`/casos/${caso.id}`} style={s.caseLink}>
                            {caso.dji_case_id || `Caso #${caso.id}`}
                          </Link>
                        </td>
                        <td style={s.td}>{caso.cliente?.razao_social || '—'}</td>
                        <td style={s.td}>{formatSolicitante(caso)}</td>
                        <td style={s.td}>{caso.produto_nome || '—'}</td>
                        <td style={s.td}><TipoBadge tipo={caso.tipo_processo} /></td>
                        <td style={s.td}><StatusBadge status={caso.status} /></td>
                        <td style={s.td}>{formatDate(caso.data_entrada)}</td>
                        <td style={s.td}>
                          <div style={s.actions}>
                            <Link to={`/casos/${caso.id}`} style={s.viewBtn}>Ver caso</Link>
                            {canFinalize && (
                              <button
                                type="button"
                                style={s.deleteBtn}
                                onClick={() => handleDeleteCase(caso)}
                                disabled={!!deletingCases[caso.id]}
                              >
                                {deletingCases[caso.id] ? '...' : '🗑'}
                              </button>
                            )}
                            {canFinalize && (
                              <button
                                type="button"
                                style={s.finalizeBtn}
                                onClick={() => handleImprimirEFinalizar(caso)}
                                disabled={!!finalizando[caso.id]}
                              >
                                {finalizando[caso.id] ? 'Processando...' : 'Imprimir e Finalizar'}
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

          <section style={s.card}>
            <div style={s.sectionHeader}>
              <h2 style={s.sectionTitle}>Histórico de Finalizados</h2>
              <span style={s.sectionCount}>{finalizadosFiltrados.length}</span>
            </div>
            <p style={s.sectionHint}>
              Registro organizado de todos os casos já encerrados.
            </p>

            {finalizadosFiltrados.length === 0 ? (
              <div style={s.empty}>Ainda não há casos finalizados para o filtro atual.</div>
            ) : isMobile ? (
              <div style={s.mobileList}>
                {finalizadosFiltrados.map((caso) => (
                  <article key={caso.id} style={s.mobileCard}>
                    <div style={s.mobileTop}>
                      <Link to={`/casos/${caso.id}`} style={s.mobileId}>
                        {caso.dji_case_id || `Caso #${caso.id}`}
                      </Link>
                      <StatusBadge status={caso.status} />
                    </div>
                    <div style={s.mobileLine}><strong>Cliente:</strong> {caso.cliente?.razao_social || '—'}</div>
                    <div style={s.mobileLine}><strong>Solicitado por:</strong> {formatSolicitante(caso)}</div>
                    <div style={s.mobileLine}><strong>Produto:</strong> {caso.produto_nome || '—'}</div>
                    <div style={s.mobileLine}><strong>Finalizado em:</strong> {formatDate(caso.atualizado_em || caso.criado_em)}</div>
                    <div style={s.mobileLine}><strong>Rebate:</strong> <RebateBadge status={caso.status_rebate} /></div>
                    <div style={s.mobileActions}>
                      <div style={s.mobileActionRow}>
                        <Link to={`/casos/${caso.id}`} style={{ ...s.viewBtn, ...s.mobileActionBtn }}>Ver caso</Link>
                        {canFinalize && (
                          <button
                            type="button"
                            style={{ ...s.deleteBtn, ...s.mobileDeleteBtn }}
                            onClick={() => handleDeleteCase(caso)}
                            disabled={!!deletingCases[caso.id]}
                          >
                            {deletingCases[caso.id] ? '...' : '🗑'}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr style={s.thead}>
                      <th style={s.th}>Caso</th>
                      <th style={s.th}>Cliente</th>
                      <th style={s.th}>Solicitado por</th>
                      <th style={s.th}>Produto</th>
                      <th style={s.th}>Tipo</th>
                      <th style={s.th}>Rebate</th>
                      <th style={s.th}>Finalizado em</th>
                      <th style={s.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalizadosFiltrados.map((caso) => (
                      <tr key={caso.id} style={s.tr}>
                        <td style={s.td}>
                          <Link to={`/casos/${caso.id}`} style={s.caseLink}>
                            {caso.dji_case_id || `Caso #${caso.id}`}
                          </Link>
                        </td>
                        <td style={s.td}>{caso.cliente?.razao_social || '—'}</td>
                        <td style={s.td}>{formatSolicitante(caso)}</td>
                        <td style={s.td}>{caso.produto_nome || '—'}</td>
                        <td style={s.td}><TipoBadge tipo={caso.tipo_processo} /></td>
                        <td style={s.td}><RebateBadge status={caso.status_rebate} /></td>
                        <td style={s.td}>{formatDate(caso.atualizado_em || caso.criado_em)}</td>
                        <td style={s.td}>
                          <div style={s.actions}>
                            <Link to={`/casos/${caso.id}`} style={s.viewBtn}>Ver caso</Link>
                            {canFinalize && (
                              <button
                                type="button"
                                style={s.deleteBtn}
                                onClick={() => handleDeleteCase(caso)}
                                disabled={!!deletingCases[caso.id]}
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
      )}
    </div>
  )
}

const s = {
  header: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'var(--text-muted)' },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 12 },
  kpisMobile: { gridTemplateColumns: '1fr' },
  kpiCard: { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 12, boxShadow: 'var(--shadow)' },
  kpiLabel: { fontSize: 12, color: 'var(--text-muted)' },
  kpiValue: { fontSize: 28, fontWeight: 800, color: 'var(--text)' },
  filterCard: { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)', padding: 12, marginBottom: 12 },
  input: { width: '100%', padding: '9px 12px', borderRadius: 7, border: '1.5px solid var(--border)', fontSize: 13, outline: 'none', background: '#f8fafc' },
  card: { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)', padding: 14, marginBottom: 14 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: 800, color: 'var(--text)' },
  sectionCount: { fontSize: 12, fontWeight: 700, color: '#1e40af', background: '#e0ecff', borderRadius: 999, padding: '3px 9px' },
  sectionHint: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 },
  errorBox: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 },
  empty: { textAlign: 'center', color: 'var(--text-muted)', padding: '14px 10px', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse' },
  thead: { background: '#f8fafc', borderBottom: '1px solid var(--border)' },
  th: { padding: '10px 10px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '10px', fontSize: 13, color: 'var(--text)', verticalAlign: 'middle' },
  caseLink: { color: 'var(--primary-light)', fontWeight: 700, textDecoration: 'none' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  viewBtn: { border: '1px solid #cfe0fb', background: '#f0f7ff', color: 'var(--primary-light)', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 700, textDecoration: 'none' },
  deleteBtn: { border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', minWidth: 38 },
  finalizeBtn: { border: 'none', background: '#10b981', color: '#fff', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  mobileList: { display: 'grid', gap: 10 },
  mobileCard: { border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: '#fff', display: 'grid', gap: 7 },
  mobileTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  mobileId: { color: 'var(--primary-light)', fontWeight: 800, fontSize: 13, textDecoration: 'none' },
  mobileLine: { fontSize: 13, color: 'var(--text)' },
  mobileActions: { display: 'grid', gap: 8, marginTop: 2 },
  mobileActionRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  mobileActionBtn: { minHeight: 40, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  mobileDeleteBtn: { minWidth: 48, fontSize: 16, padding: '0 10px' },
}
