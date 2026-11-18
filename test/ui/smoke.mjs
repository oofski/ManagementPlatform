// Browser smoke test: every page, every role. Fails on JS errors, failed API calls (5xx) or error notices.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createApp } from '../../server/app.js';
import { seed } from '../../server/seed.js';

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ui-')), 'ui.db');
const app = createApp({ dbFile });
seed(app.db);
await new Promise((r) => app.server.listen(0, r));
const base = `http://localhost:${app.server.address().port}`;
const db = app.db;
const one = (sql, ...a) => db.get(sql, ...a);

const head = one(`SELECT id FROM users WHERE role='head_coach'`).id;
const coach = one(`SELECT id FROM users WHERE title='WR coach'`).id;
const trainer = one(`SELECT id FROM users WHERE role='trainer'`).id;
const ad = one(`SELECT id FROM users WHERE staff_kind='athletic_director'`).id;
const player = one(`SELECT id FROM users WHERE email='player@ridgeview.example'`).id;
const parent = one(`SELECT id FROM users WHERE email='parent@ridgeview.example'`).id;
const ev = one(`SELECT id FROM events WHERE type='practice' ORDER BY abs(julianday(start)-julianday('now')) LIMIT 1`).id;
const plan = one(`SELECT id FROM practice_plans WHERE event_id IS NOT NULL LIMIT 1`).id;
const play = one(`SELECT id FROM plays LIMIT 1`).id;
const inst = one(`SELECT id FROM install_sheets LIMIT 1`).id;
const chart = one(`SELECT id FROM depth_charts ORDER BY id DESC LIMIT 1`).id;
const ochart = one(`SELECT id FROM depth_charts WHERE unit='offense' ORDER BY id DESC LIMIT 1`).id;
const prog = one(`SELECT id FROM wt_programs LIMIT 1`).id;
const asn = one(`SELECT id FROM assignments WHERE is_template=0 LIMIT 1`).id;
const chat = one(`SELECT id FROM chats LIMIT 1`).id;
const wa = one(`SELECT id FROM wt_assignments LIMIT 1`).id;

const staffPages = ['/', '/calendar', '/calendar?view=agenda', `/calendar/${ev}`, '/attendance', `/attendance/${ev}`, '/attendance/reports',
  '/practice', '/practice?tab=templates', '/practice/drills', `/practice/${plan}`, `/practice/${plan}/run`, `/practice/${plan}/summary`,
  '/playbook', `/playbook/play/${play}`, `/playbook/play/${play}/edit`, '/playbook/play/new/edit', '/playbook/installs', `/playbook/install/${inst}`, '/playbook/shares', '/playbook/game',
  '/playbook/book/1', '/playbook/book/2?side=defense', '/playbook/formations', '/playbook/formations?side=defense', '/playbook/formation/1/edit', '/playbook/formation/new/edit',
  '/playbook/routes', '/playbook/route/new/edit', '/playbook/positions', '/playbook/positions?side=D', '/playbook/playcaller', '/playbook/playcaller?book=1',
  '/players', `/players/${player}`, '/teams', '/depth', `/depth/${chart}`,
  '/weights', '/weights?tab=programs', `/weights/program/${prog}`, '/weights?tab=exercises', '/weights?tab=testing', `/weights?tab=body&player=${player}`, '/weights?tab=nutrition',
  '/weights?tab=templates', '/weights?tab=leaderboards', '/weights?tab=wellness', '/weights?tab=reports', '/weights?tab=feed', '/weights?tab=testing&view=day', '/weights?tab=testing&view=composite', '/weights?tab=testing&view=compare',
  '/weights/station', '/weights/tv', '/weights/feed', '/weights/wellness',
  '/messages', `/messages/chat/${chat}`, '/messages/announcements', '/messages/moderation', '/equipment', '/equipment?tab=outstanding', '/equipment?tab=helmets', '/equipment?tab=inventory', '/equipment?tab=catalog',
  '/assignments', '/assignments?tab=templates', '/assignments?tab=forms', `/assignments/${asn}`,
  '/development', '/development?tab=goals', '/development?tab=evals', `/development/player/${player}`, '/season', `/reports/player/${player}`, '/reports/team',
  '/settings', '/settings/staff', '/settings/audit', '/settings/outbox', '/account', '/settings/integrations', '/settings/integrations?tab=gmail', '/settings/integrations?tab=connection', '/settings/integrations?tab=setup', '/settings/integrations?tab=calendar', '/settings/integrations?tab=sheets', '/settings/integrations?tab=docs'];
