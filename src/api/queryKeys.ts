/**
 * Grouped Query Key factories for deterministic cache management & invalidation.
 */
export const queryKeys = {
  dashboard: (orgId: any) => ['dashboard', Number(orgId) || 1] as const,
  
  players: (orgId: any, leagueId?: any) => 
    ['players', Number(orgId) || 1, leagueId ? String(leagueId) : 'all'] as const,
  
  teams: (orgId: any, leagueId?: any) => 
    ['teams', Number(orgId) || 1, leagueId ? String(leagueId) : 'all'] as const,
  
  applications: (orgId: any, type?: string, status?: string) => 
    ['applications', Number(orgId) || 1, type ?? 'all', status ?? 'all'] as const,
  
  matches: (orgId: any, leagueId?: any, round?: any) => 
    ['matches', Number(orgId) || 1, leagueId ? String(leagueId) : 'all', round ? String(round) : 'all'] as const,
  
  transfers: (orgId: any, status?: string) => 
    ['transfers', Number(orgId) || 1, status ?? 'all'] as const,
  
  leagues: (orgId: any) => 
    ['leagues', Number(orgId) || 1] as const,
  
  news: (orgId: any) => 
    ['news', Number(orgId) || 1] as const,
  
  sponsors: (orgId: any) => 
    ['sponsors', Number(orgId) || 1] as const,
  
  auditLogs: (orgId: any) => 
    ['auditLogs', Number(orgId) || 1] as const,
};
