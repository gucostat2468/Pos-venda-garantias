import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { casosAPI, clientesAPI } from '../api'
import useMediaQuery from '../hooks/useMediaQuery'
import useRealtimeRefresh from '../hooks/useRealtimeRefresh'
import { RebateBadge, TipoBadge } from '../components/StatusBadge'

const PAPEL_LABEL = {
  operador: 'Time Oficina',
  gerente_pos_venda: 'Gerente Pós-venda',
  diretor_comercial: 'Diretor Comercial',
  gestor_estoque: 'Gestor de Estoque',
  admin: 'Administrador',
}

function formatDate(value) {
  if (!value) return '—'
  const asDate = String(value).includes('T') ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(asDate.getTime())) return '—'
  return asDate.toLocaleDateString('pt-BR')
}

function formatDateTime(value) {
  if (!value) return '—'
  const asDate = new Date(value)
  if (Number.isNaN(asDate.getTime())) return '—'
  return asDate.toLocaleString('pt-BR')
}

function formatSolicitante(caso) {
  const nome = String(caso?.criado_por?.nome || '').trim()
  const papel = PAPEL_LABEL[caso?.criado_por?.papel] || ''
  if (nome && papel) return `${nome} (${papel})`
  if (nome) return nome
  if (caso?.criado_por_usuario_id) return `Usuário #${caso.criado_por_usuario_id}`
  return 'Não identificado'
}

