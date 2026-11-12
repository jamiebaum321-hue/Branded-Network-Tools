import html
import io
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = HexColor('#101828')
TEXT = HexColor('#344054')
MUTED = HexColor('#667085')
LINE = HexColor('#E4E7EC')
TINT = HexColor('#F4F6FE')
ZEBRA = HexColor('#FAFBFD')
PRIMARY = HexColor('#3B4FD8')
PRIMARY_DARK = HexColor('#1E2A78')
PRIMARY_SOFT = HexColor('#C9D2FF')
LINK = '#3B4FD8'
MARGIN = 46
WIDTH = letter[0] - 2 * MARGIN
INNER = WIDTH - 12  # Frames pad text by 6pt on each side; boxed tables match that edge.


def fonts():
    """Returns (regular, bold). Uses a Unicode font when one is installed."""
    candidates = [os.getenv('PDF_FONT_PATH'), '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                  'C:/Windows/Fonts/segoeui.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf']
    bold_names = {'DejaVuSans.ttf': 'DejaVuSans-Bold.ttf', 'segoeui.ttf': 'segoeuib.ttf', 'Arial.ttf': 'Arial Bold.ttf'}
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            path = Path(candidate)
            pdfmetrics.registerFont(TTFont('Body', str(path)))
            bold = path.with_name(bold_names.get(path.name, f'{path.stem}-Bold{path.suffix}'))
            if bold.is_file():
                pdfmetrics.registerFont(TTFont('BodyBold', str(bold)))
                return 'Body', 'BodyBold'
            return 'Body', 'Body'
    return 'Helvetica', 'Helvetica-Bold'


def mark(value):
    text = str(value)
    safe = html.escape(text).replace('\n', '<br/>')
    try:
        link = urlsplit(text)
        if link.scheme in ('http', 'https') and link.netloc and not link.username and not link.password:
            return f'<a href="{html.escape(text, quote=True)}" color="{LINK}">{safe}</a>'
    except ValueError:
        pass
    return safe


def cell_mark(value):
    """A table cell is plain text or {text, link}."""
    if isinstance(value, dict):
        text = html.escape(str(value.get('text', '')))
        link = str(value.get('link', ''))
        parts = urlsplit(link)
        if parts.scheme in ('http', 'https') and parts.netloc and not parts.username:
            return f'<a href="{html.escape(link, quote=True)}" color="{LINK}">{text}</a>'
        return text
    return html.escape(str(value if value not in (None, '') else '–')).replace('\n', '<br/>')


def footer(font, left):
    def draw(page, doc):
        page.saveState()
        page.setStrokeColor(LINE)
        page.setLineWidth(.6)
        page.line(MARGIN, 44, letter[0] - MARGIN, 44)
        page.setFont(font, 7.5)
        page.setFillColor(MUTED)
        page.drawString(MARGIN, 30, left)
        page.drawRightString(letter[0] - MARGIN, 30, f'Page {doc.page}')
        page.restoreState()
    return draw


def render_submission(data):
    font, bold = fonts()
    title = ParagraphStyle('title', fontName=bold, fontSize=22, leading=28, textColor=INK, spaceAfter=4)
    client = ParagraphStyle('client', fontName=font, fontSize=12, leading=17, textColor=PRIMARY, spaceAfter=2)
    head = ParagraphStyle('head', fontName=bold, fontSize=12.5, leading=18, textColor=INK, spaceBefore=18, spaceAfter=7, keepWithNext=True)
    label = ParagraphStyle('label', fontName=bold, fontSize=8.5, leading=13, textColor=MUTED, spaceBefore=5, keepWithNext=True)
    body = ParagraphStyle('body', fontName=font, fontSize=10, leading=15, textColor=TEXT, spaceAfter=4, splitLongWords=True)
    story = [Paragraph('Client onboarding profile', title), Paragraph(mark(data['client']), client),
             Paragraph(f"Version {data['version']} &nbsp;·&nbsp; {mark(data['submitted_at'])}", body)]
    if data['source']:
        story.append(Paragraph(f"Source: {mark(data['source'])}", body))
    for section in data['pages']:
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
        story.append(Spacer(1, 4))
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=46,
                                 bottomMargin=60, title='Client onboarding profile', author='Branded Network Tools')
    draw = footer(font, f"BRANDED NETWORK  ·  {str(data['client']).upper()}")
    document.build(story, onFirstPage=draw, onLaterPages=draw)
    return buffer.getvalue()


