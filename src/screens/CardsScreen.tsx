import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  Animated,
  Pressable,
} from 'react-native';
import { BlurView } from '../components/SafeBlurView';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';

const DEFAULT_AVATAR =
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
const DEFAULT_TEAM_LOGO =
  'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop&q=80';

interface CardPlayer {
  id: string | number;
  name: string;
  photoUrl?: string;
  playerNumber?: string;
  teamId?: string | number;
  teamName: string;
  teamLogo?: string;
  yellowCards: number;
  redCards: number;
  totalCards: number;
}

// Skeleton Loader Component for Cards
const CardItemSkeleton: React.FC = () => {
  const { isDark, colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);

  const blockBg = Platform.OS === 'android'
    ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
    : 'rgba(255,255,255,0.08)';

  return (
    <Animated.View
      style={[
        styles.cardItem,
        Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border },
        { opacity }
      ]}
    >
      {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />}
      
      <View style={styles.playerLeftRow}>
        <View style={{ width: 18, height: 14, backgroundColor: blockBg, borderRadius: 4 }} />
        <View style={[styles.avatar, { backgroundColor: blockBg, borderColor: 'transparent' }]} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ width: '60%', height: 14, backgroundColor: blockBg, borderRadius: 4 }} />
          <View style={{ width: '40%', height: 10, backgroundColor: blockBg, borderRadius: 4 }} />
        </View>
      </View>

      <View style={styles.cardsBadgesContainer}>
        <View style={{ width: 32, height: 28, borderRadius: 6, backgroundColor: blockBg }} />
        <View style={{ width: 32, height: 28, borderRadius: 6, backgroundColor: blockBg }} />
      </View>
    </Animated.View>
  );
};

