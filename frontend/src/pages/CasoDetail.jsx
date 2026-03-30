import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { casosAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { StatusBadge, RebateBadge, TipoBadge } from '../components/StatusBadge'
import useMediaQuery from '../hooks/useMediaQuery'
import useRealtimeRefresh from '../hooks/useRealtimeRefresh'
import { abrirImpressaoPdf } from '../utils/print'
import { formatApiDateTimeBR } from '../utils/datetime'
import { downloadBlob, extractFilenameFromHeaders } from '../utils/file'

const DOCS_FLUXO_OFICINA = [
  {
    label: 'Remessa (Documento de separação dos itens no estoque)',
    obrigatorio: true,
    aliases: [
      'Remessa (Documento de separação dos itens no estoque)',
      'Remessa (Pedido)',
      'Remessa',
    ],
  },
  {
    label: 'Caso de aprovação DJI',
    obrigatorio: false,
    aliases: [
      'Caso de aprovação DJI',
      'Caso de aprovacao DJI',
    ],
  },
  {
    label: 'Nota Fiscal de Remessa para Garantia',
    obrigatorio: false,
    aliases: [
      'Nota Fiscal de Remessa para Garantia',
      'NF Remessa',
    ],
  },
  {
    label: 'Relatório Técnico',
    obrigatorio: false,
    aliases: [
      'Relatório Técnico',
      'Relatorio Tecnico (OS)',
    ],
  },
]

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()

const categorizarTipoDocumento = (tipoDocumento) => {
  const tipo = normalizeText(tipoDocumento)
  if (!tipo) return 'categoria_outros'
  if ((tipo.includes('nota fiscal') && tipo.includes('remessa')) || tipo.includes('nf remessa')) {
    return 'categoria_nf_remessa'
  }
  if (tipo.includes('relatorio tecnico')) return 'categoria_relatorio_tecnico'
  if (tipo.includes('remessa')) return 'categoria_remessa'
  return 'categoria_outros'
}

const isDocumentoAssinavel = (doc) => categorizarTipoDocumento(doc?.tipo_documento) === 'categoria_remessa'

export default function CasoDetail() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { user, podeAssinar, isAdmin, isOperador } = useAuth()
  const [caso, setCaso] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState({})
  const [assinaModal, setAssinaModal] = useState(false)
  const [assinaturaDocStep, setAssinaturaDocStep] = useState(0)
  const [assinaDecisao, setAssinaDecisao] = useState('Aprovado')
  const [assinaObs, setAssinaObs] = useState('')
  const [assinando, setAssinando] = useState(false)
  const [assinandoDocumento, setAssinandoDocumento] = useState(false)
  const [compilando, setCompilando] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [creditoVinculos, setCreditoVinculos] = useState([])
  const [creditoResumo, setCreditoResumo] = useState(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [downloadingDocs, setDownloadingDocs] = useState({})
  const [confirmandoImpressao, setConfirmandoImpressao] = useState(false)
  const [previewDocUrl, setPreviewDocUrl] = useState('')
  const [previewDocLoading, setPreviewDocLoading] = useState(false)
  const [previewDocErro, setPreviewDocErro] = useState(false)
  const fileRefs = useRef({})
  const canvasRef = useRef(null)
  const isDrawingRef = useRef(false)
  const autoSignHandledRef = useRef(false)

  const fetchCaso = useCallback(async () => {
    try {
      const res = await casosAPI.obter(id)
      setCaso(res.data)
      setEditForm({
        dji_case_id: res.data.dji_case_id || '',
        produto_nome: res.data.produto_nome || '',
        produto_modelo: res.data.produto_modelo || '',
        produto_sn: res.data.produto_sn || '',
        data_entrada: res.data.data_entrada,
        observacoes: res.data.observacoes || '',
      })
    } catch (e) {
      console.error(e)
    }
  }, [id])

  const fetchCreditoCaso = useCallback(async () => {
    try {
      const [vincRes, resumoRes] = await Promise.all([
        casosAPI.listarCreditoVinculos(id),
        casosAPI.obterCreditoResumo(id),
      ])
      setCreditoVinculos(Array.isArray(vincRes.data) ? vincRes.data : [])
      setCreditoResumo(resumoRes.data || null)
    } catch (e) {
      console.error(e)
      setCreditoVinculos([])
      setCreditoResumo(null)
    }
  }, [id])

  const refreshCaso = useCallback(async ({ silent = true } = {}) => {
    if (!silent) setLoading(true)
    try {
      await Promise.all([fetchCaso(), fetchCreditoCaso()])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [fetchCaso, fetchCreditoCaso])

  useEffect(() => {
    refreshCaso({ silent: false }).catch((err) => console.error(err))
  }, [refreshCaso])

  useRealtimeRefresh(
    () => refreshCaso({ silent: true }),
    {
      enabled: Boolean(id) && !editMode && !assinaModal,
      intervalMs: 2000,
    }
  )

  const handleUpload = async (tipoDocumento, file) => {
    if (!file) return
    setUploading(prev => ({ ...prev, [tipoDocumento]: true }))
    try {
      const formData = new FormData()
      formData.append('tipo_documento', tipoDocumento)
      formData.append('arquivo', file)
      await casosAPI.uploadDocumento(id, formData)
      await Promise.all([fetchCaso(), fetchCreditoCaso()])
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao fazer upload')
    } finally {
      setUploading(prev => ({ ...prev, [tipoDocumento]: false }))
      if (fileRefs.current[tipoDocumento]) fileRefs.current[tipoDocumento].value = ''
    }
  }

  const handleDeleteDoc = async (docId, docNome) => {
    if (!window.confirm(`Remover "${docNome}"?`)) return
    try {
      await casosAPI.deletarDocumento(id, docId)
      await Promise.all([fetchCaso(), fetchCreditoCaso()])
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao remover documento')
    }
  }

  const handleAssinar = async () => {
    if (!todosDocumentosAssinadosEtapa) {
      alert('Assine todos os documentos da etapa antes de confirmar a aprovação final.')
      return
    }
    setAssinando(true)
    try {
      await casosAPI.assinar(id, { status_decisao: assinaDecisao, observacao: assinaObs })
      setAssinaModal(false)
      setAssinaObs('')
      await Promise.all([fetchCaso(), fetchCreditoCaso()])
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao assinar')
    } finally {
      setAssinando(false)
    }
  }

  const limparCanvasAssinatura = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.lineWidth = 2.8
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }

  const canvasTemAssinatura = () => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const ctx = canvas.getContext('2d')
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) {
        return true
      }
    }
    return false
  }

  const getCanvasPoint = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const handlePointerDown = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    const ctx = canvas.getContext('2d')
    const point = getCanvasPoint(e)
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    isDrawingRef.current = true
  }

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    const ctx = canvas.getContext('2d')
    const point = getCanvasPoint(e)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }

  const handlePointerEnd = () => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
  }

  const handleAssinarDocumentoAtual = async () => {
    if (!documentoAtualAssinatura) return
    if (!canvasTemAssinatura()) {
      alert('Desenhe a assinatura no bloco antes de confirmar este documento.')
      return
    }
    setAssinandoDocumento(true)
    try {
      const assinaturaDataUrl = canvasRef.current.toDataURL('image/png')
      await casosAPI.assinarDocumento(id, documentoAtualAssinatura.id, assinaturaDataUrl)
      await Promise.all([fetchCaso(), fetchCreditoCaso()])
      setAssinaturaDocStep(0)
      limparCanvasAssinatura()
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao assinar documento')
    } finally {
      setAssinandoDocumento(false)
    }
  }

  useEffect(() => {
    if (!assinaModal) return
    const timer = setTimeout(() => limparCanvasAssinatura(), 0)
    return () => clearTimeout(timer)
  }, [assinaModal, assinaturaDocStep, caso?.id])

  const handleCompilarPdf = async () => {
    setCompilando(true)
    try {
      await casosAPI.compilarPdf(id)
      await Promise.all([fetchCaso(), fetchCreditoCaso()])
      alert('PDF compilado com sucesso!')
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao compilar PDF')
    } finally {
      setCompilando(false)
    }
  }

  const handleConfirmarImpressao = async () => {
    const iniciar = window.confirm(
      'Abrir impressão em 3 vias deste caso?\n\n' +
      '1ª via: Financeiro\n2ª via: Estoque\n3ª via: Controle da Oficina'
    )
    if (!iniciar) return

    setConfirmandoImpressao(true)
    try {
      // Sempre recompila antes de imprimir para garantir assinaturas mais recentes no dossiê.
      await casosAPI.compilarPdf(id)
      const pdfRes = await casosAPI.downloadPdfFile(id)

      abrirImpressaoPdf(pdfRes.data)

      const confirmarFinalizacao = window.confirm(
        'A tela de impressão foi aberta.\n' +
        'No diálogo de impressão, selecione 3 cópias.\n\n' +
        'Clique em OK somente após imprimir para finalizar o caso.'
      )
      if (!confirmarFinalizacao) return

      await casosAPI.confirmarImpressao(id)
      await Promise.all([fetchCaso(), fetchCreditoCaso()])
      alert('Impressão em 3 vias confirmada e caso finalizado!')
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Erro ao confirmar impressão')
    } finally {
      setConfirmandoImpressao(false)
    }
  }

  const handleSalvarEdicao = async (e) => {
    e.preventDefault()
    try {
      await casosAPI.atualizar(id, editForm)
      setEditMode(false)
      await Promise.all([fetchCaso(), fetchCreditoCaso()])
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao atualizar')
    }
  }

  const scheduleRevokeObjectUrl = (url, delayMs = 120000) => {
    if (!url) return
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url)
    }, delayMs)
  }

  const isPdfFilename = (filename) => String(filename || '').toLowerCase().endsWith('.pdf')

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      const res = await casosAPI.downloadPdfFile(id)
      const filename = extractFilenameFromHeaders(res.headers, `dossie_garantia_${id}.pdf`)
      downloadBlob(res.data, filename)
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao baixar PDF')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handleDownloadDocumento = async (doc) => {
    setDownloadingDocs(prev => ({ ...prev, [doc.id]: true }))
    try {
      const res = await casosAPI.downloadDocumentoFile(id, doc.id, { disposition: 'attachment' })
      const fallback = doc?.nome_arquivo || `documento_${doc.id}`
      const filename = extractFilenameFromHeaders(res.headers, fallback)
      downloadBlob(res.data, filename)
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao baixar documento')
    } finally {
      setDownloadingDocs(prev => ({ ...prev, [doc.id]: false }))
    }
  }

  const handleAbrirDocumento = async (doc) => {
    if (!doc) return
    setDownloadingDocs(prev => ({ ...prev, [doc.id]: true }))
    try {
      const viewerUrl = `/documento-viewer?caseId=${encodeURIComponent(id)}&docId=${encodeURIComponent(doc.id)}`
      const opened = window.open(viewerUrl, '_blank')
      if (!opened) {
        await handleDownloadDocumento(doc)
      }
    } catch (err) {
      alert(err.response?.data?.detail || 'Erro ao abrir documento')
    } finally {
      setDownloadingDocs(prev => ({ ...prev, [doc.id]: false }))
    }
  }

  const abrirModalAssinatura = () => {
    setAssinaDecisao('Aprovado')
    setAssinaObs('')
    setAssinaturaDocStep(0)
    setAssinaModal(true)
  }

  const abrirDocumentoPendenteEmTelaCheia = () => {
    if (documentoAtualAssinatura) {
      handleAbrirDocumento(documentoAtualAssinatura)
    }
  }

  const autoSignRequested = searchParams.get('assinar') === '1'
  const canSign = caso ? podeAssinar(caso) : false
  const etapaAssinaturaAtual = caso?.status === 'Aguardando Aprovação Pós-Venda'
    ? 'Pos-venda'
    : caso?.status === 'Aguardando Aprovação Diretoria'
      ? 'Diretoria'
      : null
  const documentosAssinaveis = (caso?.documentos || [])
    .filter((doc) => isDocumentoAssinavel(doc))
  const documentosAssinadosEtapa = (caso?.documento_assinaturas || []).filter(
    (sig) => sig.etapa_fluxo === etapaAssinaturaAtual && sig.usuario_id === user?.id
  )
  const documentosAssinadosIds = new Set(documentosAssinadosEtapa.map((sig) => sig.documento_id))
  const documentosPendentesAssinatura = documentosAssinaveis.filter((doc) => !documentosAssinadosIds.has(doc.id))
  const todosDocumentosAssinadosEtapa =
    documentosAssinaveis.length > 0 && documentosPendentesAssinatura.length === 0
  const documentoAtualAssinatura = documentosPendentesAssinatura[
    Math.min(assinaturaDocStep, Math.max(documentosPendentesAssinatura.length - 1, 0))
  ] || null
  const documentoAtualEhPdf = isPdfFilename(documentoAtualAssinatura?.nome_arquivo)
  const papelAssinaturaLabel = etapaAssinaturaAtual === 'Pos-venda' ? 'Gerente Pós-venda' : 'Diretor Comercial'

  useEffect(() => {
    if (!autoSignRequested || autoSignHandledRef.current) return
    if (loading || !caso) return
    autoSignHandledRef.current = true
    if (canSign) abrirModalAssinatura()
  }, [autoSignRequested, loading, caso, canSign])

  useEffect(() => {
    if (!assinaModal || !documentoAtualAssinatura) {
      setPreviewDocUrl('')
      setPreviewDocLoading(false)
      setPreviewDocErro(false)
      return undefined
    }
    if (isMobile && documentoAtualEhPdf) {
      setPreviewDocUrl('')
      setPreviewDocLoading(false)
      setPreviewDocErro(false)
      return undefined
    }

    let isActive = true
    let objectUrl = ''

    const carregarPreview = async () => {
      setPreviewDocLoading(true)
      setPreviewDocErro(false)
      try {
        const res = await casosAPI.downloadDocumentoFile(
          id,
          documentoAtualAssinatura.id,
          { disposition: 'inline' }
        )
        objectUrl = window.URL.createObjectURL(res.data)
        if (isActive) {
          setPreviewDocUrl(objectUrl)
        } else {
          scheduleRevokeObjectUrl(objectUrl)
        }
      } catch (err) {
        console.error(err)
        if (isActive) {
          setPreviewDocUrl('')
          setPreviewDocErro(true)
        }
      } finally {
        if (isActive) setPreviewDocLoading(false)
      }
    }

    carregarPreview()

    return () => {
      isActive = false
      if (objectUrl) {
        scheduleRevokeObjectUrl(objectUrl)
      }
    }
  }, [assinaModal, id, documentoAtualAssinatura?.id, isMobile, documentoAtualEhPdf])

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)' }}>Carregando...</div>
  if (!caso) return <div style={{ textAlign: 'center', padding: 80 }}>Caso não encontrado. <Link to="/casos">Voltar</Link></div>

  const docsObrigatorios = DOCS_FLUXO_OFICINA
  const docsObrigatoriosAliasesNorm = docsObrigatorios
    .flatMap((docConfig) => docConfig.aliases)
    .map((alias) => normalizeText(alias))
  const findDocumentoByAliases = (aliases = []) => {
    const aliasesNorm = aliases.map((alias) => normalizeText(alias))
    return (caso.documentos || []).find((doc) => aliasesNorm.includes(normalizeText(doc.tipo_documento)))
  }
  const isFinalOrReprovado = ['Aguardando Impressão Oficina', 'Finalizado', 'Reprovado'].includes(caso.status)
  const isLockedForOfficeEdition = ['Aguardando Aprovação Diretoria', 'Aguardando Impressão Oficina', 'Finalizado', 'Reprovado'].includes(caso.status)
  const canManageOfficeDocs = (isOperador || isAdmin) && !isLockedForOfficeEdition
  const assinaturasPorDocumento = (caso.documento_assinaturas || []).reduce((acc, sig) => {
    if (!acc[sig.documento_id]) acc[sig.documento_id] = []
    acc[sig.documento_id].push(sig)
    return acc
  }, {})
  const resumoAssinaturasDocumento = (doc) => {
    if (!doc) return null
    if (!isDocumentoAssinavel(doc)) {
      return {
        assinadoPos: false,
        assinadoDir: false,
        texto: 'Assinatura não obrigatória para este documento.',
      }
    }
    const docId = doc.id
    const lista = assinaturasPorDocumento[docId] || []
    const assinadoPos = lista.some((sig) => sig.etapa_fluxo === 'Pos-venda')
    const assinadoDir = lista.some((sig) => sig.etapa_fluxo === 'Diretoria')
    return {
      assinadoPos,
      assinadoDir,
      texto: `Assinaturas: Pós-venda ${assinadoPos ? '✓' : 'pendente'} · Diretor ${assinadoDir ? '✓' : 'pendente'}`,
    }
  }

  const totalCreditoAlocado = Number(creditoResumo?.total_alocado || 0)
  const formatMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const acaoAssinaturaLabel = assinaDecisao === 'Aprovado'
    ? (etapaAssinaturaAtual === 'Pos-venda'
      ? 'Assinar e Encaminhar ao Diretor Comercial'
      : 'Assinar e Encaminhar para Impressão')
    : 'Reprovar Caso'
  const pipelineSteps = [
    { label: 'Time Oficina', key: 'docs', done: caso.status !== 'Aguardando Documentos' || isFinalOrReprovado },
    { label: 'Gerente Pós-venda', key: 'pos', done: ['Aguardando Aprovação Diretoria', 'Aguardando Impressão Oficina', 'Finalizado'].includes(caso.status) },
    { label: 'Diretor Comercial', key: 'dir', done: ['Aguardando Impressão Oficina', 'Finalizado'].includes(caso.status) },
    { label: 'Impressão 3 Vias', key: 'print', done: caso.status === 'Finalizado' },
    { label: 'Finalizado', key: 'fin', done: caso.status === 'Finalizado' },
  ]

  return (
    <div style={{ maxWidth: 960 }}>
      {/* Header */}
      <div style={s.pageHeader}>
        <div>
          <Link to="/casos" style={s.back}>← Casos de Garantia</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            <h1 style={s.title}>{caso.dji_case_id || `Caso #${caso.id}`}</h1>
            <TipoBadge tipo={caso.tipo_processo} />
            <StatusBadge status={caso.status} />
          </div>
          <p style={s.sub}>
            {caso.produto_nome || '—'} · {caso.cliente?.razao_social || '—'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {!isLockedForOfficeEdition && !editMode && (isOperador || isAdmin) && (
            <button onClick={() => setEditMode(true)} style={s.outlineBtn}>✏️ Editar</button>
          )}
          {caso.link_pdf_compilado && (
            <button type="button" onClick={handleDownloadPdf} disabled={downloadingPdf} style={s.primaryBtn}>
              {downloadingPdf ? 'Baixando...' : '📄 Baixar Dossiê PDF'}
            </button>
          )}
          {canSign && (
            <button onClick={abrirModalAssinatura} style={s.signBtn}>✍️ Assinar</button>
          )}
          {(isOperador || isAdmin) && caso.status === 'Aguardando Impressão Oficina' && (
            <button onClick={handleConfirmarImpressao} disabled={confirmandoImpressao} style={s.signBtn}>
              {confirmandoImpressao ? 'Processando...' : '🖨️ Imprimir (3 vias) e Finalizar'}
            </button>
          )}
        </div>
      </div>

      {/* Dados do Caso */}
      {editMode ? (
        <form onSubmit={handleSalvarEdicao} style={s.card}>
          <div style={s.cardHeader}>
            <h3 style={s.cardTitle}>Editar Dados do Caso</h3>
          </div>
          <div style={{ ...s.grid2, ...(isMobile ? { gridTemplateColumns: '1fr' } : {}) }}>
            <div>
              <label style={s.label}>ID do Caso DJI</label>
              <input style={s.input} value={editForm.dji_case_id} onChange={e => setEditForm({ ...editForm, dji_case_id: e.target.value })} />
            </div>
            <div>
              <label style={s.label}>Data de Entrada</label>
              <input type="date" style={s.input} value={editForm.data_entrada} onChange={e => setEditForm({ ...editForm, data_entrada: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={s.label}>Nome do Produto</label>
              <input style={s.input} value={editForm.produto_nome} onChange={e => setEditForm({ ...editForm, produto_nome: e.target.value })} />
            </div>
            <div>
              <label style={s.label}>Modelo</label>
              <input style={s.input} value={editForm.produto_modelo} onChange={e => setEditForm({ ...editForm, produto_modelo: e.target.value })} />
            </div>
            <div>
              <label style={s.label}>Número de Série</label>
              <input style={{ ...s.input, fontFamily: 'monospace' }} value={editForm.produto_sn} onChange={e => setEditForm({ ...editForm, produto_sn: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={s.label}>Observações</label>
              <textarea style={{ ...s.input, resize: 'vertical' }} rows={3} value={editForm.observacoes} onChange={e => setEditForm({ ...editForm, observacoes: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setEditMode(false)} style={s.cancelBtn}>Cancelar</button>
            <button type="submit" style={s.primaryBtn}>Salvar</button>
          </div>
        </form>
      ) : (
        <div style={s.card}>
          <div style={s.cardHeader}>
            <h3 style={s.cardTitle}>Dados do Caso</h3>
            <RebateBadge status={caso.status_rebate} />
          </div>
          <div style={s.infoGrid}>
            <InfoItem label="ID Sistema" value={`#${caso.id}`} />
            <InfoItem label="ID DJI" value={caso.dji_case_id || '—'} mono />
            <InfoItem label="Produto" value={caso.produto_nome || '—'} span />
            <InfoItem label="Modelo" value={caso.produto_modelo || '—'} />
            <InfoItem label="Nº de Série" value={caso.produto_sn || '—'} mono />
            <InfoItem label="Data de Entrada" value={new Date(caso.data_entrada + 'T00:00:00').toLocaleDateString('pt-BR')} />
            <InfoItem label="Cliente" value={caso.cliente?.razao_social || '—'} />
            <InfoItem label="CNPJ" value={caso.cliente?.cnpj || '—'} mono />
            <InfoItem label="E-mail" value={caso.cliente?.email || '—'} />
            <InfoItem label="Telefone" value={caso.cliente?.telefone || '—'} />
            {caso.observacoes && <InfoItem label="Observações" value={caso.observacoes} span />}
          </div>
        </div>
      )}

      {/* Documentos */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h3 style={s.cardTitle}>Conciliação de Créditos</h3>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>
            Total Alocado: {formatMoney(totalCreditoAlocado)}
          </div>
        </div>
        {creditoVinculos.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Nenhum vínculo de crédito encontrado para este caso.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={s.thead}>
                  <th style={s.th}>Competência</th>
                  <th style={s.th}>Lançamento</th>
                  <th style={s.th}>Valor Lançamento</th>
                  <th style={s.th}>Valor Alocado</th>
                  <th style={s.th}>Score</th>
                  <th style={s.th}>Método</th>
                </tr>
              </thead>
              <tbody>
                {creditoVinculos.map((v) => (
                  <tr key={v.id} style={s.tr}>
                    <td style={s.td}>{v.extrato?.competencia_nome || '—'}</td>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600 }}>{v.lancamento?.descricao || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{v.lancamento?.secao || ''}</div>
                    </td>
                    <td style={s.td}>{formatMoney(v.valor_lancamento)}</td>
                    <td style={s.td}>{formatMoney(v.valor_alocado)}</td>
                    <td style={s.td}>{v.score != null ? Number(v.score).toFixed(2) : '—'}</td>
                    <td style={s.td}>{v.metodo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Documentos */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h3 style={s.cardTitle}>Documentos</h3>
          {isAdmin && !isFinalOrReprovado && (
            <button onClick={handleCompilarPdf} disabled={compilando} style={s.outlineBtn}>
              {compilando ? 'Compilando...' : '🗂️ Compilar PDF'}
            </button>
          )}
        </div>

        {!isOperador && !isAdmin && (
          <div style={{ marginBottom: 12, fontSize: 12, color: '#92400e', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 12px' }}>
            Somente Time Oficina pode anexar, substituir ou remover documentos nesta etapa.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {docsObrigatorios.map((docConfig) => {
            const tipo = docConfig.label
            const doc = findDocumentoByAliases(docConfig.aliases)
            const isUploading = uploading[tipo]
            const assinaturaResumo = doc ? resumoAssinaturasDocumento(doc) : null
            return (
              <div key={tipo} style={{ ...s.docRow, ...(doc ? s.docRowDone : {}) }}>
                <div style={s.docIcon}>{doc ? '✅' : '📄'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {tipo} {docConfig.obrigatorio ? '(Obrigatório)' : '(Opcional)'}
                  </div>
                  {doc && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {doc.nome_arquivo} · {doc.tamanho_bytes ? `${(doc.tamanho_bytes / 1024).toFixed(0)} KB` : ''} ·{' '}
                      {new Date(doc.data_upload).toLocaleDateString('pt-BR')}
                    </div>
                  )}
                  {doc && assinaturaResumo && (
                    <div style={{ fontSize: 11, color: '#334155', marginTop: 3 }}>
                      {assinaturaResumo.texto}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {doc && (
                    <button
                      type="button"
                      onClick={() => handleAbrirDocumento(doc)}
                      disabled={!!downloadingDocs[doc.id]}
                      style={s.docDownBtn}
                    >
                      {downloadingDocs[doc.id] ? 'Abrindo...' : 'Abrir'}
                    </button>
                  )}
                  {canManageOfficeDocs && (
                    <>
                      <label style={s.docUpBtn}>
                        {isUploading ? '...' : doc ? '🔄 Substituir' : '⬆ Enviar'}
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.gif"
                          style={{ display: 'none' }}
                          ref={el => fileRefs.current[tipo] = el}
                          onChange={e => handleUpload(tipo, e.target.files[0])}
                          disabled={isUploading}
                        />
                      </label>
                      {doc && (
                        <button onClick={() => handleDeleteDoc(doc.id, doc.nome_arquivo)} style={s.docDelBtn}>🗑</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* Outros documentos (não obrigatórios) */}
          {(caso.documentos || [])
            .filter(d => !docsObrigatoriosAliasesNorm.includes(normalizeText(d.tipo_documento)))
            .map((doc) => {
              const assinaturaResumo = resumoAssinaturasDocumento(doc)
              return (
                <div key={doc.id} style={{ ...s.docRow, background: '#f8fafc' }}>
                <div style={s.docIcon}>
                  {doc.tipo_documento === 'Vídeo de Descarte' ? '🎥' : '📎'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{doc.tipo_documento}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {doc.nome_arquivo} · {doc.tamanho_bytes ? `${(doc.tamanho_bytes / 1024 / 1024).toFixed(1)} MB` : ''}
                  </div>
                  {doc.tipo_documento !== 'Vídeo de Descarte' && (
                    <div style={{ fontSize: 11, color: '#334155', marginTop: 3 }}>
                      {assinaturaResumo.texto}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => handleAbrirDocumento(doc)}
                    disabled={!!downloadingDocs[doc.id]}
                    style={s.docDownBtn}
                  >
                    {downloadingDocs[doc.id] ? 'Abrindo...' : 'Abrir'}
                  </button>
                </div>
                </div>
              )
            })}

        </div>
      </div>

      {/* Fluxo de Aprovações */}
      <div style={s.card}>
        <h3 style={{ ...s.cardTitle, marginBottom: 16 }}>Pipeline de Aprovação</h3>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 0, position: 'relative' }}>
          {pipelineSteps.map((step, i, arr) => (
            <React.Fragment key={step.key}>
              <div style={{
                textAlign: isMobile ? 'left' : 'center',
                flex: isMobile ? 'unset' : 1,
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? 10 : 0,
                ...(isMobile ? { border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', padding: '8px 10px' } : {}),
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', margin: isMobile ? '0' : '0 auto 8px',
                  background: caso.status === 'Reprovado' && step.key === 'fin' ? '#ef4444'
                    : step.done ? 'var(--success)' : '#e2e8f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, color: step.done ? '#fff' : 'var(--text-muted)',
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {step.done ? '✓' : i + 1}
                </div>
                <div style={{ fontSize: isMobile ? 12 : 11, fontWeight: 600, color: step.done ? 'var(--success)' : 'var(--text-muted)' }}>
                  {step.label}
                </div>
              </div>
              {i < arr.length - 1
                ? (
                  isMobile
                    ? <div style={{ width: 2, height: 10, background: step.done ? 'var(--success)' : '#e2e8f0', marginLeft: 15 }} />
                    : <div style={{ flex: 1, height: 2, background: step.done ? 'var(--success)' : '#e2e8f0', margin: '15px 0 auto', maxWidth: 60 }} />
                )
                : null}
            </React.Fragment>
          ))}
        </div>

        {/* Assinaturas */}
        {(caso.assinaturas || []).length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>HISTÓRICO DE ASSINATURAS</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {caso.assinaturas.map((sig) => (
                <div key={sig.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: sig.status_decisao === 'Aprovado' ? '#f0fdf4' : '#fff1f2',
                  borderRadius: 8, padding: '10px 14px',
                  border: `1px solid ${sig.status_decisao === 'Aprovado' ? '#bbf7d0' : '#fecaca'}`,
                }}>
                  <div style={{ fontSize: 20 }}>{sig.status_decisao === 'Aprovado' ? '✅' : '❌'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {sig.etapa_fluxo === 'Pos-venda'
                        ? 'Vanier Afonso (Gerente de Pós-venda)'
                        : 'Marcus Lawder (Diretor Comercial)'}
                      {' — '}
                      <span style={{ color: sig.status_decisao === 'Aprovado' ? 'var(--success)' : 'var(--danger)' }}>
                        {sig.status_decisao}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {sig.usuario?.nome} · {formatApiDateTimeBR(sig.data_assinatura)}
                    </div>
                    {sig.observacao && <div style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>"{sig.observacao}"</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Botão de assinatura inline */}
        {canSign && (
          <div style={{ marginTop: 16, padding: 16, background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
            <p style={{ fontSize: 13, color: '#1e40af', marginBottom: 12, fontWeight: 600 }}>
              ✍️ Este caso aguarda sua assinatura ({caso.status})
            </p>
            <button onClick={abrirModalAssinatura} style={s.signBtn}>Assinar Agora</button>
          </div>
        )}

        {(isOperador || isAdmin) && caso.status === 'Aguardando Impressão Oficina' && (
          <div style={{ marginTop: 16, padding: 16, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
            <p style={{ fontSize: 13, color: '#166534', marginBottom: 10, fontWeight: 700 }}>
              🖨️ Pronto para impressão em 3 vias:
            </p>
            <p style={{ fontSize: 12, color: '#166534', marginBottom: 4 }}>1ª via: Financeiro</p>
            <p style={{ fontSize: 12, color: '#166534', marginBottom: 4 }}>2ª via: Estoque</p>
            <p style={{ fontSize: 12, color: '#166534', marginBottom: 12 }}>3ª via: Controle da oficina</p>
            <button onClick={handleConfirmarImpressao} disabled={confirmandoImpressao} style={s.signBtn}>
              {confirmandoImpressao ? 'Processando...' : 'Imprimir (3 vias) e Finalizar'}
            </button>
          </div>
        )}
      </div>

      {/* Modal Assinatura */}
      {assinaModal && (
        <div style={{ ...s.modalOverlay, ...(isMobile ? s.modalOverlayMobile : {}) }}>
          <div style={{ ...s.modal, ...(isMobile ? s.modalMobile : {}), maxWidth: isMobile ? '100%' : 980, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Assinatura por Documento (Etapa Sequencial)</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
              {caso.dji_case_id || `Caso #${caso.id}`} — {caso.produto_modelo || caso.produto_nome}
            </p>

            <div style={s.signFlowHead}>
              <strong>Etapa atual: {papelAssinaturaLabel}</strong>
              <span>{documentosAssinadosEtapa.length}/{documentosAssinaveis.length} documentos assinados</span>
            </div>

            {documentosAssinaveis.length === 0 ? (
              <div style={s.signWarnBox}>
                Nenhum documento disponível para assinatura nesta etapa. Anexe os documentos necessários para continuar.
              </div>
            ) : (
              <>
                {documentoAtualAssinatura ? (
                  <>
                    <div style={s.signDocTitle}>
                      Documento pendente: <strong>{documentoAtualAssinatura.nome_arquivo}</strong>
                    </div>
                    <div style={s.signDocViewer}>
                      <div style={s.previewActions}>
                        <button type="button" onClick={abrirDocumentoPendenteEmTelaCheia} style={s.previewOpenBtn}>
                          Abrir em tela cheia
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadDocumento(documentoAtualAssinatura)}
                          style={s.docDownBtn}
                        >
                          ⬇ Baixar
                        </button>
                      </div>
                      {previewDocLoading ? (
                        <div style={s.previewLoading}>Carregando preview do documento...</div>
                      ) : previewDocUrl && !(isMobile && documentoAtualEhPdf) ? (
                        <iframe
                          title={`Documento ${documentoAtualAssinatura.nome_arquivo}`}
                          src={previewDocUrl}
                          style={{ ...s.signIframe, ...(isMobile ? s.signIframeMobile : {}) }}
                        />
                      ) : isMobile && documentoAtualEhPdf ? (
                        <div style={s.previewMobileHint}>
                          No celular, use "Abrir em tela cheia" para visualizar o PDF sem interrupções.
                        </div>
                      ) : (
                        <div style={s.previewError}>
                          {previewDocErro
                            ? 'Pré-visualização indisponível neste dispositivo. Use "Abrir em tela cheia".'
                            : 'Use "Abrir em tela cheia" para validar este documento.'}
                        </div>
                      )}
                    </div>

                    <div style={s.signCanvasCard}>
                      <label style={s.label}>Desenhe sua assinatura no bloco abaixo</label>
                      <canvas
                        ref={canvasRef}
                        width={860}
                        height={isMobile ? 160 : 190}
                        style={{ ...s.signCanvas, ...(isMobile ? s.signCanvasMobile : {}) }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onPointerLeave={handlePointerEnd}
                      />
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={limparCanvasAssinatura} style={s.outlineBtn}>Limpar Assinatura</button>
                        <button
                          type="button"
                          onClick={handleAssinarDocumentoAtual}
                          disabled={assinandoDocumento}
                          style={s.signBtn}
                        >
                          {assinandoDocumento ? 'Confirmando...' : 'Confirmar Este Documento e Avançar'}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={s.signDoneBox}>
                    Todos os documentos desta etapa foram assinados. Agora confirme a decisão final.
                  </div>
                )}

                <div style={s.signChecklist}>
                  {documentosAssinaveis.map((doc, idx) => {
                    const done = documentosAssinadosIds.has(doc.id)
                    return (
                      <div
                        key={doc.id}
                        style={{
                          ...s.signChecklistItem,
                          ...(done ? s.signChecklistItemDone : {}),
                          ...(isMobile ? s.signChecklistItemMobile : {}),
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{idx + 1}. {doc.nome_arquivo}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => handleAbrirDocumento(doc)}
                            disabled={!!downloadingDocs[doc.id]}
                            style={s.docDownBtn}
                          >
                            {downloadingDocs[doc.id] ? 'Abrindo...' : 'Abrir'}
                          </button>
                          <strong>{done ? 'Assinado' : 'Pendente'}</strong>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <div style={{
              marginTop: 16,
              opacity: todosDocumentosAssinadosEtapa ? 1 : 0.55,
              pointerEvents: todosDocumentosAssinadosEtapa ? 'auto' : 'none',
            }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Confirmação Final da Etapa</h4>
              <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, marginBottom: 16 }}>
                {['Aprovado', 'Reprovado'].map(op => (
                  <label key={op} style={{
                    flex: 1, padding: 14, borderRadius: 8, border: '2px solid',
                    borderColor: assinaDecisao === op ? (op === 'Aprovado' ? 'var(--success)' : 'var(--danger)') : 'var(--border)',
                    background: assinaDecisao === op ? (op === 'Aprovado' ? '#f0fdf4' : '#fff1f2') : '#fff',
                    textAlign: 'center', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                    color: assinaDecisao === op ? (op === 'Aprovado' ? 'var(--success)' : 'var(--danger)') : 'var(--text-muted)',
                  }}>
                    <input type="radio" name="decisao" value={op} checked={assinaDecisao === op}
                      onChange={() => setAssinaDecisao(op)} style={{ display: 'none' }} />
                    {op === 'Aprovado' ? '✅ Aprovar' : '❌ Reprovar'}
                  </label>
                ))}
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>Observação (opcional)</label>
                <textarea
                  value={assinaObs}
                  onChange={e => setAssinaObs(e.target.value)}
                  rows={3}
                  style={{ ...s.input, resize: 'vertical' }}
                />
              </div>
            </div>

            {!todosDocumentosAssinadosEtapa && documentosAssinaveis.length > 0 && (
              <p style={{ fontSize: 12, color: '#92400e', marginBottom: 10 }}>
                Assine todos os documentos desta etapa para liberar a aprovação final do caso.
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => { setAssinaModal(false); setAssinaObs('') }} style={{ ...s.cancelBtn, ...(isMobile ? s.modalActionBtnMobile : {}) }}>Cancelar</button>
              <button
                onClick={handleAssinar}
                disabled={assinando || assinandoDocumento || !todosDocumentosAssinadosEtapa || documentosAssinaveis.length === 0}
                style={{
                ...s.primaryBtn,
                ...(isMobile ? s.modalActionBtnMobile : {}),
                background: assinaDecisao === 'Aprovado' ? 'var(--success)' : 'var(--danger)',
              }}
              >
                {assinando ? 'Processando...' : acaoAssinaturaLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoItem({ label, value, mono, span }) {
  return (
    <div style={{ minWidth: 0, ...(span ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--text)',
          fontFamily: mono ? 'monospace' : 'inherit',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          lineHeight: 1.35,
        }}
      >
        {value}
      </div>
    </div>
  )
}

const s = {
  pageHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 24, flexWrap: 'wrap', gap: 16,
  },
  back: { color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'block', marginBottom: 6 },
  title: { fontSize: 22, fontWeight: 800, color: 'var(--text)', display: 'inline-block' },
  sub: { color: 'var(--text-muted)', fontSize: 13, marginTop: 4 },
  card: {
    background: '#fff', borderRadius: 10, padding: '20px 24px',
    boxShadow: 'var(--shadow)', border: '1px solid var(--border)', marginBottom: 16,
  },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' },
  cardTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text)' },
  infoGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px 20px',
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  label: { display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 6 },
  input: {
    width: '100%', padding: '9px 12px', borderRadius: 7,
    border: '1.5px solid var(--border)', fontSize: 13, outline: 'none', background: '#fff',
  },
  docRow: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
    borderRadius: 8, border: '1.5px solid var(--border)', background: '#fafafa',
  },
  docRowDone: { borderColor: '#bbf7d0', background: '#f0fdf4' },
  docIcon: { fontSize: 20, flexShrink: 0 },
  docDownBtn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: '#fff', fontSize: 12, color: 'var(--primary)', fontWeight: 600, textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  docUpBtn: {
    padding: '5px 12px', borderRadius: 6, border: '1.5px solid var(--primary)',
    background: '#fff', fontSize: 12, color: 'var(--primary)', fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  docDelBtn: {
    padding: '5px 8px', borderRadius: 6, border: '1px solid #fecaca',
    background: '#fff', fontSize: 12, cursor: 'pointer', color: '#ef4444',
  },
  primaryBtn: {
    padding: '8px 18px', borderRadius: 7, border: 'none',
    background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
  },
  outlineBtn: {
    padding: '8px 14px', borderRadius: 7, border: '1.5px solid var(--border)',
    background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text)',
  },
  signBtn: {
    padding: '8px 18px', borderRadius: 7, border: 'none',
    background: '#10b981', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  cancelBtn: {
    padding: '9px 18px', borderRadius: 7, border: '1.5px solid var(--border)',
    background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  },
  modalOverlayMobile: { padding: 10 },
  modal: {
    background: '#fff', borderRadius: 12, padding: '28px',
    width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  },
  modalMobile: { borderRadius: 10, padding: 14 },
  signFlowHead: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    color: '#1e3a8a',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  signWarnBox: {
    border: '1px solid #fecaca',
    background: '#fff1f2',
    borderRadius: 8,
    padding: '12px 14px',
    color: '#991b1b',
    fontSize: 13,
    marginBottom: 12,
  },
  signDocTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 8,
  },
  signDocViewer: {
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
    background: '#fff',
    marginBottom: 12,
  },
  previewLoading: {
    padding: '18px 14px',
    fontSize: 13,
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  previewActions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    padding: '8px 10px 0',
    flexWrap: 'wrap',
  },
  previewOpenBtn: {
    padding: '5px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: '#fff',
    fontSize: 12,
    color: 'var(--primary)',
    fontWeight: 700,
    cursor: 'pointer',
  },
  previewMobileHint: {
    margin: '10px',
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    borderRadius: 8,
    padding: '12px 10px',
    fontSize: 12,
    color: '#1e3a8a',
    textAlign: 'center',
  },
  previewError: {
    padding: '18px 14px',
    fontSize: 13,
    color: '#991b1b',
    textAlign: 'center',
    background: '#fff1f2',
  },
  signIframe: {
    width: '100%',
    height: 350,
    border: 0,
    background: '#fff',
  },
  signIframeMobile: { height: 250 },
  signCanvasCard: {
    border: '1px solid #dbe7fb',
    borderRadius: 10,
    background: '#f8fbff',
    padding: '12px 12px 10px',
    marginBottom: 12,
  },
  signCanvas: {
    width: '100%',
    height: 190,
    borderRadius: 8,
    border: '1.5px dashed #93c5fd',
    background: '#fff',
    touchAction: 'none',
    marginBottom: 10,
  },
  signCanvasMobile: { height: 160 },
  signDoneBox: {
    border: '1px solid #bbf7d0',
    background: '#f0fdf4',
    color: '#166534',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    marginBottom: 12,
    fontWeight: 600,
  },
  signChecklist: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 8,
  },
  signChecklistItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 12,
    color: '#334155',
    background: '#fff',
  },
  signChecklistItemDone: {
    borderColor: '#bbf7d0',
    background: '#f0fdf4',
    color: '#166534',
  },
  signChecklistItemMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  modalActionBtnMobile: {
    width: '100%',
    justifyContent: 'center',
  },
  thead: { background: '#f8fafc', borderBottom: '1px solid var(--border)' },
  th: {
    padding: '9px 10px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '9px 10px', fontSize: 12, color: 'var(--text)' },
}
