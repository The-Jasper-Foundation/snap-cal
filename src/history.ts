// Past scans, kept in this browser only (localStorage).

export interface HistoryEntry {
  id: string;
  createdAt: string;
  thumb: string;
  text: string;
  title: string;
  /** The event form for each event found, as last saved, so a scan can be reopened. */
  forms?: Record<string, string>[];
  /** Older entries (from before multi-event scans) hold a single form. */
  form?: Record<string, string>;
}

const KEY = 'snapcal.history';
const MAX_ENTRIES = 30;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveToHistory(entry: HistoryEntry): HistoryEntry[] {
  const list = [entry, ...loadHistory().filter((e) => e.id !== entry.id)].slice(0, MAX_ENTRIES);
  // If storage is full, drop the oldest entries until it fits.
  for (let n = list.length; n > 0; n--) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, n)));
      return list.slice(0, n);
    } catch {
      /* try with fewer entries */
    }
  }
  return list;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
