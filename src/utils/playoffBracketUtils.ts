export interface BracketSlotTeam {
  id: any;
  name: string;
  logo_url?: string | null;
  score?: number | null;
  penalty_score?: number | null;
  isWinner?: boolean;
  isLoser?: boolean;
}

export interface BracketMatch {
  id?: any;
  stage: 'quarterfinal' | 'semifinal' | 'final';
  match_date?: string;
  match_time?: string;
  location?: string;
  status: 'scheduled' | 'finished' | 'live' | 'pending';
  team1?: BracketSlotTeam | null;
  team2?: BracketSlotTeam | null;
  winnerTeamId?: any;
}

export interface PlayoffBracketData {
  qf: [BracketMatch, BracketMatch, BracketMatch, BracketMatch]; // 4 matches (0,1 left; 2,3 right)
  sf: [BracketMatch, BracketMatch];                             // 2 matches (0 left; 1 right)
  final: BracketMatch;                                          // 1 match (center)
  champion?: BracketSlotTeam | null;
  hasPlayoffMatches: boolean;
}

const resolveWinner = (m: any): { winnerId: any; loserId: any; isFinished: boolean } => {
  if (!m) return { winnerId: null, loserId: null, isFinished: false };
  const isFinished = m.status === 'finished' || (m.home_score !== null && m.away_score !== null && m.home_score !== undefined && m.away_score !== undefined);
  if (!isFinished) return { winnerId: null, loserId: null, isFinished: false };

  const hScore = Number(m.home_score || 0);
  const aScore = Number(m.away_score || 0);

  if (hScore > aScore) {
    return { winnerId: m.home_team_id, loserId: m.away_team_id, isFinished: true };
  } else if (aScore > hScore) {
    return { winnerId: m.away_team_id, loserId: m.home_team_id, isFinished: true };
  } else {
    // Penalties fallback
    const hPen = Number(m.home_penalty_score || 0);
    const aPen = Number(m.away_penalty_score || 0);
    if (hPen > aPen) {
      return { winnerId: m.home_team_id, loserId: m.away_team_id, isFinished: true };
    } else if (aPen > hPen) {
      return { winnerId: m.away_team_id, loserId: m.home_team_id, isFinished: true };
    }
    return { winnerId: null, loserId: null, isFinished: true };
  }
};

const makeSlotTeam = (teamObj: any, score?: number | null, penScore?: number | null, isWinner?: boolean, isLoser?: boolean): BracketSlotTeam | null => {
  if (!teamObj) return null;
  return {
    id: teamObj.id,
    name: teamObj.name || 'Jamoa',
    logo_url: teamObj.logo_url || null,
    score: score !== undefined ? score : null,
    penalty_score: penScore !== undefined ? penScore : null,
    isWinner: !!isWinner,
    isLoser: !!isLoser,
  };
};

/**
 * Builds standard 8-team Playoff Bracket (1/4 -> 1/2 -> Final)
 */
