export type UsageWindow = {
  id: 'five-hour' | 'weekly' | 'scoped';
  title: string;
  utilization: number;
  resetsAt: Date | null;
};

export type UsageSnapshot = {
  windows: UsageWindow[];
  fetchedAt: Date;
};

type JsonRecord = Record<string, unknown>;

export function parseUsagePayload(body: string, fetchedAt = new Date()): UsageSnapshot {
  const payload = asRecord(JSON.parse(body));
  const windows: UsageWindow[] = [];

  const fiveHour = parseWindow(payload.five_hour, 'five-hour', 'Fem timmar');
  const weekly = parseWindow(payload.seven_day, 'weekly', 'Vecka');

  if (fiveHour) windows.push(fiveHour);
  if (weekly) windows.push(weekly);

  const scoped = parseScopedWindow(payload.limits);
  if (scoped) windows.push(scoped);

  if (windows.length === 0) {
    throw new Error('Appen kunde inte läsa svaret från Claude. Försök igen.');
  }

  return { windows, fetchedAt };
}

export function parseCodexUsagePayload(body: string, fetchedAt = new Date()): UsageSnapshot {
  const payload = asRecord(JSON.parse(body), 'Appen kunde inte läsa svaret från Codex. Försök igen.');
  const rateLimits = getRecord(payload.rate_limit) ?? getRecord(payload.rateLimits) ?? payload;
  const primary = parseCodexWindow(rateLimits.primary_window ?? rateLimits.primary, fetchedAt);
  const secondary = parseCodexWindow(rateLimits.secondary_window ?? rateLimits.secondary, fetchedAt);
  const candidates = [primary, secondary].filter((window): window is ParsedCodexWindow => window !== null);
  const windows = mapCodexWindowsByDuration(candidates);

  if (windows.length === 0) {
    throw new Error('Appen kunde inte läsa svaret från Codex. Försök igen.');
  }

  return { windows, fetchedAt };
}

export function clampUtilization(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function parseWindow(
  value: unknown,
  id: UsageWindow['id'],
  title: string,
): UsageWindow | null {
  if (!isRecord(value) || typeof value.utilization !== 'number') return null;

  return {
    id,
    title,
    utilization: clampUtilization(value.utilization),
    resetsAt: parseDate(value.resets_at),
  };
}

function parseScopedWindow(value: unknown): UsageWindow | null {
  if (!Array.isArray(value)) return null;

  const candidates = value.flatMap((item): UsageWindow[] => {
    if (!isRecord(item) || item.kind !== 'weekly_scoped' || typeof item.percent !== 'number') {
      return [];
    }

    const scope = isRecord(item.scope) ? item.scope : null;
    const model = scope && isRecord(scope.model) ? scope.model : null;
    const title = model && typeof model.display_name === 'string' ? model.display_name : 'Modellgräns';

    return [{
      id: 'scoped',
      title,
      utilization: clampUtilization(item.percent),
      resetsAt: parseDate(item.resets_at),
    }];
  });

  return candidates.sort((left, right) => right.utilization - left.utilization)[0] ?? null;
}

function parseCodexWindow(
  value: unknown,
  fetchedAt: Date,
): ParsedCodexWindow | null {
  if (!isRecord(value)) return null;

  const usedPercent = readFiniteNumber(value.used_percent ?? value.usedPercent);
  if (usedPercent === null) return null;

  const resetAt = value.reset_at ?? value.resetsAt;
  const resetAfterSeconds = readFiniteNumber(value.reset_after_seconds ?? value.resetAfterSeconds);
  const durationSeconds = readFiniteNumber(
    value.limit_window_seconds ?? value.limitWindowSeconds ?? value.window_duration_seconds,
  );

  return {
    utilization: clampUtilization(usedPercent),
    durationSeconds,
    resetsAt:
      parseUnixDate(resetAt) ??
      (resetAfterSeconds !== null
        ? new Date(fetchedAt.getTime() + resetAfterSeconds * 1000)
        : null),
  };
}

type ParsedCodexWindow = Pick<UsageWindow, 'utilization' | 'resetsAt'> & {
  durationSeconds: number | null;
};

function mapCodexWindowsByDuration(candidates: ParsedCodexWindow[]): UsageWindow[] {
  const remaining = [...candidates];
  const take = (predicate: (window: ParsedCodexWindow) => boolean): ParsedCodexWindow | null => {
    const index = remaining.findIndex(predicate);
    if (index === -1) return null;
    const [matchedWindow] = remaining.splice(index, 1);
    return matchedWindow ?? null;
  };

  // Codex can return a weekly-only limit in primary_window. The declared duration,
  // rather than the primary/secondary position, identifies what the window means.
  const fiveHour =
    take((window) => window.durationSeconds === 18_000) ??
    take((window) => window.durationSeconds !== null && window.durationSeconds < 86_400);
  const weekly =
    take((window) => window.durationSeconds === 604_800) ??
    take((window) => window.durationSeconds !== null && window.durationSeconds >= 86_400);

  const fallbackFiveHour = fiveHour ?? remaining.shift() ?? null;
  const fallbackWeekly = weekly ?? remaining.shift() ?? null;
  const windows: UsageWindow[] = [];

  if (fallbackFiveHour) {
    windows.push({ ...fallbackFiveHour, id: 'five-hour', title: 'Fem timmar' });
  }
  if (fallbackWeekly) {
    windows.push({ ...fallbackWeekly, id: 'weekly', title: 'Vecka' });
  }

  return windows;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseUnixDate(value: unknown): Date | null {
  if (typeof value === 'string' && !Number.isFinite(Number(value))) return parseDate(value);
  const timestamp = readFiniteNumber(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function asRecord(value: unknown, errorMessage = 'Appen kunde inte läsa svaret från Claude. Försök igen.'): JsonRecord {
  if (!isRecord(value)) throw new Error(errorMessage);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
