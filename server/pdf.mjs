import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sections } from '../public/intake-fields.mjs';
import { AppError } from './store.mjs';

let active = 0;
const renderer = fileURLToPath(new URL('./render_pdf.py', import.meta.url));

// Runs the Python renderer with a JSON payload and resolves to the PDF bytes.
function renderPdf(payload, config) {
  if (active >= 2) throw new AppError(503, 'PDF export is busy. Try again shortly.');
  active++;
  return new Promise((resolve, reject) => {
    const runtimeEnv = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const child = spawn(config.pdfPython, [renderer], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...runtimeEnv, PYTHONIOENCODING: 'utf-8', PDF_FONT_PATH: config.pdfFont ?? '' } });
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), 12000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stdin.on('error', () => {});
    child.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      active--;
      const result = Buffer.concat(chunks);
      if (code !== 0 || !result.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        reject(new AppError(503, 'PDF export is unavailable. Check the PDF runtime setup.'));
      } else resolve(result);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function submissionPdf(submission, config) {
  const pages = sections.map(section => ({ title: section.title, fields: section.fields.map(field => {
    const value = submission.answers[field.key];
    return { label: field.label, value: field.rows && Array.isArray(value)
      ? value.map(row => field.rows.flatMap(child => row[child.key] ? [[child.label, row[child.key]]] : []))
      : Array.isArray(value) ? value.join(', ') : value };
  }) }));
  return renderPdf({ type: 'submission', client: submission.client_name, version: submission.version,
    submitted_at: submission.submitted_at, source: submission.source_ref, pages }, config);
}

export const reportPdf = (document, config) => renderPdf(document, config);
