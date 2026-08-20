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
import { BlurView } from 'expo-blur';
import * as Crypto from 'expo-crypto';
import { supabase, supabaseAdmin } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  matchId: string | number;
  initialMatch?: any;
  onBack: () => void;
}

const EVENT_TYPES = [
  { id: 'goal', icon: 'football-outline', label: 'Gol', color: '#22C55E' },
  { id: 'assist', icon: 'footsteps-outline', label: 'Assist', color: '#3B82F6' },
  { id: 'yellow_card', icon: 'square', label: 'Sariq kartochka', color: '#F59E0B' },
  { id: 'red_card', icon: 'square', label: 'Qizil kartochka', color: '#EF4444' },
  { id: 'substitution', icon: 'swap-horizontal-outline', label: 'Almashtirish', color: '#A855F7' },
];

// High-speed In-Memory Cache for Match Details & Rosters (Instant 0ms screen re-entry)
const MATCH_CONTROL_CACHE = new Map<string, any>();

export const MatchControlScreen: React.FC<Props> = ({ matchId, initialMatch, onBack }) => {
  const { orgId } = useOrg();
  const cachedData = MATCH_CONTROL_CACHE.get(String(matchId));

  // Match, League & Team Data (Immediate initial render from cache - 0ms delay!)
  const seedMatch = cachedData?.match || initialMatch;
  const [loading, setLoading] = useState(!seedMatch);

  const initialLeagueName = seedMatch?.league ? String(seedMatch.league).trim() : '';
  const initialMatchDur = initialLeagueName.includes('7x7') ? 50 : 60;
  const initialHalfDur = Math.round(initialMatchDur / 2);

  const [match, setMatch] = useState<any>(
    seedMatch
      ? { ...seedMatch, match_duration: seedMatch.match_duration || initialMatchDur, half_duration: seedMatch.half_duration || initialHalfDur }
      : null
  );
  const [leagueData, setLeagueData] = useState<any>(
    cachedData?.leagueData || {
      match_duration: initialMatchDur,
      half_duration: initialHalfDur,
    }
  );
  const [homeTeam, setHomeTeam] = useState<any>(cachedData?.homeTeam || seedMatch?.home_team || null);
  const [awayTeam, setAwayTeam] = useState<any>(cachedData?.awayTeam || seedMatch?.away_team || null);
  const [homePlayers, setHomePlayers] = useState<any[]>(cachedData?.homePlayers || []);
  const [awayPlayers, setAwayPlayers] = useState<any[]>(cachedData?.awayPlayers || []);
  const [events, setEvents] = useState<any[]>(cachedData?.events || []);

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
  const [isObsConnected, setIsObsConnected] = useState(true);

  // Roster subtab ('home' vs 'away')
  const [activeRosterTab, setActiveRosterTab] = useState<'home' | 'away'>('home');

  const getInitialTimerState = (payload: any) => {
    if (!payload) return { baseSec: 1500, isRunning: false, startedAt: null, curSec: 1500 };
    const isRunning =
      payload.is_timer_running !== undefined && payload.is_timer_running !== null
        ? String(payload.is_timer_running) === 'true' || payload.is_timer_running === true
        : payload.isTimerRunning !== undefined && payload.isTimerRunning !== null
        ? String(payload.isTimerRunning) === 'true' || payload.isTimerRunning === true
        : false;

    const startedAt = payload.timer_started_at || payload.timerStartedAt || null;
    const baseSec =
      payload.timer_seconds !== undefined && payload.timer_seconds !== null
        ? Number(payload.timer_seconds)
        : payload.timerSeconds !== undefined && payload.timerSeconds !== null
        ? Number(payload.timerSeconds)
        : 1500;

    let curSec = baseSec;
    if (isRunning && startedAt) {
      const ms = new Date(startedAt).getTime();
      if (!isNaN(ms)) {
        const elapsed = Math.max(0, Math.floor((Date.now() - ms) / 1000));
        curSec = Math.max(0, baseSec - elapsed);
      }
    }
    return { baseSec, isRunning, startedAt, curSec };
  };

  const initialTimer = getInitialTimerState(initialMatch);

  // Live Timer State & Background Sync Refs (1:1 Web Admin MatchControl.jsx logic)
  const [timerSeconds, setTimerSeconds] = useState(initialTimer.curSec);
  const [isTimerRunning, setIsTimerRunning] = useState(initialTimer.isRunning);
  const timerRef = useRef<any>(null);
  const timerStartedAtRef = useRef<string | null>(initialTimer.startedAt);
  const baseTimerSecondsRef = useRef<number>(initialTimer.baseSec);

  // Status Change Custom Confirmation Modal State & Loading State
  const [isStatusChanging, setIsStatusChanging] = useState(false);
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

  const dbClient = supabaseAdmin;

  // Dynamic Match Duration Calculation (From Match -> League -> Sponsors -> Default 50 mins for 7x7)
  const matchDurationMins = Number(
    match?.match_duration ||
    leagueData?.match_duration ||
    (leagueData?.half_duration ? leagueData.half_duration * 2 : 50)
  );
  const halfDurationMins = Number(
    match?.half_duration ||
    leagueData?.half_duration ||
    Math.round(matchDurationMins / 2) ||
    25
  );
  const halfDurationSecs = halfDurationMins * 60;

  // Helper to apply persistent timer payload in countdown mode (25:00 -> 00:00)
  const applyTimerPayload = (payload: any) => {
    if (!payload) return;

    const isRunning =
      payload.is_timer_running !== undefined && payload.is_timer_running !== null
        ? String(payload.is_timer_running) === 'true' || payload.is_timer_running === true
        : payload.isTimerRunning !== undefined && payload.isTimerRunning !== null
        ? String(payload.isTimerRunning) === 'true' || payload.isTimerRunning === true
        : false;

    const startedAt = payload.timer_started_at || payload.timerStartedAt;
    const defaultSec = halfDurationSecs;

    let baseSec =
      payload.timer_seconds !== undefined && payload.timer_seconds !== null
        ? Number(payload.timer_seconds)
        : payload.timerSeconds !== undefined && payload.timerSeconds !== null
        ? Number(payload.timerSeconds)
        : defaultSec;

    if (baseSec === 0 && (payload.status === 'scheduled' || !isRunning)) {
      baseSec = defaultSec;
    }

    setIsTimerRunning(isRunning);
    baseTimerSecondsRef.current = baseSec;
    timerStartedAtRef.current = startedAt || null;

    if (payload.status) {
      setMatch((prev: any) => ({ ...prev, status: payload.status }));
    }

    if (isRunning && startedAt) {
      const startedMs = new Date(startedAt).getTime();
      if (!isNaN(startedMs)) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
        const remaining = Math.max(0, baseSec - elapsedSec);
        setTimerSeconds(remaining);
      } else {
        setTimerSeconds(baseSec);
      }
    } else {
      setTimerSeconds(baseSec);
    }
  };

  // Maps app-level status to DB enum ('scheduled' | 'first_half' | 'half_time' | 'second_half' | 'finished')
  const mapStatusToDB = (appStatus: string): string => {
    return appStatus;
  };

  // INSTANT OPTIMISTIC TIMER UPDATE (RAM update first 0ms, DB sync in background)
  const updateTimerDBAndState = (
    baseSec: number,
    startedAtIso: string | null,
    isRunning: boolean,
    newStatus?: string,
    scoreOverride?: { home_score?: number; away_score?: number; home_penalty_score?: number; away_penalty_score?: number }
  ) => {
    setTimerSeconds(baseSec);
    setIsTimerRunning(isRunning);
    baseTimerSecondsRef.current = baseSec;
    timerStartedAtRef.current = startedAtIso;

    const targetOrgId = match?.organization_id || orgId || 1;
    const nameKey = `MATCH_TIMER_${matchId}`;

    const currentHomeScore = scoreOverride?.home_score ?? match?.home_score ?? 0;
    const currentAwayScore = scoreOverride?.away_score ?? match?.away_score ?? 0;

    const timerPayload: any = {
      timer_seconds: baseSec,
      timer_started_at: startedAtIso,
      is_timer_running: isRunning,
      home_score: currentHomeScore,
      away_score: currentAwayScore,
      updated_at: new Date().toISOString(),
    };
    if (newStatus) {
      timerPayload.status = newStatus;
    }

    // 1. Fast broadcast channel for instant OBS update (0ms latency!)
    try {
      const streamKey = match?.location?.includes('2-maydon') ? 'stream2' : 'stream1';
      supabase.channel(`obs_fast_timer_${matchId}`).send({
        type: 'broadcast',
        event: 'timer_update',
        payload: timerPayload,
      });
      supabase.channel(`obs_fast_${streamKey}`).send({
        type: 'broadcast',
        event: 'timer_update',
        payload: timerPayload,
      });
    } catch (bcErr) {}

    // 2. Non-blocking Background DB Persistence (Zero UI delay!)
    (async () => {
      try {
        const matchUpdate: any = {
          updated_at: new Date().toISOString(),
        };
        if (newStatus) {
          matchUpdate.status = newStatus;
        }
        if (scoreOverride?.home_score !== undefined) {
          matchUpdate.home_score = scoreOverride.home_score;
        }
        if (scoreOverride?.away_score !== undefined) {
          matchUpdate.away_score = scoreOverride.away_score;
        }

        const payloadStr = JSON.stringify(timerPayload);

        await supabaseAdmin
          .from('matches')
          .update(matchUpdate)
          .eq('id', matchId);

        const { data: existingSp } = await supabaseAdmin
          .from('sponsors')
          .select('id')
          .eq('name', nameKey)
          .limit(1);

        if (existingSp && existingSp.length > 0) {
          await supabaseAdmin
            .from('sponsors')
            .update({ logo_url: payloadStr, organization_id: targetOrgId })
            .eq('id', existingSp[0].id);
        } else {
          await supabaseAdmin
            .from('sponsors')
            .insert({ name: nameKey, logo_url: payloadStr, organization_id: targetOrgId });
        }
      } catch (e) {
        console.warn('Background timer sync error:', e);
      }
    })();
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

    // Fast Broadcast Channel for Instant 0ms Timer Sync
    const fastChannel = supabase
      .channel(`obs_fast_timer_${matchId}`)
      .on('broadcast', { event: 'timer_update' }, (msg: any) => {
        if (msg.payload) {
          applyTimerPayload(msg.payload);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(matchChannel);
      supabase.removeChannel(fastChannel);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [matchId, orgId]);

  // Realtime Accurate Countdown Timer Interval (25:00 -> 00:00)
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => {
        if (timerStartedAtRef.current) {
          const startedMs = new Date(timerStartedAtRef.current).getTime();
          if (!isNaN(startedMs)) {
            const elapsedSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
            const remaining = Math.max(0, baseTimerSecondsRef.current - elapsedSec);
            setTimerSeconds(remaining);
            if (remaining === 0) {
              setIsTimerRunning(false);
            }
            return;
          }
        }
        setTimerSeconds((prev) => {
          if (prev <= 1) {
            setIsTimerRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning]);

  const fetchMatchControlData = async () => {
    // Only show blocking loader if we have NO initial match data at all
    if (!match && !initialMatch) setLoading(true);
    try {
      // 1. Fetch match and timer sponsor in parallel
      const [mRes, timerSpRes] = await Promise.all([
        dbClient.from('matches').select('*').eq('id', matchId).single(),
        dbClient
          .from('sponsors')
          .select('name, logo_url')
          .eq('name', `MATCH_TIMER_${matchId}`)
          .order('created_at', { ascending: false })
          .limit(1)
      ]);

      const matchData = mRes.data;
      const timerSpData = timerSpRes.data && timerSpRes.data.length > 0 ? timerSpRes.data[0] : null;

      if (matchData) {
        // 1. Fetch League Data & League Duration (Match -> League -> Sponsors LEAGUE_DURATION)
        let matchDur = Number(matchData.match_duration || matchData.duration || 0) || null;
        let halfDur = Number(matchData.half_duration || 0) || null;
        let lData: any = null;

        if (matchData.league) {
          try {
            const leagueNameTrim = String(matchData.league).trim();
            const targetOrgId = matchData.organization_id || orgId || 1;

            const { data: orgLeague } = await dbClient
              .from('leagues')
              .select('*')
              .eq('organization_id', targetOrgId)
              .ilike('name', leagueNameTrim)
              .maybeSingle();

            lData = orgLeague;
            if (!lData) {
              const { data: fallbackLeague } = await dbClient
                .from('leagues')
                .select('*')
                .ilike('name', leagueNameTrim)
                .maybeSingle();
              lData = fallbackLeague;
            }

            if (lData) {
              if (!matchDur) {
                matchDur = Number(lData.match_duration || lData.duration || lData.match_minutes || 0) || null;
              }
              if (!halfDur) {
                halfDur = Number(lData.half_duration || lData.half_minutes || 0) || null;
              }
            }

            // Check sponsors table for LEAGUE_DURATION_<id> or LEAGUE_DURATION_<name>
            const spKeys = [
              lData?.id ? `LEAGUE_DURATION_${lData.id}` : null,
              `LEAGUE_DURATION_${targetOrgId}_${leagueNameTrim}`,
              `LEAGUE_DURATION_${leagueNameTrim}`,
            ].filter(Boolean) as string[];

            const { data: spDurs } = await dbClient
              .from('sponsors')
              .select('name, logo_url')
              .in('name', spKeys);

            if (spDurs && spDurs.length > 0) {
              const validSp = spDurs.find((s: any) => s.logo_url && !isNaN(Number(s.logo_url)) && Number(s.logo_url) > 0);
              if (validSp) {
                matchDur = Number(validSp.logo_url);
              }
            }
          } catch (lErr) {
            console.warn('Error loading league duration:', lErr);
          }
        }

        if (halfDur && !matchDur) {
          matchDur = halfDur * 2;
        } else if (matchDur && !halfDur) {
          halfDur = Math.round(matchDur / 2);
        }

        const finalMatchDuration = matchDur || (String(matchData.league).includes('7x7') ? 50 : 60);
        const finalHalfDuration = halfDur || Math.round(finalMatchDuration / 2);

        setLeagueData({
          ...(lData || {}),
          match_duration: finalMatchDuration,
          half_duration: finalHalfDuration,
        });

        const mergedMatchData = {
          ...matchData,
          match_duration: finalMatchDuration,
          half_duration: finalHalfDuration,
        };

        setMatch((prev: any) => ({ ...prev, ...mergedMatchData }));

        let loadedTimer = false;
        if (timerSpData?.logo_url) {
          try {
            const parsed = JSON.parse(timerSpData.logo_url);
            applyTimerPayload({ ...mergedMatchData, ...parsed });
            loadedTimer = true;
          } catch (e) {}
        }
        if (!loadedTimer) {
          if (mergedMatchData.status) {
            setMatch((prev: any) => ({ ...prev, status: mergedMatchData.status }));
          }
        }

        if (matchData.home_penalty_score !== undefined && matchData.away_penalty_score !== undefined) {
          setHomePenalties(matchData.home_penalty_score || 0);
          setAwayPenalties(matchData.away_penalty_score || 0);
        }

        // 3. Fetch Teams, Roster Applications and Events all in a single parallel roundtrip
        const [teamsRes, homeAppsRes, awayAppsRes, eventsRes] = await Promise.all([
          dbClient.from('teams').select('id, name, logo_url').in('id', [matchData.home_team_id, matchData.away_team_id].filter(Boolean)),
          matchData.home_team_id
            ? dbClient.from('applications').select('id, first_name, last_name, position, player_number, is_archived').eq('team_id', matchData.home_team_id).eq('status', 'approved')
            : Promise.resolve({ data: [] }),
          matchData.away_team_id
            ? dbClient.from('applications').select('id, first_name, last_name, position, player_number, is_archived').eq('team_id', matchData.away_team_id).eq('status', 'approved')
            : Promise.resolve({ data: [] }),
          dbClient.from('match_events').select('*, player:player_id(first_name, last_name, player_number), team:team_id(name)').eq('match_id', matchId).order('minute', { ascending: true })
        ]);

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

        // Update high-speed memory cache for instant future loads
        MATCH_CONTROL_CACHE.set(String(matchId), {
          match: mergedMatchData,
          leagueData: {
            match_duration: finalMatchDuration,
            half_duration: finalHalfDuration,
          },
          homeTeam: ht || null,
          awayTeam: at || null,
          homePlayers: finalHomePlayers,
          awayPlayers: finalAwayPlayers,
          events: finalEvents,
          homePenalties: matchData.home_penalty_score || 0,
          awayPenalties: matchData.away_penalty_score || 0,
        });
      }
    } catch (e) {
      console.error('Background fetchMatchControlData error:', e);
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

  const queryClient = useQueryClient();

  // Calculate elapsed time (Count-UP: to'g'ri sanash) for Mobile Admin Display
  const getElapsedSeconds = () => {
    if (!match || match.status === 'scheduled' || match.status === 'not_started' || match.status === 'pending') {
      return 0;
    }
    if (match.status === 'half_time' || match.status === 'break') {
      return halfDurationSecs;
    }
    if (match.status === 'second_half' || match.status === 'extra_time') {
      const secondHalfElapsed = Math.max(0, halfDurationSecs - timerSeconds);
      return halfDurationSecs + secondHalfElapsed;
    }
    if (match.status === 'finished') {
      return matchDurationMins * 60;
    }
    // first_half / default
    return Math.max(0, halfDurationSecs - timerSeconds);
  };

  // Current calculated minute (Count-UP: 1' dan 60' gacha)
  const getCurrentMinute = () => {
    const elapsedSec = getElapsedSeconds();
    const currentMin = Math.floor(elapsedSec / 60) + 1;
    return Math.min(matchDurationMins, Math.max(1, currentMin));
  };

  // Format seconds to MM:SS (Count-UP display for Mobile Admin)
  const formatTimer = (rawSeconds?: number) => {
    const totalSeconds = getElapsedSeconds();
    const validSec = Math.max(0, Number(totalSeconds) || 0);
    const mins = Math.floor(validSec / 60);
    const secs = validSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Instant Manual Timer Toggle (Play / Pause 0ms Instant Response!)
  const toggleTimerManual = () => {
    const newRunning = !isTimerRunning;
    let curRemaining = timerSeconds;
    if (curRemaining <= 0) curRemaining = halfDurationSecs;
    const nowIso = newRunning ? new Date().toISOString() : null;

    // 1. Immediate UI flip (0ms - zero delay!)
    setIsTimerRunning(newRunning);
    setTimerSeconds(curRemaining);
    baseTimerSecondsRef.current = curRemaining;
    timerStartedAtRef.current = nowIso;
    showToast(newRunning ? "Taymer davom ettirildi ▶️" : "Taymer to'xtatildi (Pauza) ⏸️");

    // 2. Non-blocking Background persistence
    updateTimerDBAndState(curRemaining, nowIso, newRunning);
  };

  // Instant Reset Timer (0ms RAM response)
  const resetTimerManual = () => {
    updateTimerDBAndState(halfDurationSecs, null, false);
    showToast("Taymer qayta o'rnatildi (Reset) 🔄");
  };

  // Instant Optimistic Score Adjuster (+1 / -1) with Rollback
  const adjustScore = async (teamType: 'home' | 'away', delta: number) => {
    if (!match) return;
    const isHome = teamType === 'home';
    const oldScore = isHome ? match.home_score || 0 : match.away_score || 0;
    const newScore = Math.max(0, oldScore + delta);

    const updatePayload = isHome ? { home_score: newScore } : { away_score: newScore };

    // 0ms Optimistic local update
    setMatch((prev: any) => ({
      ...prev,
      [isHome ? 'home_score' : 'away_score']: newScore,
    }));

    try {
      await supabaseAdmin.from('matches').update(updatePayload).eq('id', matchId);
    } catch (e) {
      console.warn('adjustScore DB update error:', e);
    }
  };

  // Adjust Penalty Score
  const adjustPenaltyScore = async (teamType: 'home' | 'away', delta: number) => {
    const isHome = teamType === 'home';
    const oldPen = isHome ? homePenalties : awayPenalties;
    const newPen = Math.max(0, oldPen + delta);

    if (isHome) setHomePenalties(newPen);
    else setAwayPenalties(newPen);

    try {
      const updatePayload = isHome ? { home_penalty_score: newPen } : { away_penalty_score: newPen };
      await supabaseAdmin.from('matches').update(updatePayload).eq('id', matchId);
    } catch (e) {
      if (isHome) setHomePenalties(oldPen);
      else setAwayPenalties(oldPen);
    }
  };

  // Open Sleek Uzbek Confirmation Modal for Match Status Changes
  const promptStatusChange = (newStatus: string) => {
    let title = "Statusni O'zgartirish";
    let message = "";

    if (newStatus === 'first_half') {
      title = "1-Taymni Boshlash 🚀";
      message = `1-taym boshlanishini tasdiqlaysizmi? (Taymer ${halfDurationMins}:00 dan teskari sanaydi)`;
    } else if (newStatus === 'half_time') {
      title = "Tanaffus E'lon Qilish ⏸️";
      message = `Uchrashuvda tanaffus e'lon qilishni tasdiqlaysizmi?`;
    } else if (newStatus === 'second_half') {
      title = "2-Taymni Boshlash 🚀";
      message = `2-taym boshlanishini tasdiqlaysizmi? (Taymer ${halfDurationMins}:00 dan teskari sanaydi)`;
    } else if (newStatus === 'finished') {
      title = "O'yinni Yakunlash 🏁";
      message = `Uchrashuvni rasman yakunlashni tasdiqlaysizmi?`;
    } else if (newStatus === 'scheduled') {
      title = "Holatga Qaytarish (1-Taym Boshlashga) 🔄";
      message = `Uchrashuvni boshlang'ich (Rejalashtirilgan) holatiga qaytarishni va taymerni ${halfDurationMins}:00 qilishni tasdiqlaysizmi?`;
    }

    setStatusConfirmModal({
      isOpen: true,
      targetStatus: newStatus,
      title,
      message,
    });
  };

  // Execute Status Change
  const executeStatusChange = (overrideStatus?: string) => {
    const newStatus = typeof overrideStatus === 'string' ? overrideStatus : statusConfirmModal.targetStatus;
    if (!newStatus || typeof newStatus !== 'string') return;

    setStatusConfirmModal({ isOpen: false, targetStatus: '', title: '', message: '' });

    let newBaseSec = timerSeconds;
    let newRunning = isTimerRunning;
    let nowIso: string | null = new Date().toISOString();

    if (newStatus === 'first_half') {
      newBaseSec = halfDurationSecs;
      newRunning = true;
      nowIso = new Date().toISOString();
    } else if (newStatus === 'half_time') {
      newBaseSec = timerSeconds;
      newRunning = false;
      nowIso = null;
    } else if (newStatus === 'second_half') {
      newBaseSec = halfDurationSecs;
      newRunning = true;
      nowIso = new Date().toISOString();
    } else if (newStatus === 'finished') {
      newRunning = false;
      nowIso = null;
    } else if (newStatus === 'scheduled') {
      newBaseSec = halfDurationSecs;
      newRunning = false;
      nowIso = null;
    }

    let scoreOverride: any = undefined;
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
        home_penalty_score: homePenalties,
        away_penalty_score: awayPenalties,
      };
    }

    const localUpdateData: any = {
      status: newStatus,
      timer_seconds: newBaseSec,
      timer_started_at: nowIso,
      is_timer_running: newRunning,
      ...(scoreOverride || {}),
    };

    setMatch((prev: any) => ({ ...prev, ...localUpdateData }));
    setIsTimerRunning(newRunning);
    setTimerSeconds(newBaseSec);

    updateTimerDBAndState(newBaseSec, nowIso, newRunning, newStatus, scoreOverride);

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

  // Open Event Modal prefilled
  const openEventModal = (type: string, teamId?: string | number, playerId?: string | number) => {
    setEventType(type);
    setSelectedTeamId(teamId || match?.home_team_id || '');
    setSelectedPlayerId(playerId || '');
    setSelectedSubInPlayerId('');
    setEventMinute(getCurrentMinute().toString());
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
    const eventUuid = Crypto.randomUUID();
    const isGoal = eventType === 'goal';
    const isHome = selectedTeamId === match?.home_team_id;

    // Snapshot for rollback
    const prevEvents = [...events];
    const prevMatch = { ...match };

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
    showToast(isGoal ? "Gol saqlandi ⚽" : "Voqea qayd etildi ✅");

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

      queryClient.invalidateQueries({ queryKey: ['matches', Number(orgId) || 1] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', Number(orgId) || 1] });
    } catch (err: any) {
      // Rollback UI
      setEvents(prevEvents);
      setMatch(prevMatch);
      Alert.alert("Xatolik", err.message || "Voqeani saqlashda xatolik yuz berdi");
    } finally {
      setSavingEvent(false);
    }
  };

  // Delete Event with Instant Optimistic UI and Reliable Admin Delete
  const handleDeleteEvent = (event: any) => {
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

          // 2. Reliable Admin delete via supabaseAdmin
          try {
            await supabaseAdmin.from('match_events').delete().eq('id', event.id);

            if (isGoal) {
              await supabaseAdmin.from('matches').update({
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

                <TouchableOpacity 
                  style={[styles.pillIconBtn, { backgroundColor: isTimerRunning ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)' }]} 
                  onPress={toggleTimerManual}
                >
                  <Ionicons name={isTimerRunning ? "pause" : "play"} size={13} color={isTimerRunning ? "#EF4444" : "#22C55E"} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.pillIconBtn} onPress={resetTimerManual}>
                  <Ionicons name="refresh" size={13} color="rgba(255,255,255,0.8)" />
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
              style={[styles.bigGreenActionBtn, isStatusChanging && { opacity: 0.7 }]}
              onPress={() => promptStatusChange('first_half')}
              disabled={isStatusChanging}
            >
              {isStatusChanging ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="play" size={18} color="#000000" />
                  <Text style={styles.bigGreenBtnText}>{"1-Taym Boshlash"}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {matchStatus === 'first_half' && (
            <TouchableOpacity
              style={[styles.bigOrangeActionBtn, isStatusChanging && { opacity: 0.7 }]}
              onPress={() => promptStatusChange('half_time')}
              disabled={isStatusChanging}
            >
              {isStatusChanging ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="pause" size={18} color="#000000" />
                  <Text style={styles.bigGreenBtnText}>{"Tanaffus e'lon qilish"}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {matchStatus === 'half_time' && (
            <TouchableOpacity
              style={[styles.bigGreenActionBtn, isStatusChanging && { opacity: 0.7 }]}
              onPress={() => promptStatusChange('second_half')}
              disabled={isStatusChanging}
            >
              {isStatusChanging ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="play" size={18} color="#000000" />
                  <Text style={styles.bigGreenBtnText}>{"2-Taym Boshlash"}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {matchStatus === 'second_half' && (
            <TouchableOpacity
              style={[styles.bigRedActionBtn, isStatusChanging && { opacity: 0.7 }]}
              onPress={() => promptStatusChange('finished')}
              disabled={isStatusChanging}
            >
              {isStatusChanging ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="flag" size={18} color="#FFFFFF" />
                  <Text style={styles.bigRedBtnText}>{"O'yinni Yakunlash"}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {matchStatus === 'finished' && (
            <View style={{ width: '100%', gap: 8 }}>
              <TouchableOpacity style={styles.bigFinishedBtn} disabled>
                <Ionicons name="checkmark-circle" size={18} color="#00FF66" />
                <Text style={styles.bigFinishedBtnText}>{"Uchrashuv Yakunlandi"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resetStatusBtn, isStatusChanging && { opacity: 0.7 }]}
                onPress={() => promptStatusChange('scheduled')}
                disabled={isStatusChanging}
              >
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

      {/* Pop-up Animated Solid Full-Width Pause/Play Button (Only visible during active 1st or 2nd half) */}
      <Animated.View
        pointerEvents={isStickyTimerVisible ? 'auto' : 'none'}
        style={[
          styles.stickyBottomTimerBar,
          {
            opacity: stickyBtnOpacity,
            transform: [
              { translateY: stickyBtnTranslateY },
              { scale: stickyBtnScale },
            ],
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.solidTimerFullBtn,
            {
              backgroundColor: isTimerRunning ? '#DC2626' : '#16A34A',
            },
          ]}
          onPress={toggleTimerManual}
          activeOpacity={0.85}
        >
          <View style={styles.solidBtnContentRow}>
            <View style={styles.solidBtnLeftGroup}>
              <Ionicons
                name={isTimerRunning ? 'pause-circle' : 'play-circle'}
                size={26}
                color="#FFFFFF"
              />
              <Text style={styles.solidBtnMainText}>
                {isTimerRunning ? "Vaqtni To'xtatish (Pauza)" : 'Vaqtni Davom Ettirish'}
              </Text>
            </View>
            <View style={styles.solidBtnTimeBadge}>
              <Text style={styles.solidBtnTimeText}>
                {formatTimer(timerSeconds)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>

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
                style={[styles.confirmCancelBtn, isStatusChanging && { opacity: 0.5 }]}
                disabled={isStatusChanging}
                onPress={() => !isStatusChanging && setStatusConfirmModal({ isOpen: false, targetStatus: '', title: '', message: '' })}
              >
                <Text style={styles.confirmCancelText}>Bekor qilish</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOkBtn, isStatusChanging && { opacity: 0.8 }]}
                disabled={isStatusChanging}
                onPress={() => executeStatusChange()}
              >
                {isStatusChanging ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <Text style={styles.confirmOkText}>Tasdiqlash • Ha</Text>
                )}
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
    paddingBottom: 110,
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
  resetStatusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    marginTop: 6,
    width: '100%',
  },
  resetStatusBtnText: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '700',
  },
  /* Sticky Bottom Floating Bar (Exact same position & dimensions as Navbar, Solid styling) */
  stickyBottomTimerBar: {
    position: 'absolute',
    bottom: 24,
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
  solidTimerFullBtn: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    paddingHorizontal: 18,
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
    gap: 10,
    flex: 1,
  },
  solidBtnMainText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  solidBtnTimeBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  solidBtnTimeText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
