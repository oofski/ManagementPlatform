// Playbook v2 data helpers shared by the designer, Playcaller Mode and the playbook pages: play tags, the built-in
// route library (Route Menu), Smart Distance, Smart Flip, formation sliding, formation loading and play grouping.
import { VB, YD, YDV, HASH, normalizePlayer, positionOf, displayLetter, sampleRoute } from './pb-field.js';

export const SITUATION = {
  play_type: { O: ['Run', 'Pass', 'Play-action', 'Screen', 'RPO', 'Option', 'Draw', 'Trick'], D: ['Base', 'Blitz', 'Coverage', 'Man', 'Zone', 'Stunt', 'Prevent'], S: ['Kick', 'Return', 'Trick'] },
  distance: ['Short', 'Medium', 'Long'],
  down_distance: ['1st & 10', '2nd & Short', '2nd & Medium', '2nd & Long', '3rd & Short', '3rd & Medium', '3rd & Long', '4th & Short', '4th & Medium', '4th & Long', 'Goal line', 'Red zone', '2-minute'],
};
export const playTypesFor = (side) => SITUATION.play_type[side === 'defense' ? 'D' : side === 'special' ? 'S' : 'O'];
export const GROUP_BY = [['name', 'Play name'], ['formation', 'Formation'], ['play_type', 'Play type'], ['distance', 'Distance'], ['down_distance', 'Down & distance']];

export const uid = (p = 'p') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const r1 = (n) => Math.round(n * 10) / 10;
export const clampX = (x) => Math.max(0.8, Math.min(VB.w - 0.8, x));
export const clampY = (y) => Math.max(0.8, Math.min(VB.h - 0.8, y));
export const clone = (o) => JSON.parse(JSON.stringify(o));

// PB-4: group plays. A play with several tags appears under each of them.
export function groupPlays(plays, by) {
  const groups = new Map();
  const add = (k, p) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); };
  const sorted = plays.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const p of sorted) {
    if (by === 'name') add('All plays, A to Z', p);
    else if (by === 'formation') add(p.formation || 'No formation', p);
    else {
      const tags = p.situation?.[by] || [];
      if (!tags.length) add('Not tagged', p); else for (const t of tags) add(t, p);
    }
  }
  let order = [...groups.keys()];
  const listed = by === 'distance' ? SITUATION.distance : by === 'down_distance' ? SITUATION.down_distance : by === 'play_type' ? [...SITUATION.play_type.O, ...SITUATION.play_type.D, ...SITUATION.play_type.S] : null;
  order.sort((a, b) => {
    if (a === 'Not tagged' || a === 'No formation') return 1; if (b === 'Not tagged' || b === 'No formation') return -1;
    if (listed) return listed.indexOf(a) - listed.indexOf(b);
    return a.localeCompare(b);
  });
  return order.map((k) => ({ key: k, plays: groups.get(k) }));
}

