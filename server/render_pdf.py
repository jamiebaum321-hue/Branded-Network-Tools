import html
import io
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from weekly_export import report_headings, report_lines, workbook


def font_name():
    candidates = [os.getenv('PDF_FONT_PATH'), '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                  'C:/Windows/Fonts/segoeui.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf']
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            pdfmetrics.registerFont(TTFont('Submission', candidate))
            return 'Submission'
    return 'Helvetica'


def mark(value):
    text = str(value)
    safe = html.escape(text).replace('\n', '<br/>')
    try:
        link = urlsplit(text)
        if link.scheme in ('http', 'https') and link.netloc and not link.username and not link.password:
            return f'<a href="{html.escape(text, quote=True)}" color="#2753C7">{safe}</a>'
    except ValueError:
        pass
    return safe


def render(data):
    font = font_name()
    title = ParagraphStyle('title', fontName=font, fontSize=25, leading=32, textColor=HexColor('#142540'), spaceAfter=12)
    head = ParagraphStyle('head', fontName=font, fontSize=15, leading=21, textColor=HexColor('#2753C7'), spaceBefore=15, spaceAfter=8, keepWithNext=True)
    label = ParagraphStyle('label', fontName=font, fontSize=10, leading=15, textColor=HexColor('#142540'), keepWithNext=True)
    body = ParagraphStyle('body', fontName=font, fontSize=10, leading=15, textColor=HexColor('#465772'), spaceAfter=7, splitLongWords=True)
    weekly = data.get('weekly', False)
    document_title = 'Weekly client update' if weekly else 'Solutions Partner Onboarding'
    period = (f"{data['start_day']} to {data['end_day']}" if weekly else
              f"Submission {data['version']} · {data['submitted_at']}")
    story = [Paragraph(document_title, title), Paragraph(mark(data['client']), head), Paragraph(mark(period), body)]
    if weekly:
        for line in report_lines(data):
            if line.strip():
                story.append(Paragraph(mark(line), head if line in report_headings else body))
    if data.get('source'):
        story.append(Paragraph(f"Source: {mark(data['source'])}", body))
    for section in data.get('pages', []):
        story.append(Paragraph(mark(section['title']), head))
        for field in section['fields']:
            story.append(Paragraph(mark(field['label']), label))
            value = field.get('value')
            if isinstance(value, list) and value:
                for row in value:
                    if row:
                        story.append(Paragraph('<br/>'.join(f'{mark(key)}: {mark(item)}' for key, item in row), body))
            else:
                story.append(Paragraph(mark(value if value not in (None, '', []) else 'Not provided'), body))
        story.append(Spacer(1, 5))

    def footer(page, doc):
        page.setStrokeColor(HexColor('#D9E1ED'))
        page.line(44, 42, 568, 42)
        page.setFont(font, 8)
        page.setFillColor(HexColor('#465772'))
        page.drawString(44, 28, 'BRANDED NETWORK  /  SOLUTIONS')
        page.drawRightString(568, 28, str(doc.page))

    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=44, rightMargin=44, topMargin=42,
                                 bottomMargin=57, title=document_title, author='Branded Network Tools')
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


if __name__ == '__main__':
    data = json.load(sys.stdin)
    sys.stdout.buffer.write(workbook(data) if data.get('format') == 'xlsx' else render(data))
