import React, { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { casosAPI, clientesAPI } from '../api'
import { StatusBadge, TipoBadge, RebateBadge } from '../components/StatusBadge'
import useMediaQuery from '../hooks/useMediaQuery'

const STATUS_OPTIONS = [
  'Aguardando Documentos',
  'Aguardando Aprovação Pós-Venda',
  'Aguardando Aprovação Diretoria',
  'Aguardando Impressão Oficina',
  'Aguardando Vídeo Descarte',
  'Finalizado',
  'Reprovado',
]

export default function CasosList() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const [searchParams, setSearchParams] = useSearchParams()
  const [casos, setCasos] = useState([])
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState(searchParams.get('status') || '')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')

  const fetchCasos = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (filtroStatus) params.status = filtroStatus
      if (filtroTipo) params.tipo_processo = filtroTipo
      if (filtroCliente) params.cliente_id = filtroCliente
      if (busca) params.busca = busca
      const res = await casosAPI.listar(params)
      setCasos(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filtroStatus, filtroTipo, filtroCliente, busca])

  useEffect(() => {
    clientesAPI.listar().then(r => setClientes(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const timer = setTimeout(fetchCasos, 300)
    return () => clearTimeout(timer)
  }, [fetchCasos])

  const handleLimpar = () => {
    setBusca('')
    setFiltroStatus('')
    setFiltroTipo('')
    setFiltroCliente('')
  }

  return (
    <div>
      {/* Header */}
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Casos de Garantia</h1>
          <p style={s.pageSubtitle}>{casos.length} caso(s) encontrado(s)</p>
        </div>
        <Link to="/casos/novo" style={s.newBtn}>+ Novo Caso</Link>
      </div>

      {/* Filtros */}
      <div style={s.filtersCard}>
        <div style={{ ...s.filtersRow, ...(isMobile ? s.filtersRowMobile : {}) }}>
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{ ...s.input, flex: 1, minWidth: isMobile ? '100%' : 220 }}
          />
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={s.select}>
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

      {/* Tabela */}
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
                    <span>{new Date(caso.data_entrada + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                  </div>
                  <Link to={`/casos/${caso.id}`} style={s.mobileAction}>Abrir caso</Link>
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
                    <td style={s.td}>{new Date(caso.data_entrada + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td style={s.td}>
                      <Link to={`/casos/${caso.id}`} style={s.viewBtn}>Ver →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )
        )}
      </div>
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
  tableCard: {
    background: '#fff', borderRadius: 10, boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)', overflow: 'hidden',
  },
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
}
