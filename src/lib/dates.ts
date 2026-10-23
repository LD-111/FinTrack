export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function currentYearMonth(): string {
  return todayISO().slice(0, 7);
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function parseISODate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDisplayDate(isoDate: string, locale: string): string {
  return parseISODate(isoDate).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMonthLabel(yearMonth: string, locale: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function resolveDateHint(token: string, today = todayISO()): string | null {
  const normalized = token.toLowerCase();
  if (normalized === "today") return today;
  if (normalized === "yesterday") return addDays(today, -1);
  if (normalized === "tomorrow") return addDays(today, 1);

  const lastMatch = normalized.match(/^last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  const weekday = lastMatch?.[1] ?? (WEEKDAYS.includes(normalized as (typeof WEEKDAYS)[number]) ? normalized : null);
  if (!weekday) return null;

  const target = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
  const current = parseISODate(today);
  const delta = (current.getDay() - target + 7) % 7;
  const offset = lastMatch || delta === 0 ? (delta === 0 ? -7 : -delta) : -delta;
  return addDays(today, offset);
}
