import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchTimerSnapshot } from '../utils/matchTimer';

export const TIMER_ROW_COLUMNS = 'id, organization_id, status, timer_seconds, timer_started_at, is_timer_running, updated_at, home_score, away_score';
const SNAPSHOT_FIELDS = ['status', 'timer_seconds', 'timer_started_at', 'is_timer_running'] as const;

export async function writeMatchTimer(db: SupabaseClient, orgId: number, snapshot: MatchTimerSnapshot, values: Record<string, unknown>) {
  let update = db.from('matches').update(values).eq('id', snapshot.id).eq('organization_id', orgId);
  // A delayed tap can only update the same timer command the operator saw.
  for (const field of SNAPSHOT_FIELDS) {
    const expected = snapshot[field];
    update = expected == null ? update.is(field, null) : update.eq(field, expected);
  }
  const { data, error } = await update.select(TIMER_ROW_COLUMNS).maybeSingle();
  if (error) throw error;
  return data;
}

type TimerWriteResult =
  | { kind: 'saved'; row: Awaited<ReturnType<typeof writeMatchTimer>> }
  | { kind: 'conflict' | 'denied' };

export async function writeMatchTimerWithRefresh<T extends MatchTimerSnapshot>(
  snapshot: T,
  write: (row: T) => ReturnType<typeof writeMatchTimer>,
  refresh: () => Promise<T | null>,
  canRetry: (fresh: T) => boolean,
): Promise<TimerWriteResult> {
  const saved = await write(snapshot);
  if (saved) return { kind: 'saved', row: saved };

  const fresh = await refresh();
  if (!fresh || String(fresh.id) !== String(snapshot.id) || fresh.status !== snapshot.status) {
    return { kind: 'conflict' };
  }
  if (!canRetry(fresh)) {
    return { kind: 'conflict' };
  }
  if (SNAPSHOT_FIELDS.every(field => (fresh[field] ?? null) === (snapshot[field] ?? null))) {
    return { kind: 'denied' };
  }

  const retried = await write(fresh);
  if (retried) return { kind: 'saved', row: retried };
  const latest = await refresh();
  return latest && SNAPSHOT_FIELDS.every(field => (latest[field] ?? null) === (fresh[field] ?? null))
    ? { kind: 'denied' }
    : { kind: 'conflict' };
}
