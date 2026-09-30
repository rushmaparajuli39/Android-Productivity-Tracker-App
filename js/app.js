import {
  ALL_DAYS, DAY_NAMES, activeHabits, addDays, bestStreak, completionRate, currentStreak,
  emptyState, fromKey, heatmap, isDone, isScheduled, noteFor, perfectDays, reminderIcs,
  setEntry, todayKey, totalCheckIns, validateBackup,
} from './lib.js';

const STORAGE_KEY = 'habit-tracker:v1';
const BACKUP_KEY = 'habit-tracker:last-backup';
const COLORS = ['teal', 'blue', 'violet', 'rose', 'amber', 'green'];

const view = document.getElementById('view');
const dialog = document.getElementById('habit-dialog');
const form = document.getElementById('habit-form');
const toastEl = document.getElementById('toast');

let state = load();
let viewDate = todayKey();
let editingId = null;
let installPrompt = null;
let toastTimer = null;

// ---- Storage -----------------------------------------------------------

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateBackup(JSON.parse(raw)) : emptyState();
  } catch (err) {
    console.error('Could not read saved data', err);
    return emptyState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error(err);
    toast('Could not save. Your browser storage may be full or disabled.');
  }
}

function update(next) {
  state = next;
  save();
}

// ---- Helpers -----------------------------------------------------------

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function habitById(id) {
  return state.habits.find((h) => h.id === id);
}

function colorVar(habit) {
  return `--c: var(--c-${COLORS.includes(habit.color) ? habit.color : 'teal'})`;
}

function formatDate(key, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return fromKey(key).toLocaleDateString(undefined, opts);
}

function scheduleText(days) {
  if (days.length === 7) return 'Every day';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.join() === '0,6') return 'Weekends';
  return days.map((d) => DAY_NAMES[d]).join(', ');
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toast(message, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  toastEl.hidden = false;
  if (action) toastEl.querySelector('button').onclick = () => { action.run(); toastEl.hidden = true; };
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, action ? 6000 : 3000);
}

const icons = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

const fab = `<button class="fab" type="button" data-action="new-habit" aria-label="Add a habit">${icons.plus}</button>`;

// ---- Views -------------------------------------------------------------

function renderToday() {
  const today = todayKey();
  if (viewDate > today) viewDate = today;
  const isToday = viewDate === today;
  const due = activeHabits(state).filter((h) => isScheduled(h, viewDate));
  const done = due.filter((h) => isDone(state, h.id, viewDate)).length;
  const pct = due.length ? done / due.length : 0;
  const circumference = 2 * Math.PI * 28;

  const header = `
    <header class="top">
      <div>
        <h1>${isToday ? 'Today' : esc(formatDate(viewDate, { weekday: 'long' }))}</h1>
        <p class="sub">${esc(formatDate(viewDate, { month: 'long', day: 'numeric', year: 'numeric' }))}</p>
      </div>
      <div class="date-nav">
        ${isToday ? '' : '<button class="today-link" type="button" data-action="go-today">Today</button>'}
        <button class="icon-btn" type="button" data-action="prev-day" aria-label="Previous day">${icons.prev}</button>
        <button class="icon-btn" type="button" data-action="next-day" aria-label="Next day" ${isToday ? 'disabled' : ''}>${icons.next}</button>
      </div>
    </header>`;

  if (!state.habits.length) {
    return `${header}
      <div class="empty">
        <div class="big" aria-hidden="true">🌱</div>
        <h2>Start with one small habit</h2>
        <p>Add something you want to do regularly, then check it off each day to build a streak.</p>
        <button class="btn primary" type="button" data-action="new-habit">Add your first habit</button>
      </div>`;
  }

  if (!due.length) {
    return `${header}
      <div class="empty">
        <div class="big" aria-hidden="true">☕</div>
        <h2>Nothing scheduled</h2>
        <p>None of your habits repeat on this day. Enjoy the break.</p>
      </div>${fab}`;
  }

  const message = done === due.length ? 'All done. Nice work!'
    : isToday ? `${due.length - done} to go today` : `${due.length - done} not checked off`;

  const rows = due.map((h) => {
    const checked = isDone(state, h.id, viewDate);
    const note = noteFor(state, h.id, viewDate);
    const streak = currentStreak(state, h, today);
    return `
      <li class="row ${checked ? 'done' : ''}" style="${colorVar(h)}" data-id="${h.id}">
        <div class="row-main">
          <span class="emoji" aria-hidden="true">${esc(h.emoji || '•')}</span>
          <div class="info">
            <p class="name">${esc(h.name)}</p>
            <p class="meta">${streak ? `<span class="flame">🔥 ${plural(streak, 'day')}</span>` : 'No streak yet'}</p>
          </div>
          <button class="check" type="button" data-action="toggle" aria-pressed="${checked}"
            aria-label="${checked ? 'Mark not done' : 'Mark done'}: ${esc(h.name)}">${icons.check}</button>
        </div>
        <button class="note-toggle" type="button" data-action="toggle-note" aria-expanded="${Boolean(note)}">
          ${note ? '✎ Note' : '+ Add a note'}
        </button>
        <div class="note-box" ${note ? '' : 'hidden'}>
          <textarea data-note="${h.id}" maxlength="500" aria-label="Note for ${esc(h.name)}"
            placeholder="How did it go?">${esc(note)}</textarea>
        </div>
      </li>`;
  }).join('');

  return `${header}
    <section class="progress" aria-label="Progress">
      <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="track" cx="32" cy="32" r="28"/>
        <circle class="fill" cx="32" cy="32" r="28"
          stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - pct)}"/>
      </svg>
      <div><strong>${done} of ${due.length} done</strong><span>${message}</span></div>
    </section>
    <ul class="list">${rows}</ul>
    ${fab}`;
}

