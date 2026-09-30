import './style.css';
import { type HistoryEntry, clearHistory, loadHistory, saveToHistory } from './history';
import { type CalEvent, buildIcs, icsFileName } from './ics';
import { googleCalendarUrl, outlookCalendarUrl } from './links';
import { readPoster, thumbnail } from './ocr';
import { type DraftEvent, parseEvents } from './parse';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const captureCard = $('capture');
const preview = $('preview');
const previewImg = $<HTMLImageElement>('preview-img');
const progress = $('progress');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
const errorBox = $('error');
const review = $('review');
const reviewHeading = $('review-heading');
const reviewHint = $('review-hint');
const eventList = $<HTMLUListElement>('event-list');
const form = $<HTMLFormElement>('event-form');
const formError = $('form-error');
const submitLabel = $('submit-label');
const googleLink = $<HTMLAnchorElement>('google-link');
const outlookLink = $<HTMLAnchorElement>('outlook-link');
const historyCard = $('history');
const historyList = $<HTMLUListElement>('history-list');
const dropOverlay = $('drop-overlay');

const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
const allDayBox = () => field('allDay') as HTMLInputElement;
const TEXT_FIELDS = ['title', 'date', 'lastDate', 'startTime', 'endTime', 'location', 'notes'];
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The event form's values, as strings, so they can go straight into history. */
type Values = Record<string, string>;
interface Item {
  values: Values;
  selected: boolean;
}

// The events found in the current scan. The form edits items[active].
let items: Item[] = [];
let active = 0;
let current: { id: string; thumb: string; text: string } | null = null;
let busy = false;

// ---------- Getting an image ----------

for (const id of ['camera-input', 'file-input']) {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // allow choosing the same file again
    if (file) void scan(file);
  });
}

window.addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    void scan(file);
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (file) void scan(file);
  else showError('That doesn’t look like an image. Try a JPG or PNG photo of the poster.');
});

// ---------- Reading the poster ----------

