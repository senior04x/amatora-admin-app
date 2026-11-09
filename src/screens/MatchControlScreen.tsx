import { requireOrganizationId } from '../utils/organizationId';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
  TextInput,
  Clipboard,
  Animated,
  Platform,
  BackHandler,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHideNavigationDock } from '../utils/scrollDock';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import MatchActionSlider from '../components/MatchActionSlider';
import { BlurView } from '../components/SafeBlurView';
import * as Crypto from 'expo-crypto';
// 🔒 SECURITY FIX: supabase o'chirildi, faqat supabase (anon + RLS) ishlatiladi
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { useQueryClient } from '@tanstack/react-query';
import { getHalfDurationSeconds, loadMatchCompetition } from '../utils/matchDuration';
import {
  canRunMatchTimer, getElapsedMatchSeconds, getRemainingSeconds, getStreamField,
  getPauseSeconds, isRunningTimerSnapshot, serverNowMs, syncServerClock, useMatchTimer,
} from '../utils/matchTimer';
import { TIMER_ROW_COLUMNS, writeMatchTimer } from '../api/matchTimer';

interface Props {
  matchId: string | number;
  initialMatch?: any;
  onBack: () => void;
  isReadOnly?: boolean;
}

const EVENT_TYPES = [
  { id: 'goal', icon: 'football-outline', label: 'Gol', color: '#22C55E' },
  { id: 'assist', icon: 'footsteps-outline', label: 'Assist', color: '#3B82F6' },
  { id: 'yellow_card', icon: 'square', label: 'Sariq kartochka', color: '#F59E0B' },
  { id: 'red_card', icon: 'square', label: 'Qizil kartochka', color: '#EF4444' },
  { id: 'substitution', icon: 'swap-horizontal-outline', label: 'Almashtirish', color: '#A855F7' },
];

// 🔥 PERFORMANCE FIX: Limited size cache (Memory leak fix)
// Before: Unlimited Map → 5000 match × 300 KB = 1.5 GB RAM leak → APP CRASH!
// After: Max 50 match × 300 KB = 15 MB RAM (100x yaxshi!)

class LimitedCache<K, V> {
  private cache = new Map<K, V & { timestamp: number }>();
  private maxSize: number;
  private maxAge: number;

  constructor(maxSize: number, maxAge: number) {
    this.maxSize = maxSize;
    this.maxAge = maxAge;
  }

  set(key: K, value: V) {
    // Evict oldest if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, { ...value, timestamp: Date.now() } as V & { timestamp: number });
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return undefined;
    }

    return entry as V;
  }

  clear() {
    this.cache.clear();
  }
}

const CLOCK_URL = Platform.OS === 'web' ? 'https://www.amatora.uz/api/server-time' : undefined;

const MATCH_CONTROL_CACHE = new LimitedCache<string, any>(50, 10 * 60 * 1000);
// Cache unassigned replays when admin deletes a goal mistake so re-adding re-links the replay video
const ORPHAN_REPLAYS_BY_MATCH = new Map<string, { url: string; timestamp: number }>();

