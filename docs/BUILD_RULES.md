# Rules for every builder working on v2.0.0 (several builders work in this tree at the same time)

## Codebase
- Node 22 with zero npm dependencies on the server (built-in `node:sqlite`). A vanilla-JS single-page app in `public/` with no build step. The Electron shell lives in `desktop/`.
- Read first: `README.md`, `server/app.js`, `server/core.js` (roles and `can()` capabilities, audiences, `notify`, `audit`, quiet hours, settings), `server/db.js` (the SCHEMA string), `public/js/app.js` (ROUTES, nav), `public/js/ui.js` (html templating, modal, formData, audienceField, charts, toast), `public/js/icons.js` (Lucide icons: `icon(name, size)`), and `public/css/app.css` (the design system).
- Handlers: `router.get/post/put/del(path, ({ user, params, query, body, db, core }) => result, opts)`. Use `fail`/`need` from core.js for errors. Scope every query by `user.program_id`. Check permissions with `core.can(user, cap)` or isStaff/isAdmin. Call `core.audit(...)` on sensitive writes.

## Editing shared files safely
- For every file that already exists: use the Edit tool (exact string replace) right after a fresh Read. Never Write or overwrite an existing file, and never use sed -i or a script to rewrite a whole file. Other builders edit the same files at the same moment.
- `server/db.js`: only append new `CREATE TABLE IF NOT EXISTS` blocks. To add a column to an existing table, add an idempotent migration in `openDb` (check `PRAGMA table_info`, then `ALTER TABLE ... ADD COLUMN`). Never change existing table definitions in place.
- `server/core.js`: only add new keys to DEFAULT_SETTINGS and new cases to `can()`.
- `server/app.js`: only add your module import and registration line.
- `public/js/app.js`: only add ROUTES lines and nav items.
- Prefer new files (new server modules, new page files) over growing someone else's file.
- Only touch the files your brief assigns to you, plus the shared hooks above.

## Design system (the owner rejected an "AI-looking" UI; keep the current look)
- Use the existing classes: card/hd/bd/ft, list, tbl-wrap + table, badge (ok/warn/bad/blue/green), seg, tabs, filters, fields/field, notice, stat, kpis (via `.grid.g4 > .card.stat`), chip, empty, help.
- Neutral monochrome UI. Color only carries meaning. Primary buttons are `.primary` (ink). Icons come from `public/js/icons.js`. Don't use emoji in the UI chrome, gradients, or new color palettes. If you truly need new CSS, append a small, clearly labeled block at the END of `public/css/app.css` using the existing CSS variables, and never edit existing rules.
- Copy is plain and specific: sentence case, with no marketing tone.
- Every page works on a phone (390px wide, no horizontal page scroll) and on a tablet.

## Quality
- Add API tests in a new file `test/NN-<area>.test.js`, using `test/helpers.js` (read it: `setup()`, `as()`, `addOtherProgram()`). Cover permission and cross-program negative cases.
- `npm test` must pass fully before you finish. If another builder's in-progress file breaks it for reasons clearly outside your files, say so in your report.
- Seed realistic demo data for your features in `server/seed.js`. Append only, inside the existing `db.tx` block (before its closing), and use Edit.
- Add your new pages to the browser smoke test (`test/ui/smoke.mjs`): append paths to the `staffPages` and/or `familyPages` arrays with Edit. Running `npm run test:ui` is optional (it is slow). The integrator runs it.
- Do not commit or push. The integrator does that.
- Final report: requirement ID → what was built (file, endpoint, UI location), anything you deliberately left partial, test counts.
