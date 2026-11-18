// Play Designer (PD-1..PD-15), Formation designer (FM-1) and Route designer (RT-1, RT-2).
// One editor powers all three: eight player types placed from a palette under the field, drag or arrow-key moves
// (routes move with the player), Center drag slides the formation between the hashes, a player menu (position, type,
// color, shade), Route Mode with straight, curved, optional and motion routes, auto-blocking, the Route Menu,
// zones, text boxes, formation loading, flips with Smart Flip, undo and redo.
import { api } from './api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, confirmDialog, raw, esc } from './ui.js';
import { renderPlay, svgPoint, flipPt, normalizePlay, normalizePlayer, setPositions, positionOf, displayLetter, PLAYER_TYPES, COLOR_KEYS, colorHex, SHADES,
  PATH_TYPES, animator, sampleRoute, YD, YDV, VB } from './field.js';
import * as M from './pb-model.js';
import { contextMenu, closeMenu } from './pb-ui.js';
import { openExport } from './export.js';

const SIDE_TEAM = { offense: 'O', defense: 'D', special: 'O' };
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const COLOR_LABEL = { default: 'Default (white / black)', blue: 'Blue', red: 'Red', green: 'Green', orange: 'Orange', purple: 'Purple', yellow: 'Yellow' };
const RM_LABEL = { straight: 'Straight', curved: 'Curved', optional: 'Optional', motion: 'Motion' };
const RM_HELP = {
  straight: 'Straight: click a player, then click points on the field. Each click adds a segment.',
  curved: 'Curved: click a player, then press and drag to draw. The line smooths when you let go.',
  optional: 'Optional: click a player, then click on one of its routes to branch a dashed option. Esc starts another branch.',
  motion: 'Motion: click a player, then click points for pre-snap motion.',
};
let THEME = 'grass';
try { THEME = localStorage.getItem('pb.theme') || 'grass'; } catch { /* storage blocked */ }

