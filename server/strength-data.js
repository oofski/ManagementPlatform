// Weight room v2 data: the built-in exercise library (C-9), the football template library (C-10, F-1, F-5),
// position groups, milestone clubs (F-19), reference norms (F-9) and idempotent per-program seeding.
// Imports nothing from the server modules so seed.js can use it directly.

export const LIBRARY_VERSION = 1;
export const TEMPLATE_VERSION = 1;

// Football position groups (F-1) and the roster position codes they cover.
export const POS_GROUPS = {
  OL: ['OL', 'LS'], DL: ['DL'], LB: ['LB'], DB: ['DB'], QB: ['QB'], 'RB/TE': ['RB', 'TE'], WR: ['WR', 'RET'], 'K/P': ['K', 'P'],
};
export const groupOf = (positions = []) => {
  for (const p of positions) for (const [g, codes] of Object.entries(POS_GROUPS)) if (codes.includes(p)) return g;
  return null;
};
// primary_group (roster module) holds a position code chosen by the coach; fall back to the listed positions.
export const athleteGroup = (primary, positions = []) => (primary && (POS_GROUPS[primary] ? primary : groupOf([primary]))) || groupOf(positions);
export const groupTokens = (g) => (POS_GROUPS[g] || []).filter((c) => !['LS', 'RET'].includes(c) || g === c).map((c) => `pos:${c}`);

