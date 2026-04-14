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

function urlBase64ToUint8Array(base64String) {
  const normalized = String(base64String || '').replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  const base64 = normalized + padding
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i)
  }
  return output
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
  const [popupsTempoReal, setPopupsTempoReal] = useState([])
  const notifRef = useRef(null)
  const notificacoesInicializadasRef = useRef(false)
  const idsNotificacoesVistosRef = useRef(new Set())
  const popupTimersRef = useRef(new Map())
  const pageMeta = getPageMeta(location.pathname)
  const searchValue = new URLSearchParams(location.search)
  const statusQuery = resolverStatusDaBusca(searchValue)
  const isQueueStatus =
    statusQuery === 'Aguardando Aprovação Pós-Venda' ||
    statusQuery === 'Aguardando Aprovação Diretoria' ||
    statusQuery === 'Aguardando Conferência Estoque'
  const isPrintQueuePath = location.pathname === '/impressao-finalizacao'
  const isFinalizadosPath = location.pathname === '/finalizados'

  const limparPopup = useCallback((popupId) => {
    if (!popupId) return
    const timer = popupTimersRef.current.get(popupId)
    if (timer) {
      window.clearTimeout(timer)
      popupTimersRef.current.delete(popupId)
    }
    setPopupsTempoReal((prev) => prev.filter((p) => p.id !== popupId))
  }, [])

  const abrirPopupTempoReal = useCallback((notificacao) => {
    if (!notificacao?.id) return
    const popupId = `notif-${notificacao.id}-${Date.now()}`
    setPopupsTempoReal((prev) => {
      const next = [{ id: popupId, notificacao }, ...prev]
      return next.slice(0, 4)
    })
    const timer = window.setTimeout(() => {
      popupTimersRef.current.delete(popupId)
      setPopupsTempoReal((prev) => prev.filter((p) => p.id !== popupId))
    }, 10000)
    popupTimersRef.current.set(popupId, timer)

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const nativeNotif = new Notification(notificacao.titulo || 'Nova notificação', {
          body: notificacao.mensagem || 'Atualização na esteira',
          tag: `caso-${notificacao.case_id || notificacao.id}`,
        })
        nativeNotif.onclick = () => {
          window.focus()
          if (notificacao.case_id) {
            navigate(`/casos/${notificacao.case_id}`)
          }
        }
      } catch (err) {
        console.error(err)
      }
    }
  }, [navigate])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false)
    }
  }, [isMobile])

  useEffect(() => () => {
    popupTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    popupTimersRef.current.clear()
  }, [])

  useEffect(() => {
    notificacoesInicializadasRef.current = false
    idsNotificacoesVistosRef.current = new Set()
    setPopupsTempoReal([])
    popupTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    popupTimersRef.current.clear()
    if (user?.id && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch((err) => console.error(err))
    }
  }, [user?.id])

  const sincronizarPushSubscription = useCallback(async () => {
    if (!user?.id) return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return

    try {
      const cfgRes = await notificacoesAPI.pushConfig()
      const cfg = cfgRes?.data || {}
      if (!cfg?.enabled || !cfg?.public_vapid_key) return

      await navigator.serviceWorker.register('/sw.js')
      const registration = await navigator.serviceWorker.ready

      let permission = Notification.permission
      if (permission !== 'granted') {
        permission = await Notification.requestPermission()
      }
      if (permission !== 'granted') return

      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.public_vapid_key),
        })
      }

      const serialized = subscription.toJSON() || {}
      const keys = serialized.keys || {}
      if (!keys.p256dh || !keys.auth) return

      await notificacoesAPI.pushSubscribe({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        user_agent: navigator.userAgent,
      })
    } catch (err) {
      console.error(err)
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return undefined
    sincronizarPushSubscription().catch((err) => console.error(err))
    return undefined
  }, [user?.id, sincronizarPushSubscription])

  useEffect(() => {
    if (user?.id) return undefined
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return undefined
    navigator.serviceWorker.getRegistration().then(async (registration) => {
      if (!registration || !registration.pushManager) return
      try {
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          await subscription.unsubscribe()
        }
      } catch (err) {
        console.error(err)
      }
    }).catch((err) => console.error(err))
    return undefined
  }, [user?.id])

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return undefined
    const onServiceWorkerMessage = (event) => {
      const data = event?.data || {}
      if (data?.type === 'push_notification_click' && data?.url) {
        navigate(String(data.url))
      }
    }
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage)
    return () => {
      navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage)
    }
  }, [navigate])

  const carregarNotificacoes = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) return
    if (!notificacoesDisponiveis) return
    if (!silent) setNotifLoading(true)
    try {
      const [listaRes, resumoRes] = await Promise.all([
        notificacoesAPI.listar({ limite: 30 }),
        notificacoesAPI.resumo(),
      ])
      const lista = Array.isArray(listaRes.data) ? listaRes.data : []
      if (!notificacoesInicializadasRef.current) {
        notificacoesInicializadasRef.current = true
        idsNotificacoesVistosRef.current = new Set(lista.map((n) => n.id).filter(Boolean))
      } else {
        const novas = lista
          .filter((n) => n?.id && Number(n?.lida || 0) === 0 && !idsNotificacoesVistosRef.current.has(n.id))
          .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
        if (novas.length > 0) {
          novas.forEach((notificacaoNova) => abrirPopupTempoReal(notificacaoNova))
        }
        lista.forEach((n) => {
          if (n?.id) idsNotificacoesVistosRef.current.add(n.id)
        })
        if (idsNotificacoesVistosRef.current.size > 1000) {
          idsNotificacoesVistosRef.current = new Set(
            lista.slice(0, 200).map((n) => n.id).filter(Boolean)
          )
        }
      }
      setNotificacoes(lista)
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
  }, [user?.id, notificacoesDisponiveis, abrirPopupTempoReal])

  useEffect(() => {
    if (!user?.id) return undefined
    setNotificacoesDisponiveis(true)
    carregarNotificacoes({ silent: false }).catch((err) => console.error(err))
    return undefined
  }, [user?.id, carregarNotificacoes])

  useRealtimeRefresh(
    () => carregarNotificacoes({ silent: true }),
    { enabled: Boolean(user?.id) && notificacoesDisponiveis, intervalMs: 2000, runWhenHidden: true }
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

  const handleAbrirPopupTempoReal = async (popup) => {
    if (!popup?.notificacao) return
    await handleAbrirCasoNotificacao(popup.notificacao)
    limparPopup(popup.id)
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
      {popupsTempoReal.length > 0 && (
        <div className="dp-realtime-popups" aria-live="polite" aria-label="Notificações em tempo real">
          {popupsTempoReal.map((popup) => {
            const meta = getNotificacaoMeta(popup?.notificacao?.tipo)
            const notif = popup?.notificacao || {}
            return (
              <article key={popup.id} className={`dp-realtime-popup tone-${meta.tone}`}>
                <div className="dp-realtime-popup-head">
                  <span className={`dp-notif-type type-${meta.tone}`}>
                    <span>{meta.icon}</span> {meta.label}
                  </span>
                  <button
                    type="button"
                    className="dp-realtime-popup-close"
                    onClick={() => limparPopup(popup.id)}
                    aria-label="Fechar notificação"
                  >
                    ×
                  </button>
                </div>
                <strong className="dp-realtime-popup-title">{notif.titulo || 'Nova notificação'}</strong>
                <p className="dp-realtime-popup-msg">{notif.mensagem || 'Atualização recebida.'}</p>
                <div className="dp-realtime-popup-actions">
                  {notif.case_id && (
                    <button
                      type="button"
                      className="dp-realtime-popup-open"
                      onClick={() => handleAbrirPopupTempoReal(popup)}
                    >
                      Abrir caso
                    </button>
                  )}
                  <button
                    type="button"
                    className="dp-realtime-popup-dismiss"
                    onClick={() => limparPopup(popup.id)}
                  >
                    Dispensar
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

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
