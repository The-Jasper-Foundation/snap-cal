import { describe, expect, it } from 'vitest';
import { type OcrLine, parseEvent } from '../src/parse';

// Posters modelled on the Freshers Week 2025 events the app was first built for.
// Times are checked with local getters so the tests pass in any timezone.
const REF = new Date(2025, 6, 17, 18, 0); // 17 July 2025

const lines = (...rows: [string, number][]): OcrLine[] =>
  rows.map(([text, height]) => ({ text, height, confidence: 90 }));
const textOf = (ls: OcrLine[]) => ls.map((l) => l.text).join('\n');

describe('parseEvent', () => {
  it('reads a headline, date, overnight time range and venue', () => {
    const ls = lines(
      ['OFFICIAL FRESHERS', 30],
      ['TRAFFIC LIGHT', 95],
      ['ICEBREAKER', 92],
      ['SUNDAY 14TH SEPTEMBER', 40],
      ['9PM - 2AM', 40],
      ['Revolution Nightclub & Bar', 28],
      ['@cambridgefreshers', 15],
    );
    const ev = parseEvent(textOf(ls), ls, { ref: REF });
    expect(ev.title).toBe('TRAFFIC LIGHT ICEBREAKER');
    expect(ev.allDay).toBe(false);
    expect([ev.start!.getFullYear(), ev.start!.getMonth(), ev.start!.getDate(), ev.start!.getHours()]).toEqual([2025, 8, 14, 21]);
    expect([ev.end!.getDate(), ev.end!.getHours()]).toEqual([15, 2]);
    expect(ev.location).toBe('Revolution Nightclub & Bar');
  });

  it('handles "@ venue", abbreviated months and en dashes', () => {
    const ls = lines(
      ['ABBA FRESHERS', 80],
      ['WONDERLAND', 78],
      ['Wed 17th Sept • 9pm–2am', 35],
      ['@ Vinyl Nightclub', 30],
    );
    const ev = parseEvent(textOf(ls), ls, { ref: REF });
    expect(ev.title).toBe('ABBA FRESHERS WONDERLAND');
    expect([ev.start!.getMonth(), ev.start!.getDate(), ev.start!.getHours()]).toEqual([8, 17, 21]);
    expect([ev.end!.getDate(), ev.end!.getHours()]).toEqual([18, 2]);
    expect(ev.location).toBe('Vinyl Nightclub');
  });

  it('reads day-first numeric dates and "at <Venue>"', () => {
    const ls = lines(
      ["00's School Disco", 70],
      ['Monday Mondays at KiKi Cambridge', 30],
      ['15/09/2025 from 9pm', 30],
    );
    const ev = parseEvent(textOf(ls), ls, { ref: REF });
    expect(ev.title).toBe("00's School Disco");
    expect([ev.start!.getMonth(), ev.start!.getDate(), ev.start!.getHours()]).toEqual([8, 15, 21]);
    expect(ev.end!.getTime() - ev.start!.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(ev.location).toBe('KiKi Cambridge');
  });

  it('makes an all-day event when there is no time', () => {
    const text = 'Summer Fair\nSaturday 12 July\nJesus Green Park';
    const ev = parseEvent(text, [], { ref: new Date(2025, 6, 1) });
    expect(ev.title).toBe('Summer Fair');
    expect(ev.allDay).toBe(true);
    expect([ev.start!.getDate(), ev.start!.getHours()]).toEqual([12, 0]);
    expect(ev.end!.getDate()).toBe(13);
    expect(ev.location).toBe('Jesus Green Park');
  });

  it('picks the next occurrence when the poster has no year', () => {
    const ev = parseEvent('Valentines Ball\nFriday 14th February 8pm', [], { ref: new Date(2025, 9, 1) });
    expect(ev.start!.getFullYear()).toBe(2026);
  });

  it('uses the weekday to choose the year', () => {
    // 17 Sept 2025 was a Wednesday; 17 Sept 2027 is not, so an old poster stays in 2025.
    const ev = parseEvent('ABBA Wonderland\nWed 17th Sept 9pm', [], { ref: new Date(2026, 8, 29) });
    expect(ev.start!.getFullYear()).toBe(2025);
    // Sunday 14th September falls in 2025 and again in 2031; from mid-2025 it's the upcoming one.
    const next = parseEvent('Icebreaker\nSunday 14th September 9pm', [], { ref: REF });
    expect(next.start!.getFullYear()).toBe(2025);
    // No upcoming Friday 14th February within two years, so it's last year's poster.
    const fri = parseEvent('Ball\nFriday 14th February 8pm', [], { ref: new Date(2026, 0, 1) });
    expect([fri.start!.getFullYear(), fri.start!.getDay()]).toEqual([2025, 5]);
  });

  it('does not read a title ending in "Night" as tonight', () => {
    const ev = parseEvent('Quiz Night\nThursday 8th October, 7pm', [], { ref: new Date(2026, 8, 30) });
    expect([ev.start!.getMonth(), ev.start!.getDate(), ev.start!.getHours()]).toEqual([9, 8, 19]);
    expect(ev.title).toBe('Quiz Night');
  });

  it('ignores "book now" and returns no date when there is none', () => {
    const ev = parseEvent('Open Mic Night\nBook now!', [], { ref: REF });
    expect(ev.start).toBeNull();
    expect(ev.title).toBe('Open Mic Night');
  });

  it('skips low-confidence noise when choosing the title', () => {
    const ls: OcrLine[] = [
      { text: 'Wd~ rR', height: 200, confidence: 20 },
      { text: 'Quiz Night', height: 60, confidence: 88 },
      { text: 'Thursday 7pm', height: 30, confidence: 90 },
    ];
    expect(parseEvent(textOf(ls), ls, { ref: REF }).title).toBe('Quiz Night');
  });
});
