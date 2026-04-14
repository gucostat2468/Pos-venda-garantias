import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import useMediaQuery from '../hooks/useMediaQuery'
import useRealtimeRefresh from '../hooks/useRealtimeRefresh'
import { notificacoesAPI } from '../api'
import { formatApiDateTimeBR } from '../utils/datetime'

const PAPEL_LABEL = {
  admin: 'Administrador',
  operador: 'Time Oficina',
  gerente_pos_venda: 'Gerente de Pós-venda',
  diretor_comercial: 'Diretor Comercial',
  gestor_estoque: 'Gestor de Estoque',
}

const NOTIFICACAO_META = {
  solicitacao_aberta_oficina: {
    icon: '🆕',
    label: 'Abertura',
    tone: 'blue',
  },
  novo_caso_pos_venda: {
    icon: '📄',
    label: 'Pronto para Pós-venda',
    tone: 'teal',
  },
  pendencia_assinatura_diretoria: {
    icon: '✍️',
    label: 'Pendente da Diretoria',
    tone: 'amber',
  },
  pendencia_assinatura_estoque: {
    icon: '📦',
    label: 'Pendente do Estoque',
    tone: 'amber',
  },
  pronto_impressao_finalizacao: {
    icon: '🖨️',
    label: 'Impressão e Finalização',
    tone: 'green',
  },
  caso_finalizado_estoque: {
    icon: '✅',
    label: 'Concluído pelo Estoque',
    tone: 'green',
  },
  operacao_caso_criado: {
    icon: '🆕',
    label: 'Caso criado',
    tone: 'blue',
  },
  operacao_caso_atualizado: {
    icon: '✏️',
    label: 'Caso atualizado',
    tone: 'teal',
  },
  operacao_caso_excluido: {
    icon: '🗑️',
    label: 'Caso excluído',
    tone: 'red',
  },
  operacao_documento_anexado: {
    icon: '📎',
    label: 'Documento anexado',
    tone: 'teal',
  },
  operacao_documento_substituido: {
    icon: '🔁',
    label: 'Documento substituído',
    tone: 'teal',
  },
  operacao_documento_excluido: {
    icon: '🧹',
    label: 'Documento removido',
    tone: 'amber',
  },
  operacao_documento_assinado: {
    icon: '✍️',
    label: 'Documento assinado',
    tone: 'amber',
  },
  operacao_fluxo_movido: {
    icon: '➡️',
    label: 'Fluxo avançou',
    tone: 'blue',
  },
  operacao_fluxo_retrocedido: {
    icon: '↩️',
    label: 'Fluxo retrocedeu',
    tone: 'amber',
  },
  operacao_caso_assinado: {
    icon: '✅',
    label: 'Etapa assinada',
    tone: 'green',
  },
  operacao_caso_reprovado: {
    icon: '⛔',
    label: 'Caso reprovado',
    tone: 'red',
  },
  operacao_caso_finalizado: {
    icon: '🏁',
    label: 'Caso finalizado',
    tone: 'green',
  },
  operacao_pdf_recompilado: {
    icon: '📚',
    label: 'Dossiê recompilado',
    tone: 'neutral',
  },
  default: {
    icon: '🔔',
    label: 'Atualização',
    tone: 'neutral',
  },
}

const PAGE_META = [
  {
    test: (path) => path === '/',
    title: 'Dashboard de Garantias',
    subtitle: 'Visão geral dos processos de aprovação',
  },
  {
    test: (path) => path === '/casos',
    title: 'Todos os Casos de Garantia',
    subtitle: 'Consulta e acompanhamento operacional',
  },
  {
    test: (path) => path === '/casos/novo',
    title: 'Novo Caso',
    subtitle: 'Cadastro de solicitação de garantia',
  },
  {
    test: (path) => /^\/casos\/\d+$/.test(path),
    title: 'Detalhes do Caso',
    subtitle: 'Documentação, assinaturas e dossiê',
  },
  {
    test: (path) => path === '/impressao-finalizacao',
    title: 'Imprimir e Finalizar',
    subtitle: 'Fila final da oficina e histórico de finalizados',
  },
  {
    test: (path) => path === '/finalizados',
    title: 'Histórico de Finalizados',
    subtitle: 'Registro permanente de casos concluídos',
  },
  {
    test: (path) => path === '/clientes',
    title: 'Clientes',
    subtitle: 'Base cadastrada de parceiros',
  },
  {
    test: (path) => path === '/usuarios',
    title: 'Usuários',
    subtitle: 'Controle de acesso do sistema',
  },
  {
    test: (path) => path === '/credito',
    title: 'Créditos',
    subtitle: 'Extratos e conciliação financeira',
  },
]

