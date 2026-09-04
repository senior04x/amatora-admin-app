/**
 * Grouped Query Key factories for deterministic cache management & invalidation.
 */
export const queryKeys = {
  dashboard: (orgId: any) => ['dashboard', Number(orgId) || 1] as const,
  
  players: (
    orgId: any,
    search: string = '',
    page: number = 0,
    pageSize: number = 25,
    archived: boolean = false,
    league: string = 'all',
    teamId: string = 'all',
    collabLeagueNames: string[] = []
  ) => [
    'players',
    Number(orgId) || 1,
    search.trim(),
    page,
    pageSize,
    archived,
    league,
    teamId,
    (collabLeagueNames || []).sort().join(','),
  ] as const,
  
  teams: (orgId: any, collabLeagueNames: string[] = []) => 
    ['teams', Number(orgId) || 1, (collabLeagueNames || []).sort().join(',')] as const,

  paginatedTeams: (
    orgId: any,
    search: string = '',
    page: number = 0,
    pageSize: number = 10,
    league: string = 'all',
    collabLeagueNames: string[] = []
  ) =>
    [
      'paginatedTeams',
      Number(orgId) || 1,
      search.trim(),
      page,
      pageSize,
      league,
      (collabLeagueNames || []).sort().join(','),
    ] as const,
  
  applications: (
    orgId: any,
    tab: 'players' | 'teams' = 'players',
    status: string = 'all',
    league: string = 'all',
    page: number = 0,
    pageSize: number = 15
  ) => [
    'applications',
    Number(orgId) || 1,
    tab,
    status,
    league,
    page,
    pageSize,
  ] as const,

  applicationsCounts: (orgId: any, tab: 'players' | 'teams' = 'players') =>
    ['applicationsCounts', Number(orgId) || 1, tab] as const,

  teamRoster: (orgId: any, teamId: any) =>
    ['teamRoster', Number(orgId) || 1, String(teamId)] as const,
  
  matches: (orgId: any, leagueName: string = 'all', collabLeagueNames: string[] = []) => 
    ['matches', Number(orgId) || 1, leagueName, (collabLeagueNames || []).sort().join(',')] as const,
  
  finishedMatches: (orgId: any, leagueName: string = 'all', page: number = 0, pageSize: number = 15, collabLeagueNames: string[] = [], tournamentFilter: string = 'all') =>
    ['finishedMatches', Number(orgId) || 1, leagueName, page, pageSize, (collabLeagueNames || []).sort().join(','), tournamentFilter] as const,
  
  transfers: (orgId: any, status: string = 'all', page: number = 0, pageSize: number = 15) => 
    ['transfers', Number(orgId) || 1, status, page, pageSize] as const,
  
  leagues: (orgId: any, collabLeagueIds: number[] = []) => 
    ['leagues', Number(orgId) || 1, (collabLeagueIds || []).sort().join(',')] as const,
  
  news: (orgId: any) => 
    ['news', Number(orgId) || 1] as const,
  
  sponsors: (orgId: any) => 
    ['sponsors', Number(orgId) || 1] as const,
  
  auditLogs: (orgId: any) => 
    ['auditLogs', Number(orgId) || 1] as const,
};
