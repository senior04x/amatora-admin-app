import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { queryKeys } from './queryKeys';

/**
 * Hook for fetching Dashboard metrics and counts
 */
export const useDashboardCountsData = (orgId: any) => {
  return useQuery({
    queryKey: queryKeys.dashboard(orgId),
    queryFn: async () => {
      if (!orgId || Number(orgId) <= 0) {
        return { players: 0, leagues: 0, teams: 0, applications: 0, pendingTeams: 0, pendingUpdates: 0 };
      }
      const targetOrgId = Number(orgId);

      // 1. Fetch collab league IDs and names for active orgId
      let collabIds: any[] = [];
      let collabNames: string[] = [];
      if (targetOrgId) {
        try {
          const { data: myCollabs } = await supabase
            .from('league_collabs')
            .select('league_id, league:league_id(id, name)')
            .eq('status', 'accepted')
            .or(`sender_org_id.eq.${targetOrgId},receiver_org_id.eq.${targetOrgId}`);
          
          collabIds = (myCollabs || []).map((c: any) => c.league_id).filter(Boolean);
          collabNames = (myCollabs || []).map((c: any) => c.league?.name).filter(Boolean);
        } catch (e) {}
      }

      const hasCollab = collabNames.length > 0;
      const escapedCollabNames = hasCollab ? collabNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',') : '';

      // 2. Build filtered queries for APPROVED teams & players (including Collab)
      let leaguesQuery = supabase.from('leagues').select('id', { count: 'exact', head: true });
      if (targetOrgId) {
        if (collabIds.length > 0) {
          leaguesQuery = leaguesQuery.or(`organization_id.eq.${targetOrgId},id.in.(${collabIds.join(',')})`);
        } else {
          leaguesQuery = leaguesQuery.eq('organization_id', targetOrgId);
        }
      }

      let teamsQuery = supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .in('status', ['approved', 'tasdiqlangan']);
      if (targetOrgId) {
        if (hasCollab) {
          teamsQuery = teamsQuery.or(`organization_id.eq.${targetOrgId},league.in.(${escapedCollabNames})`);
        } else {
          teamsQuery = teamsQuery.eq('organization_id', targetOrgId);
        }
      }

      let playersQuery = supabase
        .from('players')
        .select('id', { count: 'exact', head: true });
      if (targetOrgId) {
        playersQuery = playersQuery.eq('organization_id', targetOrgId);
      }

      let approvedAppsQuery = supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .in('status', ['approved', 'tasdiqlangan']);
      if (targetOrgId) {
        if (hasCollab) {
          approvedAppsQuery = approvedAppsQuery.or(`organization_id.eq.${targetOrgId},league.in.(${escapedCollabNames}),team_league.in.(${escapedCollabNames})`);
        } else {
          approvedAppsQuery = approvedAppsQuery.eq('organization_id', targetOrgId);
        }
      }

      let pendingAppsQuery = supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'kutilmoqda']);
      if (targetOrgId) {
        if (hasCollab) {
          pendingAppsQuery = pendingAppsQuery.or(`organization_id.eq.${targetOrgId},league.in.(${escapedCollabNames}),team_league.in.(${escapedCollabNames})`);
        } else {
          pendingAppsQuery = pendingAppsQuery.eq('organization_id', targetOrgId);
        }
      }

      let pendingTeamsQuery = supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'kutilmoqda']);
      if (targetOrgId) {
        if (hasCollab) {
          pendingTeamsQuery = pendingTeamsQuery.or(`organization_id.eq.${targetOrgId},league.in.(${escapedCollabNames})`);
        } else {
          pendingTeamsQuery = pendingTeamsQuery.eq('organization_id', targetOrgId);
        }
      }

      let pendingUpdatesQuery = supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .ilike('comment', '%[PROFILE_UPDATE]%');
      if (targetOrgId) {
        pendingUpdatesQuery = pendingUpdatesQuery.eq('organization_id', targetOrgId);
      }

      const [playersRes, leaguesRes, teamsRes, approvedAppsRes, pendingAppsRes, pendingTeamsRes, pendingUpdatesRes] = await Promise.all([
        playersQuery,
        leaguesQuery,
        teamsQuery,
        approvedAppsQuery,
        pendingAppsQuery,
        pendingTeamsQuery,
        pendingUpdatesQuery,
      ]);

      let pCount = approvedAppsRes.count || playersRes.count || 0;

      return {
        players: pCount,
        leagues: leaguesRes.count || 0,
        teams: teamsRes.count || 0,
        applications: pendingAppsRes.count || 0,
        pendingTeams: pendingTeamsRes.count || 0,
        pendingUpdates: pendingUpdatesRes.count || 0,
      };
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
};