export const buildPlayoffBracket = (
  matches: any[] = [],
  teams: any[] = []
): PlayoffBracketData => {
  const teamMap = new Map<any, any>();
  teams.forEach((t) => teamMap.set(String(t.id), t));

  const qfMatches = matches.filter((m) => m.stage === 'quarterfinal');
  const sfMatches = matches.filter((m) => m.stage === 'semifinal');
  const finalMatches = matches.filter((m) => m.stage === 'final');

  const hasPlayoffMatches = qfMatches.length > 0 || sfMatches.length > 0 || finalMatches.length > 0;

  // Helper to construct BracketMatch from DB match
  const parseMatch = (raw?: any, expectedStage: 'quarterfinal' | 'semifinal' | 'final' = 'quarterfinal'): BracketMatch => {
    if (!raw) {
      return {
        stage: expectedStage,
        status: 'pending',
        team1: null,
        team2: null,
      };
    }

    const { winnerId, loserId, isFinished } = resolveWinner(raw);
    const homeTeam = teamMap.get(String(raw.home_team_id)) || raw.home_team || raw.home_team_data || { id: raw.home_team_id, name: 'Jamoa 1' };
    const awayTeam = teamMap.get(String(raw.away_team_id)) || raw.away_team || raw.away_team_data || { id: raw.away_team_id, name: 'Jamoa 2' };

    const t1 = raw.home_team_id ? makeSlotTeam(
      homeTeam,
      raw.home_score,
      raw.home_penalty_score,
      isFinished && winnerId && String(winnerId) === String(raw.home_team_id),
      isFinished && loserId && String(loserId) === String(raw.home_team_id)
    ) : null;

    const t2 = raw.away_team_id ? makeSlotTeam(
      awayTeam,
      raw.away_score,
      raw.away_penalty_score,
      isFinished && winnerId && String(winnerId) === String(raw.away_team_id),
      isFinished && loserId && String(loserId) === String(raw.away_team_id)
    ) : null;

    return {
      id: raw.id,
      stage: expectedStage,
      match_date: raw.match_date,
      match_time: raw.match_time,
      location: raw.location,
      status: isFinished ? 'finished' : (raw.status || 'scheduled'),
      team1: t1,
      team2: t2,
      winnerTeamId: winnerId,
    };
  };

  // 1. QF Matches (4 slots: 0, 1 on Left Wing; 2, 3 on Right Wing)
  const qf: [BracketMatch, BracketMatch, BracketMatch, BracketMatch] = [
    parseMatch(qfMatches[0], 'quarterfinal'),
    parseMatch(qfMatches[1], 'quarterfinal'),
    parseMatch(qfMatches[2], 'quarterfinal'),
    parseMatch(qfMatches[3], 'quarterfinal'),
  ];

  // 2. Semifinals (2 slots: 0 on Left Wing; 1 on Right Wing)
  let sf1 = parseMatch(sfMatches[0], 'semifinal');
  let sf2 = parseMatch(sfMatches[1], 'semifinal');

  // Auto-project QF winners into Semifinals if SF match isn't explicitly configured with teams yet
  if (!sf1.team1 && qf[0].winnerTeamId) {
    const winnerObj = teamMap.get(String(qf[0].winnerTeamId));
    if (winnerObj) sf1.team1 = makeSlotTeam(winnerObj);
  }
  if (!sf1.team2 && qf[1].winnerTeamId) {
    const winnerObj = teamMap.get(String(qf[1].winnerTeamId));
    if (winnerObj) sf1.team2 = makeSlotTeam(winnerObj);
  }
  if (!sf2.team1 && qf[2].winnerTeamId) {
    const winnerObj = teamMap.get(String(qf[2].winnerTeamId));
    if (winnerObj) sf2.team1 = makeSlotTeam(winnerObj);
  }
  if (!sf2.team2 && qf[3].winnerTeamId) {
    const winnerObj = teamMap.get(String(qf[3].winnerTeamId));
    if (winnerObj) sf2.team2 = makeSlotTeam(winnerObj);
  }

  // 3. Final (Center)
  let finalMatch = parseMatch(finalMatches[0], 'final');

  // Auto-project SF winners into Final if not explicitly set
  if (!finalMatch.team1 && sf1.winnerTeamId) {
    const winnerObj = teamMap.get(String(sf1.winnerTeamId));
    if (winnerObj) finalMatch.team1 = makeSlotTeam(winnerObj);
  }
  if (!finalMatch.team2 && sf2.winnerTeamId) {
    const winnerObj = teamMap.get(String(sf2.winnerTeamId));
    if (winnerObj) finalMatch.team2 = makeSlotTeam(winnerObj);
  }

  // 4. Champion (if Final is finished)
  let champion: BracketSlotTeam | null = null;
  if (finalMatch.winnerTeamId) {
    const champObj = teamMap.get(String(finalMatch.winnerTeamId));
    if (champObj) {
      champion = makeSlotTeam(champObj, null, null, true, false);
    }
  }

  return {
    qf,
    sf: [sf1, sf2],
    final: finalMatch,
    champion,
    hasPlayoffMatches,
  };
};

/**
 * Filter parent tournament standings to extract teams for a 2nd-tier tournament
 * e.g. ranks 9 to 16 for Europa League
 */
export const getLinkedTournamentTeams = (
  parentStandings: any[] = [],
  fromRank: number = 9,
  toRank: number = 16
): any[] => {
  if (!parentStandings || parentStandings.length === 0) return [];
  return parentStandings.slice(fromRank - 1, toRank);
};