async function scan(file: File) {
  if (busy) return;
  if (!file.type.startsWith('image/')) {
    showError('That doesn’t look like an image. Try a JPG or PNG photo of the poster.');
    return;
  }
  busy = true;
  showError('');
  review.hidden = true;
  if (previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
  previewImg.src = URL.createObjectURL(file);
  preview.hidden = false;
  progress.hidden = false;
  setProgress('Preparing the image…', 0);

  try {
    const { text, lines } = await readPoster(file, setProgress);
    const drafts = parseEvents(text, lines, { dayFirst: !navigator.language.startsWith('en-US') });
    current = {
      id: newId(),
      thumb: await thumbnail(file).catch(() => ''),
      text: drafts.map((d) => d.notes).join('\n\n'),
    };
    showItems(drafts.map((d) => ({ values: draftToValues(d), selected: true })));
    remember();
    field('title').focus({ preventScroll: true });
    if (!text.trim()) {
      showError('We couldn’t find any text. Try a sharper, straight-on photo, or fill in the details yourself.');
    }
  } catch (err) {
    console.error(err);
    showError(
      navigator.onLine
        ? 'Sorry, we couldn’t read that image. Try a JPG or PNG, or a clearer photo.'
        : 'The text reader needs an internet connection the first time you use it. Connect and try again.',
    );
  } finally {
    progress.hidden = true;
    busy = false;
  }
}

function setProgress(status: string, fraction: number) {
  progressText.textContent = status;
  progressFill.style.width = `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`;
}

function showError(msg: string) {
  errorBox.textContent = msg;
  errorBox.hidden = !msg;
}

// ---------- The list of events ----------

function showItems(next: Item[]) {
  items = next;
  review.hidden = false;
  selectItem(0);
  review.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectItem(i: number) {
  active = i;
  restoreForm(items[i].values);
  formError.hidden = true;
  renderEventList();
}

function renderEventList() {
  const many = items.length > 1;
  eventList.hidden = !many;
  reviewHeading.textContent = many ? `We found ${items.length} events` : 'Check the details';
  reviewHint.textContent = many
    ? 'Untick any you don’t want. Tap an event to check its details below.'
    : 'We filled these in from the poster. Fix anything we got wrong.';

  const chosen = items.filter((it) => it.selected).length;
  submitLabel.textContent = many ? `Add ${chosen} event${chosen === 1 ? '' : 's'} to calendar` : 'Add to calendar';
  if (!many) return;

  eventList.replaceChildren(
    ...items.map((item, i) => {
      const li = document.createElement('li');
      li.classList.toggle('active', i === active);
      li.classList.toggle('excluded', !item.selected);

      const include = document.createElement('label');
      include.className = 'include';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = item.selected;
      box.setAttribute('aria-label', `Include ${item.values.title || 'this event'}`);
      box.addEventListener('change', () => {
        item.selected = box.checked;
        renderEventList();
      });
      include.append(box);

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'pick';
      if (i === active) pick.setAttribute('aria-current', 'true');
      const strong = document.createElement('strong');
      strong.textContent = item.values.title || 'Untitled event';
      const small = document.createElement('small');
      small.textContent = summarise(item.values);
      pick.append(strong, small);
      pick.addEventListener('click', () => {
        selectItem(i);
        field('title').focus({ preventScroll: true });
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      li.append(include, pick);
      return li;
    }),
  );
}

/** "Fri 2 Oct, 21:00 · Hot Numbers" */
function summarise(v: Values): string {
  if (!v.date) return 'No date found — tap to add one';
  const [y, m, d] = v.date.split('-').map(Number);
  let when = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (v.allDay === 'true' && v.lastDate && v.lastDate !== v.date) {
    const [ly, lm, ld] = v.lastDate.split('-').map(Number);
    when += ` – ${new Date(ly, lm - 1, ld).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  } else if (v.allDay !== 'true' && v.startTime) {
    when += `, ${v.startTime}`;
  }
  return v.location ? `${when} · ${v.location}` : when;
}

// ---------- The event form ----------

function draftToValues(d: DraftEvent): Values {
  const lastDay = d.allDay && d.end ? new Date(d.end.getTime() - DAY_MS) : d.start;
  return {
    title: d.title,
    date: d.start ? toDateInput(d.start) : '',
    lastDate: lastDay ? toDateInput(lastDay) : '',
    startTime: d.start && !d.allDay ? toTimeInput(d.start) : '',
    endTime: d.end && !d.allDay ? toTimeInput(d.end) : '',
    location: d.location,
    notes: d.notes,
    allDay: String(d.allDay),
    reminders: '30',
  };
}

function formValues(): Values {
  const values: Values = {};
  for (const name of TEXT_FIELDS) values[name] = field(name).value;
  values.allDay = String(allDayBox().checked);
  values.reminders = [...form.querySelectorAll<HTMLInputElement>('input[name="reminder"]:checked')]
    .map((cb) => cb.value)
    .join(',');
  return values;
}

function restoreForm(values: Values) {
  for (const name of TEXT_FIELDS) field(name).value = values[name] ?? '';
  allDayBox().checked = values.allDay === 'true';
  const reminders = (values.reminders ?? '30').split(',');
  form.querySelectorAll<HTMLInputElement>('input[name="reminder"]').forEach((cb) => {
    cb.checked = reminders.includes(cb.value);
  });
  syncForm();
}

/** Turns saved form values into an event, or returns a message saying what's missing. */
function toEvent(v: Values): CalEvent | string {
  const title = v.title.trim();
  const allDay = v.allDay === 'true';
  if (!title) return 'Give the event a name.';
  if (!v.date) return 'Choose the date of the event.';
  if (!allDay && !v.startTime) return 'Add a start time, or tick “All day”.';

  const [y, m, d] = v.date.split('-').map(Number);
  let start: Date;
  let end: Date;
  if (allDay) {
    start = new Date(y, m - 1, d);
    const [ly, lm, ld] = (v.lastDate || v.date).split('-').map(Number);
    end = new Date(ly, lm - 1, ld + 1);
    if (end <= start) return 'The last day can’t be before the first day.';
  } else {
    const [sh, sm] = v.startTime.split(':').map(Number);
    start = new Date(y, m - 1, d, sh, sm);
    if (v.endTime) {
      const [eh, em] = v.endTime.split(':').map(Number);
      end = new Date(y, m - 1, d, eh, em);
      if (end <= start) end = new Date(y, m - 1, d + 1, eh, em); // finishes after midnight
    } else {
      end = new Date(start.getTime() + DEFAULT_DURATION_MS);
    }
  }

  return {
    title,
    start,
    end,
    allDay,
    location: v.location.trim(),
    description: v.notes.trim(),
    reminders: v.reminders ? v.reminders.split(',').map(Number) : [],
  };
}

function syncForm() {
  const allDay = allDayBox().checked;
  (form.querySelector('.times') as HTMLElement).hidden = allDay;
  (form.querySelector('.last-day') as HTMLElement).hidden = !allDay;

  const ev = toEvent(formValues());
  for (const link of [googleLink, outlookLink]) {
    if (typeof ev === 'string') {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
    } else {
      link.href = link === googleLink ? googleCalendarUrl(ev) : outlookCalendarUrl(ev);
      link.removeAttribute('aria-disabled');
    }
  }
}

function onFormEdit() {
  // Ticking "All day" on an event with no last day yet: default to one day.
  if (allDayBox().checked && !field('lastDate').value) field('lastDate').value = field('date').value;
  syncForm();
  if (items[active]) {
    items[active].values = formValues();
    renderEventList();
  }
  formError.hidden = true;
}
form.addEventListener('input', onFormEdit);
form.addEventListener('change', onFormEdit);

for (const link of [googleLink, outlookLink]) {
  link.addEventListener('click', (e) => {
    const ev = toEvent(formValues());
    if (typeof ev === 'string') {
      e.preventDefault();
      showFormError(ev);
    } else {
      remember();
    }
  });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const chosen = items.map((item, i) => ({ item, i })).filter(({ item }) => item.selected);
  if (chosen.length === 0) {
    showFormError('Tick at least one event to add.');
    return;
  }
  const events: CalEvent[] = [];
  for (const { item, i } of chosen) {
    const ev = toEvent(item.values);
    if (typeof ev === 'string') {
      // Show the event that needs fixing.
      selectItem(i);
      showFormError(items.length > 1 ? `“${item.values.title || 'Untitled event'}”: ${ev}` : ev);
      return;
    }
    events.push(ev);
  }

  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = events.length === 1 ? icsFileName(events[0].title) : `snap-cal-${events.length}-events.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  remember();
});

function showFormError(msg: string) {
  formError.textContent = msg;
  formError.hidden = false;
}

// ---------- History ----------

function remember() {
  if (!current || items.length === 0) return;
  const first = items[0].values.title.trim() || 'Untitled event';
  renderHistory(
    saveToHistory({
      id: current.id,
      createdAt: new Date().toISOString(),
      thumb: current.thumb,
      text: current.text,
      title: items.length > 1 ? `${first} + ${items.length - 1} more` : first,
      forms: items.map((it) => it.values),
    }),
  );
}

function renderHistory(entries: HistoryEntry[] = loadHistory()) {
  historyCard.hidden = entries.length === 0;
  historyList.replaceChildren(
    ...entries.map((entry) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      if (entry.thumb) {
        const img = document.createElement('img');
        img.src = entry.thumb;
        img.alt = '';
        btn.append(img);
      }
      const meta = document.createElement('span');
      meta.className = 'meta';
      const strong = document.createElement('strong');
      strong.textContent = entry.title;
      const small = document.createElement('small');
      small.textContent = `Scanned ${new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
      meta.append(strong, small);
      btn.append(meta);
      btn.addEventListener('click', () => openEntry(entry));
      li.append(btn);
      return li;
    }),
  );
}

function openEntry(entry: HistoryEntry) {
  // Entries saved before multi-event support have a single `form`.
  const forms = entry.forms ?? (entry.form ? [entry.form] : []);
  if (forms.length === 0) return;
  current = { id: entry.id, thumb: entry.thumb, text: entry.text };
  if (previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
  if (entry.thumb) previewImg.src = entry.thumb;
  preview.hidden = !entry.thumb;
  showError('');
  showItems(forms.map((values) => ({ values, selected: true })));
}

$('clear-history').addEventListener('click', () => {
  if (!confirm('Clear all recent scans from this device?')) return;
  clearHistory();
  renderHistory([]);
});

// ---------- Helpers ----------

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

captureCard.addEventListener('dragover', () => captureCard.classList.add('dragging'));
captureCard.addEventListener('dragleave', () => captureCard.classList.remove('dragging'));
captureCard.addEventListener('drop', () => captureCard.classList.remove('dragging'));

renderHistory();