// ---------- the Route Menu library (PD-10) ----------
// Points are yards relative to a receiver standing one yard off the ball on the LEFT side of the formation:
// dx < 0 is toward the left sideline (outside), dy < 0 is upfield. D(dx, depth) puts a point `depth` yards past the line.
const D = (dx, depth, c) => (c ? [dx, -(depth + 1), 1] : [dx, -(depth + 1)]);
const B = (dx, dy, c) => (c ? [dx, dy, 1] : [dx, dy]); // backfield / line points, relative to the player
const R = (key, name, grp, pts, extra = {}) => ({ key: `lib:${key}`, name, grp, pts, type: 'route', smart: true, ...extra });
export const ROUTE_LIBRARY = [
  R('post', 'Post', 'Posts / Corners', [D(0, 10), D(5, 17)]), R('skinny', 'Skinny post', 'Posts / Corners', [D(0, 8), D(2.5, 16)]),
  R('corner', 'Corner', 'Posts / Corners', [D(0, 10), D(-5, 15)]), R('postcorner', 'Post-corner', 'Posts / Corners', [D(0, 7), D(2, 10), D(-4, 16)]),
  R('out', 'Out', 'Outs / Ins', [D(0, 10), D(-7, 10)]), R('qout', 'Quick out', 'Outs / Ins', [D(0, 5), D(-6, 5)]),
  R('dig', 'Dig', 'Outs / Ins', [D(0, 12), D(9, 12)]), R('sqin', 'Square in', 'Outs / Ins', [D(0, 6), D(8, 6)]), R('drag', 'Drag', 'Outs / Ins', [D(1.5, 1), D(15, 3)]),
  R('hitch', 'Hitch', 'Stops / Hitches', [D(0, 6), D(0.8, 5)]), R('curl', 'Curl', 'Stops / Hitches', [D(0, 12), D(1.5, 10)]),
  R('comeback', 'Comeback', 'Stops / Hitches', [D(0, 15), D(-2, 13)]), R('stick', 'Stick', 'Stops / Hitches', [D(0, 6), D(1.8, 6)]),
  R('slant', 'Slant', 'Slants', [D(0, 2), D(7, 8)]), R('qslant', 'Quick slant', 'Slants', [D(0, 1), D(5, 5)]), R('zslant', 'Slant and go', 'Slants', [D(0, 2), D(3, 5), D(3, 18)]),
  R('go', 'Go', 'Gos', [D(0, 20)]), R('fade', 'Fade', 'Gos', [D(0, 4), D(-3, 19)]), R('seam', 'Seam', 'Gos', [D(0.8, 3), D(0.8, 20)]), R('stutter', 'Stutter go', 'Gos', [D(0, 5), D(-0.6, 6), D(-0.6, 20)]),
  R('flat', 'Flat', 'Flats / Screens', [D(-1, 1), D(-7, 2)], { smart: false }), R('bubble', 'Bubble', 'Flats / Screens', [B(-1.5, 1, 1), B(-4, 0.4, 1), B(-7, -1, 1)], { smart: false }),
  R('wheel', 'Wheel', 'Flats / Screens', [B(-3, -0.5, 1), B(-5.5, -3, 1), B(-6, -16)], { smart: false }), R('arrow', 'Arrow', 'Flats / Screens', [B(-6, -4)], { smart: false }),
  R('base', 'Base block', 'Blocks', [B(0, -1.4)], { type: 'block', smart: false }), R('down', 'Down block', 'Blocks', [B(1.6, -1.1)], { type: 'block', smart: false }),
  R('reach', 'Reach block', 'Blocks', [B(-1.6, -1.1)], { type: 'block', smart: false }), R('pass', 'Pass set', 'Blocks', [B(0, 1.6)], { type: 'block', smart: false }),
  R('pull', 'Pull', 'Blocks', [B(0, 1.2), B(7, 1.2), B(9, -1.5)], { type: 'block', smart: false, abs: true }),
  // defense
  R('rush', 'Rush', 'Rushes', [B(0, 3)], { type: 'rush', smart: false, side: 'D' }), R('stuntin', 'Stunt inside', 'Rushes', [B(2, 1), B(2.4, 3)], { type: 'rush', smart: false, side: 'D' }),
  R('contain', 'Contain rush', 'Rushes', [B(-1.5, 1.5), B(-1, 4)], { type: 'rush', smart: false, side: 'D' }), R('blitz', 'Blitz', 'Rushes', [B(0, 6)], { type: 'rush', smart: false, side: 'D' }),
  R('deep3', 'Deep third', 'Coverage', [B(-1, -12)], { type: 'coverage', smart: false, side: 'D' }), R('deep2', 'Deep half', 'Coverage', [B(-4, -12)], { type: 'coverage', smart: false, side: 'D' }),
  R('hook', 'Hook / curl', 'Coverage', [B(1, -6)], { type: 'coverage', smart: false, side: 'D' }), R('flatz', 'Flat zone', 'Coverage', [B(-5, -3)], { type: 'coverage', smart: false, side: 'D' }),
  R('bail', 'Man (bail)', 'Coverage', [B(-0.5, -6)], { type: 'coverage', smart: false, side: 'D' }),
  // position-specific
  R('qb3', '3-step drop', 'Quarterback', [B(0, 3)], { pos: 'QB', smart: false, abs: true }), R('qb5', '5-step drop', 'Quarterback', [B(0, 5)], { pos: 'QB', smart: false, abs: true }),
  R('qb7', '7-step drop', 'Quarterback', [B(0, 7)], { pos: 'QB', smart: false, abs: true }), R('qbgun', 'Gun drop', 'Quarterback', [B(0, 2)], { pos: 'QB', smart: false, abs: true }),
  R('qbrollr', 'Rollout right', 'Quarterback', [B(2, 2, 1), B(6, 2.5, 1), B(10, 1, 1)], { pos: 'QB', smart: false, abs: true }),
  R('qbrolll', 'Rollout left', 'Quarterback', [B(-2, 2, 1), B(-6, 2.5, 1), B(-10, 1, 1)], { pos: 'QB', smart: false, abs: true }),
  R('qbboot', 'Boot', 'Quarterback', [B(2, 1), B(-3, 3, 1), B(-9, 1, 1)], { pos: 'QB', smart: false, abs: true }),
  R('rbswing', 'Swing', 'Running back', [B(-2, 0.5, 1), B(-5, -0.5, 1), B(-8, -2, 1)], { pos: 'RB', smart: false }),
  R('rbangle', 'Angle', 'Running back', [B(-2.5, -1), B(2, -6)], { pos: 'RB', smart: false }), R('rbcheck', 'Check release', 'Running back', [B(-2, -2), B(-1, -6)], { pos: 'RB', smart: false }),
  R('rbdive', 'Dive', 'Running back', [B(0, -8)], { pos: 'RB', smart: false, type: 'run', abs: true }),
  R('rbtoss', 'Toss sweep', 'Running back', [B(-4, 0, 1), B(-9, -2, 1), B(-11, -8, 1)], { pos: 'RB', smart: false, type: 'run' }),
  R('rbiz', 'Inside zone', 'Running back', [B(-1, -2), B(-2.5, -8)], { pos: 'RB', smart: false, type: 'run' }),
  R('rbcounter', 'Counter', 'Running back', [B(1, 0), B(-2.5, -2), B(-3.5, -8)], { pos: 'RB', smart: false, type: 'run' }),
];
export const LIB_GROUPS = ['Posts / Corners', 'Outs / Ins', 'Stops / Hitches', 'Slants', 'Gos', 'Flats / Screens', 'Blocks'];
export const DEF_GROUPS = ['Rushes', 'Coverage'];
export const TEMPLATE = { x: 50, y: VB.los + YDV }; // RT-1: the route designer's template player, one yard off the ball
// Custom routes are stored in yards relative to the template player; convert to the library format.
export const customToDef = (r) => ({ key: `custom:${r.id}`, name: r.name, grp: r.grp || 'Custom', pts: r.data.points, opts: r.data.opts || [], type: r.data.type || 'route', smart: !!r.smart, custom: true, side: r.side });

