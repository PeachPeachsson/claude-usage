import {
  clampUtilization,
  parseCodexUsagePayload,
  parseUsagePayload,
} from '@/src/domain/usage';

const FETCHED_AT = new Date('2026-09-04T12:00:00.000Z');

describe('Claude usage payload characterization', () => {
  it('maps five-hour, weekly and highest scoped limits in display order', () => {
    const snapshot = parseUsagePayload(JSON.stringify({
      five_hour: { utilization: 24.5, resets_at: '2026-09-04T15:00:00.000Z' },
      seven_day: { utilization: 61, resets_at: '2026-09-08T08:30:00.000Z' },
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 18,
          resets_at: '2026-09-09T10:00:00.000Z',
          scope: { model: { display_name: 'Sonnet' } },
        },
        {
          kind: 'weekly_scoped',
          percent: 77,
          resets_at: '2026-09-10T10:00:00.000Z',
          scope: { model: { display_name: 'Opus' } },
        },
      ],
    }), FETCHED_AT);

    expect(snapshot.fetchedAt).toBe(FETCHED_AT);
    expect(snapshot.windows).toEqual([
      {
        id: 'five-hour',
        title: 'Fem timmar',
        utilization: 24.5,
        resetsAt: new Date('2026-09-04T15:00:00.000Z'),
      },
      {
        id: 'weekly',
        title: 'Vecka',
        utilization: 61,
        resetsAt: new Date('2026-09-08T08:30:00.000Z'),
      },
      {
        id: 'scoped',
        title: 'Opus',
        utilization: 77,
        resetsAt: new Date('2026-09-10T10:00:00.000Z'),
      },
    ]);
  });

  it('uses the model-limit fallback and null reset for incomplete scoped data', () => {
    const snapshot = parseUsagePayload(JSON.stringify({
      limits: [{ kind: 'weekly_scoped', percent: 12, resets_at: 'not-a-date' }],
    }), FETCHED_AT);

    expect(snapshot.windows).toEqual([{
      id: 'scoped',
      title: 'Modellgräns',
      utilization: 12,
      resetsAt: null,
    }]);
  });

  it('ignores unsupported windows when another valid window exists', () => {
    const snapshot = parseUsagePayload(JSON.stringify({
      five_hour: { utilization: '25' },
      seven_day: { utilization: 40, resets_at: null },
      limits: [{ kind: 'daily', percent: 99 }],
    }), FETCHED_AT);

    expect(snapshot.windows).toEqual([{
      id: 'weekly',
      title: 'Vecka',
      utilization: 40,
      resetsAt: null,
    }]);
  });

  it('throws the friendly format error when no supported windows exist', () => {
    expect(() => parseUsagePayload('{}', FETCHED_AT)).toThrow(
      'Appen kunde inte läsa svaret från Claude. Försök igen.',
    );
  });

  it('currently exposes the native JSON syntax error for malformed JSON', () => {
    expect(() => parseUsagePayload('{', FETCHED_AT)).toThrow(SyntaxError);
  });
});

describe('Codex usage payload characterization', () => {
  it('maps snake-case rate-limit windows by duration, not response position', () => {
    const snapshot = parseCodexUsagePayload(JSON.stringify({
      rate_limit: {
        primary_window: {
          used_percent: 66,
          limit_window_seconds: 604_800,
          reset_at: 1_789_200_000,
        },
        secondary_window: {
          used_percent: 11,
          limit_window_seconds: 18_000,
          reset_after_seconds: 600,
        },
      },
    }), FETCHED_AT);

    expect(snapshot.windows).toEqual([
      {
        id: 'five-hour',
        title: 'Fem timmar',
        utilization: 11,
        resetsAt: new Date('2026-09-04T12:10:00.000Z'),
        durationSeconds: 18_000,
      },
      {
        id: 'weekly',
        title: 'Vecka',
        utilization: 66,
        resetsAt: new Date(1_789_200_000_000),
        durationSeconds: 604_800,
      },
    ]);
  });

  it('accepts camel-case payloads and numeric strings', () => {
    const snapshot = parseCodexUsagePayload(JSON.stringify({
      rateLimits: {
        primary: {
          usedPercent: '39',
          limitWindowSeconds: '18000',
          resetsAt: '2026-09-04T18:00:00.000Z',
        },
      },
    }), FETCHED_AT);

    expect(snapshot.windows[0]).toEqual({
      id: 'five-hour',
      title: 'Fem timmar',
      utilization: 39,
      resetsAt: new Date('2026-09-04T18:00:00.000Z'),
      durationSeconds: 18_000,
    });
  });

  it('classifies a weekly-only primary window as weekly', () => {
    const snapshot = parseCodexUsagePayload(JSON.stringify({
      primary_window: {
        used_percent: 52,
        window_duration_seconds: 604_800,
        reset_after_seconds: 3_600,
      },
    }), FETCHED_AT);

    expect(snapshot.windows).toEqual([{
      id: 'weekly',
      title: 'Vecka',
      utilization: 52,
      resetsAt: new Date('2026-09-04T13:00:00.000Z'),
      durationSeconds: 604_800,
    }]);
  });

  it('falls back to response order when durations are absent', () => {
    const snapshot = parseCodexUsagePayload(JSON.stringify({
      primary: { usedPercent: 5 },
      secondary: { usedPercent: 15 },
    }), FETCHED_AT);

    expect(snapshot.windows.map(({ id, utilization }) => ({ id, utilization }))).toEqual([
      { id: 'five-hour', utilization: 5 },
      { id: 'weekly', utilization: 15 },
    ]);
  });

  it('throws the friendly Codex format error for unsupported data', () => {
    expect(() => parseCodexUsagePayload('[]', FETCHED_AT)).toThrow(
      'Appen kunde inte läsa svaret från Codex. Försök igen.',
    );
  });
});

describe('utilization boundaries', () => {
  it.each([
    [-10, 0],
    [42.25, 42.25],
    [130, 100],
  ])('clamps %s to %s', (input, expected) => {
    expect(clampUtilization(input)).toBe(expected);
  });
});
