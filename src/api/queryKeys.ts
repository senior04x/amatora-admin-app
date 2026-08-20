/**
 * Grouped Query Key factories for deterministic cache management & invalidation.
 */
export const queryKeys = {
  dashboard: (orgId: any) => ['dashboard', Number(orgId) || 1] as const,
  
  players: (
    orgId: any,
    search: string = '',
    page: number = 0,
    pageSize: number = 15,
    archived: boolean = false
  ) => [
    'players',
    Number(orgId) || 1,
    search.trim(),
    page,
    pageSize,
    archived,
  ] as const,
  
  teams: (orgId: any, leagueId?: any) => 
    ['teams', Number(orgId) || 1, leagueId ? String(leagueId) : 'all'] as const,

  paginatedTeams: (orgId: any, search: string = '', page: number = 0, pageSize: number = 15) =>
    ['paginatedTeams', Number(orgId) || 1, search.trim(), page, pageSize] as const,
  
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
  
  matches: (orgId: any, leagueName: string = 'all') => 
    ['matches', Number(orgId) || 1, leagueName] as const,
  
  finishedMatches: (orgId: any, leagueName: string = 'all', page: number = 0, pageSize: number = 15) => 
    ['finishedMatches', Number(orgId) || 1, leagueName, page, pageSize] as const,
  
  transfers: (orgId: any, status: string = 'all', page: number = 0, pageSize: number = 15) => 
    ['transfers', Number(orgId) || 1, status, page, pageSize] as const,
  
  leagues: (orgId: any) => 
    ['leagues', Number(orgId) || 1] as const,
  
  news: (orgId: any) => 
    ['news', Number(orgId) || 1] as const,
  
  sponsors: (orgId: any) => 
    ['sponsors', Number(orgId) || 1] as const,
  
  auditLogs: (orgId: any) => 
    ['auditLogs', Number(orgId) || 1] as const,
};