// Which position-specific group fits this player?
export function posGroup(p) {
  const pos = positionOf(p);
  const s = `${pos?.name || ''} ${pos?.abbr || ''} ${displayLetter(p)}`.toUpperCase();
  if (/\bQB\b|QUARTERBACK/.test(s)) return 'Quarterback';
  if (/\b(RB|HB|TB|FB|F|B)\b|RUNNING BACK|HALFBACK|FULLBACK|TAILBACK/.test(s)) return 'Running back';
  return null;
}

// Insert a route for a player (PD-10). Mirrors for players right of the ball (so "Out" breaks outside), then `flip`
// mirrors again. RT-2 Smart Distance: depths are measured from the line of scrimmage, so a player who starts deeper
// than one yard gets a vertical stem first.
export function buildRoute(def, p, { flip = false, ballX = 50 } = {}) {
  const auto = !def.abs && p.x > ballX + 0.5;
  const sx = (auto ? -1 : 1) * (flip ? -1 : 1);
  const downfield = def.pts.some((q) => q[1] < -1.2);
  let origin = [p.x, p.y]; const stem = [];
  if (def.smart && downfield) {
    const baseY = VB.los + YDV; // where the template player stands
    if (p.team !== 'D' && p.y > baseY + 0.3) stem.push([r1(p.x), r1(baseY)]);
    origin = [p.x, baseY];
  }
  const conv = (q) => [r1(clampX(origin[0] + sx * q[0] * YD)), r1(clampY(origin[1] + q[1] * YDV)), ...(q[2] ? [1] : [])];
  const path = [...stem, ...def.pts.map(conv)];
  const opts = (def.opts || []).map((o) => ({ id: uid('o'), parent: o.parent || 'primary', from: o.from ? conv(o.from).slice(0, 2) : path[path.length - 1].slice(0, 2), points: o.points.map(conv), type: o.type || def.type }));
  return { path, path_type: def.type || 'route', opts };
}
// Preview a route definition as a tiny SVG (Route Menu tiles).
export function routePreview(def, flip = false) {
  const p = { x: 50, y: TEMPLATE.y, team: def.side === 'D' ? 'D' : 'O' };
  const r = buildRoute(def, p, { flip, ballX: 60 });
  const all = [[p.x, p.y], ...r.path];
  const xs = all.map((q) => q[0]); const ys = all.map((q) => q[1]);
  const pad = 3; const minX = Math.min(...xs) - pad; const minY = Math.min(...ys) - pad;
  const w = Math.max(10, Math.max(...xs) - minX + pad); const h = Math.max(10, Math.max(...ys) - minY + pad);
  const s = Math.max(w, h);
  const pts = sampleRoute(all).map((q) => q.map((n) => Math.round(n * 10) / 10).join(',')).join(' ');
  const dash = def.type === 'coverage' ? 'stroke-dasharray="1.4 1"' : '';
  return `<svg viewBox="${r1(minX - (s - w) / 2)} ${r1(minY - (s - h) / 2)} ${r1(s)} ${r1(s)}" width="44" height="44" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="${s / 26}" ${dash} stroke-linejoin="round" stroke-linecap="round"/><circle cx="${p.x}" cy="${p.y}" r="${s / 16}" fill="currentColor"/></svg>`;
}