const yt = (name) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise demo`)}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const PROPER = /^(Romanian|Arnold|Z |JM |B-stance|Y-T-W|Pendlay|Meadows|Yates|Larsen|Spoto|Viking|Zercher|Pallof|Turkish|Copenhagen|Nordic|Cossack)/;
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- exercise library (C-9): base movements x equipment, with cues and a demo search link ----------
function buildLibrary() {
  const out = new Map();
  const add = (name, category, pattern, equipment, cues, test_key = null) => {
    const n = cap1(name.trim());
    const key = slug(n);
    if (out.has(key)) return;
    out.set(key, { key, name: n, category, pattern, equipment, cues, video_url: yt(n), test_key });
  };
  // Each family: names x equipment. "Barbell" is implied (no prefix) for classic barbell lifts.
  const family = (names, equip, category, pattern, cues, { implied = 'Barbell', skip = {}, tests = {} } = {}) => {
    for (const nm of names) {
      for (const eq of equip) {
        if ((skip[nm] || []).includes(eq)) continue;
        const name = eq === implied ? nm : `${eq} ${PROPER.test(nm) ? nm : nm.charAt(0).toLowerCase() + nm.slice(1)}`;
        add(name, category, pattern, eq, cues[nm] || cues._, eq === implied ? tests[nm] || null : null);
      }
    }
  };
  const fixed = (list, category, pattern, equipment, cues) => {
    for (const it of list) {
      const [nm, eq, cue, test] = Array.isArray(it) ? it : [it];
      add(nm, category, pattern, eq || equipment, cue || cues, test || null);
    }
  };

  // Squats
  fixed([
    ['Back squat', 'Barbell', 'Brace, knees out, hit depth', 'squat'], ['Front squat', 'Barbell', 'Elbows high, sit between the heels'],
    ['Box squat', 'Barbell', 'Sit back to the box, stay tight, drive up'], ['Pause back squat', 'Barbell', 'Two-second pause in the hole, stay braced'],
    ['Pause front squat', 'Barbell', 'Pause at depth, elbows up'], ['Safety bar squat', 'Safety squat bar', 'Chest up against the bar, knees forward'],
    ['Pin squat', 'Barbell', 'Dead stop on the pins, explode up'], ['Tempo back squat', 'Barbell', 'Three seconds down, drive up'],
    ['Anderson squat', 'Barbell', 'Start from the pins, brace before every rep'], ['Zercher squat', 'Barbell', 'Bar in the elbows, stay upright'],
    ['Overhead squat', 'Barbell', 'Active shoulders, bar over midfoot'], ['High-bar back squat', 'Barbell', 'Upright torso, knees forward'],
    ['Low-bar back squat', 'Barbell', 'Hips back, bar over midfoot'], ['Belt squat', 'Belt squat machine', 'Upright, sit straight down'],
    ['Hack squat', 'Machine', 'Full foot pressure, control the bottom'], ['Leg press', 'Machine', 'Low back flat on the pad'],
    ['Single-leg leg press', 'Machine', 'Knee tracks over the toes'], ['Goblet squat', 'Dumbbell', 'Elbows inside the knees, tall chest'],
    ['Heel-elevated goblet squat', 'Dumbbell', 'Knees forward, stay tall'], ['Kettlebell front squat', 'Kettlebell', 'Bell in the rack, ribs down'],
    ['Double kettlebell front squat', 'Kettlebell', 'Bells tight in the rack'], ['Landmine squat', 'Landmine', 'Hold the bar at the chest, sit down'],
    ['Sumo squat', 'Dumbbell', 'Wide stance, toes out'], ['Bodyweight squat', 'Bodyweight', 'Full depth, heels down'],
    ['Jump squat', 'Bodyweight', 'Quick dip, full extension, soft landing'], ['Trap bar jump squat', 'Trap bar', 'Light load, maximal intent'],
    ['Dumbbell jump squat', 'Dumbbell', 'Light load, land soft'], ['Wall sit', 'Bodyweight', 'Thighs parallel, back flat'],
    ['Spanish squat', 'Band', 'Band behind the knees, sit back'], ['Sissy squat', 'Bodyweight', 'Knees forward, hips extended'],
    ['Smith machine squat', 'Smith machine', 'Feet slightly forward'], ['Banded back squat', 'Barbell', 'Accelerate through the band'],
    ['Chain back squat', 'Barbell', 'Fast out of the hole'], ['Quarter squat', 'Barbell', 'Heavy and fast, short range'],
    ['Half squat', 'Barbell', 'Control the depth, drive hard'], ['1¼ back squat', 'Barbell', 'Down, quarter up, down, stand'],
    ['1¼ front squat', 'Barbell', 'Stay upright through both bottoms'], ['Cyclist squat', 'Dumbbell', 'Narrow stance, heels raised'],
  ], 'Lower', 'squat');

  // Single-leg
  family(['Split squat', 'Rear-foot elevated split squat', 'Front-foot elevated split squat', 'Reverse lunge', 'Forward lunge', 'Walking lunge',
    'Lateral lunge', 'Curtsy lunge', 'Deficit reverse lunge', 'Step-up', 'Lateral step-up', 'Crossover step-up', 'Single-leg box squat', 'Skater squat', 'Cossack squat'],
  ['Bodyweight', 'Dumbbell', 'Kettlebell', 'Barbell', 'Safety squat bar', 'Landmine'], 'Lower', 'single_leg',
  { _: 'Front knee tracks over the toes, stay tall', 'Lateral lunge': 'Sit back into the hip, trail leg straight', 'Step-up': 'Drive through the top foot, no push-off',
    'Skater squat': 'Back knee taps the pad, reach the arms', 'Cossack squat': 'Heel down, chest up' },
  { implied: 'Bodyweight', skip: { 'Skater squat': ['Barbell', 'Safety squat bar', 'Landmine'], 'Cossack squat': ['Barbell', 'Safety squat bar'], 'Single-leg box squat': ['Barbell', 'Safety squat bar', 'Landmine'], 'Curtsy lunge': ['Barbell', 'Safety squat bar', 'Landmine'], 'Crossover step-up': ['Landmine'] } });

  // Hinge
  family(['Deadlift', 'Romanian deadlift', 'Stiff-leg deadlift', 'Sumo deadlift', 'Deficit deadlift', 'Single-leg Romanian deadlift', 'B-stance Romanian deadlift',
    'Good morning', 'Hip thrust', 'Glute bridge', 'Single-leg hip thrust', 'Block pull', 'Rack pull'],
  ['Barbell', 'Dumbbell', 'Kettlebell', 'Trap bar', 'Landmine'], 'Lower', 'hinge',
  { _: 'Hinge at the hips, flat back, push the floor away', 'Romanian deadlift': 'Hinge, soft knees, bar close', 'Hip thrust': 'Chin tucked, ribs down, squeeze at the top',
    'Glute bridge': 'Drive through the heels, squeeze', 'Good morning': 'Soft knees, hips back, neutral spine' },
  { tests: { Deadlift: 'deadlift' }, skip: {
    Deadlift: [], 'Romanian deadlift': ['Trap bar'], 'Stiff-leg deadlift': ['Trap bar', 'Landmine'], 'Sumo deadlift': ['Trap bar', 'Landmine'], 'Deficit deadlift': ['Kettlebell', 'Landmine'],
    'Single-leg Romanian deadlift': ['Trap bar'], 'B-stance Romanian deadlift': ['Trap bar'], 'Good morning': ['Dumbbell', 'Kettlebell', 'Trap bar', 'Landmine'],
    'Hip thrust': ['Trap bar', 'Landmine'], 'Glute bridge': ['Trap bar', 'Landmine'], 'Single-leg hip thrust': ['Trap bar', 'Landmine'],
    'Block pull': ['Dumbbell', 'Kettlebell', 'Landmine'], 'Rack pull': ['Dumbbell', 'Kettlebell', 'Landmine', 'Trap bar'] } });
  fixed([
    ['High-handle trap bar deadlift', 'Trap bar', 'Hips down, chest tall, push the floor away'], ['Kettlebell swing', 'Kettlebell', 'Snap the hips, float the bell'],
    ['Single-arm kettlebell swing', 'Kettlebell', 'Square shoulders, snap the hips'], ['Back extension', 'Bodyweight', 'Neutral spine, squeeze the glutes'],
    ['45-degree back extension', 'Bodyweight', 'Hinge at the hip, not the low back'], ['Reverse hyper', 'Machine', 'Swing with the glutes'],
    ['Glute-ham raise', 'Machine', 'Knees on the pad, keep the hips extended'], ['Nordic hamstring curl', 'Bodyweight', 'Lower as slowly as you can'],
    ['Razor curl', 'Bodyweight', 'Hips extended, hamstrings pull you up'], ['Slider leg curl', 'Sliders', 'Hips up throughout'],
    ['Stability ball leg curl', 'Stability ball', 'Hips high, curl the heels in'], ['Lying leg curl', 'Machine', 'Hips down on the pad'],
    ['Seated leg curl', 'Machine', 'Control the return'], ['Cable pull-through', 'Cable', 'Hinge, snap the hips forward'],
    ['Banded good morning', 'Band', 'Hips back, neutral spine'], ['Trap bar deadlift', 'Trap bar', 'Push the floor away'],
  ], 'Lower', 'hinge');

  // Olympic and power
  family(['Power clean', 'Hang power clean', 'Hang clean', 'Clean', 'Muscle clean', 'Clean pull', 'High pull', 'Power snatch', 'Hang power snatch', 'Hang snatch',
    'Snatch pull', 'Push press', 'Push jerk', 'Split jerk', 'Clean and jerk', 'Block power clean', 'Hang clean pull', 'Snatch-grip high pull', 'Clean-grip shrug'],
  ['Barbell', 'Dumbbell', 'Kettlebell'], 'Olympic', 'power',
  { _: 'Bar close, hips through, fast elbows', 'Push press': 'Dip and drive, finish overhead', 'Power snatch': 'Wide grip, bar close, punch overhead',
    'Clean pull': 'Full extension, shrug, bar close', 'Push jerk': 'Dip, drive, drop under' },
  { tests: { 'Power clean': 'clean', 'Hang power clean': 'clean' }, skip: {
    'Hang clean': ['Kettlebell'], Clean: ['Dumbbell'], 'Muscle clean': ['Kettlebell'], 'Clean pull': ['Dumbbell', 'Kettlebell'], 'High pull': [], 'Power snatch': [],
    'Hang power snatch': ['Kettlebell'], 'Hang snatch': ['Kettlebell'], 'Snatch pull': ['Dumbbell', 'Kettlebell'], 'Push jerk': ['Kettlebell'], 'Split jerk': ['Kettlebell'],
    'Clean and jerk': ['Kettlebell'], 'Block power clean': ['Dumbbell', 'Kettlebell'], 'Hang clean pull': ['Dumbbell', 'Kettlebell'], 'Snatch-grip high pull': ['Dumbbell', 'Kettlebell'],
    'Clean-grip shrug': ['Dumbbell', 'Kettlebell'], 'Power clean': ['Kettlebell'], 'Hang power clean': [] } });

  // Upper push
  family(['Bench press', 'Incline bench press', 'Decline bench press', 'Close-grip bench press', 'Floor press', 'Pause bench press', 'Spoto press', 'Board press',
    'Pin press', 'Larsen press', 'Neutral-grip bench press', 'Single-arm bench press', 'Alternating bench press', 'Incline press'],
  ['Barbell', 'Dumbbell', 'Kettlebell', 'Swiss bar', 'Smith machine'], 'Upper', 'push',
  { _: 'Shoulder blades pinned, bar to the sternum, feet driving', 'Floor press': 'Elbows tucked to 45 degrees, pause on the floor', 'Spoto press': 'Stop an inch off the chest' },
  { tests: { 'Bench press': 'bench' }, skip: {
    'Bench press': [], 'Incline bench press': [], 'Decline bench press': ['Kettlebell', 'Swiss bar'], 'Close-grip bench press': ['Kettlebell'], 'Floor press': ['Smith machine'],
    'Pause bench press': ['Kettlebell'], 'Spoto press': ['Kettlebell', 'Smith machine'], 'Board press': ['Dumbbell', 'Kettlebell', 'Smith machine'], 'Pin press': ['Dumbbell', 'Kettlebell'],
    'Larsen press': ['Kettlebell', 'Smith machine'], 'Neutral-grip bench press': ['Barbell', 'Kettlebell', 'Smith machine'], 'Single-arm bench press': ['Barbell', 'Swiss bar', 'Smith machine'],
    'Alternating bench press': ['Barbell', 'Swiss bar', 'Smith machine'], 'Incline press': ['Barbell', 'Swiss bar', 'Smith machine'] } });
  fixed([
    ['Push-up', 'Bodyweight', 'Body in a straight line, chest to the floor'], ['Weighted push-up', 'Plate', 'Plate on the upper back, stay rigid'],
    ['Deficit push-up', 'Bodyweight', 'Hands on plates, deep stretch'], ['Band-resisted push-up', 'Band', 'Explode through the band'],
    ['Plyo push-up', 'Bodyweight', 'Push the floor away fast'], ['Clap push-up', 'Bodyweight', 'Explode, clap, land soft'],
    ['Dip', 'Bodyweight', 'Shoulders down, chest forward'], ['Weighted dip', 'Dip belt', 'Control the depth'], ['Ring push-up', 'Rings', 'Turn the rings out at the top'],
    ['Landmine press', 'Landmine', 'Press up and away, reach at the top'], ['Half-kneeling landmine press', 'Landmine', 'Squeeze the down-knee glute'],
    ['Cable chest fly', 'Cable', 'Soft elbows, hug the tree'], ['Dumbbell fly', 'Dumbbell', 'Stretch, do not overextend'], ['Machine chest press', 'Machine', 'Shoulder blades back'],
    ['Med ball chest pass', 'Medicine ball', 'Step and throw through the wall'],
  ], 'Upper', 'push');
  family(['Overhead press', 'Seated overhead press', 'Half-kneeling press', 'Z press', 'Arnold press', 'Behind-the-neck press', 'Single-arm overhead press', 'Bottoms-up press', 'Viking press'],
    ['Barbell', 'Dumbbell', 'Kettlebell', 'Landmine'], 'Upper', 'push', { _: 'Ribs down, squeeze the glutes, press straight up' },
    { skip: { 'Overhead press': [], 'Seated overhead press': ['Landmine'], 'Half-kneeling press': ['Barbell'], 'Z press': ['Landmine'], 'Arnold press': ['Barbell', 'Kettlebell', 'Landmine'],
      'Behind-the-neck press': ['Dumbbell', 'Kettlebell', 'Landmine'], 'Single-arm overhead press': ['Barbell'], 'Bottoms-up press': ['Barbell', 'Dumbbell', 'Landmine'], 'Viking press': ['Barbell', 'Dumbbell', 'Kettlebell'] } });

  // Upper pull
  family(['Bent-over row', 'Pendlay row', 'Seal row', 'Chest-supported row', 'Single-arm row', 'Meadows row', 'Gorilla row', 'Yates row', 'Three-point row', 'Renegade row'],
    ['Barbell', 'Dumbbell', 'Kettlebell', 'Landmine', 'Cable', 'Trap bar'], 'Upper', 'pull', { _: 'Flat back, pull to the hip, pause' },
    { skip: { 'Bent-over row': ['Landmine'], 'Pendlay row': ['Dumbbell', 'Kettlebell', 'Landmine', 'Cable'], 'Seal row': ['Kettlebell', 'Landmine', 'Cable', 'Trap bar'],
      'Chest-supported row': ['Barbell', 'Landmine', 'Trap bar'], 'Single-arm row': ['Barbell', 'Trap bar'], 'Meadows row': ['Barbell', 'Dumbbell', 'Kettlebell', 'Cable', 'Trap bar'],
      'Gorilla row': ['Barbell', 'Landmine', 'Cable', 'Trap bar'], 'Yates row': ['Dumbbell', 'Kettlebell', 'Landmine', 'Cable'], 'Three-point row': ['Barbell', 'Trap bar'],
      'Renegade row': ['Barbell', 'Landmine', 'Cable', 'Trap bar'] } });
  fixed([
    ['DB row', 'Dumbbell', 'Pull to the hip'], ['Seated cable row', 'Cable', 'Chest tall, elbows back'], ['Face pull', 'Cable', 'Pull to the eyes, thumbs back'],
    ['Band pull-apart', 'Band', 'Straight arms, squeeze the shoulder blades'], ['TRX row', 'Suspension trainer', 'Body straight, pull the chest to the hands'],
    ['Ring row', 'Rings', 'Body straight, pull and pause'], ['Inverted row', 'Barbell', 'Body straight, bar to the chest'], ['Feet-elevated inverted row', 'Barbell', 'Hips up, chest to the bar'],
    ['Pull-up', 'Bodyweight', 'Dead hang to chin over the bar'], ['Chin-up', 'Bodyweight', 'Palms in, chest to the bar'], ['Neutral-grip pull-up', 'Bodyweight', 'Full range'],
    ['Weighted pull-up', 'Dip belt', 'Control the descent'], ['Weighted chin-up', 'Dip belt', 'Full range, no kip'], ['Eccentric pull-up', 'Bodyweight', 'Five-second lower'],
    ['Band-assisted pull-up', 'Band', 'Full range, slow down'], ['Lat pulldown', 'Cable', 'Pull to the collarbone, chest up'], ['Close-grip lat pulldown', 'Cable', 'Elbows to the ribs'],
    ['Single-arm lat pulldown', 'Cable', 'Pull the elbow to the hip'], ['Straight-arm pulldown', 'Cable', 'Arms straight, pull to the thighs'],
    ['Rope climb', 'Rope', 'Use the feet, hand over hand'], ['Towel pull-up', 'Towel', 'Crush the towels'], ['Scap pull-up', 'Bodyweight', 'Arms straight, pull the shoulders down'],
  ], 'Upper', 'pull');

  // Accessories
  family(['Biceps curl', 'Hammer curl', 'Reverse curl', 'Preacher curl', 'Incline curl', 'Triceps extension', 'Skull crusher', 'Overhead triceps extension', 'Triceps kickback',
    'JM press', 'Lateral raise', 'Front raise', 'Rear delt fly', 'Shrug', 'Upright row', 'Y-T-W raise', 'External rotation', 'Wrist curl', 'Reverse wrist curl', 'Triceps pushdown'],
  ['Dumbbell', 'Barbell', 'Cable', 'Band', 'EZ bar', 'Kettlebell'], 'Accessory', 'isolation', { _: 'Control the lowering, no swing' },
  { implied: '__none__', skip: {
    'Biceps curl': [], 'Hammer curl': ['Barbell', 'EZ bar'], 'Reverse curl': ['Kettlebell'], 'Preacher curl': ['Band', 'Kettlebell'], 'Incline curl': ['Barbell', 'Cable', 'Band', 'EZ bar', 'Kettlebell'],
    'Triceps extension': ['Barbell'], 'Skull crusher': ['Cable', 'Band', 'Kettlebell'], 'Overhead triceps extension': ['Barbell'], 'Triceps kickback': ['Barbell', 'EZ bar', 'Kettlebell'],
    'JM press': ['Cable', 'Band', 'Kettlebell', 'Dumbbell'], 'Lateral raise': ['Barbell', 'EZ bar'], 'Front raise': ['EZ bar'], 'Rear delt fly': ['Barbell', 'EZ bar', 'Kettlebell'],
    Shrug: ['Band', 'EZ bar'], 'Upright row': [], 'Y-T-W raise': ['Barbell', 'Cable', 'EZ bar'], 'External rotation': ['Barbell', 'EZ bar', 'Kettlebell'],
    'Wrist curl': ['Cable', 'Band', 'Kettlebell'], 'Reverse wrist curl': ['Cable', 'Band', 'Kettlebell'], 'Triceps pushdown': ['Barbell', 'Dumbbell', 'EZ bar', 'Kettlebell'] } });

  // Neck, prehab, lower leg
  fixed([
    ['Neck series', 'Manual', '4-way, slow'], ['4-way neck (manual resistance)', 'Partner', 'Slow, partner controls the pressure'], ['Neck harness flexion', 'Neck harness', 'Slow and controlled'],
    ['Neck harness extension', 'Neck harness', 'Slow and controlled'], ['Plate neck flexion', 'Plate', 'Towel under the plate, small range'], ['Plate neck extension', 'Plate', 'Small range, no jerking'],
    ['Band neck lateral flexion', 'Band', 'Ear to shoulder, slow'], ['Neck isometric hold', 'Manual', 'Hold 10 seconds each direction'], ['Shoulder CARs', 'Bodyweight', 'Biggest circle without moving the torso'],
    ['Hip CARs', 'Bodyweight', 'Slow controlled circles'], ['Band external rotation', 'Band', 'Elbow at the side, rotate out'], ['Cuban press', 'Dumbbell', 'Light, row then rotate then press'],
    ['Scapular wall slide', 'Bodyweight', 'Forearms on the wall, slide up'], ['Copenhagen plank', 'Bench', 'Top leg on the bench, hips up'], ['Adductor squeeze', 'Ball', 'Squeeze and hold'],
    ['Tibialis raise', 'Bodyweight', 'Back against the wall, toes up'], ['Banded monster walk', 'Mini-band', 'Stay low, knees out'], ['Lateral band walk', 'Mini-band', 'Stay low, small steps'],
    ['Clamshell', 'Mini-band', 'Hips stacked, rotate from the hip'], ['Hip airplane', 'Bodyweight', 'Rotate over the stance hip'], ['Ankle band series', 'Band', 'Four directions'],
    ['Single-leg balance reach', 'Bodyweight', 'Reach three directions, stay balanced'], ['Terminal knee extension', 'Band', 'Lock the knee against the band'], ['Wrist roller', 'Wrist roller', 'Roll up and down slowly'],
    ['Plate pinch', 'Plate', 'Pinch and hold'], ['Grip crush', 'Gripper', 'Full close each rep'],
  ], 'Prehab', 'prehab');
  family(['Standing calf raise', 'Seated calf raise', 'Single-leg calf raise', 'Bent-knee calf raise'], ['Bodyweight', 'Dumbbell', 'Barbell', 'Machine', 'Smith machine'], 'Prehab', 'lower_leg',
    { _: 'Full stretch, pause at the top' }, { implied: 'Bodyweight', skip: { 'Seated calf raise': ['Bodyweight', 'Smith machine'], 'Single-leg calf raise': ['Barbell', 'Smith machine'], 'Bent-knee calf raise': ['Barbell', 'Machine', 'Smith machine'] } });

  // Core and carries
  fixed([
    ['Plank', 'Bodyweight', 'Squeeze the glutes, ribs down'], ['Side plank', 'Bodyweight', 'Hips high, straight line'], ['Weighted plank', 'Plate', 'Stay rigid'],
    ['Pallof press', 'Cable', 'Resist the rotation, press straight out'], ['Band Pallof press', 'Band', 'Resist the rotation'], ['Half-kneeling Pallof press', 'Cable', 'Tall kneeling, press and hold'],
    ['Ab wheel rollout', 'Ab wheel', 'Ribs down, roll only as far as you can control'], ['Hanging leg raise', 'Bodyweight', 'No swing, tilt the pelvis'], ['Hanging knee raise', 'Bodyweight', 'Knees to the chest, control'],
    ['Toes-to-bar', 'Bodyweight', 'Controlled, no kip'], ['Cable crunch', 'Cable', 'Crunch the ribs to the hips'], ['Landmine rotation', 'Landmine', 'Rotate from the hips, arms long'],
    ['Russian twist', 'Medicine ball', 'Rotate the shoulders, feet down'], ['Dead bug', 'Bodyweight', 'Low back flat, opposite arm and leg'], ['Bird dog', 'Bodyweight', 'Reach long, hips square'],
    ['Hollow hold', 'Bodyweight', 'Low back down, arms and legs long'], ['Stir the pot', 'Stability ball', 'Small circles, stay rigid'], ['Body saw', 'Sliders', 'Rock forward and back, stay rigid'],
    ['V-up', 'Bodyweight', 'Reach for the toes'], ['Sit-up', 'Bodyweight', 'Controlled up and down'], ['Weighted sit-up', 'Plate', 'Control the descent'], ['Cable woodchop', 'Cable', 'Rotate through the hips'],
    ['Reverse crunch', 'Bodyweight', 'Curl the hips up'], ['Bear crawl', 'Bodyweight', 'Knees an inch off the ground'], ['Med ball slam', 'Medicine ball', 'Full extension, slam through the floor'],
    ['Med ball rotational throw', 'Medicine ball', 'Load the back hip, throw through the wall'], ['Med ball side toss', 'Medicine ball', 'Rotate and release'],
    ['Suitcase deadlift', 'Kettlebell', 'Stay level, resist the lean'], ['Turkish get-up', 'Kettlebell', 'Eyes on the bell, one step at a time'],
  ], 'Core', 'core');
  family(['Farmer carry', 'Suitcase carry', 'Front rack carry', 'Overhead carry', 'Waiter carry', 'Bear hug carry'], ['Dumbbell', 'Kettlebell', 'Trap bar', 'Sandbag'], 'Core', 'carry',
    { _: 'Tall posture, short quick steps' }, { implied: '__none__', skip: { 'Suitcase carry': ['Sandbag'], 'Front rack carry': ['Trap bar'], 'Overhead carry': ['Trap bar', 'Sandbag'], 'Waiter carry': ['Trap bar', 'Sandbag'], 'Bear hug carry': ['Dumbbell', 'Kettlebell', 'Trap bar'], 'Farmer carry': ['Sandbag'] } });

  // Jumps and throws
  fixed([
    ['Box jump', 'Box', 'Land soft and quiet, step down'], ['Seated box jump', 'Box', 'Explode from the seat'], ['Depth jump', 'Box', 'Step off, minimal ground contact, jump'],
    ['Depth drop', 'Box', 'Step off, stick the landing'], ['Broad jump', 'Bodyweight', 'Swing the arms, stick the landing'], ['Single-leg broad jump', 'Bodyweight', 'Stick it on one leg'],
    ['Triple broad jump', 'Bodyweight', 'Three continuous jumps'], ['Vertical jump', 'Bodyweight', 'Quick dip, reach high'], ['Hurdle hop', 'Hurdles', 'Quick off the ground'],
    ['Lateral hurdle hop', 'Hurdles', 'Stay over the base'], ['Single-leg hop', 'Bodyweight', 'Stiff ankle, quick contacts'], ['Lateral bound', 'Bodyweight', 'Push off the outside leg, stick it'],
    ['Skater bound', 'Bodyweight', 'Push sideways, land balanced'], ['Pogo jump', 'Bodyweight', 'Stiff ankles, bounce'], ['Tuck jump', 'Bodyweight', 'Knees to the chest'],
    ['Split jump', 'Bodyweight', 'Switch legs in the air'], ['Approach jump', 'Bodyweight', 'Two-step approach, max height'], ['Med ball scoop toss', 'Medicine ball', 'Hips through, throw for distance'],
    ['Med ball overhead backward toss', 'Medicine ball', 'Squat and throw back over the head'], ['Med ball vertical toss', 'Medicine ball', 'Squat and throw straight up'],
    ['Med ball push press throw', 'Medicine ball', 'Dip and throw overhead'], ['Trap bar jump', 'Trap bar', 'Light, max height'], ['Hang jump shrug', 'Barbell', 'Explode, shrug, land soft'],
    ['Kettlebell jump squat', 'Kettlebell', 'Light bell, max intent'], ['Box squat jump', 'Box', 'Sit, pause, jump'], ['Bounding', 'Bodyweight', 'Long powerful strides'],
  ], 'Power', 'plyometric');

  // Speed and agility
  fixed([
    ['10-yard start', 'Bodyweight', 'Low push, long first steps'], ['20-yard sprint', 'Bodyweight', 'Drive phase, then rise'], ['40-yard dash', 'Bodyweight', 'Push, drive, run tall'],
    ['Flying 10', 'Bodyweight', 'Build up, max speed for 10'], ['Flying 20', 'Bodyweight', 'Build up, relaxed max speed'], ['Wall drive', 'Bodyweight', 'Straight line from head to heel'],
    ['A-march', 'Bodyweight', 'Toe up, knee up, heel under hip'], ['A-skip', 'Bodyweight', 'Rhythm and posture'], ['B-skip', 'Bodyweight', 'Extend and paw back'],
    ['High knees', 'Bodyweight', 'Quick and tall'], ['Butt kicks', 'Bodyweight', 'Heel to the hip, quick'], ['Falling start', 'Bodyweight', 'Fall forward, first step fast'],
    ['Push-up start', 'Bodyweight', 'Explode up into the drive'], ['3-point start', 'Bodyweight', 'Weight on the hand, explode out'], ['Sled sprint', 'Sled', 'Light sled, drive phase'],
    ['Resisted band sprint', 'Band', 'Partner holds, drive the knees'], ['Hill sprint', 'Bodyweight', 'Drive up the hill, walk down'], ['Pro agility (5-10-5)', 'Cones', 'Low hips, touch the line'],
    ['L-drill (3-cone)', 'Cones', 'Tight turns around the cones'], ['T-drill', 'Cones', 'Shuffle, do not cross the feet'], ['W-drill', 'Cones', 'Backpedal and break'],
    ['Star drill', 'Cones', 'Return to the center each time'], ['Ladder: in-in-out-out', 'Agility ladder', 'Light, quick feet'], ['Ladder: icky shuffle', 'Agility ladder', 'Rhythm first, then speed'],
    ['Ladder: lateral high knees', 'Agility ladder', 'Tall posture'], ['Mirror drill', 'Bodyweight', 'React to the partner'], ['60-yard shuttle', 'Cones', 'Touch each line'],
    ['Backpedal to sprint', 'Bodyweight', 'Plant and drive'], ['Hip turn drill', 'Bodyweight', 'Open the hips, run'], ['Lateral shuffle', 'Bodyweight', 'Stay low, do not cross'],
    ['Carioca', 'Bodyweight', 'Hips rotate, shoulders square'], ['Crossover run', 'Bodyweight', 'Open the hip and go'], ['OL pass set start', 'Bodyweight', 'Kick-slide on the snap count'],
    ['DL get-off start', 'Bodyweight', 'React to the ball, first step'], ['DB backpedal and break', 'Cones', 'Low pads, plant and drive'], ['WR release start', 'Bodyweight', 'Release and stack'],
    ['RB stance start', 'Bodyweight', 'Explode from the stance'], ['LB read and fill', 'Cones', 'Shuffle, fill the gap'],
  ], 'Speed', 'speed');

  // Conditioning
  fixed([
    ['110-yard sprint', 'Field', 'Finish through the line'], ['Half gasser', 'Field', 'Sideline to sideline and back'], ['Full gasser', 'Field', 'Two round trips across the field'],
    ['300-yard shuttle', 'Cones', '25 yards and back, six times'], ['Tempo run (100 yards)', 'Field', '70 percent effort, walk the endline'], ['Tempo run (50 yards)', 'Field', 'Smooth stride'],
    ['Assault bike sprint', 'Air bike', 'All out for the interval'], ['Rower 500 m', 'Rower', 'Legs, hips, arms'], ['Ski erg intervals', 'Ski erg', 'Hinge and pull'],
    ['Sled push', 'Sled', 'Arms long, drive the legs'], ['Sled drag', 'Sled', 'Walk backward, stay low'], ['Prowler push', 'Prowler', 'Low angle, drive'], ['Battle ropes', 'Battle ropes', 'Waves from the hips'],
    ['Stair run', 'Stadium stairs', 'Every step, walk down'], ['Sandbag carry', 'Sandbag', 'Bear hug, quick steps'], ['Burpee', 'Bodyweight', 'Chest to the floor, jump at the top'],
    ['Jump rope', 'Jump rope', 'Light on the toes'], ['Up-down', 'Bodyweight', 'Chest to the ground, back up fast'], ['Mat drill', 'Mats', 'React to the whistle'],
    ['Tire flip', 'Tire', 'Hips down, drive through'], ['Truck push', 'Vehicle', 'Spotter in the driver seat'], ['OL/DL 10-yard bursts', 'Field', 'Out of a stance, 10 yards'],
    ['Skill 40-yard repeats', 'Field', '40 yards at 90 percent, 30 seconds rest'], ['Big skill 20-yard repeats', 'Field', '20 yards, jog back'], ['Shuttle repeats (5-10-5)', 'Cones', 'Repeat with 30 seconds rest'],
    ['Assault bike intervals', 'Air bike', '20 seconds on, 40 off'], ['Pool tempo intervals', 'Pool', 'Recovery conditioning'], ['Bike tempo ride', 'Bike', 'Steady, conversational pace'],
    ['Position conditioning circuit', 'Field', 'Stance starts and finishes'], ['4-quarter conditioning', 'Field', 'Four quarters of play-length bursts'],
  ], 'Conditioning', 'conditioning');

  // Mobility and warm-up
  fixed([
    ["World's greatest stretch", 'Bodyweight', 'Lunge, elbow to instep, rotate'], ['90/90 hip switch', 'Bodyweight', 'Tall chest, rotate the knees'], ['Couch stretch', 'Bodyweight', 'Squeeze the glute'],
    ['Half-kneeling hip flexor stretch', 'Bodyweight', 'Tuck the pelvis'], ['Hamstring floss', 'Bodyweight', 'Straighten and bend the knee'], ['Thoracic rotation', 'Bodyweight', 'Rotate through the upper back'],
    ['Cat-cow', 'Bodyweight', 'Move one segment at a time'], ['Spiderman lunge', 'Bodyweight', 'Hand inside the foot, sink the hips'], ['Inchworm', 'Bodyweight', 'Walk the hands out and back'],
    ['Leg swing (front to back)', 'Bodyweight', 'Relaxed, increase the range'], ['Leg swing (side to side)', 'Bodyweight', 'Relaxed, stay tall'], ['Ankle rocker', 'Bodyweight', 'Knee over the toes, heel down'],
    ['Band shoulder dislocate', 'Band', 'Straight arms, slow'], ['Frog stretch', 'Bodyweight', 'Rock back slowly'], ['Pigeon stretch', 'Bodyweight', 'Square the hips'],
    ['Deep squat hold', 'Bodyweight', 'Heels down, chest up'], ['Open book', 'Bodyweight', 'Follow the hand with the eyes'], ['Walking knee hug', 'Bodyweight', 'Tall posture'],
    ['Walking quad pull', 'Bodyweight', 'Squeeze the glute'], ['Lateral lunge walk', 'Bodyweight', 'Sit into the hip'], ['Dynamic warm-up', 'Bodyweight', 'Full team movement prep'],
  ], 'Mobility', 'mobility');
  for (const area of ['quads', 'hamstrings', 'glutes', 'calves', 'IT band', 'upper back', 'lats', 'adductors', 'hip flexors', 'pecs'])
    add(`Foam roll ${area}`, 'Mobility', 'recovery', 'Foam roller', 'Slow passes, pause on tight spots');
  for (const area of ['glutes', 'pecs', 'feet', 'forearms', 'traps'])
    add(`Lacrosse ball release ${area}`, 'Mobility', 'recovery', 'Lacrosse ball', 'Hold pressure 30 seconds');
  return [...out.values()];
}
export const LIBRARY = buildLibrary();
export const libByName = new Map(LIBRARY.map((x) => [x.name.toLowerCase(), x]));

// ---------- template library (C-10, F-1, F-5) ----------
// Session spec items: [exercise name, sets, reps, pct (number or per-week array), rpe, rest, note]
const at = (arr, w) => (Array.isArray(arr) ? arr[Math.min(w - 1, arr.length - 1)] : arr);
function block(weeks, sessions) {
  const days = [];
  for (let w = 1; w <= weeks; w++) {
    sessions.forEach((s, i) => {
      days.push({ week: w, day: i + 1, label: s.label, exercises: s.items.map(([name, sets, reps, pct, rpe, rest, note]) => ({
        name, sets: at(sets, w), reps: String(at(reps, w)), pct: pct == null ? null : at(pct, w), rpe: rpe == null ? null : at(rpe, w), rest: rest || null, note: note || null,
      })) });
    });
  }
  return days;
}
const WARM = ['Dynamic warm-up', 1, '1', null, null, null, '10 minutes'];
export const ACTIVATION = [
  ['Dynamic warm-up', 1, '1', null, null, null, 'Full warm-up'], ['Box jump', 3, '3', null, 5, '1:00', 'Fast and crisp'],
  ['Hang power clean', 3, '2', 60, 6, '1:30', 'Light and fast'], ['Med ball chest pass', 2, '5', null, null, null, null],
  ['Band pull-apart', 2, '15', null, null, null, null], ['Lateral band walk', 2, '10', null, null, null, 'Each way'],
];
const POS_ACCESSORY = {
  OL: [['Trap bar deadlift', 3, 5, [72, 76, 80, 65], 8], ['Sled push', 4, '20 yd', null, 8], ['Neck series', 2, 10], ['Dumbbell farmer carry', 3, '40 yd']],
  DL: [['Trap bar deadlift', 3, 5, [72, 76, 80, 65], 8], ['Med ball scoop toss', 3, 5], ['Neck series', 2, 10], ['DL get-off start', 6, 1]],
  LB: [['Rear-foot elevated split squat', 3, 6, null, 8], ['Lateral bound', 3, 5], ['Neck series', 2, 10], ['LB read and fill', 6, 1]],
  DB: [['Single-leg Romanian deadlift', 3, 6, null, 7], ['Lateral bound', 3, 5], ['Nordic hamstring curl', 3, 4], ['DB backpedal and break', 6, 1]],
  QB: [['Dumbbell bench press', 3, 8, null, 7], ['Face pull', 3, 15], ['Landmine rotation', 3, 8], ['Band external rotation', 2, 15]],
  'RB/TE': [['Trap bar deadlift', 3, 5, [70, 75, 78, 65], 8], ['Sled sprint', 4, '15 yd'], ['Neck series', 2, 10], ['RB stance start', 6, 1]],
  WR: [['Single-leg Romanian deadlift', 3, 6, null, 7], ['Hurdle hop', 3, 5], ['Nordic hamstring curl', 3, 4], ['WR release start', 6, 1]],
  'K/P': [['Goblet squat', 3, 8, null, 7], ['Copenhagen plank', 3, '20 s'], ['Hip CARs', 2, 5], ['Single-leg balance reach', 2, 6]],
};
export const TEMPLATES = [
  { key: 'phase-offseason-hypertrophy', name: 'Offseason hypertrophy (4 weeks, 4 days)', phase: 'offseason', kind: 'lift', weeks: 4,
    description: 'January to March. Build muscle and work capacity: moderate loads, 8 to 12 reps, RPE 7 to 8.',
    sessions: [
      { label: 'Upper A', items: [WARM, ['Bench press', 4, [10, 10, 8, 8], [65, 67, 70, 72], [7, 7, 8, 8], '2:00'], ['DB row', 4, 10, null, 8], ['Dumbbell incline press', 3, 12, null, 8], ['Face pull', 3, 15], ['Dumbbell biceps curl', 3, 12]] },
      { label: 'Lower A', items: [WARM, ['Back squat', 4, [10, 10, 8, 8], [65, 67, 70, 72], [7, 7, 8, 8], '2:30'], ['Romanian deadlift', 3, 10, null, 8], ['Dumbbell walking lunge', 3, 10, null, 8, null, 'Each leg'], ['Standing calf raise', 3, 15], ['Plank', 3, '40 s']] },
      { label: 'Upper B', items: [WARM, ['Overhead press', 4, 8, [65, 67, 70, 72], 8], ['Pull-up', 4, 8], ['Dumbbell bench press', 3, 10, null, 8], ['Seated cable row', 3, 12], ['Cable triceps pushdown', 3, 12]] },
      { label: 'Lower B', items: [WARM, ['Front squat', 4, 8, [60, 63, 66, 68], 8], ['Hip thrust', 3, 10, null, 8], ['Rear-foot elevated split squat', 3, 10, null, 8], ['Nordic hamstring curl', 3, 5], ['Neck series', 2, 10]] },
    ] },
  { key: 'phase-summer-strength', name: 'Summer strength (4 weeks, 4 days)', phase: 'summer', kind: 'lift', weeks: 4,
    description: 'June and July. Heavy main lifts with a deload in week 4.',
    sessions: [
      { label: 'Lower + power', items: [WARM, ['Hang power clean', 4, 3, [70, 73, 76, 65], 7, '2:00'], ['Back squat', 5, [5, 5, 3, 5], [75, 80, 85, 65], [8, 8, 9, 6], '3:00'], ['Romanian deadlift', 3, 8, null, 8], ['Copenhagen plank', 2, '20 s']] },
      { label: 'Upper strength', items: [WARM, ['Bench press', 5, [5, 5, 3, 5], [75, 80, 85, 65], [8, 8, 9, 6], '3:00'], ['Pendlay row', 4, 6, null, 8], ['Weighted dip', 3, 8], ['Face pull', 3, 15]] },
      { label: 'Lower volume', items: [WARM, ['Power clean', 4, 2, [72, 75, 78, 65], 7], ['Front squat', 4, 5, [68, 72, 75, 60], 8], ['Trap bar deadlift', 3, 5, null, 8], ['Dumbbell walking lunge', 3, 8]] },
      { label: 'Upper volume', items: [WARM, ['Incline bench press', 4, 6, [65, 68, 72, 60], 8], ['Weighted chin-up', 4, 5], ['Overhead press', 3, 6, null, 8], ['Neck series', 2, 10]] },
    ] },
  { key: 'phase-preseason-power', name: 'Preseason power and speed (3 weeks, 3 days)', phase: 'preseason', kind: 'lift', weeks: 3,
    description: 'August camp. Fast bar speed, jumps and sprints; volume comes down as practice volume goes up.',
    sessions: [
      { label: 'Power', items: [WARM, ['10-yard start', 6, 1], ['Box jump', 4, 3], ['Hang power clean', 5, 2, [75, 78, 80], 7], ['Back squat', 3, 3, [72, 75, 78], 7, '2:30', 'Move it fast'], ['Nordic hamstring curl', 3, 4]] },
      { label: 'Upper power', items: [WARM, ['Med ball chest pass', 4, 5], ['Bench press', 4, 3, [72, 75, 78], 7], ['Pendlay row', 3, 6], ['Neck series', 2, 10]] },
      { label: 'Speed + strength', items: [WARM, ['Flying 10', 5, 1], ['Lateral bound', 3, 5], ['Power clean', 4, 2, [70, 73, 75], 7], ['Trap bar deadlift', 3, 3, null, 7], ['Pallof press', 3, 10]] },
    ] },
  { key: 'phase-in-season', name: 'In-season maintenance (2 days a week)', phase: 'in_season', kind: 'lift', weeks: 4,
    description: 'Late August to November. Two short sessions to hold strength and power. Keep RPE at or under 7.',
    sessions: [
      { label: 'Day 1 (Monday)', items: [WARM, ['Hang power clean', 3, 3, [65, 68, 70, 62], 6], ['Back squat', 3, [5, 5, 3, 5], [70, 75, 80, 65], [6, 7, 7, 6]], ['Romanian deadlift', 2, 8], ['Neck series', 2, 10]] },
      { label: 'Day 2 (Wednesday)', items: [WARM, ['Bench press', 3, [5, 5, 3, 5], [70, 75, 80, 65], [6, 7, 7, 6]], ['DB row', 3, 10], ['Band pull-apart', 2, 15], ['Copenhagen plank', 2, '20 s']] },
    ] },
  { key: 'phase-playoffs', name: 'Playoffs (2 weeks, 2 days)', phase: 'playoffs', kind: 'lift', weeks: 2,
    description: 'Stay fresh: low volume, moderate loads, fast reps.',
    sessions: [
      { label: 'Day 1', items: [WARM, ['Hang power clean', 3, 2, 65, 6], ['Back squat', 2, 3, 70, 6], ['Nordic hamstring curl', 2, 4], ['Neck series', 2, 10]] },
      { label: 'Day 2', items: [WARM, ['Bench press', 2, 3, 70, 6], ['DB row', 2, 8], ['Med ball chest pass', 2, 5], ['Band pull-apart', 2, 15]] },
    ] },
  { key: 'game-week', name: 'Game-week lift (scales by days to the game)', phase: 'in_season', kind: 'lift', weeks: 1, mode: 'game_week',
    description: 'Volume scales by days to the next game: full at 4 or more days out, about 75 percent at 3, 50 percent at 2, and a game-day activation lift the day before and on game day.',
    sessions: [
      { label: 'Full', items: [WARM, ['Hang power clean', 4, 3, 70, 7], ['Back squat', 4, 5, 75, 7], ['Bench press', 4, 5, 75, 7], ['Romanian deadlift', 3, 8], ['Neck series', 2, 10]] },
      { label: 'Moderate', items: [WARM, ['Power clean', 3, 2, 70, 6], ['Front squat', 3, 3, 70, 6], ['Dumbbell incline press', 3, 8], ['DB row', 3, 10]] },
      { label: 'Activation', items: ACTIVATION },
    ] },
  // conditioning plans
  { key: 'cond-summer-linemen', name: 'Summer conditioning: linemen (OL/DL)', phase: 'summer', kind: 'conditioning', weeks: 4, position_group: 'OL',
    description: 'Short bursts and sled work. Builds up to 16 x 10-yard bursts.',
    sessions: [
      { label: 'Speed day', items: [WARM, ['OL/DL 10-yard bursts', [10, 12, 14, 16], 1, null, null, '0:30'], ['Sled push', 4, '20 yd'], ['Up-down', 3, 8]] },
      { label: 'Capacity day', items: [WARM, ['Half gasser', [4, 5, 6, 6], 1, null, null, '1:00'], ['Prowler push', 4, '15 yd'], ['Dumbbell farmer carry', 3, '40 yd']] },
      { label: 'Agility day', items: [WARM, ['Pro agility (5-10-5)', 6, 1], ['Mirror drill', 4, '10 s'], ['Bear crawl', 3, '20 yd']] },
    ] },
  { key: 'cond-summer-skill', name: 'Summer conditioning: skill (WR/DB/QB)', phase: 'summer', kind: 'conditioning', weeks: 4, position_group: 'WR',
    description: 'Repeat sprints at game distances. Builds to 16 x 110 yards by week 4.',
    sessions: [
      { label: 'Speed day', items: [WARM, ['A-skip', 2, '20 yd'], ['Flying 20', 6, 1], ['Skill 40-yard repeats', [8, 10, 12, 12], 1, null, null, '0:30']] },
      { label: '110s', items: [WARM, ['110-yard sprint', [10, 12, 14, 16], 1, null, null, '0:45', 'Under 16 seconds']] },
      { label: 'Change of direction', items: [WARM, ['Pro agility (5-10-5)', 6, 1], ['L-drill (3-cone)', 4, 1], ['W-drill', 4, 1]] },
    ] },
  { key: 'cond-summer-big-skill', name: 'Summer conditioning: big skill (RB/TE/LB)', phase: 'summer', kind: 'conditioning', weeks: 4, position_group: 'LB',
    description: '20 to 60 yard repeats with sled work.',
    sessions: [
      { label: 'Speed day', items: [WARM, ['10-yard start', 6, 1], ['Big skill 20-yard repeats', [10, 12, 14, 14], 1, null, null, '0:30']] },
      { label: 'Capacity day', items: [WARM, ['300-yard shuttle', [2, 2, 3, 3], 1, null, null, '3:00'], ['Sled sprint', 4, '15 yd']] },
      { label: 'Agility day', items: [WARM, ['Star drill', 4, 1], ['T-drill', 4, 1], ['LB read and fill', 6, 1]] },
    ] },
  { key: 'cond-preseason', name: 'Preseason conditioning test prep', phase: 'preseason', kind: 'conditioning', weeks: 2,
    description: 'Prepare for the conditioning test in the week before camp.',
    sessions: [
      { label: 'Test prep', items: [WARM, ['110-yard sprint', [12, 16], 1, null, null, '0:45']] },
      { label: 'Change of direction', items: [WARM, ['300-yard shuttle', 2, 1, null, null, '3:00'], ['Pro agility (5-10-5)', 6, 1]] },
    ] },
  { key: 'cond-in-season', name: 'In-season conditioning (post-practice)', phase: 'in_season', kind: 'conditioning', weeks: 1,
    description: 'Short finishers after practice on Monday and Tuesday.',
    sessions: [
      { label: 'Monday finisher', items: [['Position conditioning circuit', 6, 1, null, null, '0:30']] },
      { label: 'Tuesday finisher', items: [['Skill 40-yard repeats', 6, 1, null, null, '0:30', 'Linemen run 20 yards']] },
    ] },
  // F-1 starter blocks per position group
  ...Object.entries(POS_ACCESSORY).map(([g, acc]) => ({
    key: `pos-${slug(g)}`, name: `${g} starter block (4 weeks, 3 days)`, phase: 'offseason', kind: 'lift', weeks: 4, position_group: g,
    description: `Base strength block with ${g} position work. Assign it to the ${g} group in one step.`,
    sessions: [
      { label: 'Lower', items: [WARM, g === 'K/P' ? ['Goblet squat', 3, 8, null, 7] : ['Back squat', 4, [5, 5, 3, 5], [72, 77, 82, 65], [7, 8, 8, 6]], ...acc.slice(0, 2)] },
      { label: 'Upper', items: [WARM, g === 'QB' ? ['Dumbbell bench press', 4, 8, null, 7, null, 'Dumbbells to protect the throwing shoulder'] : ['Bench press', 4, [5, 5, 3, 5], [72, 77, 82, 65], [7, 8, 8, 6]], ['DB row', 3, 10], ...acc.slice(2, 3)] },
      { label: 'Power + position', items: [WARM, g === 'K/P' ? ['Box jump', 3, 3] : ['Hang power clean', 4, 3, [68, 72, 75, 62], 7], ...acc.slice(3), ['Pallof press', 3, 10]] },
    ],
  })),
];
for (const t of TEMPLATES) t.days = block(t.weeks, t.sessions);

// ---------- milestone clubs (F-19) ----------
export const CLUBS = [
  { key: 'bench', thresholds: [225, 300, 350], label: (n) => `${n} bench club` },
  { key: 'squat', thresholds: [300, 400, 500], label: (n) => `${n} squat club` },
  { key: 'clean', thresholds: [225, 275, 315], label: (n) => `${n} clean club` },
  { key: 'deadlift', thresholds: [400, 500, 600], label: (n) => `${n} deadlift club` },
  { key: 'forty', thresholds: [5.0, 4.8, 4.6], lower: true, label: (n) => `Sub-${n.toFixed(1)} forty` },
  { key: 'vertical', thresholds: [30, 35], label: (n) => `${n}-inch vertical club` },
];

// ---------- reference norms (F-9): approximate high school football medians, for context only ----------
// Values are rough reference points (50th percentile) compiled for orientation; the program's own percentiles come first.
export const REFERENCE_NORMS = {
  forty: { label: 'HS varsity median', by_group: { OL: 5.35, DL: 5.1, LB: 4.9, DB: 4.75, QB: 4.9, 'RB/TE': 4.8, WR: 4.75, 'K/P': 5.1 }, by_grade: { 9: 5.25, 10: 5.1, 11: 5.0, 12: 4.95 } },
  ten_split: { label: 'HS varsity median', by_group: { OL: 1.85, DL: 1.78, LB: 1.72, DB: 1.66, QB: 1.72, 'RB/TE': 1.68, WR: 1.66, 'K/P': 1.8 }, by_grade: { 9: 1.82, 10: 1.77, 11: 1.74, 12: 1.72 } },
  pro_agility: { label: 'HS varsity median', by_group: { OL: 4.95, DL: 4.75, LB: 4.5, DB: 4.35, QB: 4.5, 'RB/TE': 4.45, WR: 4.4, 'K/P': 4.7 }, by_grade: { 9: 4.85, 10: 4.7, 11: 4.6, 12: 4.55 } },
  l_drill: { label: 'HS varsity median', by_group: { OL: 8.1, DL: 7.8, LB: 7.4, DB: 7.2, QB: 7.4, 'RB/TE': 7.35, WR: 7.25, 'K/P': 7.7 }, by_grade: { 9: 7.9, 10: 7.7, 11: 7.5, 12: 7.45 } },
  vertical: { label: 'HS varsity median', by_group: { OL: 22, DL: 25, LB: 27, DB: 29, QB: 26, 'RB/TE': 28, WR: 29, 'K/P': 24 }, by_grade: { 9: 23, 10: 25, 11: 26, 12: 27 } },
  broad: { label: 'HS varsity median', by_group: { OL: 90, DL: 98, LB: 104, DB: 110, QB: 102, 'RB/TE': 106, WR: 110, 'K/P': 96 }, by_grade: { 9: 94, 10: 100, 11: 104, 12: 106 } },
  bench: { label: 'HS varsity median', by_group: { OL: 255, DL: 250, LB: 225, DB: 195, QB: 195, 'RB/TE': 225, WR: 185, 'K/P': 175 }, by_grade: { 9: 165, 10: 195, 11: 220, 12: 235 } },
  squat: { label: 'HS varsity median', by_group: { OL: 375, DL: 365, LB: 335, DB: 285, QB: 285, 'RB/TE': 335, WR: 275, 'K/P': 255 }, by_grade: { 9: 245, 10: 285, 11: 320, 12: 340 } },
  clean: { label: 'HS varsity median', by_group: { OL: 245, DL: 245, LB: 225, DB: 205, QB: 195, 'RB/TE': 225, WR: 195, 'K/P': 175 }, by_grade: { 9: 165, 10: 190, 11: 210, 12: 225 } },
};

// ---------- idempotent per-program seeding ----------
export function ensureLibrary(db, programId) {
  const st = db.get('SELECT version FROM wt_library_state WHERE program_id=? AND kind=?', programId, 'exercises');
  if (st && st.version >= LIBRARY_VERSION) return 0;
  const existing = new Map(db.all('SELECT id, lower(name) n FROM exercises WHERE program_id=?', programId).map((r) => [r.n, r.id]));
  let added = 0;
  const run = () => {
    for (const x of LIBRARY) {
      let id = existing.get(x.name.toLowerCase());
      if (!id) {
        id = db.insert('exercises', { program_id: programId, name: x.name, category: x.category, cues: x.cues, video_url: x.video_url, test_key: x.test_key });
        added++;
      } else {
        // fill a demo link on an existing exercise that has none, keep coach-written fields
        db.run('UPDATE exercises SET video_url=coalesce(video_url, ?) WHERE id=?', x.video_url, id);
      }
      db.run('INSERT OR IGNORE INTO exercise_meta (exercise_id, lib_key, equipment, pattern, custom) VALUES (?,?,?,?,0)', id, x.key, x.equipment, x.pattern);
    }
    db.run('INSERT INTO wt_library_state (program_id, kind, version) VALUES (?,?,?) ON CONFLICT(program_id, kind) DO UPDATE SET version=excluded.version', programId, 'exercises', LIBRARY_VERSION);
  };
  inTx(db, run);
  return added;
}
function inTx(db, fn) {
  try { return db.tx(fn); } catch (e) { if (/within a transaction|cannot start a transaction/i.test(e.message)) return fn(); throw e; }
}
export function exerciseIdByName(db, programId, name) {
  return db.get('SELECT id FROM exercises WHERE program_id=? AND lower(name)=lower(?) ORDER BY id LIMIT 1', programId, name)?.id || null;
}
export function materialize(db, programId, tpl) {
  ensureLibrary(db, programId);
  return tpl.days.map((d) => ({
    week: d.week, day: d.day, label: d.label,
    exercises: d.exercises.map((x) => {
      let id = exerciseIdByName(db, programId, x.name);
      if (!id) id = db.insert('exercises', { program_id: programId, name: x.name, category: 'Custom', cues: null, video_url: yt(x.name) });
      const o = { exercise_id: id, sets: x.sets, reps: x.reps };
      for (const k of ['pct', 'rpe', 'rest', 'note']) if (x[k] != null) o[k] = x[k];
      return o;
    }),
  }));
}
export function ensureTemplates(db, programId, createdBy = null) {
  const st = db.get('SELECT version FROM wt_library_state WHERE program_id=? AND kind=?', programId, 'templates');
  if (st && st.version >= TEMPLATE_VERSION) return 0;
  let added = 0;
  inTx(db, () => {
    for (const t of TEMPLATES) {
      const have = db.get('SELECT m.wt_program_id FROM wt_program_meta m JOIN wt_programs p ON p.id=m.wt_program_id WHERE p.program_id=? AND m.template_key=? AND p.is_template=1', programId, t.key);
      if (have) continue;
      const id = db.insert('wt_programs', { program_id: programId, name: t.name, description: t.description, weeks: t.weeks, days: materialize(db, programId, t), is_template: 1, created_by: createdBy });
      db.insert('wt_program_meta', { wt_program_id: id, mode: t.mode || 'dated', kind: t.kind, phase: t.phase || null, position_group: t.position_group || null, template_key: t.key, builtin: 1 });
      added++;
    }
    db.run('INSERT INTO wt_library_state (program_id, kind, version) VALUES (?,?,?) ON CONFLICT(program_id, kind) DO UPDATE SET version=excluded.version', programId, 'templates', TEMPLATE_VERSION);
  });
  return added;
}
