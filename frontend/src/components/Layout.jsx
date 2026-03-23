import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import useMediaQuery from '../hooks/useMediaQuery'

const PAPEL_LABEL = {
  admin: 'Administrador',
  operador: 'Time Oficina',
  gerente_pos_venda: 'Gerente de Pós-venda',
  diretor_comercial: 'Diretor Comercial',
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
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useMediaQuery('(max-width: 980px)')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pageMeta = getPageMeta(location.pathname)
  const statusQuery = new URLSearchParams(location.search).get('status')
  const isQueueStatus =
    statusQuery === 'Aguardando Aprovação Pós-Venda' ||
    statusQuery === 'Aguardando Aprovação Diretoria'
  const isPrintQueuePath = location.pathname === '/impressao-finalizacao'

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false)
    }
  }, [isMobile])

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
      to: `/casos?status=${encodeURIComponent('Aguardando Aprovação Pós-Venda')}`,
      icon: '>',
      label: 'Fila Pós-venda',
      active:
        location.pathname === '/casos' &&
        statusQuery === 'Aguardando Aprovação Pós-Venda',
    },
    {
      to: `/casos?status=${encodeURIComponent('Aguardando Aprovação Diretoria')}`,
      icon: '>',
      label: 'Fila Diretor Comercial',
      active:
        location.pathname === '/casos' &&
        statusQuery === 'Aguardando Aprovação Diretoria',
    },
    {
      to: '/impressao-finalizacao',
      icon: '>',
      label: 'Imprimir e Finalizar',
      active: isPrintQueuePath,
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
            <button className="dp-icon-btn" type="button" aria-label="Notificações">
              !
            </button>
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