// ---------- formation helpers ----------
// PD-3: the Center (a position marked as center), else the first square offensive player.
export function findCenter(data) {
  const O = data.players.filter((p) => p.team === 'O');
  return O.find((p) => positionOf(p)?.is_center) || O.find((p) => p.position_id === undefined && p.label === 'C') || O.find((p) => (p.type || '').startsWith('square')) || null;
}
const moveAll = (p, dx, dy) => {
  const mv = (q) => [r1(q[0] + dx), r1(q[1] + dy), ...q.slice(2)];
  p.x = r1(p.x + dx); p.y = r1(p.y + dy);
  p.path = (p.path || []).map(mv); p.motion = (p.motion || []).map(mv);
  p.opts = (p.opts || []).map((o) => ({ ...o, from: o.from ? mv(o.from) : o.from, points: o.points.map(mv) }));
};
export const movePlayer = moveAll;
// Slide every player (and the ball) along the line so the ball lands anywhere between the hashes.
export function slideFormation(data, dx) {
  const bx = data.ball?.x ?? 50;
  const nx = Math.max(HASH[0], Math.min(HASH[1], bx + dx));
  const d = r1(nx - bx);
  if (!d) return 0;
  for (const p of data.players) moveAll(p, d, 0);
  if (data.ball) data.ball.x = r1(data.ball.x + d);
  for (const z of data.zones || []) z.x = r1(z.x + d);
  for (const t of data.texts || []) t.x = r1(t.x + d);
  return d;
}

// "Linemen Base": the front five, always first in the formation list (PD-13).
export function linemenBase(side, positions = []) {
  const find = (abbr) => positions.find((p) => p.side === (side === 'defense' ? 'D' : 'O') && p.abbr === abbr);
  if (side === 'defense') {
    return [['LE', 37, -2.2], ['LDT', 45, -2.2], ['RDT', 55, -2.2], ['RE', 63, -2.2]].map(([a, x, dy]) => ({ id: uid('d'), team: 'D', type: 'letter', position_id: find(a)?.id ?? null, label: a[a.length - 1], x, y: r1(VB.los + dy), path: [], opts: [] }));
  }
  return [['LT', 38], ['LG', 44], ['C', 50], ['RG', 56], ['RT', 62]].map(([a, x]) => ({ id: uid('o'), team: 'O', type: a === 'C' ? 'square_letter' : 'circle_letter', position_id: find(a)?.id ?? null, label: a, x, y: r1(VB.los + 1.6), path: [], opts: [] }));
}
// Apply a formation to one side of a play. mode: 'keep' (move matching players onto the formation's spots, keep routes),
// 'clear' (replace that side's players), 'name' (only record the formation name).
export function applyFormation(data, side, formation, players, mode) {
  const team = side === 'defense' ? 'D' : 'O';
  data.formations ||= {};
  data.formations[team] = formation ? { id: formation.id ?? null, name: formation.name } : null;
  if (mode === 'name' || !formation) return data;
  const bx = data.ball?.x ?? 50; const dx = bx - 50; // formations are stored with the ball in the middle
  const incoming = players.map((p) => { const q = normalizePlayer({ ...clone(p), id: uid(team.toLowerCase()), team, path: [], motion: [], opts: [] }); q.x = r1(q.x + dx); return q; });
  const mine = data.players.filter((p) => p.team === team);
  const others = data.players.filter((p) => p.team !== team);
  if (mode === 'clear' || !mine.length) { data.players = [...others, ...incoming]; return data; }
  // keep: match by position (then by letter), move the existing player and its routes to the formation spot
  const left = [...mine]; const placed = [];
  for (const f of incoming) {
    const i = left.findIndex((p) => (f.position_id != null && p.position_id === f.position_id) || (displayLetter(p) && displayLetter(p) === displayLetter(f)));
    if (i >= 0) { const p = left.splice(i, 1)[0]; moveAll(p, f.x - p.x, f.y - p.y); placed.push(p); } else placed.push(f);
  }
  data.players = [...others, ...placed, ...left];
  return data;
}
// Formation data saved from a play or the formation designer: one side, no routes, ball moved to the middle.
export function formationFromPlayers(players, ballX = 50) {
  return players.map((p) => { const q = clone(p); delete q.block_target; q.path = []; q.motion = []; q.opts = []; q.x = r1(q.x - (ballX - 50)); return q; });
}

