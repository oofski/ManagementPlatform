// PS-1..PS-3: playbook positions. Name, letter (up to three characters), color and abbreviation (up to four,
// reserved for future features). Plays and formations look positions up by id when they are drawn, so an edit here
// shows up in every play and formation at once. "Mirror" pairs drive Smart Flip (PD-15).
import { api } from '../api.js';
import { html, set, $, on, toast, errToast, options, confirmDialog, raw, modal, field, formData } from '../ui.js';
import { renderPlay, setPositions, COLOR_KEYS } from '../field.js';
import { pbTabs } from '../pb-ui.js';
import { icon } from '../icons.js';

const COLOR_LABEL = { default: 'Default', blue: 'Blue', red: 'Red', green: 'Green', orange: 'Orange', purple: 'Purple', yellow: 'Yellow' };
const chip = (pos) => {
  setPositions([pos]);
  const svg = renderPlay({ players: [{ id: 'x', team: pos.side, type: 'circle_letter', position_id: pos.id, x: 50, y: 30 }], view: 'offense' }, { theme: 'grass' });
  return svg.replace('viewBox="0 0 100 60"', 'viewBox="46.6 26.6 6.8 6.8" width="30" height="30"');
};

export default async function positionsPage(el, ctx) {
  const [list, cfg] = await Promise.all([api.get('/api/pb/positions'), api.get('/api/playbook/config')]);
  const edit = cfg.can_edit;
  const side = ctx.query.side === 'D' ? 'D' : 'O';
  const rows = list.filter((p) => p.side === side);
  set(el, html`<div class="page-head"><div><h1>Positions</h1><div class="sub">Changes apply across the whole account: every play and formation that uses a position picks up its new name, letter and color.</div></div>
    <div class="actions">${edit ? html`<button class="primary" id="add">${icon('plus', 14)} Add position</button>` : ''}</div></div>
    ${pbTabs('positions')}
    <div class="filters"><div class="seg" role="tablist">${[['O', 'Offense'], ['D', 'Defense']].map(([k, l]) => html`<button data-side="${k}" class="${k === side ? 'on' : ''}" role="tab" aria-selected="${k === side}">${l}</button>`)}</div></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th></th><th>Name</th><th>Letter</th><th>Color</th><th>Abbreviation</th><th title="Smart Flip keeps these on their side">Mirror (Smart Flip)</th><th>Center</th><th></th></tr></thead><tbody>
      ${rows.map((p) => html`<tr data-pos="${p.id}">
        <td style="width:40px">${raw(chip(p))}</td>
        <td><input data-k="name" value="${p.name}" ${edit ? '' : raw('disabled')} aria-label="Name" style="min-width:140px"></td>
        <td><input data-k="letter" value="${p.letter || ''}" maxlength="3" ${edit ? '' : raw('disabled')} aria-label="Letter" style="width:64px"></td>
        <td><select data-k="color" ${edit ? '' : raw('disabled')} aria-label="Color">${options(COLOR_KEYS.map((k) => [k, COLOR_LABEL[k]]), p.color || 'default')}</select></td>
        <td><input data-k="abbr" value="${p.abbr || ''}" maxlength="4" ${edit ? '' : raw('disabled')} aria-label="Abbreviation" style="width:72px"></td>
        <td><select data-k="mirror_id" ${edit ? '' : raw('disabled')} aria-label="Mirror position"><option value="">None</option>${options(rows.filter((x) => x.id !== p.id).map((x) => [x.id, x.name]), p.mirror_id ?? '')}</select></td>
        <td>${side === 'O' ? html`<input type="checkbox" data-k="is_center" ${p.is_center ? raw('checked') : ''} ${edit ? '' : raw('disabled')} aria-label="Center">` : ''}</td>
        <td>${edit ? html`<button class="sm ghost danger" data-del="${p.id}" aria-label="Delete ${p.name}">Delete</button>` : ''}</td></tr>`)}
    </tbody></table></div></div>
    <p class="help" style="margin-top:8px">Letters show when a player’s type includes a letter. Default color is white on the Grass theme and black on Paper. The abbreviation is saved for future features and is not shown on plays yet. Dragging the center slides the whole formation.</p>`);
  on(el, 'click', '[data-side]', (e, b) => ctx.navigate(`/playbook/positions?side=${b.dataset.side}`));
  if (!edit) return;
  el.addEventListener('change', async (e) => {
    const tr = e.target.closest('[data-pos]'); const k = e.target.dataset.k; if (!tr || !k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    try {
      await api.put(`/api/pb/positions/${tr.dataset.pos}`, { [k]: k === 'mirror_id' ? (v ? Number(v) : null) : v });
      const p = rows.find((x) => x.id === Number(tr.dataset.pos)); p[k] = v;
      if (k === 'letter' || k === 'color') tr.querySelector('td').innerHTML = chip(p);
      toast('Saved. Every play using this position is updated.');
    } catch (err) { errToast(err); }
  });
  on(el, 'click', '[data-del]', async (e, b) => {
    const p = rows.find((x) => x.id === Number(b.dataset.del));
    if (!(await confirmDialog(`Delete the position “${p.name}”? Players that use it keep their spot but lose the position’s color and letter.`, { danger: true, ok: 'Delete' }))) return;
    await api.del(`/api/pb/positions/${p.id}`); ctx.reload();
  });
  $('#add', el).onclick = () => modal({ title: 'Add position', body: html`<form id="af" onsubmit="return false">${field('Name', html`<input name="name" required placeholder="Halfback">`)}
      <div class="fields">${field('Letter', html`<input name="letter" maxlength="3">`)}${field('Abbreviation', html`<input name="abbr" maxlength="4">`)}</div>
      ${field('Color', html`<select name="color">${options(COLOR_KEYS.map((k) => [k, COLOR_LABEL[k]]), 'default')}</select>`)}</form>`,
  actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: async (r) => { await api.post('/api/pb/positions', { ...formData(r.querySelector('#af')), side }); ctx.reload(); } }] });
}
