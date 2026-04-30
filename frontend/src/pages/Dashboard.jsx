import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { casosAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'
import useMediaQuery from '../hooks/useMediaQuery'
import useRealtimeRefresh from '../hooks/useRealtimeRefresh'
import { parseApiDateTime } from '../utils/datetime'
import { downloadBlob, extractFilenameFromHeaders } from '../utils/file'

const DOCS_POR_TIPO = {
  Peca: [
    {
      label: 'Remessa DRONEPRO (Documento de separação dos itens no estoque)',
      obrigatorio: true,
      aliases: [
        'Remessa DRONEPRO (Documento de separação dos itens no estoque)',
        'Remessa DRONEPRO',
        'Remessa DronePro',
        'Remessa (Documento de separação dos itens no estoque)',
        'Remessa (Pedido)',
        'Remessa',
        'Nota Drone Pro',
        'Nota drone pro',
        'Nota Drone Prop',
      ],
    },
    {
      label: 'Remessa HUADA (Documento de separação dos itens no estoque)',
      obrigatorio: true,
      aliases: [
        'Remessa HUADA (Documento de separação dos itens no estoque)',
        'Remessa HUADA',
        'Remessa Huada',
        'Remessa huada',
        'Nota Huada',
        'Nota huada',
      ],
    },
    {
      label: 'Caso de aprovação DJI',
      obrigatorio: false,
      aliases: ['Caso de aprovação DJI', 'Caso de aprovacao DJI'],
    },
    {
      label: 'Nota Fiscal de remessa para garantia DRONEPRO',
      obrigatorio: false,
      aliases: [
        'Nota Fiscal de remessa para garantia DRONEPRO',
        'Nota Fiscal de Remessa para Garantia DRONEPRO',
        'Nota Fiscal de Remessa para Garantia',
        'NF Remessa',
      ],
    },
    {
      label: 'Nota Fiscal de remessa para garantia HUADA',
      obrigatorio: false,
      aliases: [
        'Nota Fiscal de remessa para garantia HUADA',
        'Nota Fiscal de Remessa para Garantia HUADA',
        'NF Remessa HUADA',
      ],
    },
    {
      label: 'Relatório Técnico',
      obrigatorio: false,
      aliases: ['Relatório Técnico', 'Relatorio Tecnico (OS)'],
    },
  ],
  Bateria: [
    {
      label: 'Remessa DRONEPRO (Documento de separação dos itens no estoque)',
      obrigatorio: true,
      aliases: [
        'Remessa DRONEPRO (Documento de separação dos itens no estoque)',
        'Remessa DRONEPRO',
        'Remessa DronePro',
        'Remessa (Documento de separação dos itens no estoque)',
        'Remessa (Pedido)',
        'Remessa',
        'Nota Drone Pro',
        'Nota drone pro',
        'Nota Drone Prop',
      ],
    },
    {
      label: 'Remessa HUADA (Documento de separação dos itens no estoque)',
      obrigatorio: true,
      aliases: [
        'Remessa HUADA (Documento de separação dos itens no estoque)',
        'Remessa HUADA',
        'Remessa Huada',
        'Remessa huada',
        'Nota Huada',
        'Nota huada',
      ],
    },
    {
      label: 'Caso de aprovação DJI',
      obrigatorio: false,
      aliases: ['Caso de aprovação DJI', 'Caso de aprovacao DJI'],
    },
    {
      label: 'Nota Fiscal de remessa para garantia DRONEPRO',
      obrigatorio: false,
      aliases: [
        'Nota Fiscal de remessa para garantia DRONEPRO',
        'Nota Fiscal de Remessa para Garantia DRONEPRO',
        'Nota Fiscal de Remessa para Garantia',
        'NF Remessa',
      ],
    },
    {
      label: 'Nota Fiscal de remessa para garantia HUADA',
      obrigatorio: false,
      aliases: [
        'Nota Fiscal de remessa para garantia HUADA',
        'Nota Fiscal de Remessa para Garantia HUADA',
        'NF Remessa HUADA',
      ],
    },
    {
      label: 'Relatório Técnico',
      obrigatorio: false,
      aliases: ['Relatório Técnico', 'Relatorio Tecnico (OS)'],
    },
  ],
}

const FLOW_STEPS = [
  {
    id: 1,
    title: 'Time Oficina',
    text: 'Abre o caso e anexa as Remessas DRONEPRO e HUADA (obrigatórias) e os documentos opcionais da etapa',
  },
  {
    id: 2,
    title: 'Gerente Pós-venda',
    text: 'Vanier Afonso revisa e assina digitalmente o dossiê',
  },
  {
    id: 3,
    title: 'Diretor Comercial',
    text: 'Marcus Lawder realiza a segunda assinatura digital',
  },
  {
    id: 4,
    title: 'Gestor de Estoque',
    text: 'Confere, anexa a foto dos pedidos e assina a conclusão do caso',
  },
  {
    id: 5,
    title: 'Concluído',
    text: 'Caso finalizado com histórico completo de aprovações e documentos',
  },
]

const TABLE_FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'pecas', label: 'Peças' },
  { key: 'baterias', label: 'Baterias' },
  { key: 'pendentes', label: 'Pendentes' },
]

