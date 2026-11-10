import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { GalleryPermissionError, saveReplayToGallery } from '../utils/replayGallery';
import HighlightEditor, { type HighlightClip, type HighlightSize } from '../components/HighlightEditor';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { parseOrganizationId, requireOrganizationId } from '../utils/organizationId';
import ReplayPlayback from '../components/ReplayPlayback';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { getActiveOrgTournaments, getStageDisplayTitle } from '../utils/tournamentUtils';
import { triggerIosCrescendoHaptic } from '../utils/haptics';

interface MatchItem {
  id: string;
  league?: string | null;
  tournament_id?: string | number | null;
  round?: number | string | null;
  stage?: string | null;
  home_team_id?: string | number | null;
  away_team_id?: string | number | null;
  home_score?: number | null;
  away_score?: number | null;
  match_date?: string | null;
  match_time?: string | null;
  status?: string | null;
}

interface MatchEventItem {
  id: string;
  match_id: string;
  minute?: number | null;
  event_type: string;
  replay_video_url?: string | null;
  player?: {
    id: string;
    first_name: string;
    last_name: string;
    player_number?: string | number | null;
    photo_url?: string | null;
  } | null;
  team?: {
    id: string | number;
    name: string;
    logo_url?: string | null;
  } | null;
}

type ReplayTeam = NonNullable<MatchEventItem['team']>;
type ReplayMatch = MatchItem & {
  home_team: ReplayTeam | null;
  away_team: ReplayTeam | null;
  replays?: { count: number }[];
};

