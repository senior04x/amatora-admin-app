import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  RefreshControl,
  Animated,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { BlurView } from '../components/SafeBlurView';
import { SwipeRow } from '../components/SwipeRow';
import { MatchControlScreen } from './MatchControlScreen';
import { useFinishedMatchesData, useTeamsData, useLeaguesData } from '../api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useScrollDockHandler } from '../utils/scrollDock';

interface Match {
  id: string | number;
  organization_id?: number;
  league?: string;
  round?: string | number;
  home_team_id?: string | number;
  away_team_id?: string | number;
  home_team?: { id: any; name: string; logo_url?: string };
  away_team?: { id: any; name: string; logo_url?: string };
  home_score?: number;
  away_score?: number;
  home_penalty_score?: number;
  away_penalty_score?: number;
  match_date?: string;
  match_time?: string;
  date?: string;
  time?: string;
  location?: string;
  stadium_name?: string;
  importance?: 'oddiy' | 'ortacha' | 'markaziy';
  youtube_link?: string;
  is_postponed?: boolean;
  status?: string;
}

const MatchCardSkeleton: React.FC = () => {
  const { colors, isDark } = useTheme();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);

  const blockBg = Platform.OS === 'android' ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'rgba(255,255,255,0.1)';

  return (
    <Animated.View style={[
      styles.skeletonCard,
      Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 },
      { opacity }
    ]}>
      <View style={styles.skeletonTopRow}>
        <View style={{ width: 90, height: 14, backgroundColor: blockBg, borderRadius: 6 }} />
        <View style={{ width: 70, height: 14, backgroundColor: blockBg, borderRadius: 6 }} />
      </View>
      <View style={styles.skeletonTeamsRow}>
        <View style={styles.skeletonTeamCol}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: blockBg }} />
          <View style={{ width: 70, height: 12, backgroundColor: blockBg, borderRadius: 6 }} />
        </View>
        <View style={{ width: 44, height: 28, borderRadius: 10, backgroundColor: blockBg }} />
        <View style={styles.skeletonTeamCol}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: blockBg }} />
          <View style={{ width: 70, height: 12, backgroundColor: blockBg, borderRadius: 6 }} />
        </View>
      </View>
      <View style={{ height: 38, backgroundColor: blockBg, borderRadius: 12, marginTop: 8 }} />
    </Animated.View>
  );
};

