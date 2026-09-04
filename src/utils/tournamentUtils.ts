import { supabase } from '../supabaseClient';

export interface StageOption {
  value: string;
  label: string;
}

export const STAGES: StageOption[] = [
  { value: 'group', label: 'Guruh bosqichi' },
  { value: 'round_of_32', label: '1/16 Final' },
  { value: 'round_of_16', label: '1/8 Final' },
  { value: 'quarterfinal', label: 'Chorak Final (1/4)' },
  { value: 'semifinal', label: 'Yarim Final (1/2)' },
  { value: 'final', label: 'Final' },
];

export const STAGE_LABELS: Record<string, string> = {
  group: 'TUR',
  round_of_32: '1/16 FINAL',
  round_of_16: '1/8 FINAL',
  quarterfinal: 'CHORAK FINAL (1/4)',
  semifinal: 'YARIM FINAL',
  final: 'FINAL',
};

/**
 * Stage va round asosida to'liq bosqich sarlavhasini qaytaradi.
 * Masalan: stage='semifinal' bo'lsa "YARIM FINAL", stage='group', round=3 bo'lsa "3-TUR".
 */
export function getStageDisplayTitle(stage?: string | null, round?: number | string | null): string {
  if (!stage || stage === 'group') {
    return round ? `${round}-TUR` : 'GURUH BOSQICHI';
  }
  return STAGE_LABELS[stage] || stage.toUpperCase();
}

const STAGE_ORDER: Record<string, number> = {
  group: 0,
  round_of_32: 1,
  round_of_16: 2,
  quarterfinal: 3,
  semifinal: 4,
  final: 5,
};

/**
 * Bosqichlarni tabiiy tartibda (guruh turlari -> pleyoff) taqqoslash uchun sonli kalit.
 */
export function getStageSortKey(stage?: string | null, round?: number | string | null): number {
  const stageKey = stage || 'group';
  const stageIndex = STAGE_ORDER[stageKey] ?? 0;
  const roundNum = stageKey === 'group' ? (Number(round) || 0) : 0;
  return stageIndex * 1000 + roundNum;
}

/**
 * Bitta stage+round kombinatsiyasi uchun unikal kalit (filtr uchun).
 */
export function getStageOptionKey(stage?: string | null, round?: number | string | null): string {
  const stageKey = stage || 'group';
  const roundKey = stageKey === 'group' ? (round ?? '') : '';
  return `${stageKey}::${roundKey}`;
}

export interface TournamentStageOption {
  key: string;
  stage: string;
  round: number | string | null;
  label: string;
}

/**
 * Berilgan o'yinlar ro'yxatidan (faqat stage/round maydonlari kifoya) unikal bosqich
 * variantlarini, tabiiy tartibda (1-tur, 2-tur, ..., Chorak final, Yarim final, Final)
 * qaytaradi. Ro'yxatning oxirgi elementi — eng so'nggi (joriy) bosqich hisoblanadi.
 */
export function getTournamentRoundOptions(
  rows: Array<{ stage?: string | null; round?: number | string | null }> = []
): TournamentStageOption[] {
  const map = new Map<string, TournamentStageOption & { sortKey: number }>();
  rows.forEach((m) => {
    const stageKey = m.stage || 'group';
    const roundVal = stageKey === 'group' ? (m.round ?? null) : null;
    const key = getStageOptionKey(m.stage, m.round);
    if (!map.has(key)) {
      map.set(key, {
        key,
        stage: stageKey,
        round: roundVal,
        label: getStageDisplayTitle(m.stage, m.round),
        sortKey: getStageSortKey(m.stage, m.round),
      });
    }
  });
  return Array.from(map.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey, ...rest }) => rest);
}

/**
 * Tashkilotga tegishli barcha faol turnirlarni yuklaydi:
 * 1. O'zi yaratgan turnirlar
 * 2. Qabul qilingan hamkorlik (cohost) turnirlari
 */
export async function getActiveOrgTournaments(orgId: string | number) {
  if (!orgId) return [];
  try {
    // 1. O'z turnirlari
    const { data: ownTournaments, error: ownErr } = await supabase
      .from('tournaments')
      .select('*, organization:organization_id (id, name, logo_url)')
      .eq('organization_id', orgId)
      .order('id', { ascending: true });

    if (ownErr) {
      console.warn('Error fetching own tournaments:', ownErr.message);
    }

    // 2. Hamkorlik turnirlari
    const [asReceiver, asSender] = await Promise.all([
      supabase
        .from('tournament_cohosts')
        .select('*, tournament:tournament_id (*), sender_org:sender_org_id (id, name, logo_url), receiver_org:receiver_org_id (id, name, logo_url)')
        .eq('receiver_org_id', orgId)
        .eq('status', 'accepted'),
      supabase
        .from('tournament_cohosts')
        .select('*, tournament:tournament_id (*), sender_org:sender_org_id (id, name, logo_url), receiver_org:receiver_org_id (id, name, logo_url)')
        .eq('sender_org_id', orgId)
        .eq('status', 'accepted'),
    ]);

    const collabTournaments: any[] = [];
    const processCollab = (c: any) => {
      if (!c.tournament) return;
      collabTournaments.push({
        ...c.tournament,
        isCollab: true,
        org1: c.sender_org,
        org2: c.receiver_org,
      });
    };

    (asReceiver.data || []).forEach(processCollab);
    (asSender.data || []).forEach(processCollab);

    const map = new Map();
    (ownTournaments || []).forEach((t: any) => map.set(t.id, { ...t, isOwn: true }));
    collabTournaments.forEach((t: any) => {
      if (!map.has(t.id)) {
        map.set(t.id, { ...t, isOwn: false });
      }
    });

    return Array.from(map.values());
  } catch (err) {
    console.error('Error fetching org tournaments:', err);
    return [];
  }
}

/**
 * Turnirga biriktirilgan ligalarni yuklaydi
 */
export async function getTournamentLeagues(tournamentId: string | number) {
  if (!tournamentId) return [];
  try {
    const { data, error } = await supabase
      .from('tournament_leagues')
      .select('*, league:league_id (*)')
      .eq('tournament_id', tournamentId);

    if (error) {
      console.warn('Error fetching tournament leagues:', error.message);
      return [];
    }

    return (data || []).map((item: any) => item.league).filter(Boolean);
  } catch (err) {
    console.error('Error fetching tournament leagues:', err);
    return [];
  }
}

/**
 * Turnirga biriktirilgan ligalardan jamoalarni teams.league matn maydoni orqali aniqlaydi.
 * teams.league = "LigaA, LigaB" kabi vergul bilan ajratilgan matn.
 * Har qanday jamoa takrorlanmasligi ta'minlanadi.
 */
export function getTournamentTeams(tournamentLeagues: any[], allTeams: any[] = []) {
  if (!tournamentLeagues || tournamentLeagues.length === 0 || !allTeams || allTeams.length === 0) {
    return [];
  }

  const leagueNames = tournamentLeagues
    .map((l: any) => (typeof l === 'string' ? l : l.name))
    .filter(Boolean)
    .map((name: string) => name.trim().toLowerCase());

  const matchingTeamsMap = new Map();

  allTeams.forEach((team: any) => {
    if (!team.league) return;
    const teamLeagues = team.league
      .split(',')
      .map((item: string) => item.trim().toLowerCase());

    const isMatch = teamLeagues.some((tl: string) => leagueNames.includes(tl));
    if (isMatch && !matchingTeamsMap.has(team.id)) {
      matchingTeamsMap.set(team.id, team);
    }
  });

  return Array.from(matchingTeamsMap.values());
}