function renderHabits() {
  const today = todayKey();
  const link = (h) => `
    <li>
      <a class="habit-link" href="#/habit/${h.id}" style="${colorVar(h)}">
        <span class="bar" aria-hidden="true"></span>
        <span class="emoji" aria-hidden="true" style="font-size:22px">${esc(h.emoji || '•')}</span>
        <span class="info" style="flex:1;min-width:0">
          <span class="name" style="display:block;font-weight:600">${esc(h.name)}</span>
          <span class="meta" style="display:block;font-size:14px;color:var(--ink-faint)">
            ${esc(scheduleText(h.days))}${h.archived ? '' : ` · 🔥 ${currentStreak(state, h, today)}`}
          </span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </a>
    </li>`;
  const active = state.habits.filter((h) => !h.archived);
  const archived = state.habits.filter((h) => h.archived);
  const perfect = perfectDays(state, today, 30);

  return `
    <header class="top">
      <div>
        <h1>Habits</h1>
        <p class="sub">${plural(active.length, 'active habit')}${state.habits.length ? ` · ${plural(perfect, 'perfect day')} in the last 30` : ''}</p>
      </div>
    </header>
    ${active.length ? `<ul class="list">${active.map(link).join('')}</ul>` : `
      <div class="empty">
        <div class="big" aria-hidden="true">📝</div>
        <h2>No active habits</h2>
        <p>Tap + to add one.</p>
      </div>`}
    ${archived.length ? `<h2 class="section-title">Archived</h2><ul class="list">${archived.map(link).join('')}</ul>` : ''}
    ${fab}`;
}

function renderHabit(id) {
  const h = habitById(id);
  if (!h) {
    return `<a class="back" href="#/habits">‹ Habits</a>
      <div class="empty"><h2>Habit not found</h2><p>It may have been deleted.</p></div>`;
  }
  const today = todayKey();
  const rate = completionRate(state, h, today, 30);
  const grid = heatmap(state, h, today, 16);
  const notes = Object.entries(state.entries[h.id] || {})
    .filter(([, e]) => e.note && e.note.trim())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 10);

  return `
    <a class="back" href="#/habits">‹ Habits</a>
    <header class="top" style="${colorVar(h)}">
      <div>
        <h1>${esc(h.emoji ? `${h.emoji} ` : '')}${esc(h.name)}</h1>
        <p class="sub">${esc(scheduleText(h.days))}${h.reminder ? ` · reminder at ${esc(h.reminder)}` : ''}${h.archived ? ' · archived' : ''}</p>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><b>${currentStreak(state, h, today)}</b><span>current streak</span></div>
      <div class="stat"><b>${bestStreak(state, h, today)}</b><span>best streak</span></div>
      <div class="stat"><b>${rate === null ? '–' : `${Math.round(rate * 100)}%`}</b><span>done, last 30 days</span></div>
      <div class="stat"><b>${totalCheckIns(state, h.id)}</b><span>total check-ins</span></div>
    </div>

    <section class="card" style="${colorVar(h)}">
      <h2>Last 16 weeks</h2>
      <div class="heatmap" role="img" aria-label="Calendar of completed days">
        ${grid.flat().map((c) => `<i class="${c.status}" title="${esc(formatDate(c.key, { month: 'short', day: 'numeric' }))}: ${c.status}"></i>`).join('')}
      </div>
      <div class="legend">
        <span><i style="background:var(--c)"></i>Done</span>
        <span><i style="background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--rule)"></i>Missed</span>
      </div>
    </section>

    ${notes.length ? `
      <section class="card">
        <h2>Recent notes</h2>
        <ul class="notes">
          ${notes.map(([key, e]) => `<li><time datetime="${key}">${esc(formatDate(key, { weekday: 'short', month: 'short', day: 'numeric' }))}</time>${esc(e.note)}</li>`).join('')}
        </ul>
      </section>` : ''}

    <div class="actions">
      <button class="btn" type="button" data-action="edit-habit" data-id="${h.id}">Edit</button>
      ${h.reminder ? `<button class="btn" type="button" data-action="reminder" data-id="${h.id}">Add reminder to calendar</button>` : ''}
      <button class="btn" type="button" data-action="archive" data-id="${h.id}">${h.archived ? 'Unarchive' : 'Archive'}</button>
      <button class="btn danger" type="button" data-action="delete" data-id="${h.id}">Delete</button>
    </div>`;
}

