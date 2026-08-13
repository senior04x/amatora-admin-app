import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Animated, RefreshControl, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '../context/OrgContext';
import { supabase, supabaseAdmin } from '../supabaseClient';
import { Image } from 'react-native';
import { MatchControlScreen } from './MatchControlScreen';

interface Props {
  onNavigate: (
    tab: 'dashboard' | 'players' | 'matches' | 'transfers' | 'settings' | 'leagues' | 'create-match' | 'export' | 'applications' | 'standings' | 'account' | 'updates' | 'sponsors' | 'news',
    subTab?: 'players' | 'teams'
  ) => void;
}

const SkeletonLoader: React.FC<{ width?: number; height?: number }> = ({ width = 60, height = 24 }) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.8,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        opacity,
        marginTop: 4,
      }}
    />
  );
};

export const DashboardScreen: React.FC<Props> = ({ onNavigate }) => {
  const { orgId, userRole } = useOrg();
  const [counts, setCounts] = useState({ players: 0, leagues: 0, teams: 0, applications: 0, pendingTeams: 0, pendingUpdates: 0 });
  const [userMatches, setUserMatches] = useState<any[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [activeControlMatchId, setActiveControlMatchId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchDashboardCounts();
    fetchUserMatches();
  }, [orgId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchDashboardCounts(true),
      fetchUserMatches()
    ]);
    setRefreshing(false);
  }, [orgId]);

  const fetchDashboardCounts = async (isRefreshing = false) => {
    if (!isRefreshing) setLoading(true);
    try {
      // 1. Fetch collab league IDs for active orgId
      let collabIds: any[] = [];
      if (orgId) {
        try {
          const { data: myCollabs } = await supabase
            .from('league_collabs')
            .select('league_id')
            .eq('status', 'accepted')
            .or(`sender_org_id.eq.${orgId},receiver_org_id.eq.${orgId}`);
          collabIds = (myCollabs || []).map((c: any) => c.league_id).filter(Boolean);
        } catch (e) {}
      }

      // 2. Build filtered queries for APPROVED teams & players
      let leaguesQuery = supabase.from('leagues').select('id', { count: 'exact', head: true });
      if (orgId) {
        if (collabIds.length > 0) {
          leaguesQuery = leaguesQuery.or(`organization_id.eq.${orgId},organization_id.is.null,id.in.(${collabIds.join(',')})`);
        } else {
          leaguesQuery = leaguesQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
        }
      }

      let teamsQuery = supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .in('status', ['approved', 'tasdiqlangan']);
      if (orgId) {
        teamsQuery = teamsQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
      }

      let playersQuery = supabase
        .from('players')
        .select('id', { count: 'exact', head: true });
      if (orgId) {
        playersQuery = playersQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
      }

      let approvedAppsQuery = supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .in('status', ['approved', 'tasdiqlangan']);
      if (orgId) {
        approvedAppsQuery = approvedAppsQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
      }

      let pendingAppsQuery = supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'kutilmoqda']);
      if (orgId) {
        pendingAppsQuery = pendingAppsQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
      }

      let pendingTeamsQuery = supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'kutilmoqda']);
      if (orgId) {
        pendingTeamsQuery = pendingTeamsQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
      }

      let pendingUpdatesQuery = supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .ilike('comment', '%[PROFILE_UPDATE]%');
      if (orgId) {
        pendingUpdatesQuery = pendingUpdatesQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
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

      let pCount = playersRes.count || 0;
      if (pCount === 0) {
        pCount = approvedAppsRes.count || 0;
      }

      setCounts({
        players: pCount,
        leagues: leaguesRes.count || 0,
        teams: teamsRes.count || 0,
        applications: pendingAppsRes.count || 0,
        pendingTeams: pendingTeamsRes.count || 0,
        pendingUpdates: pendingUpdatesRes.count || 0,
      });
    } catch (e) {
      console.error('Fetch dashboard counts error:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserMatches = async () => {
    setMatchesLoading(true);
    try {
      const dbClient = supabaseAdmin || supabase;
      let query = dbClient
        .from('matches')
        .select(`
          *,
          home_team:home_team_id (id, name, logo_url),
          away_team:away_team_id (id, name, logo_url)
        `)
        .order('id', { ascending: false });

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data, error } = await query;
      let rawMatches = data || [];

      if (error || !data) {
        const { data: fallbackData } = await dbClient.from('matches').select('*');
        if (fallbackData) {
          const { data: teamsData } = await dbClient.from('teams').select('id, name, logo_url');
          const teamsMap = new Map((teamsData || []).map((t) => [t.id, t]));
          rawMatches = fallbackData.map((m) => ({
            ...m,
            home_team: teamsMap.get(m.home_team_id),
            away_team: teamsMap.get(m.away_team_id),
          }));
        }
      }

      const { data: timerSponsors } = await dbClient
        .from('sponsors')
        .select('*')
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

      const enriched = rawMatches.map((m: any) => {
        const timerInfo = timerMap.get(String(m.id)) || {};
        const isLive = m.status === 'first_half' || m.status === 'second_half' || m.status === 'live';

        const baseSec = timerInfo.timer_seconds !== undefined && timerInfo.timer_seconds !== null
          ? Number(timerInfo.timer_seconds)
          : (m.timer_seconds !== undefined && m.timer_seconds !== null ? Number(m.timer_seconds) : 0);

        const isRunning = timerInfo.is_timer_running !== undefined && timerInfo.is_timer_running !== null
          ? (String(timerInfo.is_timer_running) === 'true' || timerInfo.is_timer_running === true)
          : (m.is_timer_running !== undefined && m.is_timer_running !== null ? (String(m.is_timer_running) === 'true' || m.is_timer_running === true) : isLive);

        const startedAt = timerInfo.timer_started_at || m.timer_started_at || null;

        return {
          ...m,
          timer_seconds: baseSec,
          timer_started_at: startedAt,
          is_timer_running: isRunning,
        };
      });

      const activeMatches = enriched.filter((m: any) => m.status !== 'finished');

      const sorted = [...activeMatches].sort((a: any, b: any) => {
        const statusOrder: Record<string, number> = {
          'live': 1,
          'first_half': 1,
          'second_half': 1,
          'half_time': 1,
          'scheduled': 2,
          'postponed': 3,
        };
        const getOrder = (st?: string) => statusOrder[st || 'scheduled'] || 5;
        const orderA = getOrder(a.status);
        const orderB = getOrder(b.status);
        if (orderA !== orderB) return orderA - orderB;

        const dateA = new Date(`${a.match_date || a.date || '2099-01-01'}T${a.match_time || a.time || '00:00:00'}`).getTime();
        const dateB = new Date(`${b.match_date || b.date || '2099-01-01'}T${b.match_time || b.time || '00:00:00'}`).getTime();
        return dateA - dateB;
      });

      setUserMatches(sorted);
    } catch (e) {
      console.error('Error fetching user matches for dashboard:', e);
    } finally {
      setMatchesLoading(false);
    }
  };

  const getMatchTimeRemainingText = (
    mDate?: string,
    mTime?: string,
    status?: string,
    timerSecs?: number,
    startedAt?: string,
    isRunning?: boolean
  ) => {
    if (status === 'finished') return { text: 'Uchrashuv Yakunlangan', color: '#10B981' };
    if (status === 'first_half' || status === 'second_half' || status === 'half_time' || status === 'live') {
      if (status === 'half_time') {
        return { text: 'TANAFFUS (JONLI)', color: '#F59E0B' };
      }
      let sec = timerSecs || 0;
      if (isRunning && startedAt) {
        const ms = new Date(startedAt).getTime();
        if (!isNaN(ms)) {
          const elapsed = Math.max(0, Math.floor((Date.now() - ms) / 1000));
          if (elapsed < 14400) {
            sec += elapsed;
          }
        }
      }
      const min = Math.max(1, Math.floor(sec / 60) + 1);
      const halfLabel = status === 'second_half' ? '2-Taym' : '1-Taym';
      return { text: `JONLI • ${halfLabel} (${min}')`, color: '#EF4444' };
    }
    if (!mDate || !mTime) return { text: 'Boshlanish vaqti belgilanmagan', color: 'rgba(255,255,255,0.4)' };

    try {
      const matchDateTime = new Date(`${mDate}T${mTime.length === 5 ? mTime + ':00' : mTime}`);
      const now = new Date();
      const diffMs = matchDateTime.getTime() - now.getTime();

      if (diffMs <= 0) {
        return { text: "O'yin vaqti kelgan / Jonli", color: '#3B82F6' };
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const days = Math.floor(hours / 24);

      if (days > 0) {
        return { text: `Boshlanishiga: ${days} kun ${hours % 24} soat`, color: '#F59E0B' };
      }
      return { text: `Boshlanishiga: ${hours} soat ${minutes} daqiqa`, color: '#00FF66' };
    } catch (e) {
      return { text: `${mDate} | ${mTime}`, color: 'rgba(255,255,255,0.6)' };
    }
  };

  const getLiveTimerFormattedText = (status?: string, timerSecs?: number, startedAt?: string, isRunning?: boolean) => {
    if (status === 'half_time') return 'Tanaffus';
    let sec = timerSecs || 0;
    if (isRunning && startedAt) {
      const ms = new Date(startedAt).getTime();
      if (!isNaN(ms)) {
        const elapsed = Math.max(0, Math.floor((Date.now() - ms) / 1000));
        if (elapsed < 14400) {
          sec += elapsed;
        }
      }
    }
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (activeControlMatchId) {
    return (
      <MatchControlScreen
        matchId={activeControlMatchId}
        onBack={() => {
          setActiveControlMatchId(null);
          fetchUserMatches();
        }}
      />
    );
  }

  const allMenuNavItems = [
    {
      id: 'export',
      title: 'Export',
      icon: 'image-outline',
      color: '#38BDF8',
      action: () => onNavigate && onNavigate('export'),
      adminOnly: true,
    },
    {
      id: 'jamoalar',
      title: 'Jamoalar',
      icon: 'shirt-outline',
      color: '#4ADE80',
      action: () => onNavigate && onNavigate('players', 'teams'),
      adminOnly: false,
    },
    {
      id: 'ligalar',
      title: 'Ligalar',
      icon: 'trophy-outline',
      color: '#FBBF24',
      action: () => onNavigate && onNavigate('leagues'),
      adminOnly: false,
    },
    {
      id: 'transferlar',
      title: 'Transferlar',
      icon: 'swap-horizontal-outline',
      color: '#2DD4BF',
      action: () => onNavigate && onNavigate('transfers'),
      adminOnly: true,
    },
    {
      id: 'updates',
      title: "Ma'lumotlar",
      icon: 'refresh-outline',
      color: '#A78BFA',
      action: () => onNavigate && onNavigate('updates'),
      adminOnly: true,
    },
    {
      id: 'schedule',
      title: "O'yinlar",
      icon: 'calendar-outline',
      color: '#FB7185',
      action: () => onNavigate('matches'),
      adminOnly: false,
    },
    {
      id: 'standings',
      title: 'Turnirlar',
      icon: 'grid-outline',
      color: '#38BDF8',
      action: () => Alert.alert("Turnir jadvali", "Turnir jadvali bo'limi tayyorlanmoqda"),
      adminOnly: true,
    },
    {
      id: 'sponsors',
      title: 'Homiylar',
      icon: 'business-outline',
      color: '#FB923C',
      action: () => onNavigate && onNavigate('sponsors'),
      adminOnly: true,
    },
    {
      id: 'news',
      title: 'Yangiliklar',
      icon: 'newspaper-outline',
      color: '#F87171',
      action: () => onNavigate && onNavigate('news'),
      adminOnly: true,
    },
  ];

  const menuNavItems = userRole === 'user' 
    ? allMenuNavItems.filter(item => !item.adminOnly)
    : allMenuNavItems;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}
      >
      {/* Main Stats Cards (Kutilayotgan Arizalar, Qabul Qilingan O'yinchilar, Jami Ligalar, Qabul Qilingan Jamoalar) */}
      <Text style={styles.sectionTitle}>{"Umumiy Statistika"}</Text>
      <View style={styles.statsColumn}>
        {/* Card 1: Kutilayotgan Arizalar */}
        {userRole !== 'user' && (
          <TouchableOpacity
            style={[styles.mainStatCard, { borderColor: 'rgba(255, 255, 255, 0.18)' }]}
            activeOpacity={0.8}
            onPress={() => onNavigate && onNavigate('applications', 'players')}
          >
            <BlurView intensity={70} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
            <Ionicons name="document-text-outline" size={28} color="#60A5FA" />
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>{"Kutilayotgan Arizalar"}</Text>
              {loading ? (
                <SkeletonLoader width={160} height={24} />
              ) : (
                <Text style={[styles.statValue, { color: '#FFFFFF', fontSize: 14.5, fontWeight: '900' }]}>
                  {`${counts.applications}ta o'yinchi / ${counts.pendingTeams}ta jamoa`}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
          </TouchableOpacity>
        )}

        {/* Card 2: Qabul Qilingan O'yinchilar */}
        <TouchableOpacity
          style={[styles.mainStatCard, { borderColor: 'rgba(255, 255, 255, 0.18)' }]}
          activeOpacity={0.8}
          onPress={() => onNavigate && onNavigate('players', 'players')}
        >
          <BlurView intensity={70} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
          <Ionicons name="people-outline" size={28} color="#2DD4BF" />
          <View style={{ flex: 1 }}>
            <Text style={styles.statLabel}>{"Qabul Qilingan O'yinchilar"}</Text>
            {loading ? (
              <SkeletonLoader width={70} height={24} />
            ) : (
              <Text style={styles.statValue}>{counts.players} {"ta"}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
        </TouchableOpacity>

        {/* Card 3: Jami Ligalar */}
        <TouchableOpacity
          style={[styles.mainStatCard, { borderColor: 'rgba(255, 255, 255, 0.18)' }]}
          activeOpacity={0.8}
          onPress={() => onNavigate && onNavigate('leagues')}
        >
          <BlurView intensity={70} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
          <Ionicons name="trophy-outline" size={28} color="#FBBF24" />
          <View style={{ flex: 1 }}>
            <Text style={styles.statLabel}>{"Jami Ligalar"}</Text>
            {loading ? (
              <SkeletonLoader width={70} height={24} />
            ) : (
              <Text style={styles.statValue}>{counts.leagues} {"ta"}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
        </TouchableOpacity>

        {/* Card 4: Qabul Qilingan Jamoalar */}
        <TouchableOpacity
          style={[styles.mainStatCard, { borderColor: 'rgba(255, 255, 255, 0.18)' }]}
          activeOpacity={0.8}
          onPress={() => onNavigate && onNavigate('players', 'teams')}
        >
          <BlurView intensity={70} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
          <Ionicons name="shirt-outline" size={28} color="#4ADE80" />
          <View style={{ flex: 1 }}>
            <Text style={styles.statLabel}>{"Qabul Qilingan Jamoalar"}</Text>
            {loading ? (
              <SkeletonLoader width={70} height={24} />
            ) : (
              <Text style={styles.statValue}>{counts.teams} {"ta"}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
        </TouchableOpacity>
      </View>

      {/* Admin Menu Grid (3 Columns) */}
      <Text style={styles.sectionTitle}>{"Admin Menyusi Sahifalari"}</Text>
      <View style={styles.menuGrid}>
        {menuNavItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.gridCard}
            activeOpacity={0.7}
            onPress={item.action}
          >
            <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={{ position: 'relative' }}>
              <Ionicons name={item.icon as any} size={28} color={item.color} style={{ marginBottom: 8 }} />
              {item.id === 'updates' && counts.pendingUpdates > 0 && (
                <View style={styles.badgeCircle}>
                  <Text style={styles.badgeText}>
                    {counts.pendingUpdates > 99 ? '99+' : counts.pendingUpdates}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.gridCardTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Real Live & Chronological Matches Section at the VERY BOTTOM */}
      {userRole === 'user' && (
        <View style={{ marginTop: 24, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.sectionTitle}>{"O'yinlar Jadvali"}</Text>
            <TouchableOpacity onPress={() => onNavigate && onNavigate('matches')}>
              <Text style={{ color: '#00FF87', fontSize: 12, fontWeight: '800' }}>{"BARCHA O'YINLAR →"}</Text>
            </TouchableOpacity>
          </View>

          {matchesLoading ? (
            <View style={{ gap: 14 }}>
              <SkeletonLoader width={340} height={180} />
              <SkeletonLoader width={340} height={180} />
            </View>
          ) : userMatches.length > 0 ? (
            userMatches.map((item: any, idx: number) => {
              const isCentral = item.importance === 'markaziy';
              const mDate = item.match_date || item.date;
              const mTime = item.match_time || item.time;
              const isLive = item.status === 'first_half' || item.status === 'second_half' || item.status === 'half_time' || item.status === 'live';
              const isFinished = item.status === 'finished';
              const countdownInfo = getMatchTimeRemainingText(
                mDate,
                mTime,
                item.status,
                item.timer_seconds,
                item.timer_started_at,
                item.is_timer_running
              );
              const homeName = item.home_team?.name || item.home_team_name || 'Mezbon';
              const awayName = item.away_team?.name || item.away_team_name || 'Mehmon';
              const homeLogo = item.home_team?.logo_url || item.home_team_logo || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop';
              const awayLogo = item.away_team?.logo_url || item.away_team_logo || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop';
              const roundStr = item.round ? `${item.round}-bosqich` : (item.tour ? `${item.tour}-bosqich` : '1-bosqich');
              const locationStr = item.location === '2-maydon' ? '2-Maydon' : (item.location || '1-Maydon');

              return (
                <View
                  key={item.id || idx}
                  style={[
                    styles.matchCard,
                    isCentral && styles.centralMatchCard,
                    isLive && { borderColor: 'rgba(239, 68, 68, 0.5)', borderWidth: 1.5 },
                  ]}
                >
                  {/* Central Match Header Badge */}
                  {isCentral && (
                    <View style={styles.centralHeaderBadge}>
                      <Ionicons name="flame-outline" size={14} color="#FF9500" />
                      <Text style={styles.centralHeaderTitle}>{"MARKAZIY O'YIN"}</Text>
                    </View>
                  )}

                  {/* Match Top Info Bar */}
                  <View style={styles.cardTopRow}>
                    <View style={styles.leagueTag}>
                      <Text style={styles.leagueTagText}>{item.league || 'LIGA'}</Text>
                      <Text style={styles.roundTagText}>{` • ${roundStr}`}</Text>
                    </View>

                    <View style={styles.fieldTag}>
                      <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.6)" />
                      <Text style={styles.fieldTagText}>{locationStr}</Text>
                    </View>
                  </View>

                  {/* Teams VS Section */}
                  <View style={styles.teamsSection}>
                    {/* Home Team */}
                    <View style={styles.teamCol}>
                      <Image source={{ uri: homeLogo }} style={styles.teamLogo} />
                      <Text style={styles.teamName} numberOfLines={2}>{homeName}</Text>
                    </View>

                    {/* Score or VS Badge */}
                    <View style={styles.scoreContainer}>
                      {isFinished || isLive ? (
                        <View style={[styles.scoreBadge, isLive && { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#EF4444' }]}>
                          <Text style={[styles.scoreText, isLive && { color: '#FF4D4D', fontWeight: '900' }]}>
                            {item.home_score ?? 0} : {item.away_score ?? 0}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.vsBadge}>
                          <Text style={styles.vsText}>VS</Text>
                        </View>
                      )}

                      {isLive ? (
                        <View style={styles.liveTimerSubPill}>
                          <Ionicons name="time-outline" size={11} color="#EF4444" />
                          <Text style={styles.liveTimerSubText}>
                            {getLiveTimerFormattedText(item.status, item.timer_seconds, item.timer_started_at, item.is_timer_running)}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.matchTimeText}>{mTime || '18:00'}</Text>
                      )}
                    </View>

                    {/* Away Team */}
                    <View style={styles.teamCol}>
                      <Image source={{ uri: awayLogo }} style={styles.teamLogo} />
                      <Text style={styles.teamName} numberOfLines={2}>{awayName}</Text>
                    </View>
                  </View>

                  {/* Countdown & Match Status Bar */}
                  <View style={[styles.countdownBar, isLive && { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                    <Ionicons name={isLive ? "radio-outline" : "time-outline"} size={13} color={countdownInfo.color} />
                    <Text style={[styles.countdownText, { color: countdownInfo.color, fontWeight: isLive ? '900' : '700' }]}>
                      {countdownInfo.text}
                    </Text>
                  </View>

                  {/* PROMINENT CENTERED "O'YINNI BOSHQARISH" ACTION BUTTON */}
                  <TouchableOpacity
                    style={styles.centralManageBtn}
                    onPress={() => setActiveControlMatchId(item.id)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="settings-outline" size={18} color="#000000" />
                    <Text style={styles.centralManageBtnText}>{"O'YINNI BOSHQARISH"}</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          ) : (
            <View style={styles.dashEmptyMatchCard}>
              <Ionicons name="calendar-outline" size={28} color="rgba(255,255,255,0.4)" />
              <Text style={styles.dashEmptyText}>Hozircha rejalashtirilgan o'yinlar mavjud emas</Text>
            </View>
          )}
        </View>
      )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  statsColumn: {
    gap: 12,
    marginBottom: 24,
  },
  mainStatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    gap: 14,
    overflow: 'hidden',
  },
  statIconBox: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 13,
    fontWeight: '700',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  gridCard: {
    width: '31%',
    backgroundColor: 'transparent',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  gridIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  gridCardTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  badgeCircle: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#0F172A',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },  // Matches List Styles
  matchCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 12,
    marginBottom: 12,
  },
  centralMatchCard: {
    borderColor: 'rgba(255, 149, 0, 0.4)',
    borderWidth: 1.5,
  },
  centralHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.3)',
  },
  centralHeaderTitle: {
    color: '#FF9500',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leagueTag: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leagueTagText: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '800',
  },
  roundTagText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  fieldTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  fieldTagText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
  },
  teamsSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 6,
  },
  teamCol: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  teamLogo: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#263044',
  },
  teamName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  scoreContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scoreBadge: {
    backgroundColor: '#00FF66',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  scoreText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
  },
  vsBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  vsText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  matchTimeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
  },
  liveTimerSubPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  liveTimerSubText: {
    color: '#FF4D4D',
    fontSize: 10.5,
    fontWeight: '900',
  },
  countdownBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 7,
    borderRadius: 10,
  },
  countdownText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  centralManageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FF66',
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
    shadowColor: '#00FF66',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  centralManageBtnText: {
    color: '#000000',
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  dashEmptyMatchCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderStyle: 'dashed',
  },
  dashEmptyText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
});
