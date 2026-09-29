// Turns the text read from a poster into a draft calendar event.
// Everything here is a best guess: the user reviews and edits it before saving.
import * as chrono from 'chrono-node';

/** One line of OCR output. `height` is the text height in pixels, used to spot the headline. */
export interface OcrLine {
  text: string;
  height: number;
  confidence: number;
}

export interface DraftEvent {
  title: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  location: string;
}

export interface ParseOptions {
  /** "Now" for resolving dates with no year; dates are pushed into the future from here. */
  ref?: Date;
  /** Read 03/04 as 3 April (true, default) or March 4 (false). */
  dayFirst?: boolean;
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Phrases chrono understands that are never the event date on a poster ("Book now!").
const IGNORED_DATE_TEXT = /^(now|right now|today only)$/i;

const VENUE_WORDS =
  /\b(club|nightclub|bar|pub|inn|hall|arena|centre|center|theatre|theater|cinema|stadium|park|church|cathedral|hotel|library|museum|gallery|studio|room|street|st\.|road|rd\.|lane|avenue|square|campus|college|university|school|venue|house|court|field|ground|market|shop|cafe|café|restaurant|kitchen|lounge|warehouse)\b/i;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/;
const LABELLED_LOCATION = /\b(?:venue|location|where|place|address)\s*[:\-]\s*(.+)/i;

export function parseEvent(text: string, lines: OcrLine[] = [], opts: ParseOptions = {}): DraftEvent {
  const ref = opts.ref ?? new Date();
  const cleaned = normalise(text);
  const ocrLines = lines.length > 0 ? lines : textToLines(cleaned);

  const { start, end, allDay, dateTexts } = findWhen(cleaned, ref, opts.dayFirst ?? true);
  const location = findLocation(ocrLines, dateTexts);
  const title = findTitle(ocrLines, dateTexts, location);

  return { title, start, end, allDay, location };
}

/** Tidy common OCR quirks so the date parser has a fair chance. */
export function normalise(text: string): string {
  return text
    .replace(/[–—−]/g, '-') // en/em dashes and minus signs
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/(\d)\s*([AaPp])\.?\s*[Mm]\.?\b/g, '$1$2m') // "9 P.M." -> "9pm"
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

function textToLines(text: string): OcrLine[] {
  return text.split('\n').map((t) => ({ text: t, height: 0, confidence: 100 }));
}

function findWhen(text: string, ref: Date, dayFirst: boolean) {
  const parser = dayFirst ? chrono.en.GB : chrono.en;
  const results = parser
    .parse(text, ref, { forwardDate: true })
    .filter((r) => !IGNORED_DATE_TEXT.test(r.text.trim()));
  const dateTexts = results.map((r) => r.text);

  // Posters often put the date and the time on separate lines, so take the
  // first result that names a day and the first that names a time, then combine.
  // An exact date ("15/09", "14th Sept") beats a bare weekday ("Monday Mondays").
  const dated =
    results.find((r) => r.start.isCertain('day')) ?? results.find((r) => r.start.isCertain('weekday'));
  const timed = results.find((r) => r.start.isCertain('hour'));

  if (!dated && !timed) return { start: null, end: null, allDay: false, dateTexts };

  const base = (dated ?? timed)!;
  const start = base.start.date();
  let end: Date | null = base.end?.date() ?? null;

  // "Wed 17th Sept" with no year: use the year where the 17th really is a
  // Wednesday, rather than blindly jumping to next year once the date has passed.
  const years = yearsToShift(base.start, ref);
  if (years !== 0) {
    start.setFullYear(start.getFullYear() + years);
    end?.setFullYear(end.getFullYear() + years);
  }

  if (!base.start.isCertain('hour')) {
    if (!timed) {
      // A day with no time at all: an all-day event.
      start.setHours(0, 0, 0, 0);
      const last = end ?? new Date(start);
      last.setHours(0, 0, 0, 0);
      return { start, end: new Date(last.getTime() + DAY_MS), allDay: true, dateTexts };
    }
    start.setHours(timed.start.get('hour') ?? 0, timed.start.get('minute') ?? 0, 0, 0);
    end = null;
    if (timed.end?.isCertain('hour')) {
      end = new Date(start);
      end.setHours(timed.end.get('hour') ?? 0, timed.end.get('minute') ?? 0, 0, 0);
    }
  }

  if (!end) end = new Date(start.getTime() + DEFAULT_DURATION_MS);
  // "9pm - 2am" finishes the next morning.
  while (end.getTime() <= start.getTime()) end = new Date(end.getTime() + DAY_MS);

  return { start, end, allDay: false, dateTexts };
}

function yearsToShift(c: chrono.ParsedComponents, ref: Date): number {
  if (!c.isCertain('weekday') || !c.isCertain('day') || !c.isCertain('month') || c.isCertain('year')) return 0;
  const weekday = c.get('weekday');
  const month = c.get('month')! - 1;
  const day = c.get('day')!;
  const chosen = c.date().getFullYear();
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const y = ref.getFullYear();
  // Prefer the next matching date; otherwise a recent past one (an old poster).
  for (const year of [y, y + 1, y + 2, y - 1]) {
    const d = new Date(year, month, day);
    if (d.getDay() === weekday && (d >= today || year === y - 1)) return year - chosen;
  }
  return 0;
}

function findLocation(lines: OcrLine[], dateTexts: string[]): string {
  const texts = lines.map((l) => l.text);

  for (const t of texts) {
    const m = LABELLED_LOCATION.exec(t);
    if (m) return tidyLocation(m[1], dateTexts);
  }
  for (const t of texts) {
    // "@ Vinyl Nightclub", but not emails or social handles like "@cambridgefreshers".
    const m = /(?:^|\s)@\s*(.+)/.exec(t);
    if (m && !/^[\w.]+$/.test(m[1].trim())) return tidyLocation(m[1], dateTexts);
  }
  for (const t of texts) {
    // "... at The Corn Exchange" (a capitalised name, not "at 9pm").
    const m = /\bat\s+((?:the\s+)?[A-Z][^\n]*)/.exec(t);
    if (m) {
      const loc = tidyLocation(m[1], dateTexts);
      if (loc) return loc;
    }
  }
  for (const t of texts) {
    if (VENUE_WORDS.test(t) || UK_POSTCODE.test(t)) {
      const loc = tidyLocation(t, dateTexts);
      if (loc) return loc;
    }
  }
  return '';
}

function tidyLocation(raw: string, dateTexts: string[]): string {
  let s = raw;
  for (const d of dateTexts) s = s.split(d).join(' ');
  // Cut trailing "on Friday", "from 9pm" etc.
  s = s.replace(/\s+(on|from|this|every|between)\b.*$/i, '');
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s,.;:\-|]+|[\s,.;:\-|]+$/g, '').trim();
}

