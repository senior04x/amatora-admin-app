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
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOrg } from '../context/OrgContext';
import { supabase, supabaseAdmin } from '../supabaseClient';

interface Props {
  onNavigate?: (screen: string) => void;
  initialSegmentTab?: 'players' | 'teams';
}

// Shimmer Skeleton Loader Component
const SkeletonCard = () => {
  return (
    <View style={styles.skeletonCard}>
      <BlurView intensity={80} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
      <View style={styles.skeletonAvatar} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={styles.skeletonTitleLine} />
        <View style={styles.skeletonSubLine} />
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
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (isReadOnlyUser) return false;
        // Only capture gesture if horizontal swipe is clearly dominant
        return Math.abs(gestureState.dx) > 12 && Math.abs(gestureState.dy) < 10;
      },
      onPanResponderGrant: () => {
        setIsSwiping(true);
        hapticTriggeredRef.current = false;
        onSwipeOpen();
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          const currentDx = gestureState.dx;
          panX.setValue(currentDx);

          // Telegram-style full swipe threshold (-150px)
          if (currentDx < -150 && !hapticTriggeredRef.current) {
            hapticTriggeredRef.current = true;
            triggerHaptic();
          }
        } else if (gestureState.dx > 0) {
          panX.setValue(Math.min(gestureState.dx, 0));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        setIsSwiping(false);

        // Full Swipe Trigger (-150px or more)
        if (gestureState.dx < -150) {
          Animated.timing(panX, {
            toValue: -380,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            onDelete(item);
            setTimeout(() => {
              Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
              onSwipeClose();
            }, 300);
          });
        } else if (gestureState.dx < -60) {
          // Snap Open Red Delete Action (-85px)
          Animated.spring(panX, {
            toValue: -85,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        } else {
          // Snap Closed (0px)
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

  const foundTeam = item.team_id && allTeamsList.length > 0
    ? allTeamsList.find((t: any) => String(t.id) === String(item.team_id))
    : null;

  let displayTeam = item.team_name;
  if (!displayTeam || !isNaN(Number(displayTeam))) {
    displayTeam = foundTeam ? foundTeam.name : (item.team_id ? `Jamoa #${item.team_id}` : 'Yakkaxon');
  }

  const displayLeague = item.league || item.league_name || item.resolvedLeague || foundTeam?.league;

  const deleteOpacity = panX.interpolate({
    inputRange: [-85, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.swipeContainer}>
      {/* Hidden Red Delete Action Button behind Card (Fades in ONLY when swiped) */}
      <Animated.View style={[styles.deleteActionBack, { opacity: deleteOpacity }]}>
        <TouchableOpacity
          style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          onPress={() => {
            resetSwipe();
            onDelete(item);
          }}
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
          { transform: [{ translateX: panX }] }
        ]}
        {...panResponder.panHandlers}
      >
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={styles.cardInnerRow}>
          {/* Left Photo Touch */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              if (onImagePress) onImagePress(avatar);
            }}
          >
            <ExpoImage cachePolicy='memory-disk' source={{ uri: avatar }} style={styles.avatarImage} />
          </TouchableOpacity>

          {/* Right Details Touch */}
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            onPress={() => {
              resetSwipe();
              onOpen(item, isPlayer);
            }}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.titleText} numberOfLines={1}>
                {name}
              </Text>

              {isPlayer ? (
                <Text style={[styles.subText, { color: 'rgba(255, 255, 255, 0.75)', fontWeight: '800' }]} numberOfLines={1}>
                  {`Jamoa: ${displayTeam}`}
                </Text>
              ) : null}

              {displayLeague ? (
                <Text style={styles.subText} numberOfLines={1}>
                  {`Liga: ${displayLeague}`}
                </Text>
              ) : null}
            </View>

            {isArchived ? (
              <TouchableOpacity
                style={{
                  backgroundColor: 'rgba(74, 222, 128, 0.18)',
                  borderColor: '#4ADE80',
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
                <Ionicons name="refresh-outline" size={14} color="#4ADE80" />
                <Text style={{ color: '#4ADE80', fontSize: 11, fontWeight: '800' }}>{"Qaytarish"}</Text>
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

export const PlayersScreen: React.FC<Props> = ({ onNavigate, initialSegmentTab }) => {
  const { orgId, userRole, collabLeagueNames, isRegistrationOpen, toggleRegistrationStatus, refreshOrg } = useOrg();
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
    }, 500);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Pagination Constants
  const PLAYER_PAGE_SIZE = 20;
  const TEAM_PAGE_SIZE = 10;

  const [playerPage, setPlayerPage] = useState(0);
  const [teamPage, setTeamPage] = useState(0);
  const [hasMorePlayers, setHasMorePlayers] = useState(true);
  const [hasMoreTeams, setHasMoreTeams] = useState(true);

  // Total Database Counters State
  const [totalPlayersCount, setTotalPlayersCount] = useState<number>(0);
  const [totalTeamsCount, setTotalTeamsCount] = useState<number>(0);

  // Data State
  const [players, setPlayers] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [allTeamsList, setAllTeamsList] = useState<any[]>([]);

  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Registration Switch Toggling State
  const [togglingReg, setTogglingReg] = useState(false);

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

  useEffect(() => {
    loadInitialData();
  }, [orgId, debouncedSearchQuery]);

  const loadInitialData = async () => {
    setLoading(true);
    await fetchRegistrationStatus();
    await fetchLeagues();
    await fetchAllTeamsList();
    await fetchTotalCounts();

    if (activeTab === 'players') {
      setPlayerPage(0);
      setHasMorePlayers(true);
      await fetchPlayers(0, true);
    } else {
      setTeamPage(0);
      setHasMoreTeams(true);
      await fetchTeams(0, true);
    }
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRegistrationStatus();
    await fetchLeagues();
    await fetchAllTeamsList();
    await fetchTotalCounts();

    if (activeTab === 'players') {
      setPlayerPage(0);
      setHasMorePlayers(true);
      await fetchPlayers(0, true);
    } else {
      setTeamPage(0);
      setHasMoreTeams(true);
      await fetchTeams(0, true);
    }
    setRefreshing(false);
  };

  // Fetch All Teams List for Select Dropdown & Name Resolution
  const fetchAllTeamsList = async () => {
    try {
      const dbClient = supabaseAdmin || supabase;
      let query = dbClient.from('teams').select('id, name, league').order('name');
      if (orgId) {
        query = query.eq('organization_id', orgId);
      }
      const { data } = await query;
      if (data) setAllTeamsList(data);
    } catch (e) {}
  };

  // Fetch Total Database Counters
  const fetchTotalCounts = async () => {
    try {
      const dbClient = supabaseAdmin || supabase;

      // Approved Players Total Count
      let pQuery = dbClient
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .or('status.eq.approved,status.eq.tasdiqlangan');

      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map(n => `"${n.replace(/"/g, '""')}"`).join(',');
          pQuery = pQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          pQuery = pQuery.eq('organization_id', orgId);
        }
      }
      const { count: pCount } = await pQuery;
      if (pCount !== null && pCount !== undefined) {
        setTotalPlayersCount(pCount);
      }

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

  const fetchRegistrationStatus = async () => {
    try {
      await refreshOrg();
    } catch (e) {}
  };

  const handleToggleRegistration = async () => {
    if (togglingReg) return;
    setTogglingReg(true);
    try {
      await toggleRegistrationStatus(!isRegistrationOpen);
    } catch (e) {
      console.error(e);
    } finally {
      setTogglingReg(false);
    }
  };

  // Fetch Approved Players Page with Deduplication & Archive Filter
  const fetchPlayers = async (pageIdx: number, isReset = false, isArchivedMode = showArchived) => {
    try {
      const from = pageIdx * PLAYER_PAGE_SIZE;
      const to = from + PLAYER_PAGE_SIZE - 1;
      const dbClient = supabaseAdmin || supabase;

      let query = dbClient
        .from('applications')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (!isArchivedMode) {
        query = query.or('status.eq.approved,status.eq.tasdiqlangan');
      }

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      if (debouncedSearchQuery) {
        const search = `%${debouncedSearchQuery}%`;
        query = query.or(
          `first_name.ilike.${search},last_name.ilike.${search},passport_series.ilike.${search},passport_number.ilike.${search},phone.ilike.${search}`
        );
      }

      const { data: appData } = await query;

      if (appData && appData.length > 0) {
        const filtered = appData.filter((app: any) => {
          if (app.comment && app.comment.includes('[PROFILE_UPDATE]')) return false;
          if (isArchivedMode) {
            return app.is_archived === true || app.status === 'archived';
          } else {
            return !app.is_archived && app.status !== 'archived';
          }
        });

        if (isReset) {
          setPlayers(filtered);
        } else {
          setPlayers((prev) => {
            const existingIds = new Set(prev.map((p) => String(p.id)));
            const uniqueNew = filtered.filter((p: any) => !existingIds.has(String(p.id)));
            return [...prev, ...uniqueNew];
          });
        }

        if (appData.length < PLAYER_PAGE_SIZE) {
          setHasMorePlayers(false);
        } else {
          setHasMorePlayers(true);
        }
      } else {
        if (isReset) setPlayers([]);
        setHasMorePlayers(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch Teams Page with Deduplication
  const fetchTeams = async (pageIdx: number, isReset = false) => {
    try {
      const from = pageIdx * TEAM_PAGE_SIZE;
      const to = from + TEAM_PAGE_SIZE - 1;
      const dbClient = supabaseAdmin || supabase;

      let query = dbClient
        .from('teams')
        .select('*')
        .or('status.eq.approved,status.eq.qisman,status.is.null')
        .order('name')
        .range(from, to);

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      if (debouncedSearchQuery) {
        query = query.ilike('name', `%${debouncedSearchQuery}%`);
      }

      const { data } = await query;

      if (data && data.length > 0) {
        if (isReset) {
          setTeams(data);
        } else {
          setTeams((prev) => {
            const existingIds = new Set(prev.map((t) => String(t.id)));
            const uniqueNew = data.filter((t: any) => !existingIds.has(String(t.id)));
            return [...prev, ...uniqueNew];
          });
        }

        if (data.length < TEAM_PAGE_SIZE) {
          setHasMoreTeams(false);
        } else {
          setHasMoreTeams(true);
        }
      } else {
        setHasMoreTeams(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLeagues = async () => {
    try {
      const { data } = await supabase.from('leagues').select('*').order('name');
      if (data) setLeagues(data);
    } catch (e) {}
  };

  // Manual Button Trigger to Load Next Batch
  const handleLoadMoreBtn = async () => {
    if (loadingMore || loading) return;

    if (activeTab === 'players' && hasMorePlayers) {
      setLoadingMore(true);
      const nextPage = playerPage + 1;
      setPlayerPage(nextPage);
      await fetchPlayers(nextPage, false);
      setLoadingMore(false);
    } else if (activeTab === 'teams' && hasMoreTeams) {
      setLoadingMore(true);
      const nextPage = teamPage + 1;
      setTeamPage(nextPage);
      await fetchTeams(nextPage, false);
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

  // Open Detail Modal and Resolve Team Name (No Team ID) & Separate Names
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

    // Resolve team name and league from allTeamsList if team_id exists
    let foundTeam = null;
    if (item.team_id && allTeamsList.length > 0) {
      foundTeam = allTeamsList.find((t: any) => String(t.id) === String(item.team_id));
    }

    let resolvedTeamName = item.team_name;
    if (!resolvedTeamName || !isNaN(Number(resolvedTeamName))) {
      resolvedTeamName = foundTeam ? foundTeam.name : (item.team_id ? `Jamoa #${item.team_id}` : 'Yakkaxon');
    }

    let resolvedLeague = item.league || item.league_name || item.resolvedLeague || foundTeam?.league || '';

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
      league: resolvedLeague,
      team_id: item.team_id || (foundTeam ? foundTeam.id : ''),
      team_name: resolvedTeamName,
      citizenship: item.citizenship || "O'zbekiston",
      height: item.height ? String(item.height) : '',
      weight: item.weight ? String(item.weight) : '',
      instagram_username: item.instagram_username || getInstagramUser(item),
      name: item.name || '',
      city: item.city || item.region || '',
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
    const filteredTeams = allTeamsList.filter(
      (t) => !editForm.league || !t.league || t.league.includes(editForm.league)
    );
    setSelectPickerConfig({
      title: 'Jamoani Tanlang',
      selectedValue: editForm.team_id || editForm.team_name,
      options: filteredTeams.map((t) => ({ label: t.name, value: t.id })),
      onSelect: (val: any, label: string) => {
        setEditForm((prev) => ({ ...prev, team_id: val, team_name: label }));
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

  // Trigger Delete Item Confirmation Dialog
  const handlePromptDelete = (item: any) => {
    setItemToDelete(item);
    setDeleteCountdown(null);
    setIsDeleting(false);
  };

  // Start 5-Second Countdown Delete Process
  const handleStartDeleteCountdown = () => {
    if (deleteCountdown !== null || isDeleting) return;

    setDeleteCountdown(5);

    let currentSec = 5;
    deleteTimerRef.current = setInterval(() => {
      currentSec -= 1;
      if (currentSec > 0) {
        setDeleteCountdown(currentSec);
      } else {
        clearInterval(deleteTimerRef.current);
        deleteTimerRef.current = null;
        setDeleteCountdown(0);
        executeActualDelete();
      }
    }, 1000);
  };

  // Cancel Delete Process
  const handleCancelDelete = () => {
    if (deleteTimerRef.current) {
      clearInterval(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setDeleteCountdown(null);
    setItemToDelete(null);
    setIsDeleting(false);
  };

  // Execute Soft Delete (Archiving) after 5-Second Countdown
  const executeActualDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);

    try {
      const dbClient = supabaseAdmin || supabase;
      const isPlayer = activeTab === 'players';

      if (isPlayer) {
        setPlayers((prev) => prev.filter((p) => p.id !== itemToDelete.id));

        try {
          await dbClient.from('applications').update({ is_archived: true, status: 'archived' }).eq('id', itemToDelete.id);
        } catch (e) {
          await dbClient.from('applications').update({ status: 'archived' }).eq('id', itemToDelete.id);
        }

        try {
          await dbClient.from('players').update({ is_archived: true }).eq('id', itemToDelete.id);
        } catch (e) {}
      } else {
        setTeams((prev) => prev.filter((t) => t.id !== itemToDelete.id));

        try {
          await dbClient.from('teams').update({ is_archived: true }).eq('id', itemToDelete.id);
        } catch (e) {}
      }

      setToastMsg("Muvaffaqiyatli arxivlandi! 📦");
      setTimeout(() => setToastMsg(null), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDeleting(false);
      setDeleteCountdown(null);
      setItemToDelete(null);
    }
  };

  // Restore Archived Player Back to Active
  const handleRestorePlayer = async (playerItem: any) => {
    try {
      const dbClient = supabaseAdmin || supabase;
      setPlayers((prev) => prev.filter((p) => p.id !== playerItem.id));

      try {
        await dbClient.from('applications').update({ is_archived: false, status: 'approved' }).eq('id', playerItem.id);
      } catch (e) {
        await dbClient.from('applications').update({ status: 'approved' }).eq('id', playerItem.id);
      }

      try {
        await dbClient.from('players').update({ is_archived: false }).eq('id', playerItem.id);
      } catch (e) {}

      setToastMsg("O'yinchi arxivdan qaytarildi! 🔄");
      setTimeout(() => setToastMsg(null), 3000);
      fetchPlayers(0, true, showArchived);
    } catch (e) {
      console.error(e);
    }
  };

  // Save Details to Supabase Database
  const handleSaveDetails = async () => {
    if (!selectedItem || saving) return;
    setSaving(true);

    try {
      const dbClient = supabaseAdmin || supabase;
      const isPlayer = selectedItem.isPlayer;

      if (isPlayer) {
        const combinedFullName = [editForm.first_name, editForm.last_name, editForm.father_name]
          .filter(Boolean)
          .join(' ');

        // Optimistically update players list state
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === selectedItem.id
              ? {
                  ...p,
                  first_name: editForm.first_name,
                  last_name: editForm.last_name,
                  father_name: editForm.father_name,
                  full_name: combinedFullName,
                  team_name: editForm.team_name,
                  team_id: editForm.team_id || null,
                  position: editForm.position,
                  phone: editForm.phone,
                  league: editForm.league,
                  birth_date: editForm.birth_date,
                  passport_series: editForm.passport_series,
                  passport_number: editForm.passport_number,
                  player_number: editForm.player_number ? Number(editForm.player_number) : null,
                  citizenship: editForm.citizenship,
                  height: editForm.height,
                  weight: editForm.weight,
                  instagram_username: editForm.instagram_username,
                }
              : p
          )
        );

        // Update applications table
        await dbClient
          .from('applications')
          .update({
            first_name: editForm.first_name,
            last_name: editForm.last_name,
            father_name: editForm.father_name,
            full_name: combinedFullName,
            team_name: editForm.team_name,
            team_id: editForm.team_id || null,
            position: editForm.position,
            phone: editForm.phone,
            league: editForm.league,
            birth_date: editForm.birth_date,
            passport_series: editForm.passport_series,
            passport_number: editForm.passport_number,
            player_number: editForm.player_number ? Number(editForm.player_number) : null,
          })
          .eq('id', selectedItem.id);

        // Update players table
        await dbClient
          .from('players')
          .update({
            first_name: editForm.first_name,
            last_name: editForm.last_name,
            full_name: combinedFullName,
            position: editForm.position,
            phone: editForm.phone,
          })
          .eq('id', selectedItem.id);
      } else {
        // Optimistically update teams list state
        setTeams((prev) =>
          prev.map((t) =>
            t.id === selectedItem.id
              ? {
                  ...t,
                  name: editForm.name,
                  league: editForm.league,
                  phone: editForm.phone,
                  city: editForm.city,
                }
              : t
          )
        );

        // Update teams table
        await dbClient
          .from('teams')
          .update({
            name: editForm.name,
            league: editForm.league,
            phone: editForm.phone,
            city: editForm.city,
          })
          .eq('id', selectedItem.id);
      }

      setToastMsg("Ma'lumotlar muvaffaqiyatli saqlandi! ✨");
      setIsEditing(false);
      setTimeout(() => setToastMsg(null), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Toast Notification Banner */}
      {toastMsg && (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      )}

      {/* Registration Open/Close Switch Banner */}
      <View style={styles.regSwitchBanner}>
        <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.regSwitchTitle}>
            {isRegistrationOpen ? "Qabul Ochiq" : "Qabul Yopilgan"}
          </Text>
          <Text style={styles.regSwitchSub}>
            {"Saytda yangi arizalar topshirish holati"}
          </Text>
        </View>
        <Switch
          value={isRegistrationOpen}
          onValueChange={handleToggleRegistration}
          trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: 'rgba(255, 255, 255, 0.35)' }}
          thumbColor={isRegistrationOpen ? '#FFFFFF' : '#94A3B8'}
          disabled={togglingReg}
        />
      </View>

      {/* Global Search Input & Archive Icon Button */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View style={[styles.searchContainer, { flex: 1, marginBottom: 0 }]}>
          <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <Ionicons name="search" size={20} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder={activeTab === 'players' ? "O'yinchini qidirish (ism, tel, pasport)..." : "Jamoani qidirish..."}
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          )}
        </View>

        {/* ARCHIVE ICON BUTTON */}
        <TouchableOpacity
          style={{
            height: 48,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: showArchived ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.08)',
            borderWidth: 1.2,
            borderColor: showArchived ? '#F59E0B' : 'rgba(255, 255, 255, 0.15)',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            overflow: 'hidden',
          }}
          onPress={() => {
            const nextVal = !showArchived;
            setShowArchived(nextVal);
            setPlayerPage(0);
            fetchPlayers(0, true, nextVal);
          }}
          activeOpacity={0.7}
        >
          <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <Ionicons
            name={showArchived ? "archive" : "archive-outline"}
            size={20}
            color={showArchived ? "#F59E0B" : "rgba(255,255,255,0.75)"}
          />
          {showArchived && (
            <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '900' }}>
              {"Arxiv"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Segment Sub-Tabs (O'yinchilar vs Jamoalar) */}
      <View style={styles.segmentContainer}>
        <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'players' && styles.activeSegmentBtn]}
          onPress={() => setActiveTab('players')}
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
          onPress={() => setActiveTab('teams')}
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
          scrollEnabled={!isSwiping}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          removeClippedSubviews={true}
          updateCellsBatchingPeriod={50}
          onEndReached={handleLoadMoreBtn}
          onEndReachedThreshold={0.5}
          onScrollBeginDrag={() => {
            if (openSwipeableId) {
              setOpenSwipeableId(null);
            }
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={40} color="rgba(255,255,255,0.2)" />
              <Text style={styles.emptyText}>
                {activeTab === 'players' ? "O'yinchilar yo'q" : "Jamoalar yo'q"}
              </Text>
            </View>
          }
          ListFooterComponent={
            ((activeTab === 'players' && hasMorePlayers) || (activeTab === 'teams' && hasMoreTeams)) ? (
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
                          ? "Yana 50 ta o'yinchini yuklash"
                          : "Yana 10 ta jamoani yuklash"}
                      </Text>
                    </>
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
              onDelete={handlePromptDelete}
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
          <View style={styles.confirmCard}>
            <View style={styles.confirmHeaderIcon}>
              <Ionicons name="warning" size={32} color="#FF4D4D" />
            </View>

            <Text style={styles.confirmTitle}>{"O'yinchini O'chirish"}</Text>
            <Text style={styles.confirmMessage}>
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
                style={styles.cancelConfirmBtn}
                onPress={handleCancelDelete}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelConfirmText}>{"Bekor qilish"}</Text>
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
      <Modal visible={!!selectedItem} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            {/* Modal Header */}
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons
                  name={selectedItem?.isPlayer ? "person" : "shield"}
                  size={20}
                  color="#FFFFFF"
                />
                <Text style={styles.modalTitle}>
                  {selectedItem?.isPlayer ? "O'yinchini Tahrirlash" : "Jamoani Tahrirlash"}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedItem(null)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
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
                    <Image
                      source={{
                        uri:
                          selectedItem.avatar_url ||
                          selectedItem.photo_url ||
                          selectedItem.logo_url ||
                          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop',
                      }}
                      style={styles.detailAvatar}
                    />
                  </TouchableOpacity>
                  <Text style={styles.detailNameHeader}>
                    {`${editForm.first_name} ${editForm.last_name}`.trim() || editForm.name || "Noma'lum"}
                  </Text>
                </View>

                {/* Input Fields Grid Box */}
                <View style={styles.detailInputsBox}>
                  {selectedItem.isPlayer ? (
                    <>
                      {/* Separated First Name & Last Name */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={styles.inputLabel}>{"Ismi"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                            editable={isEditing}
                            value={editForm.first_name}
                            onChangeText={(val) => setEditForm({ ...editForm, first_name: val })}
                            placeholder="Ismi..."
                            placeholderTextColor="rgba(255,255,255,0.3)"
                          />
                        </View>

                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={styles.inputLabel}>{"Familiyasi"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                            editable={isEditing}
                            value={editForm.last_name}
                            onChangeText={(val) => setEditForm({ ...editForm, last_name: val })}
                            placeholder="Familiyasi..."
                            placeholderTextColor="rgba(255,255,255,0.3)"
                          />
                        </View>
                      </View>

                      {/* Father Name (Otasining ismi) */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Otasining Ismi"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                          editable={isEditing}
                          value={editForm.father_name}
                          onChangeText={(val) => setEditForm({ ...editForm, father_name: val })}
                          placeholder="Otasining ismi..."
                          placeholderTextColor="rgba(255,255,255,0.3)"
                        />
                      </View>

                      {/* Phone Input */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Telefon"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                          editable={isEditing}
                          value={editForm.phone}
                          onChangeText={(val) => setEditForm({ ...editForm, phone: val })}
                          placeholder="Telefon raqami..."
                          placeholderTextColor="rgba(255,255,255,0.3)"
                          keyboardType="phone-pad"
                        />
                      </View>

                      {/* Passport Series & Passport Number */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={styles.inputLabel}>{"Pasport Seriya"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                            editable={isEditing}
                            value={editForm.passport_series}
                            onChangeText={(val) => setEditForm({ ...editForm, passport_series: val })}
                            placeholder="AA"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            maxLength={3}
                          />
                        </View>

                        <View style={[styles.inputGroup, { flex: 2 }]}>
                          <Text style={styles.inputLabel}>{"Pasport Raqam"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                            editable={isEditing}
                            value={editForm.passport_number}
                            onChangeText={(val) => setEditForm({ ...editForm, passport_number: val })}
                            placeholder="1234567"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            keyboardType="numeric"
                          />
                        </View>
                      </View>

                      {/* Birth Date & Player Jersey Number */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.inputGroup, { flex: 2 }]}>
                          <Text style={styles.inputLabel}>{"Tug'ilgan Sana"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                            editable={isEditing}
                            value={editForm.birth_date}
                            onChangeText={(val) => setEditForm({ ...editForm, birth_date: val })}
                            placeholder="masalan: 10.07.1995"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                          />
                        </View>

                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={styles.inputLabel}>{"Raqami (#)"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                            editable={isEditing}
                            value={editForm.player_number}
                            onChangeText={(val) => setEditForm({ ...editForm, player_number: val })}
                            placeholder="10"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            keyboardType="numeric"
                          />
                        </View>
                      </View>

                      {/* Position (Ampula) Interactive Select Picker */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Pozitsiya (Ampula)"}</Text>
                        <TouchableOpacity
                          style={[styles.selectBoxTrigger, isEditing && styles.selectBoxTriggerActive]}
                          onPress={handleOpenPositionPicker}
                          disabled={!isEditing}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectBoxValue, !editForm.position && { color: 'rgba(255,255,255,0.3)' }]}>
                            {editForm.position || "Pozitsiyani tanlang..."}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.6)" />
                        </TouchableOpacity>
                      </View>

                      {/* League Interactive Modal Select Picker */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Liga (Select Modal)"}</Text>
                        <TouchableOpacity
                          style={[styles.selectBoxTrigger, isEditing && styles.selectBoxTriggerActive]}
                          onPress={handleOpenLeaguePicker}
                          disabled={!isEditing}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectBoxValue, !editForm.league && { color: 'rgba(255,255,255,0.3)' }]}>
                            {editForm.league || "Ligani tanlang..."}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.6)" />
                        </TouchableOpacity>
                      </View>

                      {/* Team Interactive Modal Select Picker */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Jamoasi (Select Modal)"}</Text>
                        <TouchableOpacity
                          style={[styles.selectBoxTrigger, isEditing && styles.selectBoxTriggerActive]}
                          onPress={handleOpenTeamPicker}
                          disabled={!isEditing}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectBoxValue, !editForm.team_name && { color: 'rgba(255,255,255,0.3)' }]}>
                            {editForm.team_name || "Jamoani tanlang..."}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.6)" />
                        </TouchableOpacity>
                      </View>

                      {/* Citizenship, Height, Weight */}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={styles.inputLabel}>{"Bo'yi (SM)"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                            editable={isEditing}
                            value={editForm.height}
                            onChangeText={(val) => setEditForm({ ...editForm, height: val })}
                            placeholder="178"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            keyboardType="numeric"
                          />
                        </View>

                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={styles.inputLabel}>{"Vazni (KG)"}</Text>
                          <TextInput
                            style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                            editable={isEditing}
                            value={editForm.weight}
                            onChangeText={(val) => setEditForm({ ...editForm, weight: val })}
                            placeholder="72"
                            placeholderTextColor="rgba(255,255,255,0.3)"
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
                          style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                          editable={isEditing}
                          value={editForm.instagram_username}
                          onChangeText={(val) => setEditForm({ ...editForm, instagram_username: val })}
                          placeholder="@username"
                          placeholderTextColor="rgba(255,255,255,0.3)"
                        />
                      </View>
                    </>
                  ) : (
                    <>
                      {/* Team Name Input */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Jamoa Nomi"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                          editable={isEditing}
                          value={editForm.name}
                          onChangeText={(val) => setEditForm({ ...editForm, name: val })}
                          placeholder="Jamoa nomini kiriting..."
                          placeholderTextColor="rgba(255,255,255,0.3)"
                        />
                      </View>

                      {/* Team League Interactive Select Modal */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Ligasi (Select Modal)"}</Text>
                        <TouchableOpacity
                          style={[styles.selectBoxTrigger, isEditing && styles.selectBoxTriggerActive]}
                          onPress={handleOpenLeaguePicker}
                          disabled={!isEditing}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectBoxValue, !editForm.league && { color: 'rgba(255,255,255,0.3)' }]}>
                            {editForm.league || "Ligani tanlang..."}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.6)" />
                        </TouchableOpacity>
                      </View>

                      {/* Captain / Contact Phone */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Bog'lanish Telefoni"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                          editable={isEditing}
                          value={editForm.phone}
                          onChangeText={(val) => setEditForm({ ...editForm, phone: val })}
                          placeholder="Telefon..."
                          placeholderTextColor="rgba(255,255,255,0.3)"
                          keyboardType="phone-pad"
                        />
                      </View>

                      {/* City / Region Input */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{"Shahar / Hudud"}</Text>
                        <TextInput
                          style={[styles.inputBox, isEditing && styles.inputBoxActive]}
                          editable={isEditing}
                          value={editForm.city}
                          onChangeText={(val) => setEditForm({ ...editForm, city: val })}
                          placeholder="Shahar yoki hududni kiriting..."
                          placeholderTextColor="rgba(255,255,255,0.3)"
                        />
                      </View>
                    </>
                  )}
                </View>
              </ScrollView>
            )}

            {/* Modal Bottom Action Bar (Pencil Switcher & Save Button) */}
            {!isReadOnlyUser && (
              <View style={styles.modalFooterRow}>
                <TouchableOpacity
                  style={[styles.pencilBtn, isEditing && styles.pencilBtnActive]}
                  onPress={() => setIsEditing(!isEditing)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isEditing ? "create" : "create-outline"}
                    size={18}
                    color="#FFFFFF"
                  />
                  <Text style={[styles.pencilBtnText, isEditing && styles.pencilBtnTextActive]}>
                    {isEditing ? "Tahrirlash rejimida" : "Tahrirlash"}
                  </Text>
                </TouchableOpacity>

                {isEditing && (
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={handleSaveDetails}
                    disabled={saving}
                    activeOpacity={0.8}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#000000" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={18} color="#000000" />
                        <Text style={styles.saveBtnText}>{"Saqlash"}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* INTERACTIVE OPEN-CLOSE MODAL SELECT PICKER (NESTED INSIDE MAIN MODAL FOR CLICKABILITY) */}
            <Modal visible={!!selectPickerConfig} transparent animationType="fade">
              <TouchableOpacity
                style={styles.pickerOverlay}
                activeOpacity={1}
                onPress={() => setSelectPickerConfig(null)}
              >
                <View style={styles.pickerCard}>
                  <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
                  <View style={styles.pickerHeader}>
                    <Text style={styles.pickerTitle}>{selectPickerConfig?.title || "Tanlang"}</Text>
                    <TouchableOpacity onPress={() => setSelectPickerConfig(null)}>
                      <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                    {selectPickerConfig?.options.map((opt, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={[
                          styles.pickerOptionRow,
                          selectPickerConfig.selectedValue === opt.value && styles.pickerOptionActive,
                        ]}
                        onPress={() => {
                          selectPickerConfig.onSelect(opt.value, opt.label);
                          setSelectPickerConfig(null);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.pickerOptionText,
                            selectPickerConfig.selectedValue === opt.value && styles.pickerOptionTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                        {selectPickerConfig.selectedValue === opt.value && (
                          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>
          </View>
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
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
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
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
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
});
