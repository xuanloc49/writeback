/**
 * Business calendar helpers — design §5.1. Always computed with `Intl.DateTimeFormat` for the given
 * IANA time zone; the machine's local time zone is never used.
 */

const MS_PER_DAY = 86_400_000;
const HOURS_PER_DAY = 24;
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values = new Map<string, number>();
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') values.set(part.type, Number(part.value));
  }
  const read = (type: string): number => values.get(type) ?? 0;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Some engines print midnight as "24"; normalize to 0.
    hour: read('hour') % HOURS_PER_DAY,
    minute: read('minute'),
    second: read('second'),
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Wall-clock components interpreted as if they were UTC (a "fake UTC" timestamp). */
function wallClockAsUtcMs(parts: ZonedParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** Offset of `timeZone` at `instant`, in ms (Asia/Ho_Chi_Minh → +25 200 000). */
function offsetMs(instant: Date, timeZone: string): number {
  const wholeSecondInstant = instant.getTime() - instant.getMilliseconds();
  return wallClockAsUtcMs(zonedParts(instant, timeZone)) - wholeSecondInstant;
}

/**
 * Convert a wall-clock time (given as a fake-UTC timestamp) in `timeZone` to a real instant.
 * Two passes handle offset changes (DST) around the target time.
 */
function wallClockToInstant(wallClockMs: number, timeZone: string, hint: Date): Date {
  const guess = new Date(wallClockMs - offsetMs(hint, timeZone));
  return new Date(wallClockMs - offsetMs(guess, timeZone));
}

/** 'YYYY-MM-DD' of `now` in `timeZone`. */
export function businessDate(now: Date, timeZone: string): string {
  const parts = zonedParts(now, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/** UTC instants [start, end) of the `timeZone` calendar day containing `now`. */
export function businessDayRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = zonedParts(now, timeZone);
  const localMidnightMs = Date.UTC(parts.year, parts.month - 1, parts.day);
  return {
    start: wallClockToInstant(localMidnightMs, timeZone, now),
    end: wallClockToInstant(localMidnightMs + MS_PER_DAY, timeZone, now),
  };
}

/** Due when the business date of `nextReviewAt` is today or earlier — PRD §10.6, Appendix C. */
export function isDueToday(nextReviewAt: Date, now: Date, timeZone: string): boolean {
  return businessDate(nextReviewAt, timeZone) <= businessDate(now, timeZone);
}

export function isSameBusinessDay(a: Date, b: Date, timeZone: string): boolean {
  return businessDate(a, timeZone) === businessDate(b, timeZone);
}

function parseBusinessDate(value: string): number {
  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (match === null) throw new RangeError(`Invalid business date: ${value}`);
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

/** Whole days from `a` to `b` (both 'YYYY-MM-DD'); negative when `b` is earlier. Used for streaks. */
export function daysBetweenBusinessDates(a: string, b: string): number {
  return Math.round((parseBusinessDate(b) - parseBusinessDate(a)) / MS_PER_DAY);
}
