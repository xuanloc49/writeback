import { businessDayRange } from '@writeback/shared';

/** Which daily counter ran out (design §9.1). */
export type QuotaScope = 'rewrite_new' | 'retry';

export interface QuotaReset {
  /** Instant at which the daily counters reset (start of the next business day). */
  resetAt: Date;
  /** Human label such as `00:00 GMT+7`, evaluated at `resetAt` so DST zones are right. */
  label: string;
}

const MINUTES_PER_HOUR = 60;

/**
 * Describes when the daily quota resets for the business time zone (design §5.2, PRD §8).
 * Pure: derives everything from `now` and `timeZone`; no hard-coded zone strings.
 */
export function describeQuotaReset(now: Date, timeZone: string): QuotaReset {
  const resetAt = businessDayRange(now, timeZone).end;
  return { resetAt, label: `${wallClock(resetAt, timeZone)} ${offsetLabel(resetAt, timeZone)}` };
}

/** Vietnamese QUOTA_EXCEEDED copy per PRD §8, parameterised by the reset label. */
export function quotaExceededMessage(scope: QuotaScope, label: string): string {
  return scope === 'retry'
    ? `Bạn đã hết lượt sửa bài hôm nay. Lượt mới vào ${label}.`
    : `Bạn đã hết lượt viết lại hôm nay. Lượt mới vào ${label}.`;
}

function wallClock(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  return `${partValue(parts, 'hour')}:${partValue(parts, 'minute')}`;
}

/** `GMT+7`, `GMT+5:30`, `GMT-3`, or `GMT` — via `shortOffset` when the runtime supports it. */
function offsetLabel(at: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(at);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value;
    if (name !== undefined && name.startsWith('GMT')) {
      // Some ICU builds render UTC as `GMT+0`; normalise to plain `GMT`.
      return /^GMT[+-]0(:00)?$/.test(name) ? 'GMT' : name;
    }
  } catch {
    // `shortOffset` unsupported (older ICU): fall through to the arithmetic fallback.
  }
  return formatOffset(offsetMinutes(at, timeZone));
}

/** Offset of `timeZone` from UTC at instant `at`, in minutes (east positive). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const asUtc = Date.UTC(
    Number(partValue(parts, 'year')),
    Number(partValue(parts, 'month')) - 1,
    Number(partValue(parts, 'day')),
    Number(partValue(parts, 'hour')),
    Number(partValue(parts, 'minute')),
    Number(partValue(parts, 'second')),
  );
  const atWholeSeconds = at.getTime() - at.getUTCMilliseconds();
  return Math.round((asUtc - atWholeSeconds) / 60_000);
}

function formatOffset(minutes: number): string {
  if (minutes === 0) {
    return 'GMT';
  }
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / MINUTES_PER_HOUR);
  const rest = abs % MINUTES_PER_HOUR;
  return rest === 0 ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${String(rest).padStart(2, '0')}`;
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}