function renderSettings() {
  let lastBackup = null;
  try { lastBackup = localStorage.getItem(BACKUP_KEY); } catch { /* ignore */ }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  return `
    <header class="top"><div><h1>Settings</h1></div></header>

    <section class="card setting">
      <h2>Back up your data</h2>
      <p>Everything is stored only on this device. Download a backup now and then, so you don't lose your history if you clear your browser or switch phones.</p>
      <p><small>${lastBackup ? `Last backup: ${esc(formatDate(lastBackup, { month: 'short', day: 'numeric', year: 'numeric' }))}` : 'No backup yet.'}</small></p>
      <div class="actions">
        <button class="btn primary" type="button" data-action="export">Download backup</button>
        <label class="btn">Restore from file<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
    </section>

    <section class="card setting">
      <h2>Install on your phone</h2>
      ${standalone ? '<p>Installed. You can open it from your home screen, even offline.</p>'
        : installPrompt ? '<p>Install it like an app. It opens full screen and works offline.</p><div class="actions"><button class="btn primary" type="button" data-action="install">Install app</button></div>'
        : isIos ? '<p>In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</p>'
        : '<p>In your browser menu, choose <b>Install app</b> or <b>Add to Home screen</b>.</p>'}
    </section>

    <section class="card setting">
      <h2>Erase everything</h2>
      <p>Deletes all habits and history from this device. This can't be undone, so download a backup first.</p>
      <div class="actions"><button class="btn danger" type="button" data-action="erase">Erase all data</button></div>
    </section>

    <p style="text-align:center;font-size:13px;color:var(--ink-faint)">
      Habit Tracker · <a href="https://github.com/rushmaparajuli39/Android-Productivity-Tracker-App">Source on GitHub</a>
    </p>`;
}

// ---- Router ------------------------------------------------------------

function route() {
  const [, name = 'today', id] = location.hash.split('/');
  const tab = name === 'habit' ? 'habits' : name;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (name === 'habits') view.innerHTML = renderHabits();
  else if (name === 'habit') view.innerHTML = renderHabit(id);
  else if (name === 'settings') view.innerHTML = renderSettings();
  else view.innerHTML = renderToday();
  const titles = { habits: 'Habits', habit: habitById(id)?.name, settings: 'Settings' };
  document.title = titles[name] ? `${titles[name]} · Habit Tracker` : 'Habit Tracker';
}

function rerender(focusSelector) {
  const y = scrollY;
  route();
  scrollTo(0, y);
  if (focusSelector) view.querySelector(focusSelector)?.focus();
}

addEventListener('hashchange', () => { route(); scrollTo(0, 0); view.focus({ preventScroll: true }); });

// ---- Habit form --------------------------------------------------------

document.getElementById('swatches').innerHTML = COLORS.map((c) => `
  <label style="--c: var(--c-${c})">
    <input type="radio" name="color" value="${c}" aria-label="${c}">
    <span></span>
  </label>`).join('');

document.getElementById('day-toggles').innerHTML = ALL_DAYS.map((d) => `
  <label>
    <input type="checkbox" name="days" value="${d}" aria-label="${DAY_NAMES[d]}">
    <span aria-hidden="true">${DAY_NAMES[d].slice(0, 2)}</span>
  </label>`).join('');

function openForm(habit) {
  editingId = habit?.id ?? null;
  form.reset();
  document.getElementById('habit-dialog-title').textContent = habit ? 'Edit habit' : 'New habit';
  document.getElementById('form-error').hidden = true;
  form.name.value = habit?.name ?? '';
  form.emoji.value = habit?.emoji ?? '';
  form.reminder.value = habit?.reminder ?? '';
  const color = habit?.color ?? COLORS[state.habits.length % COLORS.length];
  form.querySelector(`input[name="color"][value="${color}"]`).checked = true;
  const days = habit?.days ?? ALL_DAYS;
  form.querySelectorAll('input[name="days"]').forEach((el) => { el.checked = days.includes(Number(el.value)); });
  dialog.showModal();
  form.name.focus();
}

