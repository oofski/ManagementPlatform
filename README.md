# Program Manager

One app for a high school football head coach to run a whole program (varsity, JV and freshman, about 20 coaches): one roster, one calendar and one profile per player, with players and parents getting a single feed of schedules, reminders and assignments.

## Run it

Requires Node.js 22.13 or newer. There are no npm dependencies.

```bash
npm start
```

Open http://localhost:3000. On first start the app loads a demo program (Ridgeview Football: 3 levels, 4 teams, 20 staff, 97 players, parents, and a season of activity). The sign-in page lists demo accounts for every role; all use the password `password123`. Fixed demo logins: `coach@ridgeview.example` (head coach), `player@ridgeview.example` and `parent@ridgeview.example`.

To reset the demo data:

```bash
npm run seed
```

## Tests

```bash
npm test
```

Runs 110 API tests, one file per module, including permission and negative cases.

```bash
npm run test:ui
```

Starts a fresh server and signs in as head coach, coach, trainer, athletic director, player and parent. It visits every page, fails on any JavaScript error, server error or error banner, and checks phone-width layouts for horizontal overflow.

## Modules

| # | Module | What is built |
|---|---|---|
| 1 | Calendar | Events with audiences (program, level, team, unit, position group, custom group, player, coaches, parents) and per-type fields; month and agenda views filtered to the viewer's groups; create, edit and delete; weekly or daily recurrence with edit-one or edit-series; game-week template; quick status changes (indoors, delayed, cancelled) as urgent alerts; change log; reminders (24 h and 2 h by default); acknowledgment view of who opened an alert; RSVP with required reasons, deadlines, parent replies and staff coverage; RSVPs become planned attendance; ICS subscribe feed; email me the details; weekly practice-time totals against a configurable state limit |
| 2 | Practice planning | Drill library with search; plans tied to practice events with ordered, timed periods (group, unit, positions, coach, drill, plays, contact); templates, copy and game-week plan sets; run mode with clock, next period and done/skip/changed; quick notes with preset tags; one-tap per-drill ratings for the period's group only, showing unit and level; absent and limited players flagged; works offline; summary shared with staff |
| 3 | Playbook | Plays stored as structured data; SVG designer for O, X and square players, routes, blocks, runs, rushes, coverage and pre-snap motion; formations; animation with speed and step-through; playbooks, folders, tags and search; coaching points and per-position assignments; version history with restore and conflict protection; delivery to audiences; view-only, watermarked and logged views; exports only when the head coach allows; install sheets with viewed-by tracking; knowledge checks; full-screen game mode (move players, draw, offline cache) governed by a per-state setting |
| 4 | Players and teams | Player accounts by invite; levels, multiple teams per level, units and editable positions; coach-set details with dated height and weight; player-editable photo and personal fields; roster filters, sort, CSV import and export; drag-and-drop depth charts on a formation layout (tap-to-move on touch), per team, unit and week, with copy, history, moves recorded and visibility to players; availability status; height, weight and ratings shown only to coaches and trainers; season rollover |
| 5 | Attendance | Coach marking (mark all present, then exceptions) and self check-in by code or QR code; statuses with reasons; RSVP pre-marks for coaches to confirm; live dashboard with team, unit, position and my-group filters; availability shown; history, reports and CSV export; alert thresholds for absences and lates; optional parent notice; offline queue with conflicts kept for review |
| 6 | Weight room and nutrition | Exercise library; multi-week program builder and templates; assignment to any audience with individual overrides; loads as % of tested max; player logging that works offline; testing days, PRs and spreadsheet import; coach completion dashboard and group progress; workouts as calendar events; private body-weight log; leaderboards (never body weight); meal plans that need trainer approval and can be locked, with adherence tracking and opt out |
| 7 | Communication | Announcements by push and email with read receipts; group chats under the two-adult rule; no private coach-to-player threads (questions automatically add a second adult); all messages saved (senders hide, admins keep the original); athletic director oversight; quiet hours (default 5 a.m. to 9 p.m.) with an emergency bypass; contact details never shown; reporting, hide, lock, mute and remove; parent contact blocks applied by the head coach, with the AD notified; file controls; risky-language flags; polls and reactions |
| 8 | Equipment | Catalog with serialized and bulk (by size) items; issue with jersey numbers and duplicate warnings; bulk kit issue; check-in as returned, damaged or lost; outstanding list with replacement cost and export; player and parent acknowledgment; helmet recertification and age flags following NOCSAE guidance plus the program's own rule; fit records; item history across seasons; inventory counts, low stock and reorder list; tag lookup by camera or typing |
| 9 | Assignments and reports | Watch, study, checklist, submit and quiz assignments for any audience; statuses including late; automatic reminders; feedback, marks and scores; weekly recurrence and templates; report forms whose responses only the staff they are shared with can see |
| 10 | Season and development | Seasons with phases; week-by-week season plan with week goals; one development timeline per player (ratings, notes, attendance, tests, assignments, depth-chart moves); trend charts against the position-group average; sortable position-group view; goals (test goals tracked automatically); preseason, midseason and end-of-season evaluations; printable player and team reports; head coach and player home screens |

