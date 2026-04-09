import React from 'react'

const STATUS_CONFIG = {
  'Aguardando Documentos':         { color: '#92400e', bg: '#fef3c7', icon: '📄' },
  'Aguardando Aprovação Pós-Venda':{ color: '#1e40af', bg: '#dbeafe', icon: '✍️' },
  'Aguardando Aprovação Diretoria':{ color: '#5b21b6', bg: '#ede9fe', icon: '✍️' },
  'Aguardando Conferência Estoque':{ color: '#92400e', bg: '#ffedd5', icon: '📦' },
  'Aguardando Impressão Oficina':  { color: '#065f46', bg: '#d1fae5', icon: '🖨️' },
  'Finalizado':                    { color: '#065f46', bg: '#d1fae5', icon: '✅' },
  'Reprovado':                     { color: '#991b1b', bg: '#fee2e2', icon: '❌' },
}

const REBATE_CONFIG = {
  'Não Aplicável':     { color: '#374151', bg: '#f3f4f6', icon: '—' },
  'Aguardando Apuração':{ color: '#92400e', bg: '#fef3c7', icon: '⏳' },
  'Finalizado':        { color: '#065f46', bg: '#d1fae5', icon: '✅' },
  'Apurado':           { color: '#065f46', bg: '#d1fae5', icon: '✅' },
}

export function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { color: '#374151', bg: '#f3f4f6', icon: '?' }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      <span>{cfg.icon}</span>
      {status}
    </span>
  )
}

export function RebateBadge({ status }) {
  const cfg = REBATE_CONFIG[status] || { color: '#374151', bg: '#f3f4f6', icon: '?' }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      <span>{cfg.icon}</span>
      {status}
    </span>
  )
}

export function TipoBadge({ tipo }) {
  const config = tipo === 'Peca'
    ? { color: '#1e40af', bg: '#dbeafe', label: '🔧 Peça' }
    : { color: '#065f46', bg: '#d1fae5', label: '🔋 Bateria' }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: config.bg,
      color: config.color,
      whiteSpace: 'nowrap',
    }}>
      {config.label}
    </span>
  )
}
