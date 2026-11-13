type TimelineEvent = {
  id: string | number;
  event_type?: string;
  type?: string;
  team_id?: string | number | null;
  player_id?: string | number | null;
  minute?: string | number | null;
};

export function pairMatchAssists<T extends TimelineEvent>(events: T[]) {
  const groups = new Map<string, { goals: T[]; assists: T[] }>();
  for (const event of events) {
    const type = event.event_type || event.type;
    if ((type !== 'goal' && type !== 'assist') || event.team_id == null ||
      event.minute == null || String(event.minute).trim() === '') continue;
    const minute = Number(event.minute);
    if (!Number.isInteger(minute) || minute < 0) continue;
    const key = JSON.stringify([String(event.team_id), minute]);
    const group = groups.get(key) ?? { goals: [], assists: [] };
    (type === 'goal' ? group.goals : group.assists).push(event);
    groups.set(key, group);
  }

  const assistsByGoal = new Map<T['id'], T>();
  const linkedAssists = new Set<T['id']>();
  for (const { goals, assists } of groups.values()) {
    if (goals.length !== 1 || assists.length !== 1) continue;
    const [goal] = goals;
    const [assist] = assists;
    if (goal.player_id == null || assist.player_id == null ||
      String(goal.player_id) === String(assist.player_id)) continue;
    assistsByGoal.set(goal.id, assist);
    linkedAssists.add(assist.id);
  }

  const timeline = events.flatMap(event => {
    if (linkedAssists.has(event.id)) return [];
    const assist = assistsByGoal.get(event.id);
    return assist ? [assist, event] : [event];
  });
  return { timeline, assistsByGoal };
}
