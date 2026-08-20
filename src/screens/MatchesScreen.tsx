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
  Switch,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { SwipeRow } from '../components/SwipeRow';
import { MatchControlScreen } from './MatchControlScreen';
import { adminNotificationService } from '../utils/adminNotificationService';
import { useMatchesData, useTeamsData, useLeaguesData } from '../api/hooks';
import { useQueryClient } from '@tanstack/react-query';

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
  match_date?: string;
  match_time?: string;
  date?: string;
  time?: string;
  location?: string;
  stadium_name?: string;
  importance?: 'oddiy' | 'ortacha' | 'markaziy';
  youtube_link?: string;
  is_postponed?: boolean;
  status?: 'scheduled' | 'live' | 'finished' | 'postponed' | string;
}

// Skeleton Loader Component for Match Cards
const MatchCardSkeleton: React.FC = () => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);

  return (
    <Animated.View style={[styles.skeletonCard, { opacity }]}>
      <View style={styles.skeletonTopRow}>
        <View style={{ width: 90, height: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 6 }} />
        <View style={{ width: 70, height: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6 }} />
      </View>
      <View style={styles.skeletonTeamsRow}>
        <View style={styles.skeletonTeamCol}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' }} />
          <View style={{ width: 70, height: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6 }} />
        </View>
        <View style={{ width: 44, height: 28, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <View style={styles.skeletonTeamCol}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' }} />
          <View style={{ width: 70, height: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6 }} />
        </View>
      </View>
      <View style={{ height: 38, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, marginTop: 8 }} />
    </Animated.View>
  );
};

export const MatchesScreen: React.FC<{ onNavigateToCreate?: () => void }> = ({ onNavigateToCreate }) => {
  const { orgId, collabLeagueNames } = useOrg();
  const queryClient = useQueryClient();

  // 3 Select Filters: Liga, Tur, Holat (Only Active Matches: Live & Scheduled)
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedRound, setSelectedRound] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'live' | 'scheduled'>('all');

  // React Query Hooks
  const {
    data: matches = [],
    isLoading: loading,
    refetch: refetchMatches,
  } = useMatchesData(orgId, selectedLeague, collabLeagueNames);

  const { data: leagues = [] } = useLeaguesData(orgId);
  const { data: teams = [] } = useTeamsData(orgId);

  const [refreshing, setRefreshing] = useState(false);

  // Dropdown open states
  const [activeDropdown, setActiveDropdown] = useState<'none' | 'league' | 'round' | 'status'>('none');

  // Active Control Match Object State (0ms instant transition without blocking spinner)
  const [activeControlMatch, setActiveControlMatch] = useState<Match | null>(null);

  // Active Swiped Row ID State
  const [activeSwipedId, setActiveSwipedId] = useState<string | number | null>(null);

  // --- FULL EDIT MATCH MODAL STATE (1:1 matching Web Admin Schedule.jsx) ---
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
  const [showSecretStages, setShowSecretStages] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // DateTimePicker Modal States for Edit
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const [tempTime, setTempTime] = useState(new Date());

  // Custom Delete Modal State
  const [matchToDelete, setMatchToDelete] = useState<Match | null>(null);
  const [deletingMatch, setDeletingMatch] = useState(false);

  // 1-second ticker effect for real-time live match card timers
  const [, setTick] = useState(0);
  useEffect(() => {
    const timerInterval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timerInterval);
  }, []);

  // Supabase Realtime Subscription: Invalidate queries instead of full re-fetch
  useEffect(() => {
    const matchesChannel = supabase
      .channel('matches_list_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        queryClient.invalidateQueries({ queryKey: ['matches', Number(orgId) || 1] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_events' }, () => {
        queryClient.invalidateQueries({ queryKey: ['matches', Number(orgId) || 1] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(matchesChannel);
    };
  }, [orgId, queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchMatches();
    setRefreshing(false);
  }, [refetchMatches]);

  // Open Full Edit Match Modal
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

  // Save Edit Match to Supabase DB (Cascading all 11 fields)
  const handleSaveEditMatch = async () => {
    if (!editingMatch) return;
    if (!editLeague || !editHomeTeamId || !editAwayTeamId || !editMatchDate || !editMatchTime) {
      Alert.alert("Majburiy Maydonlar", "Iltimos, barcha majburiy maydonlarni (Liga, Jamoalar, Sana, Vaqt) to'ldiring.");
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
    };

    const fullUpdatePayload = {
      ...baseUpdatePayload,
      stadium_name: editStadiumName,
      importance: editImportance,
      is_postponed: editIsPostponed,
    };

    try {
      const dbClient = supabase;
      let { error } = await dbClient.from('matches').update(fullUpdatePayload).eq('id', editingMatch.id);

      if (error) {
        // Fallback without optional columns if missing in DB schema
        let { error: err2 } = await dbClient.from('matches').update(baseUpdatePayload).eq('id', editingMatch.id);
        if (err2) throw err2;
      }

      // Notify both teams of updated/rescheduled match
      adminNotificationService.notifyMatchScheduled({
        homeTeamId: String(editHomeTeamId || editingMatch.home_team_id || ''),
        awayTeamId: String(editAwayTeamId || editingMatch.away_team_id || ''),
        homeTeamName: (editingMatch as any).home_team?.name || 'Jamoa 1',
        awayTeamName: (editingMatch as any).away_team?.name || 'Jamoa 2',
        matchDate: editMatchDate,
        matchTime: editMatchTime,
        stadium: editStadiumName || (editingMatch as any).stadium,
        matchId: String(editingMatch.id),
        organizationId: (editingMatch as any).organization_id || orgId || 1,
      });

      setEditingMatch(null);
      queryClient.invalidateQueries({ queryKey: ['matches', Number(orgId) || 1] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
    } catch (e: any) {
      Alert.alert("Xatolik", e.message || "Tahrirlashda xatolik yuz berdi");
      queryClient.invalidateQueries({ queryKey: ['matches', Number(orgId) || 1] });
    } finally {
      setSavingEdit(false);
    }
  };

  // Open Custom App-Styled Delete Confirmation Modal
  const handleDeleteMatch = (match: Match) => {
    setMatchToDelete(match);
  };

  // Execute Match Delete in Supabase (deleting associated timer sponsors and events first to avoid DB FK errors)
  const executeDeleteMatch = async () => {
    if (!matchToDelete) return;
    const targetId = matchToDelete.id;
    setDeletingMatch(true);

    try {
      const dbClient = supabase;

      // 1. Delete associated live timer sponsor row
      await dbClient.from('sponsors').delete().eq('name', `MATCH_TIMER_${targetId}`);

      // 2. Delete associated match events & stats if any
      await dbClient.from('match_events').delete().eq('match_id', targetId);
      await dbClient.from('match_stats').delete().eq('match_id', targetId);

      // 3. Delete match from matches table
      let { error } = await dbClient.from('matches').delete().eq('id', targetId);
      if (error && !isNaN(Number(targetId))) {
        const { error: errNum } = await dbClient.from('matches').delete().eq('id', Number(targetId));
        if (errNum) throw errNum;
      } else if (error) {
        throw error;
      }

      setMatchToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['finishedMatches'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.refetchQueries({ queryKey: ['matches'] });
      queryClient.refetchQueries({ queryKey: ['finishedMatches'] });
      refetchMatches();
    } catch (e: any) {
      console.error('Error deleting match:', e);
      Alert.alert("Xatolik", e?.message || "O'yinni o'chirishda xatolik yuz berdi");
      queryClient.invalidateQueries({ queryKey: ['matches'] });
    } finally {
      setDeletingMatch(false);
    }
  };

  // Unified Live Forward Time Helper Calculation (00:00 -> 45:00 -> 90:00)
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
      if (status === 'half_time') {
        const halfMin = Math.floor(sec / 60) || 30;
        return { text: `TANAFFUS (${halfMin}')`, color: '#F59E0B' };
      }
      const halfLabel = status === 'second_half' ? '2-Taym' : '1-Taym';
      if (!isRunning && (timerSecs || 0) > 0) {
        return { text: `PAUZA • ${halfLabel} (${min}')`, color: '#F59E0B' };
      }
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

  // Render MatchControlScreen if active
  if (activeControlMatch) {
    return (
      <MatchControlScreen
        matchId={activeControlMatch.id}
        initialMatch={activeControlMatch}
        onBack={() => {
          setActiveControlMatch(null);
          queryClient.invalidateQueries({ queryKey: ['matches'] });
          queryClient.invalidateQueries({ queryKey: ['finishedMatches'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        }}
      />
    );
  }

  // Helper to match status groups accurately
  const isMatchLive = (st?: string) => ['first_half', 'second_half', 'half_time', 'live', 'in_progress'].includes(st || '');
  const isMatchScheduled = (st?: string) => ['scheduled', 'upcoming', 'not_started', 'pending'].includes(st || '') || !st;

  // Filtered and Sorted Active Matches (Strictly EXCLUDING Finished matches, Live TOP #1)
  const filteredMatches = matches.filter((m) => {
    // 1. NEVER show finished matches in this screen
    if (m.status === 'finished' || m.status === 'FINISHED' || m.status === 'tugagan' || m.status === 'yakunlangan') return false;

    if (selectedLeague !== 'all' && m.league !== selectedLeague) return false;
    if (selectedRound !== 'all' && String(m.round) !== selectedRound) return false;
    
    if (selectedStatus === 'live') {
      if (!isMatchLive(m.status)) return false;
    } else if (selectedStatus === 'scheduled') {
      if (!isMatchScheduled(m.status)) return false;
    }
    return true;
  }).sort((a, b) => {
    const statusOrder: Record<string, number> = {
      'first_half': 1,
      'second_half': 1,
      'half_time': 1,
      'live': 1,
      'in_progress': 1,
      'scheduled': 2,
      'upcoming': 2,
      'not_started': 2,
      'pending': 2,
      'postponed': 3,
    };
    
    const getOrder = (status?: string) => statusOrder[status || 'scheduled'] || 3;
    const orderA = getOrder(a.status);
    const orderB = getOrder(b.status);
    
    if (orderA !== orderB) return orderA - orderB;
    
    // If same status, sort by Date and Time (closest matches first)
    const dateA = new Date(`${a.match_date || '2099-01-01'}T${a.match_time || '00:00:00'}`).getTime();
    const dateB = new Date(`${b.match_date || '2099-01-01'}T${b.match_time || '00:00:00'}`).getTime();
    
    return dateA - dateB;
  });

  // Teams filtered by currently selected edit league
  const editAvailableTeams = teams.filter(
    (t) => !t.league || t.league.split(',').map((s: string) => s.trim()).includes(editLeague)
  );

  const availableRounds = Array.from(
    new Set(matches.map((m) => String(m.round || '')).filter(Boolean))
  ).sort();

  return (
    <View style={styles.container}>
      {/* Page Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{"O'yinlar Jadvali"}</Text>
          <Text style={styles.headerSub}>{"Admin ma'lumotlar bazasidagi barcha uchrashuvlar"}</Text>
        </View>
        {onNavigateToCreate && (
          <TouchableOpacity style={styles.createBtn} onPress={onNavigateToCreate}>
            <Ionicons name="add" size={20} color="#000000" />
            <Text style={styles.createBtnText}>{"O'yin Qo'shish"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 3 Select Filter Triggers Bar */}
      <View style={styles.filterBarContainer}>
        {/* 1. Liga Select Dropdown */}
        <TouchableOpacity
          style={[styles.filterSelectBtn, activeDropdown === 'league' && styles.filterSelectBtnActive]}
          onPress={() => setActiveDropdown(activeDropdown === 'league' ? 'none' : 'league')}
        >
          <Ionicons name="trophy-outline" size={14} color="#F59E0B" />
          <Text style={styles.filterSelectText} numberOfLines={1}>
            {selectedLeague === 'all' ? 'Barcha Ligalar' : selectedLeague}
          </Text>
          <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>

        {/* 2. Tur Select Dropdown */}
        <TouchableOpacity
          style={[styles.filterSelectBtn, activeDropdown === 'round' && styles.filterSelectBtnActive]}
          onPress={() => setActiveDropdown(activeDropdown === 'round' ? 'none' : 'round')}
        >
          <Ionicons name="layers-outline" size={14} color="#3B82F6" />
          <Text style={styles.filterSelectText} numberOfLines={1}>
            {selectedRound === 'all' ? 'Barcha Turlar' : selectedRound}
          </Text>
          <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>

        {/* 3. O'yin Holati Select Dropdown */}
        <TouchableOpacity
          style={[styles.filterSelectBtn, activeDropdown === 'status' && styles.filterSelectBtnActive]}
          onPress={() => setActiveDropdown(activeDropdown === 'status' ? 'none' : 'status')}
        >
          <Ionicons name="time-outline" size={14} color="#00FF66" />
          <Text style={styles.filterSelectText} numberOfLines={1}>
            {selectedStatus === 'all'
              ? 'Barcha Holat'
              : selectedStatus === 'live'
              ? 'Jonli'
              : 'Rejalashtirilgan'}
          </Text>
          <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>
      </View>

      {/* Expandable Dropdown Options Container */}
      {activeDropdown === 'league' && (
        <View style={styles.dropdownMenuCard}>
          <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={styles.dropdownMenuItem}
              onPress={() => {
                setSelectedLeague('all');
                setActiveDropdown('none');
              }}
            >
              <Text style={[styles.dropdownMenuText, selectedLeague === 'all' && { color: '#00FF66', fontWeight: '900' }]}>
                Barcha Ligalar
              </Text>
            </TouchableOpacity>
            {leagues.map((lg) => (
              <TouchableOpacity
                key={lg.id}
                style={styles.dropdownMenuItem}
                onPress={() => {
                  setSelectedLeague(lg.name);
                  setActiveDropdown('none');
                }}
              >
                <Text style={[styles.dropdownMenuText, selectedLeague === lg.name && { color: '#00FF66', fontWeight: '900' }]}>
                  {lg.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {activeDropdown === 'round' && (
        <View style={styles.dropdownMenuCard}>
          <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={styles.dropdownMenuItem}
              onPress={() => {
                setSelectedRound('all');
                setActiveDropdown('none');
              }}
            >
              <Text style={[styles.dropdownMenuText, selectedRound === 'all' && { color: '#00FF66', fontWeight: '900' }]}>
                Barcha Turlar
              </Text>
            </TouchableOpacity>
            {availableRounds.length > 0 ? (
              availableRounds.map((rnd) => (
                <TouchableOpacity
                  key={rnd}
                  style={styles.dropdownMenuItem}
                  onPress={() => {
                    setSelectedRound(rnd);
                    setActiveDropdown('none');
                  }}
                >
                  <Text style={[styles.dropdownMenuText, selectedRound === rnd && { color: '#00FF66', fontWeight: '900' }]}>
                    {rnd}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              ['1-tur', '2-tur', '3-tur', '4-tur', 'Chorak final', 'Yarim final', 'Final'].map((rnd) => (
                <TouchableOpacity
                  key={rnd}
                  style={styles.dropdownMenuItem}
                  onPress={() => {
                    setSelectedRound(rnd);
                    setActiveDropdown('none');
                  }}
                >
                  <Text style={[styles.dropdownMenuText, selectedRound === rnd && { color: '#00FF66', fontWeight: '900' }]}>
                    {rnd}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      )}

      {activeDropdown === 'status' && (
        <View style={styles.dropdownMenuCard}>
          {[
            { id: 'all', title: 'Barcha Holatlar' },
            { id: 'live', title: 'Jonli (Live)' },
            { id: 'scheduled', title: 'Rejalashtirilgan' },
          ].map((st) => (
            <TouchableOpacity
              key={st.id}
              style={styles.dropdownMenuItem}
              onPress={() => {
                setSelectedStatus(st.id as any);
                setActiveDropdown('none');
              }}
            >
              <Text style={[styles.dropdownMenuText, selectedStatus === st.id && { color: '#00FF66', fontWeight: '900' }]}>
                {st.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Matches List with Swipe Actions */}
      {loading ? (
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
          <MatchCardSkeleton />
          <MatchCardSkeleton />
          <MatchCardSkeleton />
        </ScrollView>
      ) : (
        <FlatList
          data={filteredMatches}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={{ paddingBottom: 130, gap: 14 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00FF66" />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={42} color="rgba(255,255,255,0.2)" />
              <Text style={styles.emptyText}>{"Hozircha hech qanday o'yin mavjud emas"}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isCentral = item.importance === 'markaziy';
            const mDate = item.match_date || item.date;
            const mTime = item.match_time || item.time;
            const isLive = item.status === 'first_half' || item.status === 'second_half' || item.status === 'half_time' || item.status === 'live';
            const isFinished = item.status === 'finished';
            const countdownInfo = getMatchTimeRemainingText(
              mDate,
              mTime,
              item.status,
              (item as any).timer_seconds,
              (item as any).timer_started_at,
              (item as any).is_timer_running
            );
            const homeName = item.home_team?.name || 'Mezbon';
            const awayName = item.away_team?.name || 'Mehmon';
            const isRowOpen = activeSwipedId === item.id;

            return (
              <SwipeRow
                isOpen={isRowOpen}
                onOpen={() => setActiveSwipedId(item.id)}
                onClose={() => {
                  if (activeSwipedId === item.id) setActiveSwipedId(null);
                }}
                actionWidth={70}
                actions={
                  /* Stacked Vertical Actions (Edit Top, Delete Bottom) */
                  <View style={styles.stackedSwipeActions}>
                    {/* Tahrirlash (Edit) Button */}
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

                    {/* O'chirish (Delete) Button */}
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
                {/* Foreground Match Card */}
                <View
                  style={[
                    styles.matchCard,
                    isCentral && styles.centralMatchCard,
                    item.is_postponed && styles.postponedMatchCard,
                    isLive && { borderColor: 'rgba(239, 68, 68, 0.4)', borderWidth: 1 },
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
                      {item.round && <Text style={styles.roundTagText}>{` • ${item.round}`}</Text>}
                    </View>

                    <View style={styles.fieldTag}>
                      <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.6)" />
                      <Text style={styles.fieldTagText}>
                        {item.location === '2-maydon' ? '2-Maydon' : '1-Maydon'}
                      </Text>
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
                        style={styles.teamLogo}
                      />
                      <Text style={styles.teamName} numberOfLines={2}>
                        {homeName}
                      </Text>
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
                            {getLiveTimerFormattedText((item as any).status, (item as any).timer_seconds, (item as any).timer_started_at, (item as any).is_timer_running)}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.matchTimeText}>{mTime || '18:00'}</Text>
                      )}
                    </View>

                    {/* Away Team */}
                    <View style={styles.teamCol}>
                      <Image
                        source={{
                          uri:
                            item.away_team?.logo_url ||
                            'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop',
                        }}
                        style={styles.teamLogo}
                      />
                      <Text style={styles.teamName} numberOfLines={2}>
                        {awayName}
                      </Text>
                    </View>
                  </View>

                  {/* Countdown & Match Status Bar */}
                  <View style={[styles.countdownBar, isLive && { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                    <Ionicons name={isLive ? "radio-outline" : "time-outline"} size={13} color={countdownInfo.color} />
                    <Text style={[styles.countdownText, { color: countdownInfo.color, fontWeight: isLive ? '900' : '700' }]}>
                      {countdownInfo.text}
                    </Text>
                  </View>

                  {/* PROMINENT CENTERED "BOSHQARISH" ACTION BUTTON */}
                  <TouchableOpacity
                    style={styles.centralManageBtn}
                    onPress={() => setActiveControlMatch(item)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="settings-outline" size={18} color="#000000" />
                    <Text style={styles.centralManageBtnText}>{"O'YINNI BOSHQARISH"}</Text>
                  </TouchableOpacity>
                  </View>
                </SwipeRow>
              );
            }}
          />
        )}

      {/* FULL EDIT MATCH MODAL (11 Fields 1:1 Matching Admin Web) */}
      <Modal visible={!!editingMatch} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '90%' }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{"O'yinni Tahrirlash"}</Text>
              <TouchableOpacity onPress={() => setEditingMatch(null)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            {editingMatch && (
              <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
                {/* 1. Liga Selection */}
                <Text style={styles.inputLabel}>{"Liga:"}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {leagues.map((lg) => (
                    <TouchableOpacity
                      key={lg.id}
                      style={[styles.chipItem, editLeague === lg.name && styles.chipItemActive]}
                      onPress={() => setEditLeague(lg.name)}
                    >
                      <Text style={[styles.chipText, editLeague === lg.name && styles.chipTextActive]}>
                        {lg.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* 2. Home Team Selection */}
                <Text style={styles.inputLabel}>{"Mezbon Jamoa:"}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {editAvailableTeams.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.chipItem, editHomeTeamId === t.id && styles.chipItemActive]}
                      onPress={() => setEditHomeTeamId(t.id)}
                    >
                      <Text style={[styles.chipText, editHomeTeamId === t.id && styles.chipTextActive]}>
                        {t.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* 3. Away Team Selection */}
                <Text style={styles.inputLabel}>{"Mehmon Jamoa:"}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {editAvailableTeams.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.chipItem, editAwayTeamId === t.id && styles.chipItemActive]}
                      onPress={() => setEditAwayTeamId(t.id)}
                    >
                      <Text style={[styles.chipText, editAwayTeamId === t.id && styles.chipTextActive]}>
                        {t.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* 4. Tur / Bosqich Selection */}
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.inputLabel}>{"Tur / Bosqich:"}</Text>
                    <TouchableOpacity onPress={() => setShowSecretStages(!showSecretStages)}>
                      <Text style={{ color: '#00FF66', fontSize: 11, fontWeight: '700' }}>
                        {showSecretStages ? "Yashirish ▲" : "Bosqichlar (Final/Pley-off) ▼"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Quick Round Number Chips */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((num) => (
                      <TouchableOpacity
                        key={num}
                        style={[styles.chipItem, editRound === num && styles.chipItemActive]}
                        onPress={() => setEditRound(num)}
                      >
                        <Text style={[styles.chipText, editRound === num && styles.chipTextActive]}>
                          {num}-tur
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Secret Collapsible Stages */}
                  {showSecretStages && (
                    <View style={{ backgroundColor: '#151A24', padding: 10, borderRadius: 12, gap: 6, borderWidth: 1, borderColor: 'rgba(0, 255, 102, 0.2)' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700' }}>{"Nokaut & Play-Off Bosqichlari:"}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {['1/16 Final', '1/8 Final', 'Chorak Final', 'Yarim Final', '3-O\'rin uchun', 'FINAL'].map((st) => (
                          <TouchableOpacity
                            key={st}
                            style={[styles.chipItem, editRound === st && styles.chipItemActive]}
                            onPress={() => setEditRound(st)}
                          >
                            <Text style={[styles.chipText, editRound === st && styles.chipTextActive]}>
                              {st}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  <TextInput
                    style={styles.modalInput}
                    value={editRound}
                    onChangeText={setEditRound}
                    placeholder="masalan: 1-tur yoki Chorak final"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                  />
                </View>

                {/* 5 & 6. Date and Clock Inputs with Modal Trigger */}
                <View style={styles.rowTwoCols}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>{"O'yin Sanasi:"}</Text>
                    <TouchableOpacity
                      style={styles.pickerTriggerBtn}
                      onPress={() => setShowDatePicker(true)}
                    >
                      <Ionicons name="calendar-outline" size={16} color="#00FF66" />
                      <Text style={styles.pickerTriggerText}>{editMatchDate || "Sana tanlang"}</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>{"O'yin Vaqti:"}</Text>
                    <TouchableOpacity
                      style={styles.pickerTriggerBtn}
                      onPress={() => setShowTimePicker(true)}
                    >
                      <Ionicons name="time-outline" size={16} color="#00FF66" />
                      <Text style={styles.pickerTriggerText}>{editMatchTime || "Vaqt tanlang"}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* 7. Field (Maydon) Selection */}
                <Text style={styles.inputLabel}>{"Maydon (OBS Stream uchun):"}</Text>
                <View style={styles.fieldSelectRow}>
                  {['1-maydon', '2-maydon'].map((f) => (
                    <TouchableOpacity
                      key={f}
                      style={[styles.fieldSelectBtn, editLocation === f && styles.fieldSelectBtnActive]}
                      onPress={() => setEditLocation(f)}
                    >
                      <Text style={[styles.fieldSelectText, editLocation === f && styles.fieldSelectTextActive]}>
                        {f === '2-maydon' ? '2-Maydon' : '1-Maydon'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* 8. Stadium Name Input */}
                <Text style={styles.inputLabel}>{"Stadion Nomi (ixtiyoriy):"}</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editStadiumName}
                  onChangeText={setEditStadiumName}
                  placeholder="masalan: Dinamo Arena"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                />

                {/* 9. Importance Selection (Oddiy, O'rtacha, Markaziy) */}
                <Text style={styles.inputLabel}>{"O'yin Dolzarbligi Darajasi:"}</Text>
                <View style={styles.importanceRow}>
                  {[
                    { id: 'oddiy', label: '⚪ Oddiy' },
                    { id: 'ortacha', label: '🔵 O\'rtacha' },
                    { id: 'markaziy', label: '⭐ Markaziy' },
                  ].map((imp) => (
                    <TouchableOpacity
                      key={imp.id}
                      style={[
                        styles.importanceBtn,
                        editImportance === imp.id && styles.importanceBtnActive,
                      ]}
                      onPress={() => setEditImportance(imp.id as any)}
                    >
                      <Text
                        style={[
                          styles.importanceBtnText,
                          editImportance === imp.id && styles.importanceBtnTextActive,
                        ]}
                      >
                        {imp.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* 10. YouTube Link (Yashirin Switch Toggle) */}
                <View style={styles.postponedToggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.postponedToggleTitle}>{"YouTube Translyatsiya Linki 📺"}</Text>
                    <Text style={styles.postponedToggleSub}>{"Jonli efir havolasini kiritish uchun yoqing"}</Text>
                  </View>
                  <Switch
                    value={editEnableYtLink}
                    onValueChange={setEditEnableYtLink}
                    trackColor={{ false: '#334155', true: '#00FF66' }}
                    thumbColor={editEnableYtLink ? '#000000' : '#94A3B8'}
                  />
                </View>

                {editEnableYtLink && (
                  <TextInput
                    style={styles.modalInput}
                    value={editYtLink}
                    onChangeText={setEditYtLink}
                    placeholder="https://youtube.com/live/..."
                    placeholderTextColor="rgba(255,255,255,0.3)"
                  />
                )}

                {/* 11. Postponed Switch Toggle */}
                <View style={styles.postponedToggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.postponedToggleTitle}>{"Qoldirilgan O'yin Statusi ⏸️"}</Text>
                    <Text style={styles.postponedToggleSub}>{"O'yinni kechiktirilgan statusga o'tkazish"}</Text>
                  </View>
                  <Switch
                    value={editIsPostponed}
                    onValueChange={setEditIsPostponed}
                    trackColor={{ false: '#334155', true: '#EF4444' }}
                    thumbColor={editIsPostponed ? '#FFFFFF' : '#94A3B8'}
                  />
                </View>

                {/* Submit Save Button */}
                <TouchableOpacity
                  style={styles.modalSaveBtn}
                  onPress={handleSaveEditMatch}
                  disabled={savingEdit}
                >
                  {savingEdit ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <Text style={styles.modalSaveBtnText}>{"O'zgarishlarni Saqlash"}</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Date Picker Confirmation Modal */}
      {showDatePicker && (
        <Modal transparent animationType="fade">
          <View style={styles.pickerModalOverlay}>
            <View style={styles.pickerModalCard}>
              <Text style={styles.pickerModalTitle}>{"O'yin Sanasini Tanlang"}</Text>

              <DateTimePicker
                value={tempDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, d) => d && setTempDate(d)}
                textColor="#FFFFFF"
              />

              <View style={styles.pickerModalActions}>
                <TouchableOpacity
                  style={styles.pickerCancelBtn}
                  onPress={() => setShowDatePicker(false)}
                >
                  <Text style={styles.pickerCancelText}>{"Bekor qilish"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pickerConfirmBtn}
                  onPress={() => {
                    const year = tempDate.getFullYear();
                    const month = String(tempDate.getMonth() + 1).padStart(2, '0');
                    const day = String(tempDate.getDate()).padStart(2, '0');
                    setEditMatchDate(`${year}-${month}-${day}`);
                    setShowDatePicker(false);
                  }}
                >
                  <Text style={styles.pickerConfirmText}>{"OK • Tasdiqlash"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Time Clock Picker Confirmation Modal */}
      {showTimePicker && (
        <Modal transparent animationType="fade">
          <View style={styles.pickerModalOverlay}>
            <View style={styles.pickerModalCard}>
              <Text style={styles.pickerModalTitle}>{"O'yin Vaqtini Tanlang"}</Text>

              <DateTimePicker
                value={tempTime}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, t) => t && setTempTime(t)}
                textColor="#FFFFFF"
              />

              <View style={styles.pickerModalActions}>
                <TouchableOpacity
                  style={styles.pickerCancelBtn}
                  onPress={() => setShowTimePicker(false)}
                >
                  <Text style={styles.pickerCancelText}>{"Bekor qilish"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pickerConfirmBtn}
                  onPress={() => {
                    const hours = String(tempTime.getHours()).padStart(2, '0');
                    const minutes = String(tempTime.getMinutes()).padStart(2, '0');
                    setEditMatchTime(`${hours}:${minutes}`);
                    setShowTimePicker(false);
                  }}
                >
                  <Text style={styles.pickerConfirmText}>{"OK • Tasdiqlash"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Custom App-Styled Delete Confirmation Modal */}
      <Modal
          visible={!!matchToDelete}
          transparent
          animationType="fade"
          onRequestClose={() => setMatchToDelete(null)}
        >
          <View style={styles.confirmModalOverlay}>
            <View style={styles.confirmModalCard}>
              <View style={styles.confirmIconBg}>
                <Ionicons name="trash-outline" size={32} color="#EF4444" />
              </View>
              <Text style={styles.confirmModalTitle}>{"O'yinni o'chirish"}</Text>
              <Text style={styles.confirmModalSub}>
                {matchToDelete?.home_team?.name && matchToDelete?.away_team?.name
                  ? `${matchToDelete.home_team.name} vs ${matchToDelete.away_team.name} uchrashuvini o'chirishga ishonchingiz komilmi?`
                  : "Ushbu uchrashuvni bazadan to'liq o'chirishga ishonchingiz komilmi?"}
              </Text>

              <View style={styles.confirmBtnRow}>
                <TouchableOpacity
                  style={styles.cancelConfirmBtn}
                  onPress={() => setMatchToDelete(null)}
                  disabled={deletingMatch}
                >
                  <Text style={styles.cancelConfirmText}>{"Bekor qilish"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteConfirmBtn}
                  onPress={executeDeleteMatch}
                  disabled={deletingMatch}
                >
                  {deletingMatch ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="trash" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.deleteConfirmText}>{"O'chirish"}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  headerSub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00FF66',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  createBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },
  filterBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  filterSelectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterSelectBtnActive: {
    borderColor: '#00FF66',
    backgroundColor: '#162232',
  },
  filterSelectText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
    flex: 1,
    marginHorizontal: 4,
  },
  dropdownMenuCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 6,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  dropdownMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  dropdownMenuText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  /* Skeleton Loader Styles */
  skeletonCard: {
    backgroundColor: '#151A24',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 12,
  },
  skeletonTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  skeletonTeamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  skeletonTeamCol: {
    alignItems: 'center',
    gap: 6,
  },
  /* Match Card Styles */
  matchCard: {
    backgroundColor: '#151A24',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 12,
  },
  centralMatchCard: {
    borderColor: 'rgba(255, 149, 0, 0.6)',
    borderWidth: 1.5,
    backgroundColor: '#1A1822',
  },
  postponedMatchCard: {
    opacity: 0.8,
    borderColor: '#EF4444',
  },
  centralHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    alignSelf: 'flex-start',
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

  /* Prominent Central Manage Button */
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

  /* Stacked Swipe Action Buttons (Edit Top, Delete Bottom) */
  stackedSwipeActions: {
    flexDirection: 'column',
    height: '100%',
    justifyContent: 'space-between',
    gap: 6,
    width: 62,
  },
  swipeEditBtnStacked: {
    flex: 1,
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  swipeDeleteBtnStacked: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  swipeBtnTextStacked: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
  },

  /* Full Edit Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 17, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  modalScrollBody: {
    gap: 10,
    paddingBottom: 10,
  },
  inputLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  modalInput: {
    backgroundColor: '#151A24',
    borderRadius: 12,
    height: 44,
    color: '#FFFFFF',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    fontSize: 13.5,
  },
  chipItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#151A24',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipItemActive: {
    backgroundColor: 'rgba(0, 255, 102, 0.15)',
    borderColor: '#00FF66',
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
  rowTwoCols: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#151A24',
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pickerTriggerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  fieldSelectRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldSelectBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#151A24',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  fieldSelectBtnActive: {
    backgroundColor: '#00FF66',
    borderColor: '#00FF66',
  },
  fieldSelectText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700',
  },
  fieldSelectTextActive: {
    color: '#000000',
    fontWeight: '900',
  },
  importanceRow: {
    flexDirection: 'row',
    gap: 6,
  },
  importanceBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#151A24',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  importanceBtnActive: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  importanceBtnText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11.5,
    fontWeight: '700',
  },
  importanceBtnTextActive: {
    color: '#F59E0B',
    fontWeight: '900',
  },
  postponedToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#151A24',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginTop: 4,
  },
  postponedToggleTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  postponedToggleSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
  modalSaveBtn: {
    backgroundColor: '#00FF66',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  modalSaveBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
  },

  /* Date & Time Confirmation Modal */
  pickerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  pickerModalCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  pickerModalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  pickerModalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    width: '100%',
  },
  pickerCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  pickerCancelText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  pickerConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#00FF66',
    alignItems: 'center',
  },
  pickerConfirmText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },

  /* Custom Delete Confirmation Modal Styles */
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmModalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  confirmIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  confirmModalTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmModalSub: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  confirmBtnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelConfirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  deleteConfirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  loadMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#00FF66',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    shadowColor: '#00FF66',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loadMoreBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '900',
  },
});
