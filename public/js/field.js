// Football field rendering and play animation. Plays are structured data:
// { players: [{ id, label, shape: 'O'|'X'|'square', team: 'O'|'D', x, y, path: [[x,y]...], path_type, delay, motion: [[x,y]...] }], ball: {x,y} }
// Coordinates use a 100 x 60 box; the line of scrimmage sits at y = 30 (offense below, moving up).
import { esc } from './ui.js';

export const VB = { w: 100, h: 60, los: 30 };
const STYLE = {
  route: { stroke: '#ffffff', dash: '', w: 0.55, end: 'arrow' },
  run: { stroke: '#ffe08a', dash: '', w: 0.9, end: 'arrow' },
  block: { stroke: '#ffffff', dash: '', w: 0.55, end: 'tee' },
  motion: { stroke: '#cfe8ff', dash: '1.2 1', w: 0.45, end: 'arrow' },
  rush: { stroke: '#ffb4a8', dash: '', w: 0.55, end: 'arrow' },
  coverage: { stroke: '#ffb4a8', dash: '1.4 1', w: 0.5, end: 'arrow' },
  read: { stroke: '#b5f5c8', dash: '0.5 0.8', w: 0.5, end: 'arrow' },
};
export const PATH_TYPES = Object.keys(STYLE).filter((k) => k !== 'motion');

function fieldMarkings() {
  let s = `<rect x="0" y="0" width="100" height="60" fill="#2f6b3f"/>`;
  for (let i = 0; i <= 12; i++) {
    const y = VB.los - 30 + i * 5;
    s += `<line x1="0" x2="100" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.28)" stroke-width="0.25"/>`;
  }
  for (let y = 0; y <= 60; y += 1) {
    s += `<line x1="38" x2="39.2" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.35)" stroke-width="0.18"/><line x1="60.8" x2="62" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.35)" stroke-width="0.18"/>`;
  }
  s += `<line x1="0" x2="100" y1="${VB.los}" y2="${VB.los}" stroke="rgba(255,255,255,.75)" stroke-width="0.35" stroke-dasharray="1 0.6"/>`;
  return s;
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
function along(points, d) {
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (d <= seg) { const r = seg ? d / seg : 0; return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * r, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * r]; }
    d -= seg;
  }
  return points[points.length - 1];
}
const length = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
export const SPEED = { O: 9, D: 8 }; // field units per second

// Where is each player at time t (seconds)? t < 0 runs pre-snap motion (motion takes 1.5s, from t=-1.5 to 0).
export function positionsAt(play, t) {
  const out = {};
  for (const p of play.players) {
    let start = [p.x, p.y];
    if (p.motion && p.motion.length) {
      const mp = [start, ...p.motion];
      const L = length(mp);
      if (t < 0) { const f = Math.max(0, (t + 1.5) / 1.5); out[p.id] = along(mp, L * f); continue; }
      start = mp[mp.length - 1];
    }
    if (t <= 0 || !p.path || !p.path.length) { out[p.id] = start; continue; }
    const pts = [start, ...p.path];
    const travel = Math.max(0, t - (p.delay || 0)) * (SPEED[p.team] || 8) * (p.path_type === 'block' ? 0.35 : 1);
    out[p.id] = along(pts, Math.min(travel, length(pts)));
  }
  return out;
}
export function duration(play) {
  let m = 0;
  for (const p of play.players) {
    const st = p.motion && p.motion.length ? p.motion[p.motion.length - 1] : [p.x, p.y];
    if (p.path && p.path.length) m = Math.max(m, (p.delay || 0) + length([st, ...p.path]) / ((SPEED[p.team] || 8) * (p.path_type === 'block' ? 0.35 : 1)));
  }
  return Math.max(1, m);
}

