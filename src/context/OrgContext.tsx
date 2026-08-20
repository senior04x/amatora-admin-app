import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { AppState, Animated, TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabaseClient';
import { triggerIosCrescendoHaptic } from '../utils/haptics';

interface ToastOptions {
  message: string;
  type?: 'success' | 'warning' | 'error' | 'info';
  duration?: number;
}

interface OrgContextType {
  orgId: number;
  currentOrg: any;
  loading: boolean;
  userRole: 'org_admin' | 'user';
  setUserRole: (role: 'org_admin' | 'user') => void;
  currentUser: any;
  setCurrentUser: (user: any) => void;
  updateCurrentUserLocally: (fields: Partial<any>) => void;
  refreshCurrentUser: () => Promise<void>;
  transferWindowOpen: boolean;
  setTransferWindowOpen: (val: boolean) => void;
  toggleTransferWindow: (val: boolean) => Promise<void>;
  isRegistrationOpen: boolean;
  setIsRegistrationOpen: (val: boolean) => void;
  toggleRegistrationStatus: (val: boolean) => Promise<void>;
  refreshOrg: () => Promise<void>;
  updateOrgLocally: (fields: Partial<any>) => void;
  collabLeagueIds: number[];
  collabLeagueNames: string[];
  showToast: (opts: ToastOptions) => void;
  unreadNotificationsCount: number;
  readNotificationIds: string[];
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: (allIds: string[]) => Promise<void>;
  refreshNotificationsCount: () => Promise<void>;
}

const OrgContext = createContext<OrgContextType | null>(null);

export const useOrg = () => {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
};

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [orgId, setOrgId] = useState<number>(1);
  const [currentOrg, setCurrentOrg] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<'org_admin' | 'user'>('org_admin');
  const [transferWindowOpen, setTransferWindowOpen] = useState<boolean>(false);
  const [isRegistrationOpen, setIsRegistrationOpen] = useState<boolean>(true);
  const [collabLeagueIds, setCollabLeagueIds] = useState<number[]>([]);
  const [collabLeagueNames, setCollabLeagueNames] = useState<string[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);

  // Toast state & animation
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'warning' | 'error' | 'info';
  }>({
    visible: false,
    message: '',
    type: 'success',
  });

  const translateY = useRef(new Animated.Value(-120)).current;
  const hideTimer = useRef<any>(null);

  const showToast = ({ message, type = 'success', duration = 3000 }: ToastOptions) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);

    setToast({ visible: true, message, type });

    translateY.setValue(-120);
    Animated.spring(translateY, {
      toValue: 50,
      useNativeDriver: true,
      friction: 8,
      tension: 50,
    }).start();

    hideTimer.current = setTimeout(() => {
      hideToast();
    }, duration);
  };

  const hideToast = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(translateY, {
      toValue: -120,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    });
  };

  const updateCurrentUserLocally = (fields: Partial<any>) => {
    setCurrentUser((prev: any) => ({ ...prev, ...fields }));
  };

  const fetchCurrentUser = async () => {
    try {
      const dbClient = supabase;
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionEmail = sessionData?.session?.user?.email;

      if (sessionEmail) {
        const { data: uRec } = await dbClient
          .from('organization_users')
          .select('*')
          .ilike('email', sessionEmail)
          .maybeSingle();

        if (uRec) {
          setCurrentUser(uRec);
        }
      }
    } catch (e) {
      console.error('Fetch currentUser error:', e);
    }
  };

  const fetchOrg = async () => {
    try {
      const dbClient = supabase;
      let targetOrgId = orgId || 1;

      // Read stored role & orgId from AsyncStorage
      const storedRole = await AsyncStorage.getItem('@amatora_user_role');
      if (storedRole === 'user') {
        setUserRole('user');
        await fetchCurrentUser();
      } else {
        setUserRole('org_admin');
      }

      const storedOrgId = await AsyncStorage.getItem('@amatora_org_id');
      if (storedOrgId) {
        const parsedId = parseInt(storedOrgId, 10);
        if (!isNaN(parsedId)) {
          targetOrgId = parsedId;
          setOrgId(parsedId);
        }
      }

      // 0. Get user session to find their true organization if org_admin
      if (storedRole !== 'user') {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          const { data: userOrg } = await dbClient
            .from('organizations')
            .select('id')
            .eq('admin_email', session.user.email)
            .single();
          
          if (userOrg?.id) {
            targetOrgId = userOrg.id;
            if (targetOrgId !== orgId) {
              setOrgId(targetOrgId);
            }
          }
        }
      }

      // 1. Fetch organization record
      const { data } = await dbClient
        .from('organizations')
        .select('*')
        .eq('id', targetOrgId)
        .maybeSingle();

      if (data) {
        // Merge data
        const mergedOrg = {
          ...data,
          email: data.admin_email || data.email || '',
          phone: data.contact_phone || data.phone || '',
        };

        setCurrentOrg(mergedOrg);

        setCurrentOrg(mergedOrg);
        if (data.transfer_window_open !== null && data.transfer_window_open !== undefined) {
          setTransferWindowOpen(!!data.transfer_window_open);
        }
      }

      // 3. Fetch registration status from sponsors KV table for this specific org
      const currentOrgId = targetOrgId || 1;
      const { data: spReg } = await dbClient
        .from('sponsors')
        .select('logo_url')
        .eq('name', `REGISTRATION_OPEN_${currentOrgId}`)
        .maybeSingle();

      if (spReg && spReg.logo_url !== null && spReg.logo_url !== undefined) {
        setIsRegistrationOpen(spReg.logo_url === 'true');
      } else if (data && data.is_registration_open !== null && data.is_registration_open !== undefined) {
        setIsRegistrationOpen(!!data.is_registration_open);
      } else {
        setIsRegistrationOpen(true);
      }

      // 4. Fetch Collab Leagues
      try {
        const { data: myCollabs } = await dbClient
          .from('league_collabs')
          .select('league_id, leagues(name)')
          .eq('status', 'accepted')
          .or(`sender_org_id.eq.${targetOrgId},receiver_org_id.eq.${targetOrgId}`);

        if (myCollabs && myCollabs.length > 0) {
          const ids = myCollabs.map((c: any) => c.league_id).filter(Boolean);
          const names = myCollabs.map((c: any) => c.leagues?.name).filter(Boolean);
          setCollabLeagueIds(ids);
          setCollabLeagueNames(names);
        } else {
          setCollabLeagueIds([]);
          setCollabLeagueNames([]);
        }
      } catch (err) {
        console.error('Collab leagues error:', err);
      }
    } catch (err) {
      console.error('Org load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTransferWindow = async (val: boolean) => {
    const prev = transferWindowOpen;
    setTransferWindowOpen(val);
    try {
      const dbClient = supabase;
      const { error } = await dbClient.from('organizations').update({ transfer_window_open: val }).eq('id', orgId || 1);
      if (error) throw error;

      showToast({
        message: val ? "Transfer oynasi OCHILDI" : "Transfer oynasi YOPILDI",
        type: val ? 'success' : 'warning',
      });
    } catch (err: any) {
      console.error('Toggle transfer error:', err);
      setTransferWindowOpen(prev);
      showToast({
        message: `Xatolik: ${err?.message || "O'zgartirish saqlanmadi"}`,
        type: 'error',
      });
    }
  };

  const toggleRegistrationStatus = async (val: boolean) => {
    const prev = isRegistrationOpen;
    setIsRegistrationOpen(val);
    const currentOrgId = orgId || 1;

    try {
      const dbClient = supabase;

      // Primary DB Column: Update organizations.is_registration_open
      const { error } = await dbClient.from('organizations').update({ is_registration_open: val }).eq('id', currentOrgId);
      if (error) {
        console.warn('Update organizations.is_registration_open warn:', error);
      }

      // Sync sponsors KV fallback for backwards compatibility
      try {
        const key = `REGISTRATION_OPEN_${currentOrgId}`;
        const { data: ex } = await dbClient.from('sponsors').select('id').eq('name', key).maybeSingle();
        if (ex) {
          await dbClient.from('sponsors').update({ logo_url: val ? 'true' : 'false' }).eq('id', ex.id);
        } else {
          await dbClient.from('sponsors').insert({ name: key, logo_url: val ? 'true' : 'false', organization_id: currentOrgId });
        }
      } catch (e) {}

      showToast({
        message: val ? "Ro'yxatdan o'tish OCHILDI" : "Ro'yxatdan o'tish YOPILDI",
        type: val ? 'success' : 'warning',
      });
    } catch (err: any) {
      console.error('Toggle reg status error:', err);
      setIsRegistrationOpen(prev);
      showToast({
        message: `Xatolik: ${err?.message || "O'zgartirish saqlanmadi"}`,
        type: 'error',
      });
    }
  };

  useEffect(() => {
    fetchOrg();

    // Single fluent chain for Realtime listeners
    const targetOrgId = orgId || 1;
    const channel = supabase
      .channel(`app_rt_status_${targetOrgId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'organizations' },
        (payload: any) => {
          if (payload.new && payload.new.id === targetOrgId) {
            if (payload.new.is_registration_open !== null && payload.new.is_registration_open !== undefined) {
              setIsRegistrationOpen(!!payload.new.is_registration_open);
            }
            if (payload.new.transfer_window_open !== null && payload.new.transfer_window_open !== undefined) {
              setTransferWindowOpen(!!payload.new.transfer_window_open);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sponsors' },
        (payload: any) => {
          if (payload.new && payload.new.name === `REGISTRATION_OPEN_${targetOrgId}`) {
            setIsRegistrationOpen(payload.new.logo_url === 'true');
          }
        }
      );

    channel.subscribe();

    let appStateSub: any = null;
    if (typeof AppState !== 'undefined' && AppState && AppState.addEventListener) {
      try {
        appStateSub = AppState.addEventListener('change', (nextAppState) => {
          if (nextAppState === 'active') {
            fetchOrg();
          }
        });
      } catch (e) {}
    }

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (e) {}
      if (appStateSub && appStateSub.remove) {
        try {
          appStateSub.remove();
        } catch (e) {}
      }
    };
  }, [orgId]);

  // Load cached read notification IDs on mount & listen to changes
  useEffect(() => {
    const initReadNotifications = async () => {
      try {
        const raw = await AsyncStorage.getItem('@amatora_read_notif_ids');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setReadNotificationIds(parsed);
            fetchLiveUnreadCount(parsed);
            return;
          }
        }
      } catch (e) {}
      fetchLiveUnreadCount([]);
    };

    initReadNotifications();

    const targetOrgId = currentOrg?.id || orgId || 1;
    const channel = supabase
      .channel(`org_notif_channel_${targetOrgId}_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => {
        fetchLiveUnreadCount();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
        fetchLiveUnreadCount();
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (e) {}
    };
  }, [orgId, currentOrg?.id]);

  const fetchLiveUnreadCount = async (knownReadIds?: string[]) => {
    try {
      const dbClient = supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;
      const readList = knownReadIds || readNotificationIds;

      let appQuery = dbClient
        .from('applications')
        .select('id')
        .or('status.eq.pending,status.eq.kutilmoqda,status.eq.yangi,status.is.null');

      if (targetOrgId) {
        appQuery = appQuery.or(`organization_id.eq.${targetOrgId},organization_id.is.null`);
      }

      const { data: apps } = await appQuery;

      let teamQuery = dbClient
        .from('teams')
        .select('id')
        .in('status', ['pending', 'kutilmoqda']);

      if (targetOrgId) {
        teamQuery = teamQuery.or(`organization_id.eq.${targetOrgId},organization_id.is.null`);
      }

      const { data: teams } = await teamQuery;

      const appIds = (apps || []).map((a: any) => `app_${a.id}`);
      const teamIds = (teams || []).map((t: any) => `team_app_${t.id}`);
      const allActiveNotifIds = [...appIds, ...teamIds];

      const unread = allActiveNotifIds.filter((id) => !readList.includes(id)).length;
      setUnreadNotificationsCount(unread);
    } catch (e) {}
  };

  const markNotificationAsRead = async (id: string) => {
    try {
      const next = Array.from(new Set([...readNotificationIds, id]));
      setReadNotificationIds(next);
      await AsyncStorage.setItem('@amatora_read_notif_ids', JSON.stringify(next));
      setUnreadNotificationsCount((prev) => Math.max(0, prev - 1));
    } catch (e) {}
  };

  const markAllNotificationsAsRead = async (allIds: string[]) => {
    try {
      const next = Array.from(new Set([...readNotificationIds, ...allIds]));
      setReadNotificationIds(next);
      await AsyncStorage.setItem('@amatora_read_notif_ids', JSON.stringify(next));
      setUnreadNotificationsCount(0);
    } catch (e) {}
  };

  const updateOrgLocally = (fields: Partial<any>) => {
    if (fields.brand_colors) {
      triggerIosCrescendoHaptic();
    }
    setCurrentOrg((prev: any) => ({ ...prev, ...fields }));
  };

  return (
    <OrgContext.Provider
      value={{
        orgId,
        currentOrg,
        currentUser,
        setCurrentUser,
        updateCurrentUserLocally,
        refreshCurrentUser: fetchCurrentUser,
        loading,
        userRole,
        setUserRole,
        transferWindowOpen,
        setTransferWindowOpen,
        toggleTransferWindow,
        isRegistrationOpen,
        setIsRegistrationOpen,
        toggleRegistrationStatus,
        refreshOrg: fetchOrg,
        updateOrgLocally,
        collabLeagueIds,
        collabLeagueNames,
        showToast,
        unreadNotificationsCount,
        readNotificationIds,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        refreshNotificationsCount: fetchLiveUnreadCount,
      }}
    >
      {children}

      {/* Floating Top Toast Banner */}
      {toast.visible && (
        <Animated.View
          style={[
            styles.toastContainer,
            { transform: [{ translateY }] },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity activeOpacity={0.9} onPress={hideToast}>
            <BlurView intensity={90} tint="dark" style={styles.toastBlur}>
              <View
                style={[
                  styles.toastIconBox,
                  toast.type === 'success' && { backgroundColor: 'rgba(0, 255, 135, 0.2)' },
                  toast.type === 'warning' && { backgroundColor: 'rgba(255, 149, 0, 0.2)' },
                  toast.type === 'error' && { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
                  toast.type === 'info' && { backgroundColor: 'rgba(56, 189, 248, 0.2)' },
                ]}
              >
                <Ionicons
                  name={
                    toast.type === 'success'
                      ? 'checkmark-circle'
                      : toast.type === 'warning'
                      ? 'lock-closed'
                      : toast.type === 'error'
                      ? 'alert-circle'
                      : 'information-circle'
                  }
                  size={18}
                  color={
                    toast.type === 'success'
                      ? '#00FF87'
                      : toast.type === 'warning'
                      ? '#FF9500'
                      : toast.type === 'error'
                      ? '#EF4444'
                      : '#38BDF8'
                  }
                />
              </View>
              <Text style={styles.toastText} numberOfLines={2}>
                {toast.message}
              </Text>
            </BlurView>
          </TouchableOpacity>
        </Animated.View>
      )}
    </OrgContext.Provider>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    zIndex: 999999,
    alignItems: 'center',
  },
  toastBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 20,
    gap: 10,
    maxWidth: '100%',
  },
  toastIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
});