export default function FinalizadosHistorico() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [casos, setCasos] = useState([])
  const [clientes, setClientes] = useState([])
  const [solicitantes, setSolicitantes] = useState([])
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [filtroSolicitante, setFiltroSolicitante] = useState('')

  const carregar = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true)
      setErro('')
    }
    try {
      const params = { status: 'Finalizado' }
      if (busca) params.busca = busca
      if (filtroTipo) params.tipo_processo = filtroTipo
      if (filtroCliente) params.cliente_id = filtroCliente
      if (filtroSolicitante) params.criado_por_usuario_id = Number(filtroSolicitante)

      const res = await casosAPI.listar(params)
      const lista = Array.isArray(res.data) ? res.data : []
      setCasos(
        [...lista].sort((a, b) => {
          const da = new Date(a.atualizado_em || a.criado_em || 0)
          const db = new Date(b.atualizado_em || b.criado_em || 0)
          return db - da
        })
      )
      setErro('')
    } catch (err) {
      console.error(err)
      if (!silent) {
        setErro(err?.response?.data?.detail || 'Falha ao carregar o histórico de finalizados.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [busca, filtroTipo, filtroCliente, filtroSolicitante])

  useEffect(() => {
    const timer = setTimeout(() => {
      carregar({ silent: false }).catch((err) => console.error(err))
    }, 250)
    return () => clearTimeout(timer)
  }, [carregar])

  useRealtimeRefresh(
    () => carregar({ silent: true }),
    { enabled: true, intervalMs: 5000 }
  )

  useEffect(() => {
    clientesAPI.listar().then((r) => setClientes(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    casosAPI
      .listarSolicitantes()
      .then((r) => {
        const lista = Array.isArray(r.data) ? r.data : []
        setSolicitantes(
          lista.map((usuario) => ({
            id: String(usuario.id),
            label: `${usuario.nome} (${PAPEL_LABEL[usuario.papel] || usuario.papel || 'Usuário'})`,
          }))
        )
      })
      .catch(() => setSolicitantes([]))
  }, [])

  const totalFinalizados = casos.length
  const totalComRebateFinalizado = useMemo(
    () => casos.filter((c) => String(c.status_rebate || '').toLowerCase() === 'finalizado').length,
    [casos]
  )

  const limparFiltros = () => {
    setBusca('')
    setFiltroTipo('')
    setFiltroCliente('')
    setFiltroSolicitante('')
  }

  return (
    <div>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Histórico de Finalizados</h1>
          <p style={s.subtitle}>
            Registro permanente dos casos concluídos com rastreabilidade completa.
          </p>
        </div>
      </div>

      <div style={{ ...s.kpis, ...(isMobile ? s.kpisMobile : {}) }}>
        <div style={s.kpiCard}>
          <div style={s.kpiLabel}>Casos Finalizados</div>
          <div style={s.kpiValue}>{totalFinalizados}</div>
        </div>
        <div style={s.kpiCard}>
          <div style={s.kpiLabel}>Rebate Finalizado</div>
          <div style={s.kpiValue}>{totalComRebateFinalizado}</div>
        </div>
      </div>

      <div style={s.filterCard}>
        <div style={{ ...s.filterGrid, ...(isMobile ? s.filterGridMobile : {}) }}>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por caso, produto ou número de série"
            style={s.input}
          />
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={s.select}>
            <option value="">Todos os tipos</option>
            <option value="Peca">🔧 Peça</option>
            <option value="Bateria">🔋 Bateria</option>
          </select>
          <select value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)} style={s.select}>
            <option value="">Todos os clientes</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
          </select>
          <select value={filtroSolicitante} onChange={(e) => setFiltroSolicitante(e.target.value)} style={s.select}>
            <option value="">Todos os solicitantes</option>
            {solicitantes.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
          </select>
          {(busca || filtroTipo || filtroCliente || filtroSolicitante) && (
            <button onClick={limparFiltros} style={s.clearBtn}>✕ Limpar</button>
          )}
        </div>
      </div>

      {erro && <div style={s.errorBox}>{erro}</div>}

      <section style={s.card}>
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>Sessão de Finalizados</h2>
          <span style={s.sectionCount}>{totalFinalizados}</span>
        </div>
        <p style={s.sectionHint}>
          Este histórico é protegido para governança: casos finalizados não podem ser excluídos.
        </p>

        {loading ? (
          <div style={s.empty}>Carregando histórico...</div>
        ) : casos.length === 0 ? (
          <div style={s.empty}>Nenhum caso finalizado para os filtros atuais.</div>
        ) : isMobile ? (
          <div style={s.mobileList}>
            {casos.map((caso) => (
              <article key={caso.id} style={s.mobileCard}>
                <div style={s.mobileTop}>
                  <Link to={`/casos/${caso.id}`} style={s.mobileId}>
                    {caso.dji_case_id || `Caso #${caso.id}`}
                  </Link>
                  <RebateBadge status={caso.status_rebate} />
                </div>
                <div style={s.mobileLine}><strong>Cliente:</strong> {caso.cliente?.razao_social || '—'}</div>
                <div style={s.mobileLine}><strong>Solicitado por:</strong> {formatSolicitante(caso)}</div>
                <div style={s.mobileLine}><strong>Produto:</strong> {caso.produto_nome || '—'}</div>
                <div style={s.mobileLine}><strong>SN:</strong> {caso.produto_sn || '—'}</div>
                <div style={s.mobileLine}><strong>Entrada:</strong> {formatDate(caso.data_entrada)}</div>
                <div style={s.mobileLine}><strong>Finalizado em:</strong> {formatDateTime(caso.atualizado_em || caso.criado_em)}</div>
                <div style={{ marginTop: 6 }}>
                  <TipoBadge tipo={caso.tipo_processo} />
                </div>
                <div style={s.mobileActions}>
                  <Link to={`/casos/${caso.id}`} style={s.viewBtn}>Ver histórico completo</Link>
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
                  <th style={s.th}>Tipo</th>
                  <th style={s.th}>Produto</th>
                  <th style={s.th}>SN</th>
                  <th style={s.th}>Entrada</th>
                  <th style={s.th}>Finalizado em</th>
                  <th style={s.th}>Rebate</th>
                  <th style={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {casos.map((caso) => (
                  <tr key={caso.id} style={s.tr}>
                    <td style={s.td}>
                      <Link to={`/casos/${caso.id}`} style={s.caseLink}>
                        {caso.dji_case_id || `Caso #${caso.id}`}
                      </Link>
                    </td>
                    <td style={s.td}>{caso.cliente?.razao_social || '—'}</td>
                    <td style={s.td}>{formatSolicitante(caso)}</td>
                    <td style={s.td}><TipoBadge tipo={caso.tipo_processo} /></td>
                    <td style={s.td}>{caso.produto_nome || '—'}</td>
                    <td style={s.td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{caso.produto_sn || '—'}</span></td>
                    <td style={s.td}>{formatDate(caso.data_entrada)}</td>
                    <td style={s.td}>{formatDateTime(caso.atualizado_em || caso.criado_em)}</td>
                    <td style={s.td}><RebateBadge status={caso.status_rebate} /></td>
                    <td style={s.td}>
                      <Link to={`/casos/${caso.id}`} style={s.viewBtn}>Ver histórico completo</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
  filterGrid: { display: 'grid', gridTemplateColumns: '2fr 1fr 1.4fr 1.4fr auto', gap: 8, alignItems: 'center' },
  filterGridMobile: { gridTemplateColumns: '1fr' },
  input: { width: '100%', padding: '9px 12px', borderRadius: 7, border: '1.5px solid var(--border)', fontSize: 13, outline: 'none', background: '#f8fafc' },
  select: { width: '100%', padding: '9px 10px', borderRadius: 7, border: '1.5px solid var(--border)', fontSize: 13, background: '#f8fafc', cursor: 'pointer' },
  clearBtn: { padding: '9px 12px', borderRadius: 7, border: '1.5px solid var(--border)', background: '#fff', fontSize: 13, cursor: 'pointer', color: 'var(--text-muted)' },
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
  viewBtn: { border: '1px solid #cfe0fb', background: '#f0f7ff', color: 'var(--primary-light)', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' },
  mobileList: { display: 'grid', gap: 10 },
  mobileCard: { border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: '#fff', display: 'grid', gap: 7 },
  mobileTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  mobileId: { color: 'var(--primary-light)', fontWeight: 800, fontSize: 13, textDecoration: 'none' },
  mobileLine: { fontSize: 13, color: 'var(--text)' },
  mobileActions: { display: 'grid', gap: 8, marginTop: 2 },
}
