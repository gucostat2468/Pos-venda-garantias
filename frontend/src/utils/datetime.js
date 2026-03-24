export function parseApiDateTime(value) {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null

  // Se a API vier sem timezone (naive), tratamos como UTC.
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
  const normalized = hasTimezone ? raw : `${raw}Z`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatApiDateTimeBR(value) {
  const parsed = parseApiDateTime(value)
  if (!parsed) return '-'
  return parsed.toLocaleString('pt-BR')
}

