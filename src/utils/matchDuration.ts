import type { SupabaseClient } from '@supabase/supabase-js';

type DurationFields = {
  match_duration?: number | string | null;
  half_duration?: number | string | null;
};

type MatchCompetition = DurationFields & {
  organization_id?: string | number | null;
  tournament_id?: string | number | null;
  league?: string | null;
};

type League = DurationFields & {
  id: string | number;
  half_minutes?: number | string | null;
  export_bg_url?: string;
  background_url?: string;
  bg_url?: string;
  banner_url?: string;
};

const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export async function loadMatchCompetition(db: SupabaseClient, match: MatchCompetition) {
  const loadTournament = async () => {
    if (!match.tournament_id) return 0;
    const { data, error } = await db.from('tournaments').select('match_duration')
      .eq('id', match.tournament_id).maybeSingle();
    if (error) throw error;
    return positive(data?.match_duration);
  };

  const loadLeague = async () => {
    const name = match.league?.trim();
    if (!name) return null;
    const pattern = name.replace(/[\\%_]/g, '\\$&');
    const orgId = match.organization_id;
    let query = db.from('leagues').select('*').ilike('name', pattern);
    if (orgId != null) query = query.eq('organization_id', orgId);
    const { data, error } = await query.maybeSingle<League>();
    if (error) throw error;
    let league = data;

    if (!league && orgId != null) {
      const { data: collaborations, error: collabError } = await db.from('league_collabs')
        .select('league:league_id!inner(*)')
        .eq('status', 'accepted')
        .or('sender_org_id.eq.' + orgId + ',receiver_org_id.eq.' + orgId)
        .ilike('league.name', pattern)
        .returns<{ league: League | null }[]>();
      if (collabError) throw collabError;
      const shared = new Map((collaborations ?? []).flatMap(({ league }) => league ? [[league.id, league]] : []));
      if (shared.size === 1) league = shared.values().next().value ?? null;
    }

    if (!league || positive(league.half_duration) || positive(league.half_minutes) || positive(league.match_duration)) {
      return league;
    }

    const { data: duration, error: durationError } = await db.from('sponsors').select('logo_url')
      .eq('name', 'LEAGUE_DURATION_' + league.id).maybeSingle();
    if (durationError) throw durationError;
    return { ...league, match_duration: positive(duration?.logo_url) };
  };

  const [tournamentDuration, league] = await Promise.all([loadTournament(), loadLeague()]);
  return { tournamentDuration, league };
}

export function getHalfDurationSeconds(match: DurationFields | null, league?: League | null, tournamentDuration = 0) {
  const tournamentHalf = Math.round(positive(tournamentDuration) / 2);
  const matchHalf = positive(match?.half_duration) || Math.round(positive(match?.match_duration) / 2);
  const leagueHalf = positive(league?.half_duration) || positive(league?.half_minutes) ||
    Math.round(positive(league?.match_duration) / 2);
  return Math.round((tournamentHalf || matchHalf || leagueHalf || 30) * 60);
}
