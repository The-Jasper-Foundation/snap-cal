// Turns the text read from a poster (or a page listing several events) into
// draft calendar events. Everything here is a best guess: the user reviews and
// edits it before saving.
import * as chrono from 'chrono-node';

/** One line of OCR output. `height` is the text height in pixels, used to spot the headline. */
export interface OcrLine {
  text: string;
  height: number;
  confidence: number;
  /** Where the line sits in the image, in pixels. Needed to tell events on a listing apart. */
  box?: { x0: number; y0: number; x1: number; y1: number };
}

export interface DraftEvent {
  title: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  location: string;
  /** The text belonging to this event, for the calendar entry's notes. */
  notes: string;
}

export interface ParseOptions {
  /** "Now" for resolving dates with no year; dates are pushed into the future from here. */
  ref?: Date;
  /** Read 03/04 as 3 April (true, default) or March 4 (false). */
  dayFirst?: boolean;
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Phrases chrono understands that are never the event date on a poster:
// "Book now!", or the "Night" in "Quiz Night".
const IGNORED_DATE_TEXT = /^(now|right now|today only|night|morning|afternoon|evening)$/i;

const VENUE_WORDS =
  /\b(club|nightclub|bar|pub|inn|hall|arena|centre|center|theatre|theater|cinema|stadium|park|church|cathedral|hotel|library|museum|gallery|studio|room|street|st\.|road|rd\.|lane|avenue|square|campus|college|university|school|venue|house|court|field|ground|market|shop|cafe|café|restaurant|kitchen|lounge|warehouse)\b/i;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/;
const LABELLED_LOCATION = /\b(?:venue|location|where|place|address)\s*[:\-]\s*(.+)/i;

/**
 * Finds every event in the image. A single poster gives one event; a page
 * such as a "What's on" listing with several dated entries gives one per entry,
 * sorted by date. Always returns at least one (possibly empty) draft.
 */
export function parseEvents(text: string, lines: OcrLine[] = [], opts: ParseOptions = {}): DraftEvent[] {
  const groups = splitIntoEvents(lines, opts.ref ?? new Date(), opts.dayFirst ?? true);
  if (!groups) return [parseEvent(text, lines, opts)];
  return groups
    .map((g) => parseEvent(g.map((l) => l.text).join('\n'), g, opts))
    .sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));
}

