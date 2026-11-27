import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sections } from '../public/intake-fields.mjs';
import { AppError } from './store.mjs';

let active = 0;
const renderer = fileURLToPath(new URL('./render_pdf.py', import.meta.url));

export function submissionPdf(submission, config) {
  const pages = sections.map(section => ({ title: section.title, fields: section.fields.map(field => {
    const value = submission.answers[field.key];
    return { label: field.label, value: field.rows && Array.isArray(value)
      ? value.map(row => field.rows.flatMap(child => row[child.key] ? [[child.label, row[child.key]]] : [])) : value };
  }) }));
  if(submission.files?.length)pages.push({title:'Submitted files',fields:submission.files.map(f=>({label:f.purpose,value:f.name}))});
  return renderDocument({ client: submission.client_name, version: submission.version,
    submitted_at: submission.submitted_at, source: submission.source_ref, pages }, config);
}

export function weeklyReportFile(report, company, format, config) {
  return renderDocument({
    weekly: true, format, client: company, start_day: report.start_day, end_day: report.end_day, body: report.body,
  }, config);
}

function renderDocument(data, config) {
  if (active >= 2) throw new AppError(503, 'Document export is busy. Try again shortly.');
  active++;
  const signature = data.format === 'xlsx' ? Buffer.from([0x50, 0x4b, 0x03, 0x04]) : Buffer.from('%PDF-');
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
      if (code !== 0 || !result.subarray(0, signature.length).equals(signature)) {
        reject(new AppError(503, 'Document export is unavailable. Check the Python runtime setup.'));
      } else resolve(result);
    });
    child.stdin.end(JSON.stringify(data));
  });
}
