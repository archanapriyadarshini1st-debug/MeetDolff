/**
 * Pure helpers linking screenshots to transcript time.
 * Offsets use the same wall-clock-since-start clock as live transcript
 * segments, so a snapshot at 03:12 lines up with the segment at 03:12.
 */

import type { MeetingSnapshot } from './types.js';

export const MAX_SNAPSHOTS_PER_RECORDING = 120;

export function snapshotOffsetSec(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.round(((nowMs - startedAtMs) / 1000) * 10) / 10);
}

type Timed = Pick<MeetingSnapshot, 'offsetSec'>;

/** The snapshot closest in time to `atSec`, or null if none is within `maxGapSec`. */
export function nearestSnapshot<T extends Timed>(snapshots: T[], atSec: number, maxGapSec = 30): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const s of snapshots) {
    const gap = Math.abs(s.offsetSec - atSec);
    if (gap <= maxGapSec && gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

export function formatOffset(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}
