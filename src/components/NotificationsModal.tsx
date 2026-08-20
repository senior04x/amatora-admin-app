import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { triggerIosCrescendoHaptic } from '../utils/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface AppNotification {
  id: string;
  type: 'application' | 'update' | 'transfer' | 'system_warning' | 'system_error' | 'match';
  title: string;
  message: string;
  time: string;
  createdAt: number;
  isRead: boolean;
  targetTab?: 'applications' | 'updates' | 'transfers' | 'matches' | 'settings';
}

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  onNavigate?: (tab: any) => void;
  onUnreadCountChange?: (count: number) => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  visible,
  onClose,
  onNavigate,
  onUnreadCountChange,
}) => {
  const { currentOrg, orgId, userRole, isRegistrationOpen, transferWindowOpen, showToast } = useOrg();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const slideAnim = React.useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      triggerIosCrescendoHaptic();
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 65,
          useNativeDriver: true,
        }),
      ]).start();
      fetchLiveNotifications();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const fetchLiveNotifications = async () => {
    try {
      setLoading(true);
      const dbClient = supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;
      const notifs: AppNotification[] = [];

      // 1. Fetch pending new player applications (O'yinchi Arizalari)
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
          const timeAgo = formatTimeAgo(app.created_at);

          notifs.push({
            id: `app_${app.id}`,
            type: 'application',
            title: "Yangi O'yinchi Arizasi 👤",
            message: `${playerName}${team} arizasi tasdiqlash uchun kutmoqda`,
            time: timeAgo,
            createdAt: new Date(app.created_at || Date.now()).getTime(),
            isRead: readIds.has(`app_${app.id}`),
            targetTab: 'applications',
          });
        });
      }

      // 1b. Fetch pending team applications (Jamoa Arizalari)
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
            notifs.push({
              id: `team_app_${t.id}`,
              type: 'application',
              title: "Yangi Jamoa Arizasi 🛡️",
              message: `"${t.name || 'Jamoa'}" (${t.league || 'Liga'}) arizasi tasdiqlashni kutmoqda`,
              time: formatTimeAgo(t.created_at),
              createdAt: new Date(t.created_at || Date.now()).getTime(),
              isRead: readIds.has(`team_app_${t.id}`),
              targetTab: 'applications',
            });
          });
        }
      } catch (e) {}

      // 2. Fetch pending transfers if available
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
            notifs.push({
              id: `transfer_${t.id}`,
              type: 'transfer',
              title: "Yangi Transfer So'rovi",
              message: "O'yinchi transfer o'tish arizasi ko'rib chiqishni kutmoqda",
              time: formatTimeAgo(t.created_at),
              createdAt: new Date(t.created_at || Date.now()).getTime(),
              isRead: readIds.has(`transfer_${t.id}`),
              targetTab: 'transfers',
            });
          });
        }
      } catch (e) {}

      // 3. System Alerts / Errors / Warnings (Tizim xatolari va ogohlantirishlari)
      if (!isRegistrationOpen && userRole !== 'user') {
        notifs.push({
          id: 'sys_reg_closed',
          type: 'system_warning',
          title: "Tizim Ogohlantirishi",
          message: "Arizalar qabuli (Ro'yxatdan o'tish) hozirda YOPILGAN holatda",
          time: 'Faol',
          createdAt: Date.now() - 1000,
          isRead: readIds.has('sys_reg_closed'),
          targetTab: 'settings',
        });
      }

      if (!transferWindowOpen && userRole !== 'user') {
        notifs.push({
          id: 'sys_transfer_closed',
          type: 'system_warning',
          title: "Transfer Holati",
          message: "Transfer oynasi YOPILGAN — o'yinchilar ko'chishi to'xtatilgan",
          time: 'Faol',
          createdAt: Date.now() - 2000,
          isRead: readIds.has('sys_transfer_closed'),
          targetTab: 'settings',
        });
      }

      // 4. Check for incomplete or live matches needing attention
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
              isRead: readIds.has(`match_live_${m.id}`),
              targetTab: 'matches',
            });
          });
        }
      } catch (e) {}

      // Sort newest first
      notifs.sort((a, b) => b.createdAt - a.createdAt);

      setNotifications(notifs);

      // Unread count
      const unreadCount = notifs.filter((n) => !n.isRead).length;
      if (onUnreadCountChange) {
        onUnreadCountChange(unreadCount);
      }
    } catch (err) {
      console.error('Error loading live notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  // Realtime subscription for instant background notification updates
  useEffect(() => {
    const targetOrgId = currentOrg?.id || orgId || 1;
    const channel = supabase
      .channel(`notifs_rt_${targetOrgId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'applications' },
        (payload: any) => {
          fetchLiveNotifications();
          if (payload?.eventType === 'INSERT') {
            const newApp = payload.new;
            const pName = `${newApp?.first_name || ''} ${newApp?.last_name || ''}`.trim() || "Yangi o'yinchi";
            const team = newApp?.team_name ? ` (${newApp.team_name})` : '';

            showToast({
              message: `Yangi ariza: ${pName}${team} kelib tushdi! 🔔`,
              type: 'info',
              duration: 4000,
            });

            try {
              Notifications.scheduleNotificationAsync({
                content: {
                  title: "Yangi O'yinchi Arizasi! ⚽",
                  body: `${pName}${team} ro'yxatdan o'tish arizasini yubordi.`,
                  sound: 'default',
                  data: { type: 'new_application', id: newApp?.id },
                },
                trigger: null,
              });
            } catch (e) {}
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teams' },
        (payload: any) => {
          fetchLiveNotifications();
          if (payload?.eventType === 'INSERT') {
            const newTeam = payload.new;
            showToast({
              message: `Yangi jamoa arizasi: "${newTeam?.name || 'Jamoa'}" kelib tushdi! 🛡️`,
              type: 'info',
              duration: 4000,
            });

            try {
              Notifications.scheduleNotificationAsync({
                content: {
                  title: "Yangi Jamoa Arizasi! 🛡️",
                  body: `"${newTeam?.name || 'Jamoa'}" arizasi tasdiqlash uchun kutmoqda.`,
                  sound: 'default',
                  data: { type: 'new_application', id: newTeam?.id },
                },
                trigger: null,
              });
            } catch (e) {}
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          fetchLiveNotifications();
        }
      )
      .subscribe();

    fetchLiveNotifications();

    const interval = setInterval(fetchLiveNotifications, 15000);

    return () => {
      clearInterval(interval);
      try {
        supabase.removeChannel(channel);
      } catch (e) {}
    };
  }, [currentOrg?.id, orgId, isRegistrationOpen, transferWindowOpen]);

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

  const handleMarkAllRead = () => {
    triggerIosCrescendoHaptic();
    const allIds = new Set(notifications.map((n) => n.id));
    setReadIds(allIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    if (onUnreadCountChange) onUnreadCountChange(0);
  };

  const handleNotificationPress = (item: AppNotification) => {
    triggerIosCrescendoHaptic();
    setReadIds((prev) => new Set([...prev, item.id]));
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n))
    );

    if (onUnreadCountChange) {
      const remainingUnread = notifications.filter(
        (n) => n.id !== item.id && !n.isRead
      ).length;
      onUnreadCountChange(remainingUnread);
    }

    onClose();
    if (item.targetTab && onNavigate) {
      onNavigate(item.targetTab);
    }
  };

  const renderIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'application':
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(0, 255, 135, 0.15)', borderColor: 'rgba(0, 255, 135, 0.3)' }]}>
            <Ionicons name="person-add" size={20} color="#00FF87" />
          </View>
        );
      case 'transfer':
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.3)' }]}>
            <Ionicons name="swap-horizontal" size={20} color="#F59E0B" />
          </View>
        );
      case 'system_warning':
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
          </View>
        );
      case 'match':
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.3)' }]}>
            <Ionicons name="football" size={20} color="#38BDF8" />
          </View>
        );
      default:
        return (
          <View style={[styles.iconBox, { backgroundColor: 'rgba(255, 255, 255, 0.1)', borderColor: 'rgba(255, 255, 255, 0.2)' }]}>
            <Ionicons name="notifications" size={20} color="#FFFFFF" />
          </View>
        );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        {/* Animated Dim Backdrop */}
        <Animated.View
          style={[styles.backdrop, { opacity: fadeAnim }]}
          pointerEvents="auto"
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={onClose}
          />
        </Animated.View>

        {/* Sliding Notification Sheet */}
        <Animated.View
          style={[
            styles.sheetContainer,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* iOS Blur or Android Deep Glass Slate Container */}
          {Platform.OS === 'ios' ? (
            <BlurView intensity={85} tint="dark" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={styles.androidSolidBackdrop} />
          )}

          {/* Sheet Header */}
          <View style={styles.sheetHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.bellIconHeader}>
                <Ionicons name="notifications" size={18} color="#00FF87" />
              </View>
              <Text style={styles.headerTitleText}>Bildirishnomalar</Text>
              {notifications.filter((n) => !n.isRead).length > 0 && (
                <View style={styles.headerBadgeCount}>
                  <Text style={styles.headerBadgeText}>
                    {notifications.filter((n) => !n.isRead).length}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {notifications.length > 0 && (
                <TouchableOpacity
                  style={styles.markReadBtn}
                  onPress={handleMarkAllRead}
                  activeOpacity={0.7}
                >
                  <Text style={styles.markReadText}>Hammasi o'qildi</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Sheet Content / List */}
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {loading && notifications.length === 0 ? (
              <View style={styles.emptyContainer}>
                <ActivityIndicator size="small" color="#00FF87" />
                <Text style={styles.loadingText}>Yuklanmoqda...</Text>
              </View>
            ) : notifications.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="notifications-off-outline" size={36} color="rgba(255, 255, 255, 0.4)" />
                </View>
                <Text style={styles.emptyTitle}>Yangi bildirishnomalar yo'q</Text>
                <Text style={styles.emptySubtitle}>
                  Tizim yoki yangi arizalar kelib tushganda shu yerda ko'rinadi
                </Text>
              </View>
            ) : (
              notifications.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.notifCard,
                    !item.isRead && styles.notifCardUnread,
                  ]}
                  activeOpacity={0.75}
                  onPress={() => handleNotificationPress(item)}
                >
                  {renderIcon(item.type)}

                  <View style={styles.notifTextCol}>
                    <View style={styles.notifTopRow}>
                      <Text style={styles.notifTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.notifTime}>{item.time}</Text>
                    </View>

                    <Text style={styles.notifMessage} numberOfLines={2}>
                      {item.message}
                    </Text>
                  </View>

                  {!item.isRead && <View style={styles.unreadDot} />}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  sheetContainer: {
    width: '100%',
    maxHeight: SCREEN_HEIGHT * 0.82,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderBottomWidth: 0,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 25,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  androidSolidBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 8, 14, 0.94)',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bellIconHeader: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 255, 135, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerBadgeCount: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 2,
  },
  headerBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  markReadBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  markReadText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listScroll: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 10,
  },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    gap: 12,
  },
  notifCardUnread: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(0, 255, 135, 0.25)',
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifTextCol: {
    flex: 1,
    gap: 3,
  },
  notifTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notifTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  notifTime: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
    fontWeight: '500',
  },
  notifMessage: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    lineHeight: 16,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 45,
    gap: 8,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
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
  emptySubtitle: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    marginTop: 6,
  },
});
