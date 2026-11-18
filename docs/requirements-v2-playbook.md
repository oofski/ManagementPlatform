# v2 requirements: Playbook module (from the product owner, verbatim)

## 4.1 Playbooks
| ID | Requirement | Detail from the Guide |
|---|---|---|
| PB-1 | Create a playbook | Name it and create it from the Playbooks tab (+ Add Playbook). A playbook must exist before any play can be added. |
| PB-2 | Rename a playbook | Inline in the playbook header (then Save) or from the right-click menu on the Dashboard or Playbooks list. |
| PB-3 | Offense and defense sides | Each playbook has Offense and Defense tabs; defensive plays are added from the Defense tab. |
| PB-4 | Group plays | "Group By" five options: Play Name, Formation, Play Type, Distance, Down & Distance. |
| PB-5 | Add a play | From the playbook's + Add Play button or by right-clicking a playbook in a list and choosing Add Play to Playbook. |
| PB-6 | Delete a playbook | Right-click menu or button at the bottom of the playbook page. Deleting a playbook also deletes every play inside it (explicit warning in the Guide). |

## 4.2 Plays
| ID | Requirement | Detail from the Guide |
|---|---|---|
| PL-1 | Create offensive or defensive play | Plays live inside a playbook; creation opens the Play Designer. |
| PL-2 | Edit, rename, delete | Click a play to edit; rename inline or by right-click; delete from the quick-access button or right-click. |
| PL-3 | Duplicate | Copy is suffixed "(Copy)". Three entry points, including Duplicate to Playbook, which copies a play into a different playbook. |
| PL-4 | Play Tags | Checkboxes for play type, distance, and down & distance. These drive grouping and Playcaller Mode navigation. |
| PL-5 | Export a play | File type PDF or PNG; PDF layout Portrait or Landscape; theme (Grass for presentation, Paper for black-and-white printing); editable file name defaulting to the play name. |
| PL-6 | Defensive Coordinator Mode | Setting that opens the defensive side of the playbook first. |

## 4.3 Play Designer (the core feature)
| ID | Requirement | Detail from the Guide |
|---|---|---|
| PD-1 | Player types | Eight starting types: Circle, Square, Triangle, X, Letter, and Circle, Square or Triangle with a letter. Type can be changed after placement. |
| PD-2 | Place and move players | Drag from the palette under the field. Move by dragging or with arrow keys for fine adjustment. A player's attached route moves with the player. |
| PD-3 | Move whole formation | Dragging the Center (or, if none is marked, a square-icon player) slides all offensive and defensive players along the line of scrimmage, to place the ball anywhere between the hashes. |
| PD-4 | Player menu | Position (applies that position's color and letter), type, color, and shade (a marker coaches use to communicate play concepts). Color is locked when a position is set, so it stays consistent with the Positions page. |
| PD-5 | Route Mode | Toggled by clicking a route-type button. State is shown four ways: ON/OFF text, blue border and strip, a depressed button, and a blue-bordered field. |
| PD-6 | Straight routes | "Point and Click": select a player, click field points; add segments with further clicks. Suited to crisp angles. |
| PD-7 | Curved routes | "Click and Drag" with automatic subtle smoothing on release. |
| PD-8 | Optional routes | Branch a (typically dashed) optional route off a primary route, and off other optional routes, to any depth. |
| PD-9 | Auto-blocking | With Route Mode on, select an offensive player and double-click a defender; a blocking route is drawn between them. |
| PD-10 | Route Menu | Default groups (e.g. Posts/Corners, Outs/Ins, Stops, Blocks), position-specific routes (e.g. Quarterback), recently used routes, then custom routes. Opens by right-click in Route Mode or from the player menu. A Flip button mirrors routes before insertion. |
| PD-11 | Zones | Square and circle/oval zones: drag onto the field, resize from the bottom-right handle, move, delete via trash icon. |
| PD-12 | Text boxes | Auto-resizing text for play instructions; draggable by border; deletable. |
| PD-13 | Formation selection | Separate offensive and defensive formation per play, chosen from your saved list. "Linemen Base" (the front five) is always first. If players are already on the field: Keep Players, Clear Players (that side only), or Change Formation Name Only. |
| PD-14 | Flip | Vertical flip changes perspective (offense to defense view, mirrored so assignments stay the same). Horizontal flip shows the play to the other side. |
| PD-15 | Smart Flip | On horizontal flip, assignments swap but side-specific linemen (tackles, guards, defensive linemen) remain on the correct side of the field. |

## 4.4 Formations
| ID | Requirement | Detail from the Guide |
|---|---|---|
| FM-1 | Formation designer | Create a formation once by placing players on the field; reuse it in any play. Offensive and defensive formations are supported. |
| FM-2 | Manage formations | Create (+ Add Formation), open to edit, rename inline or by right-click, duplicate ("(Copy)"), delete. |
| FM-3 | Stated rationale | Saves time (no placing players one by one) and guarantees consistency (identical alignment every time). Count is capped per plan: 25 / 250 / unlimited. |

## 4.5 Custom routes
| ID | Requirement | Detail from the Guide |
|---|---|---|
| RT-1 | Route designer | Draw a route once from an immovable template player in the middle of the field, using the same mechanics as the Play Designer; save and reuse in any play. |
| RT-2 | Smart Distance | Per-route setting, on by default. Adds a route stem when a player starts behind the line of scrimmage so that, for example, a 10-yard out always runs ten yards past the line. Intended only for routes that go downfield. |
| RT-3 | Manage routes | Create, edit, rename, duplicate, delete from the Routes page. |

## 4.6 Positions
| ID | Requirement | Detail from the Guide |
|---|---|---|
| PS-1 | Rename positions | e.g. "Running Back" to "Halfback"; the new name propagates to every play and formation. |
| PS-2 | Position letter and color | Letter (up to three characters) shown when the player type is a letter; color from blue, red, green, orange, purple, yellow, or default (theme-dependent white or black). Edits apply across the whole account. |
| PS-3 | Abbreviation | Up to four characters. Announced: not yet attached to any component; reserved for future features. |

## 4.7 Playcaller Mode
| ID | Requirement | Detail from the Guide |
|---|---|---|
| PC-1 | Full-screen play browsing | Opened from the side panel; pick a playbook, then browse "like a video game". Designed for tablets and large phones, to hold up to a huddle. |
| PC-2 | Situation navigation | Offense or Defense, then Play Name, Formation, Play Type (Pass/Run/Trick/etc.), Distance, or Down & Distance. Example paths: Offense, Play Type, Passing; Offense, Down & Distance, 2nd and Short. |
| PC-3 | Navigation controls | Back button and breadcrumbs; the X at top right exits to the Dashboard. |
| PC-4 | Announced extensions | The Guide lists, as future features: animated plays, telestration, play call logs, interactive play design. |

Instruction from the product owner: all of these go into the playbook module. Existing playbook capabilities (animation, view-only security, watermarking, install sheets, delivery, game mode) stay.
