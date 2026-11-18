// Module 7: Communication — announcements with read receipts, group chats under the two-adult rule,
// question threads that add a second adult, quiet-hours delivery, moderation, contact blocks, polls, reactions.
import { api } from '../api.js';
import { html, set, $, on, modal, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDT, ago, cap, empty, confirmDialog, tabs, ROLE, readFileAsDataURL, raw } from '../ui.js';

const REACT = ['👍', '👏', '💪', '✅', '❤️', '🏈'];
export default async function messages(el, ctx) {
  const r = ctx.route;
  if (r === '/messages/announcements' || r === '/messages/announcements/:id') return announcements(el, ctx);
  if (r === '/messages/moderation') return moderation(el, ctx);
  return chats(el, ctx, ctx.params.id ? Number(ctx.params.id) : null);
}
const mtabs = (ctx, a) => tabs([['chats', 'Chats', '/messages'], ['ann', 'Announcements', '/messages/announcements'], ...(ctx.me.caps.admin || ctx.me.caps['chats.read_all'] || ctx.me.user.role === 'parent' ? [['mod', ctx.me.user.role === 'parent' ? 'Contact requests' : 'Moderation', '/messages/moderation']] : [])], a);

async function chats(el, ctx, chatId) {
  const all = ctx.query.all === '1';
  const list = await api.get(`/api/chats${all ? '?all=1' : ''}`);
  const staff = ctx.me.caps.staff;
  if (!chatId && list.length && window.innerWidth > 760) chatId = list[0].id;
  set(el, html`<div class="page-head"><div><h1>Messages</h1><div class="sub">Every chat has at least two adults and every message is saved. ${staff ? `Messages to players are delivered between ${ctx.me.settings.quiet_start} and ${ctx.me.settings.quiet_end}.` : ''}</div></div>
    <div class="actions">${ctx.me.caps.admin || ctx.me.caps['chats.read_all'] ? html`<a class="btn" href="${all ? '/messages' : '/messages?all=1'}">${all ? 'My chats' : 'All chats (oversight)'}</a>` : ''}
      ${ctx.me.caps['messages.send'] ? html`<button class="primary" id="new">New chat</button>` : html`<button class="primary" id="ask">Ask a coach</button>`}</div></div>
    ${mtabs(ctx, 'chats')}
    <div class="card chat"><div class="chats">${list.length ? html`<ul class="list">${list.map((c) => html`<li class="click ${c.id === chatId ? 'type-practice' : ''}" onclick="__navigate('/messages/chat/${c.id}${all ? '?all=1' : ''}')">
      <div class="grow"><div class="t">${c.name} ${c.locked ? html`<span class="badge">Locked</span>` : ''}</div><div class="s" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.last ? `${c.last.name}: ${c.last.body || 'attachment'}` : 'No messages yet'}</div></div>
      ${c.unread ? html`<span class="badge bad">${c.unread}</span>` : ''}</li>`)}</ul>` : empty('No chats yet.')}</div>
      <div class="thread" id="thread">${chatId ? '' : empty('Choose a chat.')}</div></div>`);
  if ($('#new', el)) $('#new', el).onclick = () => newChat(ctx);
  if ($('#ask', el)) $('#ask', el).onclick = () => askCoach(ctx);
  if (chatId) thread($('#thread', el), ctx, chatId);
}

