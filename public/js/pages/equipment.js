// Module 8: Equipment inventory — catalog and stock, issue and bulk kits (with jersey numbers), check-in returns,
// outstanding list, helmet recertification and fits, item history, low-stock reorder list, scan lookup,
// and the player/parent view with acknowledgment.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, fmtDate, todayISO, cap, empty, confirmDialog, tabs, raw } from '../ui.js';

export default async function equipment(el, ctx) {
  if (!ctx.me.caps.staff) return mine(el, ctx);
  const tab = ctx.query.tab || 'issued';
  const manage = ctx.me.caps['equipment.manage'];
  const head = html`<div class="page-head"><div><h1>Equipment</h1><div class="sub">${manage ? 'Issue gear at the start of the season and check it back in at the end.' : 'View only. The head coach and equipment manager issue and receive items.'}</div></div>
    <div class="actions"><button id="scan">Scan tag</button>${manage ? html`<button id="bulk">Bulk issue kit</button><button class="primary" id="issue">Issue to player</button>` : ''}</div></div>
    ${tabs([['issued', 'Issued', '/equipment'], ['outstanding', 'Outstanding', '/equipment?tab=outstanding'], ['helmets', 'Helmets', '/equipment?tab=helmets'], ['inventory', 'Inventory', '/equipment?tab=inventory'], ['catalog', 'Catalog', '/equipment?tab=catalog']], tab)}`;
  const [types, players] = await Promise.all([api.get('/api/eq/types'), api.get('/api/players')]);
  const view = { issued, outstanding, helmets, inventory, catalog }[tab] || issued;
  await view(el, ctx, head, { types, players, manage });
  $('#scan', el).onclick = () => scan(ctx);
  if (manage) { $('#issue', el).onclick = () => issueDialog(ctx, types, players, ctx.query.player); $('#bulk', el).onclick = () => bulkDialog(ctx, types, players); }
}

async function issued(el, ctx, head, { players, manage }) {
  const pid = ctx.query.player || '';
  const rows = await api.get(`/api/eq/issues?open=1${pid ? `&player_id=${pid}` : ''}`);
  set(el, html`${head}<div class="filters"><select id="pl">${options(players.map((p) => [p.id, p.name]), pid, { blank: 'All players' })}</select><span class="faint">${rows.length} item(s) out</span></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th class="num">#</th><th>Item</th><th>Serial</th><th>Size</th><th>Issued</th><th>Condition</th><th>Acknowledged</th><th></th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${r.player_name}</td><td class="num">${r.jersey ?? ''}</td><td>${r.type_name}${r.qty > 1 ? ` ×${r.qty}` : ''}</td><td class="mono">${r.serial || ''}</td><td>${r.size || ''}</td><td>${fmtDate(r.issued_at, { dow: false })}</td><td>${cap(r.condition_out)}</td>
      <td>${r.acknowledged_at ? html`<span class="badge ok">Yes</span>` : html`<span class="badge">Not yet</span>`}</td><td>${manage ? html`<button class="sm" data-ret="${r.id}" data-name="${r.type_name}">Check in</button>` : ''}</td></tr>`)}</tbody></table>${!rows.length ? empty('Nothing issued.') : ''}</div></div>`);
  $('#pl', el).onchange = (e) => ctx.navigate(`/equipment${e.target.value ? `?player=${e.target.value}` : ''}`);
  on(el, 'click', '[data-ret]', (e, b) => returnDialog(ctx, Number(b.dataset.ret), b.dataset.name));
}
function returnDialog(ctx, id, name) {
  modal({ title: `Check in: ${name}`, body: html`<form id="rf">${field('Result', html`<select name="status">${options([['returned', 'Returned'], ['damaged', 'Returned damaged'], ['lost', 'Lost / not returned']])}</select>`)}${field('Condition', html`<select name="condition">${options(['good', 'fair', 'poor', 'damaged'])}</select>`)}${field('Date', html`<input type="date" name="date" value="${todayISO()}">`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { await api.post(`/api/eq/issues/${id}/return`, formData(r.querySelector('#rf'))); toast('Checked in'); ctx.reload(); } }] });
}

