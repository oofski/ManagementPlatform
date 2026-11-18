// PL-5: export a play as PNG or PDF, in the Grass or Paper theme, with an editable file name. Everything happens in the
// browser: the play's SVG is drawn onto a canvas (PNG), and a small built-in PDF writer embeds that image as a JPEG.
// The server call first checks the export permission (coaches only when the head coach allows it; players never) and
// logs the export; the watermark it returns is printed on the file.
import { api } from './api.js';
import { html, modal, field, options, formData, toast } from './ui.js';
import { renderPlay, normalizePlay } from './field.js';

const safeName = (s) => (String(s || 'play').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'play').slice(0, 120);

export function openExport(ctx, playId, { name }) {
  const m = modal({
    title: 'Export play',
    body: html`<form id="xf" onsubmit="return false">
      <div class="fields">${field('File type', html`<select name="type">${options([['png', 'PNG image'], ['pdf', 'PDF']], 'pdf')}</select>`)}
      ${field('PDF layout', html`<select name="layout">${options([['landscape', 'Landscape'], ['portrait', 'Portrait']], 'landscape')}</select>`)}</div>
      ${field('Theme', html`<select name="theme">${options([['grass', 'Grass (for presentations)'], ['paper', 'Paper (black and white printing)']], 'grass')}</select>`)}
      ${field('File name', html`<input name="filename" value="${safeName(name)}" required>`, 'The extension is added for you.')}
      <p class="help">The file is watermarked with your name and the date, and the export is logged.</p></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Export', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#xf'));
      const x = await api.get(`/api/plays/${playId}/export`);
      const file = `${safeName(f.filename || x.name)}.${f.type}`;
      const blob = f.type === 'png' ? await playPng(x, f.theme) : await playPdf(x, f.theme, f.layout);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Exported ${file}`);
    } }],
  });
  const sync = () => { const t = m.root.querySelector('[name=type]').value; m.root.querySelector('[name=layout]').closest('.field').style.visibility = t === 'pdf' ? 'visible' : 'hidden'; };
  m.root.querySelector('[name=type]').addEventListener('change', sync); sync();
  return m;
}

// Draw the play onto a canvas. scale = pixels per field unit (the field is 100 x 60 units).
export function playCanvas(play, theme = 'grass', { scale = 24, title, watermark } = {}) {
  return new Promise((resolve, reject) => {
    const W = 100 * scale; const H = 60 * scale;
    const svg = renderPlay(normalizePlay(play.data), { theme }).replace('<svg ', `<svg width="${W}" height="${H}" `);
    const img = new Image();
    img.onload = () => {
      const head = title ? Math.round(scale * 4.2) : 0;
      const c = document.createElement('canvas'); c.width = W; c.height = H + head;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
      if (title) { g.fillStyle = '#17171a'; g.font = `600 ${Math.round(scale * 2)}px Arial, Helvetica, sans-serif`; g.textBaseline = 'middle'; g.fillText(title, scale * 1.2, head / 2); }
      g.drawImage(img, 0, head, W, H);
      if (watermark) {
        g.save(); g.font = `${Math.round(scale * 1.1)}px Arial, Helvetica, sans-serif`; g.fillStyle = theme === 'paper' ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.7)';
        g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(watermark, W - scale, head + H - scale * 0.8); g.restore();
      }
      resolve(c);
    };
    img.onerror = () => reject(new Error('Could not draw the play'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
export async function playPng(x, theme) {
  const c = await playCanvas(x, theme, { scale: 24, title: x.name, watermark: x.watermark });
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

// ---------- a minimal PDF writer: one page, Helvetica text, one JPEG image ----------
const pdfText = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/·/g, '-').replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
function wrap(text, size, width) {
  const max = Math.max(10, Math.floor(width / (size * 0.5)));
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) { if ((line + ' ' + w).trim().length > max) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
    out.push(line);
  }
  return out;
}
export function buildPdf({ width, height, jpeg, imgW, imgH, box, lines }) {
  const enc = new TextEncoder();
  const chunks = []; const offsets = []; let len = 0;
  const push = (b) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); len += u.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  let content = `q ${box.w.toFixed(2)} 0 0 ${box.h.toFixed(2)} ${box.x.toFixed(2)} ${box.y.toFixed(2)} cm /Im1 Do Q\n`;
  for (const l of lines) content += `BT /F1 ${l.size} Tf ${l.gray != null ? `${l.gray} g ` : '0 g '}${l.x.toFixed(2)} ${l.y.toFixed(2)} Td (${pdfText(l.text)}) Tj ET\n`;
  const cbytes = enc.encode(content);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im1 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>`);
  obj(4, [`<< /Length ${cbytes.length} >>\nstream\n`, cbytes, '\nendstream']);
  obj(5, [`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
  obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const xref = len;
  push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
export async function playPdf(x, theme, layout = 'landscape') {
  const c = await playCanvas(x, theme, { scale: 22, watermark: x.watermark });
  const jpeg = Uint8Array.from(atob(c.toDataURL('image/jpeg', 0.92).split(',')[1]), (ch) => ch.charCodeAt(0));
  const [W, H] = layout === 'portrait' ? [612, 792] : [792, 612];
  const M = 40; const lines = [];
  let y = H - M - 18;
  lines.push({ size: 18, x: M, y, text: x.name });
  y -= 16;
  const sub = [x.side && x.side[0].toUpperCase() + x.side.slice(1), x.formation].filter(Boolean).join(' - ');
  if (sub) { lines.push({ size: 10, x: M, y, text: sub, gray: 0.35 }); y -= 8; }
  const bw = W - 2 * M; const bh = bw * (c.height / c.width);
  const box = { x: M, y: y - 6 - bh, w: bw, h: bh };
  y = box.y - 20;
  if (x.coaching_points) { lines.push({ size: 11, x: M, y, text: 'Coaching points' }); y -= 14; for (const l of wrap(x.coaching_points, 10, bw)) { if (y < M + 20) break; lines.push({ size: 10, x: M, y, text: l }); y -= 13; } y -= 6; }
  const asg = Object.entries(x.assignments || {});
  if (asg.length && y > M + 30) { lines.push({ size: 11, x: M, y, text: 'Assignments' }); y -= 14; for (const [k, v] of asg) { for (const l of wrap(`${k}: ${v}`, 10, bw)) { if (y < M + 20) break; lines.push({ size: 10, x: M, y, text: l }); y -= 13; } } }
  lines.push({ size: 8, x: M, y: M - 16, text: x.watermark || '', gray: 0.45 });
  const bytes = buildPdf({ width: W, height: H, jpeg, imgW: c.width, imgH: c.height, box, lines });
  return new Blob([bytes], { type: 'application/pdf' });
}