const PENDING_STATUSES = [
  'Aguardando Documentos',
  'Aguardando Aprovação Pós-Venda',
  'Aguardando Aprovação Diretoria',
  'Aguardando Conferência Estoque',
  'Aguardando Impressão Oficina',
]

const PENDING_STATUS_CONFIG = [
  {
    status: 'Aguardando Documentos',
    label: 'Aguardando Documentos',
    to: `/casos?status=${encodeURIComponent('Aguardando Documentos')}`,
  },
  {
    status: 'Aguardando Aprovação Pós-Venda',
    label: 'Aprovação Pós-venda',
    to: '/casos?fila=pos_venda',
  },
  {
    status: 'Aguardando Aprovação Diretoria',
    label: 'Aprovação Diretor Comercial',
    to: '/casos?fila=diretoria',
  },
  {
    status: 'Aguardando Conferência Estoque',
    label: 'Conferência Gestor de Estoque',
    to: '/casos?fila=estoque',
  },
  {
    status: 'Aguardando Impressão Oficina',
    label: 'Impressão e Finalização',
    to: '/impressao-finalizacao',
  },
]

const STATUS_VIEW = {
  'Aguardando Documentos': { label: 'Aguardando docs', tone: 'warning' },
  'Aguardando Aprovação Pós-Venda': { label: 'Aprovação Pós-venda', tone: 'blue' },
  'Aguardando Aprovação Diretoria': { label: 'Aprovação diretor comercial', tone: 'warning' },
  'Aguardando Conferência Estoque': { label: 'Conferência estoque', tone: 'warning' },
  'Aguardando Impressão Oficina': { label: 'Aguardando impressão', tone: 'success' },
  Finalizado: { label: 'Finalizado', tone: 'success' },
  Reprovado: { label: 'Reprovado', tone: 'danger' },
}
const PAPEL_LABEL = {
  operador: 'Time Oficina',
  gerente_pos_venda: 'Gerente Pós-venda',
  diretor_comercial: 'Diretor Comercial',
  gestor_estoque: 'Gestor de Estoque',
  admin: 'Administrador',
}
const DASH_TIPO_META = {
  Peca: { css: 'is-peca', label: 'Peça' },
  Bateria: { css: 'is-bateria', label: 'Bateria' },
  Carregador: { css: 'is-carregador', label: 'Carregador' },
  Controle: { css: 'is-controle', label: 'Controle' },
  DevolucaoNotaFiscal: { css: 'is-default', label: 'Devolução de Nota Fiscal' },
}

function formatCaseCode(caso) {
  if (!caso) {
    return 'SEM-CASO'
  }
  return caso.dji_case_id || `CAS-${String(caso.id).padStart(6, '0')}`
}

function formatDate(dateString) {
  if (!dateString) {
    return '-'
  }
  const value = dateString.includes('T') ? dateString : `${dateString}T00:00:00`
  return new Date(value).toLocaleDateString('pt-BR')
}

