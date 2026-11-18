// Football field rendering and play animation. The v2 renderer (field markings, the eight player types, curved and
// optional routes, blocks, zones, text boxes, themes and the defense view) lives in pb-field.js and is re-exported here,
// so every page keeps importing from field.js.
import { esc } from './ui.js';
import { duration } from './pb-field.js';

export * from './pb-field.js';

// Pointer position in the SVG's (view) coordinates, clamped to the field. Use flipPt(pt, view === 'defense') for data space.
export function svgPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  const src = evt.touches ? evt.touches[0] : evt;
  pt.x = src.clientX; pt.y = src.clientY;
  const r = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [Math.round(Math.max(0, Math.min(100, r.x)) * 10) / 10, Math.round(Math.max(0, Math.min(60, r.y)) * 10) / 10];
}
export const watermarkHtml = (text) => `<div class="watermark" aria-hidden="true">${Array.from({ length: 12 }, () => `<span>${esc(text)}</span>`).join('')}</div>`;

// Simple animator: calls draw(t) each frame; returns controller.
export function animator(play, draw) {
  let t = -1.6; let raf = null; let last = null; let speed = 1;
  const total = duration(play);
  const frame = (ts) => {
    if (last != null) t += ((ts - last) / 1000) * speed;
    last = ts;
    if (t >= total + 0.6) { t = total + 0.6; draw(t); stop(); return; }
    draw(t); raf = requestAnimationFrame(frame);
  };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; last = null; };
  return {
    play() { if (t >= total + 0.6) t = -1.6; stop(); raf = requestAnimationFrame(frame); },
    pause: stop,
    get playing() { return !!raf; },
    reset() { stop(); t = -1.6; draw(null); },
    step(dt) { stop(); t = Math.max(-1.6, Math.min(total + 0.6, (t < -1.5 && dt > 0 ? 0 : t) + dt)); draw(t); },
    setSpeed(s) { speed = s; },
    get time() { return t; }, total,
  };
}
