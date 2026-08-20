import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { triggerIosCrescendoHaptic } from '../utils/haptics';

export interface AppNotification {
  id: string;
  type: 'application' | 'update' | 'transfer' | 'system_warning' | 'system_error' | 'match';
  title: string;
  message: string;
  time: string;
  createdAt: number;
  isRead: boolean;
  targetTab?: 'applications' | 'updates' | 'transfers' | 'matches' | 'settings';
  targetSubTab?: 'players' | 'teams';
  rawItem?: any;
}

interface NotificationsScreenProps {
  onNavigate?: (tab: any, subTab?: any) => void;
  onGoBack?: () => void;
}

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  onNavigate,
  onGoBack,
}) => {
  const {
    currentOrg,
    orgId,
    userRole,
    isRegistrationOpen,
    transferWindowOpen,
    readNotificationIds,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    unreadNotificationsCount,
  } = useOrg();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'applications' | 'transfers' | 'system'>('all');

  const fetchLiveNotifications = async () => {
    try {
      const dbClient = supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;
      const notifs: AppNotification[] = [];

      // Read lastReadAllTime for this organization
      const rawLastReadTime = await AsyncStorage.getItem(`@amatora_last_read_all_time_${targetOrgId}`);
      const lastReadAllTime = rawLastReadTime ? parseInt(rawLastReadTime, 10) : 0;

      // 1. Fetch pending player applications
      let appQuery = dbClient
        .from('applications')
        .select('id, first_name, last_name, team_name, team_id, team:team_id(name), created_at, status, organization_id')
        .or('status.eq.pending,status.eq.kutilmoqda,status.eq.yangi,status.is.null')
        .order('created_at', { ascending: false })
        .limit(30);

      if (targetOrgId) {
        appQuery = appQuery.or(`organization_id.eq.${targetOrgId},organization_id.is.null`);
      }

      const { data: appsData } = await appQuery;

      if (appsData && appsData.length > 0) {
        appsData.forEach((app: any) => {
          const playerName = `${app.first_name || ''} ${app.last_name || ''}`.trim() || "Yangi o'yinchi";
          let teamName = app.team?.name || app.team_name || '';
          if (teamName && !isNaN(Number(teamName))) {
            teamName = `Jamoa #${teamName}`;
          }
          const team = teamName ? ` (${teamName})` : '';

          const notifId = `app_${app.id}`;
          const createdMs = new Date(app.created_at || Date.now()).getTime();
          const isItemRead = readNotificationIds.includes(notifId) || (lastReadAllTime > 0 && createdMs <= lastReadAllTime);

          notifs.push({
            id: notifId,
            type: 'application',
            title: "Yangi O'yinchi Arizasi 👤",
            message: `${playerName}${team} arizasi tasdiqlash uchun kutmoqda`,
            time: formatTimeAgo(app.created_at),
            createdAt: createdMs,
            isRead: isItemRead,
            targetTab: 'applications',
            targetSubTab: 'players',
            rawItem: app,
          });
        });
      }

      // 2. Fetch pending team applications
      try {
        let teamQuery = dbClient
          .from('teams')
          .select('id, name, logo_url, league, created_at, status')
          .in('status', ['pending', 'kutilmoqda'])
          .order('created_at', { ascending: false })
          .limit(10);

        if (targetOrgId) {
          teamQuery = teamQuery.or(`organization_id.eq.${targetOrgId},organization_id.is.null`);
        }

        const { data: pendingTeams } = await teamQuery;
        if (pendingTeams && pendingTeams.length > 0) {
          pendingTeams.forEach((t: any) => {
            const notifId = `team_app_${t.id}`;
            const createdMs = new Date(t.created_at || Date.now()).getTime();
            const isItemRead = readNotificationIds.includes(notifId) || (lastReadAllTime > 0 && createdMs <= lastReadAllTime);

            notifs.push({
              id: notifId,
              type: 'application',
              title: "Yangi Jamoa Arizasi 🛡️",
              message: `"${t.name || 'Jamoa'}" (${t.league || 'Liga'}) arizasi tasdiqlashni kutmoqda`,
              time: formatTimeAgo(t.created_at),
              createdAt: createdMs,
              isRead: isItemRead,
              targetTab: 'applications',
              targetSubTab: 'teams',
              rawItem: t,
            });
          });
        }
      } catch (e) {}

      // 3. Fetch pending transfers
      try {
        let transferQuery = dbClient
          .from('team_players')
          .select('id, player_id, team_id, created_at, status')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(10);

        const { data: transferData } = await transferQuery;
        if (transferData && transferData.length > 0) {
          transferData.forEach((t: any) => {
            const notifId = `transfer_${t.id}`;
            const createdMs = new Date(t.created_at || Date.now()).getTime();
            const isItemRead = readNotificationIds.includes(notifId) || (lastReadAllTime > 0 && createdMs <= lastReadAllTime);

            notifs.push({
              id: notifId,
              type: 'transfer',
              title: "Yangi Transfer So'rovi 🔄",
              message: "O'yinchi transfer o'tish arizasi ko'rib chiqishni kutmoqda",
              time: formatTimeAgo(t.created_at),
              createdAt: createdMs,
              isRead: isItemRead,
              targetTab: 'transfers',
              rawItem: t,
            });
          });
        }
      } catch (e) {}

      // 4. System status alerts
      if (!isRegistrationOpen && userRole !== 'user') {
        notifs.push({
          id: 'sys_reg_closed',
          type: 'system_warning',
          title: "Tizim Ogohlantirishi ⚠️",
          message: "Arizalar qabuli (Ro'yxatdan o'tish) hozirda YOPILGAN holatda",
          time: 'Faol',
          createdAt: Date.now() - 1000,
          isRead: readNotificationIds.includes('sys_reg_closed'),
          targetTab: 'settings',
        });
      }

      if (!transferWindowOpen && userRole !== 'user') {
        notifs.push({
          id: 'sys_transfer_closed',
          type: 'system_warning',
          title: "Transfer Holati ⚠️",
          message: "Transfer oynasi YOPILGAN — o'yinchilar ko'chishi to'xtatilgan",
          time: 'Faol',
          createdAt: Date.now() - 2000,
          isRead: readNotificationIds.includes('sys_transfer_closed'),
          targetTab: 'settings',
        });
      }

      // 5. Live Match updates
      try {
        let matchQuery = dbClient
          .from('matches')
          .select('id, location, status, home_score, away_score, league')
          .in('status', ['first_half', 'second_half', 'half_time'])
          .order('id', { ascending: false })
          .limit(5);

        if (targetOrgId) {
          matchQuery = matchQuery.eq('organization_id', targetOrgId);
        }

        const { data: liveMatches } = await matchQuery;
        if (liveMatches && liveMatches.length > 0) {
          liveMatches.forEach((m: any) => {
            notifs.push({
              id: `match_live_${m.id}`,
              type: 'match',
              title: `Jonli O'yin Ketmoqda ⚡`,
              message: `${m.league || 'Uchrashuv'} (${m.location || '1-Maydon'}): ${m.home_score || 0} - ${m.away_score || 0}`,
              time: 'Jonli Efir',
              createdAt: Date.now(),
              isRead: readNotificationIds.includes(`match_live_${m.id}`),
              targetTab: 'matches',
            });
          });
        }
      } catch (e) {}

      // Sort newest first
      notifs.sort((a, b) => b.createdAt - a.createdAt);
      setNotifications(notifs);
    } catch (err) {
      console.error('Error loading notifications:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchLiveNotifications();

    const targetOrgId = currentOrg?.id || orgId || 1;
    const channel = supabase
      .channel(`notifs_page_${targetOrgId}_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => {
        fetchLiveNotifications();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
        fetchLiveNotifications();
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (e) {}
    };
  }, [currentOrg?.id, orgId, isRegistrationOpen, transferWindowOpen, readNotificationIds]);

  const onRefresh = () => {
    setRefreshing(true);
    triggerIosCrescendoHaptic();
    fetchLiveNotifications();
  };

  const formatTimeAgo = (dateStr: string) => {
    if (!dateStr) return 'Yangi';
    try {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Hozirgina';
      if (diffMins < 60) return `${diffMins} daqiqa oldin`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} soat oldin`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} kun oldin`;
    } catch (e) {
      return 'Yangi';
    }
  };

  const handleMarkAllRead = async () => {
    triggerIosCrescendoHaptic();
    const allIds = notifications.map((n) => n.id);
    await markAllNotificationsAsRead(allIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const handleNotificationPress = async (item: AppNotification) => {
    triggerIosCrescendoHaptic();
    await markNotificationAsRead(item.id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n))
    );

    if (item.targetTab && onNavigate) {
      onNavigate(item.targetTab, item.targetSubTab);
    }
  };

  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'all') return notifications;
    if (activeFilter === 'applications') return notifications.filter((n) => n.type === 'application');
    if (activeFilter === 'transfers') return notifications.filter((n) => n.type === 'transfer');
    if (activeFilter === 'system') return notifications.filter((n) => n.type === 'system_warning' || n.type === 'system_error' || n.type === 'match');
    return notifications;
  }, [notifications, activeFilter]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const renderIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'application':
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(0, 255, 135, 0.12)', borderColor: 'rgba(0, 255, 135, 0.25)' }]}>
            <Ionicons name="person-add" size={20} color="#00FF87" />
          </View>
        );
      case 'transfer':
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.25)' }]}>
            <Ionicons name="swap-horizontal" size={20} color="#F59E0B" />
          </View>
        );
      case 'system_warning':
      case 'system_error':
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.25)' }]}>
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
          </View>
        );
      case 'match':
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(56, 189, 248, 0.12)', borderColor: 'rgba(56, 189, 248, 0.25)' }]}>
            <Ionicons name="football" size={20} color="#38BDF8" />
          </View>
        );
      default:
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(255, 255, 255, 0.08)', borderColor: 'rgba(255, 255, 255, 0.15)' }]}>
            <Ionicons name="notifications" size={20} color="#FFFFFF" />
          </View>
        );
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            triggerIosCrescendoHaptic();
            if (onGoBack) onGoBack();
            else if (onNavigate) onNavigate('dashboard');
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Bildirishnomalar</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadCountBadge}>
              <Text style={styles.unreadCountText}>{unreadCount}</Text>
            </View>
          )}
        </View>

        {notifications.length > 0 ? (
          <TouchableOpacity
            style={styles.markAllBtn}
            onPress={handleMarkAllRead}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-done" size={16} color="#00FF87" />
            <Text style={styles.markAllText}>O'qildi</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
          onPress={() => {
            triggerIosCrescendoHaptic();
            setActiveFilter('all');
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}>
            Barchasi ({notifications.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'applications' && styles.filterChipActive]}
          onPress={() => {
            triggerIosCrescendoHaptic();
            setActiveFilter('applications');
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterChipText, activeFilter === 'applications' && styles.filterChipTextActive]}>
            Arizalar ({notifications.filter((n) => n.type === 'application').length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'transfers' && styles.filterChipActive]}
          onPress={() => {
            triggerIosCrescendoHaptic();
            setActiveFilter('transfers');
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterChipText, activeFilter === 'transfers' && styles.filterChipTextActive]}>
            Transferlar
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'system' && styles.filterChipActive]}
          onPress={() => {
            triggerIosCrescendoHaptic();
            setActiveFilter('system');
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterChipText, activeFilter === 'system' && styles.filterChipTextActive]}>
            Tizim
          </Text>
        </TouchableOpacity>
      </View>

      {/* List Content */}
      {loading && notifications.length === 0 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#00FF87" />
          <Text style={styles.loadingLabel}>Yuklanmoqda...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00FF87" />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="notifications-off-outline" size={44} color="rgba(255,255,255,0.3)" />
              </View>
              <Text style={styles.emptyTitle}>Bildirishnomalar mavjud emas</Text>
              <Text style={styles.emptySub}>
                Yangi arizalar yoki tizim ogohlantirishlari bo'lsa, shu yerda ko'rinadi
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, !item.isRead && styles.cardUnread]}
              onPress={() => handleNotificationPress(item)}
              activeOpacity={0.75}
            >
              {renderIcon(item.type)}

              <View style={styles.cardBody}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.cardTime}>{item.time}</Text>
                </View>

                <Text style={styles.cardMessage} numberOfLines={2}>
                  {item.message}
                </Text>

                {item.targetTab && (
                  <View style={styles.cardActionRow}>
                    <Text style={styles.cardActionText}>Ko'rish uchun bosing</Text>
                    <Ionicons name="chevron-forward" size={13} color="#00FF87" />
                  </View>
                )}
              </View>

              {!item.isRead && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: 10,
    paddingBottom: 90, // for bottom navbar spacing
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  unreadCountBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  unreadCountText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 255, 135, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 135, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
  },
  markAllText: {
    color: '#00FF87',
    fontSize: 12,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterChipActive: {
    backgroundColor: '#00FF87',
    borderColor: '#00FF87',
  },
  filterChipText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 30,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    gap: 12,
  },
  cardUnread: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(0, 255, 135, 0.25)',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  cardTime: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
    fontWeight: '500',
  },
  cardMessage: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 12.5,
    lineHeight: 17,
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  cardActionText: {
    color: '#00FF87',
    fontSize: 11,
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00FF87',
    shadowColor: '#00FF87',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  loadingLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptySub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 28,
  },
});
