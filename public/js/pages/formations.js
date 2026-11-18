// FM-1..FM-3: saved formations for offense and defense. Create (+ Add Formation), open to edit in the designer,
// rename inline or from the right-click menu, duplicate ("(Copy)"), delete. "Linemen Base" is built in and always first.
// The head coach sets the cap (25 / 250 / unlimited).
import { api } from '../api.js';
import { html, set, $, on, modal, toast, errToast, field, options, confirmDialog, raw, empty } from '../ui.js';
import { renderPlay, setPositions, normalizePlay } from '../field.js';
import { pbTabs, bindMenu, inlineRename } from '../pb-ui.js';
import { linemenBase } from '../pb-model.js';
import { icon } from '../icons.js';

export default async function formations(el, ctx) {
  if (ctx.route === '/playbook/formation/:id/edit') return (await import('../playbook-designer.js')).formationDesigner(el, ctx, ctx.params.id);
  const side = ctx.query.side === 'defense' ? 'defense' : 'offense';
  const [list, positions, cfg] = await Promise.all([api.get('/api/formations'), api.get('/api/pb/positions'), api.get('/api/playbook/config')]);
  setPositions(positions);
  const edit = cfg.can_edit;
  const mine = list.filter((f) => (f.side || 'offense') === side).sort((a, b) => a.name.localeCompare(b.name));
  const limit = cfg.formation_limit;
  const pic = (players) => renderPlay(normalizePlay({ players, ball: { x: 50, y: 31.2 } }));
  set(el, html`<div class="page-head"><div><h1>Formations</h1><div class="sub">Place players once and load the formation into any play: no placing players one by one, and the same alignment every time.</div></div>
    <div class="actions">${edit ? html`<a class="btn primary" href="/playbook/formation/new/edit?side=${side}">${icon('plus', 14)} Add Formation</a>` : ''}</div></div>
    ${pbTabs('formations')}
    <div class="filters"><div class="seg" role="tablist">${['offense', 'defense'].map((s) => html`<button data-side="${s}" class="${s === side ? 'on' : ''}" role="tab" aria-selected="${s === side}">${s === 'offense' ? 'Offense' : 'Defense'}</button>`)}</div>
      <span class="muted" style="font-size:13px">${list.length} saved${limit ? ` of ${limit} allowed` : ''}</span>
      ${cfg.is_admin ? html`<label class="muted" for="cap" style="font-size:13px;margin-left:auto">Formation limit</label><select id="cap" style="min-width:0">${options([['', 'Unlimited'], ['25', '25'], ['250', '250']], limit ? String(limit) : '')}</select>` : ''}</div>
    <div class="pb-plays">
      <div class="card pb-card" data-base tabindex="0" role="link" aria-label="Linemen Base"><div class="play-thumb no-copy">${raw(pic(linemenBase(side, positions)))}</div>
        <div class="bd" style="padding:8px 10px"><div class="nm">Linemen Base</div><div class="s muted" style="font-size:12px">Built in · always first</div></div></div>
      ${mine.map((f) => html`<div class="card pb-card" data-form="${f.id}" tabindex="0" role="link" aria-label="Open ${f.name}"><div class="play-thumb no-copy">${raw(pic(f.data || []))}</div>
        <div class="bd" style="padding:8px 10px"><div class="nm" data-fname>${f.name}</div><div class="s muted" style="font-size:12px">${(f.data || []).length} players</div></div>
        ${edit ? html`<div class="qa"><button class="sm icon" data-more aria-label="More actions">⋯</button></div>` : ''}</div>`)}
    </div>
    ${!mine.length ? html`<div style="margin-top:12px">${empty(`No saved ${side} formations yet.${edit ? ' Add one, or save the players of a play as a formation from the Play Designer.' : ''}`)}</div>` : ''}`);
  const open = (id) => ctx.navigate(`/playbook/formation/${id}/edit`);
  on(el, 'click', '[data-side]', (e, b) => ctx.navigate(`/playbook/formations?side=${b.dataset.side}`));
  on(el, 'click', '[data-form]', (e, t) => { if (!e.target.closest('button, input') && edit) open(Number(t.dataset.form)); });
  on(el, 'keydown', '[data-form]', (e, t) => { if (e.key === 'Enter' && e.target === t && edit) open(Number(t.dataset.form)); });
  on(el, 'click', '[data-base]', () => toast('Linemen Base is built in: the front five, always first in every play’s formation list.'));
  if ($('#cap', el)) $('#cap', el).onchange = async (e) => { try { await api.put('/api/program', { settings: { formation_limit: e.target.value ? Number(e.target.value) : null } }); toast('Formation limit saved'); ctx.reload(); } catch (err) { errToast(err); } };
  if (!edit) return;
  bindMenu(el, '[data-form]', (t) => {
    const f = mine.find((x) => x.id === Number(t.dataset.form));
    return [
      { label: 'Open', onClick: () => open(f.id) },
      { label: 'Rename', onClick: () => inlineRename(t.querySelector('[data-fname]'), f.name, async (v) => { await api.put(`/api/formations/${f.id}`, { name: v }); f.name = v; toast('Renamed'); }) },
      { label: 'Duplicate', onClick: async () => { try { await api.post(`/api/formations/${f.id}/duplicate`); toast(`Created ${f.name} (Copy)`); ctx.reload(); } catch (err) { errToast(err); } } },
      '-',
      { label: 'Delete', danger: true, onClick: async () => { if (await confirmDialog(`Delete the formation “${f.name}”? Plays that use it keep their players.`, { danger: true, ok: 'Delete' })) { await api.del(`/api/formations/${f.id}`); ctx.reload(); } } },
    ];
  });
}
