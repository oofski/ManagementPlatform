// C-17 team feed: automatic PR posts, milestone clubs and weekly awards (F-19), plus coach posts.
// Players and parents see posts for their team and the whole program; coaches post and remove.
import { api } from '../api.js';
import { html, set, $, on, toast, errToast, formData, options, field, empty, ago, confirmDialog } from '../ui.js';

const KIND = { pr: ['PR', 'ok'], milestone: ['Milestone', 'green'], award: ['Weekly award', 'blue'], coach: ['Coach', ''] };

export default async function feedPage(el, ctx) {
  set(el, html`<div class="page-head"><div><h1>Team feed</h1><div class="sub">Personal records, milestone clubs, weekly awards and posts from coaches.</div></div>${ctx.me.caps.staff ? html`<div class="actions"><a class="btn" href="/weights">Weight room</a></div>` : ''}</div><div id="feedbox"></div>`);
  return renderFeed($('#feedbox', el), ctx);
}

export async function renderFeed(box, ctx) {
  const staff = ctx.me.caps.staff;
  const [m, f] = await Promise.all([api.get('/api/strength/meta'), api.get(`/api/strength/feed?${new URLSearchParams({ team_id: ctx.query.team || '', kind: ctx.query.kind || '' })}`)]);
  const go = (q) => ctx.navigate(`${location.pathname}?${new URLSearchParams(Object.fromEntries(Object.entries({ ...ctx.query, ...q }).filter(([, v]) => v)))}`);
  set(box, html`<div class="grid g-side wr-grid"><div>
      <div class="filters">${staff ? html`<select id="ft"><option value="">All teams</option>${options(m.teams.map((t) => [t.id, t.name]), ctx.query.team)}</select>` : ''}<select id="fk"><option value="">All posts</option>${options(Object.entries(KIND).map(([k, v]) => [k, v[0]]), ctx.query.kind)}</select></div>
      <div class="card">${f.posts.length ? html`<ul class="list">${f.posts.map((p) => html`<li style="align-items:flex-start"><span class="badge ${KIND[p.kind]?.[1] || ''}" style="margin-top:2px">${KIND[p.kind]?.[0] || p.kind}</span>
        <div class="grow"><div class="t">${p.title}</div>${p.body ? html`<div class="s" style="white-space:pre-wrap">${p.body}</div>` : ''}<div class="s faint">${p.team} · ${p.by_name ? `${p.by_name} · ` : ''}${ago(p.at)}</div></div>
        ${f.can_post ? html`<button class="sm ghost danger" data-rm="${p.id}">Remove</button>` : ''}</li>`)}</ul>` : empty('Nothing posted yet. PRs, milestones and weekly awards show up here on their own.')}</div></div>
    <div class="stack">${f.can_post ? html`<div class="card"><div class="hd"><h3>Post to the feed</h3></div><div class="bd"><form id="pf">${field('Headline', html`<input name="title" maxlength="200" required>`)}${field('Details', html`<textarea name="body" maxlength="2000"></textarea>`)}
        ${field('Who sees it', html`<select name="team_id"><option value="">Whole program</option>${options(m.teams.map((t) => [t.id, t.name]))}</select>`)}<button class="primary">Post</button></form></div></div>
      <div class="card"><div class="hd"><h3>Weekly awards</h3></div><div class="bd"><p class="s muted" style="margin-top:0">Posted every Monday morning for the week before: most sets logged and most PRs, per team.</p><button class="sm" id="aw">Post last week's awards now</button></div></div>` : ''}
      <div class="card"><div class="hd"><h3>Milestone clubs</h3></div><ul class="list">${m.clubs.map((c) => html`<li><span class="grow">${c.labels.join(' · ')}</span></li>`)}</ul></div></div></div>`);
  if ($('#ft', box)) $('#ft', box).onchange = (e) => go({ team: e.target.value });
  $('#fk', box).onchange = (e) => go({ kind: e.target.value });
  if ($('#pf', box)) $('#pf', box).onsubmit = async (e) => { e.preventDefault(); const v = formData(e.target); try { await api.post('/api/strength/feed', { ...v, team_id: v.team_id ? Number(v.team_id) : null }); toast('Posted'); ctx.reload(); } catch (err) { errToast(err); } };
  if ($('#aw', box)) $('#aw', box).onclick = async () => { try { const r = await api.post('/api/strength/awards', {}); toast(r.posted ? `Posted ${r.posted} award(s)` : 'Awards for last week are already posted'); ctx.reload(); } catch (err) { errToast(err); } };
  on(box, 'click', '[data-rm]', async (e, b) => { if (await confirmDialog('Remove this post from the feed?', { danger: true, ok: 'Remove' })) { await api.del(`/api/strength/feed/${b.dataset.rm}`); ctx.reload(); } });
}
