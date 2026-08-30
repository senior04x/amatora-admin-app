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
  Switch,
  Modal,
  ScrollView,
  TextInput,
  Vibration,
  Animated,
  PanResponder,
  Platform,
  Alert,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from '../components/SafeBlurView';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../supabaseClient';
import { usePlayersData, useTeamsPaginatedData, useTeamsData, useLeaguesData } from '../api/hooks';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  onNavigate?: (screen: string) => void;
  initialSegmentTab?: 'players' | 'teams';
}

// Shimmer Skeleton Loader Component
const SkeletonCard = () => {
  const { colors } = useTheme();
  return (
    <View style={[styles.skeletonCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
      {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />}
      <View style={[styles.skeletonAvatar, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[styles.skeletonTitleLine, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]} />
        <View style={[styles.skeletonSubLine, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]} />
      </View>
    </View>
  );
};

// Telegram-Style Swipeable Player Card Component with Pan Lock & Haptic Feedback
const SwipeablePlayerCard = ({
  item,
  isPlayer,
  allTeamsList,
  isOpen,
  setIsSwiping,
  onSwipeOpen,
  onSwipeClose,
  onOpen,
  onDelete,
  onRestore,
  isArchived,
  onImagePress,
  isReadOnlyUser,
}: any) => {
  const { isDark, colors } = useTheme();
  const panX = useRef(new Animated.Value(0)).current;
  const hapticTriggeredRef = useRef(false);

  // Auto-close when another card is opened
  useEffect(() => {
    if (!isOpen) {
      Animated.spring(panX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    }
  }, [isOpen]);

  const triggerHaptic = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      Vibration.vibrate(25);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (isReadOnlyUser) return false;
        // Only capture gesture if horizontal swipe is clearly dominant
        return Math.abs(gestureState.dx) > 18 && Math.abs(gestureState.dy) < 8;
      },
      onPanResponderGrant: () => {
        if (setIsSwiping) setIsSwiping(true);
        hapticTriggeredRef.current = false;
        onSwipeOpen();
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          if (gestureState.dx <= -85 && !hapticTriggeredRef.current) {
            triggerHaptic();
            hapticTriggeredRef.current = true;
          }
          panX.setValue(Math.max(gestureState.dx, -120));
        } else {
          panX.setValue(0);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        setIsSwiping(false);
        if (gestureState.dx < -55) {
          Animated.spring(panX, {
            toValue: -85,
            useNativeDriver: true,
            bounciness: 4,
          }).start(() => {
            onSwipeOpen();
          });
        } else {
          Animated.spring(panX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start(() => {
            onSwipeClose();
          });
        }
      },
      onPanResponderTerminate: () => {
        setIsSwiping(false);
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
        }).start(() => {
          onSwipeClose();
        });
      },
    })
  ).current;

  const resetSwipe = () => {
    Animated.spring(panX, {
      toValue: 0,
      useNativeDriver: true,
    }).start(() => {
      onSwipeClose();
    });
  };

  const name = isPlayer
    ? item.full_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.name
    : item.name;
  const avatar = isPlayer
    ? item.avatar_url || item.photo_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop'
    : item.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop';

  let displayTeam = '';
  if (item.team_id) {
    const foundTeam = allTeamsList?.find((t: any) => String(t.id) === String(item.team_id));
    if (foundTeam?.name) {
      displayTeam = foundTeam.name;
    } else if (item.team?.name && item.team.name !== 'Yakkaxon') {
      displayTeam = item.team.name;
    } else if (item.team_name && item.team_name !== 'Yakkaxon' && isNaN(Number(item.team_name))) {
      displayTeam = item.team_name;
    } else {
      displayTeam = `Jamoa #${item.team_id}`;
    }
  } else {
    displayTeam = (item.team?.name && item.team.name !== 'Yakkaxon')
      ? item.team.name
      : (item.team_name && item.team_name !== 'Yakkaxon' && isNaN(Number(item.team_name)))
      ? item.team_name
      : 'Yakkaxon';
  }

  let displayLeague = '';
  if (item.team_id) {
    const foundTeam = allTeamsList?.find((t: any) => String(t.id) === String(item.team_id));
    if (foundTeam?.league) {
      displayLeague = foundTeam.league;
    }
  }
  if (!displayLeague) {
    const commentLeague = item.comment?.match(/\[LEAGUE:([^\]]+)\]/)?.[1]?.trim() || '';
    displayLeague = item.team?.league || item.league || item.league_name || commentLeague || '';
  }

  const deleteOpacity = panX.interpolate({
    inputRange: [-85, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const animScale = useRef(new Animated.Value(1)).current;
  const animTranslateY = useRef(new Animated.Value(0)).current;
  const animOpacity = useRef(new Animated.Value(1)).current;

  const handleArchiveWithAnim = () => {
    resetSwipe();
    Animated.parallel([
      Animated.timing(animScale, { toValue: 0.05, duration: 320, useNativeDriver: true }),
      Animated.timing(animTranslateY, { toValue: -60, duration: 320, useNativeDriver: true }),
      Animated.timing(animOpacity, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start(() => {
      onDelete(item);
    });
  };

  return (
    <View style={styles.swipeContainer}>
      {/* Hidden Red Delete Action Button behind Card (Fades in ONLY when swiped) */}
      <Animated.View style={[styles.deleteActionBack, { opacity: deleteOpacity }]}>
        <TouchableOpacity
          style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          onPress={handleArchiveWithAnim}
          activeOpacity={0.8}
        >
          <Ionicons name="archive" size={22} color="#FFFFFF" />
          <Text style={styles.deleteActionText}>{"Arxivlash"}</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Foreground Card Item */}
      <Animated.View
        style={[
          styles.cardItem,
          Platform.OS === 'android' && {
            borderColor: colors.border,
            backgroundColor: colors.bgCard,
          },
          {
            transform: [
              { translateX: panX },
              { translateY: animTranslateY },
              { scale: animScale },
            ],
            opacity: animOpacity,
          }
        ]}
        {...panResponder.panHandlers}
      >
        {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
        <View style={styles.cardInnerRow}>
          {/* Left Photo Touch */}
          <TouchableOpacity
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={() => {
              if (onImagePress) onImagePress(avatar);
            }}
          >
            <ExpoImage cachePolicy='memory-disk' source={{ uri: avatar }} style={[styles.avatarImage, { backgroundColor: isDark ? '#1E293B' : colors.bgCardElevated }]} />
          </TouchableOpacity>

          {/* Right Details Touch */}
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            onPress={() => {
              resetSwipe();
              onOpen(item, isPlayer);
            }}
            activeOpacity={0.7}
            delayPressIn={0}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.titleText, { color: colors.textPrimary }]} numberOfLines={1}>
                {name}
              </Text>

              {isPlayer ? (
                <Text style={[styles.subText, { color: colors.textSecondary, fontWeight: '800' }]} numberOfLines={1}>
                  {`Jamoa: ${displayTeam}`}
                </Text>
              ) : null}

              {displayLeague ? (
                <Text style={[styles.subText, { color: colors.textMuted }]} numberOfLines={1}>
                  {`Liga: ${displayLeague}`}
                </Text>
              ) : null}
            </View>

            {isArchived ? (
              <TouchableOpacity
                style={{
                  backgroundColor: isDark ? 'rgba(74, 222, 128, 0.18)' : '#ECFDF5',
                  borderColor: colors.accentGreen,
                  borderWidth: 1,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
                onPress={() => onRestore && onRestore(item)}
              >
                <Ionicons name="refresh-outline" size={14} color={colors.accentGreen} />
                <Text style={{ color: colors.accentGreen, fontSize: 11, fontWeight: '800' }}>{"Qaytarish"}</Text>
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

export const PlayersScreen: React.FC<Props> = ({ onNavigate, initialSegmentTab }) => {
  const { orgId, userRole, collabLeagueNames, collabLeagueIds } = useOrg();
  const { isDark, colors } = useTheme();
  const isReadOnlyUser = userRole === 'user';
  const [fullImagePreview, setFullImagePreview] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'players' | 'teams'>(initialSegmentTab || 'players');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  useEffect(() => {
    if (initialSegmentTab) {
      setActiveTab(initialSegmentTab);
    }
  }, [initialSegmentTab]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
      setPlayerPage(0);
      setTeamPage(0);
      setAccumulatedPlayers([]);
      setAccumulatedTeams([]);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const queryClient = useQueryClient();

  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Pagination Constants (25 players per page, 10 teams per page)
  const PLAYER_PAGE_SIZE = 25;
  const TEAM_PAGE_SIZE = 10;

  const [playerPage, setPlayerPage] = useState(0);
  const [accumulatedPlayers, setAccumulatedPlayers] = useState<any[]>([]);
  const [teamPage, setTeamPage] = useState(0);
  const [accumulatedTeams, setAccumulatedTeams] = useState<any[]>([]);
  const [morePlayersAvailable, setMorePlayersAvailable] = useState<boolean | null>(null);
  const [moreTeamsAvailable, setMoreTeamsAvailable] = useState<boolean | null>(null);

  // Top Filter States (League & Team)
  const [selectedLeagueFilter, setSelectedLeagueFilter] = useState<string>('all');
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string | number>('all');

  const [showArchived, setShowArchived] = useState<boolean>(false);

  // 1. React Query Hooks for initial page (page 0)
  const {
    data: playersData,
    isLoading: loadingPlayers,
    refetch: refetchPlayers,
  } = usePlayersData(orgId, debouncedSearchQuery, 0, PLAYER_PAGE_SIZE, showArchived, collabLeagueNames, selectedLeagueFilter, selectedTeamFilter);

  const {
    data: teamsData,
    isLoading: loadingTeams,
    refetch: refetchTeams,
  } = useTeamsPaginatedData(orgId, debouncedSearchQuery, 0, TEAM_PAGE_SIZE, showArchived, collabLeagueNames, selectedLeagueFilter);

  const { data: allTeamsList = [] } = useTeamsData(orgId, collabLeagueNames);
  const { data: leagues = [] } = useLeaguesData(orgId, collabLeagueIds);

  useEffect(() => {
    setPlayerPage(0);
    setTeamPage(0);
    setAccumulatedPlayers([]);
    setAccumulatedTeams([]);
    setMorePlayersAvailable(null);
    setMoreTeamsAvailable(null);
  }, [debouncedSearchQuery, showArchived, orgId, selectedLeagueFilter, selectedTeamFilter]);

  // Instantaneous data resolution: use initial cache when page is 0, or accumulated state on pagination
  const players = playerPage === 0 ? (playersData?.players || accumulatedPlayers) : accumulatedPlayers;
  const teams = teamPage === 0 ? (teamsData?.teams || accumulatedTeams) : accumulatedTeams;
  const hasMorePlayers = morePlayersAvailable !== null ? morePlayersAvailable : (playersData?.hasMore ?? false);
  const hasMoreTeams = moreTeamsAvailable !== null ? moreTeamsAvailable : (teamsData?.hasMore ?? false);

  // Seamless loading state: active only while fetching initial page and no items are in memory
  const loading = activeTab === 'players'
    ? (loadingPlayers && players.length === 0)
    : (loadingTeams && teams.length === 0);
  const [totalTeamsCount, setTotalTeamsCount] = useState<number>(0);

  // Archive Full-Page Modal State & Tabs
  const [showArchiveModal, setShowArchiveModal] = useState<boolean>(false);
  const [archiveTab, setArchiveTab] = useState<'players' | 'teams'>('players');
  const [archivedPlayers, setArchivedPlayers] = useState<any[]>([]);
  const [archivedTeams, setArchivedTeams] = useState<any[]>([]);
  const [loadingArchive, setLoadingArchive] = useState<boolean>(false);
  const [archiveSearchQuery, setArchiveSearchQuery] = useState<string>('');
  const [archiveLeagueFilter, setArchiveLeagueFilter] = useState<string>('all');
  const [archiveTeamFilter, setArchiveTeamFilter] = useState<string>('all');
  const [showArchiveFilterModal, setShowArchiveFilterModal] = useState(false);

  // Single Open Card & Swipe Scroll Lock State
  const [openSwipeableId, setOpenSwipeableId] = useState<string | null>(null);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);

  // Selection Detail Modal State & Editable Form State
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Interactive Openable/Closable Modal Select Picker State
  const [selectPickerConfig, setSelectPickerConfig] = useState<{
    title: string;
    selectedValue: any;
    options: { label: string; value: any }[];
    onSelect: (value: any, label: string) => void;
  } | null>(null);

  // 5-Second Countdown Delete Confirmation Modal State
  const [itemToDelete, setItemToDelete] = useState<any | null>(null);
  const [deleteCountdown, setDeleteCountdown] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const deleteTimerRef = useRef<any>(null);

  const [editForm, setEditForm] = useState<{
    first_name: string;
    last_name: string;
    father_name: string;
    phone: string;
    passport_series: string;
    passport_number: string;
    birth_date: string;
    position: string;
    player_number: string;
    league: string;
    team_id: string | number;
    team_name: string;
    citizenship: string;
    height: string;
    weight: string;
    instagram_username: string;
    name: string;
    city: string;
  }>({
    first_name: '',
    last_name: '',
    father_name: '',
    phone: '',
    passport_series: '',
    passport_number: '',
    birth_date: '',
    position: '',
    player_number: '',
    league: '',
    team_id: '',
    team_name: '',
    citizenship: '',
    height: '',
    weight: '',
    instagram_username: '',
    name: '',
    city: '',
  });

  // Realtime Subscription for Applications
  useEffect(() => {
    const channel = supabase
      .channel('players_realtime_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => {
        queryClient.invalidateQueries({ queryKey: ['players', Number(orgId) || 1] });
        queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  // Reset filters when modal opens
  useEffect(() => {
    if (showArchiveModal) {
      setArchiveLeagueFilter('all');
      setArchiveTeamFilter('all');
      setArchiveSearchQuery('');
    }
  }, [showArchiveModal]);

  useEffect(() => {
    if (showArchiveModal) {
      fetchArchivedData();
    }
  }, [showArchiveModal, archiveTab, archiveSearchQuery, archiveLeagueFilter, archiveTeamFilter]);

  const fetchArchivedData = async () => {
    setLoadingArchive(true);
    try {
      const dbClient = supabase;

      if (archiveTab === 'players') {
        console.log(`[ARCHIVE] Fetching archived players for org: ${orgId}`);
        console.log(`[ARCHIVE] Active filters - League: ${archiveLeagueFilter}, Team: ${archiveTeamFilter}, Search: ${archiveSearchQuery}`);

        // ✅ Fetch from applications table only (players table doesn't exist)
        let query = dbClient
          .from('applications')
          .select('*, team:teams(id, name, league, logo_url)')
          .or('is_archived.eq.true,status.eq.archived')
          .order('created_at', { ascending: false }); // ✅ Use created_at instead of updated_at

        if (collabLeagueNames && collabLeagueNames.length > 0) {
          try {
            const { data: cTeams } = await dbClient
              .from('teams')
              .select('id')
              .in('league', collabLeagueNames);
            const cTeamIds = (cTeams || []).map((t: any) => t.id).filter(Boolean);
            if (cTeamIds.length > 0) {
              query = query.or(`organization_id.eq.${orgId || 1},team_id.in.(${cTeamIds.join(',')})`);
            } else if (orgId) {
              query = query.eq('organization_id', orgId);
            }
          } catch (e) {
            if (orgId) query = query.eq('organization_id', orgId);
          }
        } else if (orgId) {
          query = query.eq('organization_id', orgId);
        }

        const { data, error } = await query;

        if (error) {
          console.error('[ARCHIVE] Applications query error:', error);
        }

        let res = data || [];
        console.log(`[ARCHIVE] Raw data count: ${res.length}`);
        if (res.length > 0) {
          console.log(`[ARCHIVE] Sample item:`, JSON.stringify(res[0], null, 2));
        }

        // ✅ Search filter
        if (archiveSearchQuery.trim()) {
          const q = archiveSearchQuery.toLowerCase().trim();
          res = res.filter((p: any) => {
            const fn = (p.first_name || '').toLowerCase();
            const ln = (p.last_name || '').toLowerCase();
            const full = (p.full_name || '').toLowerCase();
            const phone = (p.phone || '').toLowerCase();
            const teamName = (p.team?.name || '').toLowerCase();
            return fn.includes(q) || ln.includes(q) || full.includes(q) || phone.includes(q) || teamName.includes(q);
          });
        }

        // ✅ League filter
        if (archiveLeagueFilter !== 'all') {
          console.log(`[ARCHIVE] Filtering by league: ${archiveLeagueFilter}`);
          res = res.filter((p: any) => {
            const playerLeague = p.team?.league || p.league || '';
            return playerLeague === archiveLeagueFilter;
          });
          console.log(`[ARCHIVE] After league filter: ${res.length}`);
        }

        // ✅ Team filter
        if (archiveTeamFilter !== 'all') {
          console.log(`[ARCHIVE] Filtering by team: ${archiveTeamFilter}`);
          res = res.filter((p: any) => String(p.team_id) === String(archiveTeamFilter));
          console.log(`[ARCHIVE] After team filter: ${res.length}`);
        }

        console.log(`[ARCHIVE] Final count: ${res.length}`);
        setArchivedPlayers(res);
      } else {
        let query = dbClient
          .from('teams')
          .select('*')
          .or('is_archived.eq.true,status.eq.archived')
          .order('name');

        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          query = query.or(`organization_id.eq.${orgId || 1},league.in.(${escapedNames})`);
        } else if (orgId) {
          query = query.eq('organization_id', orgId);
        }

        const { data } = await query;
        let res = data || [];
        if (archiveSearchQuery.trim()) {
          const q = archiveSearchQuery.toLowerCase().trim();
          res = res.filter((t: any) => (t.name || '').toLowerCase().includes(q));
        }
        setArchivedTeams(res);
      }
    } catch (e) {
      console.error('Fetch archive error:', e);
    } finally {
      setLoadingArchive(false);
    }
  };

  const handleRestoreArchivedPlayer = async (playerItem: any) => {
    try {
      const dbClient = supabase;
      setArchivedPlayers((prev) => prev.filter((p) => p.id !== playerItem.id));

      try {
        await dbClient.from('applications').update({ is_archived: false, status: 'approved' }).eq('id', playerItem.id);
      } catch (e) {
        await dbClient.from('applications').update({ status: 'approved' }).eq('id', playerItem.id);
      }


      setToastMsg("O'yinchi arxivdan qaytarildi! 🔄");
      setTimeout(() => setToastMsg(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['players', Number(orgId) || 1] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
    } catch (e) {
      console.error(e);
    }
  };

  const handleRestoreArchivedTeam = async (teamItem: any) => {
    try {
      const dbClient = supabase;
      setArchivedTeams((prev) => prev.filter((t) => t.id !== teamItem.id));

      await dbClient.from('teams').update({ is_archived: false, status: 'approved' }).eq('id', teamItem.id);

      setToastMsg("Jamoa arxivdan qaytarildi! 🔄");
      setTimeout(() => setToastMsg(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['teams', Number(orgId) || 1] });
      queryClient.invalidateQueries({ queryKey: ['paginatedTeams', Number(orgId) || 1] });
      refetchTeams();
    } catch (e) {
      console.error(e);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetchPlayers(),
      refetchTeams(),
    ]);
    setRefreshing(false);
  };

  // Fetch Total Database Counters
  const fetchTotalCounts = async () => {
    try {
      const dbClient = supabase;

      // Approved Teams Total Count
      let tQuery = dbClient
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .or('status.eq.approved,status.eq.qisman,status.is.null');

      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map(n => `"${n.replace(/"/g, '""')}"`).join(',');
          tQuery = tQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          tQuery = tQuery.eq('organization_id', orgId);
        }
      }
      const { count: tCount } = await tQuery;
      if (tCount !== null && tCount !== undefined) {
        setTotalTeamsCount(tCount);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Seamless Next Batch Fetching (50 players / 10 teams) without async rendering gaps
  const handleLoadMoreBtn = async () => {
    if (loadingMore || loading) return;
    setLoadingMore(true);

    try {
      const dbClient = supabase;
      const targetOrgId = Number(orgId) || 1;

      if (activeTab === 'players' && hasMorePlayers) {
        const nextPage = playerPage + 1;
        const from = nextPage * PLAYER_PAGE_SIZE;
        const to = from + PLAYER_PAGE_SIZE;

        let query = dbClient
          .from('applications')
          .select(`
            id, first_name, last_name, father_name, birth_date,
            passport_series, passport_number, phone, photo_url, position,
            player_number, team_id, status, is_archived, comment, created_at, organization_id,
            height, weight, citizenship, instagram_username, league,
            team:team_id (id, name, logo_url, league)
          `)
          .eq('is_archived', showArchived)
          .eq('status', showArchived ? 'archived' : 'approved')
          .order('created_at', { ascending: false })
          .range(from, to);

        if (collabLeagueNames && collabLeagueNames.length > 0) {
          try {
            const { data: cTeams } = await dbClient
              .from('teams')
              .select('id')
              .in('league', collabLeagueNames);
            const cTeamIds = (cTeams || []).map((t: any) => t.id).filter(Boolean);
            if (cTeamIds.length > 0) {
              query = query.or(`organization_id.eq.${targetOrgId},team_id.in.(${cTeamIds.join(',')})`);
            } else if (targetOrgId) {
              query = query.eq('organization_id', targetOrgId);
            }
          } catch (e) {
            if (targetOrgId) query = query.eq('organization_id', targetOrgId);
          }
        } else if (targetOrgId) {
          query = query.eq('organization_id', targetOrgId);
        }

        if (selectedLeagueFilter && selectedLeagueFilter !== 'all') {
          try {
            const { data: lTeams } = await dbClient
              .from('teams')
              .select('id')
              .ilike('league', `%${selectedLeagueFilter}%`);
            const lTeamIds = (lTeams || []).map((t: any) => t.id).filter(Boolean);
            if (lTeamIds.length > 0) {
              query = query.in('team_id', lTeamIds);
            } else {
              setMorePlayersAvailable(false);
              return;
            }
          } catch (e) {
            setMorePlayersAvailable(false);
            return;
          }
        }

        if (selectedTeamFilter && selectedTeamFilter !== 'all') {
          query = query.eq('team_id', String(selectedTeamFilter));
        }

        if (debouncedSearchQuery && debouncedSearchQuery.trim()) {
          const s = `%${debouncedSearchQuery.trim()}%`;
          query = query.or(
            `first_name.ilike.${s},last_name.ilike.${s},passport_series.ilike.${s},passport_number.ilike.${s},phone.ilike.${s}`
          );
        }

        const { data, error } = await query;
        if (error) {
          console.error('Players load more query error:', error);
        }
        if (data && data.length > 0) {
          const rows = data.slice(0, PLAYER_PAGE_SIZE);
          const currentBase = playerPage === 0 ? (playersData?.players || accumulatedPlayers) : accumulatedPlayers;
          const existingIds = new Set(currentBase.map((p) => String(p.id)));
          const uniqueNew = rows.filter((p: any) => !existingIds.has(String(p.id)));
          setAccumulatedPlayers([...currentBase, ...uniqueNew]);
          setPlayerPage(nextPage);
          setMorePlayersAvailable(data.length > PLAYER_PAGE_SIZE);
        } else if (data && data.length === 0) {
          setMorePlayersAvailable(false);
        }
      } else if (activeTab === 'teams' && hasMoreTeams) {
        const nextPage = teamPage + 1;
        const from = nextPage * TEAM_PAGE_SIZE;
        const to = from + TEAM_PAGE_SIZE;

        let query = dbClient
          .from('teams')
          .select('id, name, logo_url, league, status, is_archived, captain_phone, organization_id, created_at')
          .eq('is_archived', showArchived)
          .eq('status', showArchived ? 'archived' : 'approved')
          .order('name', { ascending: true })
          .range(from, to);

        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          query = query.or(`organization_id.eq.${targetOrgId},league.in.(${escapedNames})`);
        } else if (targetOrgId) {
          query = query.eq('organization_id', targetOrgId);
        }

        if (selectedLeagueFilter && selectedLeagueFilter !== 'all') {
          query = query.ilike('league', `%${selectedLeagueFilter}%`);
        }

        if (debouncedSearchQuery && debouncedSearchQuery.trim()) {
          query = query.ilike('name', `%${debouncedSearchQuery.trim()}%`);
        }

        const { data, error } = await query;
        if (error) {
          console.error('Teams load more query error:', error);
        }
        if (data && data.length > 0) {
          const rows = data.slice(0, TEAM_PAGE_SIZE);
          const currentBase = teamPage === 0 ? (teamsData?.teams || accumulatedTeams) : accumulatedTeams;
          const existingIds = new Set(currentBase.map((t) => String(t.id)));
          const uniqueNew = rows.filter((t: any) => !existingIds.has(String(t.id)));
          setAccumulatedTeams([...currentBase, ...uniqueNew]);
          setTeamPage(nextPage);
          setMoreTeamsAvailable(data.length > TEAM_PAGE_SIZE);
        } else if (data && data.length === 0) {
          setMoreTeamsAvailable(false);
        }
      }
    } catch (e) {
      console.error('handleLoadMoreBtn error:', e);
    } finally {
      setLoadingMore(false);
    }
  };

  // Helper to extract Instagram username
  const getInstagramUser = (p: any) => {
    if (!p) return '';
    if (p.instagram_username) return p.instagram_username.replace(/^@/, '');
    if (p.comment) {
      const match = p.comment.match(/\[INSTAGRAM:https?:\/\/[^/]+\/([^/\]]+)/);
      if (match?.[1]) return match[1];
    }
    return '';
  };

  // Open Detail Modal and Resolve Team Name (from item.team relation)
  const handleOpenItem = (item: any, isPlayer: boolean) => {
    setSelectedItem({ ...item, isPlayer });
    setIsEditing(false);

    let fName = item.first_name || '';
    let lName = item.last_name || '';
    let fatName = item.father_name || item.middle_name || '';

    if (!fName && !lName) {
      const rawName = item.full_name || item.name || '';
      const parts = rawName.trim().split(' ').filter(Boolean);
      fName = parts[0] || '';
      lName = parts[1] || '';
      fatName = parts.slice(2).join(' ') || '';
    }

    const currentTeamId = item.team_id || (item.team ? item.team.id : '');
    let resolvedTeamName = '';
    if (currentTeamId) {
      const foundTeam = allTeamsList?.find((t: any) => String(t.id) === String(currentTeamId));
      if (foundTeam?.name) {
        resolvedTeamName = foundTeam.name;
      } else if (item.team?.name && item.team.name !== 'Yakkaxon') {
        resolvedTeamName = item.team.name;
      } else if (item.team_name && item.team_name !== 'Yakkaxon' && isNaN(Number(item.team_name))) {
        resolvedTeamName = item.team_name;
      } else {
        resolvedTeamName = `Jamoa #${currentTeamId}`;
      }
    } else {
      resolvedTeamName = (item.team?.name && item.team.name !== 'Yakkaxon')
        ? item.team.name
        : (item.team_name && item.team_name !== 'Yakkaxon' && isNaN(Number(item.team_name)))
        ? item.team_name
        : 'Yakkaxon';
    }

    let resolvedLeague = '';
    if (currentTeamId) {
      const foundTeam = allTeamsList?.find((t: any) => String(t.id) === String(currentTeamId));
      if (foundTeam?.league) {
        resolvedLeague = foundTeam.league;
      }
    }
    if (!resolvedLeague) {
      const commentLeague = item.comment?.match(/\[LEAGUE:([^\]]+)\]/)?.[1]?.trim() || '';
      resolvedLeague = item.team?.league || item.league || item.league_name || commentLeague || '';
    }

    let itemCitizenship = item.citizenship || '';
    let itemHeight = item.height !== null && item.height !== undefined && item.height !== '' ? String(item.height) : '';
    let itemWeight = item.weight !== null && item.weight !== undefined && item.weight !== '' ? String(item.weight) : '';
    let itemInsta = (item.instagram_username || getInstagramUser(item) || '').replace(/^@/, '');

    if (item.comment) {
      const metaMatch = item.comment.match(/\[METADATA:({[^\]]+})\]/);
      if (metaMatch?.[1]) {
        try {
          const obj = JSON.parse(metaMatch[1]);
          if (!itemCitizenship && obj.citizenship) itemCitizenship = obj.citizenship;
          if (!itemHeight && obj.height) itemHeight = String(obj.height);
          if (!itemWeight && obj.weight) itemWeight = String(obj.weight);
        } catch (e) {}
      }
    }

    setEditForm({
      first_name: fName,
      last_name: lName,
      father_name: fatName,
      phone: item.phone || item.contact_phone || '',
      passport_series: item.passport_series || (item.passport ? item.passport.substring(0, 2) : ''),
      passport_number: item.passport_number || (item.passport ? item.passport.substring(2) : ''),
      birth_date: item.birth_date || item.age || '',
      position: item.position || '',
      player_number: item.player_number ? String(item.player_number) : (item.number ? String(item.number) : ''),
      league: item.league || resolvedLeague,
      team_id: currentTeamId || '',
      team_name: resolvedTeamName,
      citizenship: itemCitizenship,
      height: itemHeight,
      weight: itemWeight,
      instagram_username: itemInsta,
      name: item.name || '',
      city: item.city || '',
    });
  };

  // Triggers Openable/Closable Modal Select Picker
  const handleOpenLeaguePicker = () => {
    if (!isEditing) return;
    setSelectPickerConfig({
      title: 'Ligani Tanlang',
      selectedValue: editForm.league,
      options: leagues.map((l) => ({ label: l.name, value: l.name })),
      onSelect: (val: string) => {
        setEditForm((prev) => ({ ...prev, league: val }));
      },
    });
  };

  const handleOpenTeamPicker = () => {
    if (!isEditing) return;
    const targetLeague = (editForm.league || '').trim().toLowerCase();
    let filteredTeams = allTeamsList;

    if (targetLeague) {
      filteredTeams = allTeamsList.filter((t: any) => {
        const teamLeague = (t.league || t.league_name || '').trim().toLowerCase();
        return !teamLeague || teamLeague.includes(targetLeague) || targetLeague.includes(teamLeague);
      });
      // Fallback: If no teams matched that specific string, show all teams
      if (filteredTeams.length === 0) {
        filteredTeams = allTeamsList;
      }
    }

    setSelectPickerConfig({
      title: 'Jamoani Tanlang',
      selectedValue: editForm.team_id ? String(editForm.team_id) : '',
      options: [
        { label: 'Yakkaxon (Jamoasiz)', value: '' },
        ...filteredTeams.map((t: any) => ({
          label: t.league ? `${t.name} (${t.league})` : t.name,
          value: String(t.id),
        })),
      ],
      onSelect: (val: any, label: string) => {
        if (!val) {
          setEditForm((prev) => ({ ...prev, team_id: '', team_name: 'Yakkaxon' }));
          return;
        }
        const pureName = label.replace(/\s*\([^)]*\)$/, '').trim();
        const selectedTeam = allTeamsList?.find((t: any) => String(t.id) === String(val));
        setEditForm((prev) => ({
          ...prev,
          team_id: val,
          team_name: selectedTeam?.name || pureName,
          league: selectedTeam?.league || prev.league,
        }));
      },
    });
  };

  const handleOpenPositionPicker = () => {
    if (!isEditing) return;
    setSelectPickerConfig({
      title: 'Pozitsiyani (Ampula) Tanlang',
      selectedValue: editForm.position,
      options: [
        { label: 'Darvozabon', value: 'Darvozabon' },
        { label: 'Himoyachi', value: 'Himoyachi' },
        { label: 'Yarim himoyachi', value: 'Yarim himoyachi' },
        { label: 'Hujumchi', value: 'Hujumchi' },
      ],
      onSelect: (val: string) => {
        setEditForm((prev) => ({ ...prev, position: val }));
      },
    });
  };

  // Execute Direct Archiving without warning dialogs
  const executeDirectArchive = async (itemToArchive: any) => {
    if (!itemToArchive) return;
    const isPlayer = activeTab === 'players';
    const dbClient = supabase;

    if (isPlayer) {
      // 1. Add to archived list in RAM
      setArchivedPlayers((prev) => [{ ...itemToArchive, is_archived: true, status: 'archived' }, ...prev]);

      // 2. Update DB in background
      try {
        await dbClient.from('applications').update({ is_archived: true, status: 'archived' }).eq('id', itemToArchive.id);
      } catch (e) {
        await dbClient.from('applications').update({ status: 'archived' }).eq('id', itemToArchive.id);
      }
    } else {
      setAccumulatedTeams((prev) => prev.filter((t) => String(t.id) !== String(itemToArchive.id)));
      setArchivedTeams((prev) => [{ ...itemToArchive, is_archived: true, status: 'archived' }, ...prev]);

      try {
        await dbClient.from('teams').update({ is_archived: true, status: 'archived' }).eq('id', itemToArchive.id);
      } catch (e) {}
    }

    setToastMsg("Muvaffaqiyatli arxivlandi! 📦");
    setTimeout(() => setToastMsg(null), 2500);
    queryClient.invalidateQueries({ queryKey: ['players', Number(orgId) || 1] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
    fetchTotalCounts();
  };

  // Delete Handlers for Countdown Modal
  const handleCancelDelete = () => {
    if (deleteTimerRef.current) clearInterval(deleteTimerRef.current);
    setDeleteCountdown(null);
    setItemToDelete(null);
    setIsDeleting(false);
  };

  const handleExecuteDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
      const dbClient = supabase;
      const isPlayer = activeTab === 'players' || !itemToDelete.isTeam;
      if (isPlayer) {
        setArchivedPlayers((prev) => prev.filter((p) => String(p.id) !== String(itemToDelete.id)));
        await dbClient.from('applications').delete().eq('id', itemToDelete.id);
        queryClient.invalidateQueries({ queryKey: ['players', Number(orgId) || 1] });
        queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
      } else {
        setAccumulatedTeams((prev) => prev.filter((t) => String(t.id) !== String(itemToDelete.id)));
        setArchivedTeams((prev) => prev.filter((t) => String(t.id) !== String(itemToDelete.id)));
        await dbClient.from('teams').delete().eq('id', itemToDelete.id);
        queryClient.invalidateQueries({ queryKey: ['teams', Number(orgId) || 1] });
      }
      setItemToDelete(null);
      setToastMsg("Muvaffaqiyatli o'chirildi! 🗑️");
      setTimeout(() => setToastMsg(null), 2500);
      fetchTotalCounts();
    } catch (e) {
      console.error('Delete error:', e);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStartDeleteCountdown = () => {
    if (!itemToDelete) return;
    setDeleteCountdown(5);
    deleteTimerRef.current = setInterval(async () => {
      setDeleteCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(deleteTimerRef.current);
          handleExecuteDelete();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Restore Archived Player Back to Active
  const handleRestorePlayer = async (playerItem: any) => {
    try {
      const dbClient = supabase;

      try {
        await dbClient.from('applications').update({ is_archived: false, status: 'approved' }).eq('id', playerItem.id);
      } catch (e) {
        await dbClient.from('applications').update({ status: 'approved' }).eq('id', playerItem.id);
      }


      setToastMsg("O'yinchi arxivdan qaytarildi! 🔄");
      setTimeout(() => setToastMsg(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['players', Number(orgId) || 1] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
    } catch (e) {
      console.error(e);
    }
  };

  // Save Details to Supabase Database
  const handleSaveDetails = async () => {
    if (!selectedItem || saving) return;
    setSaving(true);

    try {
      const dbClient = supabase;
      const isPlayer = selectedItem.isPlayer;

      if (isPlayer) {
        // Build updated comment containing METADATA & INSTAGRAM & LEAGUE if provided
        const currentComment = selectedItem.comment || '';
        const cleanComment = currentComment
          .replace(/\[METADATA:[^\]]+\]/g, '')
          .replace(/\[INSTAGRAM:[^\]]+\]/g, '')
          .replace(/\[LEAGUE:[^\]]+\]/g, '')
          .replace(/\[INDIVIDUAL\]/g, '')
          .trim();

        const metaObj: Record<string, string> = {};
        if (editForm.citizenship) metaObj.citizenship = editForm.citizenship;
        if (editForm.height) metaObj.height = editForm.height;
        if (editForm.weight) metaObj.weight = editForm.weight;

        const newTeamId = editForm.team_id && editForm.team_id !== 'all' && editForm.team_id !== '' ? String(editForm.team_id) : null;
        const matchedTeam = allTeamsList.find((t: any) => String(t.id) === String(newTeamId)) || null;

        let updatedComment = cleanComment;
        if (!newTeamId) {
          updatedComment = `[INDIVIDUAL] ${updatedComment}`.trim();
        }
        if (editForm.league) {
          updatedComment += ` [LEAGUE:${editForm.league}]`;
        }
        if (Object.keys(metaObj).length > 0) {
          updatedComment += ` [METADATA:${JSON.stringify(metaObj)}]`;
        }
        if (editForm.instagram_username) {
          const rawInsta = editForm.instagram_username.trim();
          const instaUrl = rawInsta.startsWith('http')
            ? rawInsta
            : `https://instagram.com/${rawInsta.replace('@', '')}`;
          updatedComment += ` [INSTAGRAM:${instaUrl}]`;
        }

        const cleanInsta = (editForm.instagram_username || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '');

        // Direct SQL columns in `applications` table
        const updatePayload: Record<string, any> = {
          first_name: editForm.first_name || '',
          last_name: editForm.last_name || '',
          father_name: editForm.father_name || '',
          phone: editForm.phone || '',
          passport_series: editForm.passport_series || '',
          passport_number: editForm.passport_number || '',
          birth_date: editForm.birth_date || null,
          position: editForm.position || '',
          player_number: editForm.player_number ? Number(editForm.player_number) : null,
          team_id: newTeamId,
          height: editForm.height ? Number(editForm.height) : null,
          weight: editForm.weight ? Number(editForm.weight) : null,
          citizenship: editForm.citizenship || null,
          instagram_username: cleanInsta || null,
          league: editForm.league || null,
          comment: updatedComment.trim(),
        };

        const { error } = await dbClient
          .from('applications')
          .update(updatePayload)
          .eq('id', selectedItem.id);

        if (error) {
          console.error('Update player error:', error);
          Alert.alert('Xatolik', "O'yinchi ma'lumotlarini saqlashda xatolik yuz berdi: " + (error.message || ''));
          return;
        }

        // Optimistically update selectedItem so the open modal immediately displays the new team
        const updatedItem = {
          ...selectedItem,
          ...updatePayload,
          team: matchedTeam
            ? { id: matchedTeam.id, name: matchedTeam.name, logo_url: matchedTeam.logo_url, league: matchedTeam.league }
            : (newTeamId ? { id: newTeamId, name: editForm.team_name || `Jamoa #${newTeamId}` } : null),
        };
        setSelectedItem(updatedItem);

        // Optimistically update list state
        setAccumulatedPlayers((prev) =>
          prev.map((p) => (p.id === selectedItem.id ? updatedItem : p))
        );

        // Update all players queries in cache directly
        queryClient.setQueriesData({ queryKey: ['players'] }, (old: any) => {
          if (!old) return old;
          if (Array.isArray(old)) {
            return old.map((p: any) => (p.id === selectedItem.id ? updatedItem : p));
          }
          if (old.players && Array.isArray(old.players)) {
            return {
              ...old,
              players: old.players.map((p: any) => (p.id === selectedItem.id ? updatedItem : p)),
            };
          }
          return old;
        });

        // Invalidate React Query cache completely
        await queryClient.invalidateQueries({ queryKey: ['players'] });
        await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        refetchPlayers();
        fetchTotalCounts();
      } else {
        const updatePayload = {
          name: editForm.name || '',
          league: editForm.league || '',
          phone: editForm.phone || '',
          city: editForm.city || '',
        };

        const { error } = await dbClient
          .from('teams')
          .update(updatePayload)
          .eq('id', selectedItem.id);

        if (error) {
          console.error('Update team error:', error);
          Alert.alert('Xatolik', "Jamoa ma'lumotlarini saqlashda xatolik yuz berdi: " + (error.message || ''));
          return;
        }

        const updatedTeam = {
          ...selectedItem,
          ...updatePayload,
        };
        setSelectedItem(updatedTeam);

        // Optimistically update teams list state
        setAccumulatedTeams((prev) =>
          prev.map((t) => (t.id === selectedItem.id ? updatedTeam : t))
        );

        await queryClient.invalidateQueries({ queryKey: ['teams'] });
        await queryClient.invalidateQueries({ queryKey: ['paginatedTeams'] });
        refetchTeams();
        fetchTotalCounts();
      }

      setToastMsg("Ma'lumotlar muvaffaqiyatli saqlandi! ✨");
      setIsEditing(false);
      setTimeout(() => setToastMsg(null), 3000);
    } catch (e: any) {
      console.error('handleSaveDetails catch:', e);
      Alert.alert('Xatolik', "Ma'lumotlarni saqlashda kutilmagan xatolik yuz berdi: " + (e?.message || ''));
    } finally {
      setSaving(false);
    }
  };

  // Reusable Overlay Select Picker (renders as absolute view overlay, NOT a native modal to avoid iOS double-modal drops)
  const renderSelectPicker = () => {
    if (!selectPickerConfig) return null;
    return (
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.pickerOverlay,
          { zIndex: 999999, elevation: 999999 },
        ]}
      >
        {/* Backdrop Tap to Dismiss */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => setSelectPickerConfig(null)}
        />

        <View style={[styles.pickerCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {Platform.OS === 'ios' && <BlurView pointerEvents="none" intensity={90} tint="dark" style={StyleSheet.absoluteFill} />}
          <View style={[styles.pickerHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.pickerTitle, { color: colors.textPrimary }]}>
              {selectPickerConfig.title || 'Tanlang'}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectPickerConfig(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ maxHeight: 340 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {selectPickerConfig.options && selectPickerConfig.options.length > 0 ? (
              selectPickerConfig.options.map((opt: any, idx: number) => {
                const isSelected = String(selectPickerConfig.selectedValue) === String(opt.value);
                return (
                  <TouchableOpacity
                    key={`opt-${idx}-${opt.value}`}
                    style={[
                      styles.pickerOptionRow,
                      { borderBottomColor: colors.border },
                      isSelected && {
                        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : colors.bgCardElevated,
                      },
                    ]}
                    onPress={() => {
                      selectPickerConfig.onSelect(opt.value, opt.label);
                      setSelectPickerConfig(null);
                    }}
                    activeOpacity={0.6}
                    delayPressIn={0}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        { color: colors.textSecondary },
                        isSelected && { color: colors.accentGreen, fontWeight: '900' },
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />
                    )}
                  </TouchableOpacity>
                );
              })
            ) : (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>{"Variantlar mavjud emas"}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      {/* Toast Notification Banner */}
      {toastMsg && (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      )}

      {/* Global Search Input & Archive Icon Button */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View style={[styles.searchContainer, { flex: 1, marginBottom: 0 }, Platform.OS === 'android' && { borderColor: colors.border, backgroundColor: colors.bgCard }]}>
          {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />}
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder={activeTab === 'players' ? "O'yinchini qidirish (ism, tel, pasport)..." : "Jamoani qidirish..."}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* ARCHIVE ICON BUTTON (Only for Admins / Organizators) */}
        {!isReadOnlyUser && (
          <TouchableOpacity
            style={{
              height: 48,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: showArchiveModal ? (isDark ? 'rgba(245, 158, 11, 0.25)' : '#FEF3C7') : (isDark ? 'rgba(255, 255, 255, 0.08)' : colors.bgCard),
              borderWidth: 1.2,
              borderColor: showArchiveModal ? '#F59E0B' : colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              overflow: 'hidden',
            }}
            onPress={() => setShowArchiveModal(true)}
            activeOpacity={0.7}
          >
            {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />}
            <Ionicons
              name="archive-outline"
              size={20}
              color={showArchiveModal ? "#F59E0B" : (isDark ? "rgba(255,255,255,0.85)" : colors.textPrimary)}
            />
            <Text style={{ color: showArchiveModal ? '#F59E0B' : (isDark ? 'rgba(255,255,255,0.85)' : colors.textPrimary), fontSize: 12, fontWeight: '800' }}>
              {"Arxiv"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 2 Top Filter Selectors: Liga & Jamoa */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {/* League Filter Trigger */}
        <TouchableOpacity
          style={[
            styles.topFilterBtn,
            selectedLeagueFilter !== 'all' && styles.topFilterBtnActive,
            Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: selectedLeagueFilter !== 'all' ? colors.accentGreen : colors.border },
          ]}
          onPress={() => {
            const leagueOptions = [
              { label: 'Barcha Ligalar', value: 'all' },
              ...leagues.map((l: any) => ({ label: l.name, value: l.name })),
            ];
            setSelectPickerConfig({
              title: 'Liganing nomi boyicha filter',
              selectedValue: selectedLeagueFilter,
              options: leagueOptions,
              onSelect: (val) => {
                setSelectedLeagueFilter(val);
                if (selectedTeamFilter !== 'all') {
                  setSelectedTeamFilter('all');
                }
              },
            });
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="trophy-outline" size={15} color={selectedLeagueFilter !== 'all' ? (Platform.OS === 'android' ? colors.accentGreen : '#00FF87') : colors.textMuted} />
          <Text
            style={[
              styles.topFilterBtnText,
              Platform.OS === 'android' && { color: selectedLeagueFilter !== 'all' ? colors.accentGreen : colors.textPrimary },
            ]}
            numberOfLines={1}
          >
            {selectedLeagueFilter === 'all' ? 'Barcha Ligalar' : selectedLeagueFilter}
          </Text>
          <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Team Filter Trigger (Only on Players tab) */}
        {activeTab === 'players' && (
          <TouchableOpacity
            style={[
              styles.topFilterBtn,
              selectedTeamFilter !== 'all' && styles.topFilterBtnActive,
              Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: selectedTeamFilter !== 'all' ? colors.accentGreen : colors.border },
            ]}
            onPress={() => {
              const filteredTeamsList = selectedLeagueFilter === 'all'
                ? allTeamsList
                : allTeamsList.filter((t: any) => {
                    const l1 = (t.league || '').toLowerCase().trim();
                    const l2 = selectedLeagueFilter.toLowerCase().trim();
                    return l1.includes(l2) || l2.includes(l1);
                  });

              const teamOptions = [
                { label: 'Barcha Jamoalar', value: 'all' },
                ...filteredTeamsList.map((t: any) => ({
                  label: t.league ? `${t.name} (${t.league})` : t.name,
                  value: t.id,
                })),
              ];

              setSelectPickerConfig({
                title: 'Jamoaning nomi boyicha filter',
                selectedValue: selectedTeamFilter,
                options: teamOptions,
                onSelect: (val) => setSelectedTeamFilter(val),
              });
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="shield-outline" size={15} color={selectedTeamFilter !== 'all' ? (Platform.OS === 'android' ? colors.accentGreen : '#00FF87') : colors.textMuted} />
            <Text
              style={[
                styles.topFilterBtnText,
                Platform.OS === 'android' && { color: selectedTeamFilter !== 'all' ? colors.accentGreen : colors.textPrimary },
              ]}
              numberOfLines={1}
            >
              {selectedTeamFilter === 'all'
                ? 'Barcha Jamoalar'
                : (allTeamsList.find((t: any) => String(t.id) === String(selectedTeamFilter))?.name || 'Jamoa')}
            </Text>
            <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Segment Sub-Tabs (O'yinchilar vs Jamoalar) */}
      <View style={[styles.segmentContainer, Platform.OS === 'android' && { borderColor: colors.border, backgroundColor: colors.bgCardElevated }]}>
        {Platform.OS === 'ios' && <BlurView pointerEvents="none" intensity={70} tint="dark" style={StyleSheet.absoluteFill} />}
        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'players' && { backgroundColor: colors.accentGreen }]}
          onPress={() => setActiveTab('players')}
          activeOpacity={0.7}
          delayPressIn={0}
        >
          <Ionicons
            name="person"
            size={16}
            color={activeTab === 'players' ? '#FFFFFF' : colors.textMuted}
          />
          <Text
            style={[
              styles.segmentBtnText,
              { color: colors.textSecondary },
              activeTab === 'players' && { color: '#FFFFFF', fontWeight: '900' },
            ]}
          >
            {`O'yinchilar`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'teams' && { backgroundColor: colors.accentGreen }]}
          onPress={() => setActiveTab('teams')}
          activeOpacity={0.7}
          delayPressIn={0}
        >
          <Ionicons
            name="shield"
            size={16}
            color={activeTab === 'teams' ? '#FFFFFF' : colors.textMuted}
          />
          <Text
            style={[
              styles.segmentBtnText,
              { color: colors.textSecondary },
              activeTab === 'teams' && { color: '#FFFFFF', fontWeight: '900' },
            ]}
          >
            {`Jamoalar`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main List / Skeleton Loading State */}
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
          data={activeTab === 'players' ? players : teams}
          keyExtractor={(item, index) => (item && item.id ? `item-${item.id}-${index}` : `row-${index}`)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={true}
          initialNumToRender={15}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          onScrollBeginDrag={() => {
            if (openSwipeableId) {
              setOpenSwipeableId(null);
            }
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentGreen} />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={40} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {activeTab === 'players' ? "O'yinchilar yo'q" : "Jamoalar yo'q"}
              </Text>
            </View>
          }
          ListFooterComponent={
            ((activeTab === 'players' && hasMorePlayers) || (activeTab === 'teams' && hasMoreTeams)) ? (
              <View style={{ marginTop: 12, marginBottom: 20, alignItems: 'center' }}>
                <TouchableOpacity
                  style={[
                    styles.loadMoreButton,
                    Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                  ]}
                  onPress={handleLoadMoreBtn}
                  disabled={loadingMore}
                  activeOpacity={0.6}
                  delayPressIn={0}
                  hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
                >
                  {loadingMore ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color={Platform.OS === 'android' ? colors.accentGreen : '#FFFFFF'} />
                      <Text style={[styles.loadMoreBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                        {activeTab === 'players' ? "O'yinchilar yuklanmoqda..." : "Jamoalar yuklanmoqda..."}
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="arrow-down-circle" size={18} color={Platform.OS === 'android' ? colors.accentGreen : '#FFFFFF'} />
                      <Text style={[styles.loadMoreBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                        {activeTab === 'players'
                          ? "Yana 25 ta o'yinchini yuklash"
                          : "Yana 10 ta jamoani yuklash"}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <SwipeablePlayerCard
              item={item}
              isPlayer={activeTab === 'players'}
              allTeamsList={allTeamsList}
              isOpen={openSwipeableId === item.id}
              setIsSwiping={setIsSwiping}
              onSwipeOpen={() => setOpenSwipeableId(item.id)}
              onSwipeClose={() => {
                if (openSwipeableId === item.id) setOpenSwipeableId(null);
              }}
              onOpen={handleOpenItem}
              onDelete={executeDirectArchive}
              onRestore={(player: any) => handleRestorePlayer(player)}
              isArchived={showArchived}
              onImagePress={(imgUrl: string) => setFullImagePreview(imgUrl)}
              isReadOnlyUser={isReadOnlyUser}
            />
          )}
        />
      )}

      {/* 5-SECOND COUNTDOWN DELETE CONFIRMATION MODAL */}
      <Modal visible={!!itemToDelete} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={[styles.confirmCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <View style={styles.confirmHeaderIcon}>
              <Ionicons name="warning" size={32} color="#FF4D4D" />
            </View>

            <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>{"O'yinchini O'chirish"}</Text>
            <Text style={[styles.confirmMessage, { color: colors.textSecondary }]}>
              {`Haqiqatan ham "${itemToDelete?.full_name || itemToDelete?.first_name || itemToDelete?.name || "O'yinchi"}" ma'lumotlarini bazadan o'chirmoqchimisiz?`}
            </Text>

            {deleteCountdown !== null && (
              <View style={styles.countdownBadge}>
                <Ionicons name="timer-outline" size={20} color="#FF4D4D" />
                <Text style={styles.countdownNumber}>{`${deleteCountdown} soniya...`}</Text>
              </View>
            )}

            <View style={styles.confirmActionsRow}>
              <TouchableOpacity
                style={[styles.cancelConfirmBtn, { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                onPress={handleCancelDelete}
                activeOpacity={0.7}
              >
                <Text style={[styles.cancelConfirmText, { color: colors.textPrimary }]}>{"Bekor qilish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.deleteConfirmBtn, deleteCountdown !== null && styles.deleteConfirmBtnActive]}
                onPress={handleStartDeleteCountdown}
                disabled={deleteCountdown !== null || isDeleting}
                activeOpacity={0.8}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : deleteCountdown !== null ? (
                  <Text style={styles.deleteConfirmText}>{`O'chirilmoqda (${deleteCountdown}s)`}</Text>
                ) : (
                  <Text style={styles.deleteConfirmText}>{"Ha, O'chirish"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
            {/* DETAIL & EDITABLE MODAL MATCHING ADMIN PANEL */}
      <Modal
        visible={!!selectedItem}
        transparent
        animationType={Platform.OS === 'android' ? 'fade' : 'slide'}
        onRequestClose={() => setSelectedItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />}
            {/* Modal Header */}
            <View style={[styles.modalHeaderRow, { borderBottomColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons
                  name={selectedItem?.isPlayer ? "person" : "shield"}
                  size={20}
                  color={colors.accentGreen}
                />
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                  {selectedItem?.isPlayer ? "O'yinchini Tahrirlash" : "Jamoani Tahrirlash"}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedItem(null)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {selectedItem && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 12 }}>
                {/* Avatar Banner */}
                <View style={{ alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      const img = selectedItem.avatar_url || selectedItem.photo_url || selectedItem.logo_url;
                      if (img) setFullImagePreview(img);
                    }}
                  >
                    <ExpoImage
                      source={{
                        uri:
                          selectedItem.avatar_url ||
                          selectedItem.photo_url ||
                          selectedItem.logo_url ||
                          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop',
                      }}
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      style={[styles.detailAvatar, { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                    />
                  </TouchableOpacity>
                  <Text style={[styles.detailNameHeader, { color: colors.textPrimary }]}>
                    {`${editForm.first_name} ${editForm.last_name}`.trim() || editForm.name || "Noma'lum"}
                  </Text>
                </View>

                {/* Input Fields Grid Box */}
                <View style={[styles.detailInputsBox, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                  {selectedItem.isPlayer ? (
                    <>
                      {/* Separated First Name & Last Name */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Ismi"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                            editable={isEditing}
                            value={editForm.first_name}
                            onChangeText={(val) => setEditForm({ ...editForm, first_name: val })}
                            placeholder="Ismi..."
                            placeholderTextColor={colors.textMuted}
                          />
                        </View>

                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Familiyasi"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                            editable={isEditing}
                            value={editForm.last_name}
                            onChangeText={(val) => setEditForm({ ...editForm, last_name: val })}
                            placeholder="Familiyasi..."
                            placeholderTextColor={colors.textMuted}
                          />
                        </View>
                      </View>

                      {/* Father Name (Otasining ismi) */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Otasining Ismi"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                          editable={isEditing}
                          value={editForm.father_name}
                          onChangeText={(val) => setEditForm({ ...editForm, father_name: val })}
                          placeholder="Otasining ismi..."
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>

                      {/* Phone Input */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Telefon"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                          editable={isEditing}
                          value={editForm.phone}
                          onChangeText={(val) => setEditForm({ ...editForm, phone: val })}
                          placeholder="Telefon raqami..."
                          placeholderTextColor={colors.textMuted}
                          keyboardType="phone-pad"
                        />
                      </View>

                      {/* Passport Series & Number */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Seriya"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                            editable={isEditing}
                            value={editForm.passport_series}
                            onChangeText={(val) => setEditForm({ ...editForm, passport_series: val })}
                            placeholder="AA"
                            placeholderTextColor={colors.textMuted}
                            maxLength={3}
                          />
                        </View>

                        <View style={[styles.inputGroup, { flex: 2 }]}>
                          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Pasport Raqam"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                            editable={isEditing}
                            value={editForm.passport_number}
                            onChangeText={(val) => setEditForm({ ...editForm, passport_number: val })}
                            placeholder="1234567"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="numeric"
                          />
                        </View>
                      </View>

                      {/* Birth Date & Player Jersey Number */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.inputGroup, { flex: 2 }]}>
                          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Tug'ilgan Sana"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                            editable={isEditing}
                            value={editForm.birth_date}
                            onChangeText={(val) => setEditForm({ ...editForm, birth_date: val })}
                            placeholder="masalan: 10.07.1995"
                            placeholderTextColor={colors.textMuted}
                          />
                        </View>

                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Raqami (#)"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                            editable={isEditing}
                            value={editForm.player_number}
                            onChangeText={(val) => setEditForm({ ...editForm, player_number: val })}
                            placeholder="10"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="numeric"
                          />
                        </View>
                      </View>

                      {/* Position (Ampula) Interactive Select Picker */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Pozitsiya (Ampula)"}</Text>
                        <TouchableOpacity
                          style={[styles.selectBoxTrigger, isEditing && styles.selectBoxTriggerActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                          onPress={handleOpenPositionPicker}
                          disabled={!isEditing}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectBoxValue, { color: colors.textPrimary }, !editForm.position && { color: colors.textMuted }]}>
                            {editForm.position || "Pozitsiyani tanlang..."}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>

                      {/* League Interactive Modal Select Picker */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Liga (Select Modal)"}</Text>
                        <TouchableOpacity
                          style={[styles.selectBoxTrigger, isEditing && styles.selectBoxTriggerActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                          onPress={handleOpenLeaguePicker}
                          disabled={!isEditing}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectBoxValue, { color: colors.textPrimary }, !editForm.league && { color: colors.textMuted }]}>
                            {editForm.league || "Ligani tanlang..."}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>

                      {/* Team Interactive Modal Select Picker */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Jamoasi (Select Modal)"}</Text>
                        <TouchableOpacity
                          style={[styles.selectBoxTrigger, isEditing && styles.selectBoxTriggerActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                          onPress={handleOpenTeamPicker}
                          disabled={!isEditing}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectBoxValue, { color: colors.textPrimary }, !editForm.team_name && { color: colors.textMuted }]}>
                            {editForm.team_name || "Jamoani tanlang..."}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>

                      {/* Citizenship (Fuqaroligi / Millati) */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Millati / Fuqaroligi"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                          editable={isEditing}
                          value={editForm.citizenship}
                          onChangeText={(val) => setEditForm({ ...editForm, citizenship: val })}
                          placeholder="O'zbekiston"
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>

                      {/* Height and Weight */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Bo'yi (SM)"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                            editable={isEditing}
                            value={editForm.height}
                            onChangeText={(val) => setEditForm({ ...editForm, height: val })}
                            placeholder="178"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="numeric"
                          />
                        </View>

                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Vazni (KG)"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                            editable={isEditing}
                            value={editForm.weight}
                            onChangeText={(val) => setEditForm({ ...editForm, weight: val })}
                            placeholder="72"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="numeric"
                          />
                        </View>
                      </View>

                      {/* Instagram Username Field */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: '#E1306C' }]}>
                          {"Instagram Username"}
                        </Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                          editable={isEditing}
                          value={editForm.instagram_username}
                          onChangeText={(val) => setEditForm({ ...editForm, instagram_username: val })}
                          placeholder="@username"
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>
                    </>
                  ) : (
                    <>
                      {/* Team Name Input */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Jamoa Nomi"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                          editable={isEditing}
                          value={editForm.name}
                          onChangeText={(val) => setEditForm({ ...editForm, name: val })}
                          placeholder="Jamoa nomini kiriting..."
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>

                      {/* Team League Interactive Select Modal */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Ligasi (Select Modal)"}</Text>
                        <TouchableOpacity
                          style={[styles.selectBoxTrigger, isEditing && styles.selectBoxTriggerActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                          onPress={handleOpenLeaguePicker}
                          disabled={!isEditing}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectBoxValue, { color: colors.textPrimary }, !editForm.league && { color: colors.textMuted }]}>
                            {editForm.league || "Ligani tanlang..."}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>

                      {/* Captain / Contact Phone */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Bog'lanish Telefoni"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                          editable={isEditing}
                          value={editForm.phone}
                          onChangeText={(val) => setEditForm({ ...editForm, phone: val })}
                          placeholder="Telefon..."
                          placeholderTextColor={colors.textMuted}
                          keyboardType="phone-pad"
                        />
                      </View>

                      {/* City / Region Input */}
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{"Shahar / Hudud"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                          editable={isEditing}
                          value={editForm.city}
                          onChangeText={(val) => setEditForm({ ...editForm, city: val })}
                          placeholder="Shahar yoki hududni kiriting..."
                          placeholderTextColor={colors.textMuted}
                        />
                      </View>
                    </>
                  )}
                </View>
              </ScrollView>
            )}

            {/* Modal Bottom Action Bar (Pencil Switcher & Save Button) */}
            {!isReadOnlyUser && (
              <View style={[styles.modalFooterRow, { borderTopColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.pencilBtn, isEditing && styles.pencilBtnActive, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                  onPress={() => setIsEditing(!isEditing)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isEditing ? "create" : "create-outline"}
                    size={18}
                    color={colors.accentGreen}
                  />
                  <Text style={[styles.pencilBtnText, { color: colors.textPrimary }]}>
                    {isEditing ? "Tahrirlash rejimida" : "Tahrirlash"}
                  </Text>
                </TouchableOpacity>

                {isEditing && (
                  <TouchableOpacity
                    style={[styles.saveBtn, { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen }]}
                    onPress={handleSaveDetails}
                    disabled={saving}
                    activeOpacity={0.8}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                        <Text style={[styles.saveBtnText, { color: '#FFFFFF' }]}>{"Saqlash"}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* End of detail modal card */}
          </View>

          {/* Select Picker Overlay inside Detail Modal */}
          {renderSelectPicker()}
        </View>
      </Modal>

      {/* FULLSCREEN PINCH-TO-ZOOM IMAGE LIGHTBOX MODAL WITH BLUR BACKDROP (ROOT LEVEL) */}
      <Modal
        visible={!!fullImagePreview}
        transparent
        animationType="fade"
        onRequestClose={() => setFullImagePreview(null)}
      >
        <View style={styles.imagePreviewOverlay}>
          <TouchableOpacity
            style={styles.imagePreviewCloseBtn}
            onPress={() => setFullImagePreview(null)}
            activeOpacity={0.8}
          >
            <Ionicons name="close-circle" size={36} color="#FFFFFF" />
          </TouchableOpacity>

          {fullImagePreview && (
            <ScrollView
              contentContainerStyle={styles.zoomScrollViewContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
            >
              <Image
                source={{ uri: fullImagePreview }}
                style={styles.fullScreenImage}
                resizeMode="contain"
              />
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* DEDICATED FULLSCREEN ARCHIVE MODAL PAGE */}
      <Modal
        visible={showArchiveModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowArchiveModal(false)}
      >
        <View style={[styles.archiveModalContainer, { backgroundColor: colors.bgPrimary }]}>
          {/* Header */}
          <View style={styles.archiveHeader}>
            <TouchableOpacity
              style={[styles.archiveCloseBtn, { backgroundColor: colors.bgCardElevated }]}
              onPress={() => setShowArchiveModal(false)}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.archiveHeaderTitle, { color: colors.textPrimary }]}>{"📦 Arxivlangan Ma'lumotlar"}</Text>
              <Text style={[styles.archiveHeaderSub, { color: colors.textMuted }]}>{"Arxivdagi o'yinchilar va jamoalar ro'yxati"}</Text>
            </View>
          </View>

          {/* Sub-tabs: O'yinchilar vs Jamoalar */}
          <View style={[styles.archiveSegmentContainer, { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.archiveSegmentBtn, archiveTab === 'players' && { backgroundColor: colors.accentGreen }]}
              onPress={() => setArchiveTab('players')}
              activeOpacity={0.7}
            >
              <Ionicons name="person" size={15} color={archiveTab === 'players' ? '#FFFFFF' : colors.textMuted} />
              <Text style={[styles.archiveSegmentText, { color: colors.textSecondary }, archiveTab === 'players' && { color: '#FFFFFF', fontWeight: '900' }]}>
                {`O'yinchilar (${archivedPlayers.length})`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.archiveSegmentBtn, archiveTab === 'teams' && { backgroundColor: colors.accentGreen }]}
              onPress={() => setArchiveTab('teams')}
              activeOpacity={0.7}
            >
              <Ionicons name="shield" size={15} color={archiveTab === 'teams' ? '#FFFFFF' : colors.textMuted} />
              <Text style={[styles.archiveSegmentText, { color: colors.textSecondary }, archiveTab === 'teams' && { color: '#FFFFFF', fontWeight: '900' }]}>
                {`Jamoalar (${archivedTeams.length})`}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Archive Search and Filter Bar */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            <View style={[styles.archiveSearchContainer, { flex: 1, backgroundColor: colors.bgCard, borderColor: colors.border }]}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={[styles.archiveSearchInput, { color: colors.textPrimary }]}
                placeholder={archiveTab === 'players' ? "Arxivdagi o'yinchini qidirish..." : "Arxivdagi jamoani qidirish..."}
                placeholderTextColor={colors.textMuted}
                value={archiveSearchQuery}
                onChangeText={setArchiveSearchQuery}
              />
              {archiveSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setArchiveSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Filter Button (Players tab only) */}
            {archiveTab === 'players' && (
              <TouchableOpacity
                style={[styles.archiveFilterBtn, { backgroundColor: colors.bgCard, borderColor: colors.border }, (archiveLeagueFilter !== 'all') && { borderColor: colors.accentYellow, backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7' }]}
                onPress={() => {
                  setShowArchiveFilterModal(true);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="filter" size={18} color={(archiveLeagueFilter !== 'all') ? colors.accentYellow : colors.textMuted} />
                {(archiveLeagueFilter !== 'all') && (
                  <View style={[styles.archiveFilterBadge, { backgroundColor: colors.accentYellow }]} />
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Content List */}
          {loadingArchive ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.accentGreen} />
              <Text style={{ color: colors.textMuted, marginTop: 10, fontSize: 13 }}>
                {"Arxiv ma'lumotlari yuklanmoqda..."}
              </Text>
            </View>
          ) : archiveTab === 'players' ? (
            <FlatList
              data={archivedPlayers}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={{ paddingBottom: 40, gap: 10 }}
              renderItem={({ item }) => {
                const name = item.full_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.name;
                const avatar = item.avatar_url || item.photo_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop';
                const teamName = item.team?.name || item.team_name || "Jamoasiz";
                const league = item.team?.league || item.league || "";
                const archivedDate = item.created_at ? new Date(item.created_at).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

                return (
                  <View style={[styles.archiveCardRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                    <ExpoImage source={{ uri: avatar }} style={[styles.archiveAvatar, { backgroundColor: colors.bgCardElevated }]} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[styles.archiveItemTitle, { color: colors.textPrimary }]}>{name}</Text>
                      <Text style={[styles.archiveItemSub, { color: colors.textMuted }]}>
                        <Ionicons name="shield" size={12} color={colors.textMuted} />
                        {` ${teamName}`}
                        {league && ` • ${league}`}
                      </Text>
                      {archivedDate && (
                        <Text style={[styles.archiveItemSub, { fontSize: 11, color: colors.textMuted }]}>
                          <Ionicons name="time-outline" size={11} />
                          {` Arxivlangan: ${archivedDate}`}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[styles.restoreBtn, { backgroundColor: isDark ? 'rgba(74, 222, 128, 0.18)' : '#ECFDF5', borderColor: colors.accentGreen }]}
                      onPress={() => handleRestoreArchivedPlayer(item)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="refresh-outline" size={15} color={colors.accentGreen} />
                      <Text style={[styles.restoreBtnText, { color: colors.accentGreen }]}>{"QAYTARISH"}</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
              ListEmptyComponent={() => (
                <View style={styles.archiveEmptyBox}>
                  <Ionicons name="archive-outline" size={42} color={colors.textMuted} />
                  <Text style={[styles.archiveEmptyText, { color: colors.textMuted }]}>{"Arxivlangan o'yinchilar topilmadi"}</Text>
                </View>
              )}
            />
          ) : (
            <FlatList
              data={archivedTeams}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={{ paddingBottom: 40, gap: 10 }}
              renderItem={({ item }) => {
                const logo = item.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop';
                return (
                  <View style={[styles.archiveCardRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                    <ExpoImage source={{ uri: logo }} style={[styles.archiveAvatar, { backgroundColor: colors.bgCardElevated }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.archiveItemTitle, { color: colors.textPrimary }]}>{item.name}</Text>
                      <Text style={[styles.archiveItemSub, { color: colors.textMuted }]}>
                        {item.league ? `Liga: ${item.league}` : (item.city || "Shahari ko'rsatilmagan")}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.restoreBtn, { backgroundColor: isDark ? 'rgba(74, 222, 128, 0.18)' : '#ECFDF5', borderColor: colors.accentGreen }]}
                      onPress={() => handleRestoreArchivedTeam(item)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="refresh-outline" size={15} color={colors.accentGreen} />
                      <Text style={[styles.restoreBtnText, { color: colors.accentGreen }]}>{"QAYTARISH"}</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
              ListEmptyComponent={() => (
                <View style={styles.archiveEmptyBox}>
                  <Ionicons name="shield-outline" size={42} color={colors.textMuted} />
                  <Text style={[styles.archiveEmptyText, { color: colors.textMuted }]}>{"Arxivlangan jamoalar topilmadi"}</Text>
                </View>
              )}
            />
          )}

          {/* Archive Filter Modal - Inside Archive Modal */}
          <Modal visible={showArchiveFilterModal} transparent animationType="fade">
            <TouchableOpacity
              style={styles.archiveFilterOverlay}
              activeOpacity={1}
              onPress={() => setShowArchiveFilterModal(false)}
            >
              <TouchableOpacity
                style={[styles.archiveFilterCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                activeOpacity={1}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '900' }}>Filter</Text>
                  <TouchableOpacity onPress={() => setShowArchiveFilterModal(false)}>
                    <Ionicons name="close" size={24} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Liga tanlash */}
                <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>
                  LIGA
                </Text>
                <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                  <TouchableOpacity
                    style={[styles.archiveFilterOption, archiveLeagueFilter === 'all' && { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : colors.bgCardElevated }]}
                    onPress={() => {
                      setArchiveLeagueFilter('all');
                      setShowArchiveFilterModal(false);
                    }}
                  >
                    <Ionicons
                      name={archiveLeagueFilter === 'all' ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={archiveLeagueFilter === 'all' ? colors.accentGreen : colors.textMuted}
                    />
                    <Text style={[styles.archiveFilterOptionText, { color: colors.textSecondary }, archiveLeagueFilter === 'all' && { color: colors.accentGreen, fontWeight: '800' }]}>
                      Barcha ligalar
                    </Text>
                  </TouchableOpacity>

                  {leagues.map((lg: any) => (
                    <TouchableOpacity
                      key={lg.name}
                      style={[styles.archiveFilterOption, archiveLeagueFilter === lg.name && { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : colors.bgCardElevated }]}
                      onPress={() => {
                        setArchiveLeagueFilter(lg.name);
                        setShowArchiveFilterModal(false);
                      }}
                    >
                      <Ionicons
                        name={archiveLeagueFilter === lg.name ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={archiveLeagueFilter === lg.name ? colors.accentGreen : colors.textMuted}
                      />
                      <Text style={[styles.archiveFilterOptionText, { color: colors.textSecondary }, archiveLeagueFilter === lg.name && { color: colors.accentGreen, fontWeight: '800' }]}>
                        {lg.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        </View>
      </Modal>

      {/* Root Select Picker for Top Filters (Liga & Jamoa) */}
      {renderSelectPicker()}
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
  toastBanner: {
    position: 'absolute',
    top: 10,
    left: 20,
    right: 20,
    zIndex: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    elevation: 6,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  regSwitchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  regSwitchTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  regSwitchSub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '600',
  },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 48,
    marginBottom: 16,
    gap: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },

  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    borderRadius: 14,
    padding: 3,
    marginBottom: 10,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
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
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  segmentBtnText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12.5,
    fontWeight: '700',
  },
  activeSegmentBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
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

  // Swipeable Container & Actions
  swipeContainer: {
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  deleteActionBack: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 85,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 16,
    zIndex: 1,
  },
  deleteActionText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },

  // Image Preview Modal Styles (Pinch-to-zoom matching ApplicationsScreen)
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 999,
  },
  zoomScrollViewContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  fullScreenImage: {
    width: 340,
    height: 480,
    borderRadius: 16,
  },

  cardItem: {
    backgroundColor: 'transparent',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
    zIndex: 2,
  },
  cardInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },

  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1E293B',
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  subText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11.5,
    fontWeight: '600',
  },

  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    overflow: 'hidden',
  },
  loadMoreBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },

  // Skeleton Styles
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 16,
    padding: 12,
    gap: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
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

  // Delete Confirmation Modal Styles
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  confirmCard: {
    width: '100%',
    backgroundColor: '#151A24',
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#FF3B30',
    elevation: 10,
  },
  confirmHeaderIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  confirmTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  confirmMessage: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.4)',
  },
  countdownNumber: {
    color: '#FF4D4D',
    fontSize: 15,
    fontWeight: '900',
  },
  confirmActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    marginTop: 6,
  },
  cancelConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cancelConfirmText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  deleteConfirmBtn: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  deleteConfirmBtnActive: {
    backgroundColor: '#B3261E',
  },
  deleteConfirmText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  modalCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    maxHeight: '88%',
    overflow: 'hidden',
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
  detailAvatar: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  detailNameHeader: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  detailInputsBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 18,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  inputGroup: {
    gap: 4,
  },
  inputLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  inputBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  inputBoxActive: {
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },

  selectBoxTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  selectBoxTriggerActive: {
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  selectBoxValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // Modal Select Picker Styles
  pickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 999999,
  },
  pickerCard: {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    gap: 12,
    elevation: 10,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    paddingBottom: 10,
  },
  pickerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  pickerOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  pickerOptionActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  pickerOptionText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13.5,
    fontWeight: '700',
  },
  pickerOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },

  modalFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 12,
    marginTop: 6,
  },
  pencilBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  pencilBtnActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  pencilBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  pencilBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },

  // Archive Fullscreen Modal Page Styles
  archiveModalContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 20,
  },
  archiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  archiveCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  archiveHeaderSub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  archiveSegmentContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  archiveSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  activeArchiveSegmentBtn: {
    backgroundColor: '#F59E0B',
  },
  archiveSegmentText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  activeArchiveSegmentText: {
    color: '#000000',
    fontWeight: '900',
  },
  archiveSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 14,
    gap: 8,
  },
  archiveSearchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  archiveFilterBtn: {
    width: 50,
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveFilterBtnActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#F59E0B',
  },
  archiveFilterBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
  archiveFilterOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  archiveFilterCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  archiveFilterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
  },
  archiveFilterOptionActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  archiveFilterOptionText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
  archiveFilterOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  archiveCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 12,
  },
  archiveAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  archiveItemTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  archiveItemSub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(74, 222, 128, 0.18)',
    borderWidth: 1,
    borderColor: '#4ADE80',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  restoreBtnText: {
    color: '#4ADE80',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  archiveEmptyBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  archiveEmptyText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 13,
    fontWeight: '600',
  },
  topFilterBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  topFilterBtnActive: {
    borderColor: '#00FF87',
    backgroundColor: 'rgba(0, 255, 135, 0.08)',
  },
  topFilterBtnText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
