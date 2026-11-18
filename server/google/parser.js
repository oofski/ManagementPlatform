// Deterministic email -> event-draft parser (no AI service). Given an email's subject and body and the time it
// was received, it finds dates, times and ranges, a location, a title, a type guess and an opponent, and returns
// one draft per distinct date it found, each with a confidence and the source snippet.
//
// Rules worth knowing:
// - Month/day without a year picks the year that puts the date closest ahead of the email (dates more than
//   60 days in the past roll to next year). "11/21" is read month/day (US).
// - A bare weekday ("Friday") means its next occurrence; the same weekday as the email means that day.
//   "next Friday" always skips the current day.
// - Times without am/pm are guessed for a football program: 1-4 is PM; 5-6 is AM for lifts, otherwise PM;
//   7-10 is PM for games, socials and meetings, otherwise AM; 11 is AM. Guesses lower the confidence.
import { fmtLocal } from '../core.js';

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DOW_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOWS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MER = '(?:\\s*(a\\.?m\\.?|p\\.?m\\.?)(?![a-z]))?';
const TIME_PART = `(\\d{1,2})(?::(\\d{2}))?${MER}`;

export const TYPE_LABELS = { game: 'Game', practice: 'Practice', lift: 'Lift', film: 'Film', meeting: 'Meeting', social: 'Team event', other: 'Event' };
const TYPE_WORDS = {
  game: /\b(games?|vs\.?|versus|kick-?off|scrimmage|jamboree|playoffs?|homecoming|opponent|road trip)\b/gi,
  practice: /\b(practices?|walk-?throughs?|7[- ]?on[- ]?7|conditioning|drills|padded|camp)\b/gi,
  film: /\b(film|film session|video review|watch tape)\b/gi,
  lift: /\b(lift|lifts|lifting|weight ?room|weights|strength|max(?:es)? testing|testing day)\b/gi,
  meeting: /\b(meetings?|parent night|orientation|booster club|boosters|clinic)\b/gi,
  social: /\b(banquet|dinner|party|cookout|social|team bonding|pasta|potluck|fundraiser|celebration|bbq|picnic)\b/gi,
};
const TYPE_ORDER = ['game', 'practice', 'film', 'lift', 'meeting', 'social'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthNum = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
const dowNum = (s) => DOWS.indexOf(s.slice(0, 3).toLowerCase());
const isDowWord = (w) => new RegExp(`^${DOW_RE}$`, 'i').test(w);
const isMonthWord = (w) => new RegExp(`^${MONTH_RE}$`, 'i').test(w);

function toRefDate(receivedAt) {
  if (receivedAt instanceof Date) return new Date(receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate());
  if (typeof receivedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(receivedAt)) {
    const [y, m, d] = receivedAt.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
function inferYear(m, d, ref) {
  let y = ref.getFullYear();
  const cand = validDate(y, m, d) || validDate(y + 1, m, d);
  if (cand && cand.getTime() < ref.getTime() - 60 * 864e5) y += 1;
  return y;
}
// Abbreviated weekdays ("Sat", "Wed", "Sun") are ordinary words too; only accept them capitalized.
function dowOk(word) {
  if (!word) return true;
  if (word.length >= 6) return true;
  return /^[A-Z]/.test(word);
}

// ---------- dates ----------
export function findDates(text, ref) {
  const out = [];
  const overlaps = (a, b) => out.some((x) => a < x.end && b > x.index);
  const push = (m, date, kind, extra = {}) => {
    if (!date || overlaps(m.index, m.index + m[0].length)) return;
    out.push({ index: m.index, end: m.index + m[0].length, text: m[0], date: ymd(date), kind, ...extra });
  };
  const checkDow = (word, date) => (word && dowOk(word) && dowNum(word) !== date.getDay() ? `${word} does not match ${ymd(date)}` : null);
  let m;
  // ISO 2026-11-21
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = iso.exec(text))) push(m, validDate(Number(m[1]), Number(m[2]), Number(m[3])), 'explicit');
  // (Friday) Nov 21(st)(, 2026)
  const md = new RegExp(`(?:\\b${DOW_RE}\\.?,?\\s+)?\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'gi');
  while ((m = md.exec(text))) {
    if (m[2].toLowerCase() === 'may' && !/^M/.test(m[2])) continue; // "you may 2..." is not a date
    const mo = monthNum(m[2]); const d = Number(m[3]);
    const y = m[4] ? Number(m[4]) : inferYear(mo, d, ref);
    const date = validDate(y, mo, d);
    if (date) push(m, date, 'explicit', { warning: checkDow(m[1], date) });
  }
  // (Friday) 21(st) (of) November
  const dm = new RegExp(`(?:\\b${DOW_RE}\\.?,?\\s+)?\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?(?:,?\\s+(\\d{4}))?`, 'gi');
  while ((m = dm.exec(text))) {
    const mo = monthNum(m[3]); const d = Number(m[2]);
    const y = m[4] ? Number(m[4]) : inferYear(mo, d, ref);
    const date = validDate(y, mo, d);
    if (date) push(m, date, 'explicit', { warning: checkDow(m[1], date) });
  }
  // (Fri) 11/21(/26)
  const num = new RegExp(`(?:\\b${DOW_RE}\\.?,?\\s+)?(?<![\\d/.:])(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\d/])`, 'gi');
  while ((m = num.exec(text))) {
    const mo = Number(m[2]); const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = m[4] ? (m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4])) : inferYear(mo, d, ref);
    const date = validDate(y, mo, d);
    if (date) push(m, date, 'explicit', { warning: checkDow(m[1], date) });
  }
  // today / tonight / tomorrow
  const rel = /\b(today|tonight|tomorrow|tmrw)\b/gi;
  while ((m = rel.exec(text))) {
    const d = new Date(ref); if (!/^to(day|night)$/i.test(m[1])) d.setDate(d.getDate() + 1);
    push(m, d, 'relative');
  }
  // (next|this) Friday
  const dow = new RegExp(`\\b(?:(next|this|coming)\\s+)?${DOW_RE}\\b\\.?`, 'gi');
  while ((m = dow.exec(text))) {
    if (!dowOk(m[2])) continue;
    const want = dowNum(m[2]);
    const d = new Date(ref);
    let add = (want - d.getDay() + 7) % 7;
    if (add === 0 && m[1] && m[1].toLowerCase() === 'next') add = 7;
    d.setDate(d.getDate() + add);
    push(m, d, 'weekday');
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------- times ----------
function to24(h, min, mer, type, notes) {
  if (mer) {
    const pm = mer[0].toLowerCase() === 'p';
    if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12;
    return h * 60 + min;
  }
  if (h >= 13 || h === 0) return h * 60 + min;
  if (h === 12) return 12 * 60 + min;
  let pm;
  if (h <= 4) pm = true;
  else if (h <= 6) pm = type !== 'lift';
  else if (h <= 10) pm = ['game', 'social', 'meeting'].includes(type);
  else pm = false;
  notes.push(`Assumed ${pm ? 'PM' : 'AM'} for ${h}:${pad(min)}`);
  return (pm ? h + 12 : h) * 60 + min;
}
const hm = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

export function findTimes(text, type = 'other') {
  const out = [];
  const overlaps = (a, b) => out.some((x) => a < x.end && b > x.index);
  let m;
  const range = new RegExp(`(?<![\\d/:.])\\b${TIME_PART}\\s*(?:-|–|—|to|until|till|til)\\s*${TIME_PART}(?![\\w/])`, 'gi');
  while ((m = range.exec(text))) {
    const [h1, m1, r1, h2, m2, r2] = [Number(m[1]), Number(m[2] || 0), m[3], Number(m[4]), Number(m[5] || 0), m[6]];
    if (!(m[2] || m[5] || r1 || r2)) continue; // "21-14" or "3-5 players" are not times
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) continue;
    if ((r1 && (h1 < 1 || h1 > 12)) || (r2 && (h2 < 1 || h2 > 12))) continue;
    const notes = [];
    let start; let end;
    if (r1 || h1 > 12) start = to24(h1, m1, r1, type, notes);
    else if (r2) {
      // "3:30-5:30pm": the start shares the end's meridiem unless that puts it after the end ("11-1pm").
      const same = to24(h1, m1, r2, type, []);
      const endM = to24(h2, m2, r2, type, []);
      start = same <= endM || h1 === 12 ? same : to24(h1, m1, r2[0].toLowerCase() === 'p' ? 'am' : 'pm', type, []);
    } else start = to24(h1, m1, null, type, notes);
    if (r2 || h2 > 12) end = to24(h2, m2, r2, type, []);
    else {
      const a = (h2 % 12) * 60 + m2; const b = a + 720;
      end = [a, b].find((x) => x > start) ?? a;
    }
    out.push({ index: m.index, end: m.index + m[0].length, text: m[0], start: hm(start), endTime: hm(end), notes });
  }
  const single = /(?<![\d/:.])\b(\d{1,2}):(\d{2})(?:\s*(a\.?m\.?|p\.?m\.?)(?![a-z]))?|(?<![\d/:.])\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b(noon|midnight)\b/gi;
  while ((m = single.exec(text))) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const notes = [];
    let mins;
    if (m[6]) mins = m[6].toLowerCase() === 'noon' ? 720 : 0;
    else if (m[1]) {
      const h = Number(m[1]); const mi = Number(m[2]);
      if (h > 23 || mi > 59 || (m[3] && (h < 1 || h > 12))) continue;
      mins = to24(h, mi, m[3], type, notes);
    } else {
      const h = Number(m[4]);
      if (h < 1 || h > 12) continue;
      mins = to24(h, 0, m[5], type, notes);
    }
    out.push({ index: m.index, end: m.index + m[0].length, text: m[0], start: hm(mins), endTime: null, notes });
  }
  // "kickoff at 7", "starts at 6" with no minutes or am/pm.
  const bare = /\b(?:[Aa]t|[Kk]ick-?[Oo]ff(?:\s+at)?|[Ss]tarts?(?:\s+at)?|[Bb]egins?(?:\s+at)?)\s+(\d{1,2})(?=$|[\s.,;!)])(?!\s+[A-Z0-9])(?!\s*(?:st|nd|rd|th|yards?|yds?|min|minutes|players|people|kids)\b)/g;
  while ((m = bare.exec(text))) {
    const h = Number(m[1]);
    const numAt = m.index + m[0].lastIndexOf(m[1]);
    if (h < 1 || h > 12 || overlaps(numAt, numAt + m[1].length)) continue;
    const notes = [];
    const mins = to24(h, 0, null, type, notes);
    out.push({ index: numAt, end: numAt + m[1].length, text: m[1], start: hm(mins), endTime: null, notes, bare: true });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------- location, opponent, type ----------
const STOP_WORDS = /\s+(?:on|at|from|for|by|vs\.?|versus|with|and then|until|to)\s.*$/i;
const looksLikeTime = (s) => /^\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?(\b|$)/i.test(s) || /^(noon|midnight)\b/i.test(s);
function cleanPlace(s) {
  let x = String(s || '').replace(/\s+/g, ' ').trim();
  x = x.replace(STOP_WORDS, '');
  // Drop trailing date/time words that ride along ("Lincoln High Friday", "Main Field 7pm").
  for (;;) {
    const before = x;
    x = x.replace(/[\s,.;:!-]+$/, '');
    x = x.replace(/\s+\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/i, '');
    const words = x.split(' ');
    const last = words[words.length - 1];
    if (words.length > 1 && (isDowWord(last) || isMonthWord(last) || /^(today|tonight|tomorrow|this|next)$/i.test(last))) x = words.slice(0, -1).join(' ');
    if (x === before) break;
  }
  return x.slice(0, 120);
}
export function findLocation(text) {
  let m = /(?:^|\n|[.;!]\s+)[ \t]*(?:location|where|place|venue|address)[ \t]*[:\-–][ \t]*([^\n]+)/i.exec(text);
  if (m && cleanPlaceLabeled(m[1])) return { location: cleanPlaceLabeled(m[1]), how: 'label' };
  const at = /(?:^|[\s(])@[ \t]*([A-Z0-9][^\n,;!?()]*)/g;
  while ((m = at.exec(text))) {
    if (looksLikeTime(m[1])) continue;
    const loc = cleanPlace(m[1]);
    if (loc && !isDowWord(loc.split(' ')[0]) && !isMonthWord(loc.split(' ')[0])) return { location: loc, how: 'at-sign' };
  }
  const word = /\b[Aa]t[ \t]+((?:the[ \t]+)?[A-Z0-9][\w'’&.-]*(?:[ \t]+(?:[A-Z0-9][\w'’&.-]*|of|and|&|the))*)/g;
  while ((m = word.exec(text))) {
    const cand = m[1];
    if (looksLikeTime(cand)) continue;
    const first = cand.replace(/^the\s+/i, '').split(/\s+/)[0];
    if (isDowWord(first) || isMonthWord(first) || /^(noon|midnight|least|all|once|home)$/i.test(first)) continue;
    if (/^\d+$/.test(first) && !/\s[A-Z]/.test(cand)) continue; // "at 7" is a time, "at 123 Oak St" is a place
    const loc = cleanPlace(cand).replace(/^the\s+/i, '');
    if (loc.length >= 2) return { location: loc, how: 'at' };
  }
  return null;
}
function cleanPlaceLabeled(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().replace(/[\s,.;]+$/, '').slice(0, 120);
}
export function findOpponent(text) {
  let m = /\b(?:vs\.?|versus|v\.|against)[ \t]+((?:the[ \t]+)?[A-Z][\w'’&.-]*(?:[ \t]+(?:[A-Z][\w'’&.-]*|of))*)/.exec(text);
  if (m) { const o = cleanPlace(m[1]); if (o) return { opponent: o, home_away: 'home' }; }
  m = /(?:^|[\s(])@[ \t]*([A-Z][\w'’&.-]*(?:[ \t]+[A-Z][\w'’&.-]*)*)/.exec(text);
  if (m) { const o = cleanPlace(m[1]); if (o && !isDowWord(o.split(' ')[0]) && !isMonthWord(o.split(' ')[0])) return { opponent: o, home_away: 'away' }; }
  return null;
}
export function guessType(primary, secondary = '') {
  const score = Object.fromEntries(TYPE_ORDER.map((t) => [t, 0]));
  for (const t of TYPE_ORDER) {
    score[t] += 2 * (String(primary).match(TYPE_WORDS[t]) || []).length;
    score[t] += (String(secondary).match(TYPE_WORDS[t]) || []).length;
  }
  if (findOpponent(primary) && /\b(vs\.?|versus|against)\b/i.test(primary)) score.game += 2;
  let best = 'other'; let top = 0;
  for (const t of TYPE_ORDER) if (score[t] > top) { best = t; top = score[t]; }
  return best;
}
export function findGroups(text) {
  const g = [];
  if (/\bvarsity\b/i.test(text.replace(/junior varsity/ig, ''))) g.push('varsity');
  if (/\b(jv|junior varsity)\b/i.test(text)) g.push('jv');
  if (/\b(freshman|freshmen|frosh)\b/i.test(text)) g.push('freshman');
  return g;
}

// ---------- body cleanup ----------
export function cleanBody(body) {
  let t = String(body || '').replace(/\r\n?/g, '\n');
  const cut = [/^On .{0,200}wrote:\s*$/m, /^-{2,}\s*Original Message\s*-{2,}/mi, /^-- ?$/m, /^From: .+\n(?:.+\n){0,3}?Sent: /m, /^_{10,}$/m];
  for (const re of cut) { const m = re.exec(t); if (m) t = t.slice(0, m.index); }
  return t.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 8000);
}
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

// ---------- titles ----------
function stripSpans(s, spans) {
  let out = s;
  for (const sp of [...spans].sort((a, b) => b.index - a.index)) out = out.slice(0, sp.index) + ' ' + out.slice(sp.end);
  return out;
}
function tidyTitle(s) {
  let t = String(s || '').replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, '').replace(/^\s*[-*•\d.)]+\s+/, '');
  t = t.replace(/\b(?:location|where|place|venue)\s*[:\-–].*$/i, '').replace(/(?:^|\s)@\s*$/, '');
  t = t.replace(/\s+/g, ' ').trim();
  for (;;) {
    const b = t;
    t = t.replace(/[\s,;:!(\-–—|]+$/, '').replace(/^[\s,;:!)\-–—|]+/, '').replace(/\s+(on|at|from|for|this|next|starting|is|will be|now|to|and)$/i, '').trim();
    if (t === b) break;
  }
  return t.slice(0, 120);
}
function titleFrom(text, ref) {
  const spans = [...findDates(text, ref), ...findTimes(text)];
  return tidyTitle(stripSpans(text, spans));
}

// ---------- main ----------
export function parseEmail({ subject = '', body = '', receivedAt } = {}) {
  const ref = toRefDate(receivedAt);
  const subj = String(subject || '').replace(/\s+/g, ' ').trim();
  const text = cleanBody(body);
  const whole = `${subj}\n${text}`;
  const lines = whole.split('\n');
  const lineStart = []; let pos = 0;
  for (const l of lines) { lineStart.push(pos); pos += l.length + 1; }
  const lineOf = (idx) => { let i = 0; while (i + 1 < lineStart.length && lineStart[i + 1] <= idx) i++; return i; };

  const dates = findDates(whole, ref);
  if (!dates.length) return [];
  // Keep the first mention of each date; a later "Friday" that repeats "Nov 21" is the same event.
  const seen = new Set();
  const mentions = [];
  for (const d of dates) {
    if (seen.has(d.date)) continue;
    // Weaker mentions (weekday, relative) that land on a line which already has an explicit date add nothing.
    seen.add(d.date);
    mentions.push(d);
  }
  const limited = mentions.slice(0, 10);
  const multi = limited.length > 1;
  const globalType = guessType(subj, text);
  const lm = /(?:^|\n|[.;!]\s+)[ \t]*(?:location|where|place|venue|address)[ \t]*[:\-–][ \t]*([^\n]+)/i.exec(text);
  const labeled = lm && cleanPlaceLabeled(lm[1]) ? { location: cleanPlaceLabeled(lm[1]), how: 'label' } : null;
  const groups = findGroups(whole);

  const drafts = limited.map((d, i) => {
    const ln = lineOf(d.index);
    // Context: the date's line plus following lines until the next mention's line, a blank line, or 3 lines.
    const nextLine = i + 1 < limited.length ? lineOf(limited[i + 1].index) : lines.length;
    let endLine = ln;
    while (endLine + 1 < lines.length && endLine + 1 < nextLine && endLine - ln < 2 && lines[endLine + 1].trim()) endLine++;
    const segLines = lines.slice(ln, endLine + 1);
    const seg = segLines.join('\n');
    const segOffset = lineStart[ln];
    const fromSubject = ln === 0;
    const ctxText = multi ? seg : `${subj}\n${text}`;
    const type = multi ? (guessType(seg) !== 'other' ? guessType(seg) : globalType) : globalType;
    const notes = [];
    if (d.warning) notes.push(d.warning);

    // Times: nearest to the date in its segment; otherwise (single event) anywhere in the email.
    let times = findTimes(seg, type).map((t) => ({ ...t, index: t.index + segOffset, end: t.end + segOffset }));
    if (!times.length && !multi) times = findTimes(whole, type);
    if (!times.length && fromSubject && text) {
      // Subject has the date, body has the time.
      times = findTimes(text, type);
    }
    const details = {};
    const roleOf = (t) => {
      const before = whole.slice(Math.max(0, t.index - 18), t.index).toLowerCase();
      if (/\bbus\b|\bleaves?\b|\bdepart/.test(before)) return 'bus';
      if (/\breport\b|\barrive\b/.test(before)) return 'report';
      if (/kick-?off/.test(before)) return 'kickoff';
      return 'main';
    };
    let main = null;
    for (const t of times) {
      const role = roleOf(t);
      if (role === 'bus') details.bus_departure ||= t.start;
      else if (role === 'report') details.report_time ||= t.start;
      else if (!main || (role === 'kickoff' && roleOf(main) !== 'kickoff')) main = t;
    }
    if (!main && times.length) main = times[0];
    let startTime = main?.start; let endTime = main?.endTime || null;
    if (main) notes.push(...main.notes);
    const DEFAULT_TIMES = { game: '19:00', practice: '15:30', lift: '06:30', film: '15:00', meeting: '18:00', social: '18:00', other: '18:00' };
    if (!startTime) { startTime = DEFAULT_TIMES[type]; notes.push(`No time found; set to ${startTime}`); }
    if (type === 'game' && main && roleOf(main) !== 'bus') details.kickoff = startTime;

    let location = (multi ? findLocation(seg) : null) || labeled || findLocation(multi ? seg : whole);
    const opp = type === 'game' ? findOpponent(multi ? seg : whole) || findOpponent(subj) : null;
    if (opp) { details.opponent = opp.opponent; details.home_away = opp.home_away; }
    if (location && opp && location.how === 'at-sign' && location.location === opp.opponent && opp.home_away === 'away') location = { ...location };

    // Title: subject without dates and times; for schedules with several dates, the line itself.
    let title = '';
    if (multi && !fromSubject) {
      const lineTitle = titleFrom(seg.split('\n')[0], ref).replace(/(?:^|\s)@\s*\S.*$/, (x) => (type === 'game' ? x : ''));
      if (/[a-z]{3,}/i.test(lineTitle)) title = lineTitle;
    }
    if (!title) title = titleFrom(subj, ref);
    if (location && title.length > location.location.length + 3) {
      const esc = location.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!(type === 'game' && opp)) title = tidyTitle(title.replace(new RegExp(`\\s*(?:\\b[Aa]t|@)\\s*(?:the\\s+)?${esc}`), ''));
    }
    if (!/[a-z]{3,}/i.test(title)) title = opp ? `${opp.home_away === 'away' ? '@' : 'vs'} ${opp.opponent}` : TYPE_LABELS[type];

    let conf = 0.3;
    if (d.kind === 'explicit') conf += 0.1;
    if (main) conf += main.bare ? 0.15 : 0.25;
    if (endTime) conf += 0.05;
    if (location) conf += 0.15;
    if (type !== 'other') conf += 0.1;
    if (opp) conf += 0.05;
    conf -= 0.05 * notes.filter((n) => n.startsWith('Assumed')).length;
    if (d.warning) conf -= 0.1;
    const confidence = Math.max(0.05, Math.min(0.95, Math.round(conf * 100) / 100));

    const snippet = (multi ? seg : (fromSubject ? `${subj} — ${text.split('\n').find((l) => l.trim()) || ''}` : seg)).replace(/\s+/g, ' ').trim().slice(0, 240);
    const start = `${d.date}T${startTime}`;
    let end = endTime ? `${d.date}T${endTime}` : null;
    if (end && end < start) end = null;
    return { type, title, start, end, location: location?.location || null, details, confidence, snippet, notes, groups, date_text: d.text, used_context: !!ctxText };
  });
  // Drop exact duplicates (same start and title).
  const uniq = new Map();
  for (const dr of drafts) { const k = `${dr.start}|${dr.title}`; if (!uniq.has(k)) uniq.set(k, dr); }
  return [...uniq.values()].map(({ used_context, ...rest }) => rest);
}

export const localStamp = (ms) => fmtLocal(new Date(Number(ms)));
