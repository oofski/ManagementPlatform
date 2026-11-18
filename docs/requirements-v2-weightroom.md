# v2 requirements: Weight room core platform and football module (from the product owner, verbatim)

## Core platform requirements
The core platform has to match TeamBuildr's weight-room table stakes before the football layer matters, because coaches will compare the two on the first trial day. P0 is the MVP, P1 follows within two releases, P2 is later.

| ID | Requirement | Priority | Vs. TeamBuildr |
|---|---|---|---|
| **Accounts and roster** ||||
| C-1 | Roster import from CSV or Google Sheet (name, grade, position, jersey, parent contact) | P0 | Parity |
| C-2 | Teams (Freshman, JV, Varsity) and position groups; an athlete can sit in one team and one position group | P0 | Differentiator |
| C-3 | Unlimited coach seats with per-group permissions (see Roles) | P0 | Parity |
| C-4 | Athlete sign-in without a personal email: join code or QR per team | P0 | Differentiator |
| C-5 | School SSO (Google Workspace for Education, Clever) | P1 | Not found |
| **Programming** ||||
| C-6 | Block builder: weeks and days, sets, reps, percent of max, RPE, notes; drag-and-drop, copy week, undo | P0 | Parity |
| C-7 | Team, group and athlete layers, so one master plan can be overridden for one player | P0 | Parity |
| C-8 | Date-based and dateless programs | P1 | Parity |
| C-9 | Exercise library with demo video and custom exercises (target 500+ at launch) | P0 | Parity |
| C-10 | Template library with football programs for each phase of the year | P0 | Parity |
| **Delivery and logging** ||||
| C-11 | Shared-tablet station mode: 4–8 athletes per device, tap to log load and reps, works on iPad and Chromebook | P0 | Parity |
| C-12 | Phone web app for athletes and coaches; native apps later | P0 | Parity (TeamBuildr has native apps) |
| C-13 | Offline logging that syncs when the connection returns | P1 | Not found |
| C-14 | TV and whiteboard display of the day's workout | P1 | Parity |
| **Tracking and motivation** ||||
| C-15 | Max and PR tracking; training maxes update automatically after each session | P0 | Parity |
| C-16 | Leaderboards by team and position group, with a coach switch to hide them | P0 | Parity |
| C-17 | Team feed for PRs and coach posts | P1 | Parity |
| C-18 | Daily wellness questionnaire (sleep, soreness, mood) | P1 | Parity |
| **Attendance** ||||
| C-19 | Check-in by tablet, QR or coach roll call; present, tardy, excused, absent | P0 | Differentiator |
| C-20 | Attendance linked to workouts and practices, with a streak and trend view | P1 | Differentiator |
| **Reporting and communication** ||||
| C-21 | Completion, progress, PR and attendance reports by athlete, group and date range; export to PDF and CSV | P0 | Parity |
| C-22 | Weekly email report to athlete, parent and AD, scheduled | P1 | Parity (Platinum and up) |
| C-23 | Messaging and document sharing | P1 | Parity |
| C-24 | Season rollover that archives results and carries athletes into next year | P1 | Not found |
| C-25 | Integrations (force plates, VBT, API) | P2 | Parity (Platinum Pro) |

## Football module requirements
These are the features that separate the product from a multi-sport lifting tool. Four are P0 because they decide whether a head coach switches: position-group programming, a basic testing battery, availability status and an eligibility checklist.

| ID | Requirement | Priority |
|---|---|---|
| **Position groups and depth** |||
| F-1 | Assign a training block or conditioning plan to a position group (OL, DL, LB, DB, QB, RB/TE, WR, K/P) with starter templates per group | P0 |
| F-2 | Depth chart: drag players into offense, defense and special-teams slots with first, second and third string; export to PDF | P1 |
| **Practice and game week** |||
| F-3 | Practice plan builder: timed periods, drill library with diagrams and video, staff assigned per period, phone view for the field, printable | P1 |
| F-4 | Game schedule and season calendar (games, practices, lifts, camps) with an iCal feed for parents | P1 |
| F-5 | Game-week lifting template that scales volume by days to the next game and swaps in a game-day activation lift | P1 |
| **Testing and body metrics** |||
| F-6 | Football testing battery: 40-yard dash with 10-yard split, pro agility (5-10-5), L-drill, vertical, broad jump, 1RM or rep tests for bench, squat and clean, height and weight | P0 |
| F-7 | Custom composite score (the coach defines which tests and weights count) and before-and-after comparison by position group | P1 |
| F-8 | Bodyweight trend per athlete, visible to coaches only and never on a leaderboard | P1 |
| F-9 | Grade-level and position norms for the testing battery | P2 |
| **Safety and availability** |||
| F-10 | Availability status (full, limited, out, cleared) set by coach or athletic trainer; a limited athlete is flagged on the roster, the lift and the practice list | P0 |
| F-11 | Heat-acclimatization log: date, heat reading, duration and equipment level; warns when the day's plan exceeds the configured state schedule | P1 |
| F-12 | Concussion return-to-play tracker: staged protocol with sign-off by a designated medical professional; coaches see the stage, not the medical detail | P1 |
| **Eligibility and equipment** |||
| F-13 | Eligibility checklist per athlete: physical on file with expiry, parent consent, emergency contact, insurance, fees, academic status; a roster view of who is cleared | P0 |
| F-14 | Digital forms with parent e-signature for consent and emergency contact | P1 |
| F-15 | Equipment issue and return log by player (helmet, pads, jersey, size, serial) with an end-of-season missing-items report | P1 |
| **Communication and development** |||
| F-16 | Coach assignments with due dates and completion tracking for a player, a position group or the whole team (film review, forms, install quizzes) | P1 |
| F-17 | Parent digest: schedule, attendance and progress by email | P1 |
| F-18 | Recruiting profile: verified testing results, PRs, grade-point average, film link, coach-approved one-page export for seniors | P2 |
| F-19 | Milestone clubs and weekly awards that post to the team feed | P2 |

Instruction from the product owner: implement all of these into the weight room module. Where the holistic platform already has a feature, keep it and connect to it rather than duplicating it.
