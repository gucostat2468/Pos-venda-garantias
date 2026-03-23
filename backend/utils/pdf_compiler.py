"""
Módulo de compilação de PDF:
- Converte imagens e PDFs individuais em um único PDF compilado
- Gera capa com dados do caso
"""
import os
import io
from datetime import datetime
from typing import List
from pathlib import Path

from pypdf import PdfWriter, PdfReader
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT


def image_to_pdf_bytes(image_path: str) -> bytes:
    """Converte uma imagem (JPG, PNG, etc.) para bytes de PDF."""
    img = Image.open(image_path)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    # Calcular tamanho para caber em A4
    a4_width, a4_height = A4  # em pontos (1 pt = 1/72 inch)
    # converter para pixels assumindo 72 dpi
    max_w = int(a4_width) - 40
    max_h = int(a4_height) - 40

    img.thumbnail((max_w * 2, max_h * 2), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=150)
    return buf.getvalue()


def generate_cover_page(caso_data: dict) -> bytes:
    """Gera página de capa do dossiê em PDF."""
    buf = io.BytesIO()
    pdf_doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=2*cm,
        leftMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2*cm
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        fontSize=18,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#1a3a5c"),
        spaceAfter=6
    )
    subtitle_style = ParagraphStyle(
        "Subtitle",
        parent=styles["Normal"],
        fontSize=12,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#555555"),
        spaceAfter=4
    )
    label_style = ParagraphStyle(
        "Label",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#888888"),
        spaceAfter=2
    )
    value_style = ParagraphStyle(
        "Value",
        parent=styles["Normal"],
        fontSize=11,
        textColor=colors.HexColor("#1a1a1a"),
        spaceAfter=8
    )

    story = []

    # Cabeçalho
    story.append(Spacer(1, 1*cm))
    story.append(Paragraph("DronePro Comércio", subtitle_style))
    story.append(Paragraph("Dossiê de Aprovação de Garantia", title_style))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#1a3a5c")))
    story.append(Spacer(1, 0.8*cm))

    # Dados principais
    tipo_label = "Garantia de Peças" if caso_data.get("tipo_processo") == "Peca" else "Garantia de Baterias"

    data_table = [
        ["Caso DJI:", caso_data.get("dji_case_id") or "—"],
        ["Tipo de Processo:", tipo_label],
        ["Produto:", caso_data.get("produto_nome") or "—"],
        ["Modelo:", caso_data.get("produto_modelo") or "—"],
        ["Número de Série:", caso_data.get("produto_sn") or "—"],
        ["Data de Entrada:", str(caso_data.get("data_entrada") or "—")],
        ["Cliente:", caso_data.get("cliente_razao_social") or "—"],
        ["CNPJ:", caso_data.get("cliente_cnpj") or "—"],
    ]

    t = Table(data_table, colWidths=[4.5*cm, 12*cm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#555555")),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#1a1a1a")),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.HexColor("#f5f7fa"), colors.white]),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#dee2e6")),
        ("ROUNDEDCORNERS", [4]),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.8*cm))

    # Assinaturas
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#dee2e6")))
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph("Histórico de Aprovações", ParagraphStyle(
        "SectionTitle", parent=styles["Heading2"],
        fontSize=13, textColor=colors.HexColor("#1a3a5c"), spaceAfter=8
    )))

    assinaturas = caso_data.get("assinaturas", [])
    if assinaturas:
        sig_data = [["Etapa", "Responsável", "Decisão", "Data/Hora"]]
        for sig in assinaturas:
            etapa_label = "Pós-venda" if sig.get("etapa_fluxo") == "Pos-venda" else "Diretoria Comercial"
            decisao = sig.get("status_decisao", "—")
            data_hora = sig.get("data_assinatura", "—")
            if hasattr(data_hora, 'strftime'):
                data_hora = data_hora.strftime("%d/%m/%Y %H:%M")
            sig_data.append([
                etapa_label,
                sig.get("usuario_nome", "—"),
                decisao,
                str(data_hora)
            ])
        sig_table = Table(sig_data, colWidths=[4*cm, 5*cm, 3*cm, 4.5*cm])
        sig_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3a5c")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f7fa")]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#dee2e6")),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(sig_table)
    else:
        story.append(Paragraph("Nenhuma assinatura registrada.", label_style))

    # Documentos incluídos
    story.append(Spacer(1, 0.8*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#dee2e6")))
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph("Documentos Incluídos neste Dossiê", ParagraphStyle(
        "SectionTitle2", parent=styles["Heading2"],
        fontSize=13, textColor=colors.HexColor("#1a3a5c"), spaceAfter=8
    )))

    documentos = caso_data.get("documentos", [])
    if documentos:
        doc_data = [["#", "Tipo de Documento", "Arquivo"]]
        for i, doc_item in enumerate(documentos, 1):
            doc_data.append([str(i), doc_item.get("tipo_documento", "—"), doc_item.get("nome_arquivo", "—")])
        doc_table = Table(doc_data, colWidths=[1*cm, 7*cm, 8.5*cm])
        doc_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3a5c")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f7fa")]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#dee2e6")),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(doc_table)

    # Rodapé
    story.append(Spacer(1, 1*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#dee2e6")))
    story.append(Spacer(1, 0.3*cm))
    footer_text = f"Documento gerado automaticamente em {datetime.now().strftime('%d/%m/%Y às %H:%M')} pelo Sistema de Garantias DronePro"
    story.append(Paragraph(footer_text, ParagraphStyle(
        "Footer", parent=styles["Normal"],
        fontSize=8, textColor=colors.HexColor("#aaaaaa"), alignment=TA_CENTER
    )))

    pdf_doc.build(story)
    return buf.getvalue()


def compile_pdf(caso_data: dict, document_paths: List[dict], output_path: str) -> str:
    """
    Compila todos os documentos de um caso em um único PDF.

    caso_data: dict com info do caso
    document_paths: lista de dicts com 'path_arquivo', 'tipo_documento', 'nome_arquivo'
    output_path: caminho onde o PDF final será salvo
    """
    writer = PdfWriter()

    # 1. Capa
    cover_bytes = generate_cover_page(caso_data)
    cover_reader = PdfReader(io.BytesIO(cover_bytes))
    for page in cover_reader.pages:
        writer.add_page(page)

    # 2. Cada documento
    for doc_info in document_paths:
        path = doc_info["path_arquivo"]
        if not os.path.exists(path):
            continue

        ext = Path(path).suffix.lower()

        try:
            if ext == ".pdf":
                reader = PdfReader(path)
                for page in reader.pages:
                    writer.add_page(page)
            elif ext in (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".webp"):
                img_pdf_bytes = image_to_pdf_bytes(path)
                img_reader = PdfReader(io.BytesIO(img_pdf_bytes))
                for page in img_reader.pages:
                    writer.add_page(page)
        except Exception as e:
            print(f"Erro ao processar documento {path}: {e}")
            continue

    # Salvar PDF compilado
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        writer.write(f)

    return output_path