function replayUrl(raw?: string | null) {
  try {
    const url = new URL(raw?.trim() ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export function ReplaysScreen({ onBack }: { onBack?: () => void }) {
  const { currentOrg } = useOrg();
  const orgId = parseOrganizationId(currentOrg?.id);
  const { isDark, colors } = useTheme();

  // Filter states
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'league' | 'tournament'>('all');
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedTournament, setSelectedTournament] = useState<string>('all');
  const [selectedRound, setSelectedRound] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithReplays, setOnlyWithReplays] = useState(false);

  // Detail Modal state
  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null);
  const [matchEvents, setMatchEvents] = useState<MatchEventItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [highlightSize, setHighlightSize] = useState<HighlightSize>(5);
  const [clips, setClips] = useState<HighlightClip[]>([]);
  const toggleClip = (event: MatchEventItem) => {
    if (clips.some(clip => clip.id === event.id)) {
      setClips(clips.filter(clip => clip.id !== event.id));
    } else if (clips.length < highlightSize) {
      setClips([...clips, { id: event.id, name: event.player ?
        [event.player.first_name, event.player.last_name].filter(Boolean).join(' ') || 'Muallifsiz gol' : 'Muallifsiz gol',
        team: event.team?.name || 'Jamoa', number: event.player?.player_number, photo: event.player?.photo_url }]);
    } else {
      Alert.alert(`Top ${highlightSize} to'ldi`, "Boshqa golni tanlash uchun avval bittasini olib tashlang yoki Top 10 ni tanlang.");
    }
  };
  const [downloadingEventId, setDownloadingEventId] = useState<string | null>(null);

  // Dropdown Picker Modal
  const [pickerModalType, setPickerModalType] = useState<'none' | 'type' | 'league' | 'tournament' | 'round'>('none');

  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filters = useQuery({
    queryKey: ['replayFilters', orgId, filterType, selectedLeague, selectedTournament],
    enabled: orgId !== null && isFilterOpen,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const targetOrgId = requireOrganizationId(orgId);
      let rounds = supabase.from('matches').select('round').eq('organization_id', targetOrgId)
        .not('round', 'is', null);
      if (filterType === 'league') rounds = rounds.filter('tournament_id', 'is', null);
      if (filterType === 'tournament') rounds = rounds.filter('tournament_id', 'not.is', null);
      if (selectedLeague !== 'all') rounds = rounds.eq('league', selectedLeague);
      if (selectedTournament !== 'all') rounds = rounds.eq('tournament_id', String(selectedTournament));
      const [tournaments, leagues, values] = await Promise.all([
        getActiveOrgTournaments(targetOrgId),
        supabase.from('leagues').select('id,name').eq('organization_id', targetOrgId).order('name').abortSignal(signal),
        rounds.order('round').limit(1000).abortSignal(signal),
      ]);
      if (leagues.error || values.error) throw leagues.error || values.error;
      return { tournaments, leagues: leagues.data ?? [],
        rounds: [...new Set((values.data ?? []).map(row => String(row.round)))].sort((a, b) => Number(a) - Number(b)) };
    },
  });
  const { leagues = [], tournaments = [], rounds: availableRounds = [] } = filters.data ?? {};
  const list = useInfiniteQuery({
    queryKey: ['adminReplays', orgId, filterType, selectedLeague, selectedTournament, selectedRound, search, onlyWithReplays],
    enabled: orgId !== null,
    initialPageParam: 0,
    staleTime: 30_000,
    retry: 1,
    queryFn: async ({ pageParam, signal }) => {
      const targetOrgId = requireOrganizationId(orgId);
      const replayJoin = onlyWithReplays ? ',has_replay:match_events!inner()' : '';
      let query = supabase.from('matches').select(`
        id, league, tournament_id, round, stage, home_team_id, away_team_id, home_score, away_score, match_date, match_time, status,
        home_team:home_team_id(id,name,logo_url), away_team:away_team_id(id,name,logo_url), replays:match_events(count)${replayJoin}
      `).eq('organization_id', targetOrgId)
        .not('replays.replay_video_url', 'is', null).neq('replays.replay_video_url', '');
      if (onlyWithReplays) query = query.filter('has_replay.replay_video_url', 'not.is', null).filter('has_replay.replay_video_url', 'neq', '');
      if (filterType === 'league') query = query.filter('tournament_id', 'is', null);
      if (filterType === 'tournament') query = query.filter('tournament_id', 'not.is', null);
      if (selectedLeague !== 'all') query = query.eq('league', selectedLeague);
      if (selectedTournament !== 'all') query = query.eq('tournament_id', String(selectedTournament));
      if (selectedRound !== 'all') query = query.eq('round', selectedRound);
      if (search) {
        const term = search.replace(/[\\%_*]/g, ch => '\\' + ch);
        const { data, error } = await supabase.from('teams').select('id').eq('organization_id', targetOrgId)
          .ilike('name', `%${term}%`).abortSignal(signal);
        if (error) throw error;
        const ids = (data ?? []).map(row => String(row.id)).filter(id => /^[a-f0-9-]+$/i.test(id)).join(',');
        if (!ids) return { rows: [], hasMore: false };
        query = query.or(`home_team_id.in.(${ids}),away_team_id.in.(${ids})`);
      }
      const from = pageParam * 5;
      const { data, error } = await query.order('match_date', { ascending: false, nullsFirst: false })
        .order('match_time', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false }).range(from, from + 5).abortSignal(signal);
      if (error) throw error;
      return { rows: (data ?? []).slice(0, 5) as unknown as ReplayMatch[], hasMore: (data?.length ?? 0) > 5 };
    },
    getNextPageParam: (page, _pages, pageParam) => page.hasMore ? pageParam + 1 : undefined,
  });
  const filteredMatches = useMemo(() => [...new Map((list.data?.pages.flatMap(page => page.rows) ?? [])
    .map(match => [match.id, match])).values()], [list.data]);
  const matchReplaysCount = useMemo(() => new Map(filteredMatches.map(match => [match.id, match.replays?.[0]?.count ?? 0])), [filteredMatches]);
  const teamsMap = useMemo(() => new Map(filteredMatches.flatMap(match =>
    [match.home_team, match.away_team].flatMap(team => team ? [[String(team.id), team] as const] : []))), [filteredMatches]);
  const loading = list.isLoading;
  const refreshing = list.isRefetching;
  const handleRefresh = () => { triggerIosCrescendoHaptic(); void list.refetch(); };

  const closeMatch = () => {
    detailRequest.current?.abort();
    setPlayingId(null);
    setSelectedMatch(null);
  };
  useEffect(() => {
    setSelectedMatch(null);
    setPlayingId(null);
    setClips([]);
    setHighlightOpen(false);
    return () => detailRequest.current?.abort();
  }, [orgId]);

  const handleSelectMatch = async (match: MatchItem) => {
    triggerIosCrescendoHaptic();
    detailRequest.current?.abort();
    const request = new AbortController();
    detailRequest.current = request;
    setPlayingId(null);
    setEventsError(false);
    setSelectedMatch(match);
    setLoadingEvents(true);
    setMatchEvents([]);

    try {
      const { data: eventsData, error: evErr } = await supabase
        .from('match_events')
        .select(`
          id,
          match_id,
          event_type,
          minute,
          replay_video_url,
          created_at,
          player:player_id (id, first_name, last_name, player_number, photo_url),
          team:team_id (id, name, logo_url)
        `)
        .eq('match_id', match.id)
        .order('minute', { ascending: true })
        .order('created_at', { ascending: true })
        .abortSignal(request.signal);

      if (evErr) throw evErr;

      const goalsAndReplays = (eventsData || [])
        .filter((e: any) => ['goal', 'penalty_goal', 'own_goal'].includes(e.event_type) || e.replay_video_url)
        .map((e: any) => ({
          ...e,
          replay_video_url: replayUrl(e.replay_video_url),
          player: Array.isArray(e.player) ? e.player[0] : e.player,
          team: Array.isArray(e.team) ? e.team[0] : e.team,
        })) as unknown as MatchEventItem[];

      if (!request.signal.aborted) setMatchEvents(goalsAndReplays);
    } catch (err) {
      if (!request.signal.aborted) setEventsError(true);
    } finally {
      if (!request.signal.aborted) setLoadingEvents(false);
    }
  };

  const handleSaveReplay = async (event: MatchEventItem) => {
    const url = event.replay_video_url;
    if (!url || saving.current) return;
    if (Platform.OS === 'web') {
      await WebBrowser.openBrowserAsync(url);
      return;
    }
    saving.current = true;
    setPlayingId(null);
    setDownloadingEventId(event.id);
    triggerIosCrescendoHaptic();
    try {
      const extension = new URL(url).pathname.match(/\.(mov|m4v|webm)$/i)?.[1].toLowerCase() ?? 'mp4';
      await saveReplayToGallery(url, `AMATORA-Replay-${Date.now()}.${extension}`);
      Alert.alert('Video saqlandi', "Replayni telefon galereyasidan topasiz.");
    } catch (error) {
      if (error instanceof GalleryPermissionError) {
        Alert.alert('Galereya ruxsati', "Sozlamalarda galereyaga video qo'shish uchun ruxsat bering.");
      } else {
        Alert.alert('Video saqlanmadi', "Internet va galereya ruxsatini tekshirib, yana urinib ko'ring.");
      }
    } finally {
      saving.current = false;
      setDownloadingEventId(null);
    }
  };

  const resetFilters = () => {
    triggerIosCrescendoHaptic();
    setFilterType('all');
    setSelectedLeague('all');
    setSelectedTournament('all');
    setSelectedRound('all');
    setSearchQuery('');
    setOnlyWithReplays(false);
  };

  const totalReplays = useMemo(() => {
    let c = 0;
    matchReplaysCount.forEach((v) => { c += v; });
    return c;
  }, [matchReplaysCount]);

  const matchesWithReplays = useMemo(() => {
    let c = 0;
    matchReplaysCount.forEach((v) => { if (v > 0) c++; });
    return c;
  }, [matchReplaysCount]);

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
      {/* Header Bar */}
      <View style={[styles.headerBar, { borderBottomColor: isDark ? '#1e293b' : '#e2e8f0' }]}>
        <View style={styles.headerLeft}>
          {onBack && (
            <TouchableOpacity style={styles.btnBack} onPress={onBack}>
              <Ionicons name="arrow-back" size={24} color={isDark ? '#fff' : '#0f172a'} />
            </TouchableOpacity>
          )}
          <View>
            <Text style={[styles.headerTitle, { color: isDark ? '#fff' : '#0f172a' }]}>
              Replaylar & Gollar
            </Text>
            <Text style={styles.headerSub}>Montaj va tahlil uchun videolarni olish</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.btnFilterToggle, isFilterOpen && styles.btnFilterToggleActive]}
            onPress={() => {
              triggerIosCrescendoHaptic();
              setIsFilterOpen(!isFilterOpen);
            }}
          >
            <Ionicons name="filter" size={18} color={isFilterOpen ? '#fff' : '#10b981'} />
            <Text style={[styles.filterToggleText, { color: isFilterOpen ? '#fff' : '#10b981' }]}>
              Filtr
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats Ribbon */}
      <View style={styles.statsRibbon}>
        <View style={[styles.statBox, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
          <Text style={styles.statNum}>{totalReplays}</Text>
          <Text style={styles.statLabel}>Yuklangan replaylar</Text>
        </View>
        <View style={[styles.statBox, styles.statBoxActive]}>
          <Text style={[styles.statNum, { color: '#10b981' }]}>{matchesWithReplays}</Text>
          <Text style={styles.statLabel}>Replayli O'yinlar</Text>
        </View>
      </View>

      {Platform.OS !== 'web' && orgId !== null && (
        <TouchableOpacity accessibilityRole="button" onPress={() => setHighlightOpen(true)}
          style={styles.highlightEntry}>
          <Ionicons name="film-outline" size={21} color="#9af4cf" />
          <View style={{ flex: 1 }}>
            <Text style={styles.highlightTitle}>Top 5 / Top 10 gollar</Text>
            <Text style={styles.highlightSub}>{clips.length ? `${clips.length} ta gol tanlandi` : "Kliplarni tanlang va highlight yarating"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9af4cf" />
        </TouchableOpacity>
      )}

      {/* Collapsible Filters Card */}
      {isFilterOpen && (
        <View style={[styles.filterCard, { backgroundColor: isDark ? '#1e293b' : '#fff', borderColor: isDark ? '#334155' : '#e2e8f0' }]}>
          {/* Search team input */}
          <View style={[styles.searchBox, { backgroundColor: isDark ? '#0f172a' : '#f1f5f9' }]}>
            <Ionicons name="search" size={16} color="#94a3b8" />
            <TextInput
              style={[styles.searchInput, { color: isDark ? '#fff' : '#1e293b' }]}
              placeholder="Jamoa nomi bo'yicha qidirish..."
              placeholderTextColor="#94a3b8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Filter Select Buttons Row */}
          <View style={styles.pickerButtonsRow}>
            {/* Type */}
            <TouchableOpacity
              style={[styles.pickerBtn, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}
              onPress={() => setPickerModalType('type')}
            >
              <Text style={styles.pickerBtnLabel}>Turi:</Text>
              <Text style={[styles.pickerBtnValue, { color: isDark ? '#fff' : '#1e293b' }]} numberOfLines={1}>
                {filterType === 'all' ? 'Barchasi' : filterType === 'league' ? 'Ligalar' : 'Turnirlar'}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#64748b" />
            </TouchableOpacity>

            {/* League or Tournament */}
            {filterType !== 'tournament' ? (
              <TouchableOpacity
                style={[styles.pickerBtn, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}
                onPress={() => setPickerModalType('league')}
              >
                <Text style={styles.pickerBtnLabel}>Liga:</Text>
                <Text style={[styles.pickerBtnValue, { color: isDark ? '#fff' : '#1e293b' }]} numberOfLines={1}>
                  {selectedLeague === 'all' ? 'Barchasi' : selectedLeague}
                </Text>
                <Ionicons name="chevron-down" size={14} color="#64748b" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.pickerBtn, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}
                onPress={() => setPickerModalType('tournament')}
              >
                <Text style={styles.pickerBtnLabel}>Turnir:</Text>
                <Text style={[styles.pickerBtnValue, { color: isDark ? '#fff' : '#1e293b' }]} numberOfLines={1}>
                  {selectedTournament === 'all'
                    ? 'Barchasi'
                    : tournaments.find((t) => String(t.id) === selectedTournament)?.name || 'Turnir'}
                </Text>
                <Ionicons name="chevron-down" size={14} color="#64748b" />
              </TouchableOpacity>
            )}

            {/* Round */}
            <TouchableOpacity
              style={[styles.pickerBtn, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}
              onPress={() => setPickerModalType('round')}
            >
              <Text style={styles.pickerBtnLabel}>Tur:</Text>
              <Text style={[styles.pickerBtnValue, { color: isDark ? '#fff' : '#1e293b' }]} numberOfLines={1}>
                {selectedRound === 'all' ? 'Barchasi' : `${selectedRound}-Tur`}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Toggle Only Replays & Reset */}
          <View style={styles.filterFooterRow}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => {
                triggerIosCrescendoHaptic();
                setOnlyWithReplays(!onlyWithReplays);
              }}
            >
              <Ionicons
                name={onlyWithReplays ? 'checkbox' : 'square-outline'}
                size={20}
                color="#10b981"
              />
              <Text style={[styles.checkboxText, { color: isDark ? '#cbd5e1' : '#334155' }]}>
                Faqat replayli o'yinlar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnReset} onPress={resetFilters}>
              <Text style={styles.btnResetText}>Tozalash</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Matches List */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={[styles.loadingText, { color: isDark ? '#cbd5e1' : '#64748b' }]}>
            O'yinlar yuklanmoqda...
          </Text>
        </View>
      ) : list.isError && !list.data ? (
        <View style={styles.loadingBox}>
          <Text style={[styles.loadingText, { color: colors.textPrimary }]}>O'yinlarni yuklab bo'lmadi.</Text>
          <TouchableOpacity style={[styles.btnDownload, { flex: 0, marginTop: 12, paddingHorizontal: 16 }]} onPress={handleRefresh}>
            <Text style={styles.btnDownloadText}>Qayta urinish</Text>
          </TouchableOpacity>
        </View>
      ) : filteredMatches.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="videocam-off-outline" size={48} color="#94a3b8" />
          <Text style={[styles.emptyTitle, { color: isDark ? '#fff' : '#1e293b' }]}>
            Replayli o'yin topilmadi
          </Text>
          <Text style={styles.emptySubtitle}>
            Filtrlarni o'zgartirib yoki tozalab ko'ring
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredMatches}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#10b981" />
          }
          contentContainerStyle={styles.listContent}
          initialNumToRender={5}
          onEndReachedThreshold={0.25}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetching && !list.isFetchNextPageError) {
              void list.fetchNextPage({ cancelRefetch: false });
            }
          }}
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color="#10b981" /> :
            list.hasNextPage ? <TouchableOpacity style={styles.btnDownload} onPress={() => void list.fetchNextPage({ cancelRefetch: false })}>
              <Text style={styles.btnDownloadText}>{list.isFetchNextPageError ? 'Qayta urinish' : "Yana 5 ta o'yin"}</Text>
            </TouchableOpacity> : undefined}
          renderItem={({ item }) => {
            const replaysCount = matchReplaysCount.get(item.id) || 0;
            const homeTeam = teamsMap.get(String(item.home_team_id));
            const awayTeam = teamsMap.get(String(item.away_team_id));
            const isLive = item.status === 'live' || item.status === 'first_half' || item.status === 'second_half';

            return (
              <TouchableOpacity
                style={[
                  styles.matchCard,
                  {
                    backgroundColor: isDark ? '#1e293b' : '#fff',
                    borderColor: replaysCount > 0 ? '#10b981' : isDark ? '#334155' : '#e2e8f0',
                  },
                ]}
                activeOpacity={0.7}
                onPress={() => handleSelectMatch(item)}
              >
                {/* Top Info Header */}
                <View style={styles.cardHeader}>
                  <View style={styles.badgeGroup}>
                    {item.tournament_id ? (
                      <View style={styles.badgeTournament}>
                        <Text style={styles.badgeTournamentText}>Turnir</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeLeague}>
                        <Text style={styles.badgeLeagueText}>{item.league || 'Liga'}</Text>
                      </View>
                    )}
                    {item.round != null && item.round !== '' && (
                      <View style={styles.badgeRound}>
                        <Text style={styles.badgeRoundText}>
                          {getStageDisplayTitle(item.stage, item.round)}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.matchDateBox}>
                    <Ionicons name="calendar-outline" size={12} color="#94a3b8" />
                    <Text style={styles.matchDateText}>{item.match_date}</Text>
                  </View>
                </View>

                {/* Teams & Score Row */}
                <View style={styles.cardTeamsRow}>
                  {/* Home */}
                  <View style={styles.teamBlock}>
                    {homeTeam?.logo_url ? (
                      <ExpoImage source={{ uri: homeTeam.logo_url }} style={styles.teamLogo} contentFit="contain" />
                    ) : (
                      <View style={styles.teamLogoPlaceholder}>
                        <Text style={styles.placeholderEmoji}>⚽</Text>
                      </View>
                    )}
                    <Text style={[styles.teamName, { color: isDark ? '#fff' : '#0f172a' }]} numberOfLines={1}>
                      {homeTeam?.name || 'Home'}
                    </Text>
                  </View>

                  {/* Score */}
                  <View style={styles.scoreBlock}>
                    <Text style={[styles.scoreText, { color: isDark ? '#fff' : '#0f172a' }]}>
                      {item.home_score ?? 0} : {item.away_score ?? 0}
                    </Text>
                    {isLive ? (
                      <View style={styles.liveBadge}>
                        <Text style={styles.liveBadgeText}>● Jonli</Text>
                      </View>
                    ) : (
                      <Text style={styles.statusSubText}>
                        {item.status === 'finished' ? 'Tugagan' : 'Kutilmoqda'}
                      </Text>
                    )}
                  </View>

                  {/* Away */}
                  <View style={styles.teamBlock}>
                    {awayTeam?.logo_url ? (
                      <ExpoImage source={{ uri: awayTeam.logo_url }} style={styles.teamLogo} contentFit="contain" />
                    ) : (
                      <View style={styles.teamLogoPlaceholder}>
                        <Text style={styles.placeholderEmoji}>⚽</Text>
                      </View>
                    )}
                    <Text style={[styles.teamName, { color: isDark ? '#fff' : '#0f172a' }]} numberOfLines={1}>
                      {awayTeam?.name || 'Away'}
                    </Text>
                  </View>
                </View>

                {/* Bottom Bar: Replay Count & Action */}
                <View style={[styles.cardFooter, { borderTopColor: isDark ? '#334155' : '#f1f5f9' }]}>
                  {replaysCount > 0 ? (
                    <View style={styles.replayCountBadgeActive}>
                      <Ionicons name="film" size={14} color="#065f46" />
                      <Text style={styles.replayCountTextActive}>{replaysCount} ta replay video</Text>
                    </View>
                  ) : (
                    <View style={styles.replayCountBadgeEmpty}>
                      <Text style={styles.replayCountTextEmpty}>Replaysiz</Text>
                    </View>
                  )}

                  <View style={styles.openDetailsAction}>
                    <Text style={styles.openDetailsText}>Gollarni ko'rish</Text>
                    <Ionicons name="chevron-forward" size={16} color="#10b981" />
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Match Replays Detail Modal */}
      <Modal visible={Boolean(selectedMatch)} animationType="slide" onRequestClose={closeMatch}>
        <SafeAreaProvider>
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: isDark ? '#1e293b' : '#e2e8f0' }]}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ortga" style={styles.btnModalClose} onPress={closeMatch}>
              <Ionicons name="arrow-back" size={24} color={isDark ? '#fff' : '#0f172a'} />
            </TouchableOpacity>
            <View style={styles.modalHeaderCenter}>
              <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#0f172a' }]}>
                O'yin Replaylari
              </Text>
              <Text style={styles.modalSubtitle}>
                {selectedMatch?.match_date} • {selectedMatch?.league || 'Turnir'}
              </Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* Modal Content */}
          <ScrollView contentContainerStyle={styles.modalScrollContent}>
            {/* Match Scoreboard Summary */}
            {selectedMatch && (
              <LinearGradient
                colors={['#1e293b', '#0f172a']}
                style={styles.modalScoreCard}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <View style={styles.scoreCardSide}>
                  {teamsMap.get(String(selectedMatch.home_team_id))?.logo_url ? (
                    <ExpoImage
                      source={{ uri: teamsMap.get(String(selectedMatch.home_team_id))?.logo_url ?? undefined }}
                      style={styles.scoreCardLogo}
                      contentFit="contain"
                    />
                  ) : (
                    <Text style={{ fontSize: 24 }}>⚽</Text>
                  )}
                  <Text style={styles.scoreCardTeamName}>
                    {teamsMap.get(String(selectedMatch.home_team_id))?.name || 'Home'}
                  </Text>
                </View>

                <View style={styles.scoreCardCenter}>
                  <Text style={styles.scoreCardNumbers}>
                    {selectedMatch.home_score ?? 0} : {selectedMatch.away_score ?? 0}
                  </Text>
                  <Text style={styles.scoreCardStatus}>
                    {selectedMatch.status === 'finished' ? 'Tugagan' : 'O\'yin'}
                  </Text>
                </View>

                <View style={styles.scoreCardSide}>
                  {teamsMap.get(String(selectedMatch.away_team_id))?.logo_url ? (
                    <ExpoImage
                      source={{ uri: teamsMap.get(String(selectedMatch.away_team_id))?.logo_url ?? undefined }}
                      style={styles.scoreCardLogo}
                      contentFit="contain"
                    />
                  ) : (
                    <Text style={{ fontSize: 24 }}>⚽</Text>
                  )}
                  <Text style={styles.scoreCardTeamName}>
                    {teamsMap.get(String(selectedMatch.away_team_id))?.name || 'Away'}
                  </Text>
                </View>
              </LinearGradient>
            )}

            {/* Replay Events List */}
            <View style={styles.replaysHeaderRow}>
              <Ionicons name="videocam" size={20} color="#10b981" />
              <Text style={[styles.replaysSectionTitle, { color: isDark ? '#fff' : '#0f172a' }]}>
                Gollar va Replay Videolari ({matchEvents.length})
              </Text>
            </View>

            {loadingEvents ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#10b981" />
                <Text style={[styles.loadingText, { color: isDark ? '#cbd5e1' : '#64748b' }]}>
                  Replaylar yuklanmoqda...
                </Text>
              </View>
            ) : eventsError ? (
              <View style={styles.emptyBox}>
                <Text style={[styles.loadingText, { color: colors.textPrimary }]}>Replaylarni yuklab bo'lmadi.</Text>
                <TouchableOpacity onPress={() => selectedMatch && void handleSelectMatch(selectedMatch)}>
                  <Text style={styles.openDetailsText}>Qayta urinish</Text>
                </TouchableOpacity>
              </View>
            ) : matchEvents.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="film-outline" size={44} color="#94a3b8" />
                <Text style={[styles.emptyTitle, { color: isDark ? '#fff' : '#1e293b' }]}>
                  Ushbu o'yinda replay videolari yo'q
                </Text>
                <Text style={styles.emptySubtitle}>
                  OBS orqali gol urilganda replay videolari avtomatik saqlanadi.
                </Text>
              </View>
            ) : (
              matchEvents.map((ev) => {
                const hasVideo = Boolean(ev.replay_video_url);
                const player = ev.player;
                const team = ev.team;
                const isDownloading = downloadingEventId === ev.id;

                return (
                  <View
                    key={ev.id}
                    style={[
                      styles.replayItemCard,
                      { backgroundColor: isDark ? '#1e293b' : '#fff', borderColor: isDark ? '#334155' : '#e2e8f0' },
                    ]}
                  >
                    {/* Video Preview Box (Lazy action) */}
                    <View style={styles.videoPreviewBox}>
                      {playingId === ev.id && ev.replay_video_url ? (
                        <ReplayPlayback key={ev.id} uri={ev.replay_video_url} onClose={() => setPlayingId(null)} />
                      ) : hasVideo ? (
                        <TouchableOpacity
                          style={styles.videoPlayOverlay}
                          activeOpacity={0.8}
                          onPress={() => setPlayingId(ev.id)}
                        >
                          <LinearGradient
                            colors={['rgba(15,23,42,0.6)', '#0f172a']}
                            style={styles.videoGradientBox}
                          >
                            <View style={styles.playIconCircle}>
                              <Ionicons name="play" size={28} color="#fff" />
                            </View>
                            <Text style={styles.playVideoHint}>Videoni ko'rish</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.noVideoBox}>
                          <Ionicons name="videocam-off" size={28} color="#94a3b8" />
                          <Text style={styles.noVideoText}>Video biriktirilmagan</Text>
                        </View>
                      )}
                    </View>

                    {/* Author (Player & Team Details) */}
                    <View style={styles.replayMetaBox}>
                      <View style={styles.authorRow}>
                        {player?.photo_url ? (
                          <ExpoImage source={{ uri: player.photo_url }} style={styles.authorAvatar} />
                        ) : (
                          <View style={styles.authorAvatarPlaceholder}>
                            <Text style={styles.authorInitial}>
                              {player ? `${player.first_name?.[0] || ''}${player.last_name?.[0] || ''}` : '⚽'}
                            </Text>
                          </View>
                        )}

                        <View style={styles.authorTextInfo}>
                          <View style={styles.authorNameRow}>
                            <Text style={[styles.authorName, { color: isDark ? '#fff' : '#0f172a' }]}>
                              {player ? `${player.first_name} ${player.last_name}` : 'Muallifsiz gol'}
                              {player?.player_number != null ? ` #${player.player_number}` : ''}
                            </Text>
                            {ev.minute != null && (
                              <View style={styles.minuteTag}>
                                <Text style={styles.minuteTagText}>{ev.minute}'</Text>
                              </View>
                            )}
                            {ev.event_type === 'penalty_goal' && (
                              <View style={[styles.typeTag, styles.typeTagPenalty]}>
                                <Text style={styles.typeTagPenaltyText}>Penalti</Text>
                              </View>
                            )}
                            {ev.event_type === 'own_goal' && (
                              <View style={[styles.typeTag, styles.typeTagOwnGoal]}>
                                <Text style={styles.typeTagOwnGoalText}>Avtogol</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.authorTeamSub}>{team?.name || 'Jamoa'}</Text>
                        </View>
                      </View>

                      {hasVideo && Platform.OS !== 'web' && ['goal', 'penalty_goal', 'own_goal'].includes(ev.event_type) && (
                        <TouchableOpacity accessibilityRole="checkbox"
                          accessibilityState={{ checked: clips.some(clip => clip.id === ev.id) }}
                          style={styles.highlightPick} onPress={() => toggleClip(ev)}>
                          <Ionicons name={clips.some(clip => clip.id === ev.id) ? 'checkmark-circle' : 'add-circle-outline'}
                            size={20} color={isDark ? '#89f5c8' : '#087c58'} />
                          <Text style={{ color: isDark ? '#89f5c8' : '#087c58', fontWeight: '800' }}>
                            {clips.some(clip => clip.id === ev.id) ? "Montaj uchun tanlandi" : `Top ${highlightSize} uchun tanlash`}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {/* Actions: Download / Share Video */}
                      {hasVideo && selectedMatch && (
                        <View style={styles.actionButtonsRow}>
                          <TouchableOpacity
                            style={[styles.btnDownload, isDownloading && { opacity: 0.7 }]}
                            onPress={() => handleSaveReplay(ev)}
                            disabled={downloadingEventId !== null}
                          >
                            {isDownloading ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Ionicons name="download-outline" size={18} color="#fff" />
                            )}
                            <Text style={styles.btnDownloadText}>
                              {isDownloading ? 'Yuklanmoqda...' : 'Galereyaga saqlash'}
                            </Text>
                          </TouchableOpacity>

                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      <Modal visible={highlightOpen} animationType="slide" onRequestClose={() => setHighlightOpen(false)}>
        <SafeAreaProvider>
          <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
            <ScrollView contentContainerStyle={styles.modalScrollContent}>
              {highlightOpen && orgId !== null && <HighlightEditor organizationId={orgId} clips={clips} size={highlightSize}
                dark={isDark} onSize={setHighlightSize} onClose={() => setHighlightOpen(false)}
                onRemove={id => setClips(items => items.filter(item => item.id !== id))}
                onMove={(index, delta) => setClips(items => {
                  const next = index + delta;
                  if (next < 0 || next >= items.length) return items;
                  const ordered = [...items];
                  [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
                  return ordered;
                })} />}
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      {/* Select Picker Modal (Type, League, Tournament, Round) */}
      <Modal visible={pickerModalType !== 'none'} transparent animationType="fade" onRequestClose={() => setPickerModalType('none')}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setPickerModalType('none')}
        >
          <View style={[styles.pickerModalContent, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
            <View style={styles.pickerModalHeader}>
              <Text style={[styles.pickerModalTitle, { color: isDark ? '#fff' : '#0f172a' }]}>
                {pickerModalType === 'type'
                  ? 'Musobaqa turini tanlang'
                  : pickerModalType === 'league'
                  ? 'Ligani tanlang'
                  : pickerModalType === 'tournament'
                  ? 'Turnirni tanlang'
                  : 'Turni tanlang'}
              </Text>
              <TouchableOpacity onPress={() => setPickerModalType('none')}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 350 }}>
              {/* Type items */}
              {pickerModalType === 'type' && (
                <>
                  <TouchableOpacity
                    style={styles.pickerOptionItem}
                    onPress={() => {
                      setFilterType('all');
                      setSelectedLeague('all');
                      setSelectedTournament('all');
                      setPickerModalType('none');
                    }}
                  >
                    <Text style={[styles.pickerOptionText, filterType === 'all' && styles.pickerOptionActive]}>
                      Barchasi (Liga & Turnir)
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pickerOptionItem}
                    onPress={() => {
                      setFilterType('league');
                      setSelectedRound('all');
                      setSelectedTournament('all');
                      setPickerModalType('none');
                    }}
                  >
                    <Text style={[styles.pickerOptionText, filterType === 'league' && styles.pickerOptionActive]}>
                      Faqat Ligalar
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pickerOptionItem}
                    onPress={() => {
                      setFilterType('tournament');
                      setSelectedRound('all');
                      setSelectedLeague('all');
                      setPickerModalType('none');
                    }}
                  >
                    <Text style={[styles.pickerOptionText, filterType === 'tournament' && styles.pickerOptionActive]}>
                      Faqat Turnirlar
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {/* League items */}
              {pickerModalType === 'league' && (
                <>
                  <TouchableOpacity
                    style={styles.pickerOptionItem}
                    onPress={() => {
                      setSelectedLeague('all');
                      setPickerModalType('none');
                    }}
                  >
                    <Text style={[styles.pickerOptionText, selectedLeague === 'all' && styles.pickerOptionActive]}>
                      Barcha Ligalar
                    </Text>
                  </TouchableOpacity>
                  {leagues.map((l) => (
                    <TouchableOpacity
                      key={l.id || l.name}
                      style={styles.pickerOptionItem}
                      onPress={() => {
                        setSelectedLeague(l.name);
                        setSelectedRound('all');
                        setPickerModalType('none');
                      }}
                    >
                      <Text
                        style={[styles.pickerOptionText, selectedLeague === l.name && styles.pickerOptionActive]}
                      >
                        {l.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {/* Tournament items */}
              {pickerModalType === 'tournament' && (
                <>
                  <TouchableOpacity
                    style={styles.pickerOptionItem}
                    onPress={() => {
                      setSelectedTournament('all');
                      setPickerModalType('none');
                    }}
                  >
                    <Text style={[styles.pickerOptionText, selectedTournament === 'all' && styles.pickerOptionActive]}>
                      Barcha Turnirlar
                    </Text>
                  </TouchableOpacity>
                  {tournaments.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.pickerOptionItem}
                      onPress={() => {
                        setSelectedTournament(String(t.id));
                        setSelectedRound('all');
                        setPickerModalType('none');
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          selectedTournament === String(t.id) && styles.pickerOptionActive,
                        ]}
                      >
                        {t.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {/* Round items */}
              {pickerModalType === 'round' && (
                <>
                  <TouchableOpacity
                    style={styles.pickerOptionItem}
                    onPress={() => {
                      setSelectedRound('all');
                      setPickerModalType('none');
                    }}
                  >
                    <Text style={[styles.pickerOptionText, selectedRound === 'all' && styles.pickerOptionActive]}>
                      Barcha Turlar
                    </Text>
                  </TouchableOpacity>
                  {availableRounds.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={styles.pickerOptionItem}
                      onPress={() => {
                        setSelectedRound(r);
                        setPickerModalType('none');
                      }}
                    >
                      <Text style={[styles.pickerOptionText, selectedRound === r && styles.pickerOptionActive]}>
                        {r}-Tur
                      </Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  highlightEntry: { marginHorizontal: 16, marginBottom: 12, padding: 13, borderRadius: 14, gap: 10,
    backgroundColor: '#123c34', flexDirection: 'row', alignItems: 'center' },
  highlightTitle: { color: '#f1fff7', fontSize: 14, fontWeight: '900' },
  highlightSub: { color: '#b1ddcd', fontSize: 12, marginTop: 3 },
  highlightPick: { minHeight: 44, borderRadius: 8, backgroundColor: '#10b98119', flexDirection: 'row',
    alignItems: 'center', paddingHorizontal: 10, gap: 7 },
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  btnBack: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btnFilterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  btnFilterToggleActive: {
    backgroundColor: '#10b981',
  },
  filterToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statsRibbon: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  statBox: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  statBoxActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  statNum: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f766e',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  filterCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 4,
  },
  pickerButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  pickerBtn: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerBtnLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
  },
  pickerBtnValue: {
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
    marginHorizontal: 4,
  },
  filterFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkboxText: {
    fontSize: 12,
    fontWeight: '600',
  },
  btnReset: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  btnResetText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 12,
  },
  matchCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  badgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeLeague: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeLeagueText: {
    color: '#0369a1',
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTournament: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeTournamentText: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: '700',
  },
  badgeRound: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeRoundText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
  },
  matchDateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  matchDateText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
  },
  cardTeamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  teamBlock: {
    flex: 1,
    alignItems: 'center',
    maxWidth: 90,
  },
  teamLogo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginBottom: 4,
  },
  teamLogoPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  placeholderEmoji: {
    fontSize: 16,
  },
  teamName: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  scoreBlock: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  scoreText: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  liveBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
  liveBadgeText: {
    color: '#dc2626',
    fontSize: 10,
    fontWeight: '800',
  },
  statusSubText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 8,
  },
  replayCountBadgeActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#d1fae5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  replayCountTextActive: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065f46',
  },
  replayCountBadgeEmpty: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  replayCountTextEmpty: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
  },
  openDetailsAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  openDetailsText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10b981',
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
  },
  emptyBox: {
    padding: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    textAlign: 'center',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  btnModalClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderCenter: {
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
  },
  modalScrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  modalScoreCard: {
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  scoreCardSide: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  scoreCardLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  scoreCardTeamName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  scoreCardCenter: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  scoreCardNumbers: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
  },
  scoreCardStatus: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    marginTop: 2,
  },
  replaysHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  replaysSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  replayItemCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 16,
  },
  videoPreviewBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayOverlay: {
    width: '100%',
    height: '100%',
  },
  videoGradientBox: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  playVideoHint: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  noVideoBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  noVideoText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  authorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  minuteTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 6,
  },
  minuteTagText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '800',
  },
  typeTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
  },
  typeTagPenalty: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  typeTagPenaltyText: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '700',
  },
  typeTagOwnGoal: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  typeTagOwnGoalText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '700',
  },
  replayMetaBox: {
    padding: 14,
    gap: 10,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  authorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#10b981',
  },
  authorAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorInitial: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  authorTextInfo: {
    flex: 1,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '800',
  },
  authorTeamSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  assistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  assistLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  assistName: {
    fontSize: 11,
    color: '#1e3a8a',
    fontWeight: '700',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  btnDownload: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#10b981',
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnDownloadText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  btnWatchBrowser: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  // Picker modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pickerModalContent: {
    width: '100%',
    borderRadius: 16,
    padding: 16,
  },
  pickerModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  pickerModalTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  pickerOptionItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pickerOptionText: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '500',
  },
  pickerOptionActive: {
    color: '#10b981',
    fontWeight: '800',
  },
});