async function thread(box, ctx, id) {
  let chat;
  try { chat = await api.get(`/api/chats/${id}`); } catch (e) { set(box, html`<div class="notice bad" style="margin:14px">${e.message}</div>`); return; }
  const staff = ctx.me.caps.staff; const admin = chat.can_moderate;
  let msgs = [];
  set(box, html`<div class="row" style="padding:10px 14px;border-bottom:1px solid var(--border)"><div class="grow"><b>${chat.name}</b><div class="s muted">${chat.member_count} members · ${chat.adults} adults${chat.audience_labels.length ? ` · ${chat.audience_labels.join(', ')}` : ''}</div></div>
      <button class="sm" id="mem">Members</button>${admin ? html`<button class="sm" id="lock">${chat.locked ? 'Unlock' : 'Lock chat'}</button>` : ''}</div>
    ${chat.adults < 2 ? html`<div class="notice bad" style="margin:10px">This chat has fewer than two adults; messages are blocked until another adult is added.</div>` : ''}
    <div class="msgs" id="msgs"></div>
    ${chat.member && (!chat.locked || admin) && !chat.muted ? html`<form class="compose" id="cf">
      <textarea name="body" placeholder="Write a message" rows="1"></textarea>
      ${chat.files_allowed ? html`<label class="btn sm" title="Attach a photo or file">Attach<input type="file" id="att" hidden></label>` : ''}
      ${staff ? html`<button type="button" class="sm" id="poll">Poll</button><label class="check" title="Emergency messages ignore quiet hours"><input type="checkbox" name="emergency"> Emergency</label>` : ''}
      <button class="primary">Send</button></form>` : html`<div class="compose muted">${chat.muted ? 'You are muted in this chat.' : chat.locked ? 'This chat is locked.' : 'You are viewing this chat for oversight.'}</div>`}`);
  const list = $('#msgs', box);
  let attachment = null;
  const draw = () => {
    set(list, msgs.length ? msgs.map((m) => html`<div class="msg ${m.user_id === ctx.me.user.id ? 'mine' : ''} ${m.removed ? 'removed' : ''} ${m.hidden ? 'hidden' : ''} ${m.emergency ? 'emergency' : ''}" data-mid="${m.id}">
      <div class="meta">${m.name} · ${ROLE[m.role]} · ${ago(m.at)}${m.pending ? html` · <span class="badge warn">Delivers ${fmtDT(m.deliver_at)}</span>` : ''}${m.emergency ? html` <span class="badge bad">Emergency</span>` : ''}${m.flagged ? html` <span class="badge bad">Flagged</span>` : ''}${m.hidden ? html` <span class="badge">Hidden by admin</span>` : ''}${m.removed_by_sender ? html` <span class="badge">Removed by sender</span>` : ''}</div>
      <div class="bubble">${m.removed ? 'Message removed' : m.body || ''}${m.attachment ? (m.attachment.startsWith('data:image') ? html`<div><img src="${m.attachment}" alt="attachment" style="max-width:240px;border-radius:5px;margin-top:4px"></div>` : html`<div><a href="${m.attachment}" download>Download attachment</a></div>`) : ''}
        ${m.poll ? html`<div style="margin-top:6px"><b>${m.poll.question}</b>${m.poll.options.map((o, i) => html`<div><button class="sm ${m.poll.my_vote === i ? 'primary' : ''}" data-vote="${i}" style="margin-top:3px">${o.label} · ${o.votes}</button></div>`)}</div>` : ''}</div>
      <div class="row" style="gap:4px;margin-top:2px">${(m.reactions || []).map((r) => html`<span class="badge ${r.mine ? 'green' : ''}">${r.emoji} ${r.n}</span>`)}
        ${!m.removed && chat.member ? html`<button class="sm ghost" data-react>+</button>` : ''}
        ${m.user_id === ctx.me.user.id && !m.removed_by_sender ? html`<button class="sm ghost" data-remove>Remove</button>` : ''}
        ${m.user_id !== ctx.me.user.id ? html`<button class="sm ghost" data-report>Report</button>` : ''}
        ${admin ? html`<button class="sm ghost" data-hide="${m.hidden ? 0 : 1}">${m.hidden ? 'Unhide' : 'Hide'}</button>` : ''}</div></div>`) : empty('No messages yet. Say hello.'));
    list.scrollTop = list.scrollHeight;
  };
  const load = async () => { try { msgs = await api.get(`/api/chats/${id}/messages`); draw(); } catch { /* offline */ } };
  await load();
  const timer = setInterval(() => { if (!document.body.contains(box)) return clearInterval(timer); load(); }, 10000);
  const cf = $('#cf', box);
  if (cf) {
    cf.onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(cf);
      try {
        const r = await api.post(`/api/chats/${id}/messages`, { body: f.body, emergency: f.emergency, attachment });
        cf.reset(); attachment = null;
        if (!r.delivered) toast(`Quiet hours: delivers ${fmtDT(r.deliver_at)}`, 'warn');
        if (r.flagged) toast('This message was flagged for admin review', 'warn');
        load();
      } catch (err) { errToast(err); }
    };
    cf.querySelector('textarea').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); cf.requestSubmit(); } });
    if ($('#att', box)) $('#att', box).onchange = async (e) => { try { attachment = await readFileAsDataURL(e.target.files[0]); toast('Attachment ready — press Send'); } catch (err) { errToast(err); } };
    if ($('#poll', box)) $('#poll', box).onclick = () => modal({ title: 'New poll', body: html`<form id="pf">${field('Question', html`<input name="q" required>`)}${field('Options (one per line)', html`<textarea name="o">Yes\nNo</textarea>`)}</form>`, actions: [{ label: 'Cancel' }, { label: 'Post poll', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#pf')); await api.post(`/api/chats/${id}/messages`, { poll: { question: f.q, options: f.o.split('\n').map((x) => x.trim()).filter(Boolean) } }); load(); } }] });
  }
  const mid = (b) => Number(b.closest('[data-mid]').dataset.mid);
  on(list, 'click', '[data-remove]', async (e, b) => { if (await confirmDialog('Remove this message from view? Admins keep the original record.')) { await api.del(`/api/messages/${mid(b)}`); load(); } });
  on(list, 'click', '[data-report]', (e, b) => modal({ title: 'Report message', body: html`<form id="rf">${field('What is the concern?', html`<textarea name="reason"></textarea>`)}</form>`, actions: [{ label: 'Cancel' }, { label: 'Report', primary: true, onClick: async (r) => { await api.post(`/api/messages/${mid(b)}/report`, formData(r.querySelector('#rf'))); toast('Reported to the program admins'); } }] }));
  on(list, 'click', '[data-hide]', async (e, b) => { await api.post(`/api/messages/${mid(b)}/hide`, { hidden: b.dataset.hide === '1' }); load(); });
  on(list, 'click', '[data-vote]', async (e, b) => { await api.post(`/api/messages/${mid(b)}/vote`, { option: Number(b.dataset.vote) }); load(); });
  on(list, 'click', '[data-react]', (e, b) => { const m = modal({ title: 'React', body: html`<div class="row">${REACT.map((r) => html`<button data-e="${r}" style="font-size:20px">${r}</button>`)}</div>` }); on(m.root, 'click', '[data-e]', async (ev, x) => { await api.post(`/api/messages/${mid(b)}/react`, { emoji: x.dataset.e }); m.close(); load(); }); });
  $('#mem', box).onclick = () => {
    const m = modal({ title: 'Members', body: html`<p class="muted">Phone numbers and email addresses are never shown to members.</p><ul class="list" style="margin:0 -16px">${chat.members.map((u) => html`<li><span class="grow">${u.name}</span><span class="s">${ROLE[u.role]}</span>${u.muted ? html`<span class="badge">Muted</span>` : ''}${admin && u.id !== ctx.me.user.id ? html`<button class="sm" data-mute="${u.id}" data-v="${u.muted ? 0 : 1}">${u.muted ? 'Unmute' : 'Mute'}</button><button class="sm danger" data-kick="${u.id}">Remove</button>` : ''}</li>`)}</ul>`, actions: [{ label: 'Close' }] });
    on(m.root, 'click', '[data-mute]', async (ev, x) => { await api.post(`/api/chats/${id}/members/${x.dataset.mute}/mute`, { muted: x.dataset.v === '1' }); m.close(); thread(box, ctx, id); });
    on(m.root, 'click', '[data-kick]', async (ev, x) => { try { await api.del(`/api/chats/${id}/members/${x.dataset.kick}`); m.close(); thread(box, ctx, id); } catch (err) { errToast(err); } });
  };
  if ($('#lock', box)) $('#lock', box).onclick = async () => { await api.post(`/api/chats/${id}/lock`, { locked: !chat.locked }); thread(box, ctx, id); };
}

async function newChat(ctx) {
  const auds = await api.get('/api/audiences');
  const m = modal({ title: 'New group chat', wide: true, body: html`<form id="nf"><div class="fields">${field('Name', html`<input name="name" required placeholder="WR room">`)}${field('Kind', html`<select name="kind">${options([['team', 'Team'], ['unit', 'Unit'], ['position', 'Position group'], ['group', 'Custom group'], ['staff', 'Staff only']], 'group')}</select>`)}</div>
    ${field('Members come from', audienceField('audience', auds, []))}
    <div class="row"><label class="check"><input type="checkbox" name="allow_players" checked> Include players</label><label class="check"><input type="checkbox" name="allow_parents"> Include their parents</label><label class="check"><input type="checkbox" name="allow_files" checked> Allow photos and files</label></div>
    <p class="help">The coaches who cover these groups join automatically. A chat needs at least two adults.</p></form>`,
  actions: [{ label: 'Cancel' }, { label: 'Create chat', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#nf')); const res = await api.post('/api/chats', f); toast(`Chat created with ${res.members} members`); ctx.navigate(`/messages/chat/${res.id}`); } }] });
  wireAudience(m.root);
}
async function askCoach(ctx) {
  const coaches = await api.get('/api/directory');
  modal({ title: 'Ask a coach', body: html`<p class="muted">Questions go in a saved thread that automatically includes a second adult (${ctx.me.user.role === 'player' ? 'your parent or another coach' : 'you and the coach'}).</p>
    <form id="af">${field('Coach', html`<select name="coach_id">${options(coaches.map((c) => [c.id, `${c.name}${c.title ? ` · ${c.title}` : ''}`]))}</select>`)}${field('Question', html`<textarea name="text" required></textarea>`)}</form>`,
  actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onClick: async (r) => { const res = await api.post('/api/chats/question', formData(r.querySelector('#af'))); toast('Question sent'); ctx.navigate(`/messages/chat/${res.id}`); } }] });
}

async function announcements(el, ctx) {
  const list = await api.get('/api/announcements');
  const staff = ctx.me.caps.staff;
  const openId = ctx.params.id ? Number(ctx.params.id) : null;
  set(el, html`<div class="page-head"><div><h1>Messages</h1></div><div class="actions">${ctx.me.caps['messages.send'] ? html`<button class="primary" id="new">New announcement</button>` : ''}</div></div>${mtabs(ctx, 'ann')}
    <div class="stack">${list.map((a) => html`<div class="card ${a.id === openId ? 'type-practice' : ''}" id="a${a.id}"><div class="hd"><h2>${a.title}</h2>${a.emergency ? html`<span class="badge bad">Emergency</span>` : ''}${!a.read && a.by_user !== ctx.me.user.id ? html`<span class="badge green">New</span>` : ''}
      <span class="r s muted">${a.by_name} · ${fmtDT(a.at)}</span></div><div class="bd"><p style="white-space:pre-wrap">${a.body}</p><div class="s muted">To: ${a.audience_labels.join(', ')}</div></div>
      ${staff ? html`<div class="ft row"><span class="s">${a.opened} of ${a.total} opened</span><button class="sm" data-reads="${a.id}">Who opened it</button></div>` : !a.read ? html`<div class="ft"><button class="sm" data-read="${a.id}">Mark as read</button></div>` : ''}</div>`)}
    ${!list.length ? empty('No announcements.') : ''}</div>`);
  if (openId) { api.post(`/api/announcements/${openId}/read`).catch(() => {}); setTimeout(() => $(`#a${openId}`, el)?.scrollIntoView({ block: 'center' }), 50); }
  on(el, 'click', '[data-read]', async (e, b) => { await api.post(`/api/announcements/${b.dataset.read}/read`); ctx.reload(); });
  on(el, 'click', '[data-reads]', async (e, b) => {
    const r = await api.get(`/api/announcements/${b.dataset.reads}/reads`);
    modal({ title: 'Read receipts', wide: true, body: html`<table><thead><tr><th>Name</th><th>Role</th><th>Opened</th></tr></thead><tbody>${r.map((x) => html`<tr><td>${x.name}</td><td>${ROLE[x.role]}</td><td>${x.opened_at ? fmtDT(x.opened_at) : html`<span class="badge warn">Not yet</span>`}</td></tr>`)}</tbody></table>`, actions: [{ label: 'Close' }] });
  });
  if ($('#new', el)) {
    const open = async () => {
      const auds = await api.get('/api/audiences');
      const m = modal({ title: 'New announcement', wide: true, body: html`<form id="nf">${field('Title', html`<input name="title" required>`)}${field('Message', html`<textarea name="body" rows="5"></textarea>`)}${field('Send to', audienceField('audience', auds, []))}
        <label class="check"><input type="checkbox" name="emergency"> Emergency (weather, injury, safety) — ignores quiet hours</label>
        <p class="help">Delivered by push and email. Outside ${ctx.me.settings.quiet_start}–${ctx.me.settings.quiet_end}, routine announcements to players and parents wait until the morning.</p></form>`,
      actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onClick: async (r) => { const res = await api.post('/api/announcements', formData(r.querySelector('#nf'))); toast(res.delayed ? `Queued for ${res.sent} people — delivers after quiet hours` : `Sent to ${res.sent} people`); ctx.navigate('/messages/announcements'); } }] });
      wireAudience(m.root);
    };
    $('#new', el).onclick = open;
    if (ctx.query.new) open();
  }
}

async function moderation(el, ctx) {
  const parent = ctx.me.user.role === 'parent';
  const blocks = await api.get('/api/contact-blocks');
  if (parent) {
    const coaches = await api.get('/api/directory');
    set(el, html`<div class="page-head"><div><h1>Messages</h1></div></div>${mtabs(ctx, 'mod')}
      <div class="grid g2"><div class="card"><div class="hd"><h2>Ask that a coach stop messaging your child</h2></div><div class="bd"><form id="bf">
        ${field('Player', html`<select name="player_id">${options(ctx.me.linked.map((p) => [p.id, p.name]))}</select>`)}${field('Coach', html`<select name="coach_id">${options(coaches.map((c) => [c.id, c.name]))}</select>`)}${field('Reason (optional)', html`<textarea name="reason"></textarea>`)}
        <button class="primary">Send request</button><p class="help">The head coach applies the block and the athletic director is notified.</p></form></div></div>
      <div class="card"><div class="hd"><h2>My requests</h2></div>${blocks.length ? html`<ul class="list">${blocks.map((b) => html`<li><div class="grow"><div class="t">${b.coach_name} → ${b.player_name}</div><div class="s">${fmtDT(b.at)}</div></div>${blockBadge(b.status)}</li>`)}</ul>` : empty('No requests.')}</div></div>`);
    $('#bf', el).onsubmit = async (e) => { e.preventDefault(); try { await api.post('/api/contact-blocks', formData(e.target)); toast('Request sent to the head coach'); ctx.reload(); } catch (err) { errToast(err); } };
    return;
  }
  const reports = await api.get('/api/reports');
  const admin = ctx.me.caps.admin;
  set(el, html`<div class="page-head"><div><h1>Messages</h1><div class="sub">Reported and automatically flagged messages, and parent contact-block requests.</div></div><div class="actions"><a class="btn" href="/messages?all=1">Read all chats</a></div></div>${mtabs(ctx, 'mod')}
    <div class="grid g2"><div class="card"><div class="hd"><h2>Reports</h2></div>${reports.length ? html`<ul class="list">${reports.map((r) => html`<li><div class="grow"><div class="t">${r.sender} in <a href="/messages/chat/${r.chat_id}?all=1">${r.chat_name}</a></div><div class="s">“${r.body || ''}” · ${r.reporter ? `reported by ${r.reporter}` : 'automatic flag'} · ${r.reason || ''}</div></div>
      ${r.resolved ? html`<span class="badge ok">${r.resolution || 'Resolved'}</span>` : admin ? html`<button class="sm" data-hide="${r.message_id}" data-r="${r.id}">Hide message</button><button class="sm" data-ok="${r.id}">No action</button>` : html`<span class="badge warn">Open</span>`}</li>`)}</ul>` : empty('Nothing reported.')}</div>
    <div class="card"><div class="hd"><h2>Contact-block requests</h2></div>${blocks.length ? html`<ul class="list">${blocks.map((b) => html`<li><div class="grow"><div class="t">${b.parent_name}: stop ${b.coach_name} messaging ${b.player_name}</div><div class="s">${b.reason || ''} · ${fmtDT(b.at)}</div></div>${blockBadge(b.status)}
      ${admin && b.status === 'requested' ? html`<button class="sm primary" data-apply="${b.id}">Apply</button><button class="sm" data-decline="${b.id}">Decline</button>` : admin && b.status === 'applied' ? html`<button class="sm" data-lift="${b.id}">Lift</button>` : ''}</li>`)}</ul>` : empty('No requests.')}</div></div>`);
  on(el, 'click', '[data-hide]', async (e, b) => { await api.post(`/api/messages/${b.dataset.hide}/hide`, { hidden: true }); await api.post(`/api/reports/${b.dataset.r}/resolve`, { resolution: 'Message hidden' }); ctx.reload(); });
  on(el, 'click', '[data-ok]', async (e, b) => { await api.post(`/api/reports/${b.dataset.ok}/resolve`, { resolution: 'No action needed' }); ctx.reload(); });
  on(el, 'click', '[data-apply]', async (e, b) => { const r = await api.post(`/api/contact-blocks/${b.dataset.apply}/apply`, { status: 'applied' }); toast(`Block applied${r.notified_ad ? '; athletic director notified' : ''}`); ctx.reload(); });
  on(el, 'click', '[data-decline]', async (e, b) => { await api.post(`/api/contact-blocks/${b.dataset.decline}/apply`, { status: 'declined' }); ctx.reload(); });
  on(el, 'click', '[data-lift]', async (e, b) => { await api.post(`/api/contact-blocks/${b.dataset.lift}/apply`, { status: 'lifted' }); ctx.reload(); });
}
const blockBadge = (s) => html`<span class="badge ${s === 'applied' ? 'ok' : s === 'requested' ? 'warn' : ''}">${cap(s)}</span>`;
