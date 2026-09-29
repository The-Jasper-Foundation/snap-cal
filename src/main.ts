import './style.css';
import { type HistoryEntry, clearHistory, loadHistory, saveToHistory } from './history';
import { type CalEvent, buildIcs, icsFileName } from './ics';
import { googleCalendarUrl, outlookCalendarUrl } from './links';
import { readPoster, thumbnail } from './ocr';
import { type DraftEvent, normalise, parseEvent } from './parse';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const captureCard = $('capture');
const preview = $('preview');
const previewImg = $<HTMLImageElement>('preview-img');
const progress = $('progress');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
const errorBox = $('error');
const review = $('review');
const form = $<HTMLFormElement>('event-form');
const formError = $('form-error');
const googleLink = $<HTMLAnchorElement>('google-link');
const outlookLink = $<HTMLAnchorElement>('outlook-link');
const historyCard = $('history');
const historyList = $<HTMLUListElement>('history-list');
const dropOverlay = $('drop-overlay');

const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

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
    const draft = parseEvent(text, lines, { dayFirst: !navigator.language.startsWith('en-US') });
    const notes = normalise(text);
    fillForm(draft, notes);

    current = { id: newId(), thumb: await thumbnail(file).catch(() => ''), text: notes };
    remember();

    review.hidden = false;
    review.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

// ---------- The event form ----------

function fillForm(d: DraftEvent, notes: string) {
  field('title').value = d.title;
  field('location').value = d.location;
  field('notes').value = notes;
  (field('allDay') as HTMLInputElement).checked = d.allDay;
  field('date').value = d.start ? toDateInput(d.start) : '';
  field('startTime').value = d.start && !d.allDay ? toTimeInput(d.start) : '';
  field('endTime').value = d.end && !d.allDay ? toTimeInput(d.end) : '';
  syncForm();
}

function formValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of ['title', 'date', 'startTime', 'endTime', 'location', 'notes']) values[name] = field(name).value;
  values.allDay = String((field('allDay') as HTMLInputElement).checked);
  values.reminders = checkedReminders().join(',');
  return values;
}

function restoreForm(values: Record<string, string>) {
  for (const name of ['title', 'date', 'startTime', 'endTime', 'location', 'notes']) field(name).value = values[name] ?? '';
  (field('allDay') as HTMLInputElement).checked = values.allDay === 'true';
  const reminders = (values.reminders ?? '30').split(',');
  form.querySelectorAll<HTMLInputElement>('input[name="reminder"]').forEach((cb) => {
    cb.checked = reminders.includes(cb.value);
  });
  syncForm();
}

function checkedReminders(): number[] {
  return [...form.querySelectorAll<HTMLInputElement>('input[name="reminder"]:checked')].map((cb) => Number(cb.value));
}

/** Reads the form into an event, or returns a message saying what's missing. */
function readForm(): CalEvent | string {
  const title = field('title').value.trim();
  const date = field('date').value;
  const allDay = (field('allDay') as HTMLInputElement).checked;
  const startTime = field('startTime').value;
  const endTime = field('endTime').value;

  if (!title) return 'Give the event a name.';
  if (!date) return 'Choose the date of the event.';
  if (!allDay && !startTime) return 'Add a start time, or tick “All day”.';

  const [y, m, d] = date.split('-').map(Number);
  let start: Date;
  let end: Date;
  if (allDay) {
    start = new Date(y, m - 1, d);
    end = new Date(y, m - 1, d + 1);
  } else {
    const [sh, sm] = startTime.split(':').map(Number);
    start = new Date(y, m - 1, d, sh, sm);
    if (endTime) {
      const [eh, em] = endTime.split(':').map(Number);
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
    location: field('location').value.trim(),
    description: field('notes').value.trim(),
    reminders: checkedReminders(),
  };
}

function syncForm() {
  const allDay = (field('allDay') as HTMLInputElement).checked;
  (form.querySelector('.times') as HTMLElement).hidden = allDay;

  const ev = readForm();
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

form.addEventListener('input', () => {
  syncForm();
  formError.hidden = true;
});
form.addEventListener('change', syncForm);

for (const link of [googleLink, outlookLink]) {
  link.addEventListener('click', (e) => {
    const ev = readForm();
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
  const ev = readForm();
  if (typeof ev === 'string') {
    showFormError(ev);
    return;
  }
  const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = icsFileName(ev.title);
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
  if (!current) return;
  renderHistory(
    saveToHistory({
      id: current.id,
      createdAt: new Date().toISOString(),
      thumb: current.thumb,
      text: current.text,
      title: field('title').value.trim() || 'Untitled event',
      form: formValues(),
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
  current = { id: entry.id, thumb: entry.thumb, text: entry.text };
  restoreForm(entry.form);
  if (previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
  if (entry.thumb) previewImg.src = entry.thumb;
  preview.hidden = !entry.thumb;
  showError('');
  review.hidden = false;
  review.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
