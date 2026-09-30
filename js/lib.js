// Pure logic: dates, streaks, stats, backup validation, calendar reminders.
// No DOM or storage access here, so everything can be unit-tested in Node.

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// ---- Dates -------------------------------------------------------------
// Dates are stored as local "YYYY-MM-DD" strings. Arithmetic goes through
// Date(y, m, d) so daylight-saving changes never shift a day.

export function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const date = fromKey(key);
  date.setDate(date.getDate() + n);
  return toKey(date);
}

export function weekday(key) {
  return fromKey(key).getDay();
}

export function todayKey(now = new Date()) {
  return toKey(now);
}

export function isValidKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && toKey(fromKey(key)) === key;
}

// ---- Habits and entries -----------------------------------------------

export function emptyState() {
  return { version: 1, habits: [], entries: {} };
}

export function isScheduled(habit, key) {
  return key >= habit.createdAt && habit.days.includes(weekday(key));
}

export function isDone(state, habitId, key) {
  return Boolean(state.entries[habitId]?.[key]?.done);
}

export function noteFor(state, habitId, key) {
  return state.entries[habitId]?.[key]?.note ?? '';
}

// Returns a new state; never mutates the one passed in.
export function setEntry(state, habitId, key, patch) {
  const forHabit = { ...(state.entries[habitId] || {}) };
  const next = { done: false, note: '', ...forHabit[key], ...patch };
  if (!next.done && !next.note.trim()) delete forHabit[key];
  else forHabit[key] = { done: next.done, note: next.note };
  return { ...state, entries: { ...state.entries, [habitId]: forHabit } };
}

export function activeHabits(state) {
  return state.habits.filter((h) => !h.archived);
}

// ---- Stats -------------------------------------------------------------

// Consecutive scheduled days completed, counting back from `today`.
// If today is scheduled but not done yet, the streak is still alive: it
// counts from yesterday, so opening the app in the morning doesn't show 0.
export function currentStreak(state, habit, today) {
  let key = today;
  if (isScheduled(habit, key) && !isDone(state, habit.id, key)) key = addDays(key, -1);
  let streak = 0;
  while (key >= habit.createdAt) {
    if (isScheduled(habit, key)) {
      if (!isDone(state, habit.id, key)) break;
      streak++;
    }
    key = addDays(key, -1);
  }
  return streak;
}

export function bestStreak(state, habit, today) {
  let best = 0;
  let run = 0;
  for (let key = habit.createdAt; key <= today; key = addDays(key, 1)) {
    if (!isScheduled(habit, key)) continue;
    if (isDone(state, habit.id, key)) {
      run++;
      best = Math.max(best, run);
    } else if (key !== today) {
      run = 0; // an unfinished *today* doesn't break the run yet
    }
  }
  return best;
}

// Share of scheduled days completed over the last `days` days (incl. today).
// Today only counts once it's done, so the rate doesn't dip every morning.
export function completionRate(state, habit, today, days = 30) {
  let scheduled = 0;
  let done = 0;
  for (let i = 0; i < days; i++) {
    const key = addDays(today, -i);
    if (!isScheduled(habit, key)) continue;
    const finished = isDone(state, habit.id, key);
    if (key === today && !finished) continue;
    scheduled++;
    if (finished) done++;
  }
  return scheduled === 0 ? null : done / scheduled;
}

export function totalCheckIns(state, habitId) {
  return Object.values(state.entries[habitId] || {}).filter((e) => e.done).length;
}

// A day where at least one habit was scheduled and every scheduled one was done.
export function isPerfectDay(state, key) {
  const due = activeHabits(state).filter((h) => isScheduled(h, key));
  return due.length > 0 && due.every((h) => isDone(state, h.id, key));
}

export function perfectDays(state, today, days = 30) {
  let count = 0;
  for (let i = 0; i < days; i++) if (isPerfectDay(state, addDays(today, -i))) count++;
  return count;
}

// Weeks x 7 grid (Sunday-first columns) ending with the week containing `today`.
export function heatmap(state, habit, today, weeks = 16) {
  const start = addDays(today, -weekday(today) - (weeks - 1) * 7);
  const grid = [];
  for (let w = 0; w < weeks; w++) {
    const column = [];
    for (let d = 0; d < 7; d++) {
      const key = addDays(start, w * 7 + d);
      let status = 'off';
      if (key > today) status = 'future';
      else if (isScheduled(habit, key)) status = isDone(state, habit.id, key) ? 'done' : 'missed';
      column.push({ key, status });
    }
    grid.push(column);
  }
  return grid;
}

// ---- Backup ------------------------------------------------------------

export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a habit tracker backup file.');
  if (data.version !== 1) throw new Error('This backup is from an unsupported version.');
  if (!Array.isArray(data.habits) || typeof data.entries !== 'object' || data.entries === null) {
    throw new Error('The backup is missing habits or entries.');
  }
  for (const h of data.habits) {
    const ok = h && typeof h.id === 'string' && typeof h.name === 'string' && isValidKey(h.createdAt)
      && Array.isArray(h.days) && h.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!ok) throw new Error('The backup contains a habit that could not be read.');
  }
  return {
    version: 1,
    habits: data.habits.map((h) => ({
      id: h.id,
      name: h.name.slice(0, 60),
      emoji: typeof h.emoji === 'string' ? h.emoji.slice(0, 8) : '',
      color: typeof h.color === 'string' ? h.color : 'teal',
      days: [...new Set(h.days)].sort(),
      createdAt: h.createdAt,
      archived: Boolean(h.archived),
      reminder: typeof h.reminder === 'string' && /^\d{2}:\d{2}$/.test(h.reminder) ? h.reminder : '',
    })),
    entries: data.entries,
  };
}

// ---- Calendar reminder (.ics) -----------------------------------------
// A PWA can't reliably fire notifications on a schedule without a push
// server, so reminders are handed to the phone's calendar app instead: a
// recurring event on the habit's days, with an alert at the chosen time.

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function icsEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function reminderIcs(habit, startKey, now = new Date()) {
  const [hh, mm] = habit.reminder.split(':');
  const date = startKey.replace(/-/g, '');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const byDay = habit.days.map((d) => ICS_DAYS[d]).join(',');
  const title = icsEscape(`${habit.emoji ? habit.emoji + ' ' : ''}${habit.name}`);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rushma Parajuli//Habit Tracker//EN',
    'BEGIN:VEVENT',
    `UID:${habit.id}-reminder@habit-tracker`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${date}T${hh}${mm}00`,
    'DURATION:PT5M',
    `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`,
    `SUMMARY:${title}`,
    'DESCRIPTION:Habit reminder — open Habit Tracker to check it off.',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
