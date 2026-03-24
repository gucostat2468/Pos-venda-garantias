export function abrirImpressaoPdf(blob) {
  const objectUrl = window.URL.createObjectURL(blob)
  const printWindow = window.open(objectUrl, '_blank')

  if (!printWindow) {
    window.URL.revokeObjectURL(objectUrl)
    throw new Error('Nao foi possivel abrir a janela de impressao. Verifique bloqueador de pop-up.')
  }

  const tryPrint = () => {
    try {
      printWindow.focus()
      printWindow.print()
    } catch {
      // Alguns navegadores bloqueiam print programatico; nesse caso o usuario imprime manualmente na aba aberta.
    }
  }

  const timerId = window.setTimeout(tryPrint, 900)

  // Limpeza de URL temporaria para evitar vazamento de memoria
  window.setTimeout(() => {
    window.clearTimeout(timerId)
    window.URL.revokeObjectURL(objectUrl)
  }, 60000)

  return printWindow
}

