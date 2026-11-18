// C-19 / C-20 helpers used by the attendance pages and the player profile: start a tablet kiosk,
// streak and trend views per athlete and per position group (practices and workouts).
import { api } from '../api.js';
import { html, set, $, on, modal, raw, empty, bar, options, lineChart, legend } from '../ui.js';

export function startKiosk(ctx, eventId) {
  modal({
    title: 'Tablet kiosk',
    body: html`<p>Athletes tap their number and name on this device to check in for this event. Arrivals more than 5 minutes after the start are marked tardy.</p>
      <form id="kf"><div class="field"><label for="kpin">Coach PIN to exit (4 to 8 digits)</label><input id="kpin" type="password" inputmode="numeric" pattern="\\d{4,8}" maxlength="8" required autocomplete="off"></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Start kiosk', primary: true, onClick: async (r) => {
      const r2 = await api.post('/api/fb/kiosk', { event_id: eventId, pin: r.querySelector('#kpin').value });
      ctx.navigate(`/kiosk/${r2.id}`);
    } }],
  });
}

// Small inline trend line (0-100%).
export function spark(points, w = 110, h = 26) {
  if (!points || points.length < 2) return html`<span class="faint">—</span>`;
  const step = w / (points.length - 1);
  const pts = points.map(([, v], i) => `${(i * step).toFixed(1)},${(h - 2 - (v / 100) * (h - 4)).toFixed(1)}`).join(' ');
  return raw(`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="fb-spark" role="img" aria-label="Weekly attendance trend"><polyline fill="none" stroke="var(--ink-2)" stroke-width="1.5" points="${pts}"/></svg>`);
}
const pctCell = (v) => (v == null ? html`<span class="faint">—</span>` : html`<div class="row" style="flex-wrap:nowrap">${bar(v, v < 80 ? 'bad' : v < 90 ? 'warn' : '')}<span class="s">${v}%</span></div>`);

export async function trendsSection(el, q, st) {
  let group = q.group || '';
  const params = new URLSearchParams(Object.fromEntries(Object.entries({ from: q.from, to: q.to, team_id: q.team_id, type: q.type }).filter(([, v]) => v)));
  const r = await api.get(`/api/fb/attendance/trends?${params}`);
  const codes = [...new Set((st?.positions || []).map((p) => p.code))];
  const draw = () => {
    const players = r.players.filter((p) => !group || p.group === group);
    set(el, html`<div class="card" style="margin-bottom:14px"><div class="hd"><h2>Position groups</h2><span class="r faint" style="font-size:12px">Weekly trend, practices and workouts. A logged workout on a lift day counts as attending.</span></div>
      <div class="bd flush tbl-wrap"><table><thead><tr><th>Group</th><th class="num">Athletes</th><th>All events</th><th>Practices</th><th>Workouts</th><th>Weekly trend</th></tr></thead><tbody>
      ${r.groups.map((g) => html`<tr class="click" data-g="${g.group}"><td><b>${g.group}</b></td><td class="num">${g.athletes}</td><td style="width:140px">${pctCell(g.rate)}</td><td style="width:140px">${pctCell(g.practice_rate)}</td><td style="width:140px">${pctCell(g.workout_rate)}</td><td>${spark(g.trend)}</td></tr>`)}
      </tbody></table>${!r.groups.length ? empty('No attendance in this range.') : ''}</div></div>
    <div class="card"><div class="hd"><h2>Streaks</h2><span class="r"><select id="fbg" style="width:auto">${options([['', 'All groups'], ...codes.map((c) => [c, `${c} group`])], group)}</select></span></div>
      <div class="bd flush tbl-wrap"><table><thead><tr><th>Athlete</th><th>Group</th><th class="num">Current streak</th><th class="num">Best streak</th><th>Practices</th><th>Workouts</th><th class="num">Tardy</th><th>Weekly trend</th></tr></thead><tbody>
      ${players.map((p) => html`<tr class="click" onclick="__navigate('/players/${p.player_id}')"><td><b>${p.name}</b>${p.jersey != null ? html` <span class="faint">#${p.jersey}</span>` : ''}</td><td>${p.group}</td>
        <td class="num"><b>${p.current_streak}</b></td><td class="num">${p.best_streak}</td><td style="width:130px">${pctCell(p.practice_rate)}</td><td style="width:130px">${pctCell(p.workout_rate)}</td><td class="num">${p.tardies}</td><td>${spark(p.trend)}</td></tr>`)}
      </tbody></table>${!players.length ? empty('No athletes in this group.') : ''}</div></div>`);
    $('#fbg', el).onchange = (e) => { group = e.target.value; draw(); };
  };
  draw();
  on(el, 'click', '[data-g]', (e, tr) => { group = tr.dataset.g; draw(); });
}

// Player profile card: streak and weekly trend.
export async function playerAttendanceCard(el, playerId) {
  const r = await api.get(`/api/fb/attendance/player/${playerId}`);
  set(el, html`<div class="card"><div class="hd"><h2>Attendance</h2><span class="r faint" style="font-size:12px">Practices and workouts this season</span></div><div class="bd">
    <div class="grid g2" style="margin-bottom:10px">
      <div class="stat"><div class="k">Rate</div><div class="v">${r.rate == null ? '—' : `${r.rate}%`}</div><div class="d">${r.events} events</div></div>
      <div class="stat"><div class="k">Current streak</div><div class="v">${r.current_streak}</div><div class="d">best ${r.best_streak}</div></div>
      <div class="stat"><div class="k">Practices</div><div class="v">${r.practice_rate == null ? '—' : `${r.practice_rate}%`}</div></div>
      <div class="stat"><div class="k">Workouts</div><div class="v">${r.workout_rate == null ? '—' : `${r.workout_rate}%`}</div><div class="d">${r.tardies} tardy</div></div>
    </div>
    ${r.trend.length > 1 ? html`${lineChart([{ label: 'Weekly attendance %', points: r.trend }], { height: 140, yMin: 0, yMax: 100, yFmt: (v) => `${v}%` })}${legend([{ label: 'Weekly attendance %' }])}` : html`<p class="muted">Not enough weeks yet for a trend.</p>`}
  </div></div>`);
}