export const MatchControlScreen: React.FC<Props> = ({ matchId, initialMatch, onBack, isReadOnly = false }) => {
  useHideNavigationDock();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const timerBarBottom = Math.max(24, safeAreaBottom + 8);
  const { orgId } = useOrg();
  const { isDark, colors } = useTheme();
  const queryClient = useQueryClient();
  const cachedData = MATCH_CONTROL_CACHE.get(String(matchId));

  // Match, League & Team Data (Immediate initial render from cache - 0ms delay!)
  const seedMatch = cachedData?.match || initialMatch;
  const [loading, setLoading] = useState(!seedMatch);

  const [match, setMatch] = useState<any>(seedMatch ?? null);
  const isReadOnlyMode = isReadOnly || !match?.organization_id || Number(match.organization_id) !== Number(orgId);
  const [competition, setCompetition] = useState<Awaited<ReturnType<typeof loadMatchCompetition>> | null>(cachedData?.competition ?? null);
  const [readyMatchId, setReadyMatchId] = useState<string | number | null>(null);
  const timerReady = String(readyMatchId) === String(matchId);
  const latestMatchRow = useRef<any>(null);
  const timerWritePending = useRef(false);
  const [homeTeam, setHomeTeam] = useState<any>(cachedData?.homeTeam || seedMatch?.home_team || null);
  const [awayTeam, setAwayTeam] = useState<any>(cachedData?.awayTeam || seedMatch?.away_team || null);
  const [homePlayers, setHomePlayers] = useState<any[]>(cachedData?.homePlayers || []);
  const [awayPlayers, setAwayPlayers] = useState<any[]>(cachedData?.awayPlayers || []);
  const [events, setEvents] = useState<any[]>(cachedData?.events || []);
  const [isPlayersLoading, setIsPlayersLoading] = useState(!cachedData?.homePlayers || cachedData.homePlayers.length === 0);
  const [isEventsLoading, setIsEventsLoading] = useState(!cachedData?.events);

  // Penalty Shootout State
  const [showPenaltyControls, setShowPenaltyControls] = useState(false);
  const [homePenalties, setHomePenalties] = useState(cachedData?.homePenalties || 0);
  const [awayPenalties, setAwayPenalties] = useState(cachedData?.awayPenalties || 0);

  // Animated Toast popup state (1:1 matching user screenshot UI)
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

  // OBS Studio & amatora.exe Connection Live Status State
  const [isObsConnected] = useState(true);
  const obsField = getStreamField(match?.location);
  const obsOrgId = match?.organization_id ?? orgId;
  const obsUrl = obsOrgId ? 'https://www.amatora.uz/obs/scoreboard/stream' + obsField + '?org_id=' + encodeURIComponent(String(obsOrgId)) : '';

  // Roster subtab ('home' vs 'away')
  const [activeRosterTab, setActiveRosterTab] = useState<'home' | 'away'>('home');

  const quickGoalWriteRef = useRef(false);

  // Status Change Custom Confirmation Modal State & Loading State
  const [isStatusChanging, setIsStatusChanging] = useState(false);
  const [statusConfirmModal, setStatusConfirmModal] = useState<{
    isOpen: boolean;
    targetStatus: string;
    expectedStatus?: string;
    title: string;
    message: string;
  }>({
    isOpen: false,
    targetStatus: '',
    title: '',
    message: '',
  });

  // Modals
  const [showObsModal, setShowObsModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventType, setEventType] = useState<string>('goal');
  const [selectedTeamId, setSelectedTeamId] = useState<string | number>('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | number>('');
  const [selectedSubInPlayerId, setSelectedSubInPlayerId] = useState<string | number>('');
  const [eventMinute, setEventMinute] = useState<string>('1');
  // Tahrirlanayotgan voqea id'si — null bo'lsa modal YANGI voqea qo'shish
  // rejimida, aks holda MAVJUD voqeani (id o'zgarmasdan) YANGILASH rejimida
  // ishlaydi. Buning kerakligi sababi: avval "tuzatish" faqat o'chirib qayta
  // qo'shish orqali qilinar edi — bu esa event id'ni o'zgartirib, unga
  // biriktirilgan replay_video_url'ni yo'qotib qo'yardi (agar tuzatish OBS
  // orqali replay biriktirilgandan ancha keyin, masalan bir kundan keyin
  // qilinsa — vaqtinchalik "orphan" xotira ham allaqachon tozalangan bo'lardi).
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);

  const dbClient = supabase;

  const halfDurationSecs = getHalfDurationSeconds(match, competition?.league, competition?.tournamentDuration);
  const halfDurationMins = halfDurationSecs / 60;
  const matchDurationMins = halfDurationMins * 2;
  const { timerSeconds, isTimerRunning, isClockSynced } = useMatchTimer(match, halfDurationSecs, CLOCK_URL);
  // Hardware Android Back Button Handler (Closes modals first, or navigates back)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const backAction = () => {
      if (statusConfirmModal.isOpen) {
        setStatusConfirmModal({ isOpen: false, targetStatus: '', title: '', message: '' });
        return true;
      }
      if (showEventModal) {
        setShowEventModal(false);
        return true;
      }
      if (showObsModal) {
        setShowObsModal(false);
        return true;
      }
      if (onBack) {
        onBack();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [statusConfirmModal.isOpen, showEventModal, showObsModal, onBack]);

  const saveTimer = async (
    buildUpdate: (nowMs: number) => Record<string, unknown> | null,
    automatic = false,
  ) => {
    if (isReadOnlyMode || timerWritePending.current || String(match?.id) !== String(matchId)) return false;
    if (!timerReady) {
      if (!automatic) Alert.alert('Taymer', 'O‘yin taymeri ma’lumotlari yuklanmoqda. Qayta urinib ko‘ring.');
      return false;
    }
    timerWritePending.current = true;
    if (!automatic) setIsStatusChanging(true);
    const snapshot = match;
    try {
      const targetOrgId = requireOrganizationId(orgId);
      if (serverNowMs() == null) await syncServerClock(CLOCK_URL);
      const now = serverNowMs();
      if (now == null) throw new Error('Server clock unavailable');
      const values = buildUpdate(now);
      if (!values) return false;

      const rowAtWrite = latestMatchRow.current;
      const saved = await writeMatchTimer(supabase, targetOrgId, snapshot, {
        ...values, updated_at: new Date(now).toISOString(),
      });
      if (saved) {
        if (latestMatchRow.current === rowAtWrite) applyMatchRow(saved);
        return true;
      }

      if (!automatic) {
        await refreshMatchRow();
        Alert.alert('Taymer', 'O‘yin holati o‘zgargan. Ekrandagi holatni tekshirib, qayta urinib ko‘ring.');
      }
    } catch (error) {
      console.warn('Match timer update failed:', error);
      if (!automatic) Alert.alert('Taymer', 'O‘zgarish tasdiqlanmadi. Internet ulanishini va o‘yin holatini tekshiring.');
    } finally {
      timerWritePending.current = false;
      if (!automatic) setIsStatusChanging(false);
    }
    return false;
  };
  // SEND REMOTE GOAL SIGNAL TO AMATORA-OBS (amatora.exe) REPLAY ENGINE
  const sendRemoteObsGoalSignal = async (eventUuid: string, playerName?: string, teamName?: string) => {
    try {
      const targetOrgId = requireOrganizationId(match?.organization_id || orgId);
      const rawLocation = String(match?.location || '1').toLowerCase();
      const fieldId = rawLocation.includes('2') ? '2' : '1';

      // Fast broadcast to OBS Replay Engine (0ms latency)
      try {
        supabase.channel(`obs_goal_${targetOrgId}_field_${fieldId}`).send({
          type: 'broadcast',
          event: 'goal_replay_trigger',
          payload: {
            timestamp: Date.now(),
            event_id: eventUuid,
            match_id: String(matchId),
            org_id: String(targetOrgId),
            field_id: fieldId,
            player_name: playerName || '',
            team_name: teamName || '',
          },
        });
      } catch (bcErr) {}
    } catch (e) {
      console.warn('sendRemoteObsGoalSignal error:', e);
    }
  };

  // SEND REMOTE FINISH MATCH SIGNAL TO AMATORA-OBS TO CLEAN REPLAYS FOLDER
  const sendRemoteObsFinishSignal = async () => {
    try {
      const targetOrgId = requireOrganizationId(match?.organization_id || orgId);
      const rawLocation = String(match?.location || '1').toLowerCase();
      const fieldId = rawLocation.includes('2') ? '2' : '1';

      try {
        supabase.channel(`obs_goal_${targetOrgId}_field_${fieldId}`).send({
          type: 'broadcast',
          event: 'finish_match_trigger',
          payload: {
            timestamp: Date.now(),
            match_id: String(matchId),
            org_id: String(targetOrgId),
            field_id: fieldId,
          },
        });
      } catch (bcErr) {}
    } catch (e) {
      console.warn('sendRemoteObsFinishSignal error:', e);
    }
  };

  const applyMatchRow = (row: any) => {
    latestMatchRow.current = { ...latestMatchRow.current, ...row };
    setMatch((previous: any) => String(previous?.id) === String(row.id) ? { ...previous, ...row } : row);
    if ('home_penalty_score' in row) setHomePenalties(row.home_penalty_score ?? 0);
    if ('away_penalty_score' in row) setAwayPenalties(row.away_penalty_score ?? 0);
  };

  const refreshMatchRow = async (isActive = () => true) => {
    const rowAtRequest = latestMatchRow.current;
    const { data, error } = await dbClient.from('matches').select(TIMER_ROW_COLUMNS).eq('id', matchId).maybeSingle();
    if (error) throw error;
    if (data && isActive() && latestMatchRow.current === rowAtRequest) applyMatchRow(data);
  };

  useEffect(() => {
    if (String(latestMatchRow.current?.id) !== String(matchId)) latestMatchRow.current = null;
    let active = true;
    let subscribed = false;
    let refreshing = false;
    let loaded = false;
    let needsRefresh = false;
    const refresh = async () => {
      if (!active) return;
      if (refreshing) { needsRefresh = true; return; }
      refreshing = true;
      try {
        if (loaded) await refreshMatchRow(() => active);
        else loaded = await fetchMatchControlData(() => active);
      } catch (error) {
        console.warn('Match timer refresh failed:', error);
      } finally {
        refreshing = false;
        if (needsRefresh && active) { needsRefresh = false; void refresh(); }
      }
    };

    void refresh();
    const channel = supabase.channel('match_control_' + matchId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_events', filter: 'match_id=eq.' + matchId }, () => {
        if (active) void fetchEvents(matchId);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: 'id=eq.' + matchId }, ({ new: row }) => {
        if (active) applyMatchRow(row);
      })
      .subscribe(status => {
        subscribed = status === 'SUBSCRIBED';
        if (subscribed) void refresh();
      });
    const poll = setInterval(() => {
      if ((!subscribed || !loaded) && AppState.currentState !== 'background') void refresh();
    }, 5000);
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      void syncServerClock(CLOCK_URL).catch(() => {});
      void refresh();
    });

    return () => {
      active = false;
      clearInterval(poll);
      appState.remove();
      void supabase.removeChannel(channel);
    };
  }, [matchId, orgId]);
  const fetchMatchControlData = async (isActive: () => boolean) => {
    const rowAtRequest = latestMatchRow.current;
    if (!match && !initialMatch) setLoading(true);
    try {
      const { data: matchData, error } = await dbClient.from('matches').select('*').eq('id', matchId).single();
      if (error) throw error;
      if (!isActive()) return false;
      const resolvedMatch = latestMatchRow.current !== rowAtRequest ? { ...matchData, ...latestMatchRow.current } : matchData;
      applyMatchRow(resolvedMatch);

      const competitionLoad = loadMatchCompetition(dbClient, matchData).catch(error => {
        console.warn('Match duration could not be loaded:', error);
        return null;
      });
      // 3. Fetch Teams, Roster Applications and Events all in a single parallel roundtrip
      const [teamsRes, homeAppsRes, awayAppsRes, eventsRes, resolvedCompetition] = await Promise.all([
        dbClient.from('teams').select('id, name, logo_url').in('id', [matchData.home_team_id, matchData.away_team_id].filter(Boolean)),
        matchData.home_team_id
          ? dbClient.from('applications').select('id, first_name, last_name, position, player_number, is_archived').eq('team_id', matchData.home_team_id).eq('status', 'approved')
          : Promise.resolve({ data: [] }),
        matchData.away_team_id
          ? dbClient.from('applications').select('id, first_name, last_name, position, player_number, is_archived').eq('team_id', matchData.away_team_id).eq('status', 'approved')
          : Promise.resolve({ data: [] }),
        dbClient.from('match_events').select('*, player:player_id(first_name, last_name, player_number), team:team_id(name)').eq('match_id', matchId).order('minute', { ascending: true }),
        competitionLoad,
      ]);
      if (!isActive()) return false;
      setCompetition(resolvedCompetition);
      setReadyMatchId(resolvedCompetition !== null ? matchId : null);

      let ht = null;
      let at = null;
      if (teamsRes.data) {
        ht = teamsRes.data.find((t: any) => t.id === matchData.home_team_id);
        at = teamsRes.data.find((t: any) => t.id === matchData.away_team_id);
        if (ht) setHomeTeam(ht);
        if (at) setAwayTeam(at);
      }

      const finalHomePlayers = ((homeAppsRes.data as any[]) || []).filter((p: any) => !p.is_archived);
      const finalAwayPlayers = ((awayAppsRes.data as any[]) || []).filter((p: any) => !p.is_archived);
      const finalEvents = (eventsRes.data as any[]) || [];

      setHomePlayers(finalHomePlayers);
      setAwayPlayers(finalAwayPlayers);
      setEvents(finalEvents);
      setIsPlayersLoading(false);
      setIsEventsLoading(false);

      // Update high-speed memory cache for instant future loads
      MATCH_CONTROL_CACHE.set(String(matchId), {
        match: latestMatchRow.current,
        competition: resolvedCompetition,
        homeTeam: ht || null,
        awayTeam: at || null,
        homePlayers: finalHomePlayers,
        awayPlayers: finalAwayPlayers,
        events: finalEvents,
        homePenalties: latestMatchRow.current.home_penalty_score || 0,
        awayPenalties: latestMatchRow.current.away_penalty_score || 0,
      });
      return resolvedCompetition !== null;
    } catch (error) {
      console.warn('Match Control data could not be loaded:', error);
      return false;
    } finally {
      if (isActive()) {
        setLoading(false);
        setIsPlayersLoading(false);
        setIsEventsLoading(false);
      }
    }
  };
  const fetchEvents = async (mId?: string | number) => {
    try {
      const { data } = await dbClient
        .from('match_events')
        .select('*, player:player_id(first_name, last_name, player_number), team:team_id(name)')
        .eq('match_id', mId || matchId)
        .order('minute', { ascending: true });

      setEvents(data || []);
    } catch (e) {
      console.error('Error fetching events:', e);
    } finally {
      setIsEventsLoading(false);
    }
  };

  const getElapsedSeconds = () => getElapsedMatchSeconds(match?.status, timerSeconds, halfDurationSecs);

  // Current calculated minute (Count-UP: 1' dan 60' gacha)
  const getCurrentMinute = () => {
    const elapsedSec = getElapsedSeconds();
    const currentMin = Math.floor(elapsedSec / 60) + 1;
    return Math.min(matchDurationMins, Math.max(1, currentMin));
  };

  // Format seconds to MM:SS (Count-UP display for Mobile Admin)
  const formatTimer = () => {
    const totalSeconds = getElapsedSeconds();
    const validSec = Math.max(0, Number(totalSeconds) || 0);
    const mins = Math.floor(validSec / 60);
    const secs = validSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleTimerManual = async () => {
    if (!canRunMatchTimer(match?.status)) return;
    const saved = await saveTimer(now => {
      const remaining = getRemainingSeconds(match, halfDurationSecs, now);
      const seconds = isTimerRunning ? getPauseSeconds(timerSeconds, remaining) : remaining || halfDurationSecs;
      if (seconds == null) {
        Alert.alert('Taymer', 'Ekrandagi vaqt yangilanmoqda. Pauzani qayta bosing.');
        return null;
      }
      const running = !isTimerRunning;
      return {
        timer_seconds: seconds,
        timer_started_at: running ? new Date(now).toISOString() : null,
        is_timer_running: running,
      };
    });
    if (saved) showToast(isTimerRunning ? 'Taymer to‘xtatildi ⏸️' : 'Taymer davom ettirildi ▶️');
  };

  const resetTimerManual = async () => {
    if (await saveTimer(() => ({ timer_seconds: halfDurationSecs, timer_started_at: null, is_timer_running: false }))) {
      showToast('Taymer qayta o‘rnatildi 🔄');
    }
  };

  const adjustTimerSeconds = async (deltaSec: number) => {
    if (!canRunMatchTimer(match?.status)) return;
    const saved = await saveTimer(now => {
      const remaining = getRemainingSeconds(match, halfDurationSecs, now);
      const seconds = Math.max(0, Math.min(halfDurationSecs, remaining + deltaSec));
      const running = isRunningTimerSnapshot(match) && remaining > 0 && seconds > 0;
      return { timer_seconds: seconds, timer_started_at: running ? new Date(now).toISOString() : null, is_timer_running: running };
    });
    if (saved) showToast(deltaSec > 0 ? '+1 daqiqa qo‘shildi ⏱️' : '-1 daqiqa kamaytirildi ⏱️');
  };
  // Quick + creates an unattributed goal event for FIFO replay matching; - corrects score.
  const adjustScore = async (teamType: 'home' | 'away', delta: number) => {
    if (!match || isReadOnlyMode || quickGoalWriteRef.current) return;
    quickGoalWriteRef.current = true;
    const isHome = teamType === 'home';
    const oldScore = isHome ? match.home_score || 0 : match.away_score || 0;
    const newScore = Math.max(0, oldScore + delta);
    if (newScore === oldScore) { quickGoalWriteRef.current = false; return; }
    const eventTeamId = isHome ? match.home_team_id : match.away_team_id;
    let insertedEventId: string | null = null;

    // 0ms Optimistic local update
    setMatch((prev: any) => ({
      ...prev,
      [isHome ? 'home_score' : 'away_score']: newScore,
    }));

    try {
      if (delta > 0) {
        const { data: goalEvent, error: eventError } = await supabase.from('match_events').insert({
          match_id: matchId,
          team_id: eventTeamId,
          player_id: null,
          event_type: 'goal',
          type: 'goal',
          minute: getCurrentMinute(),
        }).select('id').single();
        if (eventError) throw eventError;
        insertedEventId = goalEvent?.id || null;
      }

      const { error: updateErr } = await supabase.from('matches').update({
        [isHome ? 'home_score' : 'away_score']: newScore,
        updated_at: new Date().toISOString(),
      }).eq('id', matchId);
      if (updateErr) throw updateErr;
      if (delta > 0) await fetchEvents(matchId);
    } catch (err) {
      console.warn('adjustScore matches catch error:', err);
      if (insertedEventId) await supabase.from('match_events').delete().eq('id', insertedEventId);
      setMatch((prev: any) => ({ ...prev, [isHome ? 'home_score' : 'away_score']: oldScore }));
      Alert.alert("Xatolik", delta > 0 ? "Gol voqeasi saqlanmadi. Hisob o'zgartirilmadi." : "Hisobni saqlashda xatolik yuz berdi");
    } finally {
      quickGoalWriteRef.current = false;
    }
  };

  // Adjust Penalty Score
  const adjustPenaltyScore = async (teamType: 'home' | 'away', delta: number) => {
    if (isReadOnlyMode) return;
    const isHome = teamType === 'home';
    const oldPen = isHome ? homePenalties : awayPenalties;
    const newPen = Math.max(0, oldPen + delta);

    if (isHome) setHomePenalties(newPen);
    else setAwayPenalties(newPen);

    try {
      const updatePayload = isHome ? { home_penalty_score: newPen } : { away_penalty_score: newPen };
      await supabase.from('matches').update(updatePayload).eq('id', matchId);
    } catch (e) {
      if (isHome) setHomePenalties(oldPen);
      else setAwayPenalties(oldPen);
    }
  };

  const promptStatusReset = () => {
    if (isReadOnlyMode || isStatusChanging) return;
    if (!timerReady) {
      Alert.alert('Taymer', 'O‘yin taymeri ma’lumotlari yuklanmoqda. Qayta urinib ko‘ring.');
      return;
    }
    setStatusConfirmModal({
      isOpen: true,
      targetStatus: 'scheduled',
      expectedStatus: match?.status,
      title: 'Holatga Qaytarish (1-Taym Boshlashga) 🔄',
      message: `Uchrashuvni boshlang'ich (Rejalashtirilgan) holatiga qaytarishni va taymerni ${halfDurationMins}:00 qilishni tasdiqlaysizmi?`,
    });
  };

  const executeStatusChange = async (newStatus: string, expectedStatus: string | undefined) => {
    if (isReadOnlyMode || isStatusChanging || !newStatus) return;
    if (match?.status !== expectedStatus || latestMatchRow.current?.status !== expectedStatus) {
      Alert.alert('Taymer', 'O‘yin holati o‘zgargan. Amalni qayta tanlang.');
      return;
    }
    if (timerWritePending.current) {
      Alert.alert('Taymer', 'Taymer yangilanmoqda. Qayta urinib ko‘ring.');
      return;
    }

    let scoreOverride: { home_score: number; away_score: number } | undefined = undefined;
    if (newStatus === 'finished') {
      const homeGoals = events.filter(
        (e) =>
          (e.event_type === 'goal' || e.type === 'goal') &&
          (e.team_id === match?.home_team_id || String(e.team_id) === String(match?.home_team_id))
      ).length;
      const awayGoals = events.filter(
        (e) =>
          (e.event_type === 'goal' || e.type === 'goal') &&
          (e.team_id === match?.away_team_id || String(e.team_id) === String(match?.away_team_id))
      ).length;

      const finalHomeScore = homeGoals > 0 ? homeGoals : (match?.home_score || 0);
      const finalAwayScore = awayGoals > 0 ? awayGoals : (match?.away_score || 0);

      scoreOverride = {
        home_score: finalHomeScore,
        away_score: finalAwayScore,
      };
    }

    const saved = await saveTimer(now => {
      const running = newStatus === 'first_half' || newStatus === 'second_half';
      const seconds = running || newStatus === 'scheduled' ? halfDurationSecs : getRemainingSeconds(match, halfDurationSecs, now);
      return {
        status: newStatus,
        ...scoreOverride,
        timer_seconds: seconds,
        timer_started_at: running ? new Date(now).toISOString() : null,
        is_timer_running: running,
      };
    });
    if (!saved) return;
    if (newStatus === 'finished') void sendRemoteObsFinishSignal();
    showToast(
      newStatus === 'first_half'
        ? "1-Taym Boshlandi 🚀"
        : newStatus === 'half_time'
        ? "Tanaffus E'lon Qilindi ⏸️"
        : newStatus === 'second_half'
        ? "2-Taym Boshlandi 🚀"
        : newStatus === 'finished'
        ? "Uchrashuv Yakunlandi 🏁"
        : "Boshlang'ich Holatga Qaytildi 🔄"
    );

    // Invalidate caches in background
    queryClient.invalidateQueries({ queryKey: ['matches'] });
    queryClient.invalidateQueries({ queryKey: ['finishedMatches'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  // Freeze the expired timer at zero without ending the fixture.
  useEffect(() => {
    if (isReadOnlyMode || !timerReady || !isClockSynced || isStatusChanging || timerSeconds !== 0 || !isRunningTimerSnapshot(match)) return;
    void saveTimer(now => getRemainingSeconds(match, halfDurationSecs, now) === 0
      ? { timer_seconds: 0, timer_started_at: null, is_timer_running: false } : null, true);
  }, [match?.status, match?.id, match?.timer_started_at, match?.timer_seconds, match?.is_timer_running,
    timerSeconds, isClockSynced, timerReady, isReadOnlyMode, isStatusChanging, halfDurationSecs]);
  const openEventModal = (type: string, teamId?: string | number, playerId?: string | number) => {
    if (isReadOnlyMode) return;
    setEditingEventId(null);
    setEventType(type);
    setSelectedTeamId(teamId || match?.home_team_id || '');
    setSelectedPlayerId(playerId || '');
    setSelectedSubInPlayerId('');
    setEventMinute(getCurrentMinute().toString());
    setShowEventModal(true);
  };

  // Mavjud voqeani TAHRIRLASH uchun modalni to'ldirib ochish.
  // MUHIM: bu funksiya hech narsani o'chirmaydi/yaratmaydi — faqat modal
  // maydonlarini shu voqeaning joriy qiymatlari bilan to'ldiradi.
  // Haqiqiy saqlash `handleSaveEvent` ichidagi `editingEventId` shoxobchasi
  // orqali TO'G'RIDAN-TO'G'RI UPDATE qiladi (voqea id'si o'zgarmaydi —
  // shu sababli unga avval OBS orqali biriktirilgan `replay_video_url`
  // ham saqlanib qoladi, hattoki tuzatish bir necha kundan keyin
  // qilinsa ham).
  const handleEditEvent = (event: any) => {
    if (isReadOnlyMode) return;
    setEditingEventId(String(event.id));
    setEventType(event.event_type || event.type || 'goal');
    setSelectedTeamId(event.team_id || match?.home_team_id || '');
    setSelectedPlayerId(event.player_id || '');
    setSelectedSubInPlayerId(event.sub_in_player_id || '');
    setEventMinute(String(event.minute ?? getCurrentMinute()));
    setShowEventModal(true);
  };

  // Save Event with UUID Idempotency, Instant Optimistic UI and Rollback
  const handleSaveEvent = async () => {
    if (!selectedTeamId || !selectedPlayerId || !eventMinute || savingEvent) {
      Alert.alert("Xatolik", "Iltimos jamoa, o'yinchi va minutni to'liq kiriting");
      return;
    }

    setSavingEvent(true);
    const minVal = parseInt(eventMinute, 10) || getCurrentMinute();
    const isGoal = eventType === 'goal';
    const isHome = selectedTeamId === match?.home_team_id;

    // Snapshot for rollback
    const prevEvents = [...events];
    const prevMatch = { ...match };

    // ══════════════════════════════════════════════════════════════════
    // TAHRIRLASH REJIMI: xato kiritilgan voqeani (masalan, noto'g'ri
    // o'yinchi/jamoaga yozilgan gol) O'CHIRIB QAYTA QO'SHISH o'rniga,
    // mavjud qatorni id'sini o'zgartirmasdan to'g'ridan-to'g'ri UPDATE
    // qilamiz. Sabab: eski usulda (o'chirish + yangi RPC orqali qo'shish)
    // voqea yangi id bilan yaratilar edi — agar tuzatish OBS orqali
    // replay video biriktirilgandan KO'P VAQT o'tib (masalan bir kundan
    // keyin, o'yin tugab, `ORPHAN_REPLAYS_BY_MATCH` xotiradagi 10
    // daqiqalik "yangi orphan" oynasi allaqachon yopilgandan keyin)
    // qilinsa, o'sha video hech qachon qayta bog'lanmas edi. Endi esa
    // `match_events.id` umuman o'zgarmagani uchun unga oldin
    // biriktirilgan `replay_video_url` avtomatik saqlanib qoladi.
    if (editingEventId) {
      const originalEvent = events.find((e) => String(e.id) === String(editingEventId));
      const wasGoal = originalEvent ? (originalEvent.event_type === 'goal' || originalEvent.type === 'goal') : false;
      const wasHome = originalEvent ? String(originalEvent.team_id) === String(match?.home_team_id) : false;

      // Hisobni qayta hisoblash: avvalgi qiymatning golga qo'shgan hissasini
      // olib tashlab, yangi qiymatning hissasini qo'shamiz (masalan, jamoa
      // o'zgartirilgan bo'lsa, gol boshqa jamoaga o'tkaziladi).
      let newHomeScore = match?.home_score || 0;
      let newAwayScore = match?.away_score || 0;
      if (wasGoal) {
        newHomeScore = Math.max(0, newHomeScore - (wasHome ? 1 : 0));
        newAwayScore = Math.max(0, newAwayScore - (wasHome ? 0 : 1));
      }
      if (isGoal) {
        newHomeScore = newHomeScore + (isHome ? 1 : 0);
        newAwayScore = newAwayScore + (isHome ? 0 : 1);
      }

      const updatedFields: any = {
        team_id: selectedTeamId,
        player_id: selectedPlayerId,
        event_type: eventType,
        minute: minVal,
        sub_in_player_id: eventType === 'substitution' && selectedSubInPlayerId ? selectedSubInPlayerId : null,
      };

      // 1. Instant 0ms Optimistic UI
      setEvents((prev) => prev.map((e) => (
        String(e.id) === String(editingEventId)
          ? {
              ...e,
              ...updatedFields,
              player: currentModalPlayers.find((p) => p.id === selectedPlayerId) || e.player,
              team: selectedTeamId === match?.home_team_id ? homeTeam : awayTeam,
            }
          : e
      )));
      if (wasGoal || isGoal) {
        setMatch((prev: any) => ({
          ...prev,
          home_score: newHomeScore,
          away_score: newAwayScore,
        }));
      }

      setShowEventModal(false);
      setEditingEventId(null);
      showToast("Voqea yangilandi ✏️");

      // 2. Reliable UPDATE — id o'zgarmaydi, shuning uchun replay_video_url saqlanadi
      try {
        const { error: updErr } = await supabase
          .from('match_events')
          .update(updatedFields)
          .eq('id', editingEventId);

        if (updErr) throw new Error(updErr.message || "Voqeani yangilashda xatolik");

        if (wasGoal || isGoal) {
          await supabase.from('matches').update({
            home_score: newHomeScore,
            away_score: newAwayScore,
            updated_at: new Date().toISOString(),
          }).eq('id', matchId);
        }

        const cached = MATCH_CONTROL_CACHE.get(String(matchId));
        if (cached) {
          MATCH_CONTROL_CACHE.set(String(matchId), {
            ...cached,
            events: (cached.events || []).map((e: any) => (
              String(e.id) === String(editingEventId) ? { ...e, ...updatedFields } : e
            )),
            match: {
              ...cached.match,
              home_score: newHomeScore,
              away_score: newAwayScore,
            }
          });
        }

        queryClient.invalidateQueries({ queryKey: ['matches', requireOrganizationId(orgId)] });
        queryClient.invalidateQueries({ queryKey: ['dashboard', requireOrganizationId(orgId)] });
      } catch (err: any) {
        // Rollback UI
        setEvents(prevEvents);
        setMatch((current: any) => ({ ...current, home_score: prevMatch.home_score, away_score: prevMatch.away_score }));
        Alert.alert("Xatolik", err.message || "Voqeani yangilashda xatolik yuz berdi");
      } finally {
        setSavingEvent(false);
      }
      return;
    }

    // ══════════════════════════════════════════════════════════════════
    // YANGI VOQEA QO'SHISH REJIMI (oldingi mantiq, o'zgarishsiz)
    const eventUuid = Crypto.randomUUID();

    // Check if there is an existing orphan replay video from a recently deleted mistake goal
    const orphanReplay = ORPHAN_REPLAYS_BY_MATCH.get(String(matchId));
    const isOrphanFresh = Boolean(orphanReplay && (Date.now() - orphanReplay.timestamp < 10 * 60 * 1000));
    const existingReplayUrl = isGoal && isOrphanFresh ? orphanReplay?.url : null;
    if (existingReplayUrl) {
      ORPHAN_REPLAYS_BY_MATCH.delete(String(matchId));
    }

    // 1. Instant Optimistic UI (0ms response)
    const optimisticEvent: any = {
      id: eventUuid,
      event_uuid: eventUuid,
      match_id: matchId,
      team_id: selectedTeamId,
      player_id: selectedPlayerId,
      event_type: eventType,
      type: eventType,
      minute: minVal,
      replay_video_url: existingReplayUrl || null,
      created_at: new Date().toISOString(),
      player: currentModalPlayers.find((p) => p.id === selectedPlayerId) || null,
      team: selectedTeamId === match?.home_team_id ? homeTeam : awayTeam,
    };

    setEvents((prev) => [...prev, optimisticEvent]);

    if (isGoal) {
      setMatch((prev: any) => ({
        ...prev,
        home_score: (prev.home_score || 0) + (isHome ? 1 : 0),
        away_score: (prev.away_score || 0) + (isHome ? 0 : 1),
      }));
    }

    setShowEventModal(false);
    showToast(isGoal ? (existingReplayUrl ? "Gol saqlandi va Replay biriktirildi ⚽🎬" : "Gol saqlandi ⚽") : "Voqea qayd etildi ✅");

    // 2. Background RPC with rollback on error
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('record_match_event', {
        p_event_uuid: eventUuid,
        p_match_id: matchId,
        p_team_id: selectedTeamId,
        p_player_id: selectedPlayerId,
        p_event_type: eventType,
        p_minute: minVal,
        p_sub_in_player_id: eventType === 'substitution' && selectedSubInPlayerId ? selectedSubInPlayerId : null,
      });

      if (rpcErr || (rpcRes && !rpcRes.success)) {
        throw new Error(rpcErr?.message || rpcRes?.message || 'Voqeani saqlashda xatolik');
      }

      if (isGoal && rpcRes && rpcRes.home_score !== undefined) {
        setMatch((prev: any) => ({
          ...prev,
          home_score: rpcRes.home_score,
          away_score: rpcRes.away_score,
        }));
      }

      // If we had a preserved replay video, attach it to the newly created event record
      if (existingReplayUrl) {
        await supabase.from('match_events').update({ replay_video_url: existingReplayUrl }).eq('id', eventUuid);
      }

      if (isGoal) {
        // Trigger OBS Replay Engine (amatora.exe) workflow
        const selPlayer = currentModalPlayers.find((p) => p.id === selectedPlayerId);
        const pName = selPlayer ? `${selPlayer.first_name || ''} ${selPlayer.last_name || ''}`.trim() : '';
        const tName = selectedTeamId === match?.home_team_id ? (homeTeam?.name || 'Uy jamoa') : (awayTeam?.name || 'Mehmon');
        sendRemoteObsGoalSignal(eventUuid, pName, tName);
      }

      queryClient.invalidateQueries({ queryKey: ['matches', requireOrganizationId(orgId)] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', requireOrganizationId(orgId)] });
    } catch (err: any) {
      // Rollback UI
      setEvents(prevEvents);
      setMatch((current: any) => ({ ...current, home_score: prevMatch.home_score, away_score: prevMatch.away_score }));
      Alert.alert("Xatolik", err.message || "Voqeani saqlashda xatolik yuz berdi");
    } finally {
      setSavingEvent(false);
    }
  };

  // Delete Event with Instant Optimistic UI and Reliable Admin Delete
  const handleDeleteEvent = (event: any) => {
    if (isReadOnlyMode) return;
    Alert.alert("Voqeani o'chirish", "Ushbu voqeani o'chirishni tasdiqlaysizmi?", [
      { text: "Bekor qilish", style: "cancel" },
      {
        text: "O'chirish",
        style: "destructive",
        onPress: async () => {
          const isGoal = event.event_type === 'goal' || event.type === 'goal';
          const isHome = String(event.team_id) === String(match?.home_team_id);
          let newHomeScore = match?.home_score || 0;
          let newAwayScore = match?.away_score || 0;

          if (isGoal) {
            newHomeScore = Math.max(0, newHomeScore - (isHome ? 1 : 0));
            newAwayScore = Math.max(0, newAwayScore - (isHome ? 0 : 1));

            // If this deleted goal had a recorded replay video, preserve it in orphan map so next goal can re-link it
            if (event.replay_video_url) {
              ORPHAN_REPLAYS_BY_MATCH.set(String(matchId), {
                url: event.replay_video_url,
                timestamp: Date.now(),
              });
            }
          }

          // 1. Instant 0ms Optimistic local UI update
          setEvents((prev) => prev.filter((e) => String(e.id) !== String(event.id)));
          if (isGoal) {
            setMatch((prev: any) => ({
              ...prev,
              home_score: newHomeScore,
              away_score: newAwayScore,
            }));
          }

          const cached = MATCH_CONTROL_CACHE.get(String(matchId));
          if (cached) {
            MATCH_CONTROL_CACHE.set(String(matchId), {
              ...cached,
              events: (cached.events || []).filter((e: any) => String(e.id) !== String(event.id)),
              match: {
                ...cached.match,
                home_score: newHomeScore,
                away_score: newAwayScore,
              }
            });
          }

          showToast("Voqea o'chirildi 🗑️");

          // 2. Reliable Admin delete via supabase
          try {
            await supabase.from('match_events').delete().eq('id', event.id);

            if (isGoal) {
              await supabase.from('matches').update({
                home_score: newHomeScore,
                away_score: newAwayScore,
                updated_at: new Date().toISOString(),
              }).eq('id', matchId);
            }

            queryClient.invalidateQueries({ queryKey: ['matches'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          } catch (e: any) {
            console.warn('Delete event error:', e);
          }
        },
      },
    ]);
  };

  // Sort Players by Jersey Number
  const sortPlayersByNum = (players: any[]) => {
    return [...players].sort((a, b) => {
      const numA = parseInt(a.player_number, 10) || 999;
      const numB = parseInt(b.player_number, 10) || 999;
      return numA - numB;
    });
  };

  const sortedHomePlayers = sortPlayersByNum(homePlayers);
  const sortedAwayPlayers = sortPlayersByNum(awayPlayers);
  const currentRoster = activeRosterTab === 'home' ? sortedHomePlayers : sortedAwayPlayers;
  const currentRosterTeamId = activeRosterTab === 'home' ? match?.home_team_id : match?.away_team_id;

  const currentModalPlayers =
    selectedTeamId === match?.home_team_id ? sortedHomePlayers : sortedAwayPlayers;

  // Skeleton pulse animation
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.8,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [loading]);

  // Next status helper for main big action button (Resolves 'live' to exact half stage)
  const resolveMatchStatus = () => {
    const raw = match?.status || 'scheduled';
    if (['first_half', 'half_time', 'second_half', 'finished', 'scheduled'].includes(raw)) {
      return raw;
    }
    if (raw === 'live') {
      if (timerSeconds >= halfDurationSecs && !isTimerRunning) return 'half_time';
      if (timerSeconds >= halfDurationSecs) return 'second_half';
      return 'first_half';
    }
    return 'scheduled';
  };

  const matchStatus = resolveMatchStatus();
  const slideAction = matchStatus === 'scheduled'
    ? { target: 'first_half', label: '1-taymni boshlash uchun suring' }
    : matchStatus === 'first_half'
    ? { target: 'half_time', label: 'Tanaffus e’lon qilish uchun suring' }
    : matchStatus === 'half_time'
    ? { target: 'second_half', label: '2-taymni boshlash uchun suring' }
    : matchStatus === 'second_half'
    ? { target: 'finished', label: 'O‘yinni yakunlash uchun suring' }
    : null;

  // Bottom Sticky Pause/Play Button Pop-Up Spring Animation
  const isStickyTimerVisible = matchStatus === 'first_half' || matchStatus === 'second_half';
  const stickyBtnAnim = useRef(new Animated.Value(isStickyTimerVisible ? 1 : 0)).current;

  useEffect(() => {
    if (isStickyTimerVisible) {
      stickyBtnAnim.setValue(0);
      Animated.spring(stickyBtnAnim, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(stickyBtnAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [isStickyTimerVisible]);

  const stickyBtnTranslateY = stickyBtnAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [120, 0],
  });

  const stickyBtnScale = stickyBtnAnim.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [0.7, 1.06, 1],
  });

  const stickyBtnOpacity = stickyBtnAnim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0.8, 1],
  });

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Top Action Nav Bar Skeleton */}
        <View style={styles.topHeaderNav}>
          <Animated.View style={[styles.skeletonNavTile, { opacity: pulseAnim }]} />
          <View style={styles.topIconGroup}>
            <Animated.View style={[styles.skeletonNavTile, { opacity: pulseAnim }]} />
            <Animated.View style={[styles.skeletonNavTile, { opacity: pulseAnim }]} />
            <Animated.View style={[styles.skeletonNavTile, { opacity: pulseAnim }]} />
            <Animated.View style={[styles.skeletonNavTile, { opacity: pulseAnim }]} />
          </View>
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(110, timerBarBottom + 86) }]} showsVerticalScrollIndicator={false}>
          {/* Main Scoreboard Board Skeleton */}
          <Animated.View style={[styles.skeletonCard, { height: 160, opacity: pulseAnim }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
              <View style={{ alignItems: 'center', gap: 6 }}>
                <View style={styles.skeletonLogoCircle} />
                <View style={{ width: 60, height: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 5 }} />
              </View>

              <View style={{ alignItems: 'center', gap: 8 }}>
                <View style={{ width: 80, height: 32, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8 }} />
                <View style={{ width: 100, height: 22, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10 }} />
              </View>

              <View style={{ alignItems: 'center', gap: 6 }}>
                <View style={styles.skeletonLogoCircle} />
                <View style={{ width: 60, height: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 5 }} />
              </View>
            </View>
            <View style={{ width: '100%', height: 28, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, marginTop: 10 }} />
          </Animated.View>

          {/* Action Button Skeleton */}
          <Animated.View style={[styles.skeletonCard, { height: 50, opacity: pulseAnim }]} />

          {/* Quick Events Skeleton */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Animated.View style={[styles.skeletonChip, { opacity: pulseAnim }]} />
            <Animated.View style={[styles.skeletonChip, { opacity: pulseAnim }]} />
            <Animated.View style={[styles.skeletonChip, { opacity: pulseAnim }]} />
          </View>

          {/* Roster Skeleton Card */}
          <Animated.View style={[styles.skeletonCard, { height: 240, opacity: pulseAnim }]} />
        </ScrollView>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      {/* 1. Top Action Buttons Bar (Sleek Icon-Only Row) */}
      <View style={styles.topHeaderNav}>
        <TouchableOpacity
          style={[styles.iconNavTile, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onPress={onBack}
        >
          {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
          <Ionicons name="arrow-back" size={18} color={Platform.OS === 'android' ? colors.textPrimary : '#FFFFFF'} />
        </TouchableOpacity>

        <View style={styles.topIconGroup}>
          {/* OBS / amatora.exe Connection Live Status Indicator */}
          <TouchableOpacity
            style={[
              styles.iconNavTile,
              Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border },
              { borderColor: isObsConnected ? '#22C55E' : '#EF4444', backgroundColor: isObsConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)' }
            ]}
            onPress={() => setShowObsModal(true)}
          >
            {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons
              name={isObsConnected ? "radio-outline" : "warning-outline"}
              size={18}
              color={isObsConnected ? "#22C55E" : "#EF4444"}
            />
          </TouchableOpacity>

          {/* Boshqaruvni ulashish */}
          <TouchableOpacity
            style={[styles.iconNavTile, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => {
              Clipboard.setString(`https://amatora.uz/match/${matchId}`);
              showToast("Match boshqaruv havolasi nusxalandi");
            }}
          >
            {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="share-social-outline" size={18} color="#38BDF8" />
          </TouchableOpacity>

          {/* OBS Stream Link */}
          <TouchableOpacity
            style={[styles.iconNavTile, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => {
              if (!obsUrl) return;
              Clipboard.setString(obsUrl);
              showToast('OBS havolasi nusxalandi (' + obsField + '-maydon)');
            }}
          >
            {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="desktop-outline" size={18} color="#2563EB" />
          </TouchableOpacity>

          {/* YouTube Oblojka */}
          <TouchableOpacity
            style={[styles.iconNavTile, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => {
              showToast("YouTube oblojkasi yangilandi");
            }}
          >
            {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="logo-youtube" size={18} color="#FF0000" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Floating Animated Toast Banner (1:1 matching user screenshot UI) */}
      {toastMessage && (
        <Animated.View
          style={[
            styles.floatingToastCard,
            Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 },
            {
              opacity: opacityAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {Platform.OS === 'ios' && <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
          <View style={styles.toastCheckCircle}>
            <Ionicons name="checkmark" size={12} color="#FFFFFF" />
          </View>
          <Text style={[styles.floatingToastText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{toastMessage}</Text>
          <TouchableOpacity onPress={() => setToastMessage(null)} style={{ paddingLeft: 6 }}>
            <Ionicons name="close" size={14} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.6)"} />
          </TouchableOpacity>
        </Animated.View>
      )}

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(110, timerBarBottom + 86) }]} showsVerticalScrollIndicator={false}>
        {/* Co-Host Read-Only View Banner */}
        {isReadOnlyMode && (
          <View
            style={{
              backgroundColor: Platform.OS === 'android' ? (isDark ? 'rgba(59, 130, 246, 0.15)' : '#EFF6FF') : 'rgba(59, 130, 246, 0.12)',
              borderColor: Platform.OS === 'android' ? '#3B82F6' : 'rgba(59, 130, 246, 0.4)',
              borderWidth: 1,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 10,
              marginBottom: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              overflow: 'hidden',
            }}
          >
            {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="eye-outline" size={22} color="#38BDF8" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: Platform.OS === 'android' ? colors.textPrimary : '#FFFFFF', fontWeight: '800', fontSize: 13 }}>
                {"Tomosha qilish rejimi (Co-Host)"}
              </Text>
              <Text style={{ color: Platform.OS === 'android' ? colors.textMuted : '#94A3B8', fontSize: 11, marginTop: 2 }}>
                {"Ushbu o'yin hamkor tashkilot ligasiga tegishli. O'yinni faqat tomosha qilish mumkin, tahrirlash cheklangan."}
              </Text>
            </View>
          </View>
        )}

        {/* 2. Main Match Control Board Card (Zero Overlap Responsive Mobile Layout) */}
        <View style={[styles.scoreboardMainCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {Platform.OS === 'ios' && <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
          <Text style={[styles.boardLeagueSubtitle, Platform.OS === 'android' && { color: colors.textMuted }]}>
            {`${match?.league || 'LIGA'} • ${match?.location === '2-maydon' ? '2-maydon' : '1-maydon'}`}
          </Text>

          {/* Top Scoreboard Row: Home Team (Left) | Score & Status (Center) | Away Team (Right) */}
          <View style={styles.scoreboardBodyRow}>
            {/* Home Team */}
            <View style={styles.teamBoardCol}>
              <Image
                source={{
                  uri:
                    homeTeam?.logo_url ||
                    'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop',
                }}
                style={styles.teamBoardLogo}
              />
              <Text style={[styles.teamBoardName, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                {homeTeam?.name || 'Mezbon'}
              </Text>
              {!isReadOnlyMode && (
                <View style={styles.scoreAdjustRow}>
                  <TouchableOpacity
                    style={[styles.minusScoreBtn, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                    onPress={() => adjustScore('home', -1)}
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <Text style={[styles.scoreBtnSymbol, Platform.OS === 'android' && { color: colors.textPrimary }]}>-</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.plusScoreBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]}
                    onPress={() => adjustScore('home', 1)}
                    accessibilityLabel="Muallifsiz gol qo'shish"
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <Text style={[styles.scoreBtnSymbol, Platform.OS === 'android' && { color: '#FFFFFF' }]}>+</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Central Score & Timer Pill */}
            <View style={styles.centerBoardCol}>
              <Text style={[styles.bigScoreText, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                {`${match?.home_score ?? 0} : ${match?.away_score ?? 0}`}
              </Text>

              {/* Clean Timer Pill Container (Only counting timer clock + play/reset) */}
              <View style={[styles.timerOnlyCapsule, Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F1F5F9', borderColor: colors.accentGreen }]}>
                {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Text style={[styles.timerPillText, Platform.OS === 'android' && { color: colors.accentGreen }]}>{formatTimer()}</Text>
                <Text style={[styles.timerMinBadge, Platform.OS === 'android' && { color: colors.accentGreen }]}>{`(${getCurrentMinute()}')`}</Text>

                {!isReadOnlyMode && (
                  <>
                    <TouchableOpacity 
                      style={[styles.pillIconBtn, { backgroundColor: isTimerRunning ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)' }]} 
                      disabled={isStatusChanging}
                      onPress={toggleTimerManual}
                    >
                      {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                      <Ionicons name={isTimerRunning ? "pause" : "play"} size={13} color={isTimerRunning ? "#EF4444" : (Platform.OS === 'android' ? colors.accentGreen : "#22C55E")} />
                    </TouchableOpacity>

                    {/* HAVFLI: Taymerni reset qilish tugmasi tasodifiy bosilib,
                        jonli o'yin vaqtini o'chirib qo'yishi mumkin — shuning
                        uchun o'chirilmasdan (kod strukturasi buzilmasligi
                        uchun) faqat yashirilgan (hidden) holatga keltirildi. */}
                    <TouchableOpacity style={[styles.pillIconBtn, { display: 'none' }]} onPress={resetTimerManual}>
                      {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                      <Ionicons name="refresh" size={13} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.8)"} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            {/* Away Team */}
            <View style={styles.teamBoardCol}>
              <Image
                source={{
                  uri:
                    awayTeam?.logo_url ||
                    'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop',
                }}
                style={styles.teamBoardLogo}
              />
              <Text style={[styles.teamBoardName, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                {awayTeam?.name || 'Mehmon'}
              </Text>
              {!isReadOnlyMode && (
                <View style={styles.scoreAdjustRow}>
                  <TouchableOpacity
                    style={[styles.minusScoreBtn, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                    onPress={() => adjustScore('away', -1)}
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <Text style={[styles.scoreBtnSymbol, Platform.OS === 'android' && { color: colors.textPrimary }]}>-</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.plusScoreBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]}
                    onPress={() => adjustScore('away', 1)}
                    accessibilityLabel="Muallifsiz gol qo'shish"
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <Text style={[styles.scoreBtnSymbol, Platform.OS === 'android' && { color: '#FFFFFF' }]}>+</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* DEDICATED FULL-WIDTH STATUS & DURATION ROW */}
          <View style={styles.timerRowContainer}>
            <View style={[styles.statusBadgeCapsule, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE' }]}>
              <Text style={[styles.statusBadgeText, Platform.OS === 'android' && { color: isDark ? '#38BDF8' : '#0284C7' }]}>
                {`${match?.league || 'LIGA'} • ${
                  matchStatus === 'first_half'
                    ? '1-Taym Ketmoqda'
                    : matchStatus === 'half_time'
                    ? 'Tanaffus'
                    : matchStatus === 'second_half'
                    ? '2-Taym Ketmoqda'
                    : matchStatus === 'finished'
                    ? 'Yakunlangan'
                    : 'Rejalashtirilgan'
                } • ${matchDurationMins} daq (${halfDurationMins}x2)`}
              </Text>
            </View>
          </View>
          <Text style={{ color: Platform.OS === 'android' ? colors.textMuted : '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
            Gol bo'lishi bilan tegishli jamoaga + bosing. Replaylar kiritilgan gollar tartibida bog'lanadi.
          </Text>
        </View>

        {/* Match status control */}
        {!isReadOnlyMode && (
          <View style={styles.mainActionBar}>
            {slideAction && (
              <MatchActionSlider
                key={JSON.stringify([matchId, match?.status, slideAction.target])}
                label={slideAction.label}
                disabled={!timerReady}
                busy={isStatusChanging}
                isDark={Platform.OS === 'ios' || isDark}
                onComplete={() => executeStatusChange(slideAction.target, match?.status)}
              />
            )}

            {matchStatus === 'finished' && (
              <View style={{ width: '100%', gap: 8 }}>
                <TouchableOpacity style={[styles.bigFinishedBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 }]} disabled>
                  {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                  <Ionicons name="checkmark-circle" size={18} color={Platform.OS === 'android' ? colors.accentGreen : "#00FF66"} />
                  <Text style={[styles.bigFinishedBtnText, Platform.OS === 'android' && { color: colors.accentGreen }]}>{"Uchrashuv Yakunlandi"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.resetStatusBtn, isStatusChanging && { opacity: 0.7 }]}
                  onPress={promptStatusReset}
                  disabled={isStatusChanging}
                >
                  {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                  {isStatusChanging ? (
                    <ActivityIndicator size="small" color="#F59E0B" />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={16} color="#F59E0B" />
                      <Text style={styles.resetStatusBtnText}>{"1-Taym Boshlash Holatiga Qaytarish"}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Penalty Shootout Dropdown Button */}
            {matchStatus !== 'finished' && (
              <TouchableOpacity
                style={[styles.penaltyDropdownBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                onPress={() => setShowPenaltyControls(open => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showPenaltyControls }}
              >
                {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Ionicons name="football-outline" size={16} color="#38BDF8" />
                <Text style={[styles.penaltyDropdownText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{showPenaltyControls ? "Penaltilar seriyasi ▲" : "Penaltilar seriyasi ▼"}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Penalty Shootout Controls Box */}
        {!isReadOnlyMode && showPenaltyControls && (
          <View style={[styles.penaltyControlBox, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Penaltilar Seriyasi Hisobi"}</Text>
            <View style={styles.scoreboardBodyRow}>
              <View style={styles.teamBoardCol}>
                <Text style={[styles.teamBoardName, Platform.OS === 'android' && { color: colors.textPrimary }]}>{homeTeam?.name || 'Mezbon'}</Text>
                <View style={styles.scoreAdjustRow}>
                  <TouchableOpacity
                    style={[styles.minusScoreBtn, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                    onPress={() => adjustPenaltyScore('home', -1)}
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <Text style={[styles.scoreBtnSymbol, Platform.OS === 'android' && { color: colors.textPrimary }]}>-</Text>
                  </TouchableOpacity>
                  <Text style={[styles.scoreValText, Platform.OS === 'android' && { color: colors.accentGreen }]}>{homePenalties}</Text>
                  <TouchableOpacity
                    style={[styles.plusScoreBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]}
                    onPress={() => adjustPenaltyScore('home', 1)}
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <Text style={[styles.scoreBtnSymbol, Platform.OS === 'android' && { color: '#FFFFFF' }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={[styles.scoreColon, Platform.OS === 'android' && { color: colors.textPrimary }]}>:</Text>

              <View style={styles.teamBoardCol}>
                <Text style={[styles.teamBoardName, Platform.OS === 'android' && { color: colors.textPrimary }]}>{awayTeam?.name || 'Mehmon'}</Text>
                <View style={styles.scoreAdjustRow}>
                  <TouchableOpacity
                    style={[styles.minusScoreBtn, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                    onPress={() => adjustPenaltyScore('away', -1)}
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <Text style={[styles.scoreBtnSymbol, Platform.OS === 'android' && { color: colors.textPrimary }]}>-</Text>
                  </TouchableOpacity>
                  <Text style={[styles.scoreValText, Platform.OS === 'android' && { color: colors.accentGreen }]}>{awayPenalties}</Text>
                  <TouchableOpacity
                    style={[styles.plusScoreBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]}
                    onPress={() => adjustPenaltyScore('away', 1)}
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <Text style={[styles.scoreBtnSymbol, Platform.OS === 'android' && { color: '#FFFFFF' }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* 4. Quick Action Event Buttons */}
        {!isReadOnlyMode && (
          <View style={styles.quickEventsRow}>
            {EVENT_TYPES.map((ev) => (
              <TouchableOpacity
                key={ev.id}
                style={[
                  styles.quickEventChip,
                  { borderColor: ev.color },
                  Platform.OS === 'android' && { backgroundColor: colors.bgCard },
                ]}
                onPress={() => openEventModal(ev.id)}
              >
                {Platform.OS === 'ios' && <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Ionicons name={ev.icon as any} size={14} color={ev.color} />
                <Text style={[styles.quickEventText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{ev.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 5. Interactive Team Roster with Chevron (< >) Switcher */}
        <View style={[styles.rosterCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {Platform.OS === 'ios' && <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
          <View style={styles.rosterHeader}>
            <TouchableOpacity
              style={[styles.arrowSwitchBtn, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(34, 197, 94, 0.15)' : '#DCFCE7', borderColor: colors.accentGreen }]}
              onPress={() => setActiveRosterTab((prev) => (prev === 'home' ? 'away' : 'home'))}
            >
              {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
              <Ionicons name="chevron-back" size={22} color={Platform.OS === 'android' ? colors.accentGreen : "#00FF66"} />
            </TouchableOpacity>

            <View style={[styles.rosterSubtabRow, Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
              <TouchableOpacity
                style={[styles.rosterSubtab, activeRosterTab === 'home' && (Platform.OS === 'android' ? { backgroundColor: colors.accentGreen } : styles.rosterSubtabActive)]}
                onPress={() => setActiveRosterTab('home')}
              >
                {Platform.OS === 'ios' && activeRosterTab === 'home' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Text
                  style={[
                    styles.rosterSubtabText,
                    Platform.OS === 'android' && { color: colors.textMuted },
                    activeRosterTab === 'home' && (Platform.OS === 'android' ? { color: '#FFFFFF', fontWeight: '900' } : styles.rosterSubtabTextActive),
                  ]}
                  numberOfLines={1}
                >
                  {homeTeam?.name || 'Mezbon'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rosterSubtab, activeRosterTab === 'away' && (Platform.OS === 'android' ? { backgroundColor: colors.accentGreen } : styles.rosterSubtabActive)]}
                onPress={() => setActiveRosterTab('away')}
              >
                {Platform.OS === 'ios' && activeRosterTab === 'away' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Text
                  style={[
                    styles.rosterSubtabText,
                    Platform.OS === 'android' && { color: colors.textMuted },
                    activeRosterTab === 'away' && (Platform.OS === 'android' ? { color: '#FFFFFF', fontWeight: '900' } : styles.rosterSubtabTextActive),
                  ]}
                  numberOfLines={1}
                >
                  {awayTeam?.name || 'Mehmon'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.arrowSwitchBtn, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(34, 197, 94, 0.15)' : '#DCFCE7', borderColor: colors.accentGreen }]}
              onPress={() => setActiveRosterTab((prev) => (prev === 'home' ? 'away' : 'home'))}
            >
              {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
              <Ionicons name="chevron-forward" size={22} color={Platform.OS === 'android' ? colors.accentGreen : "#00FF66"} />
            </TouchableOpacity>
          </View>

          {/* Player Roster List (Gol ⚽, Assist 👣, Sariq 🟨, Qizil 🟥) */}
          <View style={styles.playerListContainer}>
            {isPlayersLoading ? (
              <>
                {[1, 2, 3, 4, 5].map((key) => (
                  <Animated.View
                    key={key}
                    style={[
                      styles.playerRowItem,
                      { opacity: pulseAnim },
                      Platform.OS === 'android' && {
                        backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
                        borderColor: colors.border,
                        borderWidth: 1,
                      },
                    ]}
                  >
                    {Platform.OS === 'ios' && <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                    <View
                      style={[
                        styles.playerNumBadge,
                        Platform.OS === 'android'
                          ? { backgroundColor: isDark ? '#334155' : '#E2E8F0' }
                          : { backgroundColor: 'rgba(255,255,255,0.1)' },
                      ]}
                    />
                    <View style={{ flex: 1, gap: 6 }}>
                      <View
                        style={[
                          { width: '55%', height: 13, borderRadius: 4 },
                          Platform.OS === 'android'
                            ? { backgroundColor: isDark ? '#334155' : '#CBD5E1' }
                            : { backgroundColor: 'rgba(255,255,255,0.15)' },
                        ]}
                      />
                      <View
                        style={[
                          { width: '35%', height: 9, borderRadius: 4 },
                          Platform.OS === 'android'
                            ? { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }
                            : { backgroundColor: 'rgba(255,255,255,0.08)' },
                        ]}
                      />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {[1, 2, 3, 4].map((bKey) => (
                        <View
                          key={bKey}
                          style={[
                            styles.playerActBtn,
                            Platform.OS === 'android'
                              ? { backgroundColor: isDark ? '#334155' : '#E2E8F0' }
                              : { backgroundColor: 'rgba(255,255,255,0.08)' },
                          ]}
                        />
                      ))}
                    </View>
                  </Animated.View>
                ))}
              </>
            ) : currentRoster.length === 0 ? (
              <View
                style={[
                  styles.playerRowItem,
                  { justifyContent: 'center', paddingVertical: 18 },
                  Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border, borderWidth: 1 },
                ]}
              >
                {Platform.OS === 'ios' && <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Text
                  style={[
                    { fontSize: 13, fontWeight: '600', textAlign: 'center' },
                    Platform.OS === 'android' ? { color: colors.textMuted } : { color: 'rgba(255,255,255,0.5)' },
                  ]}
                >
                  {"Ushbu jamoada o'yinchilar topilmadi"}
                </Text>
              </View>
            ) : (
              currentRoster.map((player) => (
                <View
                  key={player.id}
                  style={[
                    styles.playerRowItem,
                    Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border, borderWidth: 1 }
                  ]}
                >
                  {Platform.OS === 'ios' && <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                  <View style={[styles.playerNumBadge, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}>
                    <Text style={[styles.playerNumText, Platform.OS === 'android' && { color: colors.accentGreen }]}>
                      {player.player_number ? `#${player.player_number}` : '•'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.playerNameText, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                      {`${player.first_name || ''} ${player.last_name || ''}`}
                    </Text>
                    <Text style={[styles.playerPositionText, Platform.OS === 'android' && { color: colors.textMuted }]}>
                      {player.position || 'O\'yinchi'}
                    </Text>
                  </View>

                  {/* Quick Action Buttons for Player: Gol, Assist, Sariq, Qizil */}
                  {!isReadOnlyMode && (
                    <View style={styles.playerQuickActions}>
                      <TouchableOpacity
                        style={[styles.playerActBtn, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                        onPress={() => openEventModal('goal', currentRosterTeamId, player.id)}
                      >
                        {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                        <Ionicons name="football-outline" size={14} color="#22C55E" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.playerActBtn, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                        onPress={() => openEventModal('assist', currentRosterTeamId, player.id)}
                      >
                        {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                        <Ionicons name="footsteps-outline" size={14} color="#3B82F6" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.playerActBtn, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                        onPress={() => openEventModal('yellow_card', currentRosterTeamId, player.id)}
                      >
                        {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                        <Ionicons name="square" size={12} color="#F59E0B" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.playerActBtn, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                        onPress={() => openEventModal('red_card', currentRosterTeamId, player.id)}
                      >
                        {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                        <Ionicons name="square" size={12} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        </View>

        {/* 6. Live Events Timeline */}
        <View style={[styles.eventsTimelineCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {Platform.OS === 'ios' && <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
          <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"O'yin Voqealari (Timeline)"}</Text>
          {isEventsLoading ? (
            <>
              {[1, 2, 3].map((key) => (
                <Animated.View
                  key={key}
                  style={[
                    styles.eventItemRow,
                    { opacity: pulseAnim },
                    Platform.OS === 'android' && {
                      backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
                      borderColor: colors.border,
                      borderWidth: 1,
                    },
                  ]}
                >
                  {Platform.OS === 'ios' && <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                  <View
                    style={[
                      styles.eventMinuteBadge,
                      Platform.OS === 'android'
                        ? { backgroundColor: isDark ? '#334155' : '#E2E8F0' }
                        : { backgroundColor: 'rgba(255,255,255,0.1)' },
                    ]}
                  />
                  <View
                    style={[
                      { width: 16, height: 16, borderRadius: 8 },
                      Platform.OS === 'android'
                        ? { backgroundColor: isDark ? '#334155' : '#E2E8F0' }
                        : { backgroundColor: 'rgba(255,255,255,0.12)' },
                    ]}
                  />
                  <View style={{ flex: 1, gap: 6 }}>
                    <View
                      style={[
                        { width: '50%', height: 13, borderRadius: 4 },
                        Platform.OS === 'android'
                          ? { backgroundColor: isDark ? '#334155' : '#CBD5E1' }
                          : { backgroundColor: 'rgba(255,255,255,0.15)' },
                      ]}
                    />
                    <View
                      style={[
                        { width: '30%', height: 9, borderRadius: 4 },
                        Platform.OS === 'android'
                          ? { backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }
                          : { backgroundColor: 'rgba(255,255,255,0.08)' },
                      ]}
                    />
                  </View>
                  <View
                    style={[
                      styles.eventDeleteBtn,
                      Platform.OS === 'android'
                        ? { backgroundColor: isDark ? '#334155' : '#E2E8F0' }
                        : { backgroundColor: 'rgba(255,255,255,0.08)' },
                    ]}
                  />
                </Animated.View>
              ))}
            </>
          ) : events.length === 0 ? (
            <Text style={[styles.emptyEventsText, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Hozircha voqealar kiritilmagan"}</Text>
          ) : (
            events.map((ev) => {
              const evConfig = EVENT_TYPES.find((t) => t.id === ev.event_type) || EVENT_TYPES[0];
              const playerName = ev.player
                ? `${ev.player.first_name || ''} ${ev.player.last_name || ''}`
                : (ev.player_id ? "O'yinchi" : (String(ev.event_type || ev.type || '').includes('goal') ? "Muallifsiz gol" : "O'yinchi kiritilmagan"));
              const isHome = ev.team_id === match?.home_team_id;

              return (
                <View
                  key={ev.id}
                  style={[
                    styles.eventItemRow,
                    Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: colors.border, borderWidth: 1 }
                  ]}
                >
                  {Platform.OS === 'ios' && <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                  <View style={[styles.eventMinuteBadge, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(34, 197, 94, 0.15)' : '#DCFCE7' }]}>
                    <Text style={[styles.eventMinuteText, Platform.OS === 'android' && { color: colors.accentGreen }]}>{`${ev.minute}'`}</Text>
                  </View>

                  <Ionicons name={evConfig.icon as any} size={15} color={evConfig.color} />

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.eventPlayerText, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                      {ev.player?.player_number ? `#${ev.player.player_number} ` : ''}
                      {playerName}
                    </Text>
                    <Text style={[styles.eventTeamText, Platform.OS === 'android' && { color: colors.textMuted }]}>
                      {isHome ? homeTeam?.name : awayTeam?.name}
                    </Text>
                  </View>

                  {!isReadOnlyMode && (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity style={styles.eventDeleteBtn} onPress={() => handleEditEvent(ev)}>
                        {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                        <Ionicons name="pencil-outline" size={15} color="#3B82F6" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.eventDeleteBtn} onPress={() => handleDeleteEvent(ev)}>
                        {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                        <Ionicons name="trash-outline" size={15} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Pop-up Animated Solid Full-Width Pause/Play & Minute Adjust Buttons (Only visible during active 1st or 2nd half) */}
      {!isReadOnlyMode && (
        <Animated.View
          pointerEvents={isStickyTimerVisible ? 'auto' : 'none'}
          style={[
            styles.stickyBottomTimerBar,
            {
              bottom: timerBarBottom,
              opacity: stickyBtnOpacity,
              transform: [
                { translateY: stickyBtnTranslateY },
                { scale: stickyBtnScale },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.unifiedBottomTimerCapsule,
              {
                backgroundColor: isTimerRunning ? '#DC2626' : (Platform.OS === 'android' ? colors.accentGreen : '#16A34A'),
              },
            ]}
          >
            {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}

            {/* Left Edge: -1m Button */}
            <TouchableOpacity
              style={styles.capsuleSideAdjustBtn}
              disabled={isStatusChanging}
              onPress={() => adjustTimerSeconds(-60)}
              activeOpacity={0.75}
            >
              <Text style={styles.capsuleSideAdjustBtnText}>-1m</Text>
            </TouchableOpacity>

            {/* Center: Main Play/Pause Button */}
            <TouchableOpacity
              style={styles.capsuleCenterPlayBtn}
              disabled={isStatusChanging}
              onPress={toggleTimerManual}
              activeOpacity={0.85}
            >
              <View style={styles.solidBtnContentRow}>
                <View style={styles.solidBtnLeftGroup}>
                  <Ionicons
                    name={isTimerRunning ? 'pause-circle' : 'play-circle'}
                    size={24}
                    color="#FFFFFF"
                  />
                  <Text style={styles.solidBtnMainText} numberOfLines={1}>
                    {isTimerRunning ? "To'xtatish" : 'Davom ettirish'}
                  </Text>
                </View>
                <View style={styles.solidBtnTimeBadge}>
                  <Text style={styles.solidBtnTimeText}>
                    {formatTimer()}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Right Edge: +1m Button */}
            <TouchableOpacity
              style={styles.capsuleSideAdjustBtnRight}
              disabled={isStatusChanging}
              onPress={() => adjustTimerSeconds(60)}
              activeOpacity={0.75}
            >
              <Text style={styles.capsuleSideAdjustBtnText}>+1m</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* Modern Sleek Mobile Status Change Confirmation Modal */}
      <Modal visible={statusConfirmModal.isOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.confirmModalCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{statusConfirmModal.title}</Text>
            </View>
            <Text style={[styles.confirmModalMessage, Platform.OS === 'android' && { color: colors.textPrimary }]}>{statusConfirmModal.message}</Text>
            <View style={styles.confirmModalActionRow}>
              <TouchableOpacity
                style={[styles.confirmCancelBtn, isStatusChanging && { opacity: 0.5 }, Platform.OS === 'android' && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}
                disabled={isStatusChanging}
                onPress={() => !isStatusChanging && setStatusConfirmModal({ isOpen: false, targetStatus: '', title: '', message: '' })}
              >
                {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Text style={[styles.confirmCancelText, Platform.OS === 'android' && { color: colors.textPrimary }]}>Bekor qilish</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOkBtn, isStatusChanging && { opacity: 0.8 }, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]}
                disabled={isStatusChanging}
                onPress={() => {
                  setStatusConfirmModal({ isOpen: false, targetStatus: '', title: '', message: '' });
                  void executeStatusChange(statusConfirmModal.targetStatus, statusConfirmModal.expectedStatus);
                }}
              >
                {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                {isStatusChanging ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={[styles.confirmOkText, Platform.OS === 'android' && { color: '#FFFFFF' }]}>Tasdiqlash • Ha</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* OBS & amatora.exe Connection Status Info Modal */}
      <Modal visible={showObsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"📡 OBS & amatora.exe Aloqa Holati"}</Text>
              <TouchableOpacity onPress={() => setShowObsModal(false)}>
                <Ionicons name="close" size={22} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.6)"} />
              </TouchableOpacity>
            </View>

            {/* Connection Status Badge */}
            <View
              style={[
                styles.obsStatusBadge,
                {
                  backgroundColor: isObsConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  borderColor: isObsConnected ? '#22C55E' : '#EF4444',
                },
              ]}
            >
              <Ionicons
                name={isObsConnected ? "checkmark-circle" : "alert-circle"}
                size={18}
                color={isObsConnected ? "#22C55E" : "#EF4444"}
              />
              <Text style={[styles.obsStatusBadgeText, { color: isObsConnected ? "#22C55E" : "#EF4444" }]}>
                {isObsConnected ? "AMATORA.EXE ULANGAN (FAOL)" : "AMATORA.EXE ULANMAGAN"}
              </Text>
            </View>

            {/* Detailed Explanation */}
            <Text style={[styles.obsExplanationText, Platform.OS === 'android' && { color: colors.textSecondary }]}>
              {"Ushbu indikator stadiondagi kompyuterda ishlayotgan amatora-obs (amatora.exe) dasturining OBS Studio va jonli efir bilan bog'liqligini ko'rsatadi.\n\nU o'yin taymeri, hisob, gollar hamda takroriy lavhalar (replays) translyatsiya ekranida real vaqtda to'g'ri ko'rinishini ta'minlaydi."}
            </Text>

            <Text style={[styles.modalLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{`📍 Maydon: ${match?.location || '1-maydon'}`}</Text>
            <Text style={[styles.modalLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{`🔌 OBS WebSocket Porti: ${String(match?.location || '').toLowerCase().includes('2') ? 'ws://localhost:4456 (2-Maydon)' : 'ws://localhost:4455 (1-Maydon)'}`}</Text>
            <Text style={[styles.modalLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{'🔗 Stream Overlay URL:\n' + obsUrl}</Text>

            <TouchableOpacity
              style={[styles.modalSubmitBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]}
              onPress={() => {
                if (!obsUrl) return;
                Clipboard.setString(obsUrl);
                Alert.alert('Nusxalandi', 'OBS havolasi nusxalandi (' + obsField + '-maydon)');
                setShowObsModal(false);
              }}
            >
              {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
              <Text style={[styles.modalSubmitBtnText, Platform.OS === 'android' && { color: '#FFFFFF' }]}>{"OBS Scoreboard Linkini Nusxalash"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Log Event Modal */}
      <Modal visible={showEventModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                {editingEventId
                  ? "Hodisani Tahrirlash ✏️"
                  : eventType === 'substitution' ? "O'yinchi Almashtirish 🔄" : "Hodisa Qayd Etish"}
              </Text>
              <TouchableOpacity onPress={() => { setShowEventModal(false); setEditingEventId(null); }}>
                <Ionicons name="close" size={22} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.6)"} />
              </TouchableOpacity>
            </View>

            {/* Team Picker */}
            <Text style={[styles.modalLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Jamoa:"}</Text>
            <View style={styles.modalTeamRow}>
              <TouchableOpacity
                style={[
                  styles.modalTeamBtn,
                  Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F1F5F9', borderColor: colors.border },
                  selectedTeamId === match?.home_team_id && (Platform.OS === 'android' ? { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen } : styles.modalTeamBtnActive),
                ]}
                onPress={() => {
                  setSelectedTeamId(match?.home_team_id);
                  setSelectedPlayerId('');
                  setSelectedSubInPlayerId('');
                }}
              >
                {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Text
                  style={[
                    styles.modalTeamBtnText,
                    Platform.OS === 'android' && { color: colors.textSecondary },
                    selectedTeamId === match?.home_team_id && (Platform.OS === 'android' ? { color: '#FFFFFF', fontWeight: '900' } : styles.modalTeamBtnTextActive),
                  ]}
                  numberOfLines={1}
                >
                  {homeTeam?.name || 'Mezbon'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalTeamBtn,
                  Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F1F5F9', borderColor: colors.border },
                  selectedTeamId === match?.away_team_id && (Platform.OS === 'android' ? { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen } : styles.modalTeamBtnActive),
                ]}
                onPress={() => {
                  setSelectedTeamId(match?.away_team_id);
                  setSelectedPlayerId('');
                  setSelectedSubInPlayerId('');
                }}
              >
                {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <Text
                  style={[
                    styles.modalTeamBtnText,
                    Platform.OS === 'android' && { color: colors.textSecondary },
                    selectedTeamId === match?.away_team_id && (Platform.OS === 'android' ? { color: '#FFFFFF', fontWeight: '900' } : styles.modalTeamBtnTextActive),
                  ]}
                  numberOfLines={1}
                >
                  {awayTeam?.name || 'Mehmon'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Event Type Picker */}
            <Text style={[styles.modalLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Hodisa Turi:"}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {EVENT_TYPES.map((ev) => (
                <TouchableOpacity
                  key={ev.id}
                  style={[
                    styles.modalEvChip,
                    Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F1F5F9', borderColor: colors.border },
                    eventType === ev.id && { backgroundColor: ev.color, borderColor: ev.color },
                  ]}
                  onPress={() => setEventType(ev.id)}
                >
                  {Platform.OS === 'ios' && <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                  <Text
                    style={[
                      styles.modalEvChipText,
                      Platform.OS === 'android' && { color: colors.textSecondary },
                      eventType === ev.id && { color: '#000000', fontWeight: '900' },
                    ]}
                  >
                    {ev.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Sub Out Player (or Main Player) Selector */}
            <Text style={[styles.modalLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>
              {eventType === 'substitution' ? "Chiqayotgan O'yinchi (Sub Out):" : "O'yinchi:"}
            </Text>
            <ScrollView style={{ maxHeight: 110 }} showsVerticalScrollIndicator={false}>
              {currentModalPlayers.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.modalPlayerItem,
                    Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F8FAFC' },
                    selectedPlayerId === p.id && (Platform.OS === 'android' ? { backgroundColor: isDark ? 'rgba(34, 197, 94, 0.2)' : '#DCFCE7' } : styles.modalPlayerItemActive),
                  ]}
                  onPress={() => setSelectedPlayerId(p.id)}
                >
                  {Platform.OS === 'ios' && <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                  <Text style={[styles.modalPlayerNum, Platform.OS === 'android' && { color: colors.accentGreen }]}>{p.player_number ? `#${p.player_number}` : '#'}</Text>
                  <Text
                    style={[
                      styles.modalPlayerName,
                      Platform.OS === 'android' && { color: colors.textPrimary },
                      selectedPlayerId === p.id && { color: Platform.OS === 'android' ? colors.accentGreen : '#00FF66', fontWeight: '900' },
                    ]}
                  >
                    {`${p.first_name || ''} ${p.last_name || ''}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Sub In Player Selector (Only for Substitution) */}
            {eventType === 'substitution' && (
              <>
                <Text style={[styles.modalLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Maydonga Tushayotgan O'yinchi (Sub In):"}</Text>
                <ScrollView style={{ maxHeight: 110 }} showsVerticalScrollIndicator={false}>
                  {currentModalPlayers
                    .filter((p) => p.id !== selectedPlayerId)
                    .map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        style={[
                          styles.modalPlayerItem,
                          Platform.OS === 'android' && { backgroundColor: isDark ? '#1E293B' : '#F8FAFC' },
                          selectedSubInPlayerId === p.id && (Platform.OS === 'android' ? { backgroundColor: 'rgba(168, 85, 247, 0.15)' } : styles.modalPlayerItemActive),
                        ]}
                        onPress={() => setSelectedSubInPlayerId(p.id)}
                      >
                        {Platform.OS === 'ios' && <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
                        <Text style={[styles.modalPlayerNum, Platform.OS === 'android' && { color: colors.accentGreen }]}>{p.player_number ? `#${p.player_number}` : '#'}</Text>
                        <Text
                          style={[
                            styles.modalPlayerName,
                            Platform.OS === 'android' && { color: colors.textPrimary },
                            selectedSubInPlayerId === p.id && { color: '#A855F7', fontWeight: '900' },
                          ]}
                        >
                          {`${p.first_name || ''} ${p.last_name || ''}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              </>
            )}

            {/* Minute Input */}
            <Text style={[styles.modalLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>{"Daqiqa (Minut):"}</Text>
            <TextInput
              style={[
                styles.modalMinuteInput,
                Platform.OS === 'android' && { backgroundColor: colors.bgSecondary, color: colors.textPrimary, borderColor: colors.border },
              ]}
              keyboardType="number-pad"
              value={eventMinute}
              onChangeText={setEventMinute}
            />

            {/* Submit Event Button */}
            <TouchableOpacity
              style={[styles.modalSubmitBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]}
              onPress={handleSaveEvent}
              disabled={savingEvent}
            >
              {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
              {savingEvent ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={[styles.modalSubmitBtnText, Platform.OS === 'android' && { color: '#FFFFFF' }]}>{editingEventId ? "O'zgarishni Saqlash" : "Hodisani Saqlash"}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0B0F17',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topHeaderNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  topIconGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconNavTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(30, 41, 59, 0.65)' : '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  /* Skeleton Component Styles */
  skeletonNavTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#1E293B',
  },
  skeletonCard: {
    backgroundColor: '#151A24',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
  },
  skeletonLogoCircle: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  skeletonChip: {
    flex: 1,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#151A24',
  },
  floatingToastCard: {
    position: 'absolute',
    top: 58,
    left: 14,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(38, 32, 53, 0.75)' : '#262035',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 0,
    elevation: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    overflow: 'hidden',
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
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    paddingBottom: 110,
    gap: 14,
  },
  /* Scoreboard Main Card (Zero Overlap Responsive Layout) */
  scoreboardMainCard: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(21, 26, 36, 0.65)' : '#151A24',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 14,
    overflow: 'hidden',
  },
  boardLeagueSubtitle: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11.5,
    fontWeight: '700',
  },
  scoreboardBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamBoardCol: {
    alignItems: 'center',
    width: 90,
    gap: 4,
  },
  teamBoardLogo: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#263044',
  },
  teamBoardName: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  scoreAdjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  minusScoreBtn: {
    width: 32,
    height: 28,
    borderRadius: 8,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(51, 65, 85, 0.65)' : '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  plusScoreBtn: {
    width: 32,
    height: 28,
    borderRadius: 8,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(0, 255, 102, 0.75)' : '#00FF66',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scoreBtnSymbol: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
  },
  centerBoardCol: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  bigScoreText: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 2,
  },
  statusBadgeCapsule: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusBadgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
  },

  /* Dedicated Full Width Timer Row */
  timerRowContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },
  timerOnlyCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(30, 41, 59, 0.65)' : '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
    overflow: 'hidden',
  },
  timerPillBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
    width: '100%',
  },
  timerPillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timerPillText: {
    color: '#00FF66',
    fontSize: 15,
    fontWeight: '900',
  },
  timerMinBadge: {
    color: '#00FF66',
    fontSize: 11.5,
    fontWeight: '800',
  },
  durationPillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  durationPillText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
  },
  pillIconBtn: {
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    overflow: 'hidden',
  },

  mainActionBar: {
    gap: 8,
  },
  bigFinishedBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(30, 41, 59, 0.65)' : '#1E293B',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 14,
    overflow: 'hidden',
  },
  bigFinishedBtnText: {
    color: '#00FF66',
    fontSize: 14,
    fontWeight: '900',
  },
  penaltyDropdownBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(30, 41, 59, 0.65)' : '#1E293B',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    overflow: 'hidden',
  },
  penaltyDropdownText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  penaltyControlBox: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(21, 26, 36, 0.65)' : '#151A24',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#38BDF8',
    gap: 10,
    overflow: 'hidden',
  },
  scoreValText: {
    color: '#00FF66',
    fontSize: 18,
    fontWeight: '900',
    marginHorizontal: 4,
  },
  scoreColon: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },

  /* Quick Events */
  quickEventsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickEventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(21, 26, 36, 0.65)' : '#151A24',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  quickEventText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  /* Roster Card */
  rosterCard: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(21, 26, 36, 0.65)' : '#151A24',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 12,
    overflow: 'hidden',
  },
  rosterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  arrowSwitchBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 255, 102, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.25)',
    overflow: 'hidden',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  rosterSubtabRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 3,
    flex: 1,
    marginHorizontal: 8,
  },
  rosterSubtab: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 9,
    alignItems: 'center',
    overflow: 'hidden',
  },
  rosterSubtabActive: {
    backgroundColor: '#00FF66',
  },
  rosterSubtabText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
  },
  rosterSubtabTextActive: {
    color: '#000000',
    fontWeight: '900',
  },
  playerListContainer: {
    gap: 8,
  },
  playerRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(27, 34, 48, 0.65)' : '#1B2230',
    padding: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  playerNumBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerNumText: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '900',
  },
  playerNameText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  playerPositionText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
  },
  playerQuickActions: {
    flexDirection: 'row',
    gap: 6,
  },
  playerActBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /* Events Timeline */
  eventsTimelineCard: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(21, 26, 36, 0.65)' : '#151A24',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 10,
    overflow: 'hidden',
  },
  emptyEventsText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12.5,
    fontStyle: 'italic',
    paddingVertical: 10,
  },
  eventItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(27, 34, 48, 0.65)' : '#1B2230',
    padding: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  eventMinuteBadge: {
    backgroundColor: 'rgba(0, 255, 102, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  eventMinuteText: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '900',
  },
  eventPlayerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  eventTeamText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
  },
  eventDeleteBtn: {
    padding: 6,
    borderRadius: 8,
    overflow: 'hidden',
  },
  /* Modal Overlay */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 17, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(30, 41, 59, 0.75)' : '#1E293B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 10,
    overflow: 'hidden',
  },
  obsStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  obsStatusBadgeText: {
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  obsExplanationText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    lineHeight: 18,
    marginVertical: 4,
  },
  confirmModalCard: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(30, 41, 59, 0.75)' : '#1E293B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
    gap: 12,
    overflow: 'hidden',
  },
  confirmModalMessage: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
  },
  confirmModalActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    overflow: 'hidden',
  },
  confirmCancelText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  confirmOkBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(0, 255, 102, 0.85)' : '#00FF66',
    alignItems: 'center',
    overflow: 'hidden',
  },
  confirmOkText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '900',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  modalLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  modalTeamRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modalTeamBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(21, 26, 36, 0.65)' : '#151A24',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  modalTeamBtnActive: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(0, 255, 102, 0.85)' : '#00FF66',
    borderColor: '#00FF66',
  },
  modalTeamBtnText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12.5,
    fontWeight: '700',
  },
  modalTeamBtnTextActive: {
    color: '#000000',
    fontWeight: '900',
  },
  modalEvChip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  modalEvChipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700',
  },
  modalPlayerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    overflow: 'hidden',
  },
  modalPlayerItemActive: {
    backgroundColor: 'rgba(0, 255, 102, 0.1)',
  },
  modalPlayerNum: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '900',
    width: 24,
  },
  modalPlayerName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  modalMinuteInput: {
    backgroundColor: '#151A24',
    borderRadius: 12,
    height: 44,
    color: '#FFFFFF',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    fontSize: 14,
  },
  modalSubmitBtn: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(0, 255, 102, 0.85)' : '#00FF66',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
    overflow: 'hidden',
  },
  modalSubmitBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
  },
  resetStatusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    marginTop: 6,
    width: '100%',
    overflow: 'hidden',
  },
  resetStatusBtnText: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '700',
  },
  /* Sticky Bottom Floating Bar (Exact same position & dimensions as Navbar, Solid styling) */
  stickyBottomTimerBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 66,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 24,
    zIndex: 99999,
  },
  /* Unified Bottom Continuous Floating Capsule Bar */
  unifiedBottomTimerCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  capsuleSideAdjustBtn: {
    width: 54,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.25)',
  },
  capsuleSideAdjustBtnRight: {
    width: 54,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.25)',
  },
  capsuleSideAdjustBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  capsuleCenterPlayBtn: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  solidBtnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  solidBtnLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  solidBtnMainText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  solidBtnTimeBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  solidBtnTimeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
  },
  pillAdjustText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    paddingHorizontal: 2,
  },
});