async function outstanding(el, ctx, head) {
  const list = await api.get('/api/eq/outstanding');
  const total = list.reduce((s, p) => s + p.total_cost, 0);
  set(el, html`${head}<div class="row" style="margin-bottom:12px"><b>${list.length} players · $${total.toFixed(2)} replacement cost</b><span class="spacer"></span><a class="btn" href="/api/eq/outstanding.csv" download>Export for athletic director</a></div>
    <p class="help">Fee collection stays outside the app.</p>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th class="num">#</th><th>Items not returned</th><th class="num">Replacement cost</th></tr></thead><tbody>
    ${list.map((p) => html`<tr><td><a href="/equipment?player=${p.player_id}">${p.name}</a></td><td class="num">${p.jersey ?? ''}</td><td>${p.items.map((i) => `${i.type_name}${i.serial ? ' ' + i.serial : ''}${i.return_status === 'lost' ? ' (lost)' : ''}`).join(', ')}</td><td class="num">$${p.total_cost.toFixed(2)}</td></tr>`)}</tbody></table>${!list.length ? empty('Everything is back.') : ''}</div></div>`);
}

async function helmets(el, ctx, head, { players, manage }) {
  const list = await api.get('/api/eq/helmets');
  const flagged = list.filter((h) => h.flags.length);
  set(el, html`${head}<div class="notice">NOCSAE strongly recommends (but does not require) recertification at the interval each manufacturer sets; for helmets made before January 2017 it recommends annual recertification. Helmets that cannot be recertified have a useful life of no more than five years. Set your program’s own rule in Settings.</div>
    <div class="filters"><label class="check"><input type="checkbox" id="fl" ${checked(ctx.query.flagged)}> Only flagged (${flagged.length})</label></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Serial</th><th>Model</th><th>Size</th><th class="num">Made</th><th class="num">Recertified</th><th>Facility</th><th>Player</th><th>Last fit</th><th>Flags</th><th></th></tr></thead><tbody>
    ${(ctx.query.flagged ? flagged : list).map((h) => html`<tr><td class="mono"><a href="#" data-hist="${h.id}">${h.serial}</a></td><td>${h.brand || ''} ${h.model || ''}</td><td>${h.size || ''}</td><td class="num">${h.manuf_year || ''}</td><td class="num">${h.recert_year || '—'}</td><td class="s">${h.recert_facility || ''}</td><td>${h.holder || html`<span class="faint">In stock</span>`}</td><td>${h.last_fit ? fmtDate(h.last_fit, { dow: false }) : '—'}</td>
      <td>${h.flags.map((f) => html`<span class="badge ${f.startsWith('Past') ? 'bad' : 'warn'}">${f}</span> `)}</td><td>${manage ? html`<button class="sm" data-rec="${h.id}">Recertify</button><button class="sm" data-fit="${h.id}">Record fit</button>` : ''}</td></tr>`)}</tbody></table></div></div>`);
  $('#fl', el).onchange = (e) => ctx.navigate(`/equipment?tab=helmets${e.target.checked ? '&flagged=1' : ''}`);
  on(el, 'click', '[data-rec]', (e, b) => { const h = list.find((x) => x.id === Number(b.dataset.rec)); modal({ title: `Recertify ${h.serial}`, body: html`<form id="rf"><div class="fields">${field('Recertification year', html`<input type="number" name="recert_year" value="${new Date().getFullYear()}">`)}${field('Manufacture year', html`<input type="number" name="manuf_year" value="${h.manuf_year || ''}">`)}</div>${field('Facility', html`<input name="recert_facility" value="${h.recert_facility || ''}">`)}<label class="check"><input type="checkbox" name="allows_recert" ${checked(h.allows_recert)}> Manufacturer allows recertification</label></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#rf')); await api.put(`/api/eq/items/${h.id}`, { ...f, allows_recert: f.allows_recert ? 1 : 0 }); ctx.reload(); } }] }); });
  on(el, 'click', '[data-fit]', (e, b) => modal({ title: 'Record helmet fit', body: html`<form id="ff">${field('Player', html`<select name="player_id">${options(players.map((p) => [p.id, p.name]))}</select>`)}${field('Date', html`<input type="date" name="date" value="${todayISO()}">`)}${field('Notes', html`<textarea name="notes" placeholder="Fit check notes"></textarea>`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { await api.post('/api/eq/fits', { ...formData(r.querySelector('#ff')), item_id: Number(b.dataset.fit) }); toast('Fit recorded'); ctx.reload(); } }] }));
  on(el, 'click', '[data-hist]', (e, b) => { e.preventDefault(); history(Number(b.dataset.hist)); });
}
async function history(id) {
  const h = await api.get(`/api/eq/items/${id}/history`);
  modal({ title: `${h.item.type_name} ${h.item.serial || ''}`, wide: true, body: html`<h4>Who had it</h4>${h.issues.length ? html`<table><thead><tr><th>Season</th><th>Player</th><th>Issued</th><th>Out</th><th>Returned</th><th>In</th></tr></thead><tbody>${h.issues.map((i) => html`<tr><td>${i.season_name || ''}</td><td>${i.player_name}</td><td>${fmtDate(i.issued_at, { dow: false })}</td><td>${cap(i.condition_out)}</td><td>${i.returned_at ? `${fmtDate(i.returned_at, { dow: false })} (${i.return_status})` : 'Still out'}</td><td>${cap(i.condition_in || '')}</td></tr>`)}</tbody></table>` : empty('Never issued.')}
    ${h.fits.length ? html`<h4 style="margin-top:12px">Fits</h4><ul>${h.fits.map((f) => html`<li>${fmtDate(f.date)} · ${f.player_name} · ${f.notes || ''}</li>`)}</ul>` : ''}`, actions: [{ label: 'Close' }] });
}

async function inventory(el, ctx, head) {
  const inv = await api.get('/api/eq/inventory');
  set(el, html`${head}<div class="grid g-side"><div class="card"><div class="hd"><h2>Counts by size</h2></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Item</th><th>Size</th><th class="num">In stock</th><th class="num">Issued</th><th></th></tr></thead><tbody>
    ${inv.rows.map((r) => html`<tr><td>${r.name}</td><td>${r.size}</td><td class="num"><b>${r.available}</b></td><td class="num">${r.issued}</td><td>${r.low ? html`<span class="badge warn">Low (≤${r.low_stock})</span>` : ''}</td></tr>`)}</tbody></table></div></div>
    <div class="card"><div class="hd"><h2>Reorder list</h2></div>${inv.reorder.length ? html`<ul class="list">${inv.reorder.map((r) => html`<li><span class="grow">${r.name} ${r.size !== 'all' ? r.size : ''}</span><b>${r.suggested}</b><span class="s">$${r.est_cost}</span></li>`)}</ul><div class="ft"><b>Estimated total $${inv.reorder.reduce((s, r) => s + Number(r.est_cost), 0).toFixed(2)}</b></div>` : empty('Stock levels are fine.')}</div></div>`);
}

async function catalog(el, ctx, head, { types, manage }) {
  set(el, html`${head}${manage ? html`<div class="row" style="margin-bottom:12px"><span class="spacer"></span><button id="addstock">Add stock or serialized items</button><button class="primary" id="addtype">New item type</button></div>` : ''}
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Brand / model</th><th>Tracking</th><th class="num">In stock</th><th class="num">Out</th><th class="num">Replacement</th><th class="num">Low at</th></tr></thead><tbody>
    ${types.map((t) => html`<tr><td><b>${t.name}</b></td><td>${cap(t.category)}</td><td>${[t.brand, t.model].filter(Boolean).join(' ')}</td><td>${t.tracking === 'serial' ? 'Serial numbers' : 'Counted by size'}</td><td class="num">${t.tracking === 'serial' ? t.stock - t.out_count : t.stock}</td><td class="num">${t.out_count}</td><td class="num">$${Number(t.cost).toFixed(2)}</td><td class="num">${t.low_stock}</td></tr>`)}</tbody></table></div></div>`);
  if (!manage) return;
  $('#addtype', el).onclick = () => modal({ title: 'New item type', body: html`<form id="tf"><div class="fields">${field('Name', html`<input name="name" required>`)}${field('Category', html`<select name="category">${options(['helmet', 'shoulder pads', 'pants', 'pads', 'jersey', 'practice gear', 'cleats', 'other'])}</select>`)}${field('Tracking', html`<select name="tracking">${options([['bulk', 'Counted by size'], ['serial', 'Serial numbers']])}</select>`)}
    ${field('Brand', html`<input name="brand">`)}${field('Model', html`<input name="model">`)}${field('Replacement cost', html`<input type="number" step="0.01" name="cost">`)}${field('Low-stock alert at', html`<input type="number" name="low_stock" value="2">`)}</div></form>`,
  actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => { await api.post('/api/eq/types', formData(r.querySelector('#tf'))); ctx.reload(); } }] });
  $('#addstock', el).onclick = () => {
    const m = modal({ title: 'Add items', body: html`<form id="sf">${field('Item type', html`<select name="type_id" id="ty">${options(types.map((t) => [t.id, `${t.name} (${t.tracking === 'serial' ? 'serial' : 'by size'})`]))}</select>`)}<div id="sx"></div></form>`,
      actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: async (r) => {
        const f = formData(r.querySelector('#sf')); const t = types.find((x) => x.id === Number(f.type_id));
        if (t.tracking === 'serial') { const serials = f.serials.split(/[\s,]+/).filter(Boolean); for (const s of serials) await api.post('/api/eq/items', { type_id: t.id, serial: s, size: f.size, manuf_year: f.manuf_year || null, recert_year: f.recert_year || null }); toast(`Added ${serials.length}`); } else { await api.post('/api/eq/items', { type_id: t.id, size: f.size, qty: f.qty }); toast('Stock added'); }
        ctx.reload();
      } }] });
    const sx = () => { const t = types.find((x) => x.id === Number(m.root.querySelector('#ty').value)); set(m.root.querySelector('#sx'), t.tracking === 'serial' ? html`${field('Serial numbers (one per line or comma)', html`<textarea name="serials"></textarea>`)}<div class="fields">${field('Size', html`<input name="size">`)}${field('Manufacture year', html`<input type="number" name="manuf_year">`)}${field('Recertified year', html`<input type="number" name="recert_year">`)}</div>` : html`<div class="fields">${field('Size', html`<input name="size" placeholder="M">`)}${field('Quantity', html`<input type="number" name="qty" value="10">`)}</div>`); };
    m.root.querySelector('#ty').onchange = sx; sx();
  };
}

