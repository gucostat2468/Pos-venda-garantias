export function extractFilenameFromHeaders(headers, fallback) {
  const contentDisposition = headers?.['content-disposition'] || ''
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }
  const simpleMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i)
  if (simpleMatch?.[1]) return simpleMatch[1]
  return fallback
}

function revokeObjectUrlSafely(url, delayMs = 60000) {
  if (!url) return
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url)
  }, delayMs)
}

export function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  revokeObjectUrlSafely(url)
}

export function openBlobInTab(blob, tabRef) {
  const url = window.URL.createObjectURL(blob)
  let opened = true
  if (tabRef && !tabRef.closed) {
    tabRef.location.href = url
  } else {
    opened = Boolean(window.open(url, '_blank'))
  }
  revokeObjectUrlSafely(url, 120000)
  return opened
}
