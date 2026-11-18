// PC-1..PC-4: Playcaller Mode. Full-screen, tablet-first play browsing: pick a playbook, then Offense or Defense, then
// Play Name, Formation, Play Type, Distance or Down & Distance, and swipe through big play cards. Back button and
// breadcrumbs; the X exits to the Playbooks dashboard. Extensions: animate the play, telestrate (draw over it), move
// players live, and log each call (down, distance, result) to a play call log.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, field, options, formData, fmtDT, empty, esc } from '../ui.js';
import { renderPlay, svgPoint, flipPt, watermarkHtml, animator, setPositions, normalizePlay } from '../field.js';
import { groupPlays } from '../pb-model.js';
import { sideLabel } from '../pb-ui.js';
import { icon } from '../icons.js';

const CATS = [['name', 'Play name', 'Every play, A to Z'], ['formation', 'Formation', 'By formation'], ['play_type', 'Play type', 'Run, pass, screen…'], ['distance', 'Distance', 'Short, medium, long'], ['down_distance', 'Down & distance', '3rd & short, red zone…']];

export default async function playcaller(el, ctx) {
  const [books, cfg, positions] = await Promise.all([api.get('/api/playbooks'), api.get('/api/playbook/config'), api.get('/api/pb/positions').catch(() => [])]);
  setPositions(positions);
  const st = { book: null, side: null, cat: null, val: null, plays: null };
  const pc = document.createElement('div');
  pc.className = 'pc'; pc.setAttribute('role', 'dialog'); pc.setAttribute('aria-label', 'Playcaller mode');
  set(el, html`<div class="muted" style="padding:20px 0">Playcaller mode is open. <a href="/playbook">Back to playbooks</a></div>`);
  el.appendChild(pc);
  pc.addEventListener('contextmenu', (e) => e.preventDefault());
  const exit = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); ctx.navigate('/playbook'); };
  const keyH = (e) => {
    if (!pc.isConnected) { document.removeEventListener('keydown', keyH); return; }
    if (document.querySelector('.modal-bg')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'Escape') { e.preventDefault(); back(); }
    if (cards && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); cards.go(cards.index + (e.key === 'ArrowRight' ? 1 : -1)); }
  };
  document.addEventListener('keydown', keyH);
  let cards = null;

  const crumbs = () => {
    const c = [['Playbooks', 0]];
    if (st.book) c.push([st.book.name, 1]);
    if (st.side) c.push([sideLabel[st.side], 2]);
    if (st.cat) c.push([CATS.find((x) => x[0] === st.cat)[1], 3]);
    if (st.val != null) c.push([st.val, 4]);
    return c;
  };
  const level = () => (st.val != null || st.cat === 'name' ? 4 : st.cat ? 3 : st.side ? 2 : st.book ? 1 : 0);
  const jump = (n) => {
    if (n < 1) { st.book = null; st.plays = null; } if (n < 2) st.side = null; if (n < 3) st.cat = null; if (n < 4) st.val = null;
    if (n === 3 && st.cat === 'name') st.cat = null;
    draw();
  };
  const back = () => { const l = level(); if (l === 0) exit(); else jump(l - 1); };

  async function draw() {
    cards = null;
    const l = level();
    const top = html`<div class="pc-top">
      <button class="pc-btn" id="pcback" aria-label="Back">${icon('left', 18)} Back</button>
      <nav class="crumbs" aria-label="Breadcrumbs">${crumbs().map(([t, n], i, a) => (i === a.length - 1 ? html`<b>${t}</b>` : html`<a data-jump="${n}" tabindex="0">${t}</a><span style="opacity:.5">${icon('right', 14)}</span>`))}</nav>
      <button class="pc-btn" id="pcfs" title="Full screen">Full screen</button>
      ${st.book ? html`<button class="pc-btn" id="pclog">Call log</button>` : ''}
      <button class="pc-btn" id="pcx" aria-label="Exit to the dashboard" title="Exit">${icon('x', 18)}</button></div>`;
    if (l === 0) {
      set(pc, html`${top}<div class="pc-body"><div class="pc-note">${cfg.game_mode_note || ''}</div>
        ${books.length ? html`<div class="pc-choices">${books.map((b) => html`<button class="pc-choice" data-book="${b.id}">${b.name}<small>${b.offense_count} offense · ${b.defense_count} defense</small></button>`)}</div>` : empty('No playbooks yet.')}</div>`);
    } else if (l === 1) {
      if (!st.plays) { set(pc, html`${top}<div class="pc-body">Loading…</div>`); wire(); st.plays = (await api.get(`/api/plays?playbook_id=${st.book.id}`)).map((p) => ({ ...p, data: normalizePlay(p.data) })); }
      const n = (s) => st.plays.filter((p) => p.side === s).length;
      const sides = cfg.dc_mode ? ['defense', 'offense'] : ['offense', 'defense'];
      if (n('special')) sides.push('special');
      set(pc, html`${top}<div class="pc-body"><div class="pc-choices">${sides.map((s) => html`<button class="pc-choice" data-side="${s}">${sideLabel[s]}<small>${n(s)} plays</small></button>`)}</div></div>`);
    } else if (l === 2) {
      set(pc, html`${top}<div class="pc-body"><div class="pc-choices">${CATS.map(([k, t, s]) => html`<button class="pc-choice" data-cat="${k}">${t}<small>${s}</small></button>`)}</div></div>`);
    } else if (l === 3) {
      const g = groupPlays(sidePlays(), st.cat);
      set(pc, html`${top}<div class="pc-body">${g.length ? html`<div class="pc-choices">${g.map((x) => html`<button class="pc-choice" data-val="${x.key}">${x.key}<small>${x.plays.length} play${x.plays.length === 1 ? '' : 's'}</small></button>`)}</div>` : empty('No plays on this side yet.')}</div>`);
    } else {
      const list = st.cat === 'name' ? sidePlays().slice().sort((a, b) => a.name.localeCompare(b.name)) : (groupPlays(sidePlays(), st.cat).find((x) => x.key === st.val)?.plays || []);
      set(pc, html`${top}<div class="pc-stage">${list.length ? html`<div class="pc-track" id="track">${list.map((p, i) => html`<section class="pc-slide" data-i="${i}" aria-label="${p.name}"><h2>${p.name}</h2><div class="field-wrap no-copy" data-fw="${i}"></div>
          <div class="pc-note" style="margin:8px 0 0">${[p.formation, ...(p.situation?.play_type || []), ...(p.situation?.down_distance || [])].filter(Boolean).join(' · ')}</div></section>`)}</div>
        <div class="pc-tools" role="toolbar" aria-label="Play tools">
          <button class="pc-btn" data-t="prev" aria-label="Previous play">${icon('left', 18)}</button><span id="pcpos" style="align-self:center;min-width:64px;text-align:center"></span><button class="pc-btn" data-t="next" aria-label="Next play">${icon('right', 18)}</button>
          <button class="pc-btn" data-t="anim">${icon('play', 16)} Animate</button><button class="pc-btn" data-t="draw" aria-pressed="false">Draw</button><button class="pc-btn" data-t="move" aria-pressed="false">Move players</button>
          <button class="pc-btn" data-t="clear">Clear</button><button class="pc-btn" data-t="reset">Reset</button><button class="pc-btn" data-t="call" style="border-color:#4fbf86">Log call</button></div>` : html`<div class="pc-body">${empty('No plays here.')}</div>`}</div>`);
      if (list.length) cards = cardDeck(list);
    }
    wire();
  }
  const sidePlays = () => st.plays.filter((p) => p.side === st.side);
  function wire() {
    $('#pcback', pc).onclick = back;
    $('#pcx', pc).onclick = exit;
    $('#pcfs', pc).onclick = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else pc.requestFullscreen?.().catch(() => {}); };
    if ($('#pclog', pc)) $('#pclog', pc).onclick = () => callLog(st.book);
  }
  on(pc, 'click', '[data-jump]', (e, a) => jump(Number(a.dataset.jump)));
  on(pc, 'keydown', '[data-jump]', (e, a) => { if (e.key === 'Enter') jump(Number(a.dataset.jump)); });
  on(pc, 'click', '[data-book]', (e, b) => { st.book = books.find((x) => x.id === Number(b.dataset.book)); st.plays = null; draw(); });
  on(pc, 'click', '[data-side]', (e, b) => { st.side = b.dataset.side; draw(); });
  on(pc, 'click', '[data-cat]', (e, b) => { st.cat = b.dataset.cat; draw(); });
  on(pc, 'click', '[data-val]', (e, b) => { st.val = b.dataset.val; draw(); });
  on(pc, 'click', '[data-t]', (e, b) => cards?.tool(b.dataset.t));

  // Swipeable cards with per-play working copies (moved players and telestration stay until Reset).
  function cardDeck(list) {
    const track = $('#track', pc);
    const work = list.map((p) => ({ data: normalizePlay(p.data), strokes: [] }));
    let mode = null; let anim = null;
    const deck = { index: 0, go: (i) => { const n = Math.max(0, Math.min(list.length - 1, i)); track.scrollTo({ left: n * track.clientWidth, behavior: 'smooth' }); } };
    const drawCard = (i, t = null) => {
      const fw = track.querySelector(`[data-fw="${i}"]`); const w = work[i];
      const extra = w.strokes.map((s) => `<polyline points="${s.map((q) => q.join(',')).join(' ')}" fill="none" stroke="#ffd666" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      fw.innerHTML = renderPlay(w.data, { t, extra }) + watermarkHtml(ctx.me.user.name);
    };
    list.forEach((_, i) => drawCard(i));
    const setPos = () => { $('#pcpos', pc).textContent = `${deck.index + 1} of ${list.length}`; };
    setPos();
    track.addEventListener('scroll', () => { const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); if (i !== deck.index) { anim?.pause(); anim = null; deck.index = i; setPos(); } }, { passive: true });
    const setMode = (m) => { mode = mode === m ? null : m; $$('[data-t=draw],[data-t=move]', pc).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === mode))); track.style.overflowX = mode ? 'hidden' : 'auto'; };
    deck.tool = (t) => {
      const i = deck.index;
      if (t === 'prev') deck.go(i - 1);
      if (t === 'next') deck.go(i + 1);
      if (t === 'anim') { anim?.pause(); anim = animator(work[i].data, (tt) => drawCard(i, tt)); anim.play(); api.get(`/api/plays/${list[i].id}?context=playcaller`).catch(() => {}); }
      if (t === 'draw' || t === 'move') setMode(t);
      if (t === 'clear') { work[i].strokes = []; drawCard(i); }
      if (t === 'reset') { work[i] = { data: normalizePlay(list[i].data), strokes: [] }; drawCard(i); }
      if (t === 'call') logCall(list[i]);
    };
    // telestration and interactive play on the current card
    let cur = null; let drag = null;
    track.addEventListener('pointerdown', (e) => {
      if (!mode) return;
      const fw = e.target.closest('[data-fw]'); if (!fw || Number(fw.dataset.fw) !== deck.index) return;
      const svg = fw.querySelector('svg'); const w = work[deck.index];
      fw.setPointerCapture(e.pointerId);
      if (mode === 'draw') { cur = [svgPoint(svg, e)]; w.strokes.push(cur); return; }
      const g = e.target.closest('[data-player]'); if (g) drag = w.data.players.find((p) => p.id === g.dataset.player);
    });
    track.addEventListener('pointermove', (e) => {
      if (!cur && !drag) return;
      const fw = track.querySelector(`[data-fw="${deck.index}"]`); const svg = fw.querySelector('svg'); const w = work[deck.index];
      const pt = svgPoint(svg, e);
      if (cur) cur.push(pt);
      else { const dp = flipPt(pt, w.data.view === 'defense'); const dx = dp[0] - drag.x; const dy = dp[1] - drag.y; drag.x = dp[0]; drag.y = dp[1]; const mv = (q) => [q[0] + dx, q[1] + dy, ...q.slice(2)]; drag.path = (drag.path || []).map(mv); drag.opts = (drag.opts || []).map((o) => ({ ...o, from: o.from && mv(o.from), points: o.points.map(mv) })); }
      drawCard(deck.index);
    });
    const up = () => { cur = null; drag = null; };
    track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
    return deck;
  }

  // PC-4: play call log
  function logCall(p) {
    modal({ title: `Log call: ${p.name}`, body: html`<form id="cf" onsubmit="return false"><div class="fields">
        ${field('Down', html`<select name="down">${options([['', '—'], ['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4', '4th']])}</select>`)}
        ${field('Distance (yards)', html`<input name="distance" type="number" min="0" max="99" inputmode="numeric">`)}</div>
        <div class="fields">${field('Ball on', html`<input name="yard_line" placeholder="Own 35">`)}${field('Result', html`<input name="result" placeholder="+6, first down">`)}</div>
        ${field('Note', html`<input name="note">`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Log call', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#cf')); await api.post('/api/pb/calls', { ...f, play_id: p.id }); toast('Call logged'); } }] });
  }
  async function callLog(b) {
    let rows = [];
    try { rows = await api.get(`/api/pb/calls?playbook_id=${b.id}`); } catch (e) { return errToast(e); }
    const ord = ['', '1st', '2nd', '3rd', '4th'];
    const m = modal({ title: `Call log: ${b.name}`, wide: true, body: rows.length ? html`<div class="tbl-wrap"><table><thead><tr><th>When</th><th>Play</th><th>Situation</th><th>Result</th><th>By</th><th></th></tr></thead><tbody>
      ${rows.map((c) => html`<tr><td>${fmtDT(c.at)}</td><td>${c.play_name}</td><td>${[c.down ? `${ord[c.down]}${c.distance != null ? ` & ${c.distance}` : ''}` : '', c.yard_line].filter(Boolean).join(' · ')}</td><td>${c.result || ''}${c.note ? html`<div class="muted" style="font-size:12px">${c.note}</div>` : ''}</td><td>${c.by_name || ''}</td><td>${c.by_user === ctx.me.user.id || cfg.can_edit ? html`<button class="sm ghost danger" data-cdel="${c.id}">Remove</button>` : ''}</td></tr>`)}
      </tbody></table></div>` : empty('No calls logged for this playbook yet. Use Log call on a play card.'), actions: [{ label: 'Close' }] });
    on(m.root, 'click', '[data-cdel]', async (e, x) => { await api.del(`/api/pb/calls/${x.dataset.cdel}`); x.closest('tr').remove(); toast('Removed'); });
  }

  const pre = Number(ctx.query.book);
  if (pre) st.book = books.find((x) => x.id === pre) || null;
  draw();
}
