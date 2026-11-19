import { describe, it, expect } from 'vitest';
import { formatOffset, hostOf, nearestSnapshot, snapshotOffsetSec } from '../../src/lib/snapshots.js';

describe('snapshot timing helpers', () => {
  it('computes offsets on the recording clock and never goes negative', () => {
    expect(snapshotOffsetSec(1_000, 193_250)).toBe(192.3);
    expect(snapshotOffsetSec(5_000, 1_000)).toBe(0);
  });
  it('finds the nearest snapshot within the allowed gap only', () => {
    const snaps = [{ offsetSec: 10 }, { offsetSec: 100 }, { offsetSec: 130 }];
    expect(nearestSnapshot(snaps, 95)).toEqual({ offsetSec: 100 });
    expect(nearestSnapshot(snaps, 118, 30)).toEqual({ offsetSec: 130 });
    expect(nearestSnapshot(snaps, 60, 30)).toBeNull();
    expect(nearestSnapshot([], 0)).toBeNull();
  });
  it('formats offsets and strips URLs down to the host', () => {
    expect(formatOffset(192.9)).toBe('03:12');
    expect(hostOf('https://meet.google.com/abc-defg-hij?authuser=1')).toBe('meet.google.com');
    expect(hostOf('chrome://extensions')).toBe('extensions');
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });
});