// v1 players: give them the position whose letter matches their label (so Positions page edits reach them).
export function attachPositions(data, positions) {
  const ballX = data.ball?.x ?? 50;
  for (const p of data.players) {
    if (p.position_id !== undefined) continue;
    const side = p.team === 'D' ? 'D' : 'O';
    const cands = positions.filter((x) => x.side === side && x.letter && (x.letter === p.label || x.abbr === p.label));
    let pick = cands[0] || null;
    if (cands.length > 1) { const byName = cands.filter((c) => /^left/i.test(c.name) === (p.x < ballX)); pick = byName[0] || cands[0]; }
    p.position_id = pick ? pick.id : null;
    if (pick && (p.type === 'circle' || p.type === 'square')) p.type += '_letter';
  }
  return data;
}

// ---------- flips (PD-14, PD-15) ----------
const fx = (q) => [r1(100 - q[0]), ...q.slice(1)];
export function flipHorizontal(data, { smart = true, positions = [] } = {}) {
  for (const p of data.players) {
    p.x = r1(100 - p.x); p.path = (p.path || []).map(fx); p.motion = (p.motion || []).map(fx);
    p.opts = (p.opts || []).map((o) => ({ ...o, from: o.from ? fx(o.from) : o.from, points: o.points.map(fx) }));
  }
  if (data.ball) data.ball.x = r1(100 - data.ball.x);
  for (const z of data.zones || []) z.x = r1(100 - z.x - (z.w || 0));
  for (const t of data.texts || []) t.x = r1(100 - t.x);
  if (smart) smartSwap(data, positions);
  return data;
}
// Smart Flip: side-specific linemen keep their side. After mirroring, a left tackle stands where the right tackle was;
// swap position identities between mirror pairs so "LT" is on the left again, now carrying the mirrored assignment.
function smartSwap(data, positions) {
  const byId = new Map(positions.map((p) => [Number(p.id), p]));
  const LEGACY = { LT: 'RT', RT: 'LT', LG: 'RG', RG: 'LG', LE: 'RE', RE: 'LE', LDT: 'RDT', RDT: 'LDT', LDE: 'RDE', RDE: 'LDE', LOLB: 'ROLB', ROLB: 'LOLB' };
  for (const p of data.players) {
    const pos = p.position_id != null ? byId.get(Number(p.position_id)) : null;
    if (pos && pos.mirror_id && byId.has(Number(pos.mirror_id))) { p.position_id = Number(pos.mirror_id); const m = byId.get(Number(pos.mirror_id)); if (p.label === pos.letter) p.label = m.letter; continue; }
    if (!pos && LEGACY[p.label]) p.label = LEGACY[p.label];
  }
}
// Vertical flip: look at the play from the other side of the ball. Coordinates are unchanged, so assignments stay the same.
export const flipVertical = (data) => { data.view = data.view === 'defense' ? 'offense' : 'defense'; return data; };

// Freehand stroke -> curved route points: smooth (moving average) then simplify (Ramer-Douglas-Peucker).
export function smoothStroke(pts) {
  if (pts.length < 3) return pts.map((q) => [r1(q[0]), r1(q[1]), 1]);
  const sm = pts.map((q, i) => { const a = pts[Math.max(0, i - 2)]; const b = pts[Math.max(0, i - 1)]; const c = pts[Math.min(pts.length - 1, i + 1)]; const d = pts[Math.min(pts.length - 1, i + 2)]; return i === 0 || i === pts.length - 1 ? q : [(a[0] + b[0] + q[0] * 2 + c[0] + d[0]) / 6, (a[1] + b[1] + q[1] * 2 + c[1] + d[1]) / 6]; });
  const keep = rdp(sm, 0.45);
  return keep.slice(1).map((q) => [r1(q[0]), r1(q[1]), 1]);
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let idx = 0; let max = 0;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[1] - a[1]) * pts[i][0] - (b[0] - a[0]) * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