function issueDialog(ctx, types, players, presetPlayer) {
  const m = modal({ title: 'Issue equipment', body: html`<form id="if">${field('Player', html`<select name="player_id">${options(players.map((p) => [p.id, `${p.name} · ${p.team || ''}${p.jersey != null ? ` · #${p.jersey}` : ''}`]), presetPlayer)}</select>`)}
    ${field('Jersey number', html`<input type="number" name="jersey" placeholder="Leave blank to keep">`, 'Numbers must be unique within a team; you will be warned on a duplicate.')}
    ${field('Item', html`<select name="type_id">${options(types.map((t) => [t.id, t.name]), '', { blank: 'Jersey number only' })}</select>`)}
    <div class="fields">${field('Size', html`<input name="size" placeholder="L">`)}${field('Serial (optional)', html`<input name="serial" placeholder="auto-pick available">`)}${field('Quantity', html`<input type="number" name="qty" value="1">`)}${field('Condition', html`<select name="condition">${options(['new', 'good', 'fair'], 'good')}</select>`)}</div></form>`,
  actions: [{ label: 'Cancel' }, { label: 'Issue', primary: true, onClick: async (r) => {
    const f = formData(r.querySelector('#if'));
    if (f.serial) { const it = await api.get(`/api/eq/lookup?code=${encodeURIComponent(f.serial)}`); f.item_id = it.id; }
    const res = await api.post('/api/eq/issue', { ...f, player_id: Number(f.player_id), type_id: f.type_id ? Number(f.type_id) : null, size: f.size || null });
    toast(res.warning || 'Issued', res.warning ? 'warn' : ''); ctx.reload();
  } }] });
  return m;
}
function bulkDialog(ctx, types, players) {
  const m = modal({ title: 'Bulk issue a standard kit', wide: true, body: html`<form id="bf"><div class="grid g2"><div>${field('Players', html`<input type="search" id="bq" placeholder="Filter" style="margin-bottom:6px"><div style="max-height:300px;overflow-y:auto;border:1px solid var(--border-strong);border-radius:5px;padding:6px 10px">${players.map((p) => html`<label class="check" style="display:flex" data-n="${(p.name + ' ' + (p.team || '')).toLowerCase()}"><input type="checkbox" name="player_ids" data-multi data-num value="${p.id}"> ${p.name} <span class="faint">${p.team || ''}</span></label>`)}</div>`)}</div>
    <div>${field('Kit', html`${types.map((t) => html`<div class="inline-input" style="margin-bottom:6px"><label class="check" style="flex:1"><input type="checkbox" name="kit" data-multi data-num value="${t.id}"> ${t.name}</label><input name="size_${t.id}" placeholder="size" style="max-width:80px"></div>`)}`, 'Serialized items are picked automatically from available stock in that size (or any size if blank).')}</div></div></form>`,
  actions: [{ label: 'Cancel' }, { label: 'Issue kit', primary: true, onClick: async (r) => {
    const f = formData(r.querySelector('#bf'));
    const res = await api.post('/api/eq/bulk-issue', { player_ids: f.player_ids, kit: f.kit.map((t) => ({ type_id: t, size: f[`size_${t}`] || null })) });
    toast(`${res.issued} items issued${res.errors.length ? `, ${res.errors.length} could not be issued` : ''}`, res.errors.length ? 'warn' : '');
    if (res.errors.length) modal({ title: 'Not issued', body: html`<ul>${[...new Set(res.errors.map((e) => e.error))].map((e) => html`<li>${e}</li>`)}</ul>`, actions: [{ label: 'OK' }] });
    ctx.reload();
  } }] });
  m.root.querySelector('#bq').oninput = (e) => m.root.querySelectorAll('[data-n]').forEach((l) => { l.style.display = l.dataset.n.includes(e.target.value.toLowerCase()) ? 'flex' : 'none'; });
}

function scan(ctx) {
  const m = modal({ title: 'Scan or enter a tag', body: html`<video id="v" playsinline style="width:100%;max-height:240px;background:#000;border-radius:5px;display:none"></video>
    <div class="inline-input" style="margin-top:8px"><input id="code" placeholder="Serial number or ITEM-id"><button id="find" class="primary">Find</button></div><button class="sm" id="cam" style="margin-top:8px">Use camera</button><div id="res" style="margin-top:12px"></div>` });
  let stream;
  const find = async (code) => {
    try {
      const it = await api.get(`/api/eq/lookup?code=${encodeURIComponent(code)}`);
      set(m.root.querySelector('#res'), html`<div class="card"><div class="bd"><b>${it.type_name} ${it.serial || ''}</b><div class="s">Size ${it.size || '—'} · ${cap(it.condition)}</div>
        ${it.open_issue ? html`<p>Issued to <b>${it.open_issue.player_name}</b> on ${fmtDate(it.open_issue.issued_at)}</p>${ctx.me.caps['equipment.manage'] ? html`<button class="primary" id="ret">Check in</button>` : ''}` : html`<p>In stock.</p>`}</div></div>`);
      const r = m.root.querySelector('#ret'); if (r) r.onclick = () => { m.close(); returnDialog(ctx, it.open_issue.id, it.type_name); };
    } catch (e) { set(m.root.querySelector('#res'), html`<div class="notice bad">${e.message}</div>`); }
  };
  m.root.querySelector('#find').onclick = () => find(m.root.querySelector('#code').value);
  m.root.querySelector('#cam').onclick = async () => {
    if (!('BarcodeDetector' in window)) return toast('Camera scanning is not supported in this browser; type the code instead', 'warn');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = m.root.querySelector('#v'); v.srcObject = stream; v.style.display = 'block'; await v.play();
      const det = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
      const loop = async () => { if (!document.body.contains(v)) { stream.getTracks().forEach((t) => t.stop()); return; } const c = await det.detect(v).catch(() => []); if (c.length) { stream.getTracks().forEach((t) => t.stop()); v.style.display = 'none'; m.root.querySelector('#code').value = c[0].rawValue; find(c[0].rawValue); } else requestAnimationFrame(loop); };
      loop();
    } catch (e) { errToast(e); }
  };
}

async function mine(el, ctx) {
  const players = ctx.me.linked;
  const lists = await Promise.all(players.map((p) => api.get(`/api/eq/player/${p.id}`)));
  set(el, html`<div class="page-head"><div><h1>${ctx.me.user.role === 'parent' ? 'Equipment' : 'My gear'}</h1><div class="sub">What was issued and what is still out. Please confirm you received each item.</div></div></div>
    ${players.map((p, i) => html`<div class="card" style="margin-bottom:14px"><div class="hd"><h2>${p.name}</h2></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Item</th><th>Serial</th><th>Size</th><th>Issued</th><th>Status</th><th class="num">Replacement</th><th></th></tr></thead><tbody>
      ${lists[i].map((it) => html`<tr><td>${it.type_name}</td><td class="mono">${it.serial || ''}</td><td>${it.size || ''}</td><td>${fmtDate(it.issued_at, { dow: false })}</td><td>${it.returned_at ? html`<span class="badge ${it.return_status === 'lost' ? 'bad' : 'ok'}">${cap(it.return_status)}</span>` : html`<span class="badge warn">Out</span>`}</td><td class="num">$${Number(it.cost).toFixed(2)}</td>
        <td>${!it.returned_at ? (it.acknowledged_at ? html`<span class="badge ok">Confirmed</span>` : html`<button class="sm primary" data-ack="${it.id}">Confirm received</button>`) : ''}</td></tr>`)}</tbody></table>${!lists[i].length ? empty('Nothing issued.') : ''}</div></div>`)}`);
  on(el, 'click', '[data-ack]', async (e, b) => { await api.post(`/api/eq/issues/${b.dataset.ack}/ack`); toast('Thanks — confirmed'); ctx.reload(); });
}
