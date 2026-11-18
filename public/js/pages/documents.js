// C-23 document sharing (files up to 5 MB or links, shared to an audience, viewed-by tracking)
// and the F-17 weekly parent digest preview.
import { api } from '../api.js';
import { html, set, $, on, modal, toast, errToast, formData, field, audienceField, wireAudience, fmtDT, ago, empty, readFileAsDataURL, ROLE } from '../ui.js';
import { icon } from '../icons.js';
import { mtabs } from './messages.js';

export default async function documents(el, ctx) {
  if (ctx.route === '/messages/digest') return digest(el, ctx);
  const list = await api.get('/api/fb/docs');
  const canShare = ctx.me.caps['messages.send'];
  const size = (n) => (n == null ? '' : n > 1e6 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  set(el, html`<div class="page-head"><div><h1>Messages</h1><div class="sub">Documents and links shared with the team. ${canShare ? 'You can see who opened each one.' : ''}</div></div>
    <div class="actions">${canShare ? html`<button class="primary" id="share">${icon('upload', 14)} Share a document</button>` : ''}</div></div>
    ${mtabs(ctx, 'docs')}
    <div class="card">${list.length ? html`<ul class="list">${list.map((d) => html`<li>
      <span class="badge">${d.type}</span>
      <div class="grow"><div class="t">${d.title} ${!d.viewed_at && d.by_user !== ctx.me.user.id ? html`<span class="badge blue">New</span>` : ''}</div>
        <div class="s">${d.description ? `${d.description} · ` : ''}${d.by_name} · ${ago(d.at)} · ${d.audience_labels.join(', ')}${d.size ? ` · ${size(d.size)}` : ''}</div></div>
      ${d.views !== undefined ? html`<button class="sm ghost" data-views="${d.id}">${d.views} of ${d.recipients} opened</button>` : ''}
      ${d.kind === 'file' ? html`<a class="btn sm" href="/api/fb/docs/${d.id}/file" target="_blank" rel="noopener" data-open="${d.id}">Open</a>` : html`<button class="sm" data-link="${d.id}">${icon('external', 13)} Open link</button>`}
      ${d.can_manage ? html`<button class="sm ghost danger" data-del="${d.id}" aria-label="Remove">✕</button>` : ''}</li>`)}</ul>` : empty('Nothing shared yet.')}</div>`);
  on(el, 'click', '[data-link]', async (e, b) => {
    try { const r = await api.post(`/api/fb/docs/${b.dataset.link}/open`); window.open(r.url, '_blank', 'noopener'); } catch (err) { errToast(err); }
  });
  on(el, 'click', '[data-del]', async (e, b) => { await api.del(`/api/fb/docs/${b.dataset.del}`); toast('Removed'); ctx.reload(); });
  on(el, 'click', '[data-views]', async (e, b) => {
    const r = await api.get(`/api/fb/docs/${b.dataset.views}/views`);
    const seen = r.recipients.filter((x) => x.viewed_at);
    modal({ title: 'Viewed by', wide: true, body: html`<p class="muted">${seen.length} of ${r.recipients.length} opened${r.staff_views ? ` · ${r.staff_views} staff` : ''}.</p>
      <ul class="list" style="margin:0 -16px -16px;max-height:420px;overflow-y:auto">${r.recipients.map((x) => html`<li><span class="dot ${x.viewed_at ? 'ok' : ''}"></span><span class="grow">${x.name}</span><span class="s">${ROLE[x.role]}</span><span class="s" style="width:130px;text-align:right">${x.viewed_at ? fmtDT(x.viewed_at) : 'Not opened'}</span></li>`)}</ul>`, actions: [{ label: 'Close' }] });
  });
  if ($('#share', el)) $('#share', el).onclick = async () => {
    const auds = await api.get('/api/audiences');
    let file = null;
    const m = modal({
      title: 'Share a document', wide: true,
      body: html`<form id="df"><div class="seg" style="margin-bottom:10px"><button type="button" class="on" data-kind="file">File</button><button type="button" data-kind="link">Link</button></div>
        <div id="kfile">${field('File (PDF, image, document, spreadsheet or slides; up to 5 MB)', html`<input type="file" id="f" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv">`)}</div>
        <div id="klink" hidden>${field('Link', html`<input name="url" type="url" placeholder="https://">`)}</div>
        ${field('Title', html`<input name="title" required>`)}${field('Description', html`<input name="description">`)}
        ${field('Share with', audienceField('audience', auds, []))}</form>`,
      actions: [{ label: 'Cancel' }, { label: 'Share', primary: true, onClick: async (r) => {
        const f = formData(r.querySelector('#df'));
        const kind = r.querySelector('[data-kind].on').dataset.kind;
        const body = { title: f.title, description: f.description, audience: f.audience || [], kind };
        if (kind === 'link') body.url = f.url;
        else { if (!file) { toast('Choose a file', 'warn'); return false; } body.data = file.data; body.filename = file.name; }
        await api.post('/api/fb/docs', body);
        toast('Shared'); ctx.reload();
      } }],
    });
    wireAudience(m.root);
    on(m.root, 'click', '[data-kind]', (e, b) => {
      m.root.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
      m.root.querySelector('#kfile').hidden = b.dataset.kind !== 'file'; m.root.querySelector('#klink').hidden = b.dataset.kind !== 'link';
    });
    m.root.querySelector('#f').onchange = async (e) => {
      const fl = e.target.files[0]; if (!fl) return;
      try { file = { name: fl.name, data: await readFileAsDataURL(fl, 5 * 1024 * 1024) }; const t = m.root.querySelector('[name=title]'); if (!t.value) t.value = fl.name.replace(/\.[^.]+$/, ''); } catch (err) { file = null; errToast(err); }
    };
  };
}

async function digest(el, ctx) {
  const q = ctx.query;
  const d = await api.get(`/api/fb/digest/preview${q.parent_id ? `?parent_id=${q.parent_id}` : ''}`);
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  set(el, html`<div class="page-head"><div><h1>Messages</h1><div class="sub">Weekly email to every parent with their athlete's schedule, attendance and progress.</div></div>
    <div class="actions">${ctx.me.caps.admin ? html`<button id="send">Send this week's digest now</button>` : ''}</div></div>
    ${mtabs(ctx, 'digest')}
    <div class="notice ${d.enabled ? '' : 'warn'}">${d.enabled ? `Sends automatically every ${DOW[d.digest_day] || 'Sunday'} after ${d.digest_time}, once per parent per week. ${d.sent_this_week} sent this week.` : 'The weekly digest is turned off in program settings.'}</div>
    <div class="card"><div class="hd"><h2>Preview for ${d.parent.name}</h2><span class="r faint" style="font-size:12px">${d.parent.email || 'no email on file'}</span></div><div class="bd">
      <div class="faint" style="font-size:12px;margin-bottom:6px">Subject</div><div style="margin-bottom:12px"><b>${d.subject}</b></div>
      <div class="faint" style="font-size:12px;margin-bottom:6px">Message</div><pre class="fb-digest">${d.body}</pre></div></div>`);
  if ($('#send', el)) $('#send', el).onclick = async () => { try { const r = await api.post('/api/fb/digest/send'); toast(`Sent to ${r.sent} parent(s)${r.skipped ? `; ${r.skipped} already had this week's digest` : ''}`); ctx.reload(); } catch (err) { errToast(err); } };
}