/**
 * Hook for fetching Leagues list
 */
export const useLeaguesData = (orgId: any, collabLeagueIds: number[] = []) => {
  return useQuery({
    queryKey: queryKeys.leagues(orgId),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      let query = supabase
        .from('leagues')
        .select('*')
        .order('created_at', { ascending: false });

      if (collabLeagueIds && collabLeagueIds.length > 0) {
        query = query.or(`organization_id.eq.${targetOrgId},id.in.(${collabLeagueIds.join(',')})`);
      } else {
        query = query.eq('organization_id', targetOrgId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && Number(orgId) > 0,
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
    enabled: !!orgId && Number(orgId) > 0,
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
    enabled: !!orgId && Number(orgId) > 0,
  });
};

/**
 * Hook for fetching Paginated & Server-searched Players with DB joins (15 + 1 Technique)
 */
export const usePlayersData = (
  orgId: any,
  search = '',
  page = 0,
  pageSize = 15,
  archived = false,
  collabLeagueNames: string[] = []
) => {
  return useQuery({
    queryKey: queryKeys.players(orgId, search, page, pageSize, archived),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const from = page * pageSize;
      const to = from + pageSize; // Fetch 16 records for hasMore check

      let query = supabase
        .from('applications')
        .select(`
          id,
          first_name,
          last_name,
          father_name,
          birth_date,
          passport_series,
          passport_number,
          phone,
          photo_url,
          position,
          player_number,
          team_id,
          status,
          is_archived,
          comment,
          created_at,
          organization_id,
          team:team_id (
            id,
            name,
            logo_url,
            league
          )
        `)
        .eq('is_archived', archived)
        .eq('status', archived ? 'archived' : 'approved')
        .not('comment', 'ilike', '%[PROFILE_UPDATE]%')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (collabLeagueNames && collabLeagueNames.length > 0) {
        const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
        query = query.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames}),team_league.in.(${escapedNames})`);
      } else {
        query = query.eq('organization_id', targetOrgId);
      }

      if (search && search.trim()) {
        const s = `%${search.trim()}%`;
        query = query.or(
          `first_name.ilike.${s},last_name.ilike.${s},passport_series.ilike.${s},passport_number.ilike.${s},phone.ilike.${s}`
        );
      }

      const { data, error } = await query;
      if (error) {
        console.error('usePlayersData error:', error);
        throw error;
      }

      const rows = data ?? [];
      return {
        players: rows.slice(0, pageSize) as any[],
        hasMore: rows.length > pageSize,
      };
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 60 * 1000,
    placeholderData: (previousData) => previousData,
  });
};

/**
 * Hook for fetching Paginated Teams in PlayersScreen (15 + 1 Technique)
 */
export const useTeamsPaginatedData = (
  orgId: any,
  search = '',
  page = 0,
  pageSize = 15,
  archived = false,
  collabLeagueNames: string[] = []
) => {
  return useQuery({
    queryKey: queryKeys.paginatedTeams(orgId, search, page, pageSize),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const from = page * pageSize;
      const to = from + pageSize; // 16 records

      let query = supabase
        .from('teams')
        .select('id, name, logo_url, league, status, is_archived, captain_phone, organization_id, created_at')
        .eq('is_archived', archived)
        .eq('status', archived ? 'archived' : 'approved')
        .order('name', { ascending: true })
        .range(from, to);

      if (collabLeagueNames && collabLeagueNames.length > 0) {
        const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
        query = query.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
      } else {
        query = query.eq('organization_id', targetOrgId);
      }

      if (search && search.trim()) {
        query = query.ilike('name', `%${search.trim()}%`);
      }

      const { data, error } = await query;
      if (error) {
        console.error('useTeamsPaginatedData error:', error);
        throw error;
      }

      const rows = data ?? [];
      return {
        teams: rows.slice(0, pageSize) as any[],
        hasMore: rows.length > pageSize,
      };
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 60 * 1000,
    placeholderData: (previousData) => previousData,
  });
};

/**
 * Hook for fetching Paginated & Server-filtered Applications (Player or Team)
 */
export const useApplicationsData = (
  orgId: any,
  tab: 'players' | 'teams' = 'players',
  status: string = 'all',
  league: string = 'all',
  page = 0,
  pageSize = 15,
  collabLeagueNames: string[] = []
) => {
  return useQuery({
    queryKey: queryKeys.applications(orgId, tab, status, league, page, pageSize),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const from = page * pageSize;
      const to = from + pageSize; // 15 + 1
      const isPlayerTab = tab === 'players';
      const table = isPlayerTab ? 'applications' : 'teams';

      const selectCols = isPlayerTab
        ? `
          id,
          first_name,
          last_name,
          middle_name,
          father_name,
          birth_date,
          passport_series,
          passport_number,
          passport_id,
          pinfl,
          phone,
          photo_url,
          position,
          player_number,
          team_id,
          team_name,
          league,
          team_league,
          citizenship,
          height,
          weight,
          status,
          is_archived,
          comment,
          created_at,
          organization_id,
          team:team_id (
            id,
            name,
            logo_url
          )
        `
        : 'id, name, logo_url, league, status, is_archived, captain_phone, organization_id, created_at';

      let query = supabase
        .from(table)
        .select(selectCols)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (collabLeagueNames && collabLeagueNames.length > 0) {
        const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
        if (isPlayerTab) {
          query = query.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames}),team_league.in.(${escapedNames})`);
        } else {
          query = query.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
        }
      } else {
        query = query.eq('organization_id', targetOrgId);
      }

      if (status !== 'all') {
        if (status === 'pending') {
          query = query.in('status', ['pending', 'kutilmoqda']);
        } else if (status === 'approved') {
          query = query.in('status', ['approved', 'tasdiqlangan']);
        } else if (status === 'rejected') {
          query = query.in('status', ['rejected', 'rad etilgan']);
        }
      }

      if (!isPlayerTab && league !== 'all' && league.trim()) {
        query = query.ilike('league', `%${league.trim()}%`);
      }

      if (isPlayerTab) {
        query = query.not('comment', 'ilike', '%[PROFILE_UPDATE]%');
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = data ?? [];
      return {
        items: rows.slice(0, pageSize) as any[],
        hasMore: rows.length > pageSize,
      };
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 60 * 1000,
    placeholderData: (previousData) => previousData,
  });
};

