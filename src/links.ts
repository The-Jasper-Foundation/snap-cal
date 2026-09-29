// "Add event" links for web calendars. These open a pre-filled event page,
// but neither service accepts reminders through the link.
import { type CalEvent, dateStamp, utcStamp } from './ics';

export function googleCalendarUrl(ev: CalEvent): string {
  const dates = ev.allDay
    ? `${dateStamp(ev.start)}/${dateStamp(ev.end)}`
    : `${utcStamp(ev.start)}/${utcStamp(ev.end)}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates });
  if (ev.location) params.set('location', ev.location);
  if (ev.description) params.set('details', ev.description);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function outlookCalendarUrl(ev: CalEvent): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: ev.title,
    startdt: ev.allDay ? isoDate(ev.start) : ev.start.toISOString(),
    enddt: ev.allDay ? isoDate(ev.end) : ev.end.toISOString(),
    allday: String(ev.allDay),
  });
  if (ev.location) params.set('location', ev.location);
  if (ev.description) params.set('body', ev.description);
  return `https://outlook.live.com/calendar/0/action/compose?${params}`;
}

function isoDate(d: Date): string {
  const s = dateStamp(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
