import { useCallback, useEffect, useState } from 'react';

export type MatchTimerSnapshot = {
  id: string | number;
  status?: string | null;
  timer_seconds?: number | string | null;
  timer_started_at?: string | null;
  is_timer_running?: boolean | string | null;
};

const SERVER_CLOCK_URL = 'https://hfl-forma-admin.vercel.app/api/server-time';

const WAITING = new Set(['scheduled', 'not_started', 'pending', 'upcoming']);
const BREAK = new Set(['half_time', 'break']);

export function canRunMatchTimer(status: MatchTimerSnapshot['status']) {
  return Boolean(status && !WAITING.has(status) && !BREAK.has(status) && status !== 'finished');
}

export function parseTimerStartMs(timestamp: MatchTimerSnapshot['timer_started_at']) {
  if (!timestamp) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(timestamp)
    ? timestamp.replace(' ', 'T') + 'Z' : timestamp;
  return Date.parse(iso);
}

export function isRunningTimerSnapshot(match: MatchTimerSnapshot | null | undefined) {
  return (match?.is_timer_running === true || match?.is_timer_running === 'true') &&
    canRunMatchTimer(match.status) && Number.isFinite(parseTimerStartMs(match.timer_started_at));
}

export function getRemainingSeconds(match: MatchTimerSnapshot | null | undefined, halfSeconds: number, nowMs: number | null) {
  const value = Number(match?.timer_seconds);
  const base = match?.timer_seconds == null || !Number.isFinite(value) || value < 0 ||
    (value === 0 && WAITING.has(match.status ?? '')) ? halfSeconds : Math.floor(value);
  if (nowMs == null || !isRunningTimerSnapshot(match)) return base;
  return Math.max(0, base - Math.max(0, Math.floor((nowMs - parseTimerStartMs(match?.timer_started_at)) / 1000)));
}

export function getElapsedMatchSeconds(status: MatchTimerSnapshot['status'], remaining: number, halfSeconds: number) {
  if (!status || WAITING.has(status)) return 0;
  if (BREAK.has(status)) return halfSeconds;
  if (status === 'finished') return halfSeconds * 2;
  const elapsed = Math.max(0, halfSeconds - remaining);
  return status === 'second_half' || status === 'extra_time' ? halfSeconds + elapsed : elapsed;
}

export function getStreamField(location: unknown) {
  const label = String(location ?? '').toLowerCase();
  return Number(label.match(/(?:^|[^0-9])([1-4])(?![0-9])/)?.[1] ?? 1);
}

let serverTimeAtSync: number | null = null;
let monotonicAtSync = 0;
let pendingSync: Promise<void> | null = null;

export function serverNowMs() {
  return serverTimeAtSync == null ? null : serverTimeAtSync + performance.now() - monotonicAtSync;
}

export function syncServerClock(url = SERVER_CLOCK_URL) {
  if (pendingSync) return pendingSync;

  pendingSync = (async () => {
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url + '?request=' + Date.now(), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Server vaqtini olib bo‘lmadi');
      const { now } = await response.json();
      const received = performance.now();
      if (typeof now !== 'number' || !Number.isFinite(now) || now <= 0) {
        throw new Error('Server vaqti noto‘g‘ri');
      }
      serverTimeAtSync = now + (received - started) / 2;
      monotonicAtSync = received;
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => { pendingSync = null; });

  return pendingSync;
}

export function useMatchTimer(match: MatchTimerSnapshot | null, halfSeconds: number, clockUrl = SERVER_CLOCK_URL) {
  const { id, status, timer_seconds: seconds, timer_started_at: startedAt, is_timer_running: runningFlag } = match ?? {};
  const snapshot = id == null ? null : { id, status, timer_seconds: seconds, timer_started_at: startedAt, is_timer_running: runningFlag };
  const running = isRunningTimerSnapshot(snapshot);
  const [sample, setSample] = useState<{ read: () => number; seconds: number; clockSynced: boolean } | null>(null);
  const read = useCallback(() => getRemainingSeconds(
    id == null ? null : { id, status, timer_seconds: seconds, timer_started_at: startedAt, is_timer_running: runningFlag },
    halfSeconds, serverNowMs(),
  ), [id, status, seconds, startedAt, runningFlag, halfSeconds]);

  useEffect(() => {
    const sync = () => { void syncServerClock(clockUrl).catch(() => {}); };
    sync();
    const interval = setInterval(sync, 60_000);
    return () => clearInterval(interval);
  }, [clockUrl]);
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const seconds = read();
      const clockSynced = serverNowMs() != null;
      setSample(previous => previous?.read === read && previous.seconds === seconds && previous.clockSynced === clockSynced
        ? previous : { read, seconds, clockSynced });
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [running, read]);

  const timerSeconds = running && sample?.read === read ? sample.seconds : read();
  return { timerSeconds, isTimerRunning: running && timerSeconds > 0, isClockSynced: serverNowMs() != null };
}

export function getPauseSeconds(displayed: number, current: number) {
  return Math.abs(displayed - current) <= 2 ? displayed : null;
}