function formatDateTime(dateString) {
  if (!dateString) {
    return '-'
  }
  const parsed = parseApiDateTime(dateString)
  if (!parsed) {
    return '-'
  }
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSolicitante(caso) {
  const nome = String(caso?.criado_por?.nome || '').trim()
  const papel = PAPEL_LABEL[caso?.criado_por?.papel] || ''
  if (nome && papel) {
    return `${nome} (${papel})`
  }
  if (nome) {
    return nome
  }
  if (caso?.criado_por_usuario_id) {
    return `Usuário #${caso.criado_por_usuario_id}`
  }
  return 'Não identificado'
}

function extensionTag(filename) {
  if (!filename) {
    return 'DOC'
  }
  const ext = filename.split('.').pop()
  if (!ext || ext.length > 5) {
    return 'DOC'
  }
  return ext.toUpperCase()
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function getDashTipoMeta(tipoProcesso) {
  return DASH_TIPO_META[tipoProcesso] || { css: 'is-default', label: tipoProcesso || 'Tipo' }
}

function compiledFilename(pathValue) {
  if (!pathValue) {
    return ''
  }
  const normalized = String(pathValue).replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || ''
}

export default function Dashboard() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const { podeAssinar, isAdmin, isOperador } = useAuth()
  const [stats, setStats] = useState(null)
  const [casos, setCasos] = useState([])
  const [casoDestaque, setCasoDestaque] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erroDashboard, setErroDashboard] = useState('')
  const [tableFilter, setTableFilter] = useState('todos')
  const [downloadingDossie, setDownloadingDossie] = useState(false)
  const [deletingCases, setDeletingCases] = useState({})

  const handleDownloadDossie = async () => {
    if (!casoAtual?.id) return
    setDownloadingDossie(true)
    try {
      const res = await casosAPI.downloadPdfFile(casoAtual.id)
      const filename = extractFilenameFromHeaders(res.headers, `dossie_garantia_${casoAtual.id}.pdf`)
      downloadBlob(res.data, filename)
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao baixar PDF')
    } finally {
      setDownloadingDossie(false)
    }
  }

  const refreshDashboard = useCallback(async ({ silent = true } = {}) => {
    if (!silent) setLoading(true)
    try {
      const [statsRes, casosRes] = await Promise.all([
        casosAPI.stats(),
        casosAPI.listar(),
      ])

      const lista = Array.isArray(casosRes.data) ? casosRes.data : []
      setStats(statsRes.data || {})
      setCasos(lista)
      if (!silent) setErroDashboard('')

      if (lista.length > 0) {
        try {
          const detailRes = await casosAPI.obter(lista[0].id)
          setCasoDestaque(detailRes.data)
        } catch {
          setCasoDestaque(lista[0])
        }
      } else {
        setCasoDestaque(null)
      }
    } catch (err) {
      console.error(err)
      if (!silent) {
        setErroDashboard('Falha ao carregar o dashboard. Verifique a conexão e tente novamente.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshDashboard({ silent: false }).catch((err) => console.error(err))
  }, [refreshDashboard])

  useRealtimeRefresh(
    () => refreshDashboard({ silent: true }),
    { enabled: true, intervalMs: 2000 }
  )

  const pendingSummary = useMemo(() => {
    return PENDING_STATUS_CONFIG.map((cfg) => {
      const casosStatus = casos.filter((caso) => caso.status === cfg.status)
      return {
        ...cfg,
        count: casosStatus.length,
        casos: casosStatus,
      }
    })
  }, [casos])

  const totalPendenciasDashboard = pendingSummary.reduce((acc, item) => acc + item.count, 0)
  const pendingWithCases = pendingSummary.filter((item) => item.count > 0)
  const pendingBreakdown = pendingWithCases.length > 0 ? pendingWithCases : pendingSummary
  const casoAtual = casoDestaque || casos[0] || null
  const codigoCasoAtual = formatCaseCode(casoAtual)
  const canDeleteCase = isAdmin || isOperador
  const canDeleteSpecificCase = useCallback(
    (caso) => canDeleteCase && String(caso?.status || '') !== 'Finalizado',
    [canDeleteCase]
  )

  const handleDeleteCase = async (caso) => {
    if (!canDeleteSpecificCase(caso)) {
      alert('Casos finalizados fazem parte do histórico e não podem ser excluídos.')
      return
    }
    const codigo = formatCaseCode(caso)
    if (!window.confirm(`Excluir ${codigo}?\n\nEsta ação remove o caso e os arquivos enviados.`)) return
    setDeletingCases((prev) => ({ ...prev, [caso.id]: true }))
    try {
      await casosAPI.deletar(caso.id)
      await refreshDashboard()
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao excluir caso')
    } finally {
      setDeletingCases((prev) => ({ ...prev, [caso.id]: false }))
    }
  }

  const documentosObrigatorios = DOCS_POR_TIPO[casoAtual?.tipo_processo] || DOCS_POR_TIPO.Peca
  const docsPreview = documentosObrigatorios.map((docCfg) => {
    const aliasesNorm = (docCfg.aliases || []).map((alias) => normalizeText(alias))
    const realDoc = (casoAtual?.documentos || []).find((doc) => aliasesNorm.includes(normalizeText(doc.tipo_documento)))
    if (realDoc) {
      return {
        tipo: docCfg.label,
        nome: realDoc.nome_arquivo,
        enviado: true,
        obrigatorio: docCfg.obrigatorio,
      }
    }
    return {
      tipo: docCfg.label,
      nome: '',
      enviado: false,
      obrigatorio: docCfg.obrigatorio,
    }
  })

  const assinaturaPos = (casoAtual?.assinaturas || []).find((sig) => sig.etapa_fluxo === 'Pos-venda')
  const assinaturaDir = (casoAtual?.assinaturas || []).find((sig) => sig.etapa_fluxo === 'Diretoria')
  const assinaturaEstoque = (casoAtual?.assinaturas || []).find((sig) => sig.etapa_fluxo === 'Estoque')

  const statusPos = assinaturaPos
    ? assinaturaPos.status_decisao
    : casoAtual?.status === 'Aguardando Aprovação Pós-Venda'
      ? 'Aguardando'
      : 'Pendente'

  const statusDir = assinaturaDir
    ? assinaturaDir.status_decisao
    : casoAtual?.status === 'Aguardando Aprovação Diretoria'
      ? 'Aguardando'
      : 'Pendente'

  const statusEstoque = assinaturaEstoque
    ? assinaturaEstoque.status_decisao
    : casoAtual?.status === 'Aguardando Conferência Estoque'
      ? 'Aguardando'
      : 'Pendente'

  const canSign = casoAtual ? podeAssinar(casoAtual) : false
  const hasCompiledPdf = Boolean(casoAtual?.id && casoAtual?.link_pdf_compilado)
  const pdfName = compiledFilename(casoAtual?.link_pdf_compilado)

  const assinaturaPosMeta = assinaturaPos
    ? `${assinaturaPos.usuario?.nome || 'Responsável'} em ${formatDateTime(assinaturaPos.data_assinatura)}`
    : casoAtual?.status === 'Aguardando Aprovação Pós-Venda'
      ? 'Aguardando assinatura do gerente de pós-venda.'
      : casoAtual?.status === 'Aguardando Documentos'
        ? 'Etapa ainda não iniciada.'
        : casoAtual?.status === 'Reprovado'
          ? 'Fluxo encerrado por reprovação.'
          : 'Etapa concluída.'

  const assinaturaDirMeta = assinaturaDir
    ? `${assinaturaDir.usuario?.nome || 'Responsável'} em ${formatDateTime(assinaturaDir.data_assinatura)}`
    : casoAtual?.status === 'Aguardando Aprovação Diretoria'
      ? 'Aguardando assinatura do diretor comercial.'
    : ['Aguardando Documentos', 'Aguardando Aprovação Pós-Venda'].includes(casoAtual?.status || '')
        ? 'Etapa ainda não liberada.'
        : casoAtual?.status === 'Reprovado'
          ? 'Fluxo encerrado por reprovação.'
          : 'Etapa concluída.'

  const assinaturaEstoqueMeta = assinaturaEstoque
    ? `${assinaturaEstoque.usuario?.nome || 'Responsável'} em ${formatDateTime(assinaturaEstoque.data_assinatura)}`
    : casoAtual?.status === 'Aguardando Conferência Estoque'
      ? 'Aguardando conferência, foto dos pedidos e assinatura final do gestor de estoque.'
      : ['Aguardando Documentos', 'Aguardando Aprovação Pós-Venda', 'Aguardando Aprovação Diretoria'].includes(casoAtual?.status || '')
        ? 'Etapa ainda não liberada.'
        : casoAtual?.status === 'Reprovado'
          ? 'Fluxo encerrado por reprovação.'
          : 'Etapa concluída.'

  const tableRows = useMemo(() => {
    const filtered = casos.filter((caso) => {
      if (tableFilter === 'pecas') return caso.tipo_processo === 'Peca'
      if (tableFilter === 'baterias') return caso.tipo_processo === 'Bateria'
      if (tableFilter === 'pendentes') return PENDING_STATUSES.includes(caso.status)
      return true
    })
    return filtered.slice(0, 8)
  }, [casos, tableFilter])

  const cards = [
    {
      label: 'Total de Casos',
      value: stats?.total_casos ?? 0,
      detail: `${casos.length} casos carregados no monitoramento em tempo real`,
      tone: 'blue',
    },
    {
      label: 'Pendências no Dashboard',
      value: totalPendenciasDashboard,
      detail: 'Todas as etapas pendentes centralizadas por status',
      breakdown: pendingBreakdown.map((item) => ({
        label: item.label,
        value: item.count,
        to: item.to,
      })),
      tone: 'amber',
    },
    {
      label: 'Aprovados',
      value: stats?.finalizados ?? 0,
      detail: `${stats?.rebate_aguardando_apuracao ?? 0} rebate aguardando apuração`,
      tone: 'green',
    },
    {
      label: 'Reprovados',
      value: stats?.reprovados ?? 0,
      detail: 'Casos marcados para revisão',
      tone: 'red',
    },
  ]

  return (
    <div className="dash-page">
      {loading ? (
        <div className="dp-panel dash-loading">Carregando dashboard...</div>
      ) : (
        <>
          {erroDashboard && (
            <section className="dp-panel" style={{ marginBottom: 12, borderColor: '#fecdd3', background: '#fff1f2', color: '#9f1239' }}>
              {erroDashboard}
            </section>
          )}

          <section className="dash-kpi-grid">
            {cards.map((card) => (
              <article key={card.label} className={`dash-kpi-card tone-${card.tone}`}>
                <p className="dash-kpi-label">{card.label}</p>
                <h3 className="dash-kpi-value">{card.value}</h3>
                <p className="dash-kpi-detail">{card.detail}</p>
                {Array.isArray(card.breakdown) && card.breakdown.length > 0 && (
                  <div className="dash-kpi-breakdown">
                    {card.breakdown.map((item) => (
                      <Link key={item.label} className="dash-kpi-break-item" to={item.to}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </Link>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>

          <section className="dp-panel">
            <div className="dp-panel-head panel-space">
              <h2>Pendências da Operação</h2>
              <span className="dp-chip-subtle">{totalPendenciasDashboard} pendente(s)</span>
            </div>
            {pendingWithCases.length === 0 ? (
              <div className="dash-empty-cell">Nenhuma pendência ativa no momento.</div>
            ) : (
              <div className="dash-pending-grid">
                {pendingSummary.map((item) => (
                  <article
                    key={item.status}
                    className={`dash-pending-card tone-${STATUS_VIEW[item.status]?.tone || 'neutral'} ${item.count > 0 ? 'is-active' : 'is-empty'}`}
                  >
                    <div className="dash-pending-head">
                      <div className="dash-pending-title-wrap">
                        <h3 className="dash-pending-title">{item.label}</h3>
                        <div className="dash-pending-subtitle">{item.status}</div>
                      </div>
                      <span className="dash-pending-count">
                        {item.count}
                      </span>
                    </div>

                    {item.count > 0 ? (
                      <div className="dash-pending-case-list">
                        {item.casos.slice(0, 3).map((caso) => (
                          <Link
                            key={caso.id}
                            to={`/casos/${caso.id}`}
                            className="dash-pending-case-chip"
                          >
                            {formatCaseCode(caso)}
                          </Link>
                        ))}
                        {item.count > 3 && (
                          <span className="dash-pending-more">
                            +{item.count - 3} caso(s)
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="dash-pending-empty">
                        Sem pendências neste status.
                      </div>
                    )}

                    <div className="dash-pending-actions">
                      <Link className={`dash-pending-open ${item.count === 0 ? 'is-ghost' : ''}`} to={item.to}>
                        Abrir fila
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="dp-panel">
            <div className="dp-panel-head">
              <h2>Fluxo do Processo</h2>
              <span className="dp-chip-subtle">Sequencial</span>
            </div>

            <div className="dash-flow-row">
              {FLOW_STEPS.map((step, index) => (
                <React.Fragment key={step.id}>
                  <article className="dash-flow-step">
                    <div className="dash-flow-index">{step.id}</div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </article>
                  {index < FLOW_STEPS.length - 1 && <div className="dash-flow-arrow">{'>'}</div>}
                </React.Fragment>
              ))}
            </div>
          </section>

          <section className="dp-panel">
            <div className="dp-panel-head">
              <h2>Detalhes do Caso</h2>
              <span className="dp-chip-case">{codigoCasoAtual}</span>
            </div>
            <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
              Solicitado por: <strong style={{ color: 'var(--text)' }}>{formatSolicitante(casoAtual)}</strong>
            </div>

            <div className="dash-details-grid">
              <article className="dash-module-card">
                <header className="dash-module-head tone-blue">
                  <h3>Upload de Documentos</h3>
                  <span>Etapa 1</span>
                </header>

                <div className="dash-upload-note">
                  <p>Envio de arquivos disponível na tela completa do caso.</p>
                  {casoAtual?.id ? (
                    <Link className="dash-open-case-btn" to={`/casos/${casoAtual.id}`}>
                      Abrir caso para anexar documentos
                    </Link>
                  ) : (
                    <span className="dash-open-case-btn is-disabled">Nenhum caso selecionado</span>
                  )}
                </div>

                <div className="dash-doc-list">
                  {docsPreview.map((doc) => (
                    <div key={doc.tipo} className="dash-doc-row">
                      <div className={`dash-doc-ext ${doc.enviado ? 'is-sent' : ''}`}>
                        {extensionTag(doc.nome)}
                      </div>
                      <div className="dash-doc-meta">
                        <div className="dash-doc-name">{doc.nome || 'Não enviado'}</div>
                        <div className="dash-doc-type">
                          {doc.tipo} {doc.obrigatorio ? '(Obrigatório)' : '(Opcional)'}
                        </div>
                      </div>
                      <span className={`dash-doc-state ${doc.enviado ? 'is-sent' : 'is-pending'}`}>
                        {doc.enviado ? 'Enviado' : 'Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
              </article>

              <div className="dash-right-stack">
                <article className="dash-module-card">
                  <header className="dash-module-head tone-green">
                    <h3>Assinatura e Aprovação</h3>
                    <span>Etapas 2 a 4</span>
                  </header>

                  <div className="dash-sign-card">
                    <div className="dash-sign-title">1ª Assinatura - Vanier Afonso (Gerente de Pós-venda)</div>
                    <div className="dash-sign-meta">{assinaturaPosMeta}</div>
                    <span className={`dash-sign-badge state-${statusPos.toLowerCase()}`}>
                      {statusPos}
                    </span>
                  </div>

                  <div className="dash-sign-card">
                    <div className="dash-sign-title">2ª Assinatura - Marcus Lawder (Diretor Comercial)</div>
                    <div className="dash-sign-meta">{assinaturaDirMeta}</div>
                    <span className={`dash-sign-badge state-${statusDir.toLowerCase()}`}>
                      {statusDir}
                    </span>
                  </div>

                  <div className="dash-sign-card">
                    <div className="dash-sign-title">3ª Assinatura - Gestor de Estoque</div>
                    <div className="dash-sign-meta">{assinaturaEstoqueMeta}</div>
                    <span className={`dash-sign-badge state-${statusEstoque.toLowerCase()}`}>
                      {statusEstoque}
                    </span>
                  </div>

                  {canSign && casoAtual && (
                    <div className="dash-sign-actions">
                      <Link className="dash-approve-btn" to={`/casos/${casoAtual.id}`}>
                        Assinar e Aprovar
                      </Link>
                      <Link className="dash-reject-btn" to={`/casos/${casoAtual.id}`}>
                        Reprovar
                      </Link>
                    </div>
                  )}

                  {casoAtual?.status === 'Aguardando Impressão Oficina' && (
                    <div className="dash-print-note">
                      <div className="dash-print-title">Impressão em 3 vias pela oficina:</div>
                      <div>1ª via: Financeiro</div>
                      <div>2ª via: Estoque</div>
                      <div>3ª via: Controle da Oficina</div>
                    </div>
                  )}
                </article>

                <article className="dash-module-card">
                  <h3 className="dash-dossie-title">Dossiê Compilado (PDF Único)</h3>
                  <div className="dash-dossie-box">
                    <div className="dash-dossie-icon">DOC</div>
                    <div className="dash-dossie-name">{hasCompiledPdf ? (pdfName || 'Documento compilado') : 'PDF ainda indisponível'}</div>
                    <div className="dash-dossie-meta">
                      {hasCompiledPdf
                        ? `${casoAtual?.documentos?.length || 0} documentos consolidados`
                        : 'Gerado automaticamente conforme avanço das assinaturas da esteira'}
                    </div>
                    {hasCompiledPdf ? (
                      <button
                        className="dash-download-btn"
                        type="button"
                        onClick={handleDownloadDossie}
                        disabled={downloadingDossie}
                      >
                        {downloadingDossie ? 'Baixando...' : 'Download PDF'}
                      </button>
                    ) : (
                      <button className="dash-download-btn is-disabled" type="button" disabled>
                        PDF indisponível
                      </button>
                    )}
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section className="dp-panel">
            <div className="dp-panel-head panel-space">
              <h2>Todos os Casos de Garantia</h2>
              <div className="dash-filter-chips">
                {TABLE_FILTERS.map((chip) => (
                  <button
                    key={chip.key}
                    className={`dash-filter-chip ${tableFilter === chip.key ? 'is-active' : ''}`}
                    onClick={() => setTableFilter(chip.key)}
                    type="button"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="dash-table-wrap">
              {isMobile ? (
                <div className="dash-mobile-list">
                  {tableRows.length === 0 ? (
                    <div className="dash-empty-cell">Nenhum caso encontrado para este filtro.</div>
                  ) : (
                    tableRows.map((caso) => {
                      const statusView = STATUS_VIEW[caso.status] || { label: caso.status || '-', tone: 'neutral' }
                      const tipoMeta = getDashTipoMeta(caso.tipo_processo)
                      return (
                        <article key={caso.id} className="dash-mobile-card">
                          <div className="dash-mobile-head">
                            <strong>{formatCaseCode(caso)}</strong>
                            <span className={`dash-status-pill tone-${statusView.tone}`}>
                              {statusView.label}
                            </span>
                          </div>
                          <div className="dash-mobile-line"><span>Cliente</span>{caso.cliente?.razao_social || '-'}</div>
                          <div className="dash-mobile-line"><span>Solicitado por</span>{formatSolicitante(caso)}</div>
                          <div className="dash-mobile-line"><span>Produto</span>{caso.produto_modelo || caso.produto_nome || '-'}</div>
                          <div className="dash-mobile-line"><span>Data</span>{formatDate(caso.data_entrada)}</div>
                          <div className="dash-mobile-foot">
                            <span className={`dash-type-pill ${tipoMeta.css}`}>
                              {tipoMeta.label}
                            </span>
                            <div className="dash-actions-cell">
                              <Link className="dash-view-btn" to={`/casos/${caso.id}`}>
                                Ver Caso
                              </Link>
                              {canDeleteSpecificCase(caso) && (
                                <button
                                  type="button"
                                  className="dash-delete-btn"
                                  onClick={() => handleDeleteCase(caso)}
                                  disabled={!!deletingCases[caso.id]}
                                  title="Excluir caso"
                                >
                                  {deletingCases[caso.id] ? '...' : '🗑'}
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      )
                    })
                  )}
                </div>
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>ID do Caso DJI</th>
                      <th>Cliente</th>
                      <th>Solicitado por</th>
                      <th>Tipo</th>
                      <th>Produto</th>
                      <th>Data Entrada</th>
                      <th>Status</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="dash-empty-cell">
                          Nenhum caso encontrado para este filtro.
                        </td>
                      </tr>
                    ) : (
                      tableRows.map((caso) => {
                        const statusView = STATUS_VIEW[caso.status] || { label: caso.status || '-', tone: 'neutral' }
                        const tipoMeta = getDashTipoMeta(caso.tipo_processo)
                        return (
                          <tr key={caso.id}>
                            <td>{formatCaseCode(caso)}</td>
                            <td>{caso.cliente?.razao_social || '-'}</td>
                            <td>{formatSolicitante(caso)}</td>
                            <td>
                              <span className={`dash-type-pill ${tipoMeta.css}`}>
                                {tipoMeta.label}
                              </span>
                            </td>
                            <td>{caso.produto_modelo || caso.produto_nome || '-'}</td>
                            <td>{formatDate(caso.data_entrada)}</td>
                            <td>
                              <span className={`dash-status-pill tone-${statusView.tone}`}>
                                {statusView.label}
                              </span>
                            </td>
                            <td>
                              <div className="dash-actions-cell">
                                <Link className="dash-view-btn" to={`/casos/${caso.id}`}>
                                  Ver Caso
                                </Link>
                                {canDeleteSpecificCase(caso) && (
                                  <button
                                    type="button"
                                    className="dash-delete-btn"
                                    onClick={() => handleDeleteCase(caso)}
                                    disabled={!!deletingCases[caso.id]}
                                    title="Excluir caso"
                                  >
                                    {deletingCases[caso.id] ? '...' : '🗑'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

