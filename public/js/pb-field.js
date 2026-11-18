// Football field rendering and play animation (v2). Plays are structured data, backward compatible with v1:
// { players: [{ id, team: 'O'|'D', x, y, type, label, position_id, color, shade, delay,
//     path: [[x, y(, 1 = curved)]...], path_type, motion: [[x,y]...], block_target, opts: [{ id, parent, from: [x,y], points, type }] }],
//   ball: {x,y}, zones: [{ id, shape: 'rect'|'oval', x, y, w, h, color }], texts: [{ id, x, y, text }], view: 'offense'|'defense', los_yard }
// v1 players carry shape 'O' | 'X' | 'square' instead of type; normalizePlayer() maps them when a play is loaded.
// Coordinates: a 100 x 60 box where 100 units = 53.3 yards (sideline to sideline); the line of scrimmage is y = 30
// with the offense below it moving up. The "defense" view turns the field around (x -> 100 - x, y -> 60 - y).
import { esc } from './ui.js';

export const VB = { w: 100, h: 60, los: 30 };
export const YD = 100 / (160 / 3);                       // 1.875 units per yard across the field (sideline to sideline)
export const YDV = 1.25;                                 // units per yard up and down the field (diagrams show ~24 yards each way)
export const HASH = [50 - (80 / 9) * YD, 50 + (80 / 9) * YD]; // high school hashes: 53'4" from each sideline
export const PLAYER_TYPES = [['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['x', 'X'], ['letter', 'Letter'],
  ['circle_letter', 'Circle with letter'], ['square_letter', 'Square with letter'], ['triangle_letter', 'Triangle with letter']];
export const COLOR_KEYS = ['default', 'blue', 'red', 'green', 'orange', 'purple', 'yellow'];
const FILL = { blue: '#2f6fdf', red: '#d64541', green: '#2e9d57', orange: '#e8862a', purple: '#8a5cd0', yellow: '#e9c22e' };
const LINE = { blue: '#7fb0ff', red: '#ff7a72', green: '#7fe39a', orange: '#ffb066', purple: '#c9a6ff', yellow: '#ffe066' };
export const colorHex = (k) => FILL[k] || null;
export const SHADES = [['', 'None'], ['left', 'Left half'], ['right', 'Right half'], ['top', 'Top half'], ['bottom', 'Bottom half'], ['full', 'Filled']];
export const THEMES = {
  grass: { name: 'grass', bg: '#2f6b3f', stripe: '#33714a', line: 'rgba(255,255,255,.62)', tick: 'rgba(255,255,255,.42)', num: 'rgba(255,255,255,.6)', los: 'rgba(255,255,255,.92)', ink: '#ffffff', fill: '#ffffff', stroke: '#17212b', sel: '#ffd666', zone: '#ffe27a', note: '#ffffff', noteInk: '#17212b' },
  paper: { name: 'paper', bg: '#ffffff', stripe: '#ffffff', line: '#bdbdbd', tick: '#cfcfcf', num: '#b0b0b0', los: '#111111', ink: '#111111', fill: '#ffffff', stroke: '#111111', sel: '#2457c5', zone: '#8c8c8c', note: '#ffffff', noteInk: '#111111' },
};
const STYLE = {
  route: { stroke: '#ffffff', dash: '', w: 0.5, end: 'arrow' },
  run: { stroke: '#ffe08a', dash: '', w: 0.75, end: 'arrow' },
  block: { stroke: '#ffffff', dash: '', w: 0.5, end: 'tee' },
  motion: { stroke: '#cfe8ff', dash: '1 0.8', w: 0.42, end: 'arrow' },
  rush: { stroke: '#ffb4a8', dash: '', w: 0.5, end: 'arrow' },
  coverage: { stroke: '#ffb4a8', dash: '1.3 0.9', w: 0.45, end: 'arrow' },
  read: { stroke: '#b5f5c8', dash: '0.4 0.7', w: 0.5, end: 'arrow' },
};
export const PATH_TYPES = Object.keys(STYLE).filter((k) => k !== 'motion');
const OPT_DASH = '1.1 0.75';

// ---------- positions registry (PS-1/PS-2: render-time lookup so edits on the Positions page show everywhere) ----------
let REG = { byId: new Map(), byLetter: new Map() };
export function setPositions(list = []) {
  const byId = new Map(); const byLetter = new Map();
  for (const p of list) { byId.set(Number(p.id), p); const k = `${p.side}:${p.letter}`; if (p.letter && !byLetter.has(k)) byLetter.set(k, p); }
  REG = { byId, byLetter, list };
}
export const positionsList = () => REG.list || [];
export function positionOf(p) {
  if (p.position_id != null) return REG.byId.get(Number(p.position_id)) || null;
  // v1 players (no position_id key at all) pick up the position whose letter matches their label.
  if (p.position_id === undefined && p.label) return REG.byLetter.get(`${p.team || 'O'}:${p.label}`) || null;
  return null;
}
export function displayLetter(p) { const pos = positionOf(p); return pos ? (pos.letter || '') : (p.label || ''); }
export function playerColor(p) { const pos = positionOf(p); return pos ? (pos.color || 'default') : (p.color || 'default'); }

// ---------- v1 -> v2 data ----------
const SHAPE_TYPE = { O: 'circle_letter', square: 'square_letter', X: 'x' };
export function normalizePlayer(p) {
  const out = { path: [], motion: [], opts: [], delay: 0, ...p };
  if (!out.type) out.type = p.shape === 'X' ? 'x' : (SHAPE_TYPE[p.shape] || 'circle_letter');
  if (!out.label && ['circle_letter', 'square_letter'].includes(out.type) && p.shape && !p.position_id) out.type = out.type.replace('_letter', '');
  out.team = out.team || (out.type === 'x' ? 'D' : 'O');
  out.path_type ||= out.team === 'D' ? 'coverage' : 'route';
  out.shape = shapeOf(out.type); // keep v1 readers (older clients, game mode caches) working
  return out;
}
const shapeOf = (type) => (type === 'x' ? 'X' : type.startsWith('square') ? 'square' : 'O');
export function normalizePlay(data) {
  const d = JSON.parse(JSON.stringify(data || {}));
  d.players = (d.players || []).map(normalizePlayer);
  d.zones ||= []; d.texts ||= []; d.quiz ||= [];
  d.ball ||= { x: 50, y: 31.2 };
  d.view ||= 'offense';
  return d;
}

// ---------- geometry ----------
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const r1 = (n) => Math.round(n * 100) / 100;
export const flipPt = (pt, on) => (on ? [100 - pt[0], 60 - pt[1], ...pt.slice(2)] : pt);
// Bezier segments for a route: points flagged curved (third value 1) are joined with a Catmull-Rom spline.
function segments(P) {
  const segs = [];
  const curved = (i) => i >= 1 && i < P.length && P[i][2] === 1;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1]; const b = P[i];
    if (!curved(i)) { segs.push({ a, b }); continue; }
    const p0 = curved(i - 1) ? P[i - 2] : a; const p3 = curved(i + 1) ? P[i + 1] : b;
    const c1 = [a[0] + (b[0] - p0[0]) / 6, a[1] + (b[1] - p0[1]) / 6];
    const c2 = [b[0] - (p3[0] - a[0]) / 6, b[1] - (p3[1] - a[1]) / 6];
    segs.push({ a, b, c1, c2 });
  }
  return segs;
}
const bez = (s, t) => { const u = 1 - t; return [u * u * u * s.a[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.b[0], u * u * u * s.a[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.b[1]]; };
// Dense polyline through a route (used by the animator and for hit-testing).
export function sampleRoute(P) {
  if (P.length < 2) return P.map((p) => [p[0], p[1]]);
  const out = [[P[0][0], P[0][1]]];
  for (const s of segments(P)) {
    if (!s.c1) { out.push([s.b[0], s.b[1]]); continue; }
    for (let k = 1; k <= 10; k++) out.push(bez(s, k / 10));
  }
  return out;
}
function pathD(P) {
  let d = `M${r1(P[0][0])} ${r1(P[0][1])}`;
  for (const s of segments(P)) d += s.c1 ? ` C${r1(s.c1[0])} ${r1(s.c1[1])} ${r1(s.c2[0])} ${r1(s.c2[1])} ${r1(s.b[0])} ${r1(s.b[1])}` : ` L${r1(s.b[0])} ${r1(s.b[1])}`;
  return d;
}
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

// PD-9: a block assigned to a defender ends just short of wherever that defender stands.
export function resolveBlocks(play) {
  const byId = new Map(play.players.map((p) => [p.id, p]));
  if (!play.players.some((p) => p.block_target && byId.has(p.block_target))) return play;
  return {
    ...play,
    players: play.players.map((p) => {
      const t = p.block_target && byId.get(p.block_target);
      if (!t) return p;
      const from = (p.path && p.path.length > 1) ? p.path[p.path.length - 2] : [p.x, p.y];
      const L = dist(from, [t.x, t.y]) || 1;
      const k = Math.max(0, L - 2.1) / L;
      const end = [r1(from[0] + (t.x - from[0]) * k), r1(from[1] + (t.y - from[1]) * k)];
      return { ...p, path: [...(p.path || []).slice(0, -1), end], path_type: 'block' };
    }),
  };
}
const startOf = (p) => (p.motion && p.motion.length ? p.motion[p.motion.length - 1] : [p.x, p.y]);

// Where is each player at time t (seconds)? t < 0 runs pre-snap motion (motion takes 1.5s, from t=-1.5 to 0).
export function positionsAt(play0, t) {
  const play = resolveBlocks(play0);
  const out = {};
  for (const p of play.players) {
    let start = [p.x, p.y];
    if (p.motion && p.motion.length) {
      const mp = sampleRoute([start, ...p.motion]);
      const L = length(mp);
      if (t < 0) { const f = Math.max(0, (t + 1.5) / 1.5); out[p.id] = along(mp, L * f); continue; }
      start = mp[mp.length - 1];
    }
    if (t <= 0 || !p.path || !p.path.length) { out[p.id] = start; continue; }
    const pts = sampleRoute([start, ...p.path]);
    const travel = Math.max(0, t - (p.delay || 0)) * (SPEED[p.team] || 8) * (p.path_type === 'block' ? 0.35 : 1);
    out[p.id] = along(pts, Math.min(travel, length(pts)));
  }
  return out;
}
export function duration(play0) {
  const play = resolveBlocks(play0);
  let m = 0;
  for (const p of play.players) {
    if (p.path && p.path.length) m = Math.max(m, (p.delay || 0) + length(sampleRoute([startOf(p), ...p.path])) / ((SPEED[p.team] || 8) * (p.path_type === 'block' ? 0.35 : 1)));
  }
  return Math.max(1, m);
}

// ---------- field ----------
function fieldMarkings(th, flip, losYard) {
  const ly = Math.max(25, Math.min(75, Number(losYard) || 35));
  const sgn = flip ? 1 : -1; // upfield for the offense is toward smaller y in the offense view
  const yOf = (a) => VB.los + sgn * (a - ly) * YDV;
  let s = `<rect x="0" y="0" width="100" height="60" fill="${th.bg}"/>`;
  const lo = Math.ceil(ly - VB.los / YDV) - 1; const hi = Math.floor(ly + VB.los / YDV) + 1;
  if (th.stripe !== th.bg) for (let a = lo - (lo % 10) - 10; a <= hi; a += 10) { const y1 = yOf(a); const y2 = yOf(a + 5); s += `<rect x="0" y="${r1(Math.min(y1, y2))}" width="100" height="${r1(Math.abs(y2 - y1))}" fill="${th.stripe}"/>`; }
  let ticks = ''; let lines = ''; let nums = '';
  for (let a = lo; a <= hi; a++) {
    const y = r1(yOf(a));
    if (y < -1 || y > 61 || a < 0 || a > 100) continue;
    if (a % 5 === 0) lines += `<line x1="0" x2="100" y1="${y}" y2="${y}"/>`;
    else ticks += `M0.7 ${y}H1.9M98.1 ${y}H99.3M${r1(HASH[0] - 0.6)} ${y}H${r1(HASH[0] + 0.6)}M${r1(HASH[1] - 0.6)} ${y}H${r1(HASH[1] + 0.6)}`;
    if (a % 10 === 0 && a > 0 && a < 100) {
      const n = a <= 50 ? a : 100 - a;
      const fs = 3.4;
      for (const [x, rot] of [[10.5 * YD, 90], [100 - 10.5 * YD, -90]]) nums += `<text x="${r1(x)}" y="${y}" transform="rotate(${rot} ${r1(x)} ${y})" font-size="${fs}" letter-spacing="1.3" text-anchor="middle" dy="0.36em">${n}</text>`;
    }
  }
  s += `<g stroke="${th.line}" stroke-width="0.22">${lines}</g><path d="${ticks}" stroke="${th.tick}" stroke-width="0.16" fill="none"/>`;
  s += `<g fill="${th.num}" font-family="Arial, Helvetica, sans-serif" font-weight="700">${nums}</g>`;
  s += `<line x1="0.25" x2="0.25" y1="0" y2="60" stroke="${th.line}" stroke-width="0.5"/><line x1="99.75" x2="99.75" y1="0" y2="60" stroke="${th.line}" stroke-width="0.5"/>`;
  s += `<line x1="0" x2="100" y1="${VB.los}" y2="${VB.los}" stroke="${th.los}" stroke-width="0.3" stroke-dasharray="1.2 0.7"/>`;
  return s;
}

function endMarker(type, a, b, color, w) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (STYLE[type]?.end === 'tee') {
    const px = Math.cos(ang + Math.PI / 2) * 1.15; const py = Math.sin(ang + Math.PI / 2) * 1.15;
    return `<line x1="${r1(b[0] - px)}" y1="${r1(b[1] - py)}" x2="${r1(b[0] + px)}" y2="${r1(b[1] + py)}" stroke="${color}" stroke-width="${w + 0.12}" stroke-linecap="round"/>`;
  }
  const l = 1.35; const hw = 0.62;
  const p1 = [b[0] - l * Math.cos(ang) + hw * Math.sin(ang), b[1] - l * Math.sin(ang) - hw * Math.cos(ang)];
  const p2 = [b[0] - l * Math.cos(ang) - hw * Math.sin(ang), b[1] - l * Math.sin(ang) + hw * Math.cos(ang)];
  return `<polygon points="${r1(b[0])},${r1(b[1])} ${r1(p1[0])},${r1(p1[1])} ${r1(p2[0])},${r1(p2[1])}" fill="${color}"/>`;
}
// P in view space (already flipped).
function routeSvg(P, type, { th, color, dashed, attrs = '' }) {
  if (P.length < 2) return '';
  const st = STYLE[type] || STYLE.route;
  const stroke = th.name === 'paper' ? th.ink : (color && (type === 'route' || type === 'read') ? color : st.stroke);
  const dash = dashed ? OPT_DASH : st.dash;
  const segs = segments(P); const last = segs[segs.length - 1];
  let from = last.c2 || last.a; if (dist(from, last.b) < 0.05) from = last.a;
  // Shorten the line under the arrowhead so the tip stays sharp.
  return `<g ${attrs}><path d="${pathD(P)}" fill="none" stroke="${stroke}" stroke-width="${st.w}" stroke-dasharray="${dash}" stroke-linejoin="round" stroke-linecap="round"/>${endMarker(type, from, last.b, stroke, st.w)}</g>`;
}

function trashIcon(x, y, attr) {
  return `<g ${attr} style="cursor:pointer"><circle cx="${x}" cy="${y}" r="1.45" fill="#c0362c" stroke="#fff" stroke-width="0.18"/><g stroke="#fff" stroke-width="0.17" fill="none" stroke-linecap="round"><path d="M${r1(x - 0.6)} ${r1(y - 0.45)}h1.2M${r1(x - 0.22)} ${r1(y - 0.45)}v-0.25h0.44v0.25"/><path d="M${r1(x - 0.48)} ${r1(y - 0.3)}l0.1 1h0.76l0.1 -1"/></g></g>`;
}

let UID = 0;
function playerSvg(p, pos, o) {
  const { th } = o;
  const [x, y] = pos;
  const posn = positionOf(p);
  const ck = posn ? posn.color : (p.color || 'default');
  const paper = th.name === 'paper';
  const col = paper ? null : FILL[ck];
  const fill = col || th.fill;
  const letter = posn ? (posn.letter || '') : (p.label || '');
  const type = p.type || 'circle_letter';
  const R = 1.75;
  const up = (p.team === 'D') === !o.flip; // triangles point at the opposing team
  const tri = up ? `${x},${r1(y + 2.05)} ${r1(x - 1.95)},${r1(y - 1.3)} ${r1(x + 1.95)},${r1(y - 1.3)}` : `${x},${r1(y - 2.05)} ${r1(x - 1.95)},${r1(y + 1.3)} ${r1(x + 1.95)},${r1(y + 1.3)}`;
  const base = type.replace('_letter', '');
  let shape = ''; let clip = '';
  if (base === 'circle') { shape = `<circle cx="${x}" cy="${y}" r="${R}" fill="${fill}" stroke="${th.stroke}" stroke-width="0.22"/>`; clip = `<circle cx="${x}" cy="${y}" r="${R}"/>`; }
  else if (base === 'square') { shape = `<rect x="${r1(x - 1.62)}" y="${r1(y - 1.62)}" width="3.24" height="3.24" rx="0.2" fill="${fill}" stroke="${th.stroke}" stroke-width="0.22"/>`; clip = `<rect x="${r1(x - 1.62)}" y="${r1(y - 1.62)}" width="3.24" height="3.24"/>`; }
  else if (base === 'triangle') { shape = `<polygon points="${tri}" fill="${fill}" stroke="${th.stroke}" stroke-width="0.22" stroke-linejoin="round"/>`; clip = `<polygon points="${tri}"/>`; }
  else if (base === 'x') { const c = col || th.ink; shape = `<g stroke="${c}" stroke-width="0.62" stroke-linecap="round"><line x1="${r1(x - 1.35)}" y1="${r1(y - 1.35)}" x2="${r1(x + 1.35)}" y2="${r1(y + 1.35)}"/><line x1="${r1(x + 1.35)}" y1="${r1(y - 1.35)}" x2="${r1(x - 1.35)}" y2="${r1(y + 1.35)}"/></g>`; }
  let shade = '';
  if (p.shade && clip) {
    const id = `${o.uid}s${++UID}`;
    const half = { left: `<rect x="${r1(x - 3)}" y="${r1(y - 3)}" width="3" height="6"/>`, right: `<rect x="${x}" y="${r1(y - 3)}" width="3" height="6"/>`, top: `<rect x="${r1(x - 3)}" y="${r1(y - 3)}" width="6" height="3"/>`, bottom: `<rect x="${r1(x - 3)}" y="${y}" width="6" height="3"/>`, full: `<rect x="${r1(x - 3)}" y="${r1(y - 3)}" width="6" height="6"/>` }[p.shade];
    if (half) shade = `<clipPath id="${id}">${clip}</clipPath><g clip-path="url(#${id})"><g fill="${paper ? '#111' : '#17212b'}" opacity="0.78">${half}</g></g>`;
  } else if (p.shade && base === 'x') shade = `<circle cx="${x}" cy="${y}" r="0.55" fill="${col || th.ink}"/>`;
  let text = '';
  const fsz = letter.length > 2 ? 1.12 : letter.length > 1 ? 1.38 : 1.7;
  if (type === 'letter') {
    const c = col || th.ink;
    text = `<text x="${x}" y="${y}" font-size="${letter.length > 2 ? 1.9 : 2.5}" text-anchor="middle" dy="0.36em" font-weight="800" fill="${c}" stroke="${th.bg}" stroke-width="0.35" paint-order="stroke" font-family="Arial, Helvetica, sans-serif">${esc(letter || '?')}</text>`;
  } else if (type.endsWith('_letter') && letter) {
    const ink = col && ck !== 'yellow' ? '#ffffff' : '#17212b';
    const shaded = p.shade === 'full';
    text = `<text x="${x}" y="${r1(y + (base === 'triangle' ? (up ? -0.35 : 0.35) : 0))}" font-size="${base === 'triangle' ? fsz * 0.82 : fsz}" text-anchor="middle" dy="0.36em" font-weight="700" fill="${shaded ? '#ffffff' : (paper ? '#111' : ink)}" font-family="Arial, Helvetica, sans-serif">${esc(letter)}</text>`;
  } else if (base === 'x' && p.label) {
    text = `<text x="${x}" y="${r1(y + 3.1)}" font-size="1.5" text-anchor="middle" dy="0.36em" font-weight="700" fill="${th.ink}" font-family="Arial, Helvetica, sans-serif">${esc(p.label)}</text>`;
  }
  const sel = o.selected ? `<circle cx="${x}" cy="${y}" r="2.75" fill="none" stroke="${th.sel}" stroke-width="0.42"/>` : '';
  const pick = o.picked ? `<circle cx="${x}" cy="${y}" r="3.1" fill="none" stroke="${th.sel}" stroke-width="0.3" stroke-dasharray="0.7 0.5"/>` : '';
  return `<g data-player="${esc(p.id)}" style="cursor:${o.locked ? 'default' : 'pointer'}" opacity="${o.faded ? 0.42 : 1}"><circle cx="${x}" cy="${y}" r="2.9" fill="transparent"/>${sel}${pick}${shape}${shade}${text}</g>`;
}

function zoneSvg(z, th, flip, editor) {
  let { x, y } = z; const w = z.w || 8; const h = z.h || 6;
  if (flip) { x = 100 - x - w; y = 60 - y - h; }
  const c = th.name === 'paper' ? '#8c8c8c' : (FILL[z.color] || th.zone);
  const body = z.shape === 'oval'
    ? `<ellipse cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" rx="${r1(w / 2)}" ry="${r1(h / 2)}" fill="${c}" fill-opacity="0.24" stroke="${c}" stroke-width="0.3"/>`
    : `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="0.4" fill="${c}" fill-opacity="0.24" stroke="${c}" stroke-width="0.3"/>`;
  let ui = '';
  if (editor && editor.selZone === z.id) {
    ui = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="${th.sel}" stroke-width="0.25" stroke-dasharray="0.8 0.5"/>`
      + `<rect data-zone-handle="${esc(z.id)}" x="${r1(x + w - 0.9)}" y="${r1(y + h - 0.9)}" width="1.8" height="1.8" fill="#fff" stroke="#17212b" stroke-width="0.2" style="cursor:nwse-resize"/>`
      + trashIcon(r1(x + w + 0.2), r1(y - 0.2), `data-zone-trash="${esc(z.id)}"`);
  }
  return `<g data-zone="${esc(z.id)}" style="cursor:${editor ? 'move' : 'default'}">${body}</g>${ui}`;
}
export function textBox(t) {
  const lines = String(t.text || ' ').split('\n');
  const fs = 1.7;
  const w = Math.max(5, Math.max(...lines.map((l) => l.length)) * fs * 0.56 + 1.8);
  const h = lines.length * fs * 1.28 + 1.1;
  return { lines, fs, w, h };
}
function textSvg(t, th, flip, editor) {
  const { lines, fs, w, h } = textBox(t);
  let [cx, cy] = flip ? [100 - t.x, 60 - t.y] : [t.x, t.y];
  cx = Math.max(w / 2, Math.min(100 - w / 2, cx)); cy = Math.max(h / 2, Math.min(60 - h / 2, cy));
  const x = r1(cx - w / 2); const y = r1(cy - h / 2);
  const sel = editor && editor.selText === t.id;
  const tsp = lines.map((l, i) => `<tspan x="${r1(cx)}" y="${r1(y + 0.55 + fs * 1.28 * (i + 0.5))}" dy="0.36em">${esc(l)}</tspan>`).join('');
  return `<g data-text="${esc(t.id)}"><rect x="${x}" y="${y}" width="${r1(w)}" height="${r1(h)}" rx="0.5" fill="${th.note}" fill-opacity="0.95" stroke="${sel ? th.sel : th.noteInk}" stroke-opacity="${sel ? 1 : 0.35}" stroke-width="${sel ? 0.3 : 0.18}" ${sel ? 'stroke-dasharray="0.8 0.5"' : ''}/>`
    + `<text font-size="${fs}" fill="${th.noteInk}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${tsp}</text>`
    + (editor ? `<rect data-text-border="${esc(t.id)}" x="${x}" y="${y}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="transparent" stroke-width="1.3" pointer-events="stroke" style="cursor:move"/>` : '')
    + `</g>${sel ? trashIcon(r1(x + w + 0.2), r1(y - 0.2), `data-text-trash="${esc(t.id)}"`) : ''}`;
}

// Render a play. opts: { t (animation time, null = static), selected, picked, highlight (letter), paths, theme ('grass'|'paper'),
//   view ('offense'|'defense', defaults to play.view), editor ({ selZone, selText, selRoute }), locked (player id), extra, id, uid }
export function renderPlay(play0, opts = {}) {
  const play = resolveBlocks({ zones: [], texts: [], ...play0, players: (play0.players || []).map((p) => (p.type ? p : normalizePlayer(p))) });
  const th = THEMES[opts.theme] || THEMES.grass;
  const flip = (opts.view || play.view) === 'defense';
  const T = (pt) => flipPt(pt, flip);
  const uid = opts.uid || `pf${(++UID).toString(36)}`;
  const t = opts.t;
  const animating = t !== undefined && t !== null;
  const pos = animating ? positionsAt(play, t) : Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y]]));
  const editor = opts.editor || null;
  let zones = (play.zones || []).map((z) => zoneSvg(z, th, flip, editor)).join('');
  let paths = '';
  if (opts.paths !== false) {
    for (const p of play.players) {
      const color = LINE[positionOf(p)?.color || p.color];
      const faded = opts.highlight && displayLetter(p) !== opts.highlight;
      const op = faded ? 0.3 : animating ? 0.45 : 1;
      let g = '';
      if (p.motion && p.motion.length) g += routeSvg([[p.x, p.y], ...p.motion].map(T), 'motion', { th });
      const st = startOf(p);
      const selR = editor && editor.selRoute;
      if (p.path && p.path.length) g += routeSvg([st, ...p.path].map(T), p.path_type, { th, color, attrs: `data-route="${esc(p.id)}" data-rid="primary"${selR && selR.pid === p.id && selR.rid === 'primary' ? ' class="rsel"' : ''}` });
      for (const o of p.opts || []) if (o.points && o.points.length) g += routeSvg([o.from || st, ...o.points].map(T), o.type || p.path_type, { th, color, dashed: true, attrs: `data-route="${esc(p.id)}" data-rid="${esc(o.id)}"` });
      if (g) paths += `<g opacity="${op}">${g}</g>`;
    }
  }
  const ball = play.ball ? (() => { const [bx, by] = T([play.ball.x, play.ball.y]); return `<ellipse cx="${r1(bx)}" cy="${r1(by)}" rx="0.85" ry="0.52" fill="#8b4a1c" stroke="${th.name === 'paper' ? '#111' : '#fff'}" stroke-width="0.12"/>`; })() : '';
  const players = play.players.map((p) => playerSvg(p, T(pos[p.id]), { th, flip, uid, selected: opts.selected === p.id, picked: opts.picked === p.id, locked: opts.locked === p.id, faded: opts.highlight && displayLetter(p) !== opts.highlight })).join('');
  const texts = (play.texts || []).map((tb) => textSvg(tb, th, flip, editor)).join('');
  return `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg" ${opts.id ? `id="${opts.id}"` : ''} preserveAspectRatio="xMidYMid meet" text-rendering="geometricPrecision" role="img" aria-label="Play diagram">${fieldMarkings(th, flip, play.los_yard)}${zones}${paths}${ball}${players}${texts}${opts.extra || ''}</svg>`;
}
export const thumb = (play, theme) => renderPlay(play, { paths: true, theme });

