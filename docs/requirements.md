# Requirements traceability

Each requirement ID from the product requirements document, with where it is implemented. Server code is in `server/modules/`, pages are in `public/js/pages/`.

## Users and roles
- Head coach (admin): full access; manages staff, roles and sharing. `auth.js` staff endpoints, `core.js can()`, Settings › Staff and roles
- Coach: edits events, plans and ratings for their own groups (staff_scopes). `core.js managesAudience`
- Trainer: health status; calendars and rosters; no playbook or ratings unless granted. `can()`: trainer_playbook, trainer_ratings
- Other staff (AD, managers, volunteers): mostly read-only; per-user grants. `perms`
- Player: own calendar, RSVP, assigned plays and drills, invites 1–2 parents. `/api/me/parents`
- Parent: player's calendar, RSVP on the player's behalf, no playbook
- Onboarding: coaches invite players, players invite parents

## Module 1: Calendar (`calendar.js`, `calendar.js` page)
CAL-1 audiences and per-user filtered calendar · CAL-2 per-type fields · CAL-3 create, edit and delete · CAL-4 recurring, one occurrence or series · CAL-5 game-week template · CAL-6 quick status with notify · CAL-7 change log · CAL-8 role permissions · CAL-9 push and email, reminders (24 h, 2 h, configurable), urgent vs routine · CAL-10 acknowledgments · CAL-11 RSVP with reasons, deadline, parent replies, coach RSVP · CAL-12 RSVP becomes planned attendance · CAL-13 ICS subscribe link and email details · CAL-14 (Later) conflict detection: not built · CAL-15 (Later) practice time vs limits: weekly totals vs configurable limits in practice plans · CAL-16 (Later) two-way sync: not built · CAL-17 (Later) SMS: not built

## Module 2: Practice planning (`practice.js`)
PRAC-1 plans tied to practice events with ordered periods · PRAC-2 drill library with search · PRAC-3 templates, copy, game-week plans · PRAC-4 groups per period with coach · PRAC-5 run mode · PRAC-6 quick notes with tags · PRAC-7 numeric ratings per drill · PRAC-8 rating screen limited to the group, showing unit and level · PRAC-9 offline · PRAC-10 summary shared · PRAC-11 plays on periods · PRAC-12 absent and limited players flagged · PRAC-13 time vs limits

## Module 3: Playbook (`playbook.js`, `field.js`)
PLAY-1 designer and formations · PLAY-2 animation, motion, speed, step · PLAY-3 playbooks, folders, tags, search · PLAY-4 coaching points and per-position assignments, video · PLAY-5 multi-editor with version history · PLAY-6 delivery to audiences · PLAY-7 view-only, watermark, revoke on roster exit, view log, export toggle · PLAY-8 install sheets with viewed-by · PLAY-9 game mode, offline, per-state setting · PLAY-10 knowledge checks · PLAY-11 (Later) print sheets: admin-controlled export/print only

## Module 4: Players and teams (`roster.js`, players and depth pages)
PLR-1 player accounts · PLR-2 levels and multiple teams · PLR-3 units · PLR-4 editable positions · PLR-5 coach-set details with dated height and weight · PLR-6 profile with player-editable photo and personal fields · PLR-7 roster filters and CSV import · PLR-8 drag-and-drop depth charts · PLR-9 player on several charts · PLR-10 versions per week, copy, visibility · PLR-11 availability with return date · PLR-12 sensitive fields coaches and trainers only · PLR-13 season rollover

## Module 5: Attendance (`attendance.js`)
ATT-1 coach marking and self check-in code/QR · ATT-2 statuses with reasons · ATT-3 planned vs actual · ATT-4 live dashboard with filters · ATT-5 group attendance · ATT-6 availability shown · ATT-7 history, reports, export, thresholds · ATT-8 offline · ATT-9 parent absence notice (setting)

## Module 6: Weight room and nutrition (`weights.js`)
WGT-1 exercise library · WGT-2 program builder and templates · WGT-3 assignment plus individual overrides · WGT-4 % of max loads · WGT-5 player logging, offline · WGT-6 testing and PRs · WGT-7 coach dashboard · WGT-8 workouts as calendar events · WGT-9 body-weight log · WGT-10 meal plans and adherence · WGT-11 import maxes · Safeguards: private body weight, no body-weight rankings, trainer-approved/locked plans, meal and hydration tracking only, opt out

## Module 7: Communication (`comms.js`)
COM-1 announcements with read receipts · COM-2 group chats · COM-3 two-adult rule · COM-4 no private coach-to-player threads; question threads add a second adult · COM-5 saved records; sender removal keeps the original; AD reads all · COM-6 quiet hours with emergency bypass · COM-7 private contact details · COM-8 report, mute, remove, lock, hide · COM-9 parent contact block, AD notified · COM-10 photo and file limits · COM-11 risky-language flags · COM-12 polls and reactions

## Module 8: Equipment (`equipment.js`)
EQP-1 catalog · EQP-2 serial and bulk items · EQP-3 issue with unique jersey warning · EQP-4 bulk kit · EQP-5 returns · EQP-6 outstanding with cost and export · EQP-7 player/parent view and acknowledgment · EQP-8 helmet recertification, age flags, fits · EQP-9 item history · EQP-10 permissions · EQP-11 counts, low stock, reorder · EQP-12 scan lookup

## Module 9: Assignments (`assignments.js`)
ASN-1 assignments to audiences, on home and calendar · ASN-2 watch, study, complete, submit · ASN-3 status and dashboard · ASN-4 automatic reminders · ASN-5 feedback and marks · ASN-6 report forms with restricted visibility · ASN-7 recurring and templates · ASN-8 feeds the development record · ASN-9 quizzes

## Module 10: Season tracking (`season.js`, development page)
SEA-1 seasons and phases; activity scoped to a season · SEA-2 week-by-week plan · SEA-3 development timeline · SEA-4 trends vs group average · SEA-5 position-group view · SEA-6 goals · SEA-7 head coach home · SEA-8 player view · SEA-9 evaluations · SEA-10 printable reports

## Security and platform
SEC-1 RBAC · SEC-2 audit log · SEC-3 invites, school SSO (stub, needs configuration), 2-step for staff · SEC-4 HTTPS and encryption at rest come from deployment; backups are SQLite file copies · SEC-5 messaging safeguards · SEC-6 play protection · SEC-7 minimal health data · SEC-8 no public pages (robots disallow) · SEC-9 access ends on archive; export and delete · SEC-10 legal process · SEC-11 accessible markup
PLT-1 responsive installable web app · PLT-2 offline queue, conflicts kept and flagged · PLT-3 few taps · PLT-4 sized for a large program · PLT-5 push (in-app) and email (outbox) · PLT-6 ICS · PLT-7 CSV exports, print-to-PDF · PLT-8 every query scoped by program_id · PLT-9 and PLT-10 Later: not built
