// RT-1..RT-3: custom routes. Draw once from a template player in the middle of the field (the route designer),
// then insert from the Route Menu in any play. Create, edit, rename, duplicate, delete. Smart Distance per route.
import { api } from '../api.js';
import { html, set, on, toast, errToast, confirmDialog, raw, empty } from '../ui.js';
import { pbTabs, bindMenu, inlineRename } from '../pb-ui.js';
import { customToDef, routePreview, ROUTE_LIBRARY, LIB_GROUPS, DEF_GROUPS } from '../pb-model.js';
import { icon } from '../icons.js';

export default async function routes(el, ctx) {
  if (ctx.route === '/playbook/route/:id/edit') return (await import('../playbook-designer.js')).routeDesigner(el, ctx, ctx.params.id);
  const [list, cfg] = await Promise.all([api.get('/api/pb/routes'), api.get('/api/playbook/config')]);
  const edit = cfg.can_edit;
  const groups = [...new Set(list.map((r) => r.grp || 'Custom'))].sort();
  set(el, html`<div class="page-head"><div><h1>Routes</h1><div class="sub">Custom routes appear in the Route Menu of the Play Designer, after the built-in groups. Draw them as run by a receiver on the left; the menu mirrors them for the right side.</div></div>
    <div class="actions">${edit ? html`<a class="btn primary" href="/playbook/route/new/edit">${icon('plus', 14)} Add Route</a>` : ''}</div></div>
    ${pbTabs('routes')}
    ${list.length ? groups.map((g) => html`<div class="pb-group">${g}</div><div class="pb-plays">${list.filter((r) => (r.grp || 'Custom') === g).map((r) => html`<div class="card pb-card" data-route="${r.id}" tabindex="0" role="link" aria-label="Open ${r.name}">
        <div class="bd row" style="padding:10px 12px;flex-wrap:nowrap">${raw(routePreview(customToDef(r)))}<div style="min-width:0"><div class="nm" data-rname>${r.name}</div>
          <div class="s muted" style="font-size:12px">${r.side === 'D' ? 'Defense' : 'Offense'}${r.smart ? ' · Smart Distance' : ''}</div></div></div>
        ${edit ? html`<div class="qa"><button class="sm icon" data-more aria-label="More actions">⋯</button></div>` : ''}</div>`)}</div>`)
    : empty(edit ? 'No custom routes yet. Add one to draw it from the template player.' : 'No custom routes yet.')}
    <details class="card" style="margin-top:24px"><summary class="hd" style="cursor:pointer"><h3>Built-in routes in the Route Menu</h3></summary><div class="bd">
      ${[...LIB_GROUPS, 'Quarterback', 'Running back', ...DEF_GROUPS].map((g) => html`<div class="pb-group" style="margin-top:4px">${g}</div><div class="rt-grid">${ROUTE_LIBRARY.filter((r) => r.grp === g).map((r) => html`<div class="card" style="display:flex;flex-direction:column;align-items:center;padding:6px;font-size:12px">${raw(routePreview(r))}<span>${r.name}</span></div>`)}</div>`)}
    </div></details>`);
  const open = (id) => ctx.navigate(`/playbook/route/${id}/edit`);
  on(el, 'click', '[data-route]', (e, t) => { if (!e.target.closest('button, input') && edit) open(Number(t.dataset.route)); });
  on(el, 'keydown', '[data-route]', (e, t) => { if (e.key === 'Enter' && e.target === t && edit) open(Number(t.dataset.route)); });
  if (!edit) return;
  bindMenu(el, '[data-route]', (t) => {
    const r = list.find((x) => x.id === Number(t.dataset.route));
    return [
      { label: 'Edit', onClick: () => open(r.id) },
      { label: 'Rename', onClick: () => inlineRename(t.querySelector('[data-rname]'), r.name, async (v) => { await api.put(`/api/pb/routes/${r.id}`, { name: v }); r.name = v; toast('Renamed'); }) },
      { label: 'Duplicate', onClick: async () => { try { await api.post(`/api/pb/routes/${r.id}/duplicate`); toast(`Created ${r.name} (Copy)`); ctx.reload(); } catch (err) { errToast(err); } } },
      '-',
      { label: 'Delete', danger: true, onClick: async () => { if (await confirmDialog(`Delete the route “${r.name}”? Plays that already use it keep their routes.`, { danger: true, ok: 'Delete' })) { await api.del(`/api/pb/routes/${r.id}`); ctx.reload(); } } },
    ];
  });
}
