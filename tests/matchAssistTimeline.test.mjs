import assert from 'node:assert/strict';
import test from 'node:test';
import { pairMatchAssists } from '../src/utils/matchAssistTimeline.ts';

const goal = { id: 1, event_type: 'goal', minute: 0, team_id: 3, player_id: 8 };
const assist = { id: 2, event_type: 'assist', minute: '0', team_id: '3', player_id: 9 };

test('orders a late-entered assist before its goal, including minute zero', () => {
  const result = pairMatchAssists([goal, assist]);
  assert.deepEqual(result.timeline, [assist, goal]);
  assert.equal(result.assistsByGoal.get(goal.id), assist);
});

test('does not attach an assist to the wrong team, minute, scorer, or ambiguous goal', () => {
  for (const changed of [
    { ...assist, team_id: 4 },
    { ...assist, minute: 1 },
    { ...assist, player_id: '8' },
  ]) {
    assert.equal(pairMatchAssists([goal, changed]).assistsByGoal.size, 0);
  }
  assert.equal(pairMatchAssists([goal, assist, { ...goal, id: 3 }]).assistsByGoal.size, 0);
});
