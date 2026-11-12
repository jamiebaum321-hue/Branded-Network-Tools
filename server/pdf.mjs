import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFString, rgb } from 'pdf-lib';
import { sections } from '../public/intake-fields.mjs';
import { AppError } from './store.mjs';

const fontBytes = readFileSync(new URL('./fonts/DejaVuSans.ttf', import.meta.url));
const hex = (value) => rgb(...[1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255));
const colors = { ink: hex('#142540'), accent: hex('#2753C7'), body: hex('#465772'), rule: hex('#D9E1ED') };
const page = { width: 612, height: 792, left: 44, right: 568, top: 750, bottom: 57 };
const styles = {
  title: { size: 25, leading: 32, color: colors.ink, after: 12 },
  head: { size: 15, leading: 21, color: colors.accent, before: 15, after: 8 },
  label: { size: 10, leading: 15, color: colors.ink },
  body: { size: 10, leading: 15, color: colors.body, after: 7 },
};
let active = 0;

function webLink(text) {
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && url.host && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function wrap(font, text, size, width) {
  const lines = [];
  for (const paragraph of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      let rest = word.trimStart();
      while (rest && font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

async function render(data) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle('Solutions Partner Onboarding');
  pdf.setAuthor('Branded Network Tools');
  const font = await pdf.embedFont(fontBytes, { subset: true });
  let current;
  let y;
  const pages = [];
  const newPage = () => {
    current = pdf.addPage([page.width, page.height]);
    pages.push(current);
    y = page.top;
  };
  const link = (url, x, top, width, height) => {
    const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, top - height, x + width, top], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } });
    const existing = current.node.lookup(PDFName.of('Annots'));
    if (existing) existing.push(pdf.context.register(annotation));
    else current.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(annotation)]));
  };
  const write = (text, style, { keepWithNext = 0 } = {}) => {
    const url = webLink(String(text));
    const lines = wrap(font, text, style.size, page.right - page.left);
    if (style.before && y !== page.top) y -= style.before;
    if (y - Math.min(lines.length, 2) * style.leading - keepWithNext < page.bottom) newPage();
    for (const line of lines) {
      if (y - style.leading < page.bottom) newPage();
      y -= style.leading;
      current.drawText(line, { x: page.left, y: y + (style.leading - style.size) / 2, size: style.size, font,
        color: url ? colors.accent : style.color });
      if (url && line) link(url, page.left, y + style.leading, font.widthOfTextAtSize(line, style.size), style.leading);
    }
    y -= style.after ?? 0;
  };

  newPage();
  write('Solutions Partner Onboarding', styles.title);
  write(data.client, styles.head);
  write(`Submission ${data.version}  |  ${data.submitted_at}`, styles.body);
  if (data.source) write(`Source: ${data.source}`, styles.body);
  for (const section of data.pages) {
    write(section.title, styles.head, { keepWithNext: 30 });
    for (const field of section.fields) {
      write(field.label, styles.label, { keepWithNext: styles.body.leading });
      const value = field.value;
      if (Array.isArray(value) && value.length) {
        for (const row of value) if (row.length) write(row.map(([key, item]) => `${key}: ${item}`).join('\n'), styles.body);
      } else write(value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)
        ? 'Not provided' : String(value), styles.body);
    }
    y -= 5;
  }
  pages.forEach((sheet, index) => {
    sheet.drawLine({ start: { x: page.left, y: 42 }, end: { x: page.right, y: 42 }, thickness: 1, color: colors.rule });
    sheet.drawText('BRANDED NETWORK  /  SOLUTIONS', { x: page.left, y: 28, size: 8, font, color: colors.body });
    const number = String(index + 1);
    sheet.drawText(number, { x: page.right - font.widthOfTextAtSize(number, 8), y: 28, size: 8, font, color: colors.body });
  });
  return Buffer.from(await pdf.save());
}

export async function submissionPdf(submission) {
  if (active >= 4) throw new AppError(503, 'PDF export is busy. Try again shortly.');
  active++;
  try {
    const pages = sections.map(section => ({ title: section.title, fields: section.fields.map(field => {
      const value = submission.answers[field.key];
      return { label: field.label, value: field.rows && Array.isArray(value)
        ? value.map(row => field.rows.flatMap(child => row[child.key] ? [[child.label, row[child.key]]] : [])) : value };
    }) }));
    return await render({ client: submission.client_name, version: submission.version,
      submitted_at: submission.submitted_at, source: submission.source_ref, pages });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('PDF export failed:', error.message);
    throw new AppError(503, 'PDF export is unavailable. Try again shortly.');
  } finally {
    active--;
  }
}
