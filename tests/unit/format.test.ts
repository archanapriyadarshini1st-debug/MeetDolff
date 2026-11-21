import { describe, expect, it } from 'vitest';
import {
  countIfAny,
  formatClock,
  formatDay,
  formatDuration,
  formatTimeRange,
  formatWhen,
  joinMeta,
  pluralize,
} from '../../src/lib/utils/format.js';

describe('formatDuration', () => {
  it('never prints raw seconds for real meeting lengths', () => {
    expect(formatDuration(2460)).toBe('41 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(4320)).toBe('1 h 12 min');
    expect(formatDuration(3599)).toBe('1 h');
  });

  it('handles short and degenerate values', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(59.6)).toBe('1 min');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });

  it('does not overflow minutes into 60', () => {
    expect(formatDuration(3599)).not.toContain('60');
    expect(formatDuration(7199)).toBe('2 h');
  });
});

describe('formatClock', () => {
  it('pads minutes and seconds but only shows hours when present', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(9)).toBe('00:09');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});

describe('pluralize', () => {
  it('agrees with the count (the "1 decisions" bug)', () => {
    expect(pluralize(1, 'decision')).toBe('1 decision');
    expect(pluralize(0, 'decision')).toBe('0 decisions');
    expect(pluralize(3, 'action item')).toBe('3 action items');
  });

  it('supports irregular plurals', () => {
    expect(pluralize(2, 'person', 'people')).toBe('2 people');
  });
});

describe('countIfAny', () => {
  it('drops zero-count noise', () => {
    expect(countIfAny(0, 'decision')).toBe('');
    expect(countIfAny(1, 'decision')).toBe('1 decision');
  });
});

describe('joinMeta', () => {
  it('joins only the meaningful parts', () => {
    expect(joinMeta(['41 min', '', null, undefined, false, '1 decision'])).toBe('41 min · 1 decision');
  });
});

describe('formatWhen', () => {
  const now = new Date(2026, 10, 21, 15, 0, 0);

  it('uses relative labels for the last week', () => {
    expect(formatWhen(new Date(2026, 10, 21, 9, 30).toISOString(), now)).toMatch(/^Today /);
    expect(formatWhen(new Date(2026, 10, 20, 9, 30).toISOString(), now)).toMatch(/^Yesterday /);
    expect(formatWhen(new Date(2026, 10, 18, 9, 30).toISOString(), now)).toContain('18 Nov');
  });

  it('includes the year only when it is not the current one', () => {
    const old = formatWhen(new Date(2025, 0, 5, 10, 0).toISOString(), now);
    expect(old).toContain('2025');
    const thisYear = formatWhen(new Date(2026, 0, 5, 10, 0).toISOString(), now);
    expect(thisYear).not.toContain('2026');
  });

  it('never leaks a raw ISO string', () => {
    const iso = '2026-11-19T14:00:00.000Z';
    expect(formatWhen(iso, now)).not.toBe(iso);
    expect(formatWhen(iso, now)).not.toContain('T14:00:00');
  });

  it('passes through unparseable input instead of throwing', () => {
    expect(formatWhen('not-a-date', now)).toBe('not-a-date');
  });
});

describe('formatDay', () => {
  const now = new Date(2026, 10, 21, 15, 0, 0);
  it('names adjacent days', () => {
    expect(formatDay(new Date(2026, 10, 21, 9, 0).toISOString(), now)).toBe('Today');
    expect(formatDay(new Date(2026, 10, 20, 9, 0).toISOString(), now)).toBe('Yesterday');
    expect(formatDay(new Date(2026, 10, 22, 9, 0).toISOString(), now)).toBe('Tomorrow');
    expect(formatDay(new Date(2026, 10, 27, 9, 0).toISOString(), now)).toContain('27');
  });
});

describe('formatTimeRange', () => {
  it('renders both local times around an en dash', () => {
    const start = new Date(2026, 10, 21, 9, 0).toISOString();
    const end = new Date(2026, 10, 21, 10, 30).toISOString();
    const out = formatTimeRange(start, end);
    const [a, b] = out.split('–').map((x) => x.trim());
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('never leaks a raw ISO string', () => {
    const start = '2026-11-21T09:00:00.000Z';
    expect(formatTimeRange(start, '2026-11-21T10:00:00.000Z')).not.toContain('2026-11-21T09');
  });
});