const familyPages = ['/', '/calendar', `/calendar/${ev}`, '/assignments', '/assignments?tab=forms', `/assignments/${asn}`, '/playbook', `/playbook/play/${play}`, '/playbook/installs', `/playbook/install/${inst}`,
  '/weights', `/weights/workout/${wa}/1/1`, '/weights/feed', '/weights/wellness', '/development', '/depth', `/depth/${chart}`, '/messages', `/messages/chat/${chat}`, '/messages/announcements', '/messages/moderation', '/equipment', '/checkin', '/account', `/players/${player}`];

// Pages a role may legitimately be refused (403 notice is expected, not a crash).
const expectedDenied = {
  parent: ['/playbook/play/', '/playbook/install/', '/weights/workout/', '/messages/chat/', '/depth/', '/messages/moderation'], player: ['/messages/chat/', '/depth/', '/messages/moderation'],
  coach: ['/weights?tab=body', '/messages/moderation'], trainer: ['/playbook', '/practice/', '/messages/moderation', '/development?tab=evals'],
  ad: ['/weights?tab=body', '/practice/', '/development', '/reports/player/'],
};
// v2 football operations pages
staffPages.push('/eligibility', '/forms', '/safety', '/safety?tab=heat', '/safety?tab=concussion', '/messages/documents', '/messages/digest', '/recruiting', `/recruiting/${player}`);
familyPages.push('/forms', '/messages/documents', `/recruiting/${player}`, '/join');
expectedDenied.ad.push('/messages/digest');
const roles = [['head_coach', head, staffPages], ['coach', coach, staffPages], ['trainer', trainer, staffPages.filter((p) => !p.startsWith('/playbook'))], ['ad', ad, staffPages.filter((p) => !p.startsWith('/playbook'))], ['player', player, familyPages], ['parent', parent, familyPages]];

