/**
 * iCalendar (RFC 5545) generation.
 *
 * This site has no accounts and no backend, so there is nothing that could
 * e-mail anyone a reminder. A calendar file is the one way a static site can
 * still put a deadline in front of a person on the day it matters - and for a
 * court auction, the deadline that actually matters is not the hearing but the
 * deposit that has to clear before it. Hence two alarms, one of them a week out.
 *
 * Deliberately free of any dataset import: /sacuvano/ builds a calendar out of
 * localStorage in the browser, and pulling data/listings.json into that bundle
 * to format a date would cost 4.6 MB. `calendar.ts` holds the half that knows
 * about listings.
 */

/** When a notice does not state a time. Courts overwhelmingly sit mid-morning. */
export const DEFAULT_HOUR = '09:00';

const ZONE = 'Europe/Sarajevo';

export interface IcsEvent {
  /** Stable across rebuilds; a client uses it to update rather than duplicate. */
  uid: string;
  /** Hearing date, ISO `yyyy-mm-dd`. */
  date: string;
  /** Local wall-clock `HH:mm`, or null when the notice did not say. */
  time: string | null;
  title: string;
  /** Body lines, joined with newlines. Empty entries are dropped. */
  description: Array<string | null | undefined>;
  location: string | null;
  url: string;
  categories?: string[];
  /**
   * Creation stamp, ISO date. Uses the notice's publication date rather than
   * the build clock so that a rebuild that changed nothing produces a
   * byte-identical file, and a subscribed client sees no churn.
   */
  stamp: string;
}

// ── Time ────────────────────────────────────────────────────────────────────

const utcParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** How far Sarajevo is ahead of UTC at a given instant, in milliseconds. */
function offsetAt(instant: number): number {
  const parts = Object.fromEntries(
    utcParts.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Midnight comes back as "24" from some engines' hour12:false.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return local - instant;
}

/**
 * A local wall-clock time in Sarajevo, as a UTC instant.
 *
 * Events are written in UTC rather than as a TZID plus a VTIMEZONE block, so
 * every client reads the same instant with no bundled timezone rules to go
 * stale. The offset is resolved against the platform's own tz database, and the
 * whole set is regenerated twice a day, so a rule change reaches subscribers on
 * the next scrape.
 *
 * Two passes: the first guess uses the offset at the wrong instant, which is
 * only wrong within an hour of a DST switch, and the second settles it.
 */
export function zonedInstant(date: string, time: string): number {
  const naive = Date.parse(`${date}T${time}:00Z`);
  const first = naive - offsetAt(naive);
  return naive - offsetAt(first);
}

const stampUtc = (instant: number) =>
  new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// ── Text ────────────────────────────────────────────────────────────────────

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are special. */
const escape = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/**
 * Fold to 75 octets per line, continuing with a leading space.
 *
 * The limit is in octets, not characters, and half this dataset is full of
 * č/ć/ž/š - splitting on character count would put a break inside a two-byte
 * sequence and produce mojibake in the client.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let bytes = 0;
  // Iterating the string yields whole code points, so a surrogate pair is
  // never split either.
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines carry a leading space, which counts toward the 75.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out[0] + out.slice(1).map((l) => `\r\n ${l}`).join('');
}

// ── Calendar ────────────────────────────────────────────────────────────────

export interface CalendarOptions {
  /** Shown as the calendar's name once subscribed. */
  name: string;
  /** Absolute URL of the page this calendar was built from. */
  source?: string;
}

/**
 * Reminders. A week out is the one that matters: the deposit has to be on the
 * court's account before the hearing, and finding out the day before is finding
 * out too late.
 */
const ALARMS: Array<[trigger: string, text: string]> = [
  ['-P7D', 'Za 7 dana je ročište - kapara se uplaćuje prije početka nadmetanja.'],
  ['-P1D', 'Sutra je ročište.'],
];

function event(e: IcsEvent): string[] {
  const start = zonedInstant(e.date, e.time ?? DEFAULT_HOUR);
  const description = e.description.filter(Boolean).join('\n');

  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${stampUtc(zonedInstant(e.stamp, '00:00'))}`,
    `DTSTART:${stampUtc(start)}`,
    // Notices state when a hearing begins, never how long it runs. An hour is a
    // placeholder for "a block of that morning", not a claim about the court.
    `DTEND:${stampUtc(start + 3_600_000)}`,
    `SUMMARY:${escape(e.title)}`,
    ...(description ? [`DESCRIPTION:${escape(description)}`] : []),
    ...(e.location ? [`LOCATION:${escape(e.location)}`] : []),
    `URL:${escape(e.url)}`,
    ...(e.categories?.length ? [`CATEGORIES:${e.categories.map(escape).join(',')}`] : []),
    // The hearing is announced, not agreed to: nobody is being invited, and a
    // client that treats it as an invitation would ask for an RSVP.
    'TRANSP:TRANSPARENT',
    'STATUS:CONFIRMED',
    ...ALARMS.flatMap(([trigger, text]) => [
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:${trigger}`,
      `DESCRIPTION:${escape(text)}`,
      'END:VALARM',
    ]),
    'END:VEVENT',
  ];
}

/**
 * The VCALENDAR shell around a set of already-rendered VEVENT blocks.
 *
 * Split out because /sacuvano/ assembles its calendar in the browser from the
 * per-listing .ics files it fetches, rather than from listings it does not
 * have. Those blocks arrive already folded, so only the header lines are folded
 * here - re-folding a continuation line would corrupt it.
 */
export function wrapEvents(blocks: string[], options: CalendarOptions): string {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sudskeprodaje.omarzunic.com//Sudske prodaje BiH//BS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(options.name)}`,
    `X-WR-TIMEZONE:${ZONE}`,
    // The dataset is rebuilt twice a day; asking for more than that is asking
    // subscribers to fetch the same bytes back.
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...(options.source ? [`SOURCE;VALUE=URI:${escape(options.source)}`] : []),
  ].map(fold);

  // CRLF throughout, and a trailing one: some clients reject a file whose last
  // line is unterminated.
  return [...header, ...blocks, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

/** Every VEVENT in an .ics file, as raw blocks. */
export function eventBlocks(ics: string): string[] {
  return ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
}

export function icsCalendar(events: IcsEvent[], options: CalendarOptions): string {
  return wrapEvents(
    events.map((e) => event(e).map(fold).join('\r\n')),
    options,
  );
}

export const ICS_HEADERS = {
  'Content-Type': 'text/calendar; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
};
