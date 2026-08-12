import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Animated, RefreshControl, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';

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
  const [counts, setCounts] = useState({ players: 0, leagues: 0, teams: 0, applications: 0, pendingTeams: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchDashboardCounts();
  }, [orgId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDashboardCounts(true);
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

      const [playersRes, leaguesRes, teamsRes, approvedAppsRes, pendingAppsRes, pendingTeamsRes] = await Promise.all([
        playersQuery,
        leaguesQuery,
        teamsQuery,
        approvedAppsQuery,
        pendingAppsQuery,
        pendingTeamsQuery,
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
      });
    } catch (e) {
      console.error('Fetch dashboard counts error:', e);
    } finally {
      setLoading(false);
    }
  };

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
            <Ionicons name={item.icon as any} size={28} color={item.color} style={{ marginBottom: 8 }} />
            <Text style={styles.gridCardTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
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
});