const browser = await chromium.launch();
const failures = [];
let visits = 0;
for (const [role, uid, pages] of roles) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const r = await (await fetch(`${base}/api/auth/demo`, { method: 'POST', body: JSON.stringify({ user_id: uid }) })).json();
  await ctx.addCookies([{ name: 'sid', value: r.token, url: base }]);
  const page = await ctx.newPage();
  let errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(403|404)|cdnjs|ERR_|net::/.test(m.text())) errs.push(`console: ${m.text()}`); });
  page.on('response', (res) => { if (res.status() >= 500) errs.push(`HTTP ${res.status()} ${res.url()}`); });
  for (const p of pages) {
    errs = [];
    await page.goto(base + p, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto: ${e.message}`));
    await page.waitForTimeout(150);
    const bad = await page.$$eval('.content > .notice.bad, #content > .notice.bad', (n) => n.map((x) => x.textContent.trim()));
    const loading = await page.$$eval('#content', (n) => n.map((x) => x.textContent.trim()).filter((t) => t === 'Loading…'));
    const denied = (expectedDenied[role] || []).some((pre) => p.startsWith(pre));
    if (bad.length && !(denied && bad.every((b) => /access|not found|No playbook|No access|private/i.test(b)))) errs.push(`error notice: ${bad.join(' | ')}`);
    if (loading.length) errs.push('stuck on Loading');
    visits++;
    if (errs.length) failures.push({ role, page: p, errs: [...new Set(errs)] });
  }
  await ctx.close();
}
// Mobile check: no horizontal overflow on key pages
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const tok = (await (await fetch(`${base}/api/auth/demo`, { method: 'POST', body: JSON.stringify({ user_id: head }) })).json()).token;
await mctx.addCookies([{ name: 'sid', value: tok, url: base }]);
const mp = await mctx.newPage();
for (const p of ['/', '/calendar', `/attendance/${ev}`, `/practice/${plan}/run`, '/players', `/depth/${chart}`, '/messages']) {
  await mp.goto(base + p, { waitUntil: 'networkidle' });
  const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 2) failures.push({ role: 'mobile', page: p, errs: [`horizontal overflow ${over}px`] });
}
// ---------- Interaction flows (head coach, then player) ----------
async function flows() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const t = (await (await fetch(`${base}/api/auth/demo`, { method: 'POST', body: JSON.stringify({ user_id: head }) })).json()).token;
  await ctx.addCookies([{ name: 'sid', value: t, url: base }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept('weather'));
  const step = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ role: 'flow', page: name, errs: [e.message.split('\n')[0]] }); } };
  const modalBtn = (label) => page.locator('.modal .ft button', { hasText: label }).last().click();

  await step('create event', async () => {
    await page.goto(base + '/calendar?new=1', { waitUntil: 'networkidle' });
    await page.fill('.modal [name=title]', 'UI test practice');
    await page.locator('.modal [name=audience][value="program"]').check();
    await modalBtn('Create event');
    await page.waitForURL(/\/calendar\/\d+/);
    await page.getByText('UI test practice').first().waitFor();
  });
  await step('status change', async () => {
    await page.click('[data-st=indoors]');
    await modalBtn('Send alert');
    await page.locator('.badge', { hasText: 'Indoors' }).first().waitFor();
  });
  await step('attendance', async () => {
    await page.goto(`${base}/attendance/${ev}`, { waitUntil: 'networkidle' });
    await page.click('#all');
    await page.waitForTimeout(400);
    await page.locator('tr.att-row').first().locator('[data-st=late]').click();
    await page.waitForTimeout(400);
    const late = await page.locator('tr.att-row').first().locator('[data-st=late].on').count();
    if (!late) throw new Error('late not marked');
  });
  await step('run mode rating', async () => {
    await page.goto(`${base}/practice/${plan}/run`, { waitUntil: 'networkidle' });
    const next = page.locator('#next');
    for (let i = 0; i < 3 && !(await page.locator('[data-rate]').count()); i++) { await next.click(); await page.waitForTimeout(300); }
    await page.locator('[data-rate="4"]').first().click();
    await page.waitForTimeout(300);
    if (!(await page.locator('[data-rate="4"].on').count())) throw new Error('rating not shown');
    await page.click('[data-tag="went well"]');
    await page.click('#nsave');
    await page.locator('.toast', { hasText: 'Note saved' }).waitFor();
  });
  await step('design play', async () => {
    await page.goto(base + '/playbook/play/new/edit', { waitUntil: 'networkidle' });
    const box = await page.locator('#fw').boundingBox();
    // v2 designer: tap a palette tile then the field, turn on Route Mode (Straight), click the player, then route points
    await page.click('[data-pal=player][data-type=circle_letter]');
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.56);
    await page.click('[data-rm=straight]');
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.56);
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.keyboard.press('Escape');
    await page.fill('#mf [name=name]', 'UI test play');
    await page.click('#save');
    await page.waitForURL(/\/playbook\/play\/\d+$/);
    await page.click('#playb');
    await page.waitForTimeout(600);
  });
  await step('depth chart move', async () => {
    await page.goto(`${base}/depth/${ochart}`, { waitUntil: 'networkidle' });
    await page.locator('.dc-cell .chip').first().click();
    await page.locator('.dc-cell[data-slot="RB"][data-idx="3"]').click();
    await page.click('#save');
    await page.locator('.toast', { hasText: 'saved' }).waitFor();
    await page.click('[data-view=field]');
    await page.locator('.fieldview svg').waitFor();
  });
  await step('chat message', async () => {
    await page.goto(`${base}/messages/chat/${chat}`, { waitUntil: 'networkidle' });
    await page.fill('#cf textarea', 'UI test message');
    await page.click('#cf button.primary');
    await page.getByText('UI test message').first().waitFor();
  });
  await step('announcement', async () => {
    await page.goto(`${base}/messages/announcements?new=1`, { waitUntil: 'networkidle' });
    await page.fill('.modal [name=title]', 'UI test announcement');
    await page.locator('.modal [name=audience][value="program"]').check();
    await modalBtn('Send');
    await page.getByText('UI test announcement').first().waitFor();
  });
  // code for player check-in
  const code = (await (await fetch(`${base}/api/attendance/${ev}/code`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: '{}' })).json()).code;
  await ctx.close();

  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pt = (await (await fetch(`${base}/api/auth/demo`, { method: 'POST', body: JSON.stringify({ user_id: player }) })).json()).token;
  await pctx.addCookies([{ name: 'sid', value: pt, url: base }]);
  const pp = await pctx.newPage();
  pp.on('pageerror', (e) => errs.push(e.message));
  await step('player check-in', async () => {
    await pp.goto(`${base}/checkin?code=${code}`, { waitUntil: 'networkidle' });
    await pp.locator('.notice', { hasText: /Checked in|already/ }).waitFor();
  });
  await step('player RSVP', async () => {
    const e2 = one(`SELECT id FROM events WHERE type='practice' AND start>datetime('now','+1 day') AND audience LIKE '%team:1%' LIMIT 1`).id;
    await pp.goto(`${base}/calendar/${e2}`, { waitUntil: 'networkidle' });
    await pp.click('[data-rsvp=going]');
    await pp.locator('.toast', { hasText: 'RSVP saved' }).waitFor();
  });
  await pctx.close();
  if (errs.length) failures.push({ role: 'flow', page: 'page errors', errs });
}
await flows();
await browser.close();
app.close();
console.log(`Visited ${visits} pages across ${roles.length} roles.`);
if (failures.length) { for (const f of failures) console.log(`FAIL ${f.role} ${f.page} :: ${f.errs.map((e) => e.slice(0, 220).replace(/\n/g, ' ')).join(' || ')}`); console.log(`${failures.length} page(s) failed`); process.exit(1); }
console.log('UI smoke test passed.');