function findTitle(lines: OcrLine[], dateTexts: string[], location: string): string {
  const candidates = lines.filter((l) => isTitleCandidate(l, dateTexts, location));
  if (candidates.length === 0) return 'Untitled event';

  const tallest = Math.max(...candidates.map((l) => l.height));
  if (tallest <= 0) return candidates[0].text;

  // Headlines are often split over two or three lines of the same size, so
  // join consecutive lines that are about as tall as the tallest one.
  const idx = lines.indexOf(candidates.find((l) => l.height === tallest)!);
  const parts = [lines[idx].text];
  for (let i = idx + 1; i < lines.length && parts.length < 3; i++) {
    const l = lines[i];
    if (!isTitleCandidate(l, dateTexts, location) || l.height < tallest * 0.8) break;
    parts.push(l.text);
  }
  return parts.join(' ');
}

function isTitleCandidate(line: OcrLine, dateTexts: string[], location: string): boolean {
  const t = line.text;
  const letters = t.replace(/[^A-Za-z]/g, '').length;
  if (letters < 3 || line.confidence < 50) return false;
  // Mostly symbols and noise from graphics.
  if (letters / t.replace(/\s/g, '').length < 0.6) return false;
  if (location && t.includes(location)) return false;
  // Mostly a date or time.
  const dateChars = dateTexts.filter((d) => t.includes(d)).reduce((n, d) => n + d.length, 0);
  return dateChars < t.length * 0.5;
}
