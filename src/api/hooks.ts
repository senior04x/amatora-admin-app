import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { queryKeys } from './queryKeys';

/**
 * Hook for fetching Dashboard metrics
 */
export const useDashboardData = (orgId: any) => {
  return useQuery({
    queryKey: queryKeys.dashboard(orgId),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;

      // Parallel fetching for high performance
      const [
        { count: playersCount },
        { count: teamsCount },
        { count: matchesCount },
        { count: pendingAppsCount },
        { data: liveMatches },
      ] = await Promise.all([
        supabase.from('players').select('id', { count: 'exact', head: true }).eq('organization_id', targetOrgId),
        supabase.from('teams').select('id', { count: 'exact', head: true }).eq('organization_id', targetOrgId),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('organization_id', targetOrgId),
        supabase.from('applications').select('id', { count: 'exact', head: true }).eq('organization_id', targetOrgId).eq('status', 'pending'),
        supabase.from('matches').select('*, home_team:teams!matches_home_team_id_fkey(name, logo_url), away_team:teams!matches_away_team_id_fkey(name, logo_url)').eq('organization_id', targetOrgId).eq('status', 'live').limit(5),
      ]);

      return {
        playersCount: playersCount || 0,
        teamsCount: teamsCount || 0,
        matchesCount: matchesCount || 0,
        pendingAppsCount: pendingAppsCount || 0,
        liveMatches: liveMatches || [],
      };
    },
    enabled: !!orgId,
  });
};

/**
 * Hook for fetching Leagues list
 */
export const useLeaguesData = (orgId: any) => {
  return useQuery({
    queryKey: queryKeys.leagues(orgId),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const { data, error } = await supabase
        .from('leagues')
        .select('*')
        .eq('organization_id', targetOrgId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });
};

/**
 * Hook for fetching News
 */
export const useNewsData = (orgId: any) => {
  return useQuery({
    queryKey: queryKeys.news(orgId),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const { data, error } = await supabase
        .from('news')
        .select('*')
        .eq('organization_id', targetOrgId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });
};

/**
 * Hook for fetching Sponsors
 */
export const useSponsorsData = (orgId: any) => {
  return useQuery({
    queryKey: queryKeys.sponsors(orgId),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const { data, error } = await supabase
        .from('sponsors')
        .select('*')
        .eq('organization_id', targetOrgId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });
};

/**
 * Invalidation Helpers for Mutations
 */
export const useInvalidateData = () => {
  const queryClient = useQueryClient();

  return {
    invalidateDashboard: (orgId?: any) => {
      if (orgId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(orgId) });
      } else {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    },
    invalidatePlayers: (orgId?: any) => {
      queryClient.invalidateQueries({ queryKey: ['players'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    invalidateTeams: (orgId?: any) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    invalidateApplications: (orgId?: any) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['players'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    invalidateMatches: (orgId?: any) => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    invalidateTransfers: (orgId?: any) => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      queryClient.invalidateQueries({ queryKey: ['players'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    invalidateLeagues: (orgId?: any) => {
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
    },
    invalidateNews: (orgId?: any) => {
      queryClient.invalidateQueries({ queryKey: ['news'] });
    },
    invalidateSponsors: (orgId?: any) => {
      queryClient.invalidateQueries({ queryKey: ['sponsors'] });
    },
  };
};