The app also covers role-based access, an audit log, invite-based sign-in with two-step codes for staff, separation between schools (every query is scoped to the program), WCAG-minded markup, an installable web app with offline support, and CSV and print-to-PDF exports.

## Architecture

- `server/`: a plain Node HTTP server (`app.js`) and the built-in SQLite (`db.js`, with the whole schema). `core.js` holds roles, capabilities, audience resolution, quiet hours, notifications and the audit log. There is one file per module in `server/modules/`.
- `public/`: a vanilla JavaScript single-page app with no build step. `js/app.js` is the shell and router, `js/ui.js` the shared components, `js/field.js` the play renderer and animator, and `js/pages/*` holds one file per module. `sw.js` and `api.js` provide offline caching and the offline write queue.
- Data lives in `data/app.db`. Set `DB_FILE` or `PORT` to change where it is stored or which port the server uses.

## Google Workspace

Each staff member can connect their own Google account under **Integrations** (`/settings/integrations`) and choose which features to grant:

- **Gmail:** emails with a label you pick (default "Team Calendar") are scanned every 10 minutes; a built-in parser turns dates, times, places and opponents into event drafts that you review, edit and approve onto the calendar. Approved emails get an "Imported" label. The head coach can also deliver the email outbox through a staff member's Gmail.
- **Google Calendar:** push the events you can see to a Google calendar (re-pushing updates instead of duplicating) and import Google events into the same review queue.
- **Google Sheets:** import the roster or test maxes from a sheet; export roster, attendance and outstanding equipment to a new spreadsheet.
- **Google Docs:** export a practice plan or a player's season report.

It needs a Google Cloud OAuth client and these environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` and `TOKEN_KEY` (tokens are stored encrypted). Step-by-step setup for Render: [docs/google-setup.md](docs/google-setup.md).

## Not connected yet

These need school accounts or credentials before they can work:

- **Email:** messages are written to an outbox, which you can view under Settings › Email outbox. Real delivery needs a mail provider, or a connected Gmail account (see Google Workspace above).
- **Push:** notifications appear in the app's Alerts panel. Real phone push needs Web Push keys.
- **School sign-in:** the Google and Microsoft buttons explain that the school's OAuth client must be set up first.
- **QR images:** the check-in QR image is drawn with a small library from cdnjs. The typed code always works without it.

These rules should be confirmed with counsel and the state association before launch: education privacy law, parental consent, district messaging policy, current NFHS and state game-day technology rules, and practice-time limits.

## Deploy on Render

`render.yaml` is a Render Blueprint: in Render choose **New › Blueprint**, pick this repository, and it creates one web service with a persistent 1 GB disk for the database. It starts in demo mode (`DEMO_MODE=1`), with the sample program and demo sign-ins. For real use, set `DEMO_MODE=0` and fill in `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `PROGRAM_NAME`. The first start then creates your program and head coach account. Set `APP_URL` to the service URL, and follow [docs/google-setup.md](docs/google-setup.md) to connect Google.

## Windows desktop app

`desktop/` is an Electron app that installs like any Windows program and updates itself.

- **Download:** get `ProgramManager-Setup-x.y.z.exe` from the repository's [Releases](https://github.com/oofski/ManagementPlatform/releases) page.
- **First run:** choose to connect to your program's server (for example your Render link), so that coaches, players and parents share one program, or to run everything on this computer.
- **Updates:** the app checks Releases at launch and every 6 hours. It downloads new versions in the background and asks to restart. You can also check from Help › Check for updates.
- **Publishing an update:** bump `version` in `desktop/package.json` (for example to 1.0.1), commit and push. The **Desktop release** workflow builds the installer on Windows and publishes the release, and installed apps pick it up automatically.
- **Local development:** run `cd desktop`, then `npm install`, then `npm start`.

The installer is not code-signed yet, so Windows SmartScreen shows "Windows protected your PC" the first time. Click **More info** and then **Run anyway**. A code-signing certificate removes this warning.