/**
 * Hook for fetching Applications Counts (Pending, Approved, Rejected, Total)
 */
export const useApplicationsCountsData = (
  orgId: any,
  tab: 'players' | 'teams' = 'players',
  collabLeagueNames: string[] = []
) => {
  return useQuery({
    queryKey: queryKeys.applicationsCounts(orgId, tab),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const table = tab === 'players' ? 'applications' : 'teams';

      const baseQuery = supabase.from(table).select('id', { count: 'exact', head: true });
      const pendingQ = supabase.from(table).select('id', { count: 'exact', head: true }).in('status', ['pending', 'kutilmoqda']);
      const approvedQ = supabase.from(table).select('id', { count: 'exact', head: true }).in('status', ['approved', 'tasdiqlangan', 'partially_approved', 'qisman']);
      const rejectedQ = supabase.from(table).select('id', { count: 'exact', head: true }).in('status', ['rejected', 'rad etilgan', 'rad_etilgan']);

      if (targetOrgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          baseQuery.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
          pendingQ.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
          approvedQ.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
          rejectedQ.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
        } else {
          baseQuery.eq('organization_id', targetOrgId);
          pendingQ.eq('organization_id', targetOrgId);
          approvedQ.eq('organization_id', targetOrgId);
          rejectedQ.eq('organization_id', targetOrgId);
        }
      }

      const [totalRes, pendingRes, approvedRes, rejectedRes] = await Promise.all([
        baseQuery,
        pendingQ,
        approvedQ,
        rejectedQ,
      ]);

      return {
        total: totalRes.count || 0,
        pending: pendingRes.count || 0,
        approved: approvedRes.count || 0,
        rejected: rejectedRes.count || 0,
      };
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 60 * 1000,
  });
};

