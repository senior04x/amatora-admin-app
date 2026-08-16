import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Modal,
  ScrollView,
  PanResponder,
  Alert,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';

interface Props {
  initialTab?: 'players' | 'teams';
  onNavigate?: (tab: any) => void;
}

// Shimmer Skeleton Loader Component
const SkeletonCard = () => {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <Animated.View style={[styles.skeletonCard, { opacity: pulseAnim }]}>
      <View style={styles.skeletonAvatar} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={styles.skeletonTitleLine} />
        <View style={styles.skeletonSubLine} />
      </View>
    </Animated.View>
  );
};

// Swipeable Card Wrapper for Swipe-to-Delete Action
const SwipeableCard: React.FC<{
  children: React.ReactNode;
  onDelete: () => void;
}> = ({ children, onDelete }) => {
  const pan = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 12 && Math.abs(gestureState.dy) < 12;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          pan.setValue(Math.max(gestureState.dx, -100));
        } else if (gestureState.dx > 0) {
          pan.setValue(Math.min(gestureState.dx, 0));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -35) {
          Animated.spring(pan, {
            toValue: -90,
            useNativeDriver: true,
            friction: 7,
          }).start();
        } else {
          Animated.spring(pan, {
            toValue: 0,
            useNativeDriver: true,
            friction: 7,
          }).start();
        }
      },
    })
  ).current;

  const resetSwipe = () => {
    Animated.spring(pan, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={{ position: 'relative', marginBottom: 10, borderRadius: 16, overflow: 'hidden' }}>
      {/* Full Behind Background Red Action Card */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#EF4444',
          borderRadius: 16,
          flexDirection: 'row',
          justifyContent: 'flex-end',
          alignItems: 'center',
        }}
      >
        <TouchableOpacity
          style={{
            width: 90,
            height: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 3,
          }}
          onPress={() => {
            resetSwipe();
            onDelete();
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="trash" size={24} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>O'chirish</Text>
        </TouchableOpacity>
      </View>

      {/* Sliding Foreground Main Card */}
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: [{ translateX: pan }],
          backgroundColor: '#121212',
          borderRadius: 16,
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
};

export const ApplicationsScreen: React.FC<Props> = ({ initialTab = 'players', onNavigate }) => {
  const { orgId, collabLeagueNames } = useOrg();
  const [activeTab, setActiveTab] = useState<'players' | 'teams'>(initialTab);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dbCounts, setDbCounts] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });

  // Pagination Constants
  const PLAYER_PAGE_SIZE = 20;
  const TEAM_PAGE_SIZE = 10;

  const [playerPage, setPlayerPage] = useState(0);
  const [teamPage, setTeamPage] = useState(0);
  const [hasMorePlayerApps, setHasMorePlayerApps] = useState(true);
  const [hasMoreTeamApps, setHasMoreTeamApps] = useState(true);

  // Raw Data State
  const [playerApps, setPlayerApps] = useState<any[]>([]);
  const [teamApps, setTeamApps] = useState<any[]>([]);
  const [teamsMap, setTeamsMap] = useState<Map<any, any>>(new Map());
  const [leagues, setLeagues] = useState<any[]>([]);

  // Filters State
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'qisman'>('all');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showLeagueDropdown, setShowLeagueDropdown] = useState(false);

  // Fullscreen Image Lightbox Modal State
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // Detail Modal State
  const [selectedDetailItem, setSelectedDetailItem] = useState<any | null>(null);
  const [loadingTeamRoster, setLoadingTeamRoster] = useState(false);
  const [teamRosterPlayers, setTeamRosterPlayers] = useState<any[]>([]);

  // Fetch Team's Players directly from DB when a team card is clicked
  const fetchTeamRoster = async (teamItem: any) => {
    if (!teamItem || teamItem.isPlayer) return;
    setLoadingTeamRoster(true);
    setTeamRosterPlayers([]);
    try {
      const dbClient = supabase;
      const teamId = teamItem.id;
      const teamName = teamItem.name ? teamItem.name.trim() : '';

      let rawApps: any[] = [];
      let playersData: any[] = [];

      // 1a. Fetch applications by team_id
      if (teamId) {
        try {
          const { data: appById } = await dbClient
            .from('applications')
            .select('*')
            .eq('team_id', teamId);
          if (appById) rawApps.push(...appById);
        } catch (e) {}
      }

      // 1b. Fetch applications by team_name if available
      if (teamName) {
        try {
          const { data: appByName } = await dbClient
            .from('applications')
            .select('*')
            .ilike('team_name', teamName);
          if (appByName) {
            appByName.forEach((item: any) => {
              if (!rawApps.some((existing) => existing.id === item.id)) {
                rawApps.push(item);
              }
            });
          }
        } catch (e) {}
      }

      // 2a. Fetch players by team_id
      if (teamId) {
        try {
          const { data: pById } = await dbClient
            .from('players')
            .select('*')
            .eq('team_id', teamId);
          if (pById) playersData.push(...pById);
        } catch (e) {}
      }

      // 2b. Fetch players by team_name
      if (teamName) {
        try {
          const { data: pByName } = await dbClient
            .from('players')
            .select('*')
            .ilike('team_name', teamName);
          if (pByName) {
            pByName.forEach((item: any) => {
              if (!playersData.some((existing) => existing.id === item.id)) {
                playersData.push(item);
              }
            });
          }
        } catch (e) {}
      }

      // 2c. Fetch players via team_players join table
      if (teamId) {
        try {
          const { data: tpData } = await dbClient
            .from('team_players')
            .select('player_id, players(*)')
            .eq('team_id', teamId);
          if (tpData) {
            tpData.forEach((row: any) => {
              if (row.players && !playersData.some((existing) => existing.id === row.players.id)) {
                playersData.push(row.players);
              }
            });
          }
        } catch (e) {}
      }

      // Filter applications (exclude profile updates)
      const validApps = rawApps.filter(
        (p: any) => !p.comment || !p.comment.includes('[PROFILE_UPDATE]')
      );

      // Map of players to avoid duplicates
      const map = new Map<string, any>();

      validApps.forEach((p: any) => {
        const key = p.id ? `app_${p.id}` : (p.passport_id || p.full_name || p.name);
        map.set(String(key), { ...p, isFromAppTable: true });
      });

      playersData.forEach((p: any) => {
        const pName = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
        let existingKey = Array.from(map.keys()).find((k) => {
          const item = map.get(k);
          return (
            (p.passport_id && item.passport_id === p.passport_id) ||
            (pName && (item.full_name === pName || item.name === pName))
          );
        });

        if (!existingKey) {
          map.set(`player_${p.id}`, {
            id: p.id,
            full_name: pName,
            photo_url: p.avatar_url || p.photo_url,
            position: p.position || 'O\'yinchi',
            status: p.status || 'approved',
            team_id: p.team_id || teamId,
            team_name: p.team_name || teamName,
            isFromPlayersTable: true,
          });
        }
      });

      setTeamRosterPlayers(Array.from(map.values()));
    } catch (err) {
      console.error('Fetch team roster error:', err);
      setTeamRosterPlayers([]);
    } finally {
      setLoadingTeamRoster(false);
    }
  };

  const openDetailModal = (item: any, isPlayer: boolean) => {
    setSelectedDetailItem({ ...item, isPlayer });
    if (!isPlayer) {
      fetchTeamRoster(item);
    }
  };

  // Status Change Overlay State for Roster Player
  const [statusPickerPlayer, setStatusPickerPlayer] = useState<any | null>(null);

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(-40)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    slideAnim.setValue(-40);
    opacityAnim.setValue(0);

    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 80,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    toastTimeoutRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -30,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setToastMessage(null));
    }, 2800);
  };

  const fetchDbCounts = async () => {
    try {
      const dbClient = supabase;
      const table = activeTab === 'players' ? 'applications' : 'teams';
      
      const baseQuery = dbClient.from(table).select('*', { count: 'exact', head: true });
      if (orgId) {
        baseQuery.eq('organization_id', orgId);
      }
      
      const pendingQ = dbClient.from(table).select('*', { count: 'exact', head: true }).in('status', ['pending', 'kutilmoqda']);
      if (orgId) pendingQ.eq('organization_id', orgId);

      const approvedQ = dbClient.from(table).select('*', { count: 'exact', head: true }).in('status', ['approved', 'tasdiqlangan', 'partially_approved', 'qisman']);
      if (orgId) approvedQ.eq('organization_id', orgId);

      const rejectedQ = dbClient.from(table).select('*', { count: 'exact', head: true }).in('status', ['rejected', 'rad etilgan', 'rad_etilgan']);
      if (orgId) rejectedQ.eq('organization_id', orgId);

      const [totalRes, pendingRes, approvedRes, rejectedRes] = await Promise.all([
        baseQuery,
        pendingQ,
        approvedQ,
        rejectedQ
      ]);

      setDbCounts({
        total: totalRes.count || 0,
        pending: pendingRes.count || 0,
        approved: approvedRes.count || 0,
        rejected: rejectedRes.count || 0,
      });
    } catch (e) {
      console.error('Error fetching db counts:', e);
    }
  };

  useEffect(() => {
    loadData();
    fetchDbCounts();
  }, [orgId]);

  useEffect(() => {
    fetchDbCounts();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    await fetchLeagues();
    const tMap = await fetchTeamsMap();

    if (activeTab === 'players') {
      setPlayerPage(0);
      setHasMorePlayerApps(true);
      await fetchPlayerApplicationsPage(0, true, tMap);
    } else {
      setTeamPage(0);
      setHasMoreTeamApps(true);
      await fetchTeamApplicationsPage(0, true);
    }
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchLeagues();
    const tMap = await fetchTeamsMap();

    if (activeTab === 'players') {
      setPlayerPage(0);
      setHasMorePlayerApps(true);
      await fetchPlayerApplicationsPage(0, true, tMap);
    } else {
      setTeamPage(0);
      setHasMoreTeamApps(true);
      await fetchTeamApplicationsPage(0, true);
    }
    setRefreshing(false);
  };

  // Fetch Leagues
  const fetchLeagues = async () => {
    try {
      const dbClient = supabase;
      let query = dbClient.from('leagues').select('*').order('name');
      if (orgId) {
        query = query.eq('organization_id', orgId);
      }
      const { data } = await query;
      if (data) setLeagues(data);
    } catch (e) {}
  };

  // Fetch Teams Map
  const fetchTeamsMap = async () => {
    try {
      const dbClient = supabase;
      let query = dbClient.from('teams').select('*').order('name');
      if (orgId) {
        query = query.eq('organization_id', orgId);
      }
      const { data } = await query;
      const map = new Map();
      if (data) {
        data.forEach((t: any) => {
          map.set(String(t.id), t);
          if (t.name) map.set(t.name.trim().toLowerCase(), t);
        });
      }
      setTeamsMap(map);
      return map;
    } catch (e) {
      return new Map();
    }
  };

  // Fetch Player Applications Page (50 items chunk)
  const fetchPlayerApplicationsPage = async (pageIdx: number, isReset = false, currentTeamsMap?: Map<any, any>) => {
    try {
      const tMap = currentTeamsMap || teamsMap;
      const dbClient = supabase;
      const from = pageIdx * PLAYER_PAGE_SIZE;
      const to = from + PLAYER_PAGE_SIZE - 1;

      let query = dbClient
        .from('applications')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data } = await query;

      if (data) {
        const filtered = data
          .filter((item: any) => !item.comment || !item.comment.includes('[PROFILE_UPDATE]'))
          .map((item: any) => {
            let teamObj = null;
            if (item.team_id) teamObj = tMap.get(String(item.team_id));
            if (!teamObj && item.team_name) teamObj = tMap.get(item.team_name.trim().toLowerCase());

            const resolvedTeamName =
              item.team_name ||
              teamObj?.name ||
              (item.team_id ? `Jamoa #${item.team_id}` : 'Yakkaxon');

            const resolvedLeague =
              item.league ||
              item.league_name ||
              item.team_league ||
              teamObj?.league ||
              '';

            return {
              ...item,
              resolvedLeague,
              resolvedTeamName,
            };
          });

        if (isReset) {
          setPlayerApps(filtered);
        } else {
          setPlayerApps((prev) => [...prev, ...filtered]);
        }

        if (data.length < PLAYER_PAGE_SIZE) {
          setHasMorePlayerApps(false);
        }
      } else {
        setHasMorePlayerApps(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Team Applications Page (10 items chunk)
  const fetchTeamApplicationsPage = async (pageIdx: number, isReset = false) => {
    try {
      const dbClient = supabase;
      const from = pageIdx * TEAM_PAGE_SIZE;
      const to = from + TEAM_PAGE_SIZE - 1;

      let query = dbClient
        .from('teams')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data } = await query;

      if (data) {
        if (isReset) {
          setTeamApps(data);
        } else {
          setTeamApps((prev) => [...prev, ...data]);
        }

        if (data.length < TEAM_PAGE_SIZE) {
          setHasMoreTeamApps(false);
        }
      } else {
        setHasMoreTeamApps(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Load More Button Handler
  const handleLoadMoreBtn = async () => {
    if (loadingMore || loading) return;

    if (activeTab === 'players' && hasMorePlayerApps) {
      setLoadingMore(true);
      const nextPage = playerPage + 1;
      setPlayerPage(nextPage);
      await fetchPlayerApplicationsPage(nextPage, false);
      setLoadingMore(false);
    } else if (activeTab === 'teams' && hasMoreTeamApps) {
      setLoadingMore(true);
      const nextPage = teamPage + 1;
      setTeamPage(nextPage);
      await fetchTeamApplicationsPage(nextPage, false);
      setLoadingMore(false);
    }
  };

  // Sync Team Status based on player applications status
  const syncTeamStatusFromPlayers = async (teamId: any, teamName: string) => {
    try {
      const dbClient = supabase;
      let query = dbClient.from('applications').select('id, status, comment, team_id, team_name');
      if (teamId) {
        query = query.or(`team_id.eq.${teamId},team_name.eq.${teamName}`);
      } else if (teamName) {
        query = query.eq('team_name', teamName);
      } else {
        return;
      }

      const { data: rawPlayers } = await query;
      if (!rawPlayers || rawPlayers.length === 0) return;

      const teamPlayers = rawPlayers.filter(
        (p: any) => !p.comment || !p.comment.includes('[PROFILE_UPDATE]')
      );
      if (teamPlayers.length === 0) return;

      const approvedCount = teamPlayers.filter((p: any) => {
        const st = (p.status || '').toLowerCase();
        return st === 'approved' || st === 'tasdiqlangan';
      }).length;

      const rejectedCount = teamPlayers.filter((p: any) => {
        const st = (p.status || '').toLowerCase();
        return st === 'rejected' || st === 'rad etilgan' || st === 'rad_etilgan';
      }).length;

      const pendingCount = teamPlayers.filter((p: any) => {
        const st = (p.status || '').toLowerCase();
        return st === 'pending' || st === 'kutilmoqda';
      }).length;

      const total = teamPlayers.length;

      let newStatus = 'pending';
      if (approvedCount === total) {
        newStatus = 'approved';
      } else if (rejectedCount === total) {
        newStatus = 'rejected';
      } else if (rejectedCount > 0 && approvedCount > 0) {
        newStatus = 'partially_approved';
      } else if (pendingCount > 0 && approvedCount > 0) {
        newStatus = 'pending';
      } else if (approvedCount > 0) {
        newStatus = 'approved';
      }

      if (teamId) {
        await dbClient.from('teams').update({ status: newStatus }).eq('id', teamId);

        setTeamApps((prev) =>
          prev.map((t) =>
            t.id === teamId ||
            (t.name && teamName && t.name.trim().toLowerCase() === teamName.trim().toLowerCase())
              ? { ...t, status: newStatus }
              : t
          )
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // INSTANT OPTIMISTIC status change for individual roster player
  const handleSetPlayerStatus = (item: any, newStatus: string) => {
    setStatusPickerPlayer(null);

    setPlayerApps((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, status: newStatus } : p))
    );

    setTeamRosterPlayers((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, status: newStatus } : p))
    );

    if (selectedDetailItem?.id === item.id) {
      setSelectedDetailItem((prev: any) => ({ ...prev, status: newStatus }));
    }

    const statusLabel =
      newStatus === 'approved'
        ? 'Tasdiqlandi'
        : newStatus === 'rejected'
        ? 'Rad etildi'
        : 'Kutilmoqda';
    showToast(`O'yinchi holati "${statusLabel}" ga o'zgartirildi`);

    (async () => {
      try {
        if (newStatus === 'approved') {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc('approve_player_application', {
            p_application_id: Number(item.id),
          });

          if (rpcErr || !rpcRes?.success) {
            // Fallback for direct update if RPC is pending migration
            await supabase.from('applications').update({ status: 'approved' }).eq('id', item.id);
            const playerName =
              item.full_name ||
              `${item.first_name || ''} ${item.last_name || ''}`.trim() ||
              item.name ||
              'O\'yinchi';

            await supabase.from('players').upsert([
              {
                name: playerName,
                first_name: item.first_name || '',
                last_name: item.last_name || '',
                middle_name: item.middle_name || '',
                phone: item.phone || '',
                passport_id: item.passport_id || item.pinfl || '',
                birth_date: item.birth_date || null,
                avatar_url: item.photo_url || item.avatar_url || null,
                status: 'approved',
                organization_id: orgId || item.organization_id || 1,
              },
            ]);
          }
        } else if (newStatus === 'rejected') {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc('reject_player_application', {
            p_application_id: Number(item.id),
          });

          if (rpcErr || !rpcRes?.success) {
            await supabase.from('applications').update({ status: 'rejected' }).eq('id', item.id);
          }
        } else {
          await supabase.from('applications').update({ status: newStatus }).eq('id', item.id);
        }

        if (item.team_id || item.team_name || item.resolvedTeamName) {
          const tId = item.team_id;
          const tName = item.team_name || item.resolvedTeamName || '';
          await syncTeamStatusFromPlayers(tId, tName);
        }
      } catch (err: any) {
        console.error('Background set player status error:', err);
      }
    })();
  };

  const handleApprovePlayerApp = (item: any) => {
    handleSetPlayerStatus(item, 'approved');
  };

  const handleRejectPlayerApp = (item: any) => {
    handleSetPlayerStatus(item, 'rejected');
  };

  const handleApproveTeamApp = (item: any) => {
    setTeamApps((prev) =>
      prev.map((t) => (t.id === item.id ? { ...t, status: 'approved' } : t))
    );
    setPlayerApps((prev) =>
      prev.map((p) =>
        String(p.team_id) === String(item.id) ||
        (p.team_name && item.name && p.team_name.trim().toLowerCase() === item.name.trim().toLowerCase())
          ? { ...p, status: 'approved' }
          : p
      )
    );

    if (selectedDetailItem?.id === item.id) {
      setSelectedDetailItem((prev: any) => ({ ...prev, status: 'approved' }));
    }
    showToast("Jamoa va barcha o'yinchilari tasdiqlandi");

    (async () => {
      try {
        const dbClient = supabase;
        await dbClient.from('teams').update({ status: 'approved' }).eq('id', item.id);
        await dbClient
          .from('applications')
          .update({ status: 'approved' })
          .or(`team_id.eq.${item.id},team_name.eq.${item.name}`);
      } catch (err: any) {
        console.error('Background approve team app error:', err);
      }
    })();
  };

  const handleRejectTeamApp = (item: any) => {
    setTeamApps((prev) =>
      prev.map((t) => (t.id === item.id ? { ...t, status: 'rejected' } : t))
    );
    setPlayerApps((prev) =>
      prev.map((p) =>
        String(p.team_id) === String(item.id) ||
        (p.team_name && item.name && p.team_name.trim().toLowerCase() === item.name.trim().toLowerCase())
          ? { ...p, status: 'rejected' }
          : p
      )
    );

    if (selectedDetailItem?.id === item.id) {
      setSelectedDetailItem((prev: any) => ({ ...prev, status: 'rejected' }));
    }
    showToast("Jamoa va barcha o'yinchilari rad etildi");

    (async () => {
      try {
        const dbClient = supabase;
        await dbClient.from('teams').update({ status: 'rejected' }).eq('id', item.id);
        await dbClient
          .from('applications')
          .update({ status: 'rejected' })
          .or(`team_id.eq.${item.id},team_name.eq.${item.name}`);
      } catch (err: any) {
        console.error('Background reject team app error:', err);
      }
    })();
  };

  const handleDeleteApplication = (item: any, isPlayer: boolean) => {
    const title = isPlayer ? "O'yinchi arizasini o'chirish" : "Jamoa arizasini o'chirish";
    const name = isPlayer
      ? item.full_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.name || "O'yinchi"
      : item.name || 'Jamoa';

    Alert.alert(
      title,
      `Haqiqatan ham "${name}" arizasini o'chirmoqchimisiz? Ushbu amalni ortga qaytarib bo'lmaydi.`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "O'chirish",
          style: 'destructive',
          onPress: async () => {
            try {
              const dbClient = supabase;
              if (isPlayer) {
                setPlayerApps((prev) => prev.filter((p) => p.id !== item.id));
                await dbClient.from('applications').delete().eq('id', item.id);
                showToast("O'yinchi arizasi o'chirildi");
              } else {
                setTeamApps((prev) => prev.filter((t) => t.id !== item.id));
                await dbClient.from('teams').delete().eq('id', item.id);
                showToast("Jamoa arizasi o'chirildi");
              }
              if (selectedDetailItem?.id === item.id) {
                setSelectedDetailItem(null);
              }
              fetchDbCounts();
            } catch (err) {
              console.error('Delete error:', err);
              showToast("O'chirishda xatolik yuz berdi");
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Kiritilmagan';
    try {
      const dt = new Date(dateStr);
      if (isNaN(dt.getTime())) return dateStr;
      const day = dt.getDate().toString().padStart(2, '0');
      const monthNames = [
        'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
        'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
      ];
      const month = monthNames[dt.getMonth()];
      const year = dt.getFullYear();
      const hours = dt.getHours().toString().padStart(2, '0');
      const mins = dt.getMinutes().toString().padStart(2, '0');
      const secs = dt.getSeconds().toString().padStart(2, '0');
      return `${day}-${month} ${year} • ${hours}:${mins}:${secs}`;
    } catch (e) {
      return dateStr;
    }
  };

  const getCleanComment = (commentStr?: string) => {
    if (!commentStr) return '';
    return commentStr
      .replace(/\[INSTAGRAM:[^\]]+\]/g, '')
      .replace(/\[METADATA:[^\]]+\]/g, '')
      .replace(/\[PROFILE_UPDATE\]/g, '')
      .trim();
  };

  const getInstagramUser = (item: any) => {
    if (!item) return '';
    if (item.instagram) return item.instagram.replace(/^@/, '').trim();
    if (item.comment) {
      const match = item.comment.match(/\[INSTAGRAM:([^\]]+)\]/);
      if (match?.[1]) return match[1].replace(/^@/, '').trim();
    }
    return '';
  };

  const currentRawList = activeTab === 'players' ? playerApps : teamApps;

  const filteredList = currentRawList
    .filter((item) => {
      const st = (item.status || 'pending').toLowerCase();
      if (statusFilter === 'pending' && st !== 'pending' && st !== 'kutilmoqda') return false;
      if (statusFilter === 'approved' && st !== 'approved' && st !== 'tasdiqlangan' && st !== 'partially_approved' && st !== 'qisman') return false;
      if (statusFilter === 'rejected' && st !== 'rejected' && st !== 'rad etilgan') return false;
      if (statusFilter === 'qisman' && st !== 'qisman' && st !== 'partially_approved') return false;

      if (leagueFilter !== 'all') {
        const rawLeague = item.resolvedLeague || item.league || item.league_name || '';
        const leagueList = rawLeague.split(',').map((s: string) => s.trim().toLowerCase());
        const targetFilter = leagueFilter.trim().toLowerCase();
        if (!leagueList.includes(targetFilter)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const stA = (a.status || 'pending').toLowerCase();
      const stB = (b.status || 'pending').toLowerCase();
      const isPendingA = stA === 'pending' || stA === 'kutilmoqda' ? 0 : 1;
      const isPendingB = stB === 'pending' || stB === 'kutilmoqda' ? 0 : 1;

      if (isPendingA !== isPendingB) {
        return isPendingA - isPendingB;
      }

      const timeA = a.created_at ? new Date(a.created_at).getTime() : (Number(a.id) || 0);
      const timeB = b.created_at ? new Date(b.created_at).getTime() : (Number(b.id) || 0);
      return timeB - timeA;
    });

  const getTeamRosterPlayers = (teamItem: any) => {
    if (!teamItem) return [];
    return playerApps.filter((p) => {
      if (String(p.team_id) === String(teamItem.id)) return true;
      if (
        p.team_name &&
        teamItem.name &&
        p.team_name.trim().toLowerCase() === teamItem.name.trim().toLowerCase()
      )
        return true;
      if (
        p.resolvedTeamName &&
        teamItem.name &&
        p.resolvedTeamName.trim().toLowerCase() === teamItem.name.trim().toLowerCase()
      )
        return true;
      return false;
    });
  };

  const renderStatusBadge = (statusVal?: string, onPress?: () => void) => {
    const st = (statusVal || 'pending').toLowerCase();
    let badgeContent = null;

    if (st === 'approved' || st === 'tasdiqlangan') {
      badgeContent = (
        <View style={[styles.statusBadgePill, { backgroundColor: 'rgba(34, 197, 94, 0.15)', borderColor: '#22C55E' }]}>
          <Ionicons name="checkmark-circle-outline" size={11} color="#22C55E" />
          <Text style={[styles.statusBadgeText, { color: '#22C55E' }]}>{"Tasdiqlangan"}</Text>
        </View>
      );
    } else if (st === 'qisman' || st === 'partially_approved') {
      badgeContent = (
        <View style={[styles.statusBadgePill, { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: '#F59E0B' }]}>
          <Ionicons name="pie-chart-outline" size={11} color="#F59E0B" />
          <Text style={[styles.statusBadgeText, { color: '#F59E0B' }]}>{"Qisman Tasdiqlangan"}</Text>
        </View>
      );
    } else if (st === 'rejected' || st === 'rad etilgan') {
      badgeContent = (
        <View style={[styles.statusBadgePill, { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: '#EF4444' }]}>
          <Ionicons name="close-circle-outline" size={11} color="#EF4444" />
          <Text style={[styles.statusBadgeText, { color: '#EF4444' }]}>{"Rad etilgan"}</Text>
        </View>
      );
    } else {
      badgeContent = (
        <View style={[styles.statusBadgePill, { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: '#F59E0B' }]}>
          <Ionicons name="time-outline" size={11} color="#F59E0B" />
          <Text style={[styles.statusBadgeText, { color: '#F59E0B' }]}>{"Kutilmoqda"}</Text>
        </View>
      );
    }

    if (onPress) {
      return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          {badgeContent}
        </TouchableOpacity>
      );
    }

    return badgeContent;
  };

  return (
    <View style={styles.container}>
      {/* Floating Animated Toast Banner */}
      {toastMessage && (
        <Animated.View
          style={[
            styles.floatingToastCard,
            {
              opacity: opacityAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.toastCheckCircle}>
            <Ionicons name="checkmark" size={12} color="#FFFFFF" />
          </View>
          <Text style={styles.floatingToastText}>{toastMessage}</Text>
          <TouchableOpacity onPress={() => setToastMessage(null)} style={{ paddingLeft: 6 }}>
            <Ionicons name="close" size={14} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Top Segment Sub-Tabs */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'players' && styles.activeSegmentBtn]}
          onPress={() => {
            setActiveTab('players');
            setShowStatusDropdown(false);
            setShowLeagueDropdown(false);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="person"
            size={16}
            color={activeTab === 'players' ? '#000000' : 'rgba(255,255,255,0.6)'}
          />
          <Text
            style={[
              styles.segmentBtnText,
              activeTab === 'players' && styles.activeSegmentBtnText,
            ]}
          >
            {`O'yinchilar`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'teams' && styles.activeSegmentBtn]}
          onPress={() => {
            setActiveTab('teams');
            setShowStatusDropdown(false);
            setShowLeagueDropdown(false);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="shield"
            size={16}
            color={activeTab === 'teams' ? '#000000' : 'rgba(255,255,255,0.6)'}
          />
          <Text
            style={[
              styles.segmentBtnText,
              activeTab === 'teams' && styles.activeSegmentBtnText,
            ]}
          >
            {`Jamoalar`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Stats Counter Bar */}
      <View style={styles.statsOverviewRow}>
        <View style={[styles.statTileCard, { borderColor: 'rgba(245, 158, 11, 0.3)' }]}>
          <Text style={[styles.statNumberText, { color: '#F59E0B' }]}>{dbCounts.pending}</Text>
          <Text style={styles.statLabelText}>{"Kutilmoqda"}</Text>
        </View>

        <View style={[styles.statTileCard, { borderColor: 'rgba(34, 197, 94, 0.3)' }]}>
          <Text style={[styles.statNumberText, { color: '#22C55E' }]}>{dbCounts.approved}</Text>
          <Text style={styles.statLabelText}>{"Tasdiqlangan"}</Text>
        </View>

        <View style={[styles.statTileCard, { borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
          <Text style={[styles.statNumberText, { color: '#EF4444' }]}>{dbCounts.rejected}</Text>
          <Text style={styles.statLabelText}>{"Rad etilgan"}</Text>
        </View>

        <View style={[styles.statTileCard, { borderColor: 'rgba(56, 189, 248, 0.3)' }]}>
          <Text style={[styles.statNumberText, { color: '#38BDF8' }]}>{dbCounts.total}</Text>
          <Text style={styles.statLabelText}>{"Jami"}</Text>
        </View>
      </View>

      {/* Select Dropdown Filters Row */}
      <View style={styles.filtersRow}>
        {/* Status Dropdown Filter */}
        <TouchableOpacity
          style={styles.filterSelectTile}
          onPress={() => {
            setShowStatusDropdown(!showStatusDropdown);
            setShowLeagueDropdown(false);
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="filter-outline" size={14} color="#00FF66" />
          <Text style={styles.filterSelectText} numberOfLines={1}>
            {statusFilter === 'all'
              ? 'Barcha Holatlar'
              : statusFilter === 'pending'
              ? 'Kutilmoqda'
              : statusFilter === 'approved'
              ? 'Tasdiqlangan'
              : statusFilter === 'qisman'
              ? 'Qisman'
              : 'Rad etilgan'}
          </Text>
          <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>

        {/* League Dropdown Filter */}
        <TouchableOpacity
          style={styles.filterSelectTile}
          onPress={() => {
            setShowLeagueDropdown(!showLeagueDropdown);
            setShowStatusDropdown(false);
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="trophy-outline" size={14} color="#F59E0B" />
          <Text style={styles.filterSelectText} numberOfLines={1}>
            {leagueFilter === 'all' ? 'Barcha Ligalar' : leagueFilter}
          </Text>
          <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      {/* Dropdown Menu Overlay - Status */}
      {showStatusDropdown && (
        <View style={styles.dropdownMenuBox}>
          {[
            { id: 'all', title: 'Barcha Holatlar' },
            { id: 'pending', title: 'Kutilmoqda' },
            { id: 'approved', title: 'Tasdiqlangan' },
            { id: 'qisman', title: 'Qisman Tasdiqlangan' },
            { id: 'rejected', title: 'Rad etilgan' },
          ].map((st) => (
            <TouchableOpacity
              key={st.id}
              style={styles.dropdownMenuItem}
              onPress={() => {
                setStatusFilter(st.id as any);
                setShowStatusDropdown(false);
              }}
            >
              <Text style={[styles.dropdownMenuText, statusFilter === st.id && { color: '#00FF66', fontWeight: '900' }]}>
                {st.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Dropdown Menu Overlay - League */}
      {showLeagueDropdown && (
        <View style={styles.dropdownMenuBox}>
          <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={styles.dropdownMenuItem}
              onPress={() => {
                setLeagueFilter('all');
                setShowLeagueDropdown(false);
              }}
            >
              <Text style={[styles.dropdownMenuText, leagueFilter === 'all' && { color: '#00FF66', fontWeight: '900' }]}>
                {"Barcha Ligalar"}
              </Text>
            </TouchableOpacity>
            {leagues.map((lg) => (
              <TouchableOpacity
                key={lg.id}
                style={styles.dropdownMenuItem}
                onPress={() => {
                  setLeagueFilter(lg.name);
                  setShowLeagueDropdown(false);
                }}
              >
                <Text style={[styles.dropdownMenuText, leagueFilter === lg.name && { color: '#00FF66', fontWeight: '900' }]}>
                  {lg.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Main Content FlatList / Skeleton Loader */}
      {loading ? (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </ScrollView>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(item, index) => (item && item.id ? `app-${item.id}-${index}` : `app-row-${index}`)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          updateCellsBatchingPeriod={50}
          onEndReached={handleLoadMoreBtn}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00FF66" />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="document-text-outline" size={40} color="rgba(255,255,255,0.2)" />
              <Text style={styles.emptyText}>
                {activeTab === 'players' ? "O'yinchi arizalari topilmadi" : "Jamoa arizalari topilmadi"}
              </Text>
            </View>
          }
          ListFooterComponent={
            ((activeTab === 'players' && hasMorePlayerApps) || (activeTab === 'teams' && hasMoreTeamApps)) ? (
              <View style={{ marginTop: 12, marginBottom: 20, alignItems: 'center' }}>
                <TouchableOpacity
                  style={styles.loadMoreButton}
                  onPress={handleLoadMoreBtn}
                  disabled={loadingMore}
                  activeOpacity={0.8}
                >
                  {loadingMore ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <>
                      <Ionicons name="arrow-down-circle" size={18} color="#000000" />
                      <Text style={styles.loadMoreBtnText}>
                        {activeTab === 'players'
                          ? "Yana 50 ta arizani yuklash"
                          : "Yana 10 ta jamoa arizasini yuklash"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const isPlayer = activeTab === 'players';
            const fullName = isPlayer
              ? item.full_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.name || "O'yinchi"
              : item.name || 'Jamoa';
            const avatar = isPlayer
              ? item.photo_url || item.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop'
              : item.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop';
            const st = (item.status || 'pending').toLowerCase();
            const isPending = st === 'pending' || st === 'kutilmoqda';
            const displayLeague = item.resolvedLeague || item.league || item.league_name;
            const displayTeam = item.resolvedTeamName || item.team_name;

            return (
              <SwipeableCard onDelete={() => handleDeleteApplication(item, isPlayer)}>
                <View style={styles.applicationCard}>
                  {/* Left Photo */}
                  <TouchableOpacity onPress={() => setZoomImageUrl(avatar)} activeOpacity={0.8}>
                    <ExpoImage cachePolicy='memory-disk' source={{ uri: avatar }} style={styles.avatarImage} />
                  </TouchableOpacity>

                  {/* Center Details */}
                  <TouchableOpacity
                    style={styles.cardInfoCol}
                    onPress={() => openDetailModal(item, isPlayer)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.applicantName} numberOfLines={1}>
                      {fullName}
                    </Text>

                    {isPlayer ? (
                      <Text style={[styles.metaSubText, { color: displayTeam === 'Yakkaxon' ? 'rgba(255,255,255,0.4)' : '#00FF66', fontWeight: '800' }]} numberOfLines={1}>
                        {`Jamoa: ${displayTeam || 'Yakkaxon'}`}
                      </Text>
                    ) : null}

                    {displayLeague ? (
                      <Text style={styles.metaSubText} numberOfLines={1}>
                        {`Liga: ${displayLeague}`}
                      </Text>
                    ) : null}

                    {(item.phone || item.contact_phone) ? (
                      <Text style={styles.metaSubText} numberOfLines={1}>
                        {`Tel: ${item.phone || item.contact_phone}`}
                      </Text>
                    ) : null}

                    <View style={styles.metaBottomRow}>
                      {renderStatusBadge(item.status)}
                      <Text style={styles.timeCreatedText}>
                        {formatDate(item.created_at)}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* Right Action Icons */}
                  {isPending && (
                    <View style={styles.actionIconCol}>
                      <TouchableOpacity
                        style={styles.iconApproveBtn}
                        onPress={() => (isPlayer ? handleApprovePlayerApp(item) : handleApproveTeamApp(item))}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="checkmark-circle" size={26} color="#00FF66" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.iconRejectBtn}
                        onPress={() => (isPlayer ? handleRejectPlayerApp(item) : handleRejectTeamApp(item))}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="close-circle" size={26} color="#FF4D4D" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </SwipeableCard>
            );
          }}
        />
      )}

      {/* FULLSCREEN PINCH-TO-ZOOM IMAGE LIGHTBOX MODAL WITH BLUR BACKDROP */}
      <Modal visible={!!zoomImageUrl} transparent animationType="fade">
        <View style={styles.zoomModalBackdrop}>
          <TouchableOpacity
            style={styles.zoomCloseBtn}
            onPress={() => setZoomImageUrl(null)}
            activeOpacity={0.8}
          >
            <Ionicons name="close-circle" size={36} color="#FFFFFF" />
          </TouchableOpacity>

          {zoomImageUrl && (
            <ScrollView
              contentContainerStyle={styles.zoomScrollViewContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
            >
              <Image
                source={{ uri: zoomImageUrl }}
                style={styles.fullZoomImage}
                resizeMode="contain"
              />
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* FULL APPLICATION DETAILS MODAL */}
      <Modal visible={!!selectedDetailItem} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>
                {selectedDetailItem?.isPlayer ? "O'yinchi Arizasi Ma'lumotlari" : "Jamoa Arizasi Ma'lumotlari"}
              </Text>
              <TouchableOpacity onPress={() => setSelectedDetailItem(null)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            {selectedDetailItem && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 12 }}>
                {/* Photo & Name Card Header */}
                <View style={{ alignItems: 'center', gap: 10 }}>
                  <TouchableOpacity onPress={() => setZoomImageUrl(selectedDetailItem.photo_url || selectedDetailItem.avatar_url || selectedDetailItem.passport_url || selectedDetailItem.logo_url)}>
                    <Image
                      source={{
                        uri:
                          selectedDetailItem.photo_url ||
                          selectedDetailItem.avatar_url ||
                          selectedDetailItem.passport_url ||
                          selectedDetailItem.logo_url ||
                          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop',
                      }}
                      style={styles.detailModalAvatar}
                    />
                  </TouchableOpacity>
                  <Text style={styles.detailModalName}>
                    {selectedDetailItem.full_name ||
                      `${selectedDetailItem.first_name || ''} ${selectedDetailItem.last_name || ''} ${selectedDetailItem.middle_name || ''}`.trim() ||
                      selectedDetailItem.name ||
                      'Ariza'}
                  </Text>
                  {renderStatusBadge(selectedDetailItem.status)}
                </View>

                {/* Complete Key-Value Grid Rows */}
                <View style={styles.detailInfoBox}>
                  {(selectedDetailItem.first_name || selectedDetailItem.last_name) && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Ism Familiya:"}</Text>
                      <Text style={styles.detailValText}>
                        {`${selectedDetailItem.first_name || ''} ${selectedDetailItem.last_name || ''}`}
                      </Text>
                    </View>
                  )}

                  {selectedDetailItem.middle_name && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Otasining ismi:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.middle_name}</Text>
                    </View>
                  )}

                  {(selectedDetailItem.resolvedTeamName || selectedDetailItem.team_name) && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Jamoasi:"}</Text>
                      <Text style={[styles.detailValText, { color: '#00FF66' }]}>{selectedDetailItem.resolvedTeamName || selectedDetailItem.team_name}</Text>
                    </View>
                  )}

                  {(selectedDetailItem.resolvedLeague || selectedDetailItem.league || selectedDetailItem.league_name) && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Ligasi:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.resolvedLeague || selectedDetailItem.league || selectedDetailItem.league_name}</Text>
                    </View>
                  )}

                  {(selectedDetailItem.player_number || selectedDetailItem.number || selectedDetailItem.jersey_number) && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"O'yinchi raqami:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.player_number || selectedDetailItem.number || selectedDetailItem.jersey_number}</Text>
                    </View>
                  )}

                  {selectedDetailItem.position && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Pozitsiyasi:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.position}</Text>
                    </View>
                  )}

                  {selectedDetailItem.passport_id && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Pasport Seriya/ID:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.passport_id}</Text>
                    </View>
                  )}

                  {selectedDetailItem.pinfl && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"JSHSHIR / PINFL:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.pinfl}</Text>
                    </View>
                  )}

                  {(selectedDetailItem.phone || selectedDetailItem.contact_phone) && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Telefon raqam:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.phone || selectedDetailItem.contact_phone}</Text>
                    </View>
                  )}

                  {selectedDetailItem.birth_date && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Tug'ilgan sanasi:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.birth_date}</Text>
                    </View>
                  )}

                  {(selectedDetailItem.height || selectedDetailItem.weight) && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Bo'yi / Vazni:"}</Text>
                      <Text style={styles.detailValText}>{`${selectedDetailItem.height || '-'} cm / ${selectedDetailItem.weight || '-'} kg`}</Text>
                    </View>
                  )}

                  {selectedDetailItem.citizenship && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Fuqaroligi:"}</Text>
                      <Text style={styles.detailValText}>{selectedDetailItem.citizenship}</Text>
                    </View>
                  )}

                  {getInstagramUser(selectedDetailItem) !== '' && (
                    <View style={styles.detailInfoRow}>
                      <Text style={styles.detailKeyText}>{"Instagram:"}</Text>
                      <Text style={[styles.detailValText, { color: '#E1306C' }]}>{`@${getInstagramUser(selectedDetailItem)}`}</Text>
                    </View>
                  )}

                  <View style={styles.detailInfoRow}>
                    <Text style={styles.detailKeyText}>{"Topshirilgan vaqti:"}</Text>
                    <Text style={styles.detailValText}>{formatDate(selectedDetailItem.created_at)}</Text>
                  </View>

                  {getCleanComment(selectedDetailItem.comment) !== '' && (
                    <View style={{ gap: 4, marginTop: 4 }}>
                      <Text style={styles.detailKeyText}>{"Izoh / Sharh:"}</Text>
                      <Text style={[styles.detailValText, { fontSize: 12, color: 'rgba(255,255,255,0.85)' }]}>
                        {getCleanComment(selectedDetailItem.comment)}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Additional Passport Image Preview */}
                {selectedDetailItem.passport_url && (
                  <View style={{ gap: 6 }}>
                    <Text style={styles.detailKeyText}>{"Pasport Nusxasi Rasmi:"}</Text>
                    <TouchableOpacity onPress={() => setZoomImageUrl(selectedDetailItem.passport_url)}>
                      <Image
                        source={{ uri: selectedDetailItem.passport_url }}
                        style={{ width: '100%', height: 160, borderRadius: 14, backgroundColor: '#1E293B' }}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  </View>
                )}

                {/* If Team Application, Show Team's Roster List fetched from Database */}
                {!selectedDetailItem.isPlayer && (
                  <View style={{ gap: 10, marginTop: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={[styles.modalTitle, { fontSize: 14.5, color: '#00FF66' }]}>
                        {`Jamoaning o'yinchilari (${teamRosterPlayers.length})`}
                      </Text>
                      {loadingTeamRoster && <ActivityIndicator size="small" color="#00FF66" />}
                    </View>

                    {loadingTeamRoster ? (
                      <View style={{ paddingVertical: 20, alignItems: 'center', gap: 8 }}>
                        <ActivityIndicator size="small" color="#00FF66" />
                        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                          {"O'yinchilar bazadan yuklanmoqda..."}
                        </Text>
                      </View>
                    ) : teamRosterPlayers.length === 0 ? (
                      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                        {"Ushbu jamoaga tegishli o'yinchilar hali biriktirilmagan"}
                      </Text>
                    ) : (
                      teamRosterPlayers.map((pItem: any, pIdx: number) => {
                        const pName =
                          pItem.full_name ||
                          `${pItem.first_name || ''} ${pItem.last_name || ''}`.trim() ||
                          pItem.name ||
                          "O'yinchi";
                        const pAvatar =
                          pItem.photo_url ||
                          pItem.avatar_url ||
                          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop';

                        return (
                          <View key={pItem.id ? `roster-${pItem.id}-${pIdx}` : `roster-name-${pIdx}`} style={styles.rosterPlayerRowCard}>
                            <TouchableOpacity
                              style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}
                              onPress={() => setSelectedDetailItem({ ...pItem, isPlayer: true })}
                              activeOpacity={0.75}
                            >
                              <ExpoImage cachePolicy='memory-disk' source={{ uri: pAvatar }} style={styles.rosterPlayerAvatar} />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.rosterPlayerName} numberOfLines={1}>
                                  {pName}
                                </Text>
                                {pItem.position && (
                                  <Text style={styles.metaSubText}>{pItem.position}</Text>
                                )}
                              </View>
                            </TouchableOpacity>

                            {/* Status Badge (Tap badge to trigger Status Picker Overlay) */}
                            {renderStatusBadge(pItem.status, () => setStatusPickerPlayer(pItem))}
                          </View>
                        );
                      })
                    )}
                  </View>
                )}

                {/* Modal Action Buttons (If team application pending) */}
                {((selectedDetailItem.status || 'pending').toLowerCase() === 'pending' || (selectedDetailItem.status || '').toLowerCase() === 'kutilmoqda') && (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <TouchableOpacity
                      style={styles.modalApproveBtn}
                      onPress={() =>
                        selectedDetailItem.isPlayer
                          ? handleApprovePlayerApp(selectedDetailItem)
                          : handleApproveTeamApp(selectedDetailItem)
                      }
                    >
                      <Ionicons name="checkmark-circle" size={18} color="#000000" />
                      <Text style={styles.modalApproveBtnText}>{"Jamoani Qabul Qilish"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.modalRejectBtn}
                      onPress={() =>
                        selectedDetailItem.isPlayer
                          ? handleRejectPlayerApp(selectedDetailItem)
                          : handleRejectTeamApp(selectedDetailItem)
                      }
                    >
                      <Ionicons name="close-circle" size={18} color="#FFFFFF" />
                      <Text style={styles.modalRejectBtnText}>{"Rad Etish"}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>
            )}
          </View>

          {/* INTERNAL STATUS PICKER OVERLAY INSIDE THE SAME MODAL TREE */}
          {statusPickerPlayer && (
            <View style={styles.pickerOverlayBox}>
              <View style={styles.pickerCard}>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>{"Holatni O'zgartirish"}</Text>
                  <TouchableOpacity onPress={() => setStatusPickerPlayer(null)}>
                    <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
                  </TouchableOpacity>
                </View>

                <Text style={{ color: '#00FF66', fontSize: 14, fontWeight: '800', marginVertical: 4 }}>
                  {statusPickerPlayer.full_name ||
                    `${statusPickerPlayer.first_name || ''} ${statusPickerPlayer.last_name || ''}`.trim() ||
                    statusPickerPlayer.name ||
                    "O'yinchi"}
                </Text>

                <TouchableOpacity
                  style={[styles.statusOptionBtn, { borderColor: '#22C55E' }]}
                  onPress={() => handleSetPlayerStatus(statusPickerPlayer, 'approved')}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                  <Text style={[styles.statusOptionText, { color: '#22C55E' }]}>{"Tasdiqlash (Approved)"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusOptionBtn, { borderColor: '#F59E0B' }]}
                  onPress={() => handleSetPlayerStatus(statusPickerPlayer, 'pending')}
                >
                  <Ionicons name="time" size={20} color="#F59E0B" />
                  <Text style={[styles.statusOptionText, { color: '#F59E0B' }]}>{"Kutilmoqda (Pending)"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusOptionBtn, { borderColor: '#EF4444' }]}
                  onPress={() => handleSetPlayerStatus(statusPickerPlayer, 'rejected')}
                >
                  <Ionicons name="close-circle" size={20} color="#EF4444" />
                  <Text style={[styles.statusOptionText, { color: '#EF4444' }]}>{"Rad Etish (Rejected)"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingToastCard: {
    position: 'absolute',
    top: 54,
    left: 14,
    right: 14,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#262035',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 0,
    elevation: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  toastCheckCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingToastText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },

  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 4,
    marginBottom: 10,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  activeSegmentBtn: {
    backgroundColor: '#00FF66',
  },
  segmentBtnText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    fontWeight: '700',
  },
  activeSegmentBtnText: {
    color: '#000000',
    fontWeight: '900',
  },

  statsOverviewRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statTileCard: {
    flex: 1,
    backgroundColor: '#151A24',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statNumberText: {
    fontSize: 16,
    fontWeight: '900',
  },
  statLabelText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },

  filtersRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  filterSelectTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterSelectText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    marginHorizontal: 6,
  },
  dropdownMenuBox: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  dropdownMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  dropdownMenuText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '600',
  },

  listContent: {
    paddingBottom: 120,
    gap: 10,
  },
  emptyCard: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 13.5,
    fontWeight: '600',
  },

  applicationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151A24',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 12,
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#1E293B',
  },
  cardInfoCol: {
    flex: 1,
    gap: 2,
  },
  applicantName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  metaSubText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11.5,
    fontWeight: '600',
  },
  metaBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  timeCreatedText: {
    color: 'rgba(255, 255, 255, 0.35)',
    fontSize: 10.5,
    fontWeight: '600',
  },

  statusBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },

  actionIconCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconApproveBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 255, 102, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
  },
  iconRejectBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 77, 77, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 77, 0.3)',
  },

  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FF66',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    elevation: 4,
    shadowColor: '#00FF66',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  loadMoreBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },

  // Skeleton Styles
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151A24',
    borderRadius: 16,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#242C3D',
  },
  skeletonAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#1E293B',
  },
  skeletonTitleLine: {
    width: '60%',
    height: 14,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  skeletonSubLine: {
    width: '40%',
    height: 10,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },

  zoomModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 99999,
  },
  zoomScrollViewContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  fullZoomImage: {
    width: 340,
    height: 480,
    borderRadius: 16,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: '#151A24',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#242C3D',
    maxHeight: '85%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingBottom: 12,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  detailModalAvatar: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#00FF66',
  },
  detailModalName: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  detailInfoBox: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  detailInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    paddingBottom: 6,
  },
  detailKeyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12.5,
    fontWeight: '600',
  },
  detailValText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  modalApproveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FF66',
    paddingVertical: 12,
    borderRadius: 14,
  },
  modalApproveBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },
  modalRejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EF4444',
    paddingVertical: 12,
    borderRadius: 14,
  },
  modalRejectBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },

  rosterPlayerRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 10,
    borderRadius: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  rosterPlayerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#0B0F17',
  },
  rosterPlayerName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },

  pickerOverlayBox: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 999999,
  },
  pickerCard: {
    width: '100%',
    backgroundColor: '#151A24',
    borderRadius: 20,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  statusOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusOptionText: {
    fontSize: 13.5,
    fontWeight: '800',
  },
});