def render_report(data):
    font, bold = fonts()
    band = 168
    kicker = ParagraphStyle('kicker', fontName=bold, fontSize=8, leading=11, textColor=MUTED, spaceAfter=5)
    headline = ParagraphStyle('headline', fontName=bold, fontSize=17, leading=23, textColor=INK, spaceAfter=10)
    body = ParagraphStyle('body', fontName=font, fontSize=10, leading=15.5, textColor=TEXT, spaceAfter=8, splitLongWords=True)
    section = ParagraphStyle('section', fontName=bold, fontSize=13, leading=18, textColor=INK, spaceBefore=20, spaceAfter=8, keepWithNext=True)
    note = ParagraphStyle('note', fontName=font, fontSize=8.5, leading=13, textColor=MUTED, spaceBefore=6)
    tile_value = ParagraphStyle('tile_value', fontName=bold, fontSize=21, leading=25, textColor=PRIMARY_DARK)
    tile_label = ParagraphStyle('tile_label', fontName=font, fontSize=8.5, leading=12, textColor=MUTED)
    th = ParagraphStyle('th', fontName=bold, fontSize=7.5, leading=10, textColor=MUTED)
    th_right = ParagraphStyle('th_right', parent=th, alignment=TA_RIGHT)
    td = ParagraphStyle('td', fontName=font, fontSize=9, leading=13, textColor=TEXT, splitLongWords=True)
    td_right = ParagraphStyle('td_right', parent=td, alignment=TA_RIGHT)

    story = [Spacer(1, band - 46 + 22)]
    if data.get('headline'):
        story += [Paragraph('THE MONTH IN ONE LINE', kicker), Paragraph(mark(data['headline']), headline)]

    gap = 10
    tile_width = (INNER - 2 * gap) / 3
    tiles = data['tiles']
    for start in range(0, len(tiles), 3):
        row = []
        for index, tile in enumerate(tiles[start:start + 3]):
            if index:
                row.append('')
            row.append([Paragraph(mark(tile['value']), tile_value), Paragraph(mark(tile['label']), tile_label)])
        while len(row) < 5:
            row.append('')
        table = Table([row], colWidths=[tile_width, gap, tile_width, gap, tile_width])
        style = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 12), ('BOTTOMPADDING', (0, 0), (-1, -1), 13),
                 ('LEFTPADDING', (0, 0), (-1, -1), 14), ('RIGHTPADDING', (0, 0), (-1, -1), 8)]
        for column in (0, 2, 4):
            if row[column] != '':
                style.append(('BACKGROUND', (column, 0), (column, 0), TINT))
        table.setStyle(TableStyle(style))
        story += [table, Spacer(1, gap)]

    if data.get('summary'):
        story += [Paragraph('Summary', section), Paragraph(mark(data['summary']), body)]
    if data.get('next_steps'):
        story += [Paragraph('What comes next', section), Paragraph(mark(data['next_steps']), body)]

    if data.get('pipeline') and any(item['value'] != '0' for item in data['pipeline']):
        cells = [[Paragraph(mark(item['value']), ParagraphStyle('pv', parent=tile_value, fontSize=15, leading=19)),
                  Paragraph(mark(item['label']), tile_label)] for item in data['pipeline']]
        table = Table([cells], colWidths=[INNER / len(cells)] * len(cells))
        table.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), .6, LINE), ('INNERGRID', (0, 0), (-1, -1), .6, LINE),
                                   ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
                                   ('LEFTPADDING', (0, 0), (-1, -1), 12), ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
        story.append(KeepTogether([Paragraph('Your introduction pipeline today', section), table]))

    for block in data['sections']:
        columns = block['columns']
        right = [len(column) > 2 and column[2] == 'right' for column in columns]
        # Number columns are as wide as their heading or largest value. Text columns share what is left.
        fixed = {}
        for index, column in enumerate(columns):
            if right[index]:
                values = [pdfmetrics.stringWidth(str(row[index]), font, 9) for row in block['rows']]
                fixed[index] = max([pdfmetrics.stringWidth(str(column[0]).upper(), bold, 7.5)] + values) + 16
        share = sum(column[1] for index, column in enumerate(columns) if index not in fixed) or 1
        remaining = WIDTH - sum(fixed.values())
        widths = [fixed[index] if index in fixed else remaining * column[1] / share for index, column in enumerate(columns)]
        rows = [[Paragraph(html.escape(str(column[0]).upper()), th_right if right[i] else th) for i, column in enumerate(columns)]]
        for values in block['rows']:
            rows.append([Paragraph(cell_mark(value), td_right if right[i] else td) for i, value in enumerate(values)])
        table = Table(rows, colWidths=widths, repeatRows=1)
        style = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, 0), .8, LINE), ('LINEBELOW', (0, 1), (-1, -1), .4, LINE),
                 ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
                 ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6)]
        for index in range(2, len(rows), 2):
            style.append(('BACKGROUND', (0, index), (-1, index), ZEBRA))
        table.setStyle(TableStyle(style))
        count = len(block['rows'])
        heading = Paragraph(f"{mark(block['title'])} &nbsp;<font name=\"{font}\" size=\"9\" color=\"#667085\">{count}</font>", section)
        story.append(KeepTogether([heading, Spacer(1, 1)]) if count > 6 else heading)
        story.append(table)
        if block.get('note'):
            story.append(Paragraph(mark(block['note']), note))

    if not data['sections']:
        story.append(Paragraph('No activity has been logged for this month yet.', body))

    base = footer(font, f"BRANDED NETWORK  ·  {str(data['client']).upper()}  ·  {str(data['period']).upper()}")

    def first(page, doc):
        page.saveState()
        height = letter[1]
        page.setFillColor(PRIMARY)
        page.rect(0, height - band, letter[0], band, stroke=0, fill=1)
        page.setFillColor(PRIMARY_DARK)
        page.rect(0, height - band, letter[0], 5, stroke=0, fill=1)
        page.setFillColor(PRIMARY_SOFT)
        page.setFont(bold, 8)
        page.drawString(MARGIN, height - 50, 'MONTHLY PARTNERSHIP REPORT')
        page.setFillColor(white)
        size = 30 if len(str(data['client'])) < 26 else 22
        page.setFont(bold, size)
        page.drawString(MARGIN, height - 92, str(data['client'])[:60])
        page.setFont(font, 13)
        page.drawString(MARGIN, height - 116, str(data['period']))
        page.setFillColor(PRIMARY_SOFT)
        page.setFont(font, 8.5)
        prepared = f"Prepared by {data['prepared_by']}, Branded Network" if data.get('prepared_by') else 'Prepared by Branded Network'
        page.drawString(MARGIN, height - 142, prepared)
        page.restoreState()
        base(page, doc)

    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=46, bottomMargin=62,
                                 title=f"{data['client']} report, {data['period']}", author='Branded Network')
    document.build(story, onFirstPage=first, onLaterPages=base)
    return buffer.getvalue()


if __name__ == '__main__':
    payload = json.load(sys.stdin)
    sys.stdout.buffer.write(render_report(payload) if payload.get('type') == 'report' else render_submission(payload))