form.addEventListener('submit', (event) => {
  const name = form.name.value.trim();
  const days = [...form.querySelectorAll('input[name="days"]:checked')].map((el) => Number(el.value));
  const error = !name ? 'Give the habit a name.' : !days.length ? 'Pick at least one day.' : '';
  if (error) {
    event.preventDefault();
    const el = document.getElementById('form-error');
    el.textContent = error;
    el.hidden = false;
    return;
  }
  const fields = {
    name,
    emoji: form.emoji.value.trim(),
    color: form.color.value || 'teal',
    days,
    reminder: form.reminder.value,
  };
  if (editingId) {
    update({ ...state, habits: state.habits.map((h) => (h.id === editingId ? { ...h, ...fields } : h)) });
    toast('Habit updated');
  } else {
    const habit = { id: newId(), createdAt: todayKey(), archived: false, ...fields };
    update({ ...state, habits: [...state.habits, habit] });
    toast(`Added “${name}”`);
  }
  rerender();
});

// ---- Actions -----------------------------------------------------------

view.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const id = el.dataset.id ?? el.closest('[data-id]')?.dataset.id;
  const habit = id && habitById(id);

  switch (el.dataset.action) {
    case 'new-habit': openForm(); break;
    case 'prev-day': viewDate = addDays(viewDate, -1); rerender('[data-action="prev-day"]'); break;
    case 'next-day': viewDate = addDays(viewDate, 1); rerender(viewDate === todayKey() ? '[data-action="prev-day"]' : '[data-action="next-day"]'); break;
    case 'go-today': viewDate = todayKey(); rerender('[data-action="prev-day"]'); break;
    case 'toggle': {
      const done = !isDone(state, id, viewDate);
      update(setEntry(state, id, viewDate, { done }));
      if (done && navigator.vibrate) navigator.vibrate(12);
      rerender(`[data-id="${id}"] .check`);
      break;
    }
    case 'toggle-note': {
      const box = el.nextElementSibling;
      box.hidden = !box.hidden;
      el.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) box.querySelector('textarea').focus();
      break;
    }
    case 'edit-habit': openForm(habit); break;
    case 'reminder': {
      const slug = habit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'habit';
      download(`${slug}-reminder.ics`, reminderIcs(habit, todayKey()), 'text/calendar');
      toast('Open the downloaded file to add it to your calendar');
      break;
    }
    case 'archive':
      update({ ...state, habits: state.habits.map((h) => (h.id === id ? { ...h, archived: !h.archived } : h)) });
      toast(habit.archived ? 'Habit restored' : 'Habit archived. Its history is kept.');
      rerender();
      break;
    case 'delete': {
      if (!confirm(`Delete “${habit.name}” and all of its history?`)) break;
      const before = state;
      const { [id]: _removed, ...entries } = state.entries;
      update({ ...state, habits: state.habits.filter((h) => h.id !== id), entries });
      location.hash = '#/habits';
      toast('Habit deleted', { label: 'Undo', run: () => { update(before); route(); } });
      break;
    }
    case 'export': {
      const key = todayKey();
      download(`habits-backup-${key}.json`, JSON.stringify(state, null, 2), 'application/json');
      try { localStorage.setItem(BACKUP_KEY, key); } catch { /* ignore */ }
      rerender();
      break;
    }
    case 'install':
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        rerender();
      }
      break;
    case 'erase':
      if (!confirm('Erase all habits and history from this device?')) break;
      update(emptyState());
      toast('All data erased');
      rerender();
      break;
    default: break;
  }
});

// Notes save as you type, without re-rendering (so the keyboard stays open).
let noteTimer = null;
view.addEventListener('input', (event) => {
  const area = event.target.closest('textarea[data-note]');
  if (!area) return;
  const key = viewDate; // capture now, in case the day changes before the save runs
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    update(setEntry(state, area.dataset.note, key, { note: area.value }));
  }, 300);
});

view.addEventListener('change', async (event) => {
  const input = event.target.closest('input[data-action="import"]');
  if (!input?.files?.length) return;
  try {
    const restored = validateBackup(JSON.parse(await input.files[0].text()));
    if (!confirm(`Replace your current data with this backup (${plural(restored.habits.length, 'habit')})?`)) return;
    update(restored);
    toast('Backup restored');
    rerender();
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not a valid backup.' : err.message);
  } finally {
    input.value = '';
  }
});

dialog.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="close-dialog"]') || event.target === dialog) dialog.close();
});

// ---- PWA ---------------------------------------------------------------

addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  if (location.hash.startsWith('#/settings')) rerender();
});

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((err) => console.error(err)));
}

// Ask the browser not to clear this app's storage when space runs low.
navigator.storage?.persist?.().catch(() => {});

// Roll over to the new day if the app stays open past midnight.
let lastToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const today = todayKey();
  if (today === lastToday) return;
  if (viewDate === lastToday) viewDate = today;
  lastToday = today;
  route();
});

route();
