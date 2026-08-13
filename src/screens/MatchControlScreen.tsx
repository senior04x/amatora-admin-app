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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, supabaseAdmin } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';

interface Props {
  matchId: string | number;
  onBack: () => void;
}

const EVENT_TYPES = [
  { id: 'goal', icon: 'football-outline', label: 'Gol', color: '#22C55E' },
  { id: 'assist', icon: 'footsteps-outline', label: 'Assist', color: '#3B82F6' },
  { id: 'yellow_card', icon: 'square', label: 'Sariq kartochka', color: '#F59E0B' },
  { id: 'red_card', icon: 'square', label: 'Qizil kartochka', color: '#EF4444' },
  { id: 'substitution', icon: 'swap-horizontal-outline', label: 'Almashtirish', color: '#A855F7' },
];

export const MatchControlScreen: React.FC<Props> = ({ matchId, onBack }) => {
  const { orgId } = useOrg();
  const [loading, setLoading] = useState(true);

  // Match, League & Team Data
  const [match, setMatch] = useState<any>(null);
  const [leagueData, setLeagueData] = useState<any>(null);
  const [homeTeam, setHomeTeam] = useState<any>(null);
  const [awayTeam, setAwayTeam] = useState<any>(null);
  const [homePlayers, setHomePlayers] = useState<any[]>([]);
  const [awayPlayers, setAwayPlayers] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);

  // Penalty Shootout State
  const [showPenaltyControls, setShowPenaltyControls] = useState(false);
  const [homePenalties, setHomePenalties] = useState(0);
  const [awayPenalties, setAwayPenalties] = useState(0);

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
  const [isObsConnected, setIsObsConnected] = useState(true);

  // Roster subtab ('home' vs 'away')
  const [activeRosterTab, setActiveRosterTab] = useState<'home' | 'away'>('home');

  // Live Timer State & Background Sync Refs (1:1 Web Admin MatchControl.jsx logic)
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerRef = useRef<any>(null);
  const timerStartedAtRef = useRef<string | null>(null);
  const baseTimerSecondsRef = useRef<number>(0);

  // Status Change Custom Confirmation Modal State
  const [statusConfirmModal, setStatusConfirmModal] = useState<{
    isOpen: boolean;
    targetStatus: string;
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
  const [savingEvent, setSavingEvent] = useState(false);

  const dbClient = supabaseAdmin || supabase;

  // Dynamic Match Duration Calculation (League duration from DB / Settings or default 90 mins)
  const matchDurationMins = Number(match?.match_duration || leagueData?.match_duration || 90);
  const halfDurationMins = Math.round(matchDurationMins / 2);
  const halfDurationSecs = halfDurationMins * 60;

  // Helper to apply persistent timer payload dynamically (1:1 Web Admin logic)
  const applyTimerPayload = (payload: any) => {
    if (!payload) return;

    let baseSec = 0;
    if (payload.timer_seconds !== undefined && payload.timer_seconds !== null) {
      baseSec = Number(payload.timer_seconds) || 0;
    } else if (payload.timerSeconds !== undefined && payload.timerSeconds !== null) {
      baseSec = Number(payload.timerSeconds) || 0;
    }

    let isRunning = false;
    if (payload.is_timer_running !== undefined && payload.is_timer_running !== null) {
      isRunning = String(payload.is_timer_running) === 'true' || payload.is_timer_running === true;
    } else if (payload.isTimerRunning !== undefined && payload.isTimerRunning !== null) {
      isRunning = String(payload.isTimerRunning) === 'true' || payload.isTimerRunning === true;
    } else if (payload.status === 'first_half' || payload.status === 'second_half' || payload.status === 'live') {
      isRunning = true;
    }

    let startedAt = payload.timer_started_at || payload.timerStartedAt;

    setIsTimerRunning(isRunning);
    baseTimerSecondsRef.current = baseSec;
    timerStartedAtRef.current = startedAt || null;

    if (isRunning && startedAt) {
      const startedMs = new Date(startedAt).getTime();
      if (!isNaN(startedMs)) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
        if (elapsedSec < 14400) {
          setTimerSeconds(baseSec + elapsedSec);
        } else {
          setTimerSeconds(baseSec);
        }
      } else {
        setTimerSeconds(baseSec);
      }
    } else {
      setTimerSeconds(baseSec);
    }
  };

  // INSTANT OPTIMISTIC TIMER UPDATE (RAM update first 0ms, DB sync in background)
  const updateTimerDBAndState = (baseSec: number, startedAtIso: string | null, isRunning: boolean) => {
    // 1. INSTANT RAM state update (0ms latency for mobile responsiveness)
    setTimerSeconds(baseSec);
    setIsTimerRunning(isRunning);
    baseTimerSecondsRef.current = baseSec;
    timerStartedAtRef.current = startedAtIso;

    const timerPayload = {
      timer_seconds: baseSec,
      timer_started_at: startedAtIso,
      is_timer_running: isRunning,
      updated_at: new Date().toISOString(),
    };

    const payloadStr = JSON.stringify(timerPayload);

    // 2. Background DB Async Sync
    setTimeout(async () => {
      try {
        const nameKey = `MATCH_TIMER_${matchId}`;
        const targetOrgId = match?.organization_id || orgId || null;
        const { data: existing } = await dbClient.from('sponsors').select('id').eq('name', nameKey).maybeSingle();
        if (existing) {
          await dbClient.from('sponsors').update({ logo_url: payloadStr, image_url: payloadStr, organization_id: targetOrgId }).eq('id', existing.id);
        } else {
          await dbClient.from('sponsors').insert({ name: nameKey, logo_url: payloadStr, image_url: payloadStr, organization_id: targetOrgId });
        }
      } catch (e) {}

      try {
        await dbClient.from('matches').update({
          timer_seconds: baseSec,
          timer_started_at: startedAtIso,
          is_timer_running: isRunning,
        }).eq('id', matchId);
      } catch (e) {}
    }, 0);
  };

  // 1:1 Realtime Channel Subscription for live cross-device sync
  useEffect(() => {
    fetchMatchControlData();

    // Supabase Realtime Channel
    const matchChannel = supabase
      .channel(`match_control_${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` }, () => {
        fetchEvents(matchId);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (payload: any) => {
        setMatch((prev: any) => ({ ...prev, ...payload.new }));
        if (
          payload.new?.timer_seconds !== undefined ||
          payload.new?.is_timer_running !== undefined ||
          payload.new?.timer_started_at !== undefined
        ) {
          applyTimerPayload(payload.new);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsors', filter: `name=eq.MATCH_TIMER_${matchId}` }, (payload: any) => {
        const record = payload.new || payload.record;
        const jsonStr = record?.logo_url || record?.image_url || record?.url;
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            applyTimerPayload(parsed);
          } catch (e) {}
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(matchChannel);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [matchId, orgId]);

  // Realtime Accurate Timer Interval (Cross-device timestamp calculated)
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => {
        if (timerStartedAtRef.current) {
          const startedMs = new Date(timerStartedAtRef.current).getTime();
          if (!isNaN(startedMs)) {
            const elapsedSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
            setTimerSeconds(baseTimerSecondsRef.current + elapsedSec);
            return;
          }
        }
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning]);

  const fetchMatchControlData = async () => {
    setLoading(true);
    try {
      // 1. Fetch match
      const { data: matchData, error: mErr } = await dbClient
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .single();

      if (mErr || !matchData) {
        Alert.alert("Xatolik", "O'yin ma'lumotlari topilmadi");
        setLoading(false);
        return;
      }

      setMatch(matchData);

      // Fetch persistent timer state from sponsors OR match (1:1 Web Admin logic)
      const { data: timerSp } = await dbClient
        .from('sponsors')
        .select('*')
        .eq('name', `MATCH_TIMER_${matchId}`)
        .maybeSingle();

      let loadedTimer = false;
      if (timerSp) {
        const jsonStr = timerSp.logo_url || timerSp.image_url || timerSp.url;
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            applyTimerPayload({ ...matchData, ...parsed });
            loadedTimer = true;
          } catch (e) {}
        }
      }

      if (!loadedTimer) {
        applyTimerPayload(matchData);
      }

      // Fetch League duration from DB or sponsors key (1:1 Web Admin logic)
      if (matchData.league) {
        try {
          const { data: lData } = await dbClient
            .from('leagues')
            .select('*')
            .ilike('name', matchData.league.trim())
            .maybeSingle();

          let dur = lData?.match_duration;

          if (!dur && lData?.id) {
            const { data: spDur } = await dbClient
              .from('sponsors')
              .select('logo_url')
              .eq('name', `LEAGUE_DURATION_${lData.id}`)
              .maybeSingle();
            if (spDur?.logo_url) dur = Number(spDur.logo_url);
          }

          if (lData) {
            setLeagueData({ ...lData, match_duration: dur || 90 });
          }
        } catch (e) {}
      }

      if (matchData.home_penalty_score !== undefined && matchData.away_penalty_score !== undefined) {
        setHomePenalties(matchData.home_penalty_score || 0);
        setAwayPenalties(matchData.away_penalty_score || 0);
      }

      // 2. Fetch Teams
      const [homeRes, awayRes] = await Promise.all([
        dbClient.from('teams').select('*').eq('id', matchData.home_team_id).single(),
        dbClient.from('teams').select('*').eq('id', matchData.away_team_id).single(),
      ]);

      if (homeRes.data) setHomeTeam(homeRes.data);
      if (awayRes.data) setAwayTeam(awayRes.data);

      // 3. Fetch approved players
      const [hpRes, apRes] = await Promise.all([
        dbClient
          .from('applications')
          .select('id, first_name, last_name, position, player_number')
          .eq('team_id', matchData.home_team_id)
          .eq('status', 'approved'),
        dbClient
          .from('applications')
          .select('id, first_name, last_name, position, player_number')
          .eq('team_id', matchData.away_team_id)
          .eq('status', 'approved'),
      ]);

      setHomePlayers(hpRes.data || []);
      setAwayPlayers(apRes.data || []);

      // 4. Fetch events
      await fetchEvents(matchData.id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
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
    }
  };

  // Current calculated minute
  const getCurrentMinute = () => {
    const min = Math.floor(timerSeconds / 60) + 1;
    return Math.max(1, min);
  };

  // Format seconds to MM:SS
  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Instant Manual Timer Toggle (0ms RAM response)
  const toggleTimerManual = () => {
    const newRunning = !isTimerRunning;
    const nowIso = newRunning ? new Date().toISOString() : null;
    updateTimerDBAndState(timerSeconds, nowIso, newRunning);
  };

  // Instant Reset Timer (0ms RAM response)
  const resetTimerManual = () => {
    const defaultSec = match?.status === 'second_half' ? halfDurationSecs : 0;
    updateTimerDBAndState(defaultSec, null, false);
  };

  // Instant Optimistic Score Adjuster (+1 / -1)
  const adjustScore = (teamType: 'home' | 'away', delta: number) => {
    if (!match) return;
    const isHome = teamType === 'home';
    const currentScore = isHome ? match.home_score || 0 : match.away_score || 0;
    const newScore = Math.max(0, currentScore + delta);

    const updatePayload = isHome ? { home_score: newScore } : { away_score: newScore };

    // 0ms Optimistic local update
    setMatch((prev: any) => ({
      ...prev,
      [isHome ? 'home_score' : 'away_score']: newScore,
    }));

    // Background DB sync
    setTimeout(async () => {
      try {
        await dbClient.from('matches').update(updatePayload).eq('id', matchId);
      } catch (e) {}
    }, 0);
  };

  // Instant Optimistic Penalty Score Adjuster (+1 / -1)
  const adjustPenaltyScore = (teamType: 'home' | 'away', delta: number) => {
    if (!match) return;
    const isHome = teamType === 'home';
    const currentPen = isHome ? homePenalties : awayPenalties;
    const newPen = Math.max(0, currentPen + delta);

    if (isHome) setHomePenalties(newPen);
    else setAwayPenalties(newPen);

    const updatePayload = isHome ? { home_penalty_score: newPen } : { away_penalty_score: newPen };
    setTimeout(async () => {
      try {
        await dbClient.from('matches').update(updatePayload).eq('id', matchId);
      } catch (e) {}
    }, 0);
  };

  // Open Sleek Uzbek Confirmation Modal for Match Status Changes
  const promptStatusChange = (newStatus: string) => {
    let title = "Statusni O'zgartirish";
    let message = "";

    if (newStatus === 'first_half') {
      title = "1-Taymni Boshlash 🚀";
      message = `1-taym boshlanishini tasdiqlaysizmi? (${halfDurationMins} daqiqalik taym)`;
    } else if (newStatus === 'half_time') {
      title = "Tanaffus E'lon Qilish ⏸️";
      message = `Uchrashuvda tanaffus e'lon qilishni tasdiqlaysizmi?`;
    } else if (newStatus === 'second_half') {
      title = "2-Taymni Boshlash 🚀";
      message = `2-taym boshlanishini tasdiqlaysizmi? (Taymer ${halfDurationMins}-daqiqadan davom etadi)`;
    } else if (newStatus === 'finished') {
      title = "O'yinni Yakunlash 🏁";
      message = `Uchrashuvni rasman yakunlashni tasdiqlaysizmi?`;
    }

    setStatusConfirmModal({
      isOpen: true,
      targetStatus: newStatus,
      title,
      message,
    });
  };

  // Confirm Status Change Execution
  const executeStatusChange = async () => {
    const newStatus = statusConfirmModal.targetStatus;
    setStatusConfirmModal({ isOpen: false, targetStatus: '', title: '', message: '' });

    let newBaseSec = timerSeconds;
    let newRunning = isTimerRunning;
    let nowIso: string | null = new Date().toISOString();

    if (newStatus === 'first_half') {
      newBaseSec = 0;
      newRunning = true;
      nowIso = new Date().toISOString();
    } else if (newStatus === 'half_time') {
      newBaseSec = timerSeconds < halfDurationSecs ? halfDurationSecs : timerSeconds;
      newRunning = false;
      nowIso = null;
    } else if (newStatus === 'second_half') {
      newBaseSec = timerSeconds < halfDurationSecs ? halfDurationSecs : timerSeconds;
      newRunning = true;
      nowIso = new Date().toISOString();
    } else if (newStatus === 'finished') {
      newRunning = false;
      nowIso = null;
    }

    const updateData: any = {
      status: newStatus,
      timer_seconds: newBaseSec,
      timer_started_at: nowIso,
      is_timer_running: newRunning,
    };

    updateTimerDBAndState(newBaseSec, nowIso, newRunning);
    setMatch((prev: any) => ({ ...prev, ...updateData }));

    try {
      await dbClient.from('matches').update(updateData).eq('id', matchId);
    } catch (e) {}
  };

  // Open Event Modal prefilled
  const openEventModal = (type: string, teamId?: string | number, playerId?: string | number) => {
    setEventType(type);
    setSelectedTeamId(teamId || match?.home_team_id || '');
    setSelectedPlayerId(playerId || '');
    setSelectedSubInPlayerId('');
    setEventMinute(getCurrentMinute().toString());
    setShowEventModal(true);
  };

  // Save Event
  const handleSaveEvent = async () => {
    if (!selectedTeamId || !selectedPlayerId || !eventMinute || savingEvent) {
      Alert.alert("Xatolik", "Iltimos jamoa, o'yinchi va minutni to'liq kiriting");
      return;
    }

    setSavingEvent(true);
    try {
      const minVal = parseInt(eventMinute, 10) || getCurrentMinute();

      const { data: inserted, error } = await dbClient
        .from('match_events')
        .insert([
          {
            match_id: matchId,
            team_id: selectedTeamId,
            player_id: selectedPlayerId,
            event_type: eventType,
            minute: minVal,
          },
        ])
        .select();

      if (error) throw error;

      // If substitution, record sub-in event if subInPlayerId selected
      if (eventType === 'substitution' && selectedSubInPlayerId) {
        await dbClient.from('match_events').insert([
          {
            match_id: matchId,
            team_id: selectedTeamId,
            player_id: selectedSubInPlayerId,
            event_type: 'substitution_in',
            minute: minVal,
          },
        ]);
      }

      // If goal, auto increment score
      if (eventType === 'goal') {
        const isHome = selectedTeamId === match.home_team_id;
        const newHomeScore = (match.home_score || 0) + (isHome ? 1 : 0);
        const newAwayScore = (match.away_score || 0) + (isHome ? 0 : 1);

        await dbClient
          .from('matches')
          .update({ home_score: newHomeScore, away_score: newAwayScore })
          .eq('id', matchId);

        setMatch((prev: any) => ({ ...prev, home_score: newHomeScore, away_score: newAwayScore }));
      }

      await fetchEvents();
      setShowEventModal(false);
    } catch (err: any) {
      Alert.alert("Xatolik", err.message || "Voqeani saqlashda xatolik");
    } finally {
      setSavingEvent(false);
    }
  };

  // Delete Event
  const handleDeleteEvent = (event: any) => {
    Alert.alert("Voqeani o'chirish", "Ushbu voqeani o'chirishni tasdiqlaysizmi?", [
      { text: "Bekor qilish", style: "cancel" },
      {
        text: "O'chirish",
        style: "destructive",
        onPress: async () => {
          setEvents((prev) => prev.filter((e) => e.id !== event.id));
          try {
            await dbClient.from('match_events').delete().eq('id', event.id);
            if (event.event_type === 'goal') {
              const isHome = event.team_id === match.home_team_id;
              const newHomeScore = Math.max(0, (match.home_score || 0) - (isHome ? 1 : 0));
              const newAwayScore = Math.max(0, (match.away_score || 0) - (isHome ? 0 : 1));

              await dbClient
                .from('matches')
                .update({ home_score: newHomeScore, away_score: newAwayScore })
                .eq('id', matchId);

              setMatch((prev: any) => ({ ...prev, home_score: newHomeScore, away_score: newAwayScore }));
            }
            fetchEvents();
          } catch (e) {}
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

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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

  // Next status helper for main big action button
  const matchStatus = match?.status || 'scheduled';

  return (
    <View style={styles.container}>
      {/* 1. Top Action Buttons Bar (Sleek Icon-Only Row) */}
      <View style={styles.topHeaderNav}>
        <TouchableOpacity style={styles.iconNavTile} onPress={onBack}>
          <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.topIconGroup}>
          {/* OBS / amatora.exe Connection Live Status Indicator */}
          <TouchableOpacity
            style={[
              styles.iconNavTile,
              { borderColor: isObsConnected ? '#22C55E' : '#EF4444', backgroundColor: isObsConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)' }
            ]}
            onPress={() => setShowObsModal(true)}
          >
            <Ionicons
              name={isObsConnected ? "radio-outline" : "warning-outline"}
              size={18}
              color={isObsConnected ? "#22C55E" : "#EF4444"}
            />
          </TouchableOpacity>

          {/* Boshqaruvni ulashish */}
          <TouchableOpacity
            style={styles.iconNavTile}
            onPress={() => {
              Clipboard.setString(`https://amatora.uz/match/${matchId}`);
              showToast("Match boshqaruv havolasi nusxalandi");
            }}
          >
            <Ionicons name="share-social-outline" size={18} color="#38BDF8" />
          </TouchableOpacity>

          {/* OBS Stream Link */}
          <TouchableOpacity
            style={styles.iconNavTile}
            onPress={() => {
              const obsUrl = `https://amatora.uz/obs/scoreboard/${match?.location?.includes('2-maydon') ? 'stream2' : 'stream1'}?org_id=${orgId || 1}`;
              Clipboard.setString(obsUrl);
              showToast(`OBS Stream URL (${match?.location || '1-maydon'}) nusxalandi`);
            }}
          >
            <Ionicons name="desktop-outline" size={18} color="#2563EB" />
          </TouchableOpacity>

          {/* YouTube Oblojka */}
          <TouchableOpacity
            style={styles.iconNavTile}
            onPress={() => {
              showToast("YouTube oblojkasi yangilandi");
            }}
          >
            <Ionicons name="logo-youtube" size={18} color="#FF0000" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Floating Animated Toast Banner (1:1 matching user screenshot UI) */}
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

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 2. Main Match Control Board Card (Zero Overlap Responsive Mobile Layout) */}
        <View style={styles.scoreboardMainCard}>
          <Text style={styles.boardLeagueSubtitle}>{`${match?.league || 'LIGA'} • ${match?.location === '2-maydon' ? '2-maydon' : '1-maydon'}`}</Text>

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
              <Text style={styles.teamBoardName} numberOfLines={1}>
                {homeTeam?.name || 'Mezbon'}
              </Text>
              <View style={styles.scoreAdjustRow}>
                <TouchableOpacity style={styles.minusScoreBtn} onPress={() => adjustScore('home', -1)}>
                  <Text style={styles.scoreBtnSymbol}>-</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.plusScoreBtn} onPress={() => adjustScore('home', 1)}>
                  <Text style={styles.scoreBtnSymbol}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Central Score & Timer Pill */}
            <View style={styles.centerBoardCol}>
              <Text style={styles.bigScoreText}>{`${match?.home_score ?? 0} : ${match?.away_score ?? 0}`}</Text>

              {/* Clean Timer Pill Container (Only counting timer clock + play/reset) */}
              <View style={styles.timerOnlyCapsule}>
                <Ionicons name="time-outline" size={14} color="#00FF66" />
                <Text style={styles.timerPillText}>{formatTimer(timerSeconds)}</Text>
                <Text style={styles.timerMinBadge}>{`(${getCurrentMinute()}')`}</Text>

                <TouchableOpacity style={styles.pillIconBtn} onPress={toggleTimerManual}>
                  <Ionicons name={isTimerRunning ? "pause" : "play"} size={13} color="#FFFFFF" />
                </TouchableOpacity>

                <TouchableOpacity style={styles.pillIconBtn} onPress={resetTimerManual}>
                  <Ionicons name="refresh" size={13} color="#FFFFFF" />
                </TouchableOpacity>
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
              <Text style={styles.teamBoardName} numberOfLines={1}>
                {awayTeam?.name || 'Mehmon'}
              </Text>
              <View style={styles.scoreAdjustRow}>
                <TouchableOpacity style={styles.minusScoreBtn} onPress={() => adjustScore('away', -1)}>
                  <Text style={styles.scoreBtnSymbol}>-</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.plusScoreBtn} onPress={() => adjustScore('away', 1)}>
                  <Text style={styles.scoreBtnSymbol}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* DEDICATED FULL-WIDTH STATUS & DURATION ROW */}
          <View style={styles.timerRowContainer}>
            <View style={styles.statusBadgeCapsule}>
              <Text style={styles.statusBadgeText}>
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
        </View>

        {/* 3. Dynamic Status Control Action Bar (1:1 Web Admin Screenshot matching) */}
        <View style={styles.mainActionBarRow}>
          {matchStatus === 'scheduled' && (
            <TouchableOpacity
              style={styles.bigGreenActionBtn}
              onPress={() => promptStatusChange('first_half')}
            >
              <Ionicons name="play" size={18} color="#000000" />
              <Text style={styles.bigGreenBtnText}>{"1-Taym Boshlash"}</Text>
            </TouchableOpacity>
          )}

          {matchStatus === 'first_half' && (
            <TouchableOpacity
              style={styles.bigOrangeActionBtn}
              onPress={() => promptStatusChange('half_time')}
            >
              <Ionicons name="pause" size={18} color="#000000" />
              <Text style={styles.bigGreenBtnText}>{"Tanaffus e'lon qilish"}</Text>
            </TouchableOpacity>
          )}

          {matchStatus === 'half_time' && (
            <TouchableOpacity
              style={styles.bigGreenActionBtn}
              onPress={() => promptStatusChange('second_half')}
            >
              <Ionicons name="play" size={18} color="#000000" />
              <Text style={styles.bigGreenBtnText}>{"2-Taym Boshlash"}</Text>
            </TouchableOpacity>
          )}

          {matchStatus === 'second_half' && (
            <TouchableOpacity
              style={styles.bigRedActionBtn}
              onPress={() => promptStatusChange('finished')}
            >
              <Ionicons name="flag" size={18} color="#FFFFFF" />
              <Text style={styles.bigRedBtnText}>{"O'yinni Yakunlash"}</Text>
            </TouchableOpacity>
          )}

          {matchStatus === 'finished' && (
            <TouchableOpacity style={styles.bigFinishedBtn} disabled>
              <Ionicons name="checkmark-circle" size={18} color="#00FF66" />
              <Text style={styles.bigFinishedBtnText}>{"Uchrashuv Yakunlandi"}</Text>
            </TouchableOpacity>
          )}

          {/* Penalty Shootout Dropdown Button */}
          <TouchableOpacity
            style={styles.penaltyDropdownBtn}
            onPress={() => setShowPenaltyControls(!showPenaltyControls)}
          >
            <Ionicons name="football-outline" size={16} color="#38BDF8" />
            <Text style={styles.penaltyDropdownText}>{"Penaltilar seriyasi ▼"}</Text>
          </TouchableOpacity>
        </View>

        {/* Penalty Shootout Controls Box */}
        {showPenaltyControls && (
          <View style={styles.penaltyControlBox}>
            <Text style={styles.sectionTitle}>{"Penaltilar Seriyasi Hisobi"}</Text>
            <View style={styles.scoreboardBodyRow}>
              <View style={styles.teamBoardCol}>
                <Text style={styles.teamBoardName}>{homeTeam?.name || 'Mezbon'}</Text>
                <View style={styles.scoreAdjustRow}>
                  <TouchableOpacity style={styles.minusScoreBtn} onPress={() => adjustPenaltyScore('home', -1)}>
                    <Text style={styles.scoreBtnSymbol}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.scoreValText}>{homePenalties}</Text>
                  <TouchableOpacity style={styles.plusScoreBtn} onPress={() => adjustPenaltyScore('home', 1)}>
                    <Text style={styles.scoreBtnSymbol}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.scoreColon}>:</Text>

              <View style={styles.teamBoardCol}>
                <Text style={styles.teamBoardName}>{awayTeam?.name || 'Mehmon'}</Text>
                <View style={styles.scoreAdjustRow}>
                  <TouchableOpacity style={styles.minusScoreBtn} onPress={() => adjustPenaltyScore('away', -1)}>
                    <Text style={styles.scoreBtnSymbol}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.scoreValText}>{awayPenalties}</Text>
                  <TouchableOpacity style={styles.plusScoreBtn} onPress={() => adjustPenaltyScore('away', 1)}>
                    <Text style={styles.scoreBtnSymbol}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* 4. Quick Action Event Buttons */}
        <View style={styles.quickEventsRow}>
          {EVENT_TYPES.map((ev) => (
            <TouchableOpacity
              key={ev.id}
              style={[styles.quickEventChip, { borderColor: ev.color }]}
              onPress={() => openEventModal(ev.id)}
            >
              <Ionicons name={ev.icon as any} size={14} color={ev.color} />
              <Text style={styles.quickEventText}>{ev.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 5. Interactive Team Roster with Chevron (< >) Switcher */}
        <View style={styles.rosterCard}>
          <View style={styles.rosterHeader}>
            <TouchableOpacity
              style={styles.arrowSwitchBtn}
              onPress={() => setActiveRosterTab((prev) => (prev === 'home' ? 'away' : 'home'))}
            >
              <Ionicons name="chevron-back" size={22} color="#00FF66" />
            </TouchableOpacity>

            <View style={styles.rosterSubtabRow}>
              <TouchableOpacity
                style={[styles.rosterSubtab, activeRosterTab === 'home' && styles.rosterSubtabActive]}
                onPress={() => setActiveRosterTab('home')}
              >
                <Text
                  style={[
                    styles.rosterSubtabText,
                    activeRosterTab === 'home' && styles.rosterSubtabTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {homeTeam?.name || 'Mezbon'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rosterSubtab, activeRosterTab === 'away' && styles.rosterSubtabActive]}
                onPress={() => setActiveRosterTab('away')}
              >
                <Text
                  style={[
                    styles.rosterSubtabText,
                    activeRosterTab === 'away' && styles.rosterSubtabTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {awayTeam?.name || 'Mehmon'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.arrowSwitchBtn}
              onPress={() => setActiveRosterTab((prev) => (prev === 'home' ? 'away' : 'home'))}
            >
              <Ionicons name="chevron-forward" size={22} color="#00FF66" />
            </TouchableOpacity>
          </View>

          {/* Player Roster List (Gol ⚽, Assist 👣, Sariq 🟨, Qizil 🟥) */}
          <View style={styles.playerListContainer}>
            {currentRoster.map((player) => (
              <View key={player.id} style={styles.playerRowItem}>
                <View style={styles.playerNumBadge}>
                  <Text style={styles.playerNumText}>{player.player_number ? `#${player.player_number}` : '•'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerNameText}>
                    {`${player.first_name || ''} ${player.last_name || ''}`}
                  </Text>
                  <Text style={styles.playerPositionText}>{player.position || 'O\'yinchi'}</Text>
                </View>

                {/* Quick Action Buttons for Player: Gol, Assist, Sariq, Qizil */}
                <View style={styles.playerQuickActions}>
                  <TouchableOpacity
                    style={styles.playerActBtn}
                    onPress={() => openEventModal('goal', currentRosterTeamId, player.id)}
                  >
                    <Ionicons name="football-outline" size={14} color="#22C55E" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.playerActBtn}
                    onPress={() => openEventModal('assist', currentRosterTeamId, player.id)}
                  >
                    <Ionicons name="footsteps-outline" size={14} color="#3B82F6" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.playerActBtn}
                    onPress={() => openEventModal('yellow_card', currentRosterTeamId, player.id)}
                  >
                    <Ionicons name="square" size={12} color="#F59E0B" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.playerActBtn}
                    onPress={() => openEventModal('red_card', currentRosterTeamId, player.id)}
                  >
                    <Ionicons name="square" size={12} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* 6. Live Events Timeline */}
        <View style={styles.eventsTimelineCard}>
          <Text style={styles.sectionTitle}>{"O'yin Voqealari (Timeline)"}</Text>
          {events.length === 0 ? (
            <Text style={styles.emptyEventsText}>{"Hozircha voqealar kiritilmagan"}</Text>
          ) : (
            events.map((ev) => {
              const evConfig = EVENT_TYPES.find((t) => t.id === ev.event_type) || EVENT_TYPES[0];
              const playerName = ev.player
                ? `${ev.player.first_name || ''} ${ev.player.last_name || ''}`
                : "O'yinchi";
              const isHome = ev.team_id === match?.home_team_id;

              return (
                <View key={ev.id} style={styles.eventItemRow}>
                  <View style={styles.eventMinuteBadge}>
                    <Text style={styles.eventMinuteText}>{`${ev.minute}'`}</Text>
                  </View>

                  <Ionicons name={evConfig.icon as any} size={15} color={evConfig.color} />

                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventPlayerText}>
                      {ev.player?.player_number ? `#${ev.player.player_number} ` : ''}
                      {playerName}
                    </Text>
                    <Text style={styles.eventTeamText}>
                      {isHome ? homeTeam?.name : awayTeam?.name}
                    </Text>
                  </View>

                  <TouchableOpacity style={styles.eventDeleteBtn} onPress={() => handleDeleteEvent(ev)}>
                    <Ionicons name="trash-outline" size={15} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Modern Sleek Mobile Status Change Confirmation Modal */}
      <Modal visible={statusConfirmModal.isOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{statusConfirmModal.title}</Text>
            </View>
            <Text style={styles.confirmModalMessage}>{statusConfirmModal.message}</Text>
            <View style={styles.confirmModalActionRow}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setStatusConfirmModal({ isOpen: false, targetStatus: '', title: '', message: '' })}
              >
                <Text style={styles.confirmCancelText}>Bekor qilish</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOkBtn} onPress={executeStatusChange}>
                <Text style={styles.confirmOkText}>Tasdiqlash • Ha</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* OBS & amatora.exe Connection Status Info Modal */}
      <Modal visible={showObsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{"📡 OBS & amatora.exe Aloqa Holati"}</Text>
              <TouchableOpacity onPress={() => setShowObsModal(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
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
            <Text style={styles.obsExplanationText}>
              {"Ushbu indikator stadiondagi kompyuterda ishlayotgan amatora-obs (amatora.exe) dasturining OBS Studio va jonli efir bilan bog'liqligini ko'rsatadi.\n\nU o'yin taymeri, hisob, gollar hamda takroriy lavhalar (replays) translyatsiya ekranida real vaqtda to'g'ri ko'rinishini ta'minlaydi."}
            </Text>

            <Text style={styles.modalLabel}>{`📍 Maydon: ${match?.location || '1-maydon'}`}</Text>
            <Text style={styles.modalLabel}>{`🔌 OBS WebSocket Porti: ${match?.location?.includes('2-maydon') ? 'ws://localhost:4456 (2-Maydon)' : 'ws://localhost:4455 (1-Maydon)'}`}</Text>
            <Text style={styles.modalLabel}>{`🔗 Stream Overlay URL:\nhttps://amatora.uz/obs/scoreboard/${match?.location?.includes('2-maydon') ? 'stream2' : 'stream1'}?org_id=${orgId || 1}`}</Text>

            <TouchableOpacity
              style={styles.modalSubmitBtn}
              onPress={() => {
                Clipboard.setString(`https://amatora.uz/obs/scoreboard/${match?.location?.includes('2-maydon') ? 'stream2' : 'stream1'}?org_id=${orgId || 1}`);
                Alert.alert("Nusxalandi", "OBS Stream Scoreboard havolasi nusxalandi!");
                setShowObsModal(false);
              }}
            >
              <Text style={styles.modalSubmitBtnText}>{"OBS Scoreboard Linkini Nusxalash"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Log Event Modal */}
      <Modal visible={showEventModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {eventType === 'substitution' ? "O'yinchi Almashtirish 🔄" : "Hodisa Qayd Etish"}
              </Text>
              <TouchableOpacity onPress={() => setShowEventModal(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            {/* Team Picker */}
            <Text style={styles.modalLabel}>{"Jamoa:"}</Text>
            <View style={styles.modalTeamRow}>
              <TouchableOpacity
                style={[
                  styles.modalTeamBtn,
                  selectedTeamId === match?.home_team_id && styles.modalTeamBtnActive,
                ]}
                onPress={() => {
                  setSelectedTeamId(match?.home_team_id);
                  setSelectedPlayerId('');
                  setSelectedSubInPlayerId('');
                }}
              >
                <Text
                  style={[
                    styles.modalTeamBtnText,
                    selectedTeamId === match?.home_team_id && styles.modalTeamBtnTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {homeTeam?.name || 'Mezbon'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalTeamBtn,
                  selectedTeamId === match?.away_team_id && styles.modalTeamBtnActive,
                ]}
                onPress={() => {
                  setSelectedTeamId(match?.away_team_id);
                  setSelectedPlayerId('');
                  setSelectedSubInPlayerId('');
                }}
              >
                <Text
                  style={[
                    styles.modalTeamBtnText,
                    selectedTeamId === match?.away_team_id && styles.modalTeamBtnTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {awayTeam?.name || 'Mehmon'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Event Type Picker */}
            <Text style={styles.modalLabel}>{"Hodisa Turi:"}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {EVENT_TYPES.map((ev) => (
                <TouchableOpacity
                  key={ev.id}
                  style={[
                    styles.modalEvChip,
                    eventType === ev.id && { backgroundColor: ev.color, borderColor: ev.color },
                  ]}
                  onPress={() => setEventType(ev.id)}
                >
                  <Text
                    style={[
                      styles.modalEvChipText,
                      eventType === ev.id && { color: '#000000', fontWeight: '900' },
                    ]}
                  >
                    {ev.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Sub Out Player (or Main Player) Selector */}
            <Text style={styles.modalLabel}>
              {eventType === 'substitution' ? "Chiqayotgan O'yinchi (Sub Out):" : "O'yinchi:"}
            </Text>
            <ScrollView style={{ maxHeight: 110 }} showsVerticalScrollIndicator={false}>
              {currentModalPlayers.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.modalPlayerItem,
                    selectedPlayerId === p.id && styles.modalPlayerItemActive,
                  ]}
                  onPress={() => setSelectedPlayerId(p.id)}
                >
                  <Text style={styles.modalPlayerNum}>{p.player_number ? `#${p.player_number}` : '#'}</Text>
                  <Text
                    style={[
                      styles.modalPlayerName,
                      selectedPlayerId === p.id && { color: '#00FF66', fontWeight: '900' },
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
                <Text style={styles.modalLabel}>{"Maydonga Tushayotgan O'yinchi (Sub In):"}</Text>
                <ScrollView style={{ maxHeight: 110 }} showsVerticalScrollIndicator={false}>
                  {currentModalPlayers
                    .filter((p) => p.id !== selectedPlayerId)
                    .map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        style={[
                          styles.modalPlayerItem,
                          selectedSubInPlayerId === p.id && styles.modalPlayerItemActive,
                        ]}
                        onPress={() => setSelectedSubInPlayerId(p.id)}
                      >
                        <Text style={styles.modalPlayerNum}>{p.player_number ? `#${p.player_number}` : '#'}</Text>
                        <Text
                          style={[
                            styles.modalPlayerName,
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
            <Text style={styles.modalLabel}>{"Daqiqa (Minut):"}</Text>
            <TextInput
              style={styles.modalMinuteInput}
              keyboardType="number-pad"
              value={eventMinute}
              onChangeText={setEventMinute}
            />

            {/* Submit Event Button */}
            <TouchableOpacity
              style={styles.modalSubmitBtn}
              onPress={handleSaveEvent}
              disabled={savingEvent}
            >
              {savingEvent ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <Text style={styles.modalSubmitBtnText}>{"Hodisani Saqlash"}</Text>
              )}
            </TouchableOpacity>
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
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
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
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    paddingBottom: 130,
    gap: 14,
  },
  /* Scoreboard Main Card (Zero Overlap Responsive Layout) */
  scoreboardMainCard: {
    backgroundColor: '#151A24',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 14,
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
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusScoreBtn: {
    width: 32,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#00FF66',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
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
  },

  /* Action Bar under scoreboard (Matching Web Admin Screenshot 1:1) */
  mainActionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bigGreenActionBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FF66',
    paddingVertical: 14,
    borderRadius: 16,
  },
  bigOrangeActionBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F59E0B',
    paddingVertical: 14,
    borderRadius: 16,
  },
  bigRedActionBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EF4444',
    paddingVertical: 14,
    borderRadius: 16,
  },
  bigFinishedBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    paddingVertical: 14,
    borderRadius: 16,
  },
  bigGreenBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
  },
  bigRedBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  bigFinishedBtnText: {
    color: '#00FF66',
    fontSize: 14,
    fontWeight: '900',
  },
  penaltyDropdownBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  penaltyDropdownText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  penaltyControlBox: {
    backgroundColor: '#151A24',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#38BDF8',
    gap: 10,
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
    backgroundColor: '#151A24',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickEventText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  /* Roster Card */
  rosterCard: {
    backgroundColor: '#151A24',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 12,
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
    backgroundColor: '#1B2230',
    padding: 10,
    borderRadius: 12,
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
  },
  /* Events Timeline */
  eventsTimelineCard: {
    backgroundColor: '#151A24',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242C3D',
    gap: 10,
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
    backgroundColor: '#1B2230',
    padding: 10,
    borderRadius: 12,
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
  },
  /* Modal Overlay */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 17, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 10,
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
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
    gap: 12,
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
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
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
    backgroundColor: '#00FF66',
    alignItems: 'center',
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
    backgroundColor: '#151A24',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalTeamBtnActive: {
    backgroundColor: '#00FF66',
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
    backgroundColor: '#00FF66',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  modalSubmitBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
  },
});
