import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { supabase, supabaseAdmin } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';

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

export const StandingsScreen: React.FC = () => {
  const { orgId } = useOrg();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [selectedRound, setSelectedRound] = useState<string>('Barchasi');
  const [availableRounds, setAvailableRounds] = useState<string[]>(['Barchasi']);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [showLeagueFilter, setShowLeagueFilter] = useState(false);

  useEffect(() => {
    fetchLeagues();
  }, [orgId]);

  useEffect(() => {
    if (selectedLeague) {
      calculateStandings(selectedLeague, selectedRound);
    }
  }, [selectedLeague, selectedRound, orgId]);

  const fetchLeagues = async () => {
    setLoading(true);
    try {
      const dbClient = supabaseAdmin || supabase;
      let query = dbClient.from('leagues').select('*').order('name');
      if (orgId) {
        query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
      }
      const { data } = await query;
      if (data && data.length > 0) {
        setLeagues(data);
        setSelectedLeague(data[0].name);
      } else {
        // Fallback without org filter
        const { data: fallbackData } = await dbClient.from('leagues').select('*').order('name');
        if (fallbackData && fallbackData.length > 0) {
          setLeagues(fallbackData);
          setSelectedLeague(fallbackData[0].name);
        }
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
    fetchLeagues();
  };

  const calculateStandings = async (leagueName: string, roundFilter: string) => {
    setLoading(true);
    try {
      const dbClient = supabaseAdmin || supabase;

      // 1. Fetch Teams
      let teamsQuery = dbClient.from('teams').select('*');
      if (orgId) {
        teamsQuery = teamsQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
      }
      const { data: teamsData } = await teamsQuery;

      // Filter teams for this league
      const leagueTeams = (teamsData || []).filter((t: any) => {
        if (!t.league) return true;
        const leaguesList = String(t.league).split(',').map((s) => s.trim().toLowerCase());
        return leaguesList.includes(leagueName.toLowerCase().trim());
      });

      // 2. Fetch Matches for this league
      let matchesQuery = dbClient
        .from('matches')
        .select(`
          *,
          home_team:home_team_id (id, name, logo_url),
          away_team:away_team_id (id, name, logo_url)
        `);

      if (orgId) {
        matchesQuery = matchesQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
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

      // Filter finished matches by round if specific round is selected
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

      // Map initialization for teams
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

      // Process each finished match
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

      // Calculate goalDiff and sort
      const list = Array.from(map.values()).map((item) => ({
        ...item,
        goalDiff: item.goalsFor - item.goalsAgainst,
      }));

      list.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return b.won - a.won;
      });

      setStandings(list);
    } catch (err) {
      console.error('Error calculating standings:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{"Turnir Jadvali"}</Text>
          <Text style={styles.headerSub}>{"Real-vaqt ochkolar va jamoalar ko'rsatkichlari"}</Text>
        </View>

        {/* League Picker Dropdown Trigger */}
        <TouchableOpacity
          style={styles.leagueSelectorBtn}
          activeOpacity={0.8}
          onPress={() => setShowLeagueFilter(!showLeagueFilter)}
        >
          <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <Ionicons name="trophy" size={16} color="#FFFFFF" />
          <Text style={styles.leagueSelectorText} numberOfLines={1}>
            {selectedLeague || "Liga tanlang"}
          </Text>
          <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      {/* Expandable League Picker */}
      {showLeagueFilter && (
        <View style={styles.leagueFilterMenu}>
          <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          {leagues.map((lg) => (
            <TouchableOpacity
              key={lg.id}
              style={styles.leagueMenuItem}
              activeOpacity={0.8}
              onPress={() => {
                setSelectedLeague(lg.name);
                setShowLeagueFilter(false);
              }}
            >
              <Text
                style={[
                  styles.leagueMenuText,
                  selectedLeague === lg.name && { color: '#FFFFFF', fontWeight: '900' },
                ]}
              >
                {lg.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* TUR / ROUND SELECTOR HORIZONTAL SCROLL BAR */}
      <View style={styles.roundBarContainer}>
        <Text style={styles.roundBarLabel}>{"TUR / BOSQICH:"}</Text>
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
                style={[styles.roundPill, isActive && styles.roundPillActive]}
                activeOpacity={0.8}
                onPress={() => setSelectedRound(rnd)}
              >
                <Text style={[styles.roundPillText, isActive && styles.roundPillTextActive]}>
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
          <View style={[styles.tableHeaderRow, { opacity: 0.5 }]}>
            <View style={{ width: 28, height: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4 }} />
            <View style={{ flex: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginLeft: 6, marginRight: 16 }} />
            <View style={{ width: 34, height: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4 }} />
            <View style={{ width: 30, height: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginLeft: 6 }} />
            <View style={{ width: 30, height: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginLeft: 6 }} />
            <View style={{ width: 30, height: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginLeft: 6 }} />
            <View style={{ width: 46, height: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginLeft: 6 }} />
            <View style={{ width: 44, height: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginLeft: 6 }} />
          </View>
          
          {/* Skeleton Rows */}
          {[...Array(8)].map((_, i) => (
            <View key={i} style={[styles.tableRow, { opacity: 1 - (i * 0.08) }]}>
              <View style={{ width: 28, height: 28, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8 }} />
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 6, gap: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)' }} />
                <View style={{ width: 100, height: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
              </View>
              <View style={{ width: 34, height: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
              <View style={{ width: 30, height: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4, marginLeft: 6 }} />
              <View style={{ width: 30, height: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4, marginLeft: 6 }} />
              <View style={{ width: 30, height: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4, marginLeft: 6 }} />
              <View style={{ width: 46, height: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4, marginLeft: 6 }} />
              <View style={{ width: 44, height: 24, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, marginLeft: 6 }} />
            </View>
          ))}
        </ScrollView>
      ) : standings.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="shield-outline" size={48} color="#475569" />
          <Text style={styles.emptyTitle}>{"Jamoalar topilmadi"}</Text>
          <Text style={styles.emptySub}>{"Ushbu ligada jamoalar yoki yakunlangan o'yinlar yo'q"}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}
        >
          {/* Table Header Row */}
          <View style={styles.tableHeaderRow}>
            <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <Text style={[styles.thText, { width: 28 }]}>№</Text>
            <Text style={[styles.thText, { flex: 1, textAlign: 'left', paddingLeft: 6 }]}>Jamoa</Text>
            <Text style={[styles.thText, { width: 34 }]}>O'YN</Text>
            <Text style={[styles.thText, { width: 30, color: '#10B981' }]}>G'</Text>
            <Text style={[styles.thText, { width: 30, color: '#F59E0B' }]}>D</Text>
            <Text style={[styles.thText, { width: 30, color: '#EF4444' }]}>M</Text>
            <Text style={[styles.thText, { width: 46 }]}>T-F</Text>
            <Text style={[styles.thText, { width: 44, color: '#FFFFFF' }]}>OCHKO</Text>
          </View>

          {/* Table Rows */}
          {standings.map((item, index) => {
            const rank = index + 1;
            const isTop1 = rank === 1;
            const isTop3 = rank <= 3;

            return (
              <View
                key={item.id}
                style={[
                  styles.tableRow,
                  isTop1 && styles.rank1Row,
                  isTop3 && !isTop1 && styles.rankTop3Row,
                ]}
              >
                <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
                {/* Rank number badge */}
                <View style={[styles.rankBadge, isTop1 && styles.rank1Badge]}>
                  <Text style={[styles.rankBadgeText, isTop1 && styles.rank1BadgeText]}>
                    {rank}
                  </Text>
                </View>

                {/* Team Logo & Name */}
                <View style={styles.teamCol}>
                  <Image
                    source={{
                      uri:
                        item.logo_url ||
                        'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop',
                    }}
                    style={styles.teamLogo}
                  />
                  <Text style={styles.teamNameText} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>

                {/* Stats Columns */}
                <Text style={[styles.tdText, { width: 34 }]}>{item.played}</Text>
                <Text style={[styles.tdText, { width: 30, color: '#10B981', fontWeight: '800' }]}>{item.won}</Text>
                <Text style={[styles.tdText, { width: 30, color: '#F59E0B', fontWeight: '800' }]}>{item.drawn}</Text>
                <Text style={[styles.tdText, { width: 30, color: '#EF4444', fontWeight: '800' }]}>{item.lost}</Text>
                <Text style={[styles.tdText, { width: 46, fontSize: 11 }]}>{`${item.goalsFor}:${item.goalsAgainst}`}</Text>

                {/* Points Badge */}
                <View style={[styles.pointsBadge, isTop1 && styles.rank1PointsBadge]}>
                  <Text style={[styles.pointsText, isTop1 && { color: '#000000' }]}>
                    {item.points}
                  </Text>
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
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 10,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  leagueSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    maxWidth: 160,
    overflow: 'hidden',
  },
  leagueSelectorText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  leagueFilterMenu: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 14,
    padding: 8,
    marginBottom: 14,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    gap: 4,
    overflow: 'hidden',
  },
  leagueMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  leagueMenuText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
  },
  roundBarContainer: {
    marginBottom: 14,
  },
  roundBarLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#94A3B8',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  roundScrollContent: {
    flexDirection: 'row',
    gap: 6,
  },
  roundPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  roundPillActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  roundPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  roundPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyBox: {
    paddingVertical: 50,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderStyle: 'dashed',
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#CBD5E1',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
  },
  scrollContent: {
    paddingBottom: 130,
    gap: 8,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  thText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  rank1Row: {
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  rankTop3Row: {
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  rank1Badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  rankBadgeText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    fontWeight: '900',
  },
  rank1BadgeText: {
    color: '#FFFFFF',
  },
  teamCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 4,
  },
  teamLogo: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  teamNameText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  tdText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  pointsBadge: {
    width: 36,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  rank1PointsBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  pointsText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
});