function endMarker(type, a, b, color) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (STYLE[type]?.end === 'tee') {
    const px = Math.cos(ang + Math.PI / 2) * 1.1; const py = Math.sin(ang + Math.PI / 2) * 1.1;
    return `<line x1="${b[0] - px}" y1="${b[1] - py}" x2="${b[0] + px}" y2="${b[1] + py}" stroke="${color}" stroke-width="0.6"/>`;
  }
  const l = 1.3; const w = 0.6;
  const p1 = [b[0] - l * Math.cos(ang) + w * Math.sin(ang), b[1] - l * Math.sin(ang) - w * Math.cos(ang)];
  const p2 = [b[0] - l * Math.cos(ang) - w * Math.sin(ang), b[1] - l * Math.sin(ang) + w * Math.cos(ang)];
  return `<polygon points="${b[0]},${b[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}" fill="${color}"/>`;
}
function pathSvg(pts, type) {
  if (pts.length < 2) return '';
  const st = STYLE[type] || STYLE.route;
  return `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${st.stroke}" stroke-width="${st.w}" stroke-dasharray="${st.dash}" stroke-linejoin="round" stroke-linecap="round"/>${endMarker(type, pts[pts.length - 2], pts[pts.length - 1], st.stroke)}`;
}
function playerSvg(p, pos, { selected, faded }) {
  const [x, y] = pos;
  const col = p.team === 'D' ? '#ffd9d2' : '#ffffff';
  const sel = selected ? `<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="#ffd666" stroke-width="0.4"/>` : '';
  const label = `<text x="${x}" y="${y + (p.shape === 'X' ? 3.6 : 0.62)}" font-size="${p.shape === 'X' ? 1.9 : 1.6}" text-anchor="middle" font-weight="700" fill="${p.shape === 'X' ? '#fff' : '#17212b'}" font-family="Arial">${esc(p.label || '')}</text>`;
  let shape;
  if (p.shape === 'X') shape = `<g stroke="${col}" stroke-width="0.6" stroke-linecap="round"><line x1="${x - 1.3}" y1="${y - 1.3}" x2="${x + 1.3}" y2="${y + 1.3}"/><line x1="${x + 1.3}" y1="${y - 1.3}" x2="${x - 1.3}" y2="${y + 1.3}"/></g>`;
  else if (p.shape === 'square') shape = `<rect x="${x - 1.6}" y="${y - 1.6}" width="3.2" height="3.2" fill="${col}" stroke="#17212b" stroke-width="0.2"/>`;
  else shape = `<circle cx="${x}" cy="${y}" r="1.7" fill="${col}" stroke="#17212b" stroke-width="0.2"/>`;
  return `<g data-player="${esc(p.id)}" style="cursor:pointer" opacity="${faded ? 0.5 : 1}"><circle cx="${x}" cy="${y}" r="2.6" fill="transparent"/>${sel}${shape}${label}</g>`;
}

// Render a play. opts: { t: animation time or null for static, selected: id, highlight: label, paths: true }
export function renderPlay(play, opts = {}) {
  const t = opts.t;
  const animating = t !== undefined && t !== null;
  const pos = animating ? positionsAt(play, t) : Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y]]));
  let paths = '';
  if (opts.paths !== false) {
    for (const p of play.players) {
      if (p.motion && p.motion.length) paths += pathSvg([[p.x, p.y], ...p.motion], 'motion');
      const st = p.motion && p.motion.length ? p.motion[p.motion.length - 1] : [p.x, p.y];
      if (p.path && p.path.length) paths += `<g opacity="${animating ? 0.45 : 1}">${pathSvg([st, ...p.path], p.path_type)}</g>`;
    }
  }
  const ball = play.ball ? `<ellipse cx="${play.ball.x}" cy="${play.ball.y}" rx="0.9" ry="0.55" fill="#8b4a1c" stroke="#fff" stroke-width="0.12"/>` : '';
  const players = play.players.map((p) => playerSvg(p, pos[p.id], { selected: opts.selected === p.id, faded: opts.highlight && p.label !== opts.highlight })).join('');
  return `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg" ${opts.id ? `id="${opts.id}"` : ''} preserveAspectRatio="xMidYMid meet">${fieldMarkings()}${paths}${ball}${players}${opts.extra || ''}</svg>`;
}
export const thumb = (play) => renderPlay(play, { paths: true });

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
