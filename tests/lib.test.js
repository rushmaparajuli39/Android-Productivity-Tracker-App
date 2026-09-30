import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_DAYS, addDays, bestStreak, completionRate, currentStreak, emptyState, heatmap,
  isPerfectDay, isValidKey, reminderIcs, setEntry, toKey, validateBackup, weekday,
} from '../js/lib.js';

const habit = (overrides = {}) => ({
  id: 'h1', name: 'Read', emoji: '📚', color: 'teal', days: ALL_DAYS,
  createdAt: '2026-09-01', archived: false, reminder: '', ...overrides,
});

function withDone(state, id, keys) {
  return keys.reduce((s, k) => setEntry(s, id, k, { done: true }), state);
}

test('date keys survive month, year, and DST boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // US DST starts
  assert.equal(addDays('2026-11-01', -1), '2026-10-31'); // US DST ends
  assert.equal(toKey(new Date(2026, 8, 30)), '2026-09-30');
  assert.equal(weekday('2026-09-30'), 3); // a Wednesday
  assert.ok(isValidKey('2026-02-28'));
  assert.ok(!isValidKey('2026-02-30'));
});

test('streak counts consecutive done days back from today', () => {
  const h = habit();
  const s = withDone({ ...emptyState(), habits: [h] }, 'h1', ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.equal(currentStreak(s, h, '2026-09-30'), 3);
});

test('an unfinished today does not break the streak', () => {
  const h = habit();
  const s = withDone({ ...emptyState(), habits: [h] }, 'h1', ['2026-09-28', '2026-09-29']);
  assert.equal(currentStreak(s, h, '2026-09-30'), 2);
});

test('a missed scheduled day breaks the streak', () => {
  const h = habit();
  const s = withDone({ ...emptyState(), habits: [h] }, 'h1', ['2026-09-26', '2026-09-28', '2026-09-29']);
  assert.equal(currentStreak(s, h, '2026-09-29'), 2);
});

test('unscheduled days are skipped, not counted as misses', () => {
  const h = habit({ days: [1, 3, 5] }); // Mon, Wed, Fri
  // Fri 25th, Mon 28th, Wed 30th
  const s = withDone({ ...emptyState(), habits: [h] }, 'h1', ['2026-09-25', '2026-09-28', '2026-09-30']);
  assert.equal(currentStreak(s, h, '2026-09-30'), 3);
});

test('days before the habit was created are ignored', () => {
  const h = habit({ createdAt: '2026-09-29' });
  const s = withDone({ ...emptyState(), habits: [h] }, 'h1', ['2026-09-29', '2026-09-30']);
  assert.equal(currentStreak(s, h, '2026-09-30'), 2);
  assert.equal(completionRate(s, h, '2026-09-30'), 1);
});

test('best streak finds the longest run', () => {
  const h = habit();
  const s = withDone({ ...emptyState(), habits: [h] }, 'h1',
    ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-10', '2026-09-11']);
  assert.equal(bestStreak(s, h, '2026-09-30'), 4);
});

test('completion rate ignores an unfinished today', () => {
  const h = habit({ createdAt: '2026-09-27' });
  const s = withDone({ ...emptyState(), habits: [h] }, 'h1', ['2026-09-27', '2026-09-29']);
  // 27 done, 28 missed, 29 done, 30 (today) pending → 2 of 3
  assert.equal(completionRate(s, h, '2026-09-30'), 2 / 3);
});

test('notes are kept even when a habit is not done', () => {
  let s = setEntry(emptyState(), 'h1', '2026-09-30', { note: 'Felt tired' });
  assert.deepEqual(s.entries.h1['2026-09-30'], { done: false, note: 'Felt tired' });
  s = setEntry(s, 'h1', '2026-09-30', { note: '' });
  assert.equal(s.entries.h1['2026-09-30'], undefined);
});

test('perfect day needs every scheduled habit done', () => {
  const a = habit({ id: 'a' });
  const b = habit({ id: 'b' });
  let s = { ...emptyState(), habits: [a, b] };
  s = setEntry(s, 'a', '2026-09-30', { done: true });
  assert.ok(!isPerfectDay(s, '2026-09-30'));
  s = setEntry(s, 'b', '2026-09-30', { done: true });
  assert.ok(isPerfectDay(s, '2026-09-30'));
});

test('heatmap ends on the current week and marks future days', () => {
  const h = habit({ createdAt: '2026-09-20' });
  const grid = heatmap(emptyState(), h, '2026-09-30', 4);
  assert.equal(grid.length, 4);
  const last = grid[3];
  assert.equal(last[0].key, '2026-09-27'); // Sunday of today's week
  assert.equal(last[3].key, '2026-09-30');
  assert.equal(last[4].status, 'future');
  assert.equal(grid[0][0].status, 'off'); // Sep 6, before createdAt
  assert.equal(last[1].status, 'missed'); // Sep 28, scheduled, not done
});

test('backup validation rejects bad files and cleans good ones', () => {
  assert.throws(() => validateBackup(null));
  assert.throws(() => validateBackup({ version: 2, habits: [], entries: {} }));
  assert.throws(() => validateBackup({ version: 1, habits: [{ id: 'x' }], entries: {} }));
  const clean = validateBackup({ version: 1, habits: [habit({ days: [3, 1, 1] })], entries: {} });
  assert.deepEqual(clean.habits[0].days, [1, 3]);
});

test('calendar reminder repeats on the habit days at the chosen time', () => {
  const ics = reminderIcs(habit({ days: [1, 3], reminder: '07:30', name: 'Walk, stretch' }), '2026-09-30');
  assert.match(ics, /DTSTART:20260930T073000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE/);
  assert.match(ics, /SUMMARY:📚 Walk\\, stretch/);
  assert.match(ics, /BEGIN:VALARM/);
});
