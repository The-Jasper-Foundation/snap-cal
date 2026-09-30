import { describe, expect, it } from 'vitest';
import featured from './fixtures/featured-events.json';
import { type OcrLine, parseEvents } from '../src/parse';

// featured-events.json is the real OCR output (text, size and position of each
// line) from a screenshot of a "Featured Events" web page with four event cards.
const textOf = (ls: OcrLine[]) => ls.map((l) => l.text).join('\n');
const day = (d: Date | null) => d && [d.getFullYear(), d.getMonth() + 1, d.getDate()];

/** Builds lines stacked down one column, `gap` pixels apart. */
function stack(rows: [string, number, number?][]): OcrLine[] {
  let y = 0;
  return rows.map(([text, height, gapAfter = 12]) => {
    const line = { text, height, confidence: 90, box: { x0: 20, y0: y, x1: 20 + text.length * height * 0.5, y1: y + height } };
    y += height + gapAfter;
    return line;
  });
}

describe('parseEvents', () => {
  it('finds each card on an events page', () => {
    const evs = parseEvents(textOf(featured), featured, { ref: new Date(2026, 8, 30) });
    expect(evs.map((e) => e.title)).toEqual([
      'Singles Speed Dating (35+)',
      'Live Music @ Hot Numbers Gwydir Street — Paul Clarvis & Liam Noble Duo',
      'DJ Sessions @ Hot Numbers Gwydir St — Hawkins & Clarke ‘Distant World’ Album listening session & DJ set by DJ Shed 74',
      'ABRASIONS',
    ]);
    expect(evs.map((e) => day(e.start))).toEqual([
      [2026, 9, 30],
      [2026, 10, 1],
      [2026, 10, 2],
      [2026, 10, 3],
    ]);
    // The exhibition runs 3rd - 31st October.
    expect(evs[3].allDay).toBe(true);
    expect(day(evs[3].end)).toEqual([2026, 11, 1]);
    expect(evs[1].location).toBe('Hot Numbers');
    expect(evs[3].location).toBe('THE EDGE CAFE');
    // Each event keeps only its own text as notes.
    expect(evs[0].notes).toContain('designed exclusively for singles');
    expect(evs[0].notes).not.toContain('Featured Events');
    expect(evs[0].notes).not.toContain('West Side Story');
  });

  it('splits a single-column list of events', () => {
    const ls = stack([
      ["What's on this month", 40, 60],
      ['Quiz Night', 30],
      ['Thursday 8th October, 7pm', 20],
      ['The Eagle, Bene’t Street', 20, 50],
      ['Open Mic', 30],
      ['Friday 16th October, 8pm - 11pm', 20],
      ['Bring your own instrument', 20, 50],
      ['Halloween Disco', 30],
      ['Saturday 31st October', 20],
    ]);
    const evs = parseEvents(textOf(ls), ls, { ref: new Date(2026, 8, 30) });
    expect(evs.map((e) => e.title)).toEqual(['Quiz Night', 'Open Mic', 'Halloween Disco']);
    expect(evs.map((e) => [e.start!.getDate(), e.start!.getHours()])).toEqual([
      [8, 19],
      [16, 20],
      [31, 0],
    ]);
    expect(evs[1].end!.getHours()).toBe(23);
    expect(evs[2].allDay).toBe(true);
  });

  it('treats the same date written twice as one event', () => {
    const ls = stack([
      ['Book Club', 30],
      ['Tuesday 6th October', 20, 4],
      ['06/10/2026 7pm', 20],
      ['Central Library', 20],
    ]);
    expect(parseEvents(textOf(ls), ls, { ref: new Date(2026, 8, 30) })).toHaveLength(1);
  });

  it('returns one event for a single poster', () => {
    const ls = stack([
      ['ABBA', 160],
      ['WONDERLAND', 145],
      ['Wed 17th Sept', 77],
      ['9pm - 2am', 74],
      ['@ Vinyl Nightclub', 67],
    ]);
    const evs = parseEvents(textOf(ls), ls, { ref: new Date(2025, 6, 17) });
    expect(evs).toHaveLength(1);
    expect(evs[0].title).toBe('ABBA WONDERLAND');
  });
});