export const FinishedMatchesScreen: React.FC<{
  onGoBack?: () => void;
  onNavigateToCreate?: () => void;
}> = ({ onGoBack, onNavigateToCreate }) => {
  const { orgId, collabLeagueNames } = useOrg();
  const { colors, isDark } = useTheme();
  const queryClient = useQueryClient();
  const scrollDockProps = useScrollDockHandler();

  // Filters: Liga, Tur
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedRound, setSelectedRound] = useState<string>('all');
  const [activeDropdown, setActiveDropdown] = useState<'none' | 'league' | 'round'>('none');
  const [page, setPage] = useState<number>(0);
  const [accumulatedMatches, setAccumulatedMatches] = useState<any[]>([]);

  // React Query Hooks (15 matches per page)
  const {
    data: finishedData,
    isLoading: loading,
    refetch: refetchFinishedMatches,
  } = useFinishedMatchesData(orgId, selectedLeague, page, 15, collabLeagueNames);

  const { data: leagues = [] } = useLeaguesData(orgId);
  const { data: teams = [] } = useTeamsData(orgId);

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setPage(0);
    setAccumulatedMatches([]);
  }, [selectedLeague, orgId]);

  useEffect(() => {
    if (finishedData?.matches) {
      if (page === 0) {
        setAccumulatedMatches(finishedData.matches);
      } else {
        setAccumulatedMatches((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newUnique = finishedData.matches.filter((m: any) => !existingIds.has(m.id));
          return [...prev, ...newUnique];
        });
      }
    }
  }, [finishedData?.matches, page]);

  const handleLoadMore = () => {
    if (finishedData?.hasMore && !loading) {
      setPage((prev) => prev + 1);
    }
  };

  const matches = accumulatedMatches;

  // Active Control Match Object State (0ms instant transition)
  const [activeControlMatch, setActiveControlMatch] = useState<Match | null>(null);
  const [activeSwipedId, setActiveSwipedId] = useState<string | number | null>(null);

  // Edit Modal State
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [editLeague, setEditLeague] = useState('');
  const [editHomeTeamId, setEditHomeTeamId] = useState<any>('');
  const [editAwayTeamId, setEditAwayTeamId] = useState<any>('');
  const [editRound, setEditRound] = useState('');
  const [editMatchDate, setEditMatchDate] = useState('');
  const [editMatchTime, setEditMatchTime] = useState('');
  const [editLocation, setEditLocation] = useState('1-maydon');
  const [editStadiumName, setEditStadiumName] = useState('');
  const [editImportance, setEditImportance] = useState<'oddiy' | 'ortacha' | 'markaziy'>('oddiy');
  const [editYtLink, setEditYtLink] = useState('');
  const [editEnableYtLink, setEditEnableYtLink] = useState(false);
  const [editIsPostponed, setEditIsPostponed] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // DateTimePicker Modal States
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const [tempTime, setTempTime] = useState(new Date());

  // Native Date/Time picker openers (Android native dialog / iOS glass modal)
  const handleOpenEditDatePicker = () => {
    if (Platform.OS === 'android') {
      const validDate = tempDate instanceof Date && !isNaN(tempDate.getTime()) ? tempDate : new Date();
      DateTimePickerAndroid.open({
        value: validDate,
        mode: 'date',
        onChange: (event, selectedDate) => {
          if (event.type === 'set' && selectedDate) {
            setTempDate(selectedDate);
            const year = selectedDate.getFullYear();
            const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
            const day = String(selectedDate.getDate()).padStart(2, '0');
            setEditMatchDate(`${year}-${month}-${day}`);
          }
        },
      });
    } else {
      setShowDatePicker(true);
    }
  };

  const handleOpenEditTimePicker = () => {
    if (Platform.OS === 'android') {
      const validTime = tempTime instanceof Date && !isNaN(tempTime.getTime()) ? tempTime : new Date();
      DateTimePickerAndroid.open({
        value: validTime,
        mode: 'time',
        is24Hour: true,
        onChange: (event, selectedTime) => {
          if (event.type === 'set' && selectedTime) {
            setTempTime(selectedTime);
            const hours = String(selectedTime.getHours()).padStart(2, '0');
            const minutes = String(selectedTime.getMinutes()).padStart(2, '0');
            setEditMatchTime(`${hours}:${minutes}`);
          }
        },
      });
    } else {
      setShowTimePicker(true);
    }
  };

  // Delete Modal State
  const [matchToDelete, setMatchToDelete] = useState<Match | null>(null);
  const [deletingMatch, setDeletingMatch] = useState(false);

  useEffect(() => {
    refetchFinishedMatches();

    const matchesChannel = supabase
      .channel('finished_matches_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        queryClient.invalidateQueries({ queryKey: ['finishedMatches'] });
        refetchFinishedMatches();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(matchesChannel);
    };
  }, [orgId, queryClient, refetchFinishedMatches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchFinishedMatches();
    setRefreshing(false);
  }, [refetchFinishedMatches]);

  const handleOpenEditModal = (match: Match) => {
    setEditingMatch(match);
    setEditLeague(match.league || (leagues[0]?.name || ''));
    setEditHomeTeamId(match.home_team_id || '');
    setEditAwayTeamId(match.away_team_id || '');
    setEditRound(match.round ? String(match.round) : '');
    setEditMatchDate(match.match_date || match.date || '');
    setEditMatchTime(match.match_time || match.time || '');
    setEditLocation(match.location || '1-maydon');
    setEditStadiumName(match.stadium_name || '');
    setEditImportance(match.importance || 'oddiy');
    setEditYtLink(match.youtube_link || '');
    setEditEnableYtLink(!!match.youtube_link);
    setEditIsPostponed(!!match.is_postponed);

    try {
      if (match.match_date || match.date) {
        setTempDate(new Date(match.match_date || match.date || ''));
      }
    } catch (e) {}
  };

  const handleSaveEditMatch = async () => {
    if (!editingMatch) return;
    if (!editLeague || !editHomeTeamId || !editAwayTeamId || !editMatchDate || !editMatchTime) {
      Alert.alert("Majburiy Maydonlar", "Iltimos, barcha majburiy maydonlarni to'ldiring.");
      return;
    }

    if (editHomeTeamId === editAwayTeamId) {
      Alert.alert("Xatolik", "Mezbon va mehmon jamoalar har xil bo'lishi kerak.");
      return;
    }

    setSavingEdit(true);

    const baseUpdatePayload: any = {
      league: editLeague,
      home_team_id: editHomeTeamId,
      away_team_id: editAwayTeamId,
      round: parseInt(editRound, 10) || 1,
      match_date: editMatchDate,
      match_time: editMatchTime,
      location: editLocation,
      youtube_link: editEnableYtLink ? (editYtLink.trim() || null) : null,
      stadium_name: editStadiumName,
      importance: editImportance,
      is_postponed: editIsPostponed,
    };

    try {
      const { error } = await supabase.from('matches').update(baseUpdatePayload).eq('id', editingMatch.id);
      if (error) throw error;
      setEditingMatch(null);
      queryClient.invalidateQueries({ queryKey: ['finishedMatches', Number(orgId) || 1] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
    } catch (e: any) {
      Alert.alert("Xatolik", e?.message || "O'yinni saqlashda xatolik yuz berdi");
      queryClient.invalidateQueries({ queryKey: ['finishedMatches', Number(orgId) || 1] });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteMatch = (match: Match) => {
    setMatchToDelete(match);
  };

  const executeDeleteMatch = async () => {
    if (!matchToDelete) return;
    const targetId = matchToDelete.id;
    const previousMatches = [...accumulatedMatches];

    // 0ms Optimistic UI update - card disappears instantly from screen
    setAccumulatedMatches((prev) => prev.filter((m) => String(m.id) !== String(targetId)));
    setMatchToDelete(null);
    setDeletingMatch(true);

    try {
      const dbClient = supabase;
      const orgFolder = String((matchToDelete as any).organization_id || orgId || '1');
      const matchFolder = `${orgFolder}/${targetId}`;

      // Clean up Replay videos from Supabase Storage in background
      try {
        let filesToRemove: string[] = [];
        const { data: folderFiles } = await dbClient.storage.from('replays').list(matchFolder);
        if (folderFiles && folderFiles.length > 0) {
          filesToRemove = folderFiles
            .filter((f) => f.name && !f.name.startsWith('.'))
            .map((f) => `${matchFolder}/${f.name}`);
        }

        const { data: eventsWithReplay } = await dbClient
          .from('match_events')
          .select('replay_video_url')
          .eq('match_id', targetId);

        if (eventsWithReplay && eventsWithReplay.length > 0) {
          eventsWithReplay.forEach((e: any) => {
            if (e.replay_video_url && e.replay_video_url.includes('/replays/')) {
              const path = e.replay_video_url.split('/replays/')[1];
              if (path && !filesToRemove.includes(path)) {
                filesToRemove.push(path);
              }
            }
          });
        }

        if (filesToRemove.length > 0) {
          await dbClient.storage.from('replays').remove(filesToRemove);
        }
      } catch (storageErr) {
        console.warn('Storage cleanup note:', storageErr);
      }

      await Promise.allSettled([
        dbClient.from('sponsors').delete().eq('name', `MATCH_TIMER_${targetId}`),
        dbClient.from('match_events').delete().eq('match_id', targetId),
        dbClient.from('match_stats').delete().eq('match_id', targetId),
      ]);

      let { error } = await dbClient.from('matches').delete().eq('id', targetId);
      if (error && !isNaN(Number(targetId))) {
        const { error: errNum } = await dbClient.from('matches').delete().eq('id', Number(targetId));
        if (errNum) throw errNum;
      } else if (error) {
        throw error;
      }

      // Invalidate all query caches and refetch immediately
      queryClient.invalidateQueries({ queryKey: ['finishedMatches'] });
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.refetchQueries({ queryKey: ['finishedMatches'] });
      refetchFinishedMatches();
    } catch (e: any) {
      // Rollback on actual error
      setAccumulatedMatches(previousMatches);
      Alert.alert("Xatolik", e?.message || "O'yinni o'chirishda xatolik yuz berdi");
      queryClient.invalidateQueries({ queryKey: ['finishedMatches'] });
    } finally {
      setDeletingMatch(false);
    }
  };

  if (activeControlMatch) {
    return (
      <MatchControlScreen
        matchId={activeControlMatch.id}
        initialMatch={activeControlMatch}
        onBack={() => {
          setActiveControlMatch(null);
          queryClient.invalidateQueries({ queryKey: ['finishedMatches', Number(orgId) || 1] });
        }}
      />
    );
  }

  const filteredMatches = matches.filter((m) => {
    if (selectedLeague !== 'all' && m.league !== selectedLeague) return false;
    if (selectedRound !== 'all' && String(m.round) !== selectedRound) return false;
    return true;
  });

  const editAvailableTeams = teams.filter(
    (t) => !t.league || t.league.split(',').map((s: string) => s.trim()).includes(editLeague)
  );

  const availableRounds = Array.from(
    new Set(matches.map((m) => String(m.round || '')).filter(Boolean))
  ).sort();

  return (
    <View style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {onGoBack && (
            <TouchableOpacity style={[styles.backBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]} onPress={onGoBack} activeOpacity={0.7}>
              {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
              <Ionicons name="arrow-back" size={22} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
            </TouchableOpacity>
          )}
          <View>
            <Text style={[styles.headerTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Yakunlangan O'yinlar"}</Text>
            <Text style={[styles.headerSub, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Tugagan uchrashuvlar natijalari"}</Text>
          </View>
        </View>

        <View style={[styles.finishedCountBadge, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5', borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : '#A7F3D0' }]}>
          <Ionicons name="checkmark-done" size={14} color="#10B981" />
          <Text style={styles.finishedCountText}>{`${filteredMatches.length} ta`}</Text>
        </View>
      </View>

      {/* 2 Select Filters: Liga, Tur */}
      <View style={styles.filterBarContainer}>
        {/* 1. Liga Select Dropdown */}
        <TouchableOpacity
          style={[
            styles.filterSelectBtn,
            Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border },
            activeDropdown === 'league' && styles.filterSelectBtnActive,
            Platform.OS === 'android' && activeDropdown === 'league' && { borderColor: colors.accentGreen, backgroundColor: isDark ? 'rgba(0,255,102,0.12)' : '#ECFDF5' }
          ]}
          onPress={() => setActiveDropdown(activeDropdown === 'league' ? 'none' : 'league')}
        >
          {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
          <Ionicons name="trophy-outline" size={14} color="#F59E0B" />
          <Text style={[styles.filterSelectText, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
            {selectedLeague === 'all' ? 'Barcha Ligalar' : selectedLeague}
          </Text>
          <Ionicons name="chevron-down" size={14} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.5)"} />
        </TouchableOpacity>

        {/* 2. Tur Select Dropdown */}
        <TouchableOpacity
          style={[
            styles.filterSelectBtn,
            Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border },
            activeDropdown === 'round' && styles.filterSelectBtnActive,
            Platform.OS === 'android' && activeDropdown === 'round' && { borderColor: colors.accentGreen, backgroundColor: isDark ? 'rgba(0,255,102,0.12)' : '#ECFDF5' }
          ]}
          onPress={() => setActiveDropdown(activeDropdown === 'round' ? 'none' : 'round')}
        >
          {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
          <Ionicons name="layers-outline" size={14} color="#3B82F6" />
          <Text style={[styles.filterSelectText, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
            {selectedRound === 'all' ? 'Barcha Turlar' : selectedRound}
          </Text>
          <Ionicons name="chevron-down" size={14} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.5)"} />
        </TouchableOpacity>
      </View>

      {/* Dropdown Options */}
      {activeDropdown === 'league' && (
        <View style={[
          styles.dropdownMenuCard,
          Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }
        ]}>
          {Platform.OS === 'ios' && <BlurView intensity={95} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
          <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={[styles.dropdownMenuItem, Platform.OS === 'android' && { borderBottomColor: colors.border }]}
              onPress={() => {
                setSelectedLeague('all');
                setActiveDropdown('none');
              }}
            >
              <Text style={[
                styles.dropdownMenuText,
                Platform.OS === 'android' && { color: colors.textSecondary },
                selectedLeague === 'all' && { color: colors.accentGreen, fontWeight: '900' }
              ]}>
                Barcha Ligalar
              </Text>
            </TouchableOpacity>
            {leagues.map((lg) => (
              <TouchableOpacity
                key={lg.id}
                style={[styles.dropdownMenuItem, Platform.OS === 'android' && { borderBottomColor: colors.border }]}
                onPress={() => {
                  setSelectedLeague(lg.name);
                  setActiveDropdown('none');
                }}
              >
                <Text style={[
                  styles.dropdownMenuText,
                  Platform.OS === 'android' && { color: colors.textSecondary },
                  selectedLeague === lg.name && { color: colors.accentGreen, fontWeight: '900' }
                ]}>
                  {lg.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {activeDropdown === 'round' && (
        <View style={[
          styles.dropdownMenuCard,
          Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }
        ]}>
          {Platform.OS === 'ios' && <BlurView intensity={95} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
          <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={[styles.dropdownMenuItem, Platform.OS === 'android' && { borderBottomColor: colors.border }]}
              onPress={() => {
                setSelectedRound('all');
                setActiveDropdown('none');
              }}
            >
              <Text style={[
                styles.dropdownMenuText,
                Platform.OS === 'android' && { color: colors.textSecondary },
                selectedRound === 'all' && { color: colors.accentGreen, fontWeight: '900' }
              ]}>
                Barcha Turlar
              </Text>
            </TouchableOpacity>
            {availableRounds.length > 0 ? (
              availableRounds.map((rnd) => (
                <TouchableOpacity
                  key={rnd}
                  style={[styles.dropdownMenuItem, Platform.OS === 'android' && { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setSelectedRound(rnd);
                    setActiveDropdown('none');
                  }}
                >
                  <Text style={[
                    styles.dropdownMenuText,
                    Platform.OS === 'android' && { color: colors.textSecondary },
                    selectedRound === rnd && { color: colors.accentGreen, fontWeight: '900' }
                  ]}>
                    {rnd}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              ['1-tur', '2-tur', '3-tur', '4-tur', 'Chorak final', 'Yarim final', 'Final'].map((rnd) => (
                <TouchableOpacity
                  key={rnd}
                  style={[styles.dropdownMenuItem, Platform.OS === 'android' && { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setSelectedRound(rnd);
                    setActiveDropdown('none');
                  }}
                >
                  <Text style={[
                    styles.dropdownMenuText,
                    Platform.OS === 'android' && { color: colors.textSecondary },
                    selectedRound === rnd && { color: colors.accentGreen, fontWeight: '900' }
                  ]}>
                    {rnd}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      )}

      {/* Matches List */}
      {loading && page === 0 ? (
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
          <MatchCardSkeleton />
          <MatchCardSkeleton />
          <MatchCardSkeleton />
        </ScrollView>
      ) : filteredMatches.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-done-circle-outline" size={64} color={Platform.OS === 'android' ? colors.border : "rgba(255,255,255,0.15)"} />
          <Text style={[styles.emptyTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Yakunlangan o'yinlar topilmadi"}</Text>
          <Text style={[styles.emptySub, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Hozircha yakunlangan uchrashuvlar mavjud emas"}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredMatches}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          {...scrollDockProps}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentGreen} />}
          renderItem={({ item }) => {
            const homeName = item.home_team?.name || 'Mezbon';
            const awayName = item.away_team?.name || 'Mehmon';
            const mDate = item.match_date || item.date;
            const mTime = item.match_time || item.time;
            const isSwiped = activeSwipedId === item.id;

            return (
              <SwipeRow
                isOpen={isSwiped}
                onOpen={() => setActiveSwipedId(item.id)}
                onClose={() => {
                  if (activeSwipedId === item.id) setActiveSwipedId(null);
                }}
                actionWidth={80}
                actions={
                  <View style={styles.swipeButtonsStackedContainer}>
                    <TouchableOpacity
                      style={styles.swipeEditBtnStacked}
                      onPress={() => {
                        setActiveSwipedId(null);
                        handleOpenEditModal(item);
                      }}
                    >
                      <Ionicons name="create-outline" size={18} color="#FFFFFF" />
                      <Text style={styles.swipeBtnTextStacked}>{"Tahrir"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.swipeDeleteBtnStacked}
                      onPress={() => {
                        setActiveSwipedId(null);
                        handleDeleteMatch(item);
                      }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
                      <Text style={styles.swipeBtnTextStacked}>{"O'chirish"}</Text>
                    </TouchableOpacity>
                  </View>
                }
              >
                <View style={[
                  styles.matchCard,
                  Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }
                ]}>
                  {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
                  {/* Card Top Row */}
                  <View style={styles.cardTopRow}>
                    <View style={[styles.leagueTag, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6' }]}>
                      <Text style={[styles.leagueTagText, { color: colors.accentGreen }]}>{item.league || 'LIGA'}</Text>
                      {item.round && <Text style={[styles.roundTagText, Platform.OS === 'android' && { color: colors.textMuted }]}>{` • ${item.round}`}</Text>}
                    </View>

                    <View style={[styles.finishedBadge, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.12)' : '#ECFDF5', borderColor: isDark ? 'rgba(16, 185, 129, 0.25)' : '#A7F3D0' }]}>
                      <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                      <Text style={styles.finishedBadgeText}>{"YAKUNLANGAN"}</Text>
                    </View>
                  </View>

                  {/* Teams VS Section */}
                  <View style={styles.teamsSection}>
                    {/* Home Team */}
                    <View style={styles.teamCol}>
                      <Image
                        source={{
                          uri:
                            item.home_team?.logo_url ||
                            'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop',
                        }}
                        style={[styles.teamLogo, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}
                      />
                      <Text style={[styles.teamName, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={2}>
                        {homeName}
                      </Text>
                    </View>

                    {/* Final Score */}
                    <View style={styles.scoreContainer}>
                      <View style={[styles.scoreBadge, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                        {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
                        <Text style={[styles.scoreText, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                          {item.home_score ?? 0} : {item.away_score ?? 0}
                        </Text>
                      </View>
                      {item.home_penalty_score !== undefined && item.away_penalty_score !== undefined && (item.home_penalty_score > 0 || item.away_penalty_score > 0) && (
                        <Text style={styles.penaltyText}>
                          {`Pen: (${item.home_penalty_score} - ${item.away_penalty_score})`}
                        </Text>
                      )}
                      <Text style={[styles.matchDateSubText, Platform.OS === 'android' && { color: colors.textMuted }]}>{mDate || ''}</Text>
                    </View>

                    {/* Away Team */}
                    <View style={styles.teamCol}>
                      <Image
                        source={{
                          uri:
                            item.away_team?.logo_url ||
                            'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop',
                        }}
                        style={[styles.teamLogo, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}
                      />
                      <Text style={[styles.teamName, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={2}>
                        {awayName}
                      </Text>
                    </View>
                  </View>

                  {/* Bottom Action / Details Bar */}
                  <View style={[styles.cardBottomBar, Platform.OS === 'android' && { borderTopColor: colors.border }]}>
                    <View style={styles.locationInfo}>
                      <Ionicons name="location-outline" size={13} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.6)"} />
                      <Text style={[styles.locationText, Platform.OS === 'android' && { color: colors.textMuted }]}>
                        {item.location === '2-maydon' ? '2-Maydon' : '1-Maydon'}
                        {item.stadium_name ? ` • ${item.stadium_name}` : ''}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.detailsBtn, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(0,255,102,0.1)' : '#ECFDF5', borderColor: isDark ? 'rgba(0,255,102,0.25)' : '#A7F3D0' }]}
                      onPress={() => setActiveControlMatch(item)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="stats-chart-outline" size={14} color={colors.accentGreen} />
                      <Text style={[styles.detailsBtnText, { color: colors.accentGreen }]}>{"Bayonnoma"}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </SwipeRow>
            );
          }}
        />
      )}

      {/* Edit Match Modal */}
      <Modal visible={!!editingMatch} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '90%' }, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"O'yinni Tahrirlash"}</Text>
              <TouchableOpacity onPress={() => setEditingMatch(null)}>
                <Ionicons name="close" size={22} color={Platform.OS === 'android' ? colors.textPrimary : "rgba(255,255,255,0.6)"} />
              </TouchableOpacity>
            </View>

            {editingMatch && (
              <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
                <Text style={[styles.inputLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Liga:"}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {leagues.map((lg) => (
                    <TouchableOpacity
                      key={lg.id}
                      style={[
                        styles.chipItem,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                        editLeague === lg.name && styles.chipItemActive,
                        Platform.OS === 'android' && editLeague === lg.name && { borderColor: colors.accentGreen, backgroundColor: isDark ? 'rgba(0,255,102,0.12)' : '#ECFDF5' },
                      ]}
                      onPress={() => setEditLeague(lg.name)}
                    >
                      <Text style={[
                        styles.chipText,
                        Platform.OS === 'android' && { color: colors.textSecondary },
                        editLeague === lg.name && styles.chipTextActive,
                        Platform.OS === 'android' && editLeague === lg.name && { color: colors.accentGreen },
                      ]}>
                        {lg.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[styles.inputLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Mezbon Jamoa:"}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {editAvailableTeams.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[
                        styles.chipItem,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                        editHomeTeamId === t.id && styles.chipItemActive,
                        Platform.OS === 'android' && editHomeTeamId === t.id && { borderColor: colors.accentGreen, backgroundColor: isDark ? 'rgba(0,255,102,0.12)' : '#ECFDF5' },
                      ]}
                      onPress={() => setEditHomeTeamId(t.id)}
                    >
                      <Text style={[
                        styles.chipText,
                        Platform.OS === 'android' && { color: colors.textSecondary },
                        editHomeTeamId === t.id && styles.chipTextActive,
                        Platform.OS === 'android' && editHomeTeamId === t.id && { color: colors.accentGreen },
                      ]}>
                        {t.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[styles.inputLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Mehmon Jamoa:"}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {editAvailableTeams.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[
                        styles.chipItem,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                        editAwayTeamId === t.id && styles.chipItemActive,
                        Platform.OS === 'android' && editAwayTeamId === t.id && { borderColor: colors.accentGreen, backgroundColor: isDark ? 'rgba(0,255,102,0.12)' : '#ECFDF5' },
                      ]}
                      onPress={() => setEditAwayTeamId(t.id)}
                    >
                      <Text style={[
                        styles.chipText,
                        Platform.OS === 'android' && { color: colors.textSecondary },
                        editAwayTeamId === t.id && styles.chipTextActive,
                        Platform.OS === 'android' && editAwayTeamId === t.id && { color: colors.accentGreen },
                      ]}>
                        {t.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[styles.inputLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Tur / Bosqich:"}</Text>
                <TextInput
                  style={[styles.modalTextInput, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, color: colors.textPrimary }]}
                  value={editRound}
                  onChangeText={setEditRound}
                  placeholder="Masalan: 1 yoki 1-tur"
                  placeholderTextColor={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.3)"}
                />

                <Text style={[styles.inputLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Sana va Vaqt:"}</Text>
                <View style={styles.dateTimeRow}>
                  <TouchableOpacity style={[styles.pickerTriggerBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]} onPress={handleOpenEditDatePicker}>
                    <Ionicons name="calendar-outline" size={16} color={colors.accentGreen} />
                    <Text style={[styles.pickerTriggerText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{editMatchDate || 'Sana tanlang'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.pickerTriggerBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]} onPress={handleOpenEditTimePicker}>
                    <Ionicons name="time-outline" size={16} color={colors.accentGreen} />
                    <Text style={[styles.pickerTriggerText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{editMatchTime || 'Vaqt tanlang'}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.modalSaveBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }, savingEdit && { opacity: 0.6 }]}
                  onPress={handleSaveEditMatch}
                  disabled={savingEdit}
                >
                  {savingEdit ? (
                    <ActivityIndicator color="#000000" size="small" />
                  ) : (
                    <Text style={styles.modalSaveBtnText}>{"O'zgarishlarni Saqlash"}</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal visible={!!matchToDelete} transparent animationType="fade">
        <View style={styles.deleteModalOverlay}>
          <View style={[styles.deleteModalCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
            <View style={styles.deleteModalIcon}>
              <Ionicons name="trash-outline" size={32} color="#EF4444" />
            </View>
            <Text style={[styles.deleteModalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"O'yinni o'chirish"}</Text>
            <Text style={[styles.deleteModalSub, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Ushbu uchrashuv va unga tegishli barcha statistikalar o'chiriladi. Rozimisiz?"}</Text>
            <View style={styles.confirmBtnRow}>
              <TouchableOpacity
                style={[styles.cancelConfirmBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setMatchToDelete(null)}
                disabled={deletingMatch}
              >
                <Text style={[styles.cancelConfirmText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Bekor qilish"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteConfirmBtn}
                onPress={executeDeleteMatch}
                disabled={deletingMatch}
              >
                {deletingMatch ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.deleteConfirmText}>{"O'chirish"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* iOS Pickers */}
      {Platform.OS === 'ios' && showDatePicker && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="spinner"
          onChange={(event, selected) => {
            setShowDatePicker(false);
            if (selected) {
              setTempDate(selected);
              const y = selected.getFullYear();
              const m = String(selected.getMonth() + 1).padStart(2, '0');
              const d = String(selected.getDate()).padStart(2, '0');
              setEditMatchDate(`${y}-${m}-${d}`);
            }
          }}
        />
      )}

      {Platform.OS === 'ios' && showTimePicker && (
        <DateTimePicker
          value={tempTime}
          mode="time"
          is24Hour
          display="spinner"
          onChange={(event, selected) => {
            setShowTimePicker(false);
            if (selected) {
              setTempTime(selected);
              const hh = String(selected.getHours()).padStart(2, '0');
              const mm = String(selected.getMinutes()).padStart(2, '0');
              setEditMatchTime(`${hh}:${mm}`);
            }
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: Platform.OS === 'ios' ? 10 : 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  finishedCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  finishedCountText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '800',
  },
  filterBarContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 14,
  },
  filterSelectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  filterSelectBtnActive: {
    borderColor: '#00FF66',
    backgroundColor: 'rgba(0,255,102,0.12)',
  },
  filterSelectText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    marginHorizontal: 6,
  },
  dropdownMenuCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    padding: 6,
    overflow: 'hidden',
  },
  dropdownMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  dropdownMenuText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 130,
    gap: 12,
  },
  matchCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 16,
    overflow: 'hidden',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  leagueTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  leagueTagText: {
    color: '#00FF66',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  roundTagText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '600',
  },
  finishedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  finishedBadgeText: {
    color: '#10B981',
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  teamsSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  teamCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  teamLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  teamName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  scoreContainer: {
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 4,
  },
  scoreBadge: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  scoreText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1,
  },
  penaltyText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
  },
  matchDateSubText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '600',
  },
  cardBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 10,
    marginTop: 4,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  locationText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11.5,
    fontWeight: '600',
  },
  detailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,255,102,0.1)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,255,102,0.25)',
  },
  detailsBtnText: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '800',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingTop: 80,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 16,
  },
  emptySub: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  swipeButtonsStackedContainer: {
    width: 75,
    height: '100%',
    paddingLeft: 8,
    gap: 6,
  },
  swipeEditBtnStacked: {
    flex: 1,
    backgroundColor: '#3B82F6',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeDeleteBtnStacked: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeBtnTextStacked: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  skeletonCard: {
    backgroundColor: '#151A24',
    borderRadius: 18,
    padding: 16,
  },
  skeletonTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  skeletonTeamsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  skeletonTeamCol: {
    alignItems: 'center',
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: 'transparent',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  modalScrollBody: {
    gap: 12,
    paddingBottom: 20,
  },
  inputLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12.5,
    fontWeight: '700',
    marginTop: 4,
  },
  chipItem: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipItemActive: {
    borderColor: '#00FF66',
    backgroundColor: 'rgba(0,255,102,0.12)',
  },
  chipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#00FF66',
    fontWeight: '900',
  },
  modalTextInput: {
    backgroundColor: '#1E2433',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerTriggerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E2433',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pickerTriggerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  modalSaveBtn: {
    backgroundColor: '#00FF66',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  modalSaveBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
  },
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  deleteModalCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 20,
    padding: 22,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  deleteModalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(239,68,68,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  deleteModalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 6,
  },
  deleteModalSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  confirmBtnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  cancelConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  cancelConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    alignItems: 'center',
  },
  deleteConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});
