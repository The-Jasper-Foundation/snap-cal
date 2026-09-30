import { describe, expect, it } from 'vitest';
import { type CalEvent, buildIcs, fold, icsFileName } from '../src/ics';
import { googleCalendarUrl } from '../src/links';

const ev: CalEvent = {
  title: 'ABBA Freshers Wonderland',
  start: new Date(Date.UTC(2025, 8, 17, 20, 0)),
  end: new Date(Date.UTC(2025, 8, 18, 1, 0)),
  allDay: false,
  location: 'Vinyl Nightclub, Cambridge',
  description: 'Line one\nLine two; with semicolon',
  reminders: [30, 1440],
};
const NOW = new Date(Date.UTC(2025, 6, 17, 18, 0, 13));

describe('buildIcs', () => {
  const ics = buildIcs(ev, NOW, 'test-uid');

  it('writes a valid event with UTC times and CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20250917T200000Z\r\n');
    expect(ics).toContain('DTEND:20250918T010000Z\r\n');
    expect(ics).toContain('DTSTAMP:20250717T180013Z\r\n');
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
  });

  it('escapes commas, semicolons and newlines', () => {
    expect(ics).toContain('LOCATION:Vinyl Nightclub\\, Cambridge');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\; with semicolon');
  });

  it('adds one alarm per reminder', () => {
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics).toContain('TRIGGER:-PT30M');
    expect(ics).toContain('TRIGGER:-P1D');
  });

  it('uses date-only values for all-day events', () => {
    const allDay = buildIcs(
      { ...ev, allDay: true, start: new Date(2025, 6, 12), end: new Date(2025, 6, 13), reminders: [] },
      NOW,
      'x',
    );
    expect(allDay).toContain('DTSTART;VALUE=DATE:20250712');
    expect(allDay).toContain('DTEND;VALUE=DATE:20250713');
    expect(allDay).not.toContain('VALARM');
  });
});

describe('buildIcs with several events', () => {
  it('puts every event in one calendar with its own UID', () => {
    const ics = buildIcs([ev, { ...ev, title: 'Second' }], NOW, 'abc');
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:1-abc');
    expect(ics).toContain('UID:2-abc');
    expect(ics).toContain('SUMMARY:Second');
  });
});

describe('fold', () => {
  it('keeps every physical line within 75 bytes, counting multi-byte characters', () => {
    const long = 'DESCRIPTION:' + 'Café night 🎉 '.repeat(20);
    const folded = fold(long);
    const enc = new TextEncoder();
    for (const l of folded.split('\r\n')) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long);
  });
});

describe('helpers', () => {
  it('makes a safe file name', () => {
    expect(icsFileName("00's School Disco @ KiKi!")).toBe('00-s-school-disco-kiki.ics');
  });

  it('builds a Google Calendar link', () => {
    const url = new URL(googleCalendarUrl(ev));
    expect(url.searchParams.get('dates')).toBe('20250917T200000Z/20250918T010000Z');
    expect(url.searchParams.get('text')).toBe(ev.title);
  });
});