/**
 * Hook for fetching Teams list
 */
export const useTeamsData = (orgId: any, collabLeagueNames: string[] = []) => {
  return useQuery({
    queryKey: queryKeys.teams(orgId),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      let query = supabase
        .from('teams')
        .select('id, name, logo_url, league, league_id, league_name')
        .order('name');

      if (collabLeagueNames && collabLeagueNames.length > 0) {
        const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
        query = query.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
      } else {
        query = query.eq('organization_id', targetOrgId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 5 * 60 * 1000,
  });
};

/**
 * Hook for fetching Paginated & Server-filtered Transfers (via RPC)
 */
export const useTransfersData = (
  orgId: any,
  status = 'all',
  page = 0,
  pageSize = 20
) => {
  return useQuery({
    queryKey: queryKeys.transfers(orgId, status, page, pageSize),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const { data, error } = await supabase.rpc('get_organization_transfers', {
        p_org_id: targetOrgId,
        p_status: status,
        p_page: page,
        p_page_size: pageSize,
      });

      if (error) throw error;

      const transfers = data ?? [];

      return {
        transfers,
        totalCount: Number(transfers[0]?.total_count ?? 0),
        hasMore: transfers.length === pageSize,
      };
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 60 * 1000,
    placeholderData: (previousData) => previousData,
  });
};

/**
 * Hook for fetching Active Matches list with timer enrichment
 */
export const useMatchesData = (
  orgId: any,
  leagueName = 'all',
  collabLeagueNames: string[] = []
) => {
  return useQuery({
    queryKey: queryKeys.matches(orgId, leagueName),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;

      let query = supabase
        .from('matches')
        .select(`
          id,
          organization_id,
          league,
          round,
          home_team_id,
          away_team_id,
          home_score,
          away_score,
          match_date,
          match_time,
          location,
          stadium_name,
          importance,
          youtube_link,
          is_postponed,
          status,
          home_team:home_team_id (id, name, logo_url),
          away_team:away_team_id (id, name, logo_url)
        `)
        .neq('status', 'finished')
        .order('id', { ascending: false });

      if (targetOrgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          query = query.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
        } else {
          query = query.eq('organization_id', targetOrgId);
        }
      }

      if (leagueName && leagueName !== 'all') {
        query = query.eq('league', leagueName);
      }

      const { data, error } = await query;
      let rawMatches = data || [];

      if (error || !data) {
        let fbQuery = supabase.from('matches').select('*').neq('status', 'finished');
        if (targetOrgId) {
          if (collabLeagueNames && collabLeagueNames.length > 0) {
            const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
            fbQuery = fbQuery.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
          } else {
            fbQuery = fbQuery.eq('organization_id', targetOrgId);
          }
        }
        if (leagueName && leagueName !== 'all') {
          fbQuery = fbQuery.eq('league', leagueName);
        }
        const { data: fallbackData } = await fbQuery.order('id', { ascending: false }).limit(100);
        if (fallbackData) {
          const { data: teamsData } = await supabase.from('teams').select('id, name, logo_url');
          const teamsMap = new Map((teamsData || []).map((t) => [t.id, t]));
          rawMatches = fallbackData.map((m) => ({
            ...m,
            home_team: teamsMap.get(m.home_team_id),
            away_team: teamsMap.get(m.away_team_id),
          }));
        }
      }

      // Fetch live timer payloads from sponsors table for active matches
      const { data: timerSponsors } = await supabase
        .from('sponsors')
        .select('name, logo_url')
        .like('name', 'MATCH_TIMER_%');

      const timerMap = new Map();
      if (timerSponsors) {
        timerSponsors.forEach((sp: any) => {
          try {
            const matchIdFromKey = sp.name.replace('MATCH_TIMER_', '');
            const jsonStr = sp.logo_url || sp.image_url || sp.url;
            if (jsonStr) {
              const parsed = JSON.parse(jsonStr);
              timerMap.set(String(matchIdFromKey), parsed);
            }
          } catch (e) {}
        });
      }

      const enrichedMatches = rawMatches.map((m: any) => {
        const livePayload = timerMap.get(String(m.id));
        const isLive = m.status === 'first_half' || m.status === 'second_half' || m.status === 'live';

        const baseSec =
          livePayload?.timer_seconds !== undefined && livePayload?.timer_seconds !== null
            ? Number(livePayload.timer_seconds)
            : m.timer_seconds !== undefined && m.timer_seconds !== null
            ? Number(m.timer_seconds)
            : 0;

        const isRunning =
          livePayload?.is_timer_running !== undefined && livePayload?.is_timer_running !== null
            ? String(livePayload.is_timer_running) === 'true' || livePayload.is_timer_running === true
            : m.is_timer_running !== undefined && m.is_timer_running !== null
            ? String(m.is_timer_running) === 'true' || m.is_timer_running === true
            : isLive;

        const startedAt = livePayload?.timer_started_at || m.timer_started_at || null;

        return {
          ...m,
          timer_seconds: baseSec,
          timer_started_at: startedAt,
          is_timer_running: isRunning,
          status: livePayload?.status || m.status,
          home_score: livePayload?.home_score ?? m.home_score,
          away_score: livePayload?.away_score ?? m.away_score,
        };
      });

      return enrichedMatches as any[];
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 30 * 1000,
    placeholderData: (previousData) => previousData,
  });
};

/**
 * Hook for fetching Paginated Finished Matches list
 */
export const useFinishedMatchesData = (
  orgId: any,
  leagueName = 'all',
  page = 0,
  pageSize = 15,
  collabLeagueNames: string[] = []
) => {
  return useQuery({
    queryKey: queryKeys.finishedMatches(orgId, leagueName, page, pageSize),
    queryFn: async () => {
      const targetOrgId = Number(orgId) || 1;
      const from = page * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('matches')
        .select(`
          id,
          organization_id,
          league,
          round,
          home_team_id,
          away_team_id,
          home_score,
          away_score,
          home_penalty_score,
          away_penalty_score,
          match_date,
          match_time,
          location,
          stadium_name,
          importance,
          youtube_link,
          is_postponed,
          status,
          home_team:home_team_id (id, name, logo_url),
          away_team:away_team_id (id, name, logo_url)
        `, { count: 'exact' })
        .in('status', ['finished', 'FINISHED', 'tugagan', 'yakunlangan', 'completed'])
        .order('match_date', { ascending: false })
        .order('match_time', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);

      if (targetOrgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          query = query.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
        } else {
          query = query.eq('organization_id', targetOrgId);
        }
      }

      if (leagueName && leagueName !== 'all') {
        query = query.eq('league', leagueName);
      }

      const { data, count, error } = await query;
      let rawMatches = data || [];

      if ((error || !data || data.length === 0) && page === 0) {
        let fbQuery = supabase
          .from('matches')
          .select('*')
          .in('status', ['finished', 'FINISHED', 'tugagan', 'yakunlangan', 'completed'])
          .order('id', { ascending: false })
          .limit(pageSize);

        if (targetOrgId) {
          if (collabLeagueNames && collabLeagueNames.length > 0) {
            const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
            fbQuery = fbQuery.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
          } else {
            fbQuery = fbQuery.eq('organization_id', targetOrgId);
          }
        }

        const { data: fallbackData } = await fbQuery;
        if (fallbackData && fallbackData.length > 0) {
          const { data: teamsData } = await supabase.from('teams').select('id, name, logo_url');
          const teamsMap = new Map((teamsData || []).map((t) => [t.id, t]));
          rawMatches = fallbackData.map((m: any) => ({
            ...m,
            home_team: teamsMap.get(m.home_team_id),
            away_team: teamsMap.get(m.away_team_id),
          }));
        }
      }

      return {
        matches: rawMatches as any[],
        totalCount: count ?? rawMatches.length,
        hasMore: rawMatches.length === pageSize,
      };
    },
    enabled: !!orgId && Number(orgId) > 0,
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: (previousData) => previousData,
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