export const CardsScreen: React.FC<{ onGoBack?: () => void }> = ({ onGoBack }) => {
  const { orgId, currentOrg, collabLeagueNames, collabLeagueIds } = useOrg();
  const { isDark, colors } = useTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [showLeagueModal, setShowLeagueModal] = useState(false);

  const [selectedRound, setSelectedRound] = useState<string>('all');
  const [showRoundModal, setShowRoundModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [teams, setTeams] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [playersList, setPlayersList] = useState<any[]>([]);

  // Pagination
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Player detail modal
  const [selectedPlayer, setSelectedPlayer] = useState<CardPlayer | null>(null);
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [modalEvents, setModalEvents] = useState<any[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  // PDF Export Modal State
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfLeague, setPdfLeague] = useState<string>('all');
  const [pdfRound, setPdfRound] = useState<string>('all');
  const [pdfTeamId, setPdfTeamId] = useState<string>('all');
  const [pdfSubPicker, setPdfSubPicker] = useState<'league' | 'round' | 'team' | null>(null);

  useEffect(() => {
    fetchLeaguesAndData();
  }, [orgId, collabLeagueIds]);

  const fetchLeaguesAndData = async () => {
    setLoading(true);
    try {
      const dbClient = supabase;
      let query = dbClient.from('leagues').select('id, name, organization_id').order('name');
      if (orgId) {
        if (collabLeagueIds && collabLeagueIds.length > 0) {
          query = query.or(`organization_id.eq.${orgId},id.in.(${collabLeagueIds.join(',')})`);
        } else {
          query = query.eq('organization_id', orgId);
        }
      }
      const { data: leaguesData } = await query;
      const loadedLeagues = leaguesData || [];
      setLeagues(loadedLeagues);

      await loadCardsData();
    } catch (e) {
      console.error('Error fetching leagues in CardsScreen:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadCardsData = async () => {
    try {
      const dbClient = supabase;

      // 1. Fetch Teams (Lightweight)
      let teamsQuery = dbClient.from('teams').select('id, name, logo_url, league');
      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          teamsQuery = teamsQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          teamsQuery = teamsQuery.eq('organization_id', orgId);
        }
      }
      const { data: teamsData } = await teamsQuery;
      setTeams(teamsData || []);

      // 2. Fetch Matches (Lightweight for round options and league filter)
      let matchesQuery = dbClient.from('matches').select('id, round, league, organization_id');
      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          matchesQuery = matchesQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          matchesQuery = matchesQuery.eq('organization_id', orgId);
        }
      }
      const { data: matchesData } = await matchesQuery;
      setMatches(matchesData || []);

      // 3. Fetch Events (Lightweight: NO deep joins upfront!)
      const { data: eventsData, error: eventsError } = await dbClient
        .from('match_events')
        .select('id, event_type, player_id, team_id, match_id')
        .in('event_type', ['yellow_card', 'red_card']);

      let loadedEvents: any[] = eventsData || [];
      setEvents(loadedEvents);

      // 4. Fetch Players for fallback info & photos (Lightweight)
      const eventPlayerIds = loadedEvents.map((e: any) => e.player_id).filter(Boolean);
      const uniquePlayerIds = Array.from(new Set(eventPlayerIds));

      const combinedPlayers: any[] = [];
      if (uniquePlayerIds.length > 0) {
        try {
          const [appsRes, playersRes] = await Promise.all([
            dbClient.from('applications').select('id, first_name, last_name, player_number, photo_url, team_id').in('id', uniquePlayerIds),
            dbClient.from('players').select('id, first_name, last_name, player_number, photo_url, team_id').in('id', uniquePlayerIds),
          ]);
          if (appsRes.data) combinedPlayers.push(...appsRes.data);
          if (playersRes.data) combinedPlayers.push(...playersRes.data);
        } catch (e) {}
      }

      setPlayersList(combinedPlayers);
    } catch (err) {
      console.error('Error fetching cards data:', err);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLeaguesAndData();
  }, [orgId, collabLeagueIds]);

  // Lookup Maps
  const matchMap = useMemo(() => {
    const map = new Map();
    matches.forEach((m) => {
      if (m.id) {
        map.set(m.id, m);
        map.set(String(m.id), m);
      }
    });
    return map;
  }, [matches]);

  const teamMap = useMemo(() => {
    const map = new Map();
    teams.forEach((t) => {
      if (t.id !== undefined && t.id !== null) {
        map.set(t.id, t);
        map.set(String(t.id), t);
      }
    });
    return map;
  }, [teams]);

  const playerAppMap = useMemo(() => {
    const map = new Map();
    playersList.forEach((p) => {
      if (p.id) {
        map.set(String(p.id), p);
        map.set(Number(p.id), p);
      }
    });
    return map;
  }, [playersList]);

  // Helper to extract integer round number from various formats (e.g. 1, "1", "1-tur", "1 - tur", "Tur 1")
  const parseRoundNumber = (val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const match = String(val).match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  // Dynamic available rounds from actual DB data (matches + events join + teams)
  const roundOptions = useMemo(() => {
    const roundSet = new Set<number>();
    const isAll = !selectedLeague || selectedLeague === 'all';
    const sel = isAll ? '' : selectedLeague.toLowerCase().trim();

    // 1. Extract from matches table
    matches.forEach((m) => {
      const matchLeague = String(m.league || '').toLowerCase().trim();
      const homeLeague = String(teamMap.get(m.home_team_id)?.league || '').toLowerCase().trim();
      const awayLeague = String(teamMap.get(m.away_team_id)?.league || '').toLowerCase().trim();
      const isLeagueMatch = isAll || matchLeague.includes(sel) || sel.includes(matchLeague) || homeLeague.includes(sel) || awayLeague.includes(sel);

      if (isLeagueMatch) {
        const r = parseRoundNumber(m.round || m.tour);
        if (r > 0) roundSet.add(r);
      }
    });

    // 2. Extract from events -> match join (more reliable when matches RLS blocks direct query)
    events.forEach((e) => {
      const eventMatch = e.match || matchMap.get(e.match_id);
      const eventTeam = teamMap.get(e.team_id) || e.team;
      const teamLeague = String(eventTeam?.league || eventMatch?.league || '').toLowerCase().trim();
      if (isAll || teamLeague.includes(sel) || sel.includes(teamLeague)) {
        const evRound = parseRoundNumber(eventMatch?.round || eventMatch?.tour);
        if (evRound > 0) roundSet.add(evRound);
      }
    });

    // 3. If a specific league has no match rounds found yet, look across all matches
    if (roundSet.size === 0 && matches.length > 0) {
      matches.forEach((m) => {
        const r = parseRoundNumber(m.round || m.tour);
        if (r > 0) roundSet.add(r);
      });
    }

    const sortedRounds = Array.from(roundSet).sort((a, b) => a - b);
    const list: string[] = ['all'];
    sortedRounds.forEach((r) => list.push(String(r)));
    return list;
  }, [matches, events, selectedLeague, teamMap, matchMap]);

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedLeague, selectedRound, searchQuery]);

  // Aggregated Card Players
  const cardPlayers = useMemo(() => {
    const cardMap = new Map<string, CardPlayer>();

    events.forEach((e) => {
      if (!e.player_id) return;
      if (e.event_type !== 'yellow_card' && e.event_type !== 'red_card') return;

      const eventTeam = teamMap.get(e.team_id) || e.team;
      const teamLeague = String(eventTeam?.league || e.match?.league || '').toLowerCase().trim();

      // League Filter
      if (selectedLeague && selectedLeague !== 'all') {
        const sel = selectedLeague.toLowerCase().trim();
        if (!teamLeague.includes(sel) && !sel.includes(teamLeague)) return;
      }

      // Round Filter
      if (selectedRound && selectedRound !== 'all') {
        const targetRoundNum = parseInt(selectedRound, 10);
        const evRoundRaw =
          e.match?.round !== undefined && e.match?.round !== null
            ? e.match.round
            : e.match?.tour !== undefined && e.match?.tour !== null
            ? e.match.tour
            : matchMap.get(e.match_id)?.round || matchMap.get(e.match_id)?.tour;
        const evRoundNum = parseRoundNumber(evRoundRaw);
        if (evRoundNum > 0 && evRoundNum !== targetRoundNum) return;
      }

      const pId = String(e.player_id);
      if (!cardMap.has(pId)) {
        const appInfo = playerAppMap.get(e.player_id) || playerAppMap.get(String(e.player_id)) || playerAppMap.get(Number(e.player_id));
        const pObj = e.player || {};

        const firstName = pObj.first_name || appInfo?.first_name || '';
        const lastName = pObj.last_name || appInfo?.last_name || '';
        const fullName =
          pObj.full_name ||
          appInfo?.full_name ||
          `${firstName} ${lastName}`.trim() ||
          pObj.name ||
          appInfo?.name ||
          "Noma'lum o'yinchi";

        const photoUrl =
          pObj.photo_url ||
          pObj.photo ||
          pObj.avatar_url ||
          pObj.image_url ||
          appInfo?.photo_url ||
          appInfo?.photo ||
          appInfo?.avatar_url ||
          appInfo?.image_url ||
          '';

        const playerNumber =
          pObj.player_number ||
          pObj.number ||
          appInfo?.player_number ||
          appInfo?.number ||
          '';

        cardMap.set(pId, {
          id: pId,
          name: fullName,
          photoUrl: photoUrl || '',
          playerNumber: playerNumber ? `#${playerNumber}` : '',
          teamId: e.team_id,
          teamName: eventTeam?.name || "Noma'lum jamoa",
          teamLogo: eventTeam?.logo_url || '',
          yellowCards: 0,
          redCards: 0,
          totalCards: 0,
        });
      }

      const existing = cardMap.get(pId)!;
      if (e.event_type === 'yellow_card') {
        existing.yellowCards += 1;
        existing.totalCards += 1;
      } else if (e.event_type === 'red_card') {
        existing.redCards += 1;
        existing.totalCards += 1;
      }
    });

    let list = Array.from(cardMap.values());

    // Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.teamName.toLowerCase().includes(q) ||
          (p.playerNumber ? p.playerNumber.includes(q) : false)
      );
    }

    // Sort: Red Cards DESC, then Yellow Cards DESC, then Name ASC
    list.sort((a, b) => {
      if (b.redCards !== a.redCards) return b.redCards - a.redCards;
      if (b.yellowCards !== a.yellowCards) return b.yellowCards - a.yellowCards;
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [events, selectedLeague, selectedRound, searchQuery, teamMap, matchMap, playerAppMap]);

  // Overall Statistics summary
  const statsSummary = useMemo(() => {
    let yellow = 0;
    let red = 0;
    cardPlayers.forEach((p) => {
      yellow += p.yellowCards;
      red += p.redCards;
    });
    return {
      totalPlayers: cardPlayers.length,
      totalYellow: yellow,
      totalRed: red,
      totalCards: yellow + red,
    };
  }, [cardPlayers]);

  // Fetch player match card events on-demand ONLY when modal is opened
  const openPlayerDetail = async (player: CardPlayer) => {
    setSelectedPlayer(player);
    setShowPlayerModal(true);
    setModalLoading(true);
    setModalEvents([]);

    try {
      const pId = String(player.id);
      const { data } = await supabase
        .from('match_events')
        .select(`
          id, 
          event_type, 
          minute, 
          match:match_id(
            id, round, league, match_date, match_time, home_score, away_score, 
            home_team_id, away_team_id,
            home_team:home_team_id(id, name, logo_url), 
            away_team:away_team_id(id, name, logo_url)
          )
        `)
        .eq('player_id', pId)
        .in('event_type', ['yellow_card', 'red_card']);

      if (data && data.length > 0) {
        const formatted = data.map((e: any) => {
          const m = e.match || matchMap.get(e.match_id) || matchMap.get(String(e.match_id)) || {};
          const homeTeamObj = (typeof m.home_team === 'object' && m.home_team) || teamMap.get(m.home_team_id) || teamMap.get(String(m.home_team_id));
          const awayTeamObj = (typeof m.away_team === 'object' && m.away_team) || teamMap.get(m.away_team_id) || teamMap.get(String(m.away_team_id));

          const homeTeamName = homeTeamObj?.name || m.home_team_name || "1-jamoa";
          const homeTeamLogo = homeTeamObj?.logo_url || "";
          const awayTeamName = awayTeamObj?.name || m.away_team_name || "2-jamoa";
          const awayTeamLogo = awayTeamObj?.logo_url || "";

          const roundNum = parseRoundNumber(m.round);
          const dateStr = m.match_date || '';
          const timeStr = m.match_time || '';
          let formattedDate = '';
          if (dateStr) {
            try {
              const d = new Date(dateStr);
              formattedDate = d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
            } catch { formattedDate = dateStr; }
          }
          let formattedTime = '';
          if (timeStr) {
            formattedTime = timeStr.slice(0, 5);
          }

          const hasScore = m.home_score !== null && m.home_score !== undefined && m.away_score !== null && m.away_score !== undefined;
          const homeScore = m.home_score ?? 0;
          const awayScore = m.away_score ?? 0;

          return {
            id: e.id,
            type: e.event_type as 'yellow_card' | 'red_card',
            minute: e.minute,
            homeTeamName,
            homeTeamLogo,
            awayTeamName,
            awayTeamLogo,
            hasScore,
            homeScore,
            awayScore,
            league: m.league || '',
            round: roundNum > 0 ? `${roundNum}-tur` : '',
            date: formattedDate,
            time: formattedTime,
          };
        }).sort((a: any, b: any) => parseRoundNumber(a.round) - parseRoundNumber(b.round));

        setModalEvents(formatted);
      } else {
        setModalEvents([]);
      }
    } catch (err) {
      console.error('Error fetching player modal events:', err);
    } finally {
      setModalLoading(false);
    }
  };

  // Skeleton items for loading state
  const skeletonItems = Array.from({ length: 6 }, (_, i) => i);

  // Available teams for PDF modal (dynamically filtered by selected PDF league)
  const pdfAvailableTeams = useMemo(() => {
    if (!pdfLeague || pdfLeague === 'all') return teams;
    return teams.filter(
      (t) => (t.league || '').toLowerCase().trim() === pdfLeague.toLowerCase().trim()
    );
  }, [teams, pdfLeague]);

  // Filtered players list strictly for PDF Export according to selected modal filters
  const pdfFilteredPlayers = useMemo(() => {
    const cardMap: Record<string, CardPlayer> = {};

    events.forEach((e) => {
      if (!e.player_id) return;
      if (e.event_type !== 'yellow_card' && e.event_type !== 'red_card') return;

      const teamObj = teamMap.get(e.team_id) || teamMap.get(String(e.team_id));
      const matchObj = matchMap.get(e.match_id) || matchMap.get(String(e.match_id));

      // 1. League Filter
      const teamLeague = teamObj?.league || matchObj?.league || '';
      if (pdfLeague && pdfLeague !== 'all' && teamLeague.toLowerCase().trim() !== pdfLeague.toLowerCase().trim()) {
        return;
      }

      // 2. Round Filter
      if (pdfRound && pdfRound !== 'all') {
        const evRound = parseRoundNumber(matchObj?.round);
        if (evRound > 0 && String(evRound) !== String(pdfRound)) {
          return;
        }
      }

      // 3. Team Filter
      if (pdfTeamId && pdfTeamId !== 'all') {
        if (String(e.team_id) !== String(pdfTeamId)) {
          return;
        }
      }

      const pId = String(e.player_id);
      if (!cardMap[pId]) {
        const appInfo = playerAppMap.get(pId);
        const firstName = appInfo?.first_name || '';
        const lastName = appInfo?.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || `O'yinchi #${pId.slice(0, 5)}`;
        const photoUrl = appInfo?.photo_url || '';
        const playerNumber = appInfo?.player_number || '';
        const teamName = teamObj?.name || `Jamoa #${e.team_id ? String(e.team_id).slice(0, 5) : '?'}`;

        cardMap[pId] = {
          id: pId,
          name: fullName,
          photoUrl,
          playerNumber: playerNumber ? String(playerNumber) : undefined,
          teamId: e.team_id,
          teamName,
          teamLogo: teamObj?.logo_url,
          yellowCards: 0,
          redCards: 0,
          totalCards: 0,
        };
      }

      if (e.event_type === 'yellow_card') {
        cardMap[pId].yellowCards += 1;
      } else if (e.event_type === 'red_card') {
        cardMap[pId].redCards += 1;
      }
      cardMap[pId].totalCards = cardMap[pId].yellowCards + cardMap[pId].redCards;
    });

    const list = Object.values(cardMap).filter((p) => p.totalCards > 0);
    list.sort((a, b) => {
      if (b.redCards !== a.redCards) return b.redCards - a.redCards;
      if (b.yellowCards !== a.yellowCards) return b.yellowCards - a.yellowCards;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [events, teamMap, matchMap, playerAppMap, pdfLeague, pdfRound, pdfTeamId]);

  // Open PDF Modal with current filter preset
  const handleOpenPdfModal = () => {
    setPdfLeague(selectedLeague || 'all');
    setPdfRound(selectedRound || 'all');
    setPdfTeamId('all');
    setShowPdfModal(true);
  };

  // Execute PDF Export
  const executeExportPDF = async () => {
    if (exportingPDF) return;
    setExportingPDF(true);

    try {
      const orgTitle = currentOrg?.name || 'Amatora Admin';
      const leagueTitle = pdfLeague === 'all' ? 'Barcha Ligalar' : pdfLeague;
      const roundTitle = pdfRound === 'all' ? 'Barcha turlar' : `${pdfRound}-tur`;
      const selectedTeamObj = teams.find((t) => String(t.id) === String(pdfTeamId));
      const teamTitle = pdfTeamId === 'all' ? 'Barcha jamoalar' : (selectedTeamObj?.name || 'Jamoa');

      const dateStr = new Date().toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const totalYellow = pdfFilteredPlayers.reduce((acc, p) => acc + p.yellowCards, 0);
      const totalRed = pdfFilteredPlayers.reduce((acc, p) => acc + p.redCards, 0);
      const totalCards = totalYellow + totalRed;

      const rowsHtml = pdfFilteredPlayers
        .map(
          (p, idx) => `
        <tr style="background-color: ${idx % 2 === 0 ? '#1e293b' : '#0f172a'};">
          <td style="padding: 10px; text-align: center; font-weight: bold; color: #94a3b8; border-bottom: 1px solid rgba(255,255,255,0.08);">${idx + 1}</td>
          <td style="padding: 10px; font-weight: bold; color: #ffffff; border-bottom: 1px solid rgba(255,255,255,0.08);">${p.name}</td>
          <td style="padding: 10px; text-align: center; color: #38bdf8; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.08);">${p.playerNumber || '—'}</td>
          <td style="padding: 10px; color: #cbd5e1; border-bottom: 1px solid rgba(255,255,255,0.08);">${p.teamName}</td>
          <td style="padding: 10px; text-align: center; font-weight: 900; color: #facc15; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 14px;">${p.yellowCards}</td>
          <td style="padding: 10px; text-align: center; font-weight: 900; color: #ef4444; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 14px;">${p.redCards}</td>
          <td style="padding: 10px; text-align: center; font-weight: 900; color: #38bdf8; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 14px;">${p.totalCards}</td>
        </tr>
      `
        )
        .join('');

      const emptyRowHtml = `
        <tr>
          <td colspan="7" style="padding: 30px; text-align: center; color: #94a3b8; font-style: italic;">Tanlangan parametrlar bo'yicha kartochkalar mavjud emas</td>
        </tr>
      `;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${leagueTitle} - Kartochkalar hisoboti</title>
          <style>
            @page { margin: 15mm; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              background-color: #0b1329;
              color: #f8fafc;
              margin: 0;
              padding: 20px;
            }
            .header {
              background: linear-gradient(135deg, #1e293b, #0f172a);
              border-radius: 12px;
              padding: 20px;
              margin-bottom: 20px;
              border: 1px solid rgba(255,255,255,0.1);
            }
            .title {
              font-size: 22px;
              font-weight: 900;
              color: #facc15;
              margin: 0 0 6px 0;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .sub-title {
              font-size: 13px;
              color: #94a3b8;
              margin: 0;
            }
            .filter-tags {
              display: flex;
              gap: 8px;
              margin-top: 10px;
            }
            .filter-tag {
              background: rgba(255,255,255,0.08);
              padding: 4px 10px;
              border-radius: 6px;
              font-size: 11.5px;
              color: #38bdf8;
              font-weight: 700;
            }
            .stats-bar {
              display: flex;
              gap: 12px;
              margin-bottom: 20px;
            }
            .stat-box {
              flex: 1;
              background: #1e293b;
              padding: 12px;
              border-radius: 8px;
              border: 1px solid rgba(255,255,255,0.08);
              text-align: center;
            }
            .stat-val {
              font-size: 18px;
              font-weight: 900;
              margin-bottom: 2px;
            }
            .stat-lbl {
              font-size: 11px;
              color: #94a3b8;
              text-transform: uppercase;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              border-radius: 10px;
              overflow: hidden;
            }
            th {
              background-color: #0f172a;
              color: #94a3b8;
              font-size: 12px;
              text-transform: uppercase;
              padding: 12px 10px;
              letter-spacing: 0.5px;
              border-bottom: 2px solid rgba(255,255,255,0.15);
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">Kartochkalar Hisoboti</h1>
            <p class="sub-title">Tashkilot: <b>${orgTitle}</b> &nbsp;|&nbsp; Sana: <b>${dateStr}</b></p>
            <div class="filter-tags">
              <span class="filter-tag">🏆 ${leagueTitle}</span>
              <span class="filter-tag">🚩 ${roundTitle}</span>
              <span class="filter-tag">🛡️ ${teamTitle}</span>
            </div>
          </div>

          <div class="stats-bar">
            <div class="stat-box">
              <div class="stat-val" style="color: #facc15;">${totalYellow}</div>
              <div class="stat-lbl">Sariq Kartochkalar</div>
            </div>
            <div class="stat-box">
              <div class="stat-val" style="color: #ef4444;">${totalRed}</div>
              <div class="stat-lbl">Qizil Kartochkalar</div>
            </div>
            <div class="stat-box">
              <div class="stat-val" style="color: #38bdf8;">${totalCards}</div>
              <div class="stat-lbl">Jami Kartochkalar</div>
            </div>
            <div class="stat-box">
              <div class="stat-val" style="color: #ffffff;">${pdfFilteredPlayers.length}</div>
              <div class="stat-lbl">O'yinchilar</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 35px; text-align: center;">#</th>
                <th style="text-align: left;">O'yinchi (F.I.Sh)</th>
                <th style="width: 60px; text-align: center;">Forma</th>
                <th style="text-align: left;">Jamoa</th>
                <th style="width: 70px; text-align: center; color: #facc15;">Sariq</th>
                <th style="width: 70px; text-align: center; color: #ef4444;">Qizil</th>
                <th style="width: 70px; text-align: center; color: #38bdf8;">Jami</th>
              </tr>
            </thead>
            <tbody>
              ${pdfFilteredPlayers.length > 0 ? rowsHtml : emptyRowHtml}
            </tbody>
          </table>
        </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      setShowPdfModal(false);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
      } else {
        Alert.alert('Muvaffaqiyatli', `PDF saqlandi: ${uri}`);
      }
    } catch (err: any) {
      console.error('PDF generation error:', err);
      Alert.alert('Xatolik', `PDF yaratishda xatolik yuz berdi: ${err.message}`);
    } finally {
      setExportingPDF(false);
    }
  };

  const renderCardPlayerItem = ({ item, index }: { item: CardPlayer; index: number }) => {
    return (
      <TouchableOpacity
        style={[styles.cardItem, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
        onPress={() => openPlayerDetail(item)}
        activeOpacity={0.7}
      >
        {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />}

        {/* Rank & Photo */}
        <View style={styles.playerLeftRow}>
          <Text style={[styles.rankText, Platform.OS === 'android' && { color: colors.textMuted }]}>{index + 1}</Text>
          <View style={styles.avatarWrapper}>
            <ExpoImage
              source={{ uri: item.photoUrl ? item.photoUrl : DEFAULT_AVATAR }}
              style={[styles.avatar, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
            />
            {Boolean(item.playerNumber) && (
              <View style={[styles.numberBadge, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                <Text style={[styles.numberText, Platform.OS === 'android' && { color: colors.accentGreen }]}>{item.playerNumber}</Text>
              </View>
            )}
          </View>

          {/* Details */}
          <View style={styles.playerDetails}>
            <Text style={[styles.playerName, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.teamRow}>
              {Boolean(item.teamLogo) && (
                <ExpoImage
                  source={{ uri: item.teamLogo || DEFAULT_TEAM_LOGO }}
                  style={styles.teamLogo}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              )}
              <Text style={[styles.teamName, Platform.OS === 'android' && { color: colors.textSecondary }]} numberOfLines={1}>
                {item.teamName}
              </Text>
            </View>
          </View>
        </View>

        {/* Card Counts Badges */}
        <View style={styles.cardsBadgesContainer}>
          {/* Yellow Card Badge */}
          <View style={styles.cardBadgeBox}>
            <View style={[styles.cardIconBlock, styles.yellowCardBlock]}>
              <Text style={[styles.cardCountText, { color: '#EAB308' }]}>{item.yellowCards}</Text>
            </View>
            <Text style={[styles.cardBadgeLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Sariq"}</Text>
          </View>

          {/* Red Card Badge */}
          <View style={styles.cardBadgeBox}>
            <View style={[styles.cardIconBlock, styles.redCardBlock]}>
              <Text style={[styles.cardCountText, { color: '#EF4444' }]}>{item.redCards}</Text>
            </View>
            <Text style={[styles.cardBadgeLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Qizil"}</Text>
          </View>

          {/* Chevron */}
          <Ionicons name="chevron-forward" size={16} color={Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.3)'} style={{ marginLeft: 2 }} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      {/* Filters & Actions Section */}
      <View style={styles.topHeader}>
        {/* Parallel Selectors Row: League (Left) & Round (Right) */}
        <View style={styles.parallelSelectorsRow}>
          {/* League Selector Button */}
          <TouchableOpacity
            style={[styles.parallelSelectorBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => setShowLeagueModal(true)}
            activeOpacity={0.8}
          >
            {Platform.OS === 'ios' && <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="trophy-outline" size={17} color="#FACC15" />
            <Text style={[styles.parallelSelectorText, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
              {selectedLeague && selectedLeague !== 'all' ? selectedLeague : "Barcha ligalar"}
            </Text>
            <Ionicons name="chevron-down" size={16} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.6)"} />
          </TouchableOpacity>

          {/* Round Selector Button */}
          <TouchableOpacity
            style={[styles.parallelSelectorBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => setShowRoundModal(true)}
            activeOpacity={0.8}
          >
            {Platform.OS === 'ios' && <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="flag-outline" size={17} color={colors.accentGreen} />
            <Text style={[styles.parallelSelectorText, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
              {selectedRound === 'all' ? "Barcha turlar" : `${selectedRound}-tur`}
            </Text>
            <Ionicons name="chevron-down" size={16} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.6)"} />
          </TouchableOpacity>
        </View>

        {/* Search Input & PDF Export Button Row */}
        <View style={styles.searchAndActionRow}>
          <View style={[styles.searchBox, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={18} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.4)"} />
            <TextInput
              style={[styles.searchInput, Platform.OS === 'android' && { color: colors.textPrimary }]}
              placeholder="O'yinchi, forma yoki jamoa..."
              placeholderTextColor={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.35)"}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {Boolean(searchQuery) && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.4)"} />
              </TouchableOpacity>
            )}
          </View>

          {/* PDF Export Button */}
          <TouchableOpacity
            style={styles.pdfExportBtn}
            onPress={handleOpenPdfModal}
            disabled={exportingPDF}
            activeOpacity={0.8}
          >
            {exportingPDF ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="document-text-outline" size={16} color="#FFFFFF" />
                <Text style={styles.pdfExportBtnText}>{"PDF"}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary KPI Cards */}
      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard }, { borderColor: 'rgba(250, 204, 21, 0.3)' }]}>
          {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />}
          <Text style={[styles.kpiValue, { color: '#FACC15' }]}>{statsSummary.totalYellow}</Text>
          <Text style={[styles.kpiLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Sariq"}</Text>
        </View>

        <View style={[styles.kpiCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard }, { borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
          {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />}
          <Text style={[styles.kpiValue, { color: '#EF4444' }]}>{statsSummary.totalRed}</Text>
          <Text style={[styles.kpiLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Qizil"}</Text>
        </View>

        <View style={[styles.kpiCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard }, { borderColor: 'rgba(56, 189, 248, 0.3)' }]}>
          {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />}
          <Text style={[styles.kpiValue, { color: '#38BDF8' }]}>{statsSummary.totalCards}</Text>
          <Text style={[styles.kpiLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Jami"}</Text>
        </View>

        <View style={[styles.kpiCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard }, { borderColor: Platform.OS === 'android' ? colors.border : 'rgba(255, 255, 255, 0.15)' }]}>
          {Platform.OS === 'ios' && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />}
          <Text style={[styles.kpiValue, { color: Platform.OS === 'android' ? colors.textPrimary : '#FFFFFF' }]}>{statsSummary.totalPlayers}</Text>
          <Text style={[styles.kpiLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"O'yinchilar"}</Text>
        </View>
      </View>

      {/* Main Players Cards List */}
      {loading ? (
        <View style={{ paddingHorizontal: 16, gap: 10, paddingTop: 4 }}>
          {skeletonItems.map((_, i) => (
            <CardItemSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={cardPlayers.slice(0, visibleCount)}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderCardPlayerItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130, gap: 10 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FACC15" />
          }
          onEndReached={() => {
            if (visibleCount < cardPlayers.length) {
              setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, cardPlayers.length));
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            visibleCount < cardPlayers.length ? (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <ActivityIndicator size="small" color="#FACC15" />
                <Text style={{ color: Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 }}>
                  {`${Math.min(visibleCount, cardPlayers.length)} / ${cardPlayers.length}`}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="shield-check-outline" size={48} color={Platform.OS === 'android' ? colors.border : "rgba(255,255,255,0.2)"} />
              <Text style={[styles.emptyTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Kartochkalar mavjud emas"}</Text>
              <Text style={[styles.emptySub, Platform.OS === 'android' && { color: colors.textMuted }]}>
                {"Tanlangan liga yoki tur bo'yicha hech qanday kartochka qayd etilmagan."}
              </Text>
            </View>
          }
        />
      )}

      {/* Player Detail Modal */}
      {/* Player Detail Modal */}
      <Modal
        visible={showPlayerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPlayerModal(false)}
      >
        <View style={styles.modalOverlay}>
          {/* Backdrop tap to dismiss */}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowPlayerModal(false)}
          />

          {/* Modal Dialog Card */}
          <View
            style={[
              styles.playerModalContent,
              Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border },
            ]}
          >
            {Platform.OS === 'ios' && (
              <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
            )}

            {selectedPlayer && (
              <>
                {/* Modal Header */}
                <View style={styles.playerModalHeader}>
                  <View style={styles.playerModalHeaderLeft}>
                    <ExpoImage
                      source={{ uri: selectedPlayer.photoUrl || DEFAULT_AVATAR }}
                      style={[styles.playerModalAvatar, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                      contentFit="cover"
                      transition={200}
                    />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[styles.playerModalName, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                        {selectedPlayer.name}
                      </Text>
                      <View style={styles.teamRow}>
                        {Boolean(selectedPlayer.teamLogo) && (
                          <ExpoImage
                            source={{ uri: selectedPlayer.teamLogo || DEFAULT_TEAM_LOGO }}
                            style={styles.teamLogo}
                            contentFit="cover"
                          />
                        )}
                        <Text style={[styles.teamName, Platform.OS === 'android' && { color: colors.textSecondary }]} numberOfLines={1}>
                          {selectedPlayer.teamName}
                        </Text>
                        {Boolean(selectedPlayer.playerNumber) && (
                          <Text style={{ color: colors.accentGreen, fontSize: 11.5, fontWeight: '800' }}>
                            {selectedPlayer.playerNumber}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={() => setShowPlayerModal(false)}
                    style={[styles.closeModalBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, borderWidth: 1 }]}
                  >
                    <Ionicons name="close" size={20} color={Platform.OS === 'android' ? colors.textPrimary : '#FFFFFF'} />
                  </TouchableOpacity>
                </View>

                {/* Modal KPI Mini Summary */}
                <View style={styles.playerModalKpiRow}>
                  <View style={[styles.playerModalKpiBox, { borderColor: 'rgba(250, 204, 21, 0.3)', backgroundColor: Platform.OS === 'android' ? (isDark ? 'rgba(250, 204, 21, 0.1)' : 'rgba(250, 204, 21, 0.12)') : 'rgba(250, 204, 21, 0.15)' }]}>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: '#FACC15' }}>{selectedPlayer.yellowCards}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.6)' }}>Sariq kartochka</Text>
                  </View>
                  <View style={[styles.playerModalKpiBox, { borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: Platform.OS === 'android' ? (isDark ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.12)') : 'rgba(239, 68, 68, 0.15)' }]}>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: '#EF4444' }}>{selectedPlayer.redCards}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.6)' }}>Qizil kartochka</Text>
                  </View>
                </View>

                {/* Title */}
                <Text style={[styles.playerModalSectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                  {"Qayd etilgan kartochkalar"}
                </Text>

                {/* Card Events List on-demand */}
                {modalLoading ? (
                  <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <ActivityIndicator size="small" color="#FACC15" />
                    <Text style={{ color: Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                      {"O'yin ma'lumotlari yuklanmoqda..."}
                    </Text>
                  </View>
                ) : modalEvents.length === 0 ? (
                  <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                    <Text style={{ color: Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                      {"Kartochkalar tafsilotlari topilmadi"}
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={modalEvents}
                    keyExtractor={(item, index) => String(item.id || index)}
                    showsVerticalScrollIndicator={true}
                    nestedScrollEnabled={true}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
                    style={styles.playerModalEventsScroll}
                    renderItem={({ item: ev }) => {
                      const isYellow = ev.type === 'yellow_card';
                      return (
                        <View
                          style={[
                            styles.modalMatchCard,
                            Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                          ]}
                        >
                          {/* Match Top Bar: Round & Date / Time */}
                          <View style={styles.modalMatchTopRow}>
                            <View style={[styles.modalMatchRoundBadge, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                              <Text style={[styles.modalMatchRoundText, Platform.OS === 'android' && { color: colors.accentGreen }]}>
                                {ev.round || (ev.league ? ev.league : "O'yin")}
                              </Text>
                            </View>

                            <View style={styles.modalMatchDateTimeRow}>
                              {Boolean(ev.date) && (
                                <View style={styles.eventMetaItem}>
                                  <Ionicons name="calendar-outline" size={12} color={Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)'} />
                                  <Text style={[styles.eventMetaText, Platform.OS === 'android' && { color: colors.textMuted }]}>
                                    {ev.date}
                                  </Text>
                                </View>
                              )}
                              {Boolean(ev.time) && (
                                <View style={styles.eventMetaItem}>
                                  <Ionicons name="time-outline" size={12} color={Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)'} />
                                  <Text style={[styles.eventMetaText, Platform.OS === 'android' && { color: colors.textMuted }]}>
                                    {ev.time}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </View>

                          {/* Teams Versus Row */}
                          <View style={styles.modalMatchTeamsRow}>
                            {/* Home Team */}
                            <View style={styles.modalMatchTeamCol}>
                              <ExpoImage
                                source={{ uri: ev.homeTeamLogo || DEFAULT_TEAM_LOGO }}
                                style={styles.modalMatchTeamLogo}
                                contentFit="cover"
                              />
                              <Text style={[styles.modalMatchTeamName, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                                {ev.homeTeamName}
                              </Text>
                            </View>

                            {/* Score / VS */}
                            <View style={styles.modalMatchScoreBox}>
                              {ev.hasScore ? (
                                <Text style={[styles.modalMatchScoreText, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                                  {`${ev.homeScore} : ${ev.awayScore}`}
                                </Text>
                              ) : (
                                <Text style={[styles.modalMatchVsText, Platform.OS === 'android' && { color: colors.textMuted }]}>
                                  VS
                                </Text>
                              )}
                            </View>

                            {/* Away Team */}
                            <View style={styles.modalMatchTeamCol}>
                              <ExpoImage
                                source={{ uri: ev.awayTeamLogo || DEFAULT_TEAM_LOGO }}
                                style={styles.modalMatchTeamLogo}
                                contentFit="cover"
                              />
                              <Text style={[styles.modalMatchTeamName, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                                {ev.awayTeamName}
                              </Text>
                            </View>
                          </View>

                          {/* Card Received Bottom Banner */}
                          <View style={[styles.modalCardBanner, isYellow ? styles.modalYellowCardBanner : styles.modalRedCardBanner]}>
                            <MaterialCommunityIcons
                              name="cards-outline"
                              size={15}
                              color={isYellow ? '#EAB308' : '#EF4444'}
                            />
                            <Text style={[styles.modalCardBannerText, { color: isYellow ? '#EAB308' : '#EF4444' }]}>
                              {isYellow ? "Sariq kartochka" : "Qizil kartochka"}
                              {Boolean(ev.minute) ? ` — ${ev.minute}'-daqiqada` : ''}
                            </Text>
                          </View>
                        </View>
                      );
                    }}
                  />
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* League Selection Modal */}
      <Modal
        visible={showLeagueModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLeagueModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowLeagueModal(false)}
          />

          <View style={[styles.modalContent, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Text style={[styles.modalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ligani tanlang"}</Text>

            <TouchableOpacity
              style={[
                styles.modalItem,
                Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated },
                (selectedLeague === 'all' || !selectedLeague) && styles.modalItemActive,
              ]}
              onPress={() => {
                setSelectedLeague('all');
                setShowLeagueModal(false);
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="trophy"
                size={18}
                color={(selectedLeague === 'all' || !selectedLeague) ? '#FACC15' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')}
              />
              <Text style={[styles.modalItemText, Platform.OS === 'android' && { color: colors.textPrimary }, (selectedLeague === 'all' || !selectedLeague) && styles.modalItemTextActive]}>
                {"Barcha ligalar"}
              </Text>
              {(selectedLeague === 'all' || !selectedLeague) && <Ionicons name="checkmark-circle" size={20} color="#FACC15" />}
            </TouchableOpacity>

            <FlatList
              data={leagues}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => {
                const isSelected = selectedLeague === item.name;
                return (
                  <TouchableOpacity
                    style={[
                      styles.modalItem,
                      Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated },
                      isSelected && styles.modalItemActive,
                    ]}
                    onPress={() => {
                      setSelectedLeague(item.name);
                      setShowLeagueModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="trophy"
                      size={18}
                      color={isSelected ? '#FACC15' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')}
                    />
                    <Text style={[styles.modalItemText, Platform.OS === 'android' && { color: colors.textPrimary }, isSelected && styles.modalItemTextActive]}>
                      {item.name}
                    </Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color="#FACC15" />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Round Selection Modal */}
      <Modal
        visible={showRoundModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRoundModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowRoundModal(false)}
          />

          <View style={[styles.modalContent, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Text style={[styles.modalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Turni tanlang"}</Text>

            <FlatList
              data={roundOptions}
              keyExtractor={(item) => String(item)}
              renderItem={({ item }) => {
                const isSelected = selectedRound === item;
                return (
                  <TouchableOpacity
                    style={[
                      styles.modalItem,
                      Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated },
                      isSelected && styles.modalItemActive,
                    ]}
                    onPress={() => {
                      setSelectedRound(item);
                      setShowRoundModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="flag-outline"
                      size={18}
                      color={isSelected ? '#FACC15' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')}
                    />
                    <Text style={[styles.modalItemText, Platform.OS === 'android' && { color: colors.textPrimary }, isSelected && styles.modalItemTextActive]}>
                      {item === 'all' ? "Barcha turlar" : `${item}-tur`}
                    </Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color="#FACC15" />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
      {/* PDF Export Options Modal */}
      <Modal
        visible={showPdfModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPdfModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowPdfModal(false)}
          />

          <View style={[styles.pdfModalBox, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={95} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}

            {/* Header */}
            <View style={styles.pdfModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="document-text" size={22} color="#38BDF8" />
                <Text style={[styles.pdfModalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                  {"PDF Eksport parametrlari"}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowPdfModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.6)"} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.pdfModalDesc, Platform.OS === 'android' && { color: colors.textMuted }]}>
              {"Kerakli liga, tur va jamoani tanlab, mos kartochkalar ro'yxatini PDF formatda yuklab oling."}
            </Text>

            {/* Selectors */}
            <View style={{ gap: 12, marginVertical: 14 }}>
              {/* 1. League Picker Field */}
              <View>
                <Text style={[styles.pdfFieldLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>
                  {"1. Liga"}
                </Text>
                <TouchableOpacity
                  style={[styles.pdfSelectField, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                  onPress={() => setPdfSubPicker('league')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trophy-outline" size={17} color="#FACC15" />
                  <Text style={[styles.pdfSelectValue, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                    {pdfLeague === 'all' ? "Barcha ligalar" : pdfLeague}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.5)"} />
                </TouchableOpacity>
              </View>

              {/* 2. Round Picker Field */}
              <View>
                <Text style={[styles.pdfFieldLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>
                  {"2. Tur"}
                </Text>
                <TouchableOpacity
                  style={[styles.pdfSelectField, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                  onPress={() => setPdfSubPicker('round')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="flag-outline" size={17} color={colors.accentGreen} />
                  <Text style={[styles.pdfSelectValue, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                    {pdfRound === 'all' ? "Barcha turlar" : `${pdfRound}-tur`}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.5)"} />
                </TouchableOpacity>
              </View>

              {/* 3. Team Picker Field */}
              <View>
                <Text style={[styles.pdfFieldLabel, Platform.OS === 'android' && { color: colors.textSecondary }]}>
                  {"3. Jamoa"}
                </Text>
                <TouchableOpacity
                  style={[styles.pdfSelectField, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                  onPress={() => setPdfSubPicker('team')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="shield-outline" size={17} color="#38BDF8" />
                  <Text style={[styles.pdfSelectValue, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                    {pdfTeamId === 'all'
                      ? "Barcha jamoalar"
                      : (teams.find((t) => String(t.id) === String(pdfTeamId))?.name || "Tanlangan jamoa")}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.5)"} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Results count badge */}
            <View style={[styles.pdfPreviewBadge, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(56,189,248,0.1)' : 'rgba(56,189,248,0.15)', borderColor: 'rgba(56,189,248,0.3)' }]}>
              <Ionicons name="information-circle-outline" size={18} color="#38BDF8" />
              <Text style={[styles.pdfPreviewText, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                {`Tanlangan mezonlar bo'yicha: `}
                <Text style={{ fontWeight: '900', color: '#38BDF8' }}>{`${pdfFilteredPlayers.length} nafar o'yinchi`}</Text>
              </Text>
            </View>

            {/* Download Button */}
            <TouchableOpacity
              style={[styles.pdfDownloadSubmitBtn, exportingPDF && { opacity: 0.7 }]}
              onPress={executeExportPDF}
              disabled={exportingPDF}
              activeOpacity={0.8}
            >
              {exportingPDF ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.pdfDownloadSubmitBtnText}>{"PDF Yuklab Olish"}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Sub-Picker Modal (For selecting League, Round, or Team in PDF Modal) */}
      <Modal
        visible={pdfSubPicker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPdfSubPicker(null)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setPdfSubPicker(null)}
          />

          <View style={[styles.modalContent, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Text style={[styles.modalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>
              {pdfSubPicker === 'league' ? "Ligani tanlang" : pdfSubPicker === 'round' ? "Turni tanlang" : "Jamoani tanlang"}
            </Text>

            {pdfSubPicker === 'league' && (
              <FlatList
                data={[{ id: 'all', name: 'Barcha ligalar' }, ...leagues]}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => {
                  const isSelected = (item.id === 'all' && pdfLeague === 'all') || pdfLeague === item.name;
                  return (
                    <TouchableOpacity
                      style={[
                        styles.modalItem,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated },
                        isSelected && styles.modalItemActive,
                      ]}
                      onPress={() => {
                        setPdfLeague(item.id === 'all' ? 'all' : item.name);
                        setPdfTeamId('all');
                        setPdfSubPicker(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="trophy" size={18} color={isSelected ? '#FACC15' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')} />
                      <Text style={[styles.modalItemText, Platform.OS === 'android' && { color: colors.textPrimary }, isSelected && styles.modalItemTextActive]}>
                        {item.name}
                      </Text>
                      {isSelected && <Ionicons name="checkmark-circle" size={20} color="#FACC15" />}
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            {pdfSubPicker === 'round' && (
              <FlatList
                data={roundOptions}
                keyExtractor={(item) => String(item)}
                renderItem={({ item }) => {
                  const isSelected = pdfRound === item;
                  return (
                    <TouchableOpacity
                      style={[
                        styles.modalItem,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated },
                        isSelected && styles.modalItemActive,
                      ]}
                      onPress={() => {
                        setPdfRound(item);
                        setPdfSubPicker(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="flag-outline" size={18} color={isSelected ? '#FACC15' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')} />
                      <Text style={[styles.modalItemText, Platform.OS === 'android' && { color: colors.textPrimary }, isSelected && styles.modalItemTextActive]}>
                        {item === 'all' ? "Barcha turlar" : `${item}-tur`}
                      </Text>
                      {isSelected && <Ionicons name="checkmark-circle" size={20} color="#FACC15" />}
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            {pdfSubPicker === 'team' && (
              <FlatList
                data={[{ id: 'all', name: 'Barcha jamoalar' }, ...pdfAvailableTeams]}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => {
                  const isSelected = pdfTeamId === String(item.id);
                  return (
                    <TouchableOpacity
                      style={[
                        styles.modalItem,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated },
                        isSelected && styles.modalItemActive,
                      ]}
                      onPress={() => {
                        setPdfTeamId(String(item.id));
                        setPdfSubPicker(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="shield-outline" size={18} color={isSelected ? '#38BDF8' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')} />
                      <Text style={[styles.modalItemText, Platform.OS === 'android' && { color: colors.textPrimary }, isSelected && styles.modalItemTextActive]}>
                        {item.name}
                      </Text>
                      {isSelected && <Ionicons name="checkmark-circle" size={20} color="#38BDF8" />}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
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
  },
  topHeader: {
    paddingTop: 8,
    paddingBottom: 10,
    gap: 10,
  },
  topHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(250, 204, 21, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  screenSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
  },
  pdfExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0284C7',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  pdfExportBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  parallelSelectorsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
  },
  parallelSelectorBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  parallelSelectorText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  searchAndActionRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  kpiCard: {
    flex: 1,
    height: 60,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  kpiLabel: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cardItem: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  playerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.4)',
    width: 22,
    textAlign: 'center',
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  numberBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    backgroundColor: '#0F172A',
    paddingHorizontal: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  numberText: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '900',
  },
  playerDetails: {
    flex: 1,
    gap: 3,
  },
  playerName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  teamLogo: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  teamName: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11.5,
    fontWeight: '600',
  },
  cardsBadgesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardBadgeBox: {
    alignItems: 'center',
    gap: 2,
  },
  cardIconBlock: {
    width: 32,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  yellowCardBlock: {
    backgroundColor: 'rgba(250, 204, 21, 0.25)',
    borderColor: '#FACC15',
  },
  redCardBlock: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderColor: '#EF4444',
  },
  totalCardBlock: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38BDF8',
  },
  cardCountText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  cardBadgeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 60,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  emptySub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxHeight: '60%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: 16,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    marginBottom: 14,
    textAlign: 'center',
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 10,
  },
  modalItemActive: {
    backgroundColor: 'rgba(250, 204, 21, 0.15)',
  },
  modalItemText: {
    flex: 1,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    fontWeight: '600',
  },
  modalItemTextActive: {
    color: '#FACC15',
    fontWeight: '800',
  },
  playerModalContent: {
    width: '100%',
    height: Dimensions.get('window').height * 0.76,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: 18,
    gap: 12,
    display: 'flex',
    flexDirection: 'column',
  },
  playerModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  playerModalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  playerModalAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  playerModalName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  closeModalBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerModalKpiRow: {
    flexDirection: 'row',
    gap: 8,
  },
  playerModalKpiBox: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 2,
  },
  playerModalSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  playerModalEventsScroll: {
    flex: 1,
    width: '100%',
  },
  modalMatchCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 12,
    gap: 10,
    overflow: 'hidden',
  },
  modalMatchTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalMatchRoundBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modalMatchRoundText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#10B981',
  },
  modalMatchDateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalMatchTeamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  modalMatchTeamCol: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  modalMatchTeamLogo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modalMatchTeamName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  modalMatchScoreBox: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalMatchScoreText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  modalMatchVsText: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
  },
  modalCardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalYellowCardBanner: {
    backgroundColor: 'rgba(250, 204, 21, 0.15)',
    borderColor: 'rgba(250, 204, 21, 0.4)',
  },
  modalRedCardBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  modalCardBannerText: {
    fontSize: 12,
    fontWeight: '800',
  },
  eventMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  eventMetaText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '600',
  },
  pdfModalBox: {
    width: '92%',
    maxWidth: 420,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  pdfModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  pdfModalTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  pdfModalDesc: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 18,
    marginBottom: 4,
  },
  pdfFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 5,
  },
  pdfSelectField: {
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  pdfSelectValue: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pdfPreviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(56,189,248,0.1)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.25)',
    marginVertical: 4,
  },
  pdfPreviewText: {
    fontSize: 12.5,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  pdfDownloadSubmitBtn: {
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#0284C7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  pdfDownloadSubmitBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
});