function tileSvg(type, team) {
  const base = type.replace('_letter', ''); const letter = type.endsWith('letter') ? (team === 'D' ? 'D' : 'A') : '';
  const st = 'fill="var(--panel)" stroke="currentColor" stroke-width="1.6"';
  let s = '';
  if (base === 'circle') s = `<circle cx="12" cy="12" r="8" ${st}/>`;
  else if (base === 'square') s = `<rect x="4.5" y="4.5" width="15" height="15" rx="1" ${st}/>`;
  else if (base === 'triangle') s = team === 'D' ? `<polygon points="12,20 3.5,5.5 20.5,5.5" ${st} stroke-linejoin="round"/>` : `<polygon points="12,4 3.5,18.5 20.5,18.5" ${st} stroke-linejoin="round"/>`;
  else if (base === 'x') s = '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
  if (type === 'letter') s = `<text x="12" y="17" font-size="14" font-weight="800" text-anchor="middle" fill="currentColor" font-family="Arial">${team === 'D' ? 'D' : 'A'}</text>`;
  else if (letter) s += `<text x="12" y="${base === 'triangle' ? (team === 'D' ? 13 : 16.5) : 15.5}" font-size="${base === 'triangle' ? 7 : 9}" font-weight="700" text-anchor="middle" fill="currentColor" font-family="Arial">${letter}</text>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${s}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------
// createEditor(host, opts) -> controller
// opts: { data, mode: 'play'|'formation'|'route', positions, customRoutes, prefs, selEl, side, lockId, onChange }
export function createEditor(host, opts) {
  const mode = opts.mode || 'play';
  const positions = opts.positions || [];
  const S = {
    data: opts.data, sel: null, rm: mode === 'route' ? 'straight' : null, target: null, theme: THEME, smartFlip: true,
    team: mode === 'formation' ? SIDE_TEAM[opts.side] || 'O' : 'O', undo: [], redo: [], pending: null, drag: null, stroke: null, blockCand: null,
  };
  S.last = JSON.stringify(S.data);
  if (mode === 'route') S.sel = { kind: 'player', id: opts.lockId };
  const allowRoutes = mode !== 'formation';
  const allowExtras = mode === 'play';
  set(host, html`<div class="pbd" id="pbd">
    <div class="pbd-bar" role="toolbar" aria-label="Designer tools">
      ${mode !== 'route' ? html`<button data-act="select" title="Select and move (Route Mode off)">Select</button>` : ''}
      ${allowRoutes ? html`<span class="sep"></span><span class="rm-state" id="rmstate" aria-live="polite">Route Mode: OFF</span>
        ${['straight', 'curved', 'optional', ...(mode === 'play' ? ['motion'] : [])].map((k) => html`<button data-rm="${k}" aria-pressed="false" title="${RM_HELP[k]}">${RM_LABEL[k]}</button>`)}
        <select id="rtype" style="width:auto" aria-label="Route type">${options(PATH_TYPES.map((x) => [x, x[0].toUpperCase() + x.slice(1)]))}</select>
        ${mode === 'play' ? html`<button data-act="routes" title="Route Menu for the selected player">Route menu</button>` : ''}` : ''}
      <span class="sep"></span>
      <button data-act="undo" title="Undo (Ctrl+Z)">Undo</button><button data-act="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
      <span class="spacer" style="flex:1"></span>
      ${mode !== 'route' ? html`<button data-act="fliph" title="Show the play to the other side">Flip</button>
        <label class="check" title="Tackles, guards and defensive linemen stay on their side; assignments swap"><input type="checkbox" id="smartflip" checked> <span class="lbl">Smart flip</span></label>
        ${mode === 'play' ? html`<button data-act="flipv" title="Look from the other side of the ball">Flip view</button>` : ''}` : ''}
      <div class="seg" aria-label="Field theme"><button data-theme="grass">Grass</button><button data-theme="paper">Paper</button></div>
    </div>
    <div class="field-wrap pbd-field" id="fw" tabindex="0" aria-label="Field. Arrow keys move the selected item; Shift moves further; Delete removes it."></div>
    ${mode !== 'route' ? html`<div class="pbd-pal" id="pal" aria-label="Palette">
      ${mode === 'play' ? html`<div class="seg" aria-label="Team"><button data-team="O">Offense</button><button data-team="D">Defense</button></div>` : ''}
      <span id="tiles"></span>
      ${allowExtras ? html`<span class="sep" style="width:1px;align-self:stretch;background:var(--line)"></span>
        <button class="tile" data-pal="zone" data-shape="rect" title="Square zone"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1.5" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.5"/></svg></button>
        <button class="tile" data-pal="zone" data-shape="oval" title="Oval zone"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="6.5" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.5"/></svg></button>
        <button class="tile" data-pal="text" title="Text box"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><text x="12" y="15.5" font-size="9" font-weight="700" text-anchor="middle" fill="currentColor" font-family="Arial">Aa</text></svg></button>` : ''}
      <span class="faint" style="font-size:12px">Drag onto the field, or tap a tile and then the field.</span>
    </div>` : ''}
    <div class="pbd-status" id="st" aria-live="polite"></div>
  </div>`);
  const root = $('#pbd', host); const fw = $('#fw', host); const st = $('#st', host);
  const svg = () => fw.querySelector('svg');
  const flipped = () => S.data.view === 'defense';
  const P = (e) => flipPt(svgPoint(svg(), e), flipped());
  const byId = (id) => S.data.players.find((p) => p.id === id);
  const selPlayer = () => (S.sel?.kind === 'player' ? byId(S.sel.id) : null);
  const status = (msg) => { st.textContent = msg || (S.rm ? RM_HELP[S.rm] : mode === 'formation' ? 'Drag players from the palette. Drag the center to slide the formation between the hashes.' : 'Select mode: drag players to move them (their routes move too). Right-click a player for its menu.'); };

  const drawTiles = () => {
    const t = $('#tiles', host); if (!t) return;
    t.innerHTML = PLAYER_TYPES.map(([k, l]) => `<button class="tile${S.pending?.type === k ? ' on' : ''}" data-pal="player" data-type="${k}" title="${esc(l)} (${S.team === 'D' ? 'defense' : 'offense'})">${tileSvg(k, S.team)}</button>`).join('');
    $$('[data-team]', host).forEach((b) => b.classList.toggle('on', b.dataset.team === S.team));
  };
  function draw(t = null) {
    const p = selPlayer();
    let extra = '';
    if (S.stroke && S.stroke.length > 1) extra = `<polyline points="${S.stroke.map((q) => flipPt(q, flipped()).join(',')).join(' ')}" fill="none" stroke="#ffd666" stroke-width="0.5" stroke-dasharray="0.8 0.5" stroke-linecap="round"/>`;
    if (S.rm === 'optional' && p && !S.target) extra += `<text x="50" y="2.6" font-size="1.8" text-anchor="middle" fill="${S.theme === 'paper' ? '#2457c5' : '#ffd666'}" font-family="Arial">Click one of the selected player's routes to branch</text>`;
    fw.innerHTML = renderPlay(S.data, {
      t, theme: S.theme, selected: p?.id, picked: S.blockCand?.from && S.rm ? S.blockCand.from : null, locked: opts.lockId,
      editor: { selZone: S.sel?.kind === 'zone' ? S.sel.id : null, selText: S.sel?.kind === 'text' ? S.sel.id : null, selRoute: S.target }, extra,
    });
    root.classList.toggle('route-on', !!S.rm);
    const rs = $('#rmstate', host); if (rs) rs.textContent = `Route Mode: ${S.rm ? 'ON' : 'OFF'}`;
    $$('[data-rm]', host).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rm === S.rm)));
    const sb = $('[data-act=select]', host); if (sb) sb.setAttribute('aria-pressed', String(!S.rm));
    $$('[data-theme]', host).forEach((b) => b.classList.toggle('on', b.dataset.theme === S.theme));
    const ub = $('[data-act=undo]', host); if (ub) ub.disabled = !S.undo.length;
    const rb = $('[data-act=redo]', host); if (rb) rb.disabled = !S.redo.length;
    const rt = $('#rtype', host);
    if (rt && document.activeElement !== rt) rt.value = currentType() || (p?.team === 'D' ? 'coverage' : 'route');
  }
  let raf = null;
  const redraw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = null; draw(); }); };
  function commit() {
    const s = JSON.stringify(S.data);
    if (s !== S.last) { S.undo.push(S.last); if (S.undo.length > 80) S.undo.shift(); S.last = s; S.redo = []; opts.onChange?.(); }
    draw(); drawSel();
  }
  const restore = (s) => { S.data = JSON.parse(s); S.last = s; if (S.sel && !findSel()) S.sel = mode === 'route' ? S.sel : null; S.target = null; draw(); drawSel(); opts.onChange?.(); };
  const undo = () => { if (!S.undo.length) return; S.redo.push(S.last); restore(S.undo.pop()); };
  const redo = () => { if (!S.redo.length) return; S.undo.push(S.last); restore(S.redo.pop()); };
  const findSel = () => (S.sel?.kind === 'player' ? byId(S.sel.id) : S.sel?.kind === 'zone' ? S.data.zones.find((z) => z.id === S.sel.id) : S.sel?.kind === 'text' ? S.data.texts.find((x) => x.id === S.sel.id) : null);
  const select = (sel) => { S.sel = sel; if (!sel || sel.kind !== 'player') S.target = null; draw(); drawSel(); };

  // ---------- routes ----------
  function routeOf(p, rid) {
    if (rid === 'primary') return { pts: p.path, set: (v) => { p.path = v; }, start: p.motion?.length ? p.motion[p.motion.length - 1] : [p.x, p.y] };
    if (rid === 'motion') return { pts: p.motion, set: (v) => { p.motion = v; }, start: [p.x, p.y] };
    const o = (p.opts || []).find((x) => x.id === rid);
    return o ? { pts: o.points, set: (v) => { o.points = v; }, start: o.from, opt: o } : null;
  }
  function currentType() {
    const p = selPlayer(); if (!p || !S.target) return p?.path_type;
    if (S.target.rid === 'primary') return p.path_type;
    const o = (p.opts || []).find((x) => x.id === S.target.rid); return o?.type || p.path_type;
  }
  function targetFor(p) {
    if (S.rm === 'motion') return { pid: p.id, rid: 'motion' };
    if (S.rm === 'optional') return null;
    return { pid: p.id, rid: 'primary' };
  }
  function addPoints(pts) {
    const p = selPlayer(); if (!p || !S.target) return;
    const r = routeOf(p, S.target.rid); if (!r) return;
    if (S.target.rid === 'primary' && p.block_target) { delete p.block_target; p.path = []; }
    r.set([...(r.pts || []), ...pts.map((q) => [M.r1(M.clampX(q[0])), M.r1(M.clampY(q[1])), ...q.slice(2)])]);
    if (S.target.rid === 'primary' && !p.path_type) p.path_type = p.team === 'D' ? 'coverage' : 'route';
    commit();
  }
  // Nearest point on any of this player's routes (to branch an optional route from it).
  function nearestOnRoutes(p, dp) {
    let best = null;
    const test = (rid, P) => {
      const s = sampleRoute(P);
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]; const b = s[i]; const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
        const k = Math.max(0, Math.min(1, ((dp[0] - a[0]) * (b[0] - a[0]) + (dp[1] - a[1]) * (b[1] - a[1])) / L2));
        const q = [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])]; const d = near(q, dp);
        if (d < 2.8 && (!best || d < best.d)) best = { d, rid, pt: [M.r1(q[0]), M.r1(q[1])] };
      }
    };
    const start = p.motion?.length ? p.motion[p.motion.length - 1] : [p.x, p.y];
    if (p.path?.length) test('primary', [start, ...p.path]);
    for (const o of p.opts || []) if (o.points?.length) test(o.id, [o.from, ...o.points]);
    return best;
  }
  function makeBlock(fromId, toId) {
    const a = byId(fromId); const b = byId(toId); if (!a || !b) return;
    a.path = [[b.x, b.y]]; a.path_type = 'block'; a.block_target = b.id; a.opts = [];
    S.sel = { kind: 'player', id: a.id }; S.target = null; S.blockCand = null;
    commit(); status(`${displayLetter(a) || 'Player'} blocks ${displayLetter(b) || 'the defender'}.`);
  }
  function clearRoutes(p) { p.path = []; p.motion = []; p.opts = []; delete p.block_target; S.target = S.rm ? targetFor(p) : null; commit(); }

  // ---------- adding and deleting ----------
  function addItem(item, dp) {
    const [x, y] = [M.r1(M.clampX(dp[0])), M.r1(M.clampY(dp[1]))];
    if (item.pal === 'player') {
      const team = mode === 'formation' ? SIDE_TEAM[opts.side] || 'O' : S.team;
      const p = normalizePlayer({ id: M.uid(team.toLowerCase()), team, type: item.type, label: '', position_id: null, color: 'default', shade: '', x, y, path: [], path_type: team === 'D' ? 'coverage' : 'route', delay: 0, motion: [], opts: [] });
      S.data.players.push(p); S.sel = { kind: 'player', id: p.id };
    } else if (item.pal === 'zone') {
      const z = { id: M.uid('z'), shape: item.shape === 'oval' ? 'oval' : 'rect', x: M.r1(Math.max(0, x - 6)), y: M.r1(Math.max(0, y - 4)), w: 12, h: 8, color: 'yellow' };
      S.data.zones.push(z); S.sel = { kind: 'zone', id: z.id };
    } else if (item.pal === 'text') {
      const t = { id: M.uid('t'), x, y, text: 'Note' };
      S.data.texts.push(t); S.sel = { kind: 'text', id: t.id };
    }
    S.pending = null; drawTiles(); commit(); status();
    if (item.pal === 'text') setTimeout(() => { const ta = opts.selEl?.querySelector('[data-k=text]'); if (ta) { ta.focus(); ta.select(); } }, 30);
  }
  function deleteSel() {
    const s = S.sel; if (!s) return;
    if (s.kind === 'player') {
      if (s.id === opts.lockId) return;
      S.data.players = S.data.players.filter((p) => p.id !== s.id);
      for (const p of S.data.players) if (p.block_target === s.id) { delete p.block_target; p.path = []; }
    } else if (s.kind === 'zone') S.data.zones = S.data.zones.filter((z) => z.id !== s.id);
    else if (s.kind === 'text') S.data.texts = S.data.texts.filter((t) => t.id !== s.id);
    S.sel = null; S.target = null; commit();
  }
  function nudge(dx, dy) {
    const s = S.sel; if (!s) return;
    if (s.kind === 'player') {
      const p = byId(s.id); if (!p || p.id === opts.lockId) return;
      if (M.findCenter(S.data)?.id === p.id) M.slideFormation(S.data, dx);
      else M.movePlayer(p, Math.max(-p.x + 0.8, Math.min(VB.w - 0.8 - p.x, dx)), Math.max(-p.y + 0.8, Math.min(VB.h - 0.8 - p.y, dy)));
    } else { const o = findSel(); if (o) { o.x = M.r1(o.x + dx); o.y = M.r1(o.y + dy); } }
    commit();
  }

  // ---------- pointer interaction on the field ----------
  fw.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    closeMenu();
    const dp = P(e);
    const el = e.target;
    const hit = (sel) => el.closest(sel);
    const zt = hit('[data-zone-trash]'); if (zt) { S.sel = { kind: 'zone', id: zt.dataset.zoneTrash }; deleteSel(); return; }
    const tt = hit('[data-text-trash]'); if (tt) { S.sel = { kind: 'text', id: tt.dataset.textTrash }; deleteSel(); return; }
    const zh = hit('[data-zone-handle]');
    if (zh) {
      const z = S.data.zones.find((q) => q.id === zh.dataset.zoneHandle);
      const anchor = flipped() ? [z.x + z.w, z.y + z.h] : [z.x, z.y];
      S.drag = { kind: 'zone-resize', z, anchor }; fw.setPointerCapture(e.pointerId); return;
    }
    const g = hit('[data-player]'); const hp = g ? byId(g.dataset.player) : null;
    // Double-click detection by hand: the field re-renders on each press, so the browser's dblclick loses its target.
    const now = Date.now(); const tHit = hit('[data-text]');
    const key2 = hp ? `p:${hp.id}` : tHit ? `t:${tHit.dataset.text}` : null;
    const dbl = key2 && S.lastDown && S.lastDown.key === key2 && now - S.lastDown.at < 450;
    S.lastDown = { key: key2, at: now };
    if (dbl && hp && S.rm && S.blockCand && S.blockCand.to === hp.id && now - S.blockCand.at < 1500) { makeBlock(S.blockCand.from, S.blockCand.to); return; }
    if (dbl && tHit) { S.sel = { kind: 'text', id: tHit.dataset.text }; draw(); drawSel(); setTimeout(() => opts.selEl?.querySelector('[data-k=text]')?.focus(), 20); return; }
    if (S.rm) {
      const cur = selPlayer();
      if (hp && (mode !== 'route' || hp.id === opts.lockId)) {
        if (S.rm === 'curved' && cur && hp.id === cur.id) { S.target ||= targetFor(cur); if (S.target) { S.stroke = [routeEnd(cur), dp]; fw.setPointerCapture(e.pointerId); } return; }
        if (cur && cur.id !== hp.id && cur.team === 'O' && hp.team === 'D' && S.rm !== 'motion') S.blockCand = { from: cur.id, to: hp.id, at: Date.now() };
        else if (!cur || cur.id !== hp.id) S.blockCand = null;
        S.sel = { kind: 'player', id: hp.id }; S.target = targetFor(hp); draw(); drawSel(); status(); return;
      }
      if (!cur) { status('Select a player first, then draw its route.'); return; }
      if (S.rm === 'optional' && !S.target) {
        const n = nearestOnRoutes(cur, dp);
        if (!n) { status('Click on one of this player’s routes to branch an optional route from it.'); return; }
        const o = { id: M.uid('o'), parent: n.rid, from: n.pt, points: [], type: cur.path_type === 'block' ? 'route' : cur.path_type };
        cur.opts = [...(cur.opts || []), o]; S.target = { pid: cur.id, rid: o.id }; draw(); status('Now click where the optional route goes. Esc to finish.'); return;
      }
      if (!S.target) S.target = targetFor(cur);
      if (S.rm === 'curved') { S.stroke = [routeEnd(cur), dp]; fw.setPointerCapture(e.pointerId); return; }
      addPoints([dp]); return;
    }
    // Select mode
    if (hp) {
      S.sel = { kind: 'player', id: hp.id };
      if (hp.id !== opts.lockId) { S.drag = { kind: 'player', id: hp.id, last: dp, moved: false, center: M.findCenter(S.data)?.id === hp.id }; fw.setPointerCapture(e.pointerId); }
      draw(); drawSel(); return;
    }
    const tb = hit('[data-text-border]') || hit('[data-text]');
    if (tb) { const id = tb.dataset.textBorder || tb.dataset.text; S.sel = { kind: 'text', id }; if (tb.dataset.textBorder) { S.drag = { kind: 'move', last: dp }; fw.setPointerCapture(e.pointerId); } draw(); drawSel(); return; }
    const zg = hit('[data-zone]');
    if (zg) { S.sel = { kind: 'zone', id: zg.dataset.zone }; S.drag = { kind: 'move', last: dp }; fw.setPointerCapture(e.pointerId); draw(); drawSel(); return; }
    if (S.pending) { addItem(S.pending, dp); return; }
    select(null); status();
  });
  const routeEnd = (p) => { const r = routeOf(p, S.target?.rid || 'primary'); return (r && r.pts?.length ? r.pts[r.pts.length - 1] : r?.start || [p.x, p.y]).slice(0, 2); };
  fw.addEventListener('pointermove', (e) => {
    if (S.stroke) { const dp = P(e); if (near(dp, S.stroke[S.stroke.length - 1]) > 0.5) { S.stroke.push(dp); redraw(); } return; }
    const d = S.drag; if (!d) return;
    const dp = P(e);
    if (d.kind === 'zone-resize') {
      const z = d.z; const [ax, ay] = d.anchor;
      z.x = M.r1(Math.min(ax, dp[0])); z.y = M.r1(Math.min(ay, dp[1])); z.w = M.r1(Math.max(2, Math.abs(dp[0] - ax))); z.h = M.r1(Math.max(2, Math.abs(dp[1] - ay)));
      redraw(); return;
    }
    const dx = dp[0] - d.last[0]; const dy = dp[1] - d.last[1];
    if (Math.abs(dx) + Math.abs(dy) < 0.05) return;
    if (d.kind === 'player') {
      const p = byId(d.id);
      if (d.center) { const moved = M.slideFormation(S.data, dx); d.last = [d.last[0] + moved, d.last[1]]; d.moved ||= !!moved; redraw(); return; }
      M.movePlayer(p, dx, dy); d.moved = true;
    } else if (d.kind === 'move') { const o = findSel(); if (o) { o.x = M.r1(o.x + dx); o.y = M.r1(o.y + dy); } }
    d.last = dp; redraw();
  });
  const endPointer = () => {
    if (S.stroke) {
      const s = S.stroke; S.stroke = null;
      const len = s.slice(1).reduce((a, q, i) => a + near(s[i], q), 0);
      if (len < 1.5) addPoints([s[s.length - 1]]); else addPoints(M.smoothStroke(s));
      return;
    }
    if (S.drag) { const d = S.drag; S.drag = null; if (d.kind !== 'player' || d.moved) commit(); }
  };
  fw.addEventListener('pointerup', endPointer); fw.addEventListener('pointercancel', endPointer);
  fw.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const g = e.target.closest('[data-player]'); const hp = g ? byId(g.dataset.player) : selPlayer();
    if (!hp) return;
    S.sel = { kind: 'player', id: hp.id }; draw(); drawSel();
    if (S.rm && allowRoutes) openRouteMenu(hp); else if (mode !== 'route') openPlayerMenu(hp, e.clientX, e.clientY);
  });

  // ---------- toolbar ----------
  on(root, 'click', '[data-rm]', (e, b) => { S.rm = S.rm === b.dataset.rm ? null : b.dataset.rm; if (mode === 'route' && !S.rm) S.rm = b.dataset.rm; const p = selPlayer(); S.target = S.rm && p ? targetFor(p) : null; S.blockCand = null; S.pending = null; drawTiles(); draw(); status(); });
  on(root, 'click', '[data-act]', (e, b) => {
    const a = b.dataset.act;
    if (a === 'select') { S.rm = null; S.target = null; draw(); status(); }
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'fliph') { M.flipHorizontal(S.data, { smart: S.smartFlip, positions }); commit(); status(S.smartFlip ? 'Flipped. Linemen kept their sides; their assignments swapped.' : 'Flipped.'); }
    if (a === 'flipv') { M.flipVertical(S.data); commit(); status(S.data.view === 'defense' ? 'Showing the defense’s view.' : 'Showing the offense’s view.'); }
    if (a === 'routes') { const p = selPlayer(); if (p) openRouteMenu(p); else status('Select a player first.'); }
  });
  on(root, 'click', '[data-theme]', (e, b) => { S.theme = b.dataset.theme; THEME = S.theme; try { localStorage.setItem('pb.theme', S.theme); } catch { /* ignore */ } draw(); });
  on(root, 'click', '[data-team]', (e, b) => { S.team = b.dataset.team; drawTiles(); });
  const sf = $('#smartflip', host); if (sf) sf.onchange = () => { S.smartFlip = sf.checked; };
  const rt = $('#rtype', host);
  if (rt) rt.onchange = () => {
    const p = selPlayer(); if (!p) return;
    if (!S.target || S.target.rid === 'primary') p.path_type = rt.value; else if (S.target.rid !== 'motion') { const o = p.opts.find((x) => x.id === S.target.rid); if (o) o.type = rt.value; }
    commit();
  };

  // ---------- palette (drag or tap-to-place) ----------
  const pal = $('#pal', host);
  if (pal) {
    pal.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('[data-pal]'); if (!t) return;
      e.preventDefault();
      const item = { ...t.dataset }; const start = [e.clientX, e.clientY]; let moved = false;
      const ghost = document.createElement('div'); ghost.className = 'pbd-ghost'; ghost.innerHTML = t.innerHTML;
      const mv = (ev) => { if (!moved && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 5) { moved = true; document.body.appendChild(ghost); } ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; };
      const up = (ev) => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ghost.remove();
        const r = fw.getBoundingClientRect();
        if (moved && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { S.rm = null; S.target = null; addItem(item, P(ev)); }
        else if (!moved) { S.pending = S.pending && S.pending.type === item.type && S.pending.pal === item.pal && S.pending.shape === item.shape ? null : item; S.rm = null; drawTiles(); draw(); status(S.pending ? 'Now click the field to place it.' : ''); }
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    pal.addEventListener('keydown', (e) => { const t = e.target.closest('[data-pal]'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); addItem({ ...t.dataset }, [50, S.team === 'D' ? 22 : 38]); } });
  }

  // ---------- keyboard ----------
  const key = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', key); return; }
    if (document.querySelector('.modal-bg, .pb-menu')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') {
      if (S.pending) { S.pending = null; drawTiles(); } else if (S.target && S.rm) S.target = null; else if (mode !== 'route') select(null);
      draw(); status(S.rm && selPlayer() ? (S.rm === 'optional' ? 'Click a route of the selected player to branch another option.' : 'Route finished. Click the field to start a new segment from its end.') : ''); return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); deleteSel(); return; }
    const step = e.shiftKey ? 2.5 : 0.5; const f = flipped() ? -1 : 1;
    const mv = { ArrowLeft: [-step * f, 0], ArrowRight: [step * f, 0], ArrowUp: [0, -step * f], ArrowDown: [0, step * f] }[e.key];
    if (mv && S.sel) { e.preventDefault(); nudge(mv[0], mv[1]); }
  };
  document.addEventListener('keydown', key);

  // ---------- player menu (PD-4) ----------
  const sideOf = (p) => (p.team === 'D' ? 'D' : 'O');
  function playerFields(p) {
    const pos = positionOf(p);
    const plist = positions.filter((x) => x.side === sideOf(p));
    const letterType = (p.type || '').includes('letter');
    return html`<div data-pfields="${p.id}">
      ${field('Position', html`<select data-k="position_id"><option value="">No position</option>${plist.map((x) => html`<option value="${x.id}" ${pos && Number(pos.id) === Number(x.id) ? raw('selected') : ''}>${x.name}${x.letter ? ` (${x.letter})` : ''}</option>`)}</select>`)}
      ${field('Type', html`<select data-k="type">${options(PLAYER_TYPES, p.type)}</select>`)}
      ${field('Color', html`<select data-k="color" ${pos ? raw('disabled') : ''}>${options(COLOR_KEYS.map((k) => [k, COLOR_LABEL[k]]), pos ? pos.color : (p.color || 'default'))}</select>`, pos ? 'Set by the position, so it matches the Positions page.' : '')}
      ${!pos && letterType ? field('Letter', html`<input data-k="label" maxlength="3" value="${p.label || ''}">`) : ''}
      ${field('Shade', html`<select data-k="shade">${options(SHADES, p.shade || '')}</select>`, 'A marker for play concepts (for example, which half a defender plays).')}
      ${mode === 'play' ? field('Start delay (seconds)', html`<input type="number" step="0.1" min="0" data-k="delay" value="${p.delay || 0}">`) : ''}
    </div>`;
  }
  function applyField(p, k, v) {
    if (k === 'position_id') {
      const pos = positions.find((x) => String(x.id) === String(v));
      p.position_id = pos ? pos.id : null;
      if (pos) { p.label = pos.letter || p.label; p.color = pos.color || 'default'; if (['circle', 'square', 'triangle'].includes(p.type)) p.type += '_letter'; }
    } else if (k === 'delay') p.delay = Number(v) || 0;
    else if (k === 'label') p.label = String(v).slice(0, 3);
    else p[k] = v;
  }
  function openPlayerMenu(p, x, y) {
    const box = document.createElement('div');
    box.innerHTML = String(playerFields(p).__html) + `<hr>${allowRoutes ? '<button data-pm="routes">Route menu…</button><button data-pm="clear">Clear routes</button>' : ''}<button data-pm="delete" class="danger">Delete player</button>`;
    box.querySelector('[data-pfields]').classList.add('fields'); box.querySelector('[data-pfields]').style.display = 'block'; box.style.minWidth = '240px';
    box.addEventListener('change', (e) => { const k = e.target.dataset.k; if (!k) return; applyField(p, k, e.target.value); commit(); openPlayerMenu(p, x, y); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pm]'); if (!b) return;
      closeMenu();
      if (b.dataset.pm === 'routes') openRouteMenu(p);
      if (b.dataset.pm === 'clear') clearRoutes(p);
      if (b.dataset.pm === 'delete') { S.sel = { kind: 'player', id: p.id }; deleteSel(); }
    });
    const m = contextMenu(x, y, box, { label: 'Player menu' }); m.style.minWidth = '250px';
  }

  // ---------- Route Menu (PD-10) ----------
  async function openRouteMenu(p) {
    if (mode === 'route') return;
    const isD = p.team === 'D';
    const custom = (opts.customRoutes || []).filter((r) => (r.side || 'O') === (isD ? 'D' : 'O')).map(M.customToDef);
    const lib = M.ROUTE_LIBRARY.filter((r) => (r.side || 'O') === (isD ? 'D' : 'O'));
    const all = new Map([...lib, ...custom].map((d) => [d.key, d]));
    const pg = isD ? null : M.posGroup(p);
    const recent = (opts.prefs?.recent_routes || []).map((k) => all.get(k)).filter(Boolean);
    const groups = [
      ...(recent.length ? [['Recently used', recent]] : []),
      ...(pg ? [[pg, lib.filter((r) => r.grp === pg)]] : []),
      ...(isD ? M.DEF_GROUPS : M.LIB_GROUPS).map((g) => [g, lib.filter((r) => r.grp === g && !r.pos)]),
      ...(!pg && !isD ? [['Quarterback', lib.filter((r) => r.grp === 'Quarterback')], ['Running back', lib.filter((r) => r.grp === 'Running back')]] : []),
      ['Custom routes', custom],
    ];
    let flip = false;
    const body = () => html`<div class="row" style="margin-bottom:10px"><button id="rflip" aria-pressed="${flip}">Flip ${flip ? 'on' : 'off'}</button><span class="muted" style="font-size:12px">Mirror the route before inserting it. Routes already break outside for players on the right.</span></div>
      ${groups.map(([g, list]) => html`<div class="pb-group" style="margin-top:6px">${g}</div>${list.length ? html`<div class="rt-grid">${list.map((d) => html`<button data-rk="${d.key}" title="${d.name}">${raw(M.routePreview(d, flip !== (!d.abs && p.x > (S.data.ball?.x ?? 50) + 0.5)))}<span>${d.name}</span></button>`)}</div>` : html`<p class="muted" style="font-size:12px">${g === 'Custom routes' ? 'No custom routes yet. Make them on the Routes page.' : 'None yet.'}</p>`}`)}`;
    const m = modal({ title: `Route menu: ${displayLetter(p) || 'player'}`, wide: true, body: html`<div id="rmb">${body()}</div>`, actions: [{ label: 'Close' }] });
    const rmb = m.root.querySelector('#rmb');
    rmb.addEventListener('click', (e) => {
      if (e.target.closest('#rflip')) { flip = !flip; set(rmb, body()); return; }
      const b = e.target.closest('[data-rk]'); if (!b) return;
      const d = all.get(b.dataset.rk);
      const r = M.buildRoute(d, p, { flip, ballX: S.data.ball?.x ?? 50 });
      p.path = r.path; p.path_type = r.path_type; p.opts = r.opts; delete p.block_target;
      S.sel = { kind: 'player', id: p.id }; S.target = S.rm ? targetFor(p) : null;
      commit(); m.close();
      if (opts.prefs) opts.prefs.recent_routes = [d.key, ...(opts.prefs.recent_routes || []).filter((k) => k !== d.key)].slice(0, 8);
      api.put('/api/pb/prefs', { recent_route: d.key }).catch(() => {});
      status(`${d.name} added for ${displayLetter(p) || 'the player'}.`);
    });
  }

  // ---------- selection panel ----------
  function drawSel() {
    const el = opts.selEl; if (!el) return;
    const s = S.sel; const o = findSel();
    if (!s || !o) { set(el, html`<p class="muted">${mode === 'formation' ? 'Select a player to set its position and type.' : 'Select a player, zone or text box. Right-click a player for its menu.'}</p>`); return; }
    if (s.kind === 'player') {
      const locked = o.id === opts.lockId;
      set(el, locked ? html`<p class="muted">The template player stays in the middle of the field. Draw the route from it.</p>` : html`${playerFields(o)}
        <div class="row">${allowRoutes ? html`<button class="sm" data-sa="routes">Route menu</button><button class="sm" data-sa="clear">Clear routes</button>` : ''}<button class="sm danger" data-sa="delete">Delete</button></div>
        ${allowRoutes ? html`<div class="s muted" style="margin-top:6px;font-size:12px">${o.path?.length || 0} route points · ${(o.opts || []).length} optional · ${o.motion?.length || 0} motion points${o.block_target ? ' · blocking' : ''}</div>` : ''}`);
    } else if (s.kind === 'zone') {
      set(el, html`${field('Shape', html`<select data-zk="shape">${options([['rect', 'Square'], ['oval', 'Oval']], o.shape)}</select>`)}${field('Color', html`<select data-zk="color">${options(COLOR_KEYS.filter((k) => k !== 'default').map((k) => [k, COLOR_LABEL[k]]), o.color)}</select>`)}
        <p class="help">Drag to move. Resize from the bottom-right handle.</p><button class="sm danger" data-sa="delete">Delete zone</button>`);
    } else if (s.kind === 'text') {
      set(el, html`${field('Text', html`<textarea data-k="text" rows="3">${o.text}</textarea>`, 'The box grows with the text. Drag it by its border.')}<button class="sm danger" data-sa="delete">Delete text</button>`);
    }
  }
  if (opts.selEl) {
    const se = opts.selEl;
    se.addEventListener('change', (e) => {
      const o = findSel(); if (!o) return;
      if (e.target.dataset.zk) { o[e.target.dataset.zk] = e.target.value; commit(); return; }
      const k = e.target.dataset.k; if (!k || S.sel.kind !== 'player') return;
      applyField(o, k, e.target.value); commit();
    });
    se.addEventListener('input', (e) => { const o = findSel(); if (o && S.sel.kind === 'text' && e.target.dataset.k === 'text') { o.text = e.target.value; draw(); } });
    se.addEventListener('focusout', (e) => { if (e.target.dataset.k === 'text') commit(); });
    se.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sa]'); if (!b) return; const o = findSel(); if (!o) return;
      if (b.dataset.sa === 'routes') openRouteMenu(o);
      if (b.dataset.sa === 'clear') clearRoutes(o);
      if (b.dataset.sa === 'delete') deleteSel();
    });
  }

  drawTiles(); draw(); drawSel(); status();
  return {
    get data() { return S.data; },
    set data(d) { S.data = d; commit(); },
    get theme() { return S.theme; },
    commit, draw, select, status,
    animate() { const a = animator(S.data, (t) => draw(t)); a.play(); return a; },
    openRouteMenu,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Play Designer page: /playbook/play/:id/edit and /playbook/play/new/edit?book=&side=
export async function playDesigner(el, ctx, idParam) {
  const isNew = idParam === 'new';
  const [play, books, formations, positions, customRoutes, prefs, cfg] = await Promise.all([
    isNew ? Promise.resolve(null) : api.get(`/api/plays/${idParam}`),
    api.get('/api/playbooks'), api.get('/api/formations'), api.get('/api/pb/positions'), api.get('/api/pb/routes').catch(() => []),
    api.get('/api/pb/prefs').catch(() => ({ recent_routes: [] })), api.get('/api/playbook/config'),
  ]);
  if (!cfg.can_edit) { set(el, html`<div class="notice bad">You do not have edit access to the playbook.</div>`); return; }
  setPositions(positions);
  if (isNew && !books.length) {
    set(el, html`<div class="page-head"><div><h1>New play</h1></div></div><div class="notice warn">Plays live inside a playbook. <a href="/playbook">Create a playbook</a> first, then add plays to it.</div>`);
    return;
  }
  const side = isNew ? (['offense', 'defense', 'special'].includes(ctx.query.side) ? ctx.query.side : (cfg.dc_mode ? 'defense' : 'offense')) : play.side;
  const bookId = isNew ? Number(ctx.query.book) || books[0].id : play.playbook_id;
  const meta = isNew ? { name: 'New play', side, playbook_id: bookId, tags: [], situation: {}, assignments: {}, version: 0, data: { players: [] } } : { ...play, assignments: { ...(play.assignments || {}) } };
  const data = normalizePlay(meta.data);
  M.attachPositions(data, positions);
  if (isNew) {
    const s = side === 'defense' ? 'defense' : 'offense';
    data.players = M.linemenBase(s, positions);
    data.formations = { [SIDE_TEAM[s]]: { id: 'base', name: 'Linemen Base' } };
    if (side === 'defense') data.view = cfg.dc_mode ? 'defense' : 'offense';
  }
  data.formations ||= {};
  if (!isNew && meta.formation && !data.formations[SIDE_TEAM[side]]) {
    // v1 plays only stored the formation's name; link it to the saved formation of that name when there is one.
    const f = formations.find((x) => x.name === meta.formation && x.side === (side === 'defense' ? 'defense' : 'offense'));
    if (f) data.formations[SIDE_TEAM[side]] = { id: f.id, name: f.name };
  }
  const back = isNew ? `/playbook/book/${bookId}${side === 'defense' ? '?side=defense' : ''}` : `/playbook/play/${idParam}`;
  ctx.setTitle(isNew ? 'New play' : `Edit: ${meta.name}`);
  let dirty = false;
  const fOpts = (s) => [['base', 'Linemen Base'], ...formations.filter((f) => f.side === s).map((f) => [f.id, f.name])];
  const sit = meta.situation || {};
  const tagBoxes = (key, list) => html`<div class="row" style="gap:4px 12px">${list.map((v) => html`<label class="check"><input type="checkbox" name="${key}" data-multi value="${v}" ${checked((sit[key] || []).includes(v))}> ${v}</label>`)}</div>`;
  set(el, html`<div class="page-head"><div><h1>${isNew ? 'New play' : meta.name}</h1><div class="sub">Drag players from the palette under the field. Turn on Route Mode with a route button to draw. Right-click a player for its menu.</div></div>
    <div class="actions"><a class="btn" href="${back}">Cancel</a>${!isNew ? html`<button class="danger" id="del">Delete</button>` : ''}
      ${!isNew && cfg.can_export ? html`<button id="exp">Export</button>` : ''}<button id="preview">Preview animation</button><button id="savef">Save as formation</button><button class="primary" id="save">Save play</button></div></div>
    <div class="designer">
      <div id="ed"></div>
      <div class="stack">
        <div class="card"><div class="hd"><h3>Selected</h3></div><div class="bd" id="psel"></div></div>
        <div class="card"><div class="hd"><h3>Play</h3></div><div class="bd"><form id="mf" onsubmit="return false">
          ${field('Name', html`<input name="name" value="${meta.name}" required>`)}
          <div class="fields">${field('Playbook', html`<select name="playbook_id">${options(books.map((b) => [b.id, b.name]), meta.playbook_id)}</select>`)}${field('Side', html`<select name="side">${options([['offense', 'Offense'], ['defense', 'Defense'], ['special', 'Special teams']], meta.side)}</select>`)}</div>
          <div class="fields">${field('Offense formation', html`<select id="fo"><option value="">None</option>${options(fOpts('offense'), data.formations.O?.id ?? '')}</select>`)}${field('Defense formation', html`<select id="fd"><option value="">None</option>${options(fOpts('defense'), data.formations.D?.id ?? '')}</select>`)}</div>
          <div class="field"><label>Play type</label><div id="ptype">${tagBoxes('play_type', M.playTypesFor(meta.side))}</div></div>
          ${field('Distance', tagBoxes('distance', M.SITUATION.distance))}
          ${field('Down and distance', tagBoxes('down_distance', M.SITUATION.down_distance))}
          <div class="fields">${field('Folder', html`<input name="folder" value="${meta.folder || ''}">`)}${field('Other tags', html`<input name="tags" value="${(meta.tags || []).join(', ')}" placeholder="cover 2 beater">`)}</div>
          ${field('Coaching points', html`<textarea name="coaching_points">${meta.coaching_points || ''}</textarea>`)}
          ${field('Video link', html`<input name="video_url" value="${meta.video_url || ''}">`)}
        </form></div></div>
        <div class="card"><div class="hd"><h3>Assignments by position</h3></div><div class="bd" id="asg"></div></div>
        <div class="card"><div class="hd"><h3>Knowledge check</h3><span class="r"><button class="sm" id="addq">Add question</button></span></div><div class="bd" id="quiz"></div></div>
      </div>
    </div>`);
  const labels = () => [...new Set(ed.data.players.map((p) => displayLetter(p)).filter(Boolean))];
  const drawAsg = () => { const l = labels(); set($('#asg', el), l.length ? l.map((x) => field(x, html`<input data-asg="${x}" value="${meta.assignments[x] || ''}">`)) : html`<p class="muted">Add players first.</p>`); };
  const drawQuiz = () => {
    const q = ed.data.quiz;
    set($('#quiz', el), q.length ? q.map((x, i) => html`<div class="field" data-qi="${i}" style="border-bottom:1px solid var(--border);padding-bottom:8px">
      <input data-qk="q" value="${x.q}" placeholder="Question" style="margin-bottom:4px">
      ${x.options.map((o, j) => html`<div class="inline-input" style="margin-bottom:3px"><input type="radio" name="ans${i}" data-qa="${j}" ${checked(Number(x.answer) === j)} title="Correct answer"><input data-qo="${j}" value="${o}" placeholder="Option ${j + 1}"></div>`)}
      <button class="sm ghost danger" data-qdel="${i}">Remove</button></div>`) : html`<p class="muted">Optional questions players answer after studying the play.</p>`);
  };
  let asgCount = -1;
  const ed = createEditor($('#ed', el), { data, mode: 'play', positions, customRoutes, prefs, selEl: $('#psel', el), onChange: () => { dirty = true; const n = labels().join('|'); if (n !== asgCount) { asgCount = n; drawAsg(); } } });
  drawAsg(); drawQuiz();
  window.__pbEditor = ed; // handy for the browser smoke test
  $('#mf', el).addEventListener('input', () => { dirty = true; });
  $('[name=side]', el).onchange = (e) => { const cur = formData($('#mf', el)).play_type || []; set($('#ptype', el), tagBoxes('play_type', M.playTypesFor(e.target.value))); $$('#ptype input', el).forEach((i) => { i.checked = cur.includes(i.value); }); };
  $('#asg', el).addEventListener('input', (e) => { if (e.target.dataset.asg) meta.assignments[e.target.dataset.asg] = e.target.value; });
  $('#quiz', el).addEventListener('input', (e) => {
    const box = e.target.closest('[data-qi]'); if (!box) return; const q = ed.data.quiz[Number(box.dataset.qi)];
    if (e.target.dataset.qk) q.q = e.target.value; if (e.target.dataset.qo !== undefined) q.options[Number(e.target.dataset.qo)] = e.target.value; if (e.target.dataset.qa !== undefined) q.answer = Number(e.target.dataset.qa);
  });
  on($('#quiz', el), 'click', '[data-qdel]', (e, b) => { ed.data.quiz.splice(Number(b.dataset.qdel), 1); drawQuiz(); });
  $('#addq', el).onclick = () => { ed.data.quiz.push({ q: '', options: ['', '', ''], answer: 0 }); drawQuiz(); };

  // PD-13: formation per side, with Keep / Clear / Name only when that side already has players.
  const pickFormation = async (sel, s) => {
    const team = SIDE_TEAM[s]; const v = sel.value;
    const prev = ed.data.formations?.[team]?.id ?? '';
    if (!v) { ed.data.formations[team] = null; ed.commit(); return; }
    const f = v === 'base' ? { id: 'base', name: 'Linemen Base', data: M.linemenBase(s, positions) } : formations.find((x) => String(x.id) === v);
    const has = ed.data.players.some((p) => p.team === team);
    let mode = 'clear';
    if (has) {
      mode = await new Promise((resolve) => {
        const m = modal({ title: `Change ${s} formation to ${f.name}?`, body: html`<p>There are already ${s} players on the field.</p><ul class="muted" style="margin:0;padding-left:18px"><li><b>Keep players</b> moves them onto the new spots and keeps their routes.</li><li><b>Clear players</b> removes the ${s} players only and loads the formation.</li><li><b>Change formation name only</b> leaves the field as it is.</li></ul>`,
          actions: [{ label: 'Cancel', onClick: () => resolve(null) }, { label: 'Change formation name only', onClick: () => resolve('name') }, { label: 'Clear players', onClick: () => resolve('clear') }, { label: 'Keep players', primary: true, onClick: () => resolve('keep') }] });
        m.root.closest('.modal-bg').querySelector('[data-x]').addEventListener('click', () => resolve(null));
      });
    }
    if (!mode) { sel.value = prev; return; }
    M.applyFormation(ed.data, s, { id: f.id, name: f.name }, f.data, mode);
    ed.commit();
  };
  $('#fo', el).onchange = (e) => pickFormation(e.target, 'offense');
  $('#fd', el).onchange = (e) => pickFormation(e.target, 'defense');

  $('#preview', el).onclick = () => ed.animate();
  $('#savef', el).onclick = () => modal({
    title: 'Save as formation', body: html`<form id="ff">${field('Name', html`<input name="name" required>`)}${field('Players', html`<select name="side">${options([['offense', 'Offense players'], ['defense', 'Defense players']], meta.side === 'defense' ? 'defense' : 'offense')}</select>`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#ff')); const team = f.side === 'defense' ? 'D' : 'O';
      const players = ed.data.players.filter((p) => p.team === team);
      if (!players.length) { toast(`There are no ${f.side} players on the field`, 'warn'); return false; }
      const res = await api.post('/api/formations', { name: f.name, side: f.side, data: M.formationFromPlayers(players, ed.data.ball?.x ?? 50) });
      formations.push({ id: res.id, name: f.name, side: f.side, data: M.formationFromPlayers(players, ed.data.ball?.x ?? 50) });
      ed.data.formations[team] = { id: res.id, name: f.name };
      const s = team === 'D' ? '#fd' : '#fo'; set($(s, el), html`<option value="">None</option>${options(fOpts(f.side), res.id)}`);
      toast('Formation saved');
    } }],
  });
  if ($('#exp', el)) $('#exp', el).onclick = () => openExport(ctx, Number(idParam), { name: meta.name });
  const save = async (force = false) => {
    const f = formData($('#mf', el));
    if (!f.name.trim()) return toast('Give the play a name', 'warn');
    const data2 = ed.data;
    data2.quiz = data2.quiz.filter((q) => q.q && q.options.filter(Boolean).length >= 2).map((q) => ({ ...q, options: q.options.filter(Boolean) }));
    const ownTeam = SIDE_TEAM[f.side];
    const body = {
      name: f.name.trim(), side: f.side, playbook_id: Number(f.playbook_id), folder: f.folder, video_url: f.video_url, coaching_points: f.coaching_points,
      formation: data2.formations?.[ownTeam]?.name || null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      situation: { play_type: f.play_type || [], distance: f.distance || [], down_distance: f.down_distance || [] },
      data: data2, assignments: Object.fromEntries(Object.entries(meta.assignments).filter(([k, v]) => v && labels().includes(k))), base_version: meta.version, force,
    };
    try {
      if (isNew) { const r = await api.post('/api/plays', body); dirty = false; toast('Play created'); ctx.navigate(`/playbook/play/${r.id}`); } else { await api.put(`/api/plays/${idParam}`, body); dirty = false; toast('Saved'); ctx.navigate(`/playbook/play/${idParam}`); }
    } catch (err) {
      if (err.status === 409 && (await confirmDialog(`${err.message} Save anyway as a new version on top of theirs?`, { ok: 'Save anyway' }))) return save(true);
      errToast(err);
    }
  };
  $('#save', el).onclick = () => save();
  if ($('#del', el)) $('#del', el).onclick = async () => { if (await confirmDialog('Delete this play for everyone?', { danger: true, ok: 'Delete' })) { await api.del(`/api/plays/${idParam}`); dirty = false; ctx.navigate(`/playbook/book/${meta.playbook_id}`); } };
  const warn = (e) => { if (!el.isConnected) { window.removeEventListener('beforeunload', warn); return; } if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
}

// ---------------------------------------------------------------------------------------------------------------
// Formation designer (FM-1): /playbook/formation/:id/edit, /playbook/formation/new/edit?side=
export async function formationDesigner(el, ctx, idParam) {
  const isNew = idParam === 'new';
  const [f, positions, cfg] = await Promise.all([
    isNew ? Promise.resolve({ name: 'New formation', side: ctx.query.side === 'defense' ? 'defense' : 'offense', data: [] }) : api.get(`/api/formations/${idParam}`),
    api.get('/api/pb/positions'), api.get('/api/playbook/config'),
  ]);
  if (!cfg.can_edit) { set(el, html`<div class="notice bad">You do not have edit access to the playbook.</div>`); return; }
  setPositions(positions);
  const data = normalizePlay({ players: f.data || [], ball: { x: 50, y: 31.2 } });
  M.attachPositions(data, positions);
  if (isNew) data.players = M.linemenBase(f.side, positions);
  ctx.setTitle(isNew ? 'New formation' : f.name);
  set(el, html`<div class="page-head"><div><input class="pb-rename" id="fname" value="${f.name}" aria-label="Formation name"><div class="sub">${f.side === 'defense' ? 'Defensive' : 'Offensive'} formation. Place players once and load it into any play.</div></div>
    <div class="actions"><a class="btn" href="/playbook/formations?side=${f.side}">Cancel</a><button id="base">Start from Linemen Base</button>${!isNew ? html`<button class="danger" id="del">Delete</button>` : ''}<button class="primary" id="save">Save formation</button></div></div>
    <div class="designer"><div id="ed"></div><div class="stack"><div class="card"><div class="hd"><h3>Selected player</h3></div><div class="bd" id="psel"></div></div>
      <div class="card"><div class="bd"><p class="help" style="margin:0">Set a position on each player so plays pick up the position’s color and letter. Drag the center to slide the whole formation between the hashes.</p></div></div></div></div>`);
  const ed = createEditor($('#ed', el), { data, mode: 'formation', side: f.side, positions, selEl: $('#psel', el) });
  $('#base', el).onclick = () => { const d = ed.data; d.players = [...d.players.filter((p) => !p.position_id || !M.linemenBase(f.side, positions).some((b) => b.position_id === p.position_id)), ...M.linemenBase(f.side, positions)]; ed.commit(); };
  $('#save', el).onclick = async () => {
    const name = $('#fname', el).value.trim(); if (!name) return toast('Give the formation a name', 'warn');
    const body = { name, side: f.side, data: M.formationFromPlayers(ed.data.players, ed.data.ball?.x ?? 50) };
    try {
      if (isNew) await api.post('/api/formations', body); else await api.put(`/api/formations/${idParam}`, body);
      toast('Formation saved'); ctx.navigate(`/playbook/formations?side=${f.side}`);
    } catch (err) { errToast(err); }
  };
  if ($('#del', el)) $('#del', el).onclick = async () => { if (await confirmDialog(`Delete the formation “${f.name}”? Plays that use it keep their players.`, { danger: true, ok: 'Delete' })) { await api.del(`/api/formations/${idParam}`); ctx.navigate('/playbook/formations'); } };
}

// ---------------------------------------------------------------------------------------------------------------
// Route designer (RT-1, RT-2): /playbook/route/:id/edit, /playbook/route/new/edit
export async function routeDesigner(el, ctx, idParam) {
  const isNew = idParam === 'new';
  const [r, all, cfg] = await Promise.all([
    isNew ? Promise.resolve({ name: 'New route', side: ctx.query.side === 'D' ? 'D' : 'O', grp: 'Custom', smart: true, data: { points: [], opts: [], type: 'route' } }) : api.get(`/api/pb/routes/${idParam}`),
    api.get('/api/pb/routes').catch(() => []), api.get('/api/playbook/config'),
  ]);
  if (!cfg.can_edit) { set(el, html`<div class="notice bad">You do not have edit access to the playbook.</div>`); return; }
  const T = M.TEMPLATE;
  const toField = (q) => [M.r1(T.x + q[0] * YD), M.r1(T.y + q[1] * YDV), ...(q[2] ? [1] : [])];
  const toYards = (q) => [Math.round(((q[0] - T.x) / YD) * 100) / 100, Math.round(((q[1] - T.y) / YDV) * 100) / 100, ...(q[2] ? [1] : [])];
  const tpl = normalizePlayer({ id: 'template', team: r.side === 'D' ? 'D' : 'O', type: 'circle', x: T.x, y: T.y, label: '', position_id: null,
    path: (r.data.points || []).map(toField), path_type: r.data.type || 'route', opts: (r.data.opts || []).map((o) => ({ ...o, from: toField(o.from), points: o.points.map(toField) })) });
  const data = normalizePlay({ players: [tpl], ball: { x: 50, y: 31.2 } });
  ctx.setTitle(isNew ? 'New route' : r.name);
  const groups = [...new Set(['Custom', ...all.map((x) => x.grp)])];
  set(el, html`<div class="page-head"><div><input class="pb-rename" id="rname" value="${r.name}" aria-label="Route name"><div class="sub">Draw from the template player in the middle of the field, as run by a receiver on the left side. The Route Menu mirrors it for players on the right.</div></div>
    <div class="actions"><a class="btn" href="/playbook/routes">Cancel</a><button id="clear">Clear</button>${!isNew ? html`<button class="danger" id="del">Delete</button>` : ''}<button class="primary" id="save">Save route</button></div></div>
    <div class="designer"><div id="ed"></div><div class="stack"><div class="card"><div class="hd"><h3>Route</h3></div><div class="bd"><form id="rf" onsubmit="return false">
      <div class="fields">${field('Group in the Route Menu', html`<input name="grp" value="${r.grp || 'Custom'}" list="rgroups"><datalist id="rgroups">${groups.map((g) => html`<option value="${g}">`)}</datalist>`)}
      ${field('For', html`<select name="side">${options([['O', 'Offense'], ['D', 'Defense']], r.side)}</select>`)}</div>
      <label class="check"><input type="checkbox" name="smart" ${checked(r.smart !== false)}> Smart Distance</label>
      <p class="help">On by default. When a player starts behind the line of scrimmage, a stem is added so depths are measured from the line: a 10-yard out still breaks ten yards past it. Use it for routes that go downfield.</p>
    </form></div></div><div class="card"><div class="hd"><h3>Selected</h3></div><div class="bd" id="psel"></div></div></div></div>`);
  const ed = createEditor($('#ed', el), { data, mode: 'route', positions: [], selEl: $('#psel', el), lockId: 'template' });
  $('[name=side]', el).onchange = (e) => { ed.data.players[0].team = e.target.value; ed.commit(); };
  $('#clear', el).onclick = () => { const p = ed.data.players[0]; p.path = []; p.opts = []; ed.commit(); };
  $('#save', el).onclick = async () => {
    const f = formData($('#rf', el)); const p = ed.data.players[0];
    const name = $('#rname', el).value.trim(); if (!name) return toast('Give the route a name', 'warn');
    if (!p.path.length) return toast('Draw the route first', 'warn');
    const body = { name, grp: f.grp || 'Custom', side: f.side, smart: f.smart, data: { points: p.path.map(toYards), type: p.path_type, opts: (p.opts || []).filter((o) => o.points.length).map((o) => ({ id: o.id, parent: o.parent, type: o.type, from: toYards(o.from), points: o.points.map(toYards) })) } };
    try { if (isNew) await api.post('/api/pb/routes', body); else await api.put(`/api/pb/routes/${idParam}`, body); toast('Route saved'); ctx.navigate('/playbook/routes'); } catch (err) { errToast(err); }
  };
  if ($('#del', el)) $('#del', el).onclick = async () => { if (await confirmDialog(`Delete the route “${r.name}”?`, { danger: true, ok: 'Delete' })) { await api.del(`/api/pb/routes/${idParam}`); ctx.navigate('/playbook/routes'); } };
}
