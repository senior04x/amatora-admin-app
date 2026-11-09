import test from 'node:test';
import assert from 'node:assert/strict';
import { getElapsedMatchSeconds, getRemainingSeconds } from '../src/utils/matchTimer.ts';
import { getHalfDurationSeconds, loadMatchCompetition } from '../src/utils/matchDuration.ts';
import { createClient } from '@supabase/supabase-js';
import { getPauseSeconds } from '../src/utils/matchTimer.ts';
import { writeMatchTimer, writeMatchTimerWithRefresh } from '../src/api/matchTimer.ts';

const half = 25 * 60;
const start = Date.parse('2026-11-09T12:00:00Z');
const live = { id: 'fixture', status: 'first_half', timer_seconds: half, timer_started_at: '2026-11-09 12:00:00', is_timer_running: true };

test('uses the same countdown snapshot for an elapsed display', () => {
  const now = start + 5 * 60_000;
  assert.equal(getRemainingSeconds(live, half, now), 1200);
  assert.equal(getElapsedMatchSeconds(live.status, getRemainingSeconds(live, half, now), half), 300);
  const paused = { ...live, timer_seconds: 1200, timer_started_at: null, is_timer_running: false };
  assert.equal(getRemainingSeconds(paused, half, now + 30_000), 1200);
  const resumed = { ...paused, timer_started_at: new Date(now + 30_000).toISOString(), is_timer_running: true };
  assert.equal(getRemainingSeconds(resumed, half, now + 32_000), 1198);
  assert.equal(getRemainingSeconds(live, half, start + 35 * 60_000), 0);
  assert.equal(getRemainingSeconds({ ...paused, timer_seconds: 0 }, half, now), 0);
  assert.equal(getElapsedMatchSeconds('half_time', 1200, half), 1500);
  assert.equal(getElapsedMatchSeconds('second_half', half, half), 1500);
  assert.equal(getElapsedMatchSeconds('second_half', 0, half), 3000);
});

test('holds saved time when legacy running rows lack a valid start', () => {
  for (const timer_started_at of [null, 'invalid']) {
    assert.equal(getRemainingSeconds({ ...live, timer_seconds: 900, timer_started_at }, half, start + 1_000_000), 900);
  }
  assert.equal(getRemainingSeconds(live, half, null), half);
  assert.equal(getRemainingSeconds({ ...live, status: 'break', timer_seconds: 900 }, half, start + 1_000_000), 900);
  assert.equal(getRemainingSeconds({ ...live, status: 'scheduled', timer_seconds: 0 }, half, start), half);
});

test('uses the saved league duration and the tournament override', async () => {
  const tables = { leagues: { id: 6 }, sponsors: { logo_url: '50' }, tournaments: { match_duration: 41 } };
  const db = { from(table) {
    return {
      select() { return this; },
      ilike() { return this; },
      eq(column, value) {
        if (table === 'sponsors') assert.equal(value, 'LEAGUE_DURATION_6');
        if (table === 'leagues') assert.equal(value, 1);
        return this;
      },
      async maybeSingle() { return { data: tables[table], error: null }; },
    };
  } };
  const match = { organization_id: 1, league: '7x7 liga' };
  const { league } = await loadMatchCompetition(db, match);
  assert.equal(getHalfDurationSeconds(match, league), 1500);
  const tournament = await loadMatchCompetition(db, { ...match, tournament_id: 7 });
  assert.equal(getHalfDurationSeconds({ half_duration: 25 }, tournament.league, tournament.tournamentDuration), 1260);
});


test('pauses at the displayed second and rejects a stale display', () => {
  assert.equal(getPauseSeconds(1492, 1491), 1492);
  assert.equal(getPauseSeconds(1492, 1200), null);
  assert.equal(getPauseSeconds(0, 0), 0);
});

test('writes only the same organization and timer snapshot, and returns the saved row', async () => {
  const pause = { timer_seconds: 0, timer_started_at: null, is_timer_running: false };
  let response = [{ id: 'fixture', ...pause }];
  let responseStatus = 200;
  const db = createClient('https://example.test', 'mock-key', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const params = new URL(input).searchParams;
      assert.equal(init.method, 'PATCH');
      assert.equal(params.get('id'), 'eq.fixture');
      assert.equal(params.get('organization_id'), 'eq.1');
      assert.equal(params.get('status'), 'eq.first_half');
      assert.equal(params.get('timer_seconds'), 'eq.1500');
      assert.equal(params.get('timer_started_at'), 'is.null');
      assert.equal(params.get('is_timer_running'), 'eq.true');
      assert.deepEqual(JSON.parse(init.body), pause);
      return Response.json(response, { status: responseStatus });
    } },
  });
  const snapshot = { ...live, timer_started_at: null };
  assert.deepEqual(await writeMatchTimer(db, 1, snapshot, pause), response[0]);
  response = [];
  assert.equal(await writeMatchTimer(db, 1, snapshot, pause), null);
  response = { message: 'Permission denied' };
  responseStatus = 403;
  await assert.rejects(writeMatchTimer(db, 1, snapshot, pause), { message: 'Permission denied' });
});

test('retries against the latest timer once without reversing another device’s action', async () => {
  const fresh = { ...live, timer_seconds: 1440 };
  const paused = { ...fresh, is_timer_running: false, timer_started_at: null };
  const writes = [];
  const write = async snapshot => {
    writes.push(snapshot);
    return snapshot === fresh ? paused : null;
  };
  const sameIntent = snapshot => snapshot.is_timer_running === live.is_timer_running;

  assert.deepEqual(await writeMatchTimerWithRefresh(live, write, async () => fresh, sameIntent), {
    kind: 'saved', row: paused,
  });
  assert.deepEqual(writes.splice(0), [live, fresh]);

  assert.deepEqual(await writeMatchTimerWithRefresh(live, write, async () => paused, sameIntent), { kind: 'conflict' });
  assert.deepEqual(writes.splice(0), [live]);
  assert.deepEqual(await writeMatchTimerWithRefresh(live, write, async () => ({ ...fresh, status: 'half_time' }), () => true), { kind: 'conflict' });
  assert.deepEqual(writes.splice(0), [live]);
  assert.deepEqual(await writeMatchTimerWithRefresh(live, write, async () => ({ ...live }), sameIntent), { kind: 'denied' });
  assert.deepEqual(writes, [live]);
});