const FILA_PARAM_TO_STATUS = {
  pos_venda: 'Aguardando Aprovação Pós-Venda',
  diretoria: 'Aguardando Aprovação Diretoria',
  estoque: 'Aguardando Conferência Estoque',
}

function normalizarStatus(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

const STATUS_NORMALIZADO_TO_CANONICO = Object.values(FILA_PARAM_TO_STATUS).reduce((acc, status) => {
  acc[normalizarStatus(status)] = status
  return acc
}, {})

function resolverStatusDaBusca(searchValue) {
  const fila = String(searchValue.get('fila') || '').trim().toLowerCase()
  if (FILA_PARAM_TO_STATUS[fila]) {
    return FILA_PARAM_TO_STATUS[fila]
  }
  const statusRaw = searchValue.get('status') || ''
  const canonico = STATUS_NORMALIZADO_TO_CANONICO[normalizarStatus(statusRaw)]
  return canonico || statusRaw
}

function getPageMeta(pathname) {
  const meta = PAGE_META.find((item) => item.test(pathname))
  if (meta) {
    return meta
  }
  return {
    title: 'DronePro Garantias',
    subtitle: 'Painel operacional',
  }
}

function getInitials(nome) {
  if (!nome) {
    return 'DP'
  }
  const parts = String(nome).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function getNotificacaoMeta(tipo) {
  return NOTIFICACAO_META[tipo] || NOTIFICACAO_META.default
}

function SidebarItem({ to, icon, label, active, disabled }) {
  if (disabled) {
    return (
      <div className="dp-nav-link dp-nav-link-disabled">
        <span className="dp-nav-icon">{icon}</span>
        <span className="dp-nav-label">{label}</span>
      </div>
    )
  }

  return (
    <Link className={`dp-nav-link ${active ? 'is-active' : ''}`} to={to}>
      <span className="dp-nav-icon">{icon}</span>
      <span className="dp-nav-label">{label}</span>
    </Link>
  )
}

export default function Layout({ children }) {
  const { user, logout, isAdmin, isOperador, isGestorEstoque } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useMediaQuery('(max-width: 980px)')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [notificacoes, setNotificacoes] = useState([])
  const [naoLidas, setNaoLidas] = useState(0)
  const [notificacoesOpen, setNotificacoesOpen] = useState(false)
  const [notificacoesDisponiveis, setNotificacoesDisponiveis] = useState(true)
  const [notifLoading, setNotifLoading] = useState(false)
  const [notifErro, setNotifErro] = useState('')
  const [notifAtualizando, setNotifAtualizando] = useState(false)
  const notifRef = useRef(null)
  const pageMeta = getPageMeta(location.pathname)
  const searchValue = new URLSearchParams(location.search)
  const statusQuery = resolverStatusDaBusca(searchValue)
  const isQueueStatus =
    statusQuery === 'Aguardando Aprovação Pós-Venda' ||
    statusQuery === 'Aguardando Aprovação Diretoria' ||
    statusQuery === 'Aguardando Conferência Estoque'
  const isPrintQueuePath = location.pathname === '/impressao-finalizacao'
  const isFinalizadosPath = location.pathname === '/finalizados'

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false)
    }
  }, [isMobile])

  const carregarNotificacoes = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) return
    if (!notificacoesDisponiveis) return
    if (!silent) setNotifLoading(true)
    try {
      const [listaRes, resumoRes] = await Promise.all([
        notificacoesAPI.listar({ limite: 30 }),
        notificacoesAPI.resumo(),
      ])
      setNotificacoes(Array.isArray(listaRes.data) ? listaRes.data : [])
      setNaoLidas(Number(resumoRes.data?.nao_lidas || 0))
      if (!notificacoesDisponiveis) {
        setNotificacoesDisponiveis(true)
      }
      setNotifErro('')
    } catch (err) {
      console.error(err)
      if (err?.response?.status === 404) {
        setNotificacoesDisponiveis(false)
        setNotificacoes([])
        setNaoLidas(0)
        setNotifErro('Central de notificações indisponível neste backend. Reinicie o backend com a versão atualizada.')
        return
      }
      if (!silent) setNotifErro('Falha ao carregar notificações.')
    } finally {
      if (!silent) setNotifLoading(false)
    }
  }, [user?.id, notificacoesDisponiveis])

  useEffect(() => {
    if (!user?.id) return undefined
    setNotificacoesDisponiveis(true)
    carregarNotificacoes({ silent: false }).catch((err) => console.error(err))
    return undefined
  }, [user?.id, carregarNotificacoes])

  useRealtimeRefresh(
    () => carregarNotificacoes({ silent: true }),
    { enabled: Boolean(user?.id) && notificacoesDisponiveis, intervalMs: 2000 }
  )

  useEffect(() => {
    setNotificacoesOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!notificacoesOpen) return undefined
    const onPointerDown = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotificacoesOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [notificacoesOpen])

  const handleToggleNotificacoes = async () => {
    setNotificacoesOpen((prev) => !prev)
    if (!notificacoesDisponiveis) return
    if (!notificacoesOpen) {
      await carregarNotificacoes({ silent: false })
    }
  }

  const handleMarcarLida = async (notificacaoId) => {
    if (!notificacaoId) return
    const alvo = notificacoes.find((n) => n.id === notificacaoId)
    if (!alvo || alvo.lida) return
    setNotifAtualizando(true)
    try {
      await notificacoesAPI.marcarLida(notificacaoId)
      setNotificacoes((prev) => prev.map((n) => (
        n.id === notificacaoId ? { ...n, lida: 1, lida_em: new Date().toISOString() } : n
      )))
      setNaoLidas((prev) => Math.max(prev - 1, 0))
    } catch (err) {
      console.error(err)
      setNotifErro('Falha ao marcar notificação como lida.')
    } finally {
      setNotifAtualizando(false)
    }
  }

  const handleMarcarTodasLidas = async () => {
    setNotifAtualizando(true)
    try {
      const res = await notificacoesAPI.marcarTodasLidas()
      const total = Number(res.data?.total || 0)
      if (total > 0) {
        const now = new Date().toISOString()
        setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: 1, lida_em: now })))
      }
      setNaoLidas(0)
    } catch (err) {
      console.error(err)
      setNotifErro('Falha ao marcar notificações.')
    } finally {
      setNotifAtualizando(false)
    }
  }

  const handleAbrirCasoNotificacao = async (notificacao) => {
    if (!notificacao) return
    if (!notificacao.lida) {
      await handleMarcarLida(notificacao.id)
    }
    setNotificacoesOpen(false)
    if (notificacao.case_id) {
      navigate(`/casos/${notificacao.case_id}`)
    }
  }

  const menuPrincipal = [
    {
      to: '/',
      icon: '■',
      label: 'Dashboard',
      active: location.pathname === '/',
    },
    {
      to: '/casos/novo',
      icon: '+',
      label: 'Novo Caso',
      active: location.pathname === '/casos/novo',
    },
    {
      to: '/casos',
      icon: '□',
      label: 'Meus Casos',
      active:
        (location.pathname === '/casos' && !isQueueStatus) ||
        /^\/casos\/\d+$/.test(location.pathname),
    },
  ]

  const menuAprovacoes = [
    {
      to: '/casos?fila=pos_venda',
      icon: '>',
      label: 'Fila Pós-venda',
      active:
        location.pathname === '/casos' &&
        statusQuery === 'Aguardando Aprovação Pós-Venda',
    },
    {
      to: '/casos?fila=diretoria',
      icon: '>',
      label: 'Fila Diretor Comercial',
      active:
        location.pathname === '/casos' &&
        statusQuery === 'Aguardando Aprovação Diretoria',
    },
    ...((isGestorEstoque || isAdmin) ? [{
      to: '/casos?fila=estoque',
      icon: '>',
      label: 'Fila Gestor Estoque',
      active:
        location.pathname === '/casos' &&
        statusQuery === 'Aguardando Conferência Estoque',
    }] : []),
    ...((isOperador || isAdmin) ? [{
      to: '/impressao-finalizacao',
      icon: '>',
      label: 'Imprimir e Finalizar',
      active: isPrintQueuePath,
    }] : []),
    {
      to: '/finalizados',
      icon: '>',
      label: 'Histórico Finalizados',
      active: isFinalizadosPath,
    },
  ]

  const menuAdmin = [
    {
      to: '/clientes',
      icon: 'o',
      label: 'Clientes',
      active: location.pathname === '/clientes',
      disabled: false,
    },
    {
      to: '/usuarios',
      icon: 'o',
      label: 'Usuários',
      active: location.pathname === '/usuarios',
      disabled: !isAdmin,
    },
    {
      to: '/credito',
      icon: 'o',
      label: 'Configurações',
      active: location.pathname === '/credito',
      disabled: false,
    },
  ]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }
  const setorNotificacoes = PAPEL_LABEL[user?.papel] || 'Setor'

  return (
    <div className="dp-shell">
      {isMobile && mobileMenuOpen && (
        <button
          className="dp-mobile-overlay"
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`dp-sidebar ${isMobile ? 'is-mobile' : ''} ${mobileMenuOpen ? 'is-open' : ''}`}>
        <div className="dp-brand">
          <div className="dp-brand-logo">DP</div>
          <div className="dp-brand-copy">
            <div className="dp-brand-title">DronePro Garantias</div>
            <div className="dp-brand-subtitle">Painel de aprovações</div>
          </div>
        </div>

        <nav className="dp-nav-group">
          {menuPrincipal.map((item) => (
            <SidebarItem key={item.label} {...item} />
          ))}
        </nav>

        <div className="dp-nav-section">Aprovações</div>
        <nav className="dp-nav-group">
          {menuAprovacoes.map((item) => (
            <SidebarItem key={item.label} {...item} />
          ))}
        </nav>

        <div className="dp-nav-section">Administração</div>
        <nav className="dp-nav-group">
          {menuAdmin.map((item) => (
            <SidebarItem key={item.label} {...item} />
          ))}
        </nav>

        <div className="dp-sidebar-footer">
          <div className="dp-sidebar-user">
            <div className="dp-sidebar-avatar">{getInitials(user?.nome)}</div>
            <div>
              <div className="dp-sidebar-user-name">{user?.nome || 'Usuario'}</div>
              <div className="dp-sidebar-user-role">
                {PAPEL_LABEL[user?.papel] || user?.papel || 'Sem papel'}
              </div>
            </div>
          </div>
          <button className="dp-logout-btn" onClick={handleLogout} type="button">
            Sair
          </button>
        </div>
      </aside>

      <main className="dp-main">
        <header className="dp-topbar">
          <div>
            <h1 className="dp-page-title">{pageMeta.title}</h1>
            <p className="dp-page-subtitle">{pageMeta.subtitle}</p>
          </div>
          <div className="dp-topbar-right">
            {isMobile && (
              <button
                className="dp-mobile-menu-btn"
                type="button"
                aria-label="Abrir menu"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
              >
                ☰
              </button>
            )}
            <div className="dp-notif-wrap" ref={notifRef}>
              <button
                className="dp-icon-btn dp-notif-btn"
                type="button"
                aria-label="Notificações"
                onClick={handleToggleNotificacoes}
              >
                🔔
                {naoLidas > 0 && (
                  <span className="dp-notif-badge" aria-label={`${naoLidas} não lidas`}>
                    {naoLidas > 99 ? '99+' : naoLidas}
                  </span>
                )}
              </button>

              {notificacoesOpen && (
                <div className="dp-notif-panel" role="dialog" aria-label="Central de notificações">
                  <div className="dp-notif-panel-head">
                    <div>
                      <div className="dp-notif-title">Notificações do Setor</div>
                      <div className="dp-notif-subtitle">{setorNotificacoes}</div>
                    </div>
                    <button
                      type="button"
                      className="dp-notif-mark-all"
                      onClick={handleMarcarTodasLidas}
                      disabled={notifAtualizando || naoLidas === 0 || !notificacoesDisponiveis}
                    >
                      Marcar todas
                    </button>
                  </div>

                  {notifErro && <div className="dp-notif-error">{notifErro}</div>}

                  {notifLoading ? (
                    <div className="dp-notif-empty">Carregando notificações...</div>
                  ) : notificacoes.length === 0 ? (
                    <div className="dp-notif-empty">Nenhum aviso para este setor no momento.</div>
                  ) : (
                    <div className="dp-notif-list">
                      {notificacoes.map((notificacao) => {
                        const meta = getNotificacaoMeta(notificacao.tipo)
                        return (
                        <article
                          key={notificacao.id}
                          className={`dp-notif-item ${notificacao.lida ? 'is-read' : 'is-unread'} tone-${meta.tone}`}
                        >
                          <div className="dp-notif-item-head">
                            <div className="dp-notif-item-title-wrap">
                              <span className={`dp-notif-type type-${meta.tone}`}>
                                <span>{meta.icon}</span> {meta.label}
                              </span>
                              <strong>{notificacao.titulo}</strong>
                            </div>
                            {!notificacao.lida && <span className="dp-notif-pill">Novo</span>}
                          </div>
                          {notificacao.case_id && (
                            <div className="dp-notif-case">Caso #{notificacao.case_id}</div>
                          )}
                          <p className="dp-notif-item-msg">{notificacao.mensagem}</p>
                          <div className="dp-notif-item-meta">
                            {formatApiDateTimeBR(notificacao.criado_em)}
                          </div>
                          <div className="dp-notif-item-actions">
                            {notificacao.case_id && (
                              <button
                                type="button"
                                className="dp-notif-open-case"
                                onClick={() => handleAbrirCasoNotificacao(notificacao)}
                              >
                                Abrir Caso
                              </button>
                            )}
                            {!notificacao.lida && (
                              <button
                                type="button"
                                className="dp-notif-mark-one"
                                onClick={() => handleMarcarLida(notificacao.id)}
                                disabled={notifAtualizando}
                              >
                                Marcar como lida
                              </button>
                            )}
                          </div>
                        </article>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="dp-topbar-avatar">{getInitials(user?.nome)}</div>
          </div>
        </header>

        <section className="dp-content">{children}</section>
      </main>

      {isMobile && (
        <nav className="dp-mobile-nav" aria-label="Atalhos principais">
          <Link className={`dp-mobile-nav-item ${location.pathname === '/' ? 'is-active' : ''}`} to="/">
            <span>🏠</span>
            <small>Início</small>
          </Link>
          <Link className={`dp-mobile-nav-item ${((location.pathname === '/casos') || /^\/casos\/\d+$/.test(location.pathname)) ? 'is-active' : ''}`} to="/casos">
            <span>📋</span>
            <small>Casos</small>
          </Link>
          <Link className={`dp-mobile-nav-item ${location.pathname === '/casos/novo' ? 'is-active' : ''}`} to="/casos/novo">
            <span>➕</span>
            <small>Novo</small>
          </Link>
          <Link className={`dp-mobile-nav-item ${location.pathname === '/clientes' ? 'is-active' : ''}`} to="/clientes">
            <span>🏢</span>
            <small>Clientes</small>
          </Link>
          <button className={`dp-mobile-nav-item ${mobileMenuOpen ? 'is-active' : ''}`} type="button" onClick={() => setMobileMenuOpen((prev) => !prev)}>
            <span>☰</span>
            <small>Menu</small>
          </button>
        </nav>
      )}
    </div>
  )
}
