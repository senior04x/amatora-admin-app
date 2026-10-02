import { requireOrganizationId } from '../utils/organizationId';
/**
 * Grouped Query Key factories for deterministic cache management & invalidation.
 */
export const queryKeys = {
  dashboard: (orgId: any) => ['dashboard', requireOrganizationId(orgId)] as const,
  
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
    requireOrganizationId(orgId),
    search.trim(),
    page,
    pageSize,
    archived,
    league,
    teamId,
    (collabLeagueNames || []).sort().join(','),
  ] as const,
  
  teams: (orgId: any, collabLeagueNames: string[] = []) => 
    ['teams', requireOrganizationId(orgId), (collabLeagueNames || []).sort().join(',')] as const,

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
      requireOrganizationId(orgId),
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
    requireOrganizationId(orgId),
    tab,
    status,
    league,
    page,
    pageSize,
  ] as const,

  applicationsCounts: (orgId: any, tab: 'players' | 'teams' = 'players') =>
    ['applicationsCounts', requireOrganizationId(orgId), tab] as const,

  teamRoster: (orgId: any, teamId: any) =>
    ['teamRoster', requireOrganizationId(orgId), String(teamId)] as const,
  
  matches: (orgId: any, leagueName: string = 'all', collabLeagueNames: string[] = []) => 
    ['matches', requireOrganizationId(orgId), leagueName, (collabLeagueNames || []).sort().join(',')] as const,
  
  finishedMatches: (orgId: any, leagueName: string = 'all', page: number = 0, pageSize: number = 15, collabLeagueNames: string[] = [], tournamentFilter: string = 'all') =>
    ['finishedMatches', requireOrganizationId(orgId), leagueName, page, pageSize, (collabLeagueNames || []).sort().join(','), tournamentFilter] as const,
  
  transfers: (orgId: any, status: string = 'all', page: number = 0, pageSize: number = 15) => 
    ['transfers', requireOrganizationId(orgId), status, page, pageSize] as const,
  
  leagues: (orgId: any, collabLeagueIds: number[] = []) => 
    ['leagues', requireOrganizationId(orgId), (collabLeagueIds || []).sort().join(',')] as const,
  
  news: (orgId: any) => 
    ['news', requireOrganizationId(orgId)] as const,
  
  sponsors: (orgId: any) => 
    ['sponsors', requireOrganizationId(orgId)] as const,
  
  auditLogs: (orgId: any) => 
    ['auditLogs', requireOrganizationId(orgId)] as const,
};
