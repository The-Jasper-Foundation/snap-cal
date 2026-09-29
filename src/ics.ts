// Builds an iCalendar (.ics) file. Apple Calendar, Outlook, Windows Calendar
// and Google Calendar can all open it, and unlike web links it keeps reminders.

export interface CalEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string;
  description: string;
  /** Minutes before the start to show a reminder. */
  reminders: number[];
}

export function buildIcs(ev: CalEvent, now = new Date(), uid = randomUid()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Snap Cal//Poster to Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    ...(ev.allDay
      ? [`DTSTART;VALUE=DATE:${dateStamp(ev.start)}`, `DTEND;VALUE=DATE:${dateStamp(ev.end)}`]
      : [`DTSTART:${utcStamp(ev.start)}`, `DTEND:${utcStamp(ev.end)}`]),
    `SUMMARY:${escapeText(ev.title)}`,
    ...(ev.location ? [`LOCATION:${escapeText(ev.location)}`] : []),
    ...(ev.description ? [`DESCRIPTION:${escapeText(ev.description)}`] : []),
    ...ev.reminders.flatMap((mins) => [
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(ev.title)}`,
      `TRIGGER:${trigger(mins)}`,
      'END:VALARM',
    ]),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function icsFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${slug || 'event'}.ics`;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 bytes must be split, with continuation lines starting with a space. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines lose a byte to the leading space
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function trigger(mins: number): string {
  if (mins === 0) return 'PT0M';
  if (mins % 1440 === 0) return `-P${mins / 1440}D`;
  return `-PT${mins}M`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function utcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Local calendar date, for all-day events. */
export function dateStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function randomUid(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${id}@snap-cal`;
}
