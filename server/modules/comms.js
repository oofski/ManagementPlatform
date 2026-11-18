// Module 7: Communication — announcements with read receipts, group chats under the two-adult rule,
// no private coach-to-player messages (question threads add a second adult), saved records, quiet hours,
// private contact details, moderation, parent contact blocks, file limits, risky-language flags, polls, reactions.
import { fail, need, nowLocal } from '../core.js';
import { j, jAll } from '../db.js';

const RISKY = ['kill yourself', 'kys', 'send nudes', 'nude', 'meet me alone', 'dont tell your parents', "don't tell your parents", 'our secret', 'delete this', 'snapchat me', 'text my cell', 'come over tonight', 'hate you', 'stupid'];

export default function comms(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;

  const chatOf = (pid, id) => j(db.get('SELECT * FROM chats WHERE id=? AND program_id=?', id, pid), 'audience');
  const member = (chatId, uid) => db.get('SELECT * FROM chat_members WHERE chat_id=? AND user_id=?', chatId, uid);
  const canRead = (u, c) => !!member(c.id, u.id) || isAdmin(u) || can(u, 'chats.read_all');
  const roleOf = (uid) => db.get('SELECT role FROM users WHERE id=?', uid)?.role;
  const isAdult = (role) => ['head_coach', 'coach', 'trainer', 'staff', 'parent'].includes(role);
  function adultCount(chatId) {
    const rows = db.all('SELECT u.role, u.id FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND u.active=1', chatId);
    return { adults: rows.filter((r) => isAdult(r.role)).length, staff: rows.filter((r) => isAdult(r.role) && r.role !== 'parent').length, players: rows.filter((r) => r.role === 'player').length };
  }
  function enforceTwoAdults(ids) {
    const roles = ids.map(roleOf);
    const adults = roles.filter(isAdult).length;
    need(adults >= 2, 400, 'Two-adult rule: every chat needs at least two adults (coaches, staff or parents of members)');
  }
  const blockedPairs = (pid) => db.all(`SELECT player_id, coach_id FROM contact_blocks WHERE program_id=? AND status='applied'`, pid);

  // ---------- announcements (COM-1) ----------
  router.get('/api/announcements', ({ user }) => {
    const rows = jAll(db.all('SELECT a.*, u.name by_name FROM announcements a LEFT JOIN users u ON u.id=a.by_user WHERE a.program_id=? ORDER BY a.id DESC LIMIT 100', user.program_id), 'audience')
      .filter((a) => a.by_user === user.id || core.inAudience(user, a.audience) || core.resolveRecipients(user.program_id, a.audience).includes(user.id));
    return rows.map((a) => {
      const n = db.get('SELECT opened_at, deliver_at FROM notifications WHERE ref=? AND user_id=?', `ann:${a.id}`, user.id);
      if (n && n.deliver_at > nowLocal() && a.by_user !== user.id && !isStaff(user)) return null;
      const out = { ...a, audience_labels: core.describeAudience(user.program_id, a.audience), read: !!n?.opened_at };
      if (isStaff(user)) {
        const r = db.get('SELECT count(*) total, sum(opened_at IS NOT NULL) opened FROM notifications WHERE ref=?', `ann:${a.id}`);
        out.total = r.total; out.opened = r.opened || 0;
      }
      return out;
    }).filter(Boolean);
  });
  router.post('/api/announcements', ({ user, body }) => {
    need(can(user, 'messages.send'), 403, 'Coaches only');
    need(body.title && Array.isArray(body.audience) && body.audience.length, 400, 'Title and audience are required');
    const id = db.insert('announcements', { program_id: user.program_id, title: body.title, body: body.body || '', audience: body.audience, emergency: body.emergency ? 1 : 0, by_user: user.id });
    const blocks = blockedPairs(user.program_id).filter((b) => b.coach_id === user.id).map((b) => b.player_id);
    const rec = core.resolveRecipients(user.program_id, body.audience).filter((x) => x !== user.id && !blocks.includes(x));
    const sent = notify(user.program_id, rec, { kind: body.emergency ? 'urgent' : 'announcement', title: body.title, body: body.body || '', link: `/messages/announcements/${id}`, ref: `ann:${id}`, emergency: !!body.emergency });
    audit(user, 'announce', 'announcement', id, { audience: body.audience, emergency: !!body.emergency });
    return { id, sent, delayed: !body.emergency && core.inQuietHours(user.program_id) };
  });
  router.post('/api/announcements/:id/read', ({ user, params }) => {
    db.run('UPDATE notifications SET opened_at=coalesce(opened_at, ?) WHERE ref=? AND user_id=?', nowLocal(), `ann:${Number(params.id)}`, user.id);
    return { ok: true };
  });
  router.get('/api/announcements/:id/reads', ({ user, params }) => {
    need(isStaff(user), 403, 'Staff only');
    return db.all('SELECT u.id, u.name, u.role, n.opened_at FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.ref=? ORDER BY n.opened_at IS NULL, u.name', `ann:${Number(params.id)}`);
  });

  // ---------- chats ----------
  function chatShape(user, c) {
    const counts = adultCount(c.id);
    // COM-9: messages from a coach blocked for this user's player are hidden from previews and unread counts too.
    const blocked = JSON.stringify(blockedPairs(user.program_id).filter((b) => core.linkedPlayers(user).includes(b.player_id)).map((b) => b.coach_id));
    const last = db.get('SELECT m.body, m.at, u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND m.hidden_by_admin=0 AND m.removed_by_sender=0 AND (m.deliver_at IS NULL OR m.deliver_at<=? OR m.user_id=?) AND m.user_id NOT IN (SELECT value FROM json_each(?)) ORDER BY m.id DESC LIMIT 1', c.id, nowLocal(), user.id, blocked);
    const me = member(c.id, user.id);
    const unread = me ? db.get('SELECT count(*) n FROM messages WHERE chat_id=? AND id>? AND user_id!=? AND (deliver_at IS NULL OR deliver_at<=?) AND user_id NOT IN (SELECT value FROM json_each(?))', c.id, me.last_read, user.id, nowLocal(), blocked).n : 0;
    return { ...c, member: !!me, muted: !!me?.muted, ...counts, member_count: db.get('SELECT count(*) n FROM chat_members WHERE chat_id=?', c.id).n, last, unread, audience_labels: core.describeAudience(user.program_id, c.audience) };
  }
  router.get('/api/chats', ({ user, query }) => {
    const all = query.all && (isAdmin(user) || can(user, 'chats.read_all'));
    const rows = all ? jAll(db.all('SELECT * FROM chats WHERE program_id=? ORDER BY id DESC', user.program_id), 'audience')
      : jAll(db.all('SELECT c.* FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE c.program_id=? AND m.user_id=? ORDER BY c.id DESC', user.program_id, user.id), 'audience');
    return rows.map((c) => chatShape(user, c));
  });
  router.post('/api/chats', ({ user, body }) => {
    need(can(user, 'messages.send'), 403, 'Only coaches create chats');
    need(body.name && Array.isArray(body.audience) && body.audience.length, 400, 'Name and audience are required');
    const players = body.allow_players === false ? [] : core.resolvePlayers(user.program_id, body.audience);
    const ids = new Set([user.id, ...players]);
    // staff covering the audience join
    for (const id of core.resolveRecipients(user.program_id, body.audience, { parents: false })) if (isAdult(roleOf(id)) && roleOf(id) !== 'parent') ids.add(id);
    if (body.allow_parents && players.length) for (const r of db.all(`SELECT parent_id FROM parent_links WHERE player_id IN (${players.map(() => '?').join(',')})`, ...players)) ids.add(r.parent_id);
    for (const x of body.extra_members || []) ids.add(Number(x));
    enforceTwoAdults([...ids]);
    const id = db.insert('chats', { program_id: user.program_id, name: body.name, kind: body.kind || 'group', audience: body.audience, allow_players: body.allow_players === false ? 0 : 1, allow_parents: body.allow_parents ? 1 : 0, allow_files: body.allow_files === false ? 0 : 1, created_by: user.id });
    db.tx(() => { for (const uid of ids) db.run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?,?)', id, uid); });
    audit(user, 'create_chat', 'chat', id, { members: ids.size });
    return { id, members: ids.size };
  });
  // COM-4: a player asks a coach; a second adult (parent, else another coach) is added automatically.
  router.post('/api/chats/question', ({ user, body }) => {
    need(user.role === 'player' || user.role === 'parent', 400, 'Players and parents use question threads');
    const coach = db.get(`SELECT * FROM users WHERE id=? AND program_id=? AND role IN ('head_coach','coach','trainer') AND active=1`, Number(body.coach_id), user.program_id);
    need(coach, 404, 'Coach not found');
    need(body.text && body.text.trim(), 400, 'Write your question');
    const playerId = user.role === 'player' ? user.id : core.linkedPlayers(user)[0];
    const ids = new Set([user.id, coach.id]);
    const parent = db.get('SELECT parent_id FROM parent_links l JOIN users u ON u.id=l.parent_id WHERE l.player_id=? AND u.active=1 AND u.invite_code IS NULL ORDER BY parent_id LIMIT 1', playerId);
    let second = parent && parent.parent_id !== user.id ? parent.parent_id : null;
    if (user.role === 'parent') second = null; // parent is already an adult
    if (!second && user.role === 'player') {
      second = db.get(`SELECT id FROM users WHERE program_id=? AND id!=? AND role IN ('head_coach','coach') AND active=1 ORDER BY role='head_coach' DESC, id LIMIT 1`, user.program_id, coach.id)?.id;
    }
    if (second) ids.add(second);
    if (user.role === 'parent' && playerId) ids.add(playerId);
    enforceTwoAdults([...ids]);
    const id = db.insert('chats', { program_id: user.program_id, name: `Question: ${user.name} → ${coach.name}`, kind: 'question', audience: [`user:${user.id}`], allow_players: 1, allow_parents: 1, created_by: user.id });
    for (const uid of ids) db.run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?,?)', id, uid);
    const mid = db.insert('messages', { chat_id: id, user_id: user.id, body: body.text.trim() });
    notify(user.program_id, [...ids].filter((x) => x !== user.id), { kind: 'message', title: `New question from ${user.name}`, body: body.text.slice(0, 120), link: `/messages/chat/${id}`, from: 'system', email: false });
    audit(user, 'question_thread', 'chat', id, { members: [...ids] });
    return { id, members: ids.size, message_id: mid };
  });
  router.get('/api/chats/:id', ({ user, params }) => {
    const c = chatOf(user.program_id, Number(params.id));
    need(c && canRead(user, c), 404, 'Chat not found');
    const out = chatShape(user, c);
    out.members = db.all('SELECT u.id, u.name, u.role, m.muted FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? ORDER BY u.role, u.name', c.id);
    out.can_moderate = isAdmin(user);
    out.files_allowed = !!c.allow_files && core.settings(user.program_id).chat_files;
    return out;
  });
  router.get('/api/chats/:id/messages', ({ user, params, query }) => {
    const c = chatOf(user.program_id, Number(params.id));
    need(c && canRead(user, c), 404, 'Chat not found');
    const admin = isAdmin(user) || can(user, 'chats.read_all');
    const blocks = blockedPairs(user.program_id).filter((b) => core.linkedPlayers(user).includes(b.player_id)).map((b) => b.coach_id);
    const since = Number(query.after || 0);
    const rows = jAll(db.all('SELECT m.*, u.name, u.role FROM messages m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND m.id>? ORDER BY m.id', c.id, since), 'poll');
    const now = nowLocal();
    const out = [];
    for (const m of rows) {
      const pending = m.deliver_at && m.deliver_at > now;
      if (pending && !admin && !isStaff(user) && m.user_id !== user.id) continue;
      if (blocks.includes(m.user_id)) continue;
      if (m.hidden_by_admin && !admin) continue;
      const msg = { id: m.id, user_id: m.user_id, name: m.name, role: m.role, at: m.at, emergency: !!m.emergency, pending: !!pending, deliver_at: m.deliver_at, flagged: admin ? !!m.flagged : undefined };
      if (m.removed_by_sender && !admin) { msg.removed = true; } else {
        msg.body = m.body; msg.attachment = m.attachment;
        if (m.removed_by_sender) msg.removed_by_sender = true;
        if (m.hidden_by_admin) msg.hidden = true;
      }
      if (m.poll) {
        const votes = db.all('SELECT option_idx, count(*) n FROM poll_votes WHERE message_id=? GROUP BY option_idx', m.id);
        msg.poll = { question: m.poll.question, options: m.poll.options.map((o, i) => ({ label: o, votes: votes.find((v) => v.option_idx === i)?.n || 0 })), my_vote: db.get('SELECT option_idx FROM poll_votes WHERE message_id=? AND user_id=?', m.id, user.id)?.option_idx ?? null };
      }
      msg.reactions = db.all('SELECT emoji, count(*) n, sum(user_id=?) mine FROM message_reactions WHERE message_id=? GROUP BY emoji', user.id, m.id);
      out.push(msg);
    }
    const me = member(c.id, user.id);
    if (me && rows.length) db.run('UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=?', rows[rows.length - 1].id, c.id, user.id);
    if (!me && admin) audit(user, 'read_chat', 'chat', c.id);
    return out;
  });
  router.post('/api/chats/:id/messages', ({ user, params, body }) => {
    const c = chatOf(user.program_id, Number(params.id));
    need(c, 404, 'Chat not found');
    const me = member(c.id, user.id);
    need(me, 403, 'You are not a member of this chat');
    need(!c.locked || isAdmin(user), 403, 'This chat is locked');
    need(!me.muted, 403, 'You are muted in this chat');
    const counts = adultCount(c.id);
    need(counts.adults >= 2, 400, 'Two-adult rule: this chat needs a second adult before messages can be sent');
    need((body.body && body.body.trim()) || body.attachment || body.poll, 400, 'Message is empty');
    if (body.attachment) {
      need(c.allow_files && core.settings(user.program_id).chat_files, 403, 'Photos and files are turned off in this chat');
      need(String(body.attachment).startsWith('data:') && body.attachment.length < 1_500_000, 400, 'Attachments must be under 1 MB');
    }
    if (body.poll) need(isStaff(user) && body.poll.question && Array.isArray(body.poll.options) && body.poll.options.length >= 2, 400, 'Polls need a question and two options (coaches only)');
    const emergency = !!body.emergency && isStaff(user);
    // COM-6: staff messages to chats with players are delivered only inside allowed hours, unless an emergency.
    const hasMinors = counts.players > 0 || db.get(`SELECT 1 FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND u.role='parent'`, c.id);
    const deliver = isStaff(user) && hasMinors && !emergency ? core.nextDeliveryTime(user.program_id) : nowLocal();
    const text = (body.body || '').trim();
    const flagged = RISKY.some((w) => text.toLowerCase().includes(w)) ? 1 : 0;
    const id = db.insert('messages', { chat_id: c.id, user_id: user.id, body: text || null, attachment: body.attachment || null, deliver_at: deliver, emergency: emergency ? 1 : 0, poll: body.poll ? { question: body.poll.question, options: body.poll.options } : null, flagged });
    if (flagged) db.insert('message_reports', { message_id: id, by_user: null, reason: 'Automatic flag: possible risky language' });
    const others = db.all('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id!=? AND muted=0', c.id, user.id).map((r) => r.user_id);
    const blocked = blockedPairs(user.program_id).filter((b) => b.coach_id === user.id).map((b) => b.player_id);
    notify(user.program_id, others.filter((x) => !blocked.includes(x)), { kind: emergency ? 'urgent' : 'message', title: `${user.name} in ${c.name}`, body: text.slice(0, 140) || 'Sent an attachment', link: `/messages/chat/${c.id}`, emergency, email: false, from: isStaff(user) ? undefined : 'system' });
    return { id, delivered: deliver <= nowLocal(), deliver_at: deliver, flagged: !!flagged };
  });
  router.del('/api/messages/:id', ({ user, params }) => {
    const m = db.get('SELECT * FROM messages WHERE id=?', Number(params.id));
    need(m && m.user_id === user.id, 403, 'You can only remove your own messages');
    db.run('UPDATE messages SET removed_by_sender=1 WHERE id=?', m.id); // original is kept for admins (COM-5)
    audit(user, 'remove_own_message', 'message', m.id);
    return { ok: true };
  });
  router.post('/api/messages/:id/react', ({ user, params, body }) => {
    const m = db.get('SELECT * FROM messages WHERE id=?', Number(params.id));
    need(m && member(m.chat_id, user.id), 404, 'Message not found');
    const emoji = String(body.emoji || '').slice(0, 8);
    need(['👍', '👏', '💪', '✅', '❤️', '🏈'].includes(emoji), 400, 'Unsupported reaction');
    if (db.get('SELECT 1 FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, user.id, emoji)) db.run('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, user.id, emoji);
    else db.run('INSERT INTO message_reactions VALUES (?,?,?)', m.id, user.id, emoji);
    return { ok: true };
  });
  router.post('/api/messages/:id/vote', ({ user, params, body }) => {
    const m = j(db.get('SELECT * FROM messages WHERE id=?', Number(params.id)), 'poll');
    need(m && m.poll && member(m.chat_id, user.id), 404, 'Poll not found');
    need(Number(body.option) >= 0 && Number(body.option) < m.poll.options.length, 400, 'Unknown option');
    db.run('INSERT INTO poll_votes VALUES (?,?,?) ON CONFLICT(message_id, user_id) DO UPDATE SET option_idx=excluded.option_idx', m.id, user.id, Number(body.option));
    return { ok: true };
  });

  // ---------- moderation (COM-8) ----------
  router.post('/api/messages/:id/report', ({ user, params, body }) => {
    const m = db.get('SELECT * FROM messages WHERE id=?', Number(params.id));
    need(m && (member(m.chat_id, user.id) || isAdmin(user)), 404, 'Message not found');
    const id = db.insert('message_reports', { message_id: m.id, by_user: user.id, reason: body.reason || null });
    const admins = db.all(`SELECT id FROM users WHERE program_id=? AND (role='head_coach' OR is_admin=1 OR staff_kind='athletic_director') AND active=1`, user.program_id).map((r) => r.id);
    notify(user.program_id, admins, { kind: 'urgent', title: 'A message was reported', body: body.reason || '', link: '/messages/moderation', from: 'system', email: false });
    return { id };
  });
  router.get('/api/reports', ({ user }) => {
    need(isAdmin(user) || can(user, 'chats.read_all'), 403, 'Admins only');
    return db.all(`SELECT r.*, m.body, m.chat_id, m.hidden_by_admin, s.name sender, b.name reporter, c.name chat_name FROM message_reports r JOIN messages m ON m.id=r.message_id JOIN users s ON s.id=m.user_id
      LEFT JOIN users b ON b.id=r.by_user JOIN chats c ON c.id=m.chat_id WHERE c.program_id=? ORDER BY r.resolved, r.id DESC`, user.program_id);
  });
  router.post('/api/reports/:id/resolve', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Admins only');
    db.run('UPDATE message_reports SET resolved=1, resolution=? WHERE id=?', body.resolution || 'reviewed', Number(params.id));
    audit(user, 'resolve_report', 'report', Number(params.id), body.resolution);
    return { ok: true };
  });
  router.post('/api/messages/:id/hide', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Admins only');
    db.run('UPDATE messages SET hidden_by_admin=? WHERE id=?', body.hidden === false ? 0 : 1, Number(params.id));
    audit(user, body.hidden === false ? 'unhide_message' : 'hide_message', 'message', Number(params.id));
    return { ok: true };
  });
  router.post('/api/chats/:id/lock', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Admins only');
    db.run('UPDATE chats SET locked=? WHERE id=? AND program_id=?', body.locked === false ? 0 : 1, Number(params.id), user.program_id);
    audit(user, body.locked === false ? 'unlock_chat' : 'lock_chat', 'chat', Number(params.id));
    return { ok: true };
  });
  router.put('/api/chats/:id', ({ user, params, body }) => {
    const c = chatOf(user.program_id, Number(params.id));
    need(c && (isAdmin(user) || c.created_by === user.id), 403, 'Only the chat creator or an admin can change it');
    const upd = {};
    if (body.name) upd.name = body.name;
    if (body.allow_files !== undefined) upd.allow_files = body.allow_files ? 1 : 0;
    db.update('chats', c.id, upd);
    return { ok: true };
  });
  router.post('/api/chats/:id/members', ({ user, params, body }) => {
    const c = chatOf(user.program_id, Number(params.id));
    need(c && (isAdmin(user) || c.created_by === user.id), 403, 'Only the chat creator or an admin can add members');
    const u = db.get('SELECT * FROM users WHERE id=? AND program_id=? AND active=1', Number(body.user_id), user.program_id);
    need(u, 404, 'User not found');
    if (u.role === 'player') need(c.allow_players, 400, 'Players are not allowed in this chat');
    if (u.role === 'parent') need(c.allow_parents, 400, 'Parents are not allowed in this chat');
    db.run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?,?)', c.id, u.id);
    audit(user, 'add_member', 'chat', c.id, { user: u.id });
    return { ok: true };
  });
  router.del('/api/chats/:id/members/:uid', ({ user, params }) => {
    const c = chatOf(user.program_id, Number(params.id));
    const uid = Number(params.uid);
    need(c && (isAdmin(user) || c.created_by === user.id || uid === user.id), 403, 'Not allowed');
    const remaining = db.all('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id!=?', c.id, uid).map((r) => r.user_id);
    if (remaining.some((id) => roleOf(id) === 'player')) enforceTwoAdults(remaining);
    db.run('DELETE FROM chat_members WHERE chat_id=? AND user_id=?', c.id, uid);
    audit(user, 'remove_member', 'chat', c.id, { user: uid });
    return { ok: true };
  });
  router.post('/api/chats/:id/members/:uid/mute', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Admins only');
    db.run('UPDATE chat_members SET muted=? WHERE chat_id=? AND user_id=?', body.muted === false ? 0 : 1, Number(params.id), Number(params.uid));
    audit(user, body.muted === false ? 'unmute' : 'mute', 'chat', Number(params.id), { user: Number(params.uid) });
    return { ok: true };
  });

  // ---------- parent contact block (COM-9) ----------
  router.get('/api/contact-blocks', ({ user }) => {
    const base = `SELECT b.*, p.name parent_name, pl.name player_name, c.name coach_name FROM contact_blocks b JOIN users p ON p.id=b.parent_id JOIN users pl ON pl.id=b.player_id JOIN users c ON c.id=b.coach_id WHERE b.program_id=?`;
    if (isAdmin(user) || can(user, 'chats.read_all')) return db.all(base + ' ORDER BY b.id DESC', user.program_id);
    return db.all(base + ' AND b.parent_id=? ORDER BY b.id DESC', user.program_id, user.id);
  });
  router.post('/api/contact-blocks', ({ user, body }) => {
    need(user.role === 'parent', 403, 'Only parents request a contact block');
    need(core.linkedPlayers(user).includes(Number(body.player_id)), 403, 'Not your player');
    need(db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role IN ('coach','trainer','staff','head_coach')`, Number(body.coach_id), user.program_id), 404, 'Coach not found');
    const id = db.insert('contact_blocks', { program_id: user.program_id, parent_id: user.id, player_id: Number(body.player_id), coach_id: Number(body.coach_id), reason: body.reason || null });
    const heads = db.all(`SELECT id FROM users WHERE program_id=? AND (role='head_coach' OR is_admin=1) AND active=1`, user.program_id).map((r) => r.id);
    notify(user.program_id, heads, { kind: 'urgent', title: 'Contact block requested', body: `${user.name} asked that a coach stop messaging their child`, link: '/messages/moderation', from: 'system' });
    audit(user, 'request_block', 'contact_block', id);
    return { id };
  });
  router.post('/api/contact-blocks/:id/apply', ({ user, params, body }) => {
    need(user.role === 'head_coach' || isAdmin(user), 403, 'Only the head coach applies contact blocks');
    const b = db.get('SELECT * FROM contact_blocks WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(b, 404, 'Request not found');
    const status = body.status === 'declined' ? 'declined' : body.status === 'lifted' ? 'lifted' : 'applied';
    db.run('UPDATE contact_blocks SET status=?, applied_by=? WHERE id=?', status, user.id, b.id);
    const ad = db.all(`SELECT id FROM users WHERE program_id=? AND staff_kind='athletic_director' AND active=1`, user.program_id).map((r) => r.id);
    const names = db.get('SELECT (SELECT name FROM users WHERE id=?) coach, (SELECT name FROM users WHERE id=?) player', b.coach_id, b.player_id);
    notify(user.program_id, [...ad, b.parent_id, b.coach_id], { kind: 'update', title: `Contact block ${status}`, body: `${names.coach} / ${names.player}`, from: 'system' });
    audit(user, `block_${status}`, 'contact_block', b.id);
    return { ok: true, notified_ad: ad.length };
  });

  router.get('/api/directory', ({ user }) => {
    // COM-7: names and roles only — phone numbers and emails are never shown to other members.
    return db.all(`SELECT id, name, role, title FROM users WHERE program_id=? AND active=1 AND role IN ('head_coach','coach','trainer') ORDER BY role='head_coach' DESC, name`, user.program_id);
  });
}
