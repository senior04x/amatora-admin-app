import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from '../components/SafeBlurView';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { useScrollDockHandler } from '../utils/scrollDock';

interface TeamStanding {
  id: string | number;
  name: string;
  logo_url?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

interface RawLeagueCache {
  leagueName: string;
  leagueTeams: any[];
  allLeagueMatches: any[];
  overridesMap: Record<string, any>;
  availableRounds: string[];
}

export const StandingsScreen: React.FC = () => {
  const { orgId, collabLeagueNames, collabLeagueIds } = useOrg();
  const { isDark, colors } = useTheme();
  const scrollDockProps = useScrollDockHandler();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [selectedRound, setSelectedRound] = useState<string>('Barchasi');
  const [availableRounds, setAvailableRounds] = useState<string[]>(['Barchasi']);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [showLeagueFilter, setShowLeagueFilter] = useState(false);

  // Single-league in-memory cache to prevent re-fetching and memory bloat on weak devices
  const leagueCacheRef = useRef<RawLeagueCache | null>(null);

  useEffect(() => {
    fetchLeagues();
  }, [orgId, collabLeagueIds]);

  useEffect(() => {
    if (selectedLeague) {
      calculateStandings(selectedLeague, selectedRound);
    }
  }, [selectedLeague, orgId, collabLeagueNames]);

  const fetchLeagues = async () => {
    setLoading(true);
    try {
      const dbClient = supabase;
      let query = dbClient.from('leagues').select('*').order('name');
      if (orgId) {
        if (collabLeagueIds && collabLeagueIds.length > 0) {
          query = query.or(`organization_id.eq.${orgId},id.in.(${collabLeagueIds.join(',')})`);
        } else {
          query = query.eq('organization_id', orgId);
        }
      }
      const { data } = await query;
      if (data && data.length > 0) {
        setLeagues(data);
        setSelectedLeague(data[0].name);
      } else {
        setLeagues([]);
        setSelectedLeague('');
      }
    } catch (e) {
      console.error('Error fetching leagues:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    leagueCacheRef.current = null;
    fetchLeagues();
  };

  /**
   * Pure in-memory standings calculation.
   * Runs in < 1ms, 0 network requests, 0 loading flicker, 0 memory churn.
   */
  const computeStandingsInMemory = (
    leagueTeams: any[],
    allLeagueMatches: any[],
    overridesMap: Record<string, any>,
    roundFilter: string
  ): TeamStanding[] => {
    // 1. Filter finished matches by round if specific round is selected
    const finishedMatches = allLeagueMatches.filter((m: any) => {
      const status = String(m.status || '').toLowerCase().trim();
      const isFinished = status === 'finished' || status === 'completed' || status === 'finish';
      if (!isFinished) return false;

      if (roundFilter !== 'Barchasi') {
        const matchRound = String(m.round || m.tour || '').trim();
        const formattedMatchRound = matchRound.includes('-tur') || matchRound.includes('tur') ? matchRound : `${matchRound}-tur`;
        return formattedMatchRound.toLowerCase() === roundFilter.toLowerCase();
      }

      return true;
    });

    // 2. Map initialization for teams
    const map = new Map<string, TeamStanding>();
    const keyMap = new Map<string, string>();

    leagueTeams.forEach((t: any) => {
      const key = String(t.id);
      const teamObj: TeamStanding = {
        id: t.id,
        name: t.name || 'Jamoa',
        logo_url: t.logo_url,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0,
        points: 0,
      };
      map.set(key, teamObj);
      keyMap.set(key, key);
      if (t.name) {
        keyMap.set(t.name.trim().toLowerCase(), key);
      }
    });

    // 3. Process each finished match
    finishedMatches.forEach((m: any) => {
      let homeKey = m.home_team_id ? String(m.home_team_id) : null;
      if (!homeKey && m.home_team?.id) homeKey = String(m.home_team.id);
      if (!homeKey && m.home_team?.name) homeKey = keyMap.get(m.home_team.name.trim().toLowerCase()) || null;
      if (!homeKey && m.home_team_name) homeKey = keyMap.get(String(m.home_team_name).trim().toLowerCase()) || null;

      let awayKey = m.away_team_id ? String(m.away_team_id) : null;
      if (!awayKey && m.away_team?.id) awayKey = String(m.away_team.id);
      if (!awayKey && m.away_team?.name) awayKey = keyMap.get(m.away_team.name.trim().toLowerCase()) || null;
      if (!awayKey && m.away_team_name) awayKey = keyMap.get(String(m.away_team_name).trim().toLowerCase()) || null;

      const hScore = Number(m.home_score ?? 0);
      const aScore = Number(m.away_score ?? 0);

      const homeTeam = homeKey ? map.get(homeKey) : null;
      const awayTeam = awayKey ? map.get(awayKey) : null;

      if (homeTeam) {
        homeTeam.played += 1;
        homeTeam.goalsFor += hScore;
        homeTeam.goalsAgainst += aScore;
        if (hScore > aScore) {
          homeTeam.won += 1;
          homeTeam.points += 3;
        } else if (hScore === aScore) {
          homeTeam.drawn += 1;
          homeTeam.points += 1;
        } else {
          homeTeam.lost += 1;
        }
      }

      if (awayTeam) {
        awayTeam.played += 1;
        awayTeam.goalsFor += aScore;
        awayTeam.goalsAgainst += hScore;
        if (aScore > hScore) {
          awayTeam.won += 1;
          awayTeam.points += 3;
        } else if (hScore === aScore) {
          awayTeam.drawn += 1;
          awayTeam.points += 1;
        } else {
          awayTeam.lost += 1;
        }
      }
    });

    // 4. Calculate goalDiff, apply overrides and sort
    const list = Array.from(map.values())
      .filter((item: any) => !item.is_archived)
      .map((item: any) => {
        const ovr = overridesMap[String(item.id)] || {};
        const played_offset = Number(ovr.played_offset || 0);
        const won_offset = Number(ovr.won_offset || 0);
        const draw_offset = Number(ovr.draw_offset || 0);
        const lost_offset = Number(ovr.lost_offset || 0);
        const gf_offset = Number(ovr.gf_offset || 0);
        const ga_offset = Number(ovr.ga_offset || 0);
        const pts_offset = Number(ovr.pts_offset || 0);

        const finalPlayed = Math.max(0, item.played + played_offset);
        const finalWon = Math.max(0, item.won + won_offset);
        const finalDrawn = Math.max(0, item.drawn + draw_offset);
        const finalLost = Math.max(0, item.lost + lost_offset);
        const finalGf = Math.max(0, item.goalsFor + gf_offset);
        const finalGa = Math.max(0, item.goalsAgainst + ga_offset);
        const finalPts = item.points + pts_offset;

        return {
          ...item,
          played: finalPlayed,
          won: finalWon,
          drawn: finalDrawn,
          lost: finalLost,
          goalsFor: finalGf,
          goalsAgainst: finalGa,
          goalDiff: finalGf - finalGa,
          points: finalPts,
        };
      });

    list.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return b.won - a.won;
    });

    return list;
  };

  /**
   * Fast round selection handler: switches standings immediately in-memory.
   */
  const handleRoundSelect = (rnd: string) => {
    setSelectedRound(rnd);
    if (leagueCacheRef.current && leagueCacheRef.current.leagueName === selectedLeague) {
      const computed = computeStandingsInMemory(
        leagueCacheRef.current.leagueTeams,
        leagueCacheRef.current.allLeagueMatches,
        leagueCacheRef.current.overridesMap,
        rnd
      );
      setStandings(computed);
    } else {
      calculateStandings(selectedLeague, rnd);
    }
  };

  const calculateStandings = async (leagueName: string, roundFilter: string) => {
    setLoading(true);
    try {
      const dbClient = supabase;

      // 1. Fetch ONLY Approved & Active Teams (including Collab)
      let teamsQuery = dbClient
        .from('teams')
        .select('*')
        .in('status', ['approved', 'tasdiqlangan']);

      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          teamsQuery = teamsQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          teamsQuery = teamsQuery.eq('organization_id', orgId);
        }
      }
      const { data: teamsData } = await teamsQuery;

      // Filter teams for this league and strictly check approved status and not archived
      const leagueTeams = (teamsData || []).filter((t: any) => {
        const st = String(t.status || '').toLowerCase().trim();
        const isApproved = st === 'approved' || st === 'tasdiqlangan';
        if (!isApproved) return false;
        if (t.is_archived === true) return false;

        if (!t.league) return true;
        const leaguesList = String(t.league).split(',').map((s) => s.trim().toLowerCase());
        return leaguesList.includes(leagueName.toLowerCase().trim());
      });

      // 2. Fetch Matches for this league (including Collab)
      let matchesQuery = dbClient
        .from('matches')
        .select(`
          *,
          home_team:home_team_id (id, name, logo_url),
          away_team:away_team_id (id, name, logo_url)
        `);

      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          matchesQuery = matchesQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          matchesQuery = matchesQuery.eq('organization_id', orgId);
        }
      }

      const { data: matchesData } = await matchesQuery;

      // Filter finished matches belonging to this league
      const allLeagueMatches = (matchesData || []).filter((m: any) => {
        const matchLeague = String(m.league || '').trim().toLowerCase();
        return matchLeague === leagueName.trim().toLowerCase() || !m.league;
      });

      // Extract unique rounds available for this league
      const roundSet = new Set<string>();
      allLeagueMatches.forEach((m: any) => {
        const r = String(m.round || m.tour || '').trim();
        if (r) {
          roundSet.add(r.includes('-tur') || r.includes('tur') ? r : `${r}-tur`);
        }
      });

      const sortedRounds = Array.from(roundSet).sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });

      const defaultRounds = ['Barchasi'];
      if (sortedRounds.length > 0) {
        sortedRounds.forEach((r) => defaultRounds.push(r));
      } else {
        for (let i = 1; i <= 10; i++) {
          defaultRounds.push(`${i}-tur`);
        }
      }

      setAvailableRounds(defaultRounds);

      // Fetch Standings Overrides from sponsors table
      const dbClientFetch = supabase;
      const { data: sponsorData } = await dbClientFetch
        .from('sponsors')
        .select('*');

      const overridesMap: Record<string, any> = {};
      (sponsorData || []).forEach((s: any) => {
        if (s.name && s.name.startsWith('STANDINGS_OVERRIDE_')) {
          const teamId = s.name.replace('STANDINGS_OVERRIDE_', '');
          try {
            overridesMap[teamId] = JSON.parse(s.logo_url);
          } catch (e) {}
        }
      });

      // Save raw data to single-league cache for instant zero-latency tour switching
      leagueCacheRef.current = {
        leagueName,
        leagueTeams,
        allLeagueMatches,
        overridesMap,
        availableRounds: defaultRounds,
      };

      // Compute standings
      const list = computeStandingsInMemory(leagueTeams, allLeagueMatches, overridesMap, roundFilter);
      setStandings(list);
    } catch (err) {
      console.error('Error calculating standings:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{"Turnir Jadvali"}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>{"Guruh va pley-off bosqichlari statistikasi"}</Text>
        </View>

        {/* League Selector Pill */}
        {leagues.length > 0 && (
          <TouchableOpacity
            style={[styles.leagueSelectorPill, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            activeOpacity={0.8}
            onPress={() => setShowLeagueFilter(!showLeagueFilter)}
          >
            <Ionicons name="trophy-outline" size={14} color={colors.accentGreen} style={{ marginRight: 6 }} />
            <Text style={[styles.leagueSelectorText, { color: colors.textPrimary }]} numberOfLines={1}>
              {selectedLeague || 'Ligani tanlang'}
            </Text>
            <Ionicons
              name={showLeagueFilter ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textMuted}
              style={{ marginLeft: 4 }}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* League Filter Modal Dropdown */}
      {showLeagueFilter && (
        <View style={[styles.leagueFilterMenu, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[styles.androidMenuBackdrop, { backgroundColor: colors.bgCard }]} />
          )}
          {leagues.map((lg) => (
            <TouchableOpacity
              key={lg.id}
              style={[styles.leagueMenuItem, { borderBottomColor: colors.border }]}
              activeOpacity={0.8}
              onPress={() => {
                setSelectedLeague(lg.name);
                setShowLeagueFilter(false);
              }}
            >
              <Text
                style={[
                  styles.leagueMenuText,
                  { color: colors.textSecondary },
                  selectedLeague === lg.name && { color: colors.accentGreen, fontWeight: '900' },
                ]}
              >
                {lg.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* TUR / ROUND SELECTOR HORIZONTAL SCROLL BAR */}
      <View style={[styles.roundBarContainer, { backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : colors.bgCardElevated, borderBottomColor: colors.border }]}>
        <Text style={[styles.roundBarLabel, { color: colors.textMuted }]}>{"TUR / BOSQICH:"}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roundScrollContent}
        >
          {availableRounds.map((rnd) => {
            const isActive = selectedRound === rnd;
            return (
              <TouchableOpacity
                key={rnd}
                style={[
                  styles.roundPill,
                  { backgroundColor: colors.bgCard, borderColor: colors.border },
                  isActive && { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
                ]}
                activeOpacity={0.8}
                onPress={() => handleRoundSelect(rnd)}
              >
                <Text
                  style={[
                    styles.roundPillText,
                    { color: colors.textSecondary },
                    isActive && { color: '#FFFFFF', fontWeight: '900' },
                  ]}
                >
                  {rnd.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Standings Table */}
      {loading ? (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Skeleton Header */}
          <View style={[styles.tableHeaderRow, { backgroundColor: colors.bgCard, borderColor: colors.border, opacity: 0.5 }]}>
            <View style={{ width: 26, height: 16, backgroundColor: colors.border, borderRadius: 4 }} />
            <View style={{ flex: 1, height: 16, backgroundColor: colors.border, borderRadius: 4, marginLeft: 6, marginRight: 16 }} />
            <View style={{ width: 28, height: 16, backgroundColor: colors.border, borderRadius: 4 }} />
            <View style={{ width: 28, height: 16, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
            <View style={{ width: 28, height: 16, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
            <View style={{ width: 28, height: 16, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
            <View style={{ width: 44, height: 16, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
            <View style={{ width: 38, height: 16, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
          </View>
          
          {/* Skeleton Rows */}
          {[...Array(8)].map((_, i) => (
            <View key={i} style={[styles.tableRow, { backgroundColor: colors.bgCard, borderColor: colors.border, opacity: 1 - (i * 0.08) }]}>
              <View style={{ width: 26, height: 26, backgroundColor: colors.border, borderRadius: 8 }} />
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 6, gap: 8 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.border }} />
                <View style={{ width: 90, height: 14, backgroundColor: colors.border, borderRadius: 4 }} />
              </View>
              <View style={{ width: 28, height: 14, backgroundColor: colors.border, borderRadius: 4 }} />
              <View style={{ width: 28, height: 14, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
              <View style={{ width: 28, height: 14, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
              <View style={{ width: 28, height: 14, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
              <View style={{ width: 44, height: 14, backgroundColor: colors.border, borderRadius: 4, marginLeft: 4 }} />
              <View style={{ width: 38, height: 24, backgroundColor: colors.border, borderRadius: 8, marginLeft: 4 }} />
            </View>
          ))}
        </ScrollView>
      ) : standings.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="shield-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{"Jamoalar topilmadi"}</Text>
          <Text style={[styles.emptySub, { color: colors.textMuted }]}>{"Ushbu ligada jamoalar yoki yakunlangan o'yinlar yo'q"}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          {...scrollDockProps}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentGreen} />}
        >
          {/* Table Header Row */}
          <View style={[styles.tableHeaderRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <Text style={[styles.thText, { color: colors.textMuted, width: 26 }]}>№</Text>
            <Text style={[styles.thText, { color: colors.textMuted, flex: 1, textAlign: 'left', paddingLeft: 8 }]}>Jamoa</Text>
            <Text style={[styles.thText, { color: colors.textMuted, width: 28 }]}>O'</Text>
            <Text style={[styles.thText, { width: 28, color: colors.accentGreen }]}>G'</Text>
            <Text style={[styles.thText, { width: 28, color: colors.accentYellow }]}>D</Text>
            <Text style={[styles.thText, { width: 28, color: colors.accentRed }]}>M</Text>
            <Text style={[styles.thText, { color: colors.textMuted, width: 44 }]}>T/N</Text>
            <Text style={[styles.thText, { width: 38, color: colors.accentGreen }]}>O</Text>
          </View>

          {/* Table Rows */}
          {standings.map((item, index) => {
            const isLeader = index === 0;

            return (
              <View
                key={item.id}
                style={[
                  styles.tableRow,
                  { backgroundColor: colors.bgCard, borderColor: colors.border },
                  index % 2 === 1 && { backgroundColor: isDark ? '#162235' : colors.bgCardElevated },
                  isLeader && {
                    borderColor: colors.accentGreen,
                    backgroundColor: isDark ? '#112B26' : '#ECFDF5',
                    borderWidth: 1.5,
                  },
                ]}
              >
                {/* Rank */}
                <View
                  style={[
                    styles.rankBadge,
                    { backgroundColor: isDark ? '#334155' : '#E2E8F0' },
                    isLeader && { backgroundColor: colors.accentGreen },
                  ]}
                >
                  <Text
                    style={[
                      styles.rankText,
                      { color: isDark ? '#FFFFFF' : colors.textPrimary },
                      isLeader && { color: '#FFFFFF', fontWeight: '900' },
                    ]}
                  >
                    {index + 1}
                  </Text>
                </View>

                {/* Team Info */}
                <View style={styles.teamCol}>
                  <View style={[styles.logoBox, { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}>
                    {item.logo_url ? (
                      <ExpoImage source={{ uri: item.logo_url }} cachePolicy="memory-disk" style={styles.teamLogo} />
                    ) : (
                      <Ionicons name="shield-outline" size={16} color={colors.textMuted} />
                    )}
                  </View>
                  <Text style={[styles.teamNameText, { color: colors.textPrimary }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>

                {/* Stats Columns */}
                <Text style={[styles.tdText, { width: 28, color: colors.textPrimary, fontWeight: '900' }]}>{item.played}</Text>
                <Text style={[styles.tdText, { width: 28, color: colors.accentGreen, fontWeight: '900' }]}>{item.won}</Text>
                <Text style={[styles.tdText, { width: 28, color: colors.accentYellow, fontWeight: '900' }]}>{item.drawn}</Text>
                <Text style={[styles.tdText, { width: 28, color: colors.accentRed, fontWeight: '900' }]}>{item.lost}</Text>
                <Text style={[styles.tdText, { width: 44, fontSize: 12, fontWeight: '900', color: colors.textPrimary }]}>
                  {item.goalsFor}:{item.goalsAgainst}
                </Text>

                {/* Points */}
                <View style={[styles.pointsBadge, { backgroundColor: colors.accentGreen }]}>
                  <Text style={[styles.pointsText, { color: '#FFFFFF' }]}>{item.points}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  leagueSelectorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    maxWidth: 160,
  },
  leagueSelectorText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    flexShrink: 1,
  },
  leagueFilterMenu: {
    position: 'absolute',
    top: 70,
    right: 16,
    zIndex: 100,
    width: 200,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  androidMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F172A',
  },
  leagueMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  leagueMenuText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  roundBarContainer: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  roundBarLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  roundScrollContent: {
    gap: 8,
    alignItems: 'center',
  },
  roundPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  roundPillActive: {
    backgroundColor: 'rgba(0, 255, 135, 0.25)',
    borderColor: '#00FF87',
  },
  roundPillText: {
    color: '#CBD5E1',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  roundPillTextActive: {
    color: '#00FF87',
    fontWeight: '900',
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 100 : 60,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  thText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  alternateRow: {
    backgroundColor: '#162235',
  },
  leaderRow: {
    borderColor: '#00FF87',
    backgroundColor: '#112B26',
    borderWidth: 1.5,
  },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankLeaderBadge: {
    backgroundColor: '#00FF87',
  },
  rankText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  rankLeaderText: {
    color: '#000000',
    fontWeight: '900',
  },
  teamCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    paddingRight: 4,
    gap: 6,
  },
  logoBox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  teamLogo: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  teamNameText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    flexShrink: 1,
  },
  tdText: {
    fontSize: 13,
    textAlign: 'center',
  },
  pointsBadge: {
    width: 38,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#00FF87',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointsBadgeLeader: {
    backgroundColor: '#00FF87',
  },
  pointsText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },
  pointsTextLeader: {
    color: '#000000',
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  emptySub: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