export function parseEvent(text: string, lines: OcrLine[] = [], opts: ParseOptions = {}): DraftEvent {
  const ref = opts.ref ?? new Date();
  const cleaned = normalise(text);
  const ocrLines = lines.length > 0 ? lines : textToLines(cleaned);

  const { start, end, allDay, dateTexts } = findWhen(cleaned, ref, opts.dayFirst ?? true);
  const location = findLocation(ocrLines, dateTexts);
  const title = findTitle(ocrLines, dateTexts, location);

  return { title, start, end, allDay, location, notes: cleaned };
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

// ---------- Splitting a listing into separate events ----------

type Box = NonNullable<OcrLine['box']>;
type BoxedLine = OcrLine & { box: Box };

/**
 * Groups the lines of a multi-event page, one group per event, or returns
 * null when the image looks like a single event.
 *
 * Every line containing an exact date is an "anchor". Lines are split into
 * columns by their horizontal position; inside a column, stacked events are
 * separated at the biggest vertical gap between neighbouring anchors.
 */
function splitIntoEvents(lines: OcrLine[], ref: Date, dayFirst: boolean): OcrLine[][] | null {
  if (lines.length < 4 || !lines.every((l) => l.box)) return null;
  const parser = dayFirst ? chrono.en.GB : chrono.en;

  // Anchor -> the day it names, so repeats of the same date can be merged.
  const anchorDay = new Map<OcrLine, string>();
  for (const l of lines) {
    const r = parser
      .parse(normalise(l.text), ref, { forwardDate: true })
      .find((x) => x.start.isCertain('day') && !IGNORED_DATE_TEXT.test(x.text.trim()));
    if (r) anchorDay.set(l, r.start.date().toDateString());
  }
  if (anchorDay.size < 2) return null;

  // Dates are kept even when the OCR is unsure of them: small date text next
  // to icons often scores low but is read correctly.
  const kept = (lines as BoxedLine[]).filter((l) => anchorDay.has(l) || !isNoise(l));
  const unit = median(kept.map((l) => l.box.y1 - l.box.y0)) || 1;

  const groups: OcrLine[][] = [];
  for (const column of findColumns(kept)) {
    column.sort((a, b) => a.box.y0 - b.box.y0);
    const anchorIdx: number[] = [];
    column.forEach((l, i) => {
      if (!anchorDay.has(l)) return;
      const prev = anchorIdx.length ? column[anchorIdx[anchorIdx.length - 1]] : null;
      // "Fri 3 Oct" just above "03/10/2026" is one event, not two.
      if (prev && anchorDay.get(prev) === anchorDay.get(l) && l.box.y0 - prev.box.y1 < 3 * unit) return;
      anchorIdx.push(i);
    });
    if (anchorIdx.length === 0) continue; // headings or stray text with no date

    let from = 0;
    for (let k = 0; k < anchorIdx.length; k++) {
      let to = column.length;
      if (k + 1 < anchorIdx.length) {
        // Cut at the widest gap between this anchor and the next one.
        let best = anchorIdx[k] + 1;
        let bestGap = -Infinity;
        for (let i = anchorIdx[k] + 1; i <= anchorIdx[k + 1]; i++) {
          const gap = column[i].box.y0 - column[i - 1].box.y1;
          if (gap > bestGap) {
            bestGap = gap;
            best = i;
          }
        }
        to = best;
      }
      groups.push(dropDistantHeading(column.slice(from, to), column[anchorIdx[k]], unit));
      from = to;
    }
  }
  return groups.length >= 2 ? groups : null;
}

/** Drops text far above the event's date block, such as a "Featured Events" page heading. */
function dropDistantHeading(group: BoxedLine[], anchor: BoxedLine, unit: number): BoxedLine[] {
  let start = 0;
  for (let i = 1; i <= group.indexOf(anchor); i++) {
    if (group[i].box.y0 - group[i - 1].box.y1 > 8 * unit) start = i;
  }
  return group.slice(start);
}

/** Splits lines into side-by-side columns (e.g. cards on an events page). */
function findColumns(lines: BoxedLine[]): BoxedLine[][] {
  const left = Math.min(...lines.map((l) => l.box.x0));
  const pageWidth = Math.max(...lines.map((l) => l.box.x1)) - left;
  // Very wide lines (page headings, footers) would join every column together.
  const narrow = lines.filter((l) => l.box.x1 - l.box.x0 <= pageWidth * 0.5);
  if (narrow.length < lines.length / 2) return [lines];

  const sorted = [...narrow].sort((a, b) => a.box.x0 - b.box.x0);
  const columns: { x1: number; lines: BoxedLine[] }[] = [];
  for (const l of sorted) {
    const col = columns[columns.length - 1];
    if (col && l.box.x0 < col.x1 - 10) {
      col.lines.push(l);
      col.x1 = Math.max(col.x1, l.box.x1);
    } else {
      columns.push({ x1: l.box.x1, lines: [l] });
    }
  }
  return columns.length > 1 ? columns.map((c) => c.lines) : [lines];
}

/** Stray marks read from photos and graphics. */
function isNoise(l: OcrLine): boolean {
  return l.confidence < 50 || l.text.replace(/[^A-Za-z]/g, '').length < 2;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---------- Reading one event ----------

function textToLines(text: string): OcrLine[] {
  return text.split('\n').map((t) => ({ text: t, height: 0, confidence: 100 }));
}

function findWhen(text: string, ref: Date, dayFirst: boolean) {
  const parser = dayFirst ? chrono.en.GB : chrono.en;
  // One line at a time: across line breaks, a title like "Quiz Night" above
  // "Thursday 8th October" is misread as "tonight".
  const results = text
    .split('\n')
    .flatMap((line) => parser.parse(line, ref, { forwardDate: true }))
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
  // A venue name ("The Edge Cafe") beats a bare postcode.
  for (const pattern of [VENUE_WORDS, UK_POSTCODE]) {
    for (const t of texts) {
      if (!pattern.test(t)) continue;
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

  // Headlines are often split over several lines of the same size, so join
  // the neighbouring lines (above and below) that are about as tall.
  const idx = lines.indexOf(candidates.find((l) => l.height === tallest)!);
  const sameSize = (l: OcrLine) => isTitleCandidate(l, dateTexts, location) && l.height >= tallest * 0.85;
  let first = idx;
  let last = idx;
  while (last - first < 3 && first > 0 && sameSize(lines[first - 1])) first--;
  while (last - first < 3 && last + 1 < lines.length && sameSize(lines[last + 1])) last++;
  return lines
    .slice(first, last + 1)
    .map((l) => l.text)
    .join(' ');
}

function isTitleCandidate(line: OcrLine, dateTexts: string[], location: string): boolean {
  const t = line.text;
  const letters = t.replace(/[^A-Za-z]/g, '').length;
  if (letters < 3 || line.confidence < 50) return false;
  // Mostly symbols and noise from graphics.
  if (letters / t.replace(/\s/g, '').length < 0.6) return false;
  // The venue line itself ("@ Vinyl Nightclub"), but not "Live Music @ Hot Numbers".
  if (location && t.includes(location) && location.length >= t.length * 0.6) return false;
  // Mostly a date or time.
  const dateChars = dateTexts.filter((d) => t.includes(d)).reduce((n, d) => n + d.length, 0);
  return dateChars < t.length * 0.5;
}
