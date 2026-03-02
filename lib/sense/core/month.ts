export type ParseMonthOptions = {
  allowDate?: boolean;
  allowDateString?: boolean;
  useUTC?: boolean;
};

type MonthParts = { year: number; month: number };

function formatMonthParts(parts: MonthParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
}

/**
 * Strict month parsing helper.
 * - Accepts YYYY-MM or YYYY-MM-DD by default.
 * - Date objects are allowed by default.
 * - Optional Date-string parsing can be enabled.
 */
export function parseMonthLike(input: unknown, options: ParseMonthOptions = {}): MonthParts | null {
  const { allowDate = true, allowDateString = false, useUTC = false } = options;

  if (input == null) return null;

  if (input instanceof Date) {
    if (!allowDate) return null;
    if (Number.isNaN(input.getTime())) return null;
    const year = useUTC ? input.getUTCFullYear() : input.getFullYear();
    const month = (useUTC ? input.getUTCMonth() : input.getMonth()) + 1;
    return { year, month };
  }

  if (typeof input === 'string') {
    const match = input.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (!Number.isFinite(year) || month < 1 || month > 12) return null;
      return { year, month };
    }

    if (allowDateString) {
      const parsed = new Date(input);
      if (Number.isNaN(parsed.getTime())) return null;
      const year = useUTC ? parsed.getUTCFullYear() : parsed.getFullYear();
      const month = (useUTC ? parsed.getUTCMonth() : parsed.getMonth()) + 1;
      return { year, month };
    }
  }

  return null;
}

/**
 * Normalize an input to YYYY-MM-01.
 * Default behavior matches the strict YYYY-MM(/-DD) parsing used in most endpoints.
 */
export function normalizeMonth(input: unknown): string | null {
  const parts = parseMonthLike(input, { allowDate: true, allowDateString: false, useUTC: false });
  return parts ? formatMonthParts(parts) : null;
}

/**
 * Compute a {fromMonth,toMonth} range in YYYY-MM-01 format.
 * Uses UTC month arithmetic to preserve prior addMonths behavior.
 */
export function monthRange(toMonth: string, monthsBack: number): { fromMonth: string; toMonth: string } {
  if (!Number.isFinite(monthsBack) || monthsBack < 1) {
    throw new Error(`Invalid monthsBack: ${monthsBack}`);
  }

  const toParts = parseMonthLike(toMonth, { allowDate: true, allowDateString: true, useUTC: true });
  if (!toParts) {
    throw new Error(`Invalid month: ${toMonth}`);
  }

  const toMonthNormalized = formatMonthParts(toParts);
  const delta = -(monthsBack - 1);
  const next = new Date(Date.UTC(toParts.year, toParts.month - 1 + delta, 1));
  const fromParts = {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
  };

  return {
    fromMonth: formatMonthParts(fromParts),
    toMonth: toMonthNormalized,
  };
}
