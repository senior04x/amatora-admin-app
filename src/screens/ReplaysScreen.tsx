import React, { useState, useEffect, useMemo } from 'react';
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
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
  assist_player?: {
    id: string;
    first_name: string;
    last_name: string;
    player_number?: string | number | null;
  } | null;
  team?: {
    id: string | number;
    name: string;
    logo_url?: string | null;
  } | null;
}

export function ReplaysScreen({ onBack }: { onBack?: () => void }) {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const { isDark, colors } = useTheme();

  // Data states
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [teamsMap, setTeamsMap] = useState<Map<string | number, any>>(new Map());
  const [leagues, setLeagues] = useState<any[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [matchReplaysCount, setMatchReplaysCount] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter states
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'league' | 'tournament'>('all');
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedTournament, setSelectedTournament] = useState<string>('all');
  const [selectedRound, setSelectedRound] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithReplays, setOnlyWithReplays] = useState(true);

  // Detail Modal state
  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null);
  const [matchEvents, setMatchEvents] = useState<MatchEventItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [downloadingEventId, setDownloadingEventId] = useState<string | null>(null);

  // Dropdown Picker Modal
  const [pickerModalType, setPickerModalType] = useState<'none' | 'type' | 'league' | 'tournament' | 'round'>('none');

  useEffect(() => {
    if (!orgId) return;
    loadAllData();
  }, [orgId]);

  const loadAllData = async () => {
    try {
      setLoading(true);

      // 1. Fetch Tournaments
      const tournamentsData = await getActiveOrgTournaments(orgId);
      setTournaments(tournamentsData || []);

      // 2. Fetch Leagues
      const { data: leaguesData } = await supabase
        .from('leagues')
        .select('*')
        .eq('organization_id', orgId);
      setLeagues(leaguesData || []);

      // 3. Fetch Teams
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, name, logo_url, league, organization_id')
        .eq('organization_id', orgId);

      const tMap = new Map();
      (teamsData || []).forEach((t: any) => tMap.set(t.id, t));
      setTeamsMap(tMap);

      // 4. Fetch Matches
      const { data: matchesData, error: mErr } = await supabase
        .from('matches')
        .select('id, league, tournament_id, round, stage, home_team_id, away_team_id, home_score, away_score, match_date, match_time, status, organization_id')
        .eq('organization_id', orgId)
        .order('match_date', { ascending: false })
        .order('match_time', { ascending: false });

      if (mErr) throw mErr;
      const loadedMatches = (matchesData || []) as MatchItem[];
      setMatches(loadedMatches);

      // 5. Fetch Replay count per match
      if (loadedMatches.length > 0) {
        const matchIds = loadedMatches.map((m) => m.id);
        const { data: replayEvents } = await supabase
          .from('match_events')
          .select('match_id, id')
          .in('match_id', matchIds)
          .not('replay_video_url', 'is', null);

        const rMap = new Map<string, number>();
        (replayEvents || []).forEach((ev: any) => {
          rMap.set(ev.match_id, (rMap.get(ev.match_id) || 0) + 1);
        });
        setMatchReplaysCount(rMap);
      }
    } catch (err) {
      console.warn('Error loading replays in mobile admin:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    triggerIosCrescendoHaptic();
    loadAllData();
  };

  const handleSelectMatch = async (match: MatchItem) => {
    triggerIosCrescendoHaptic();
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
          assist_player_id,
          player:player_id (id, first_name, last_name, player_number, photo_url),
          team:team_id (id, name, logo_url)
        `)
        .eq('match_id', match.id)
        .order('minute', { ascending: true })
        .order('created_at', { ascending: true });

      if (evErr) throw evErr;

      const goalsAndReplays = (eventsData || [])
        .filter((e: any) => ['goal', 'penalty_goal', 'own_goal'].includes(e.event_type) || e.replay_video_url)
        .map((e: any) => ({
          ...e,
          player: Array.isArray(e.player) ? e.player[0] : e.player,
          team: Array.isArray(e.team) ? e.team[0] : e.team,
        })) as unknown as MatchEventItem[];

      setMatchEvents(goalsAndReplays);
    } catch (err) {
      console.warn('Error fetching match events:', err);
    } finally {
      setLoadingEvents(false);
    }
  };

  // Available rounds
  const availableRounds = useMemo(() => {
    const rounds = new Set<string>();
    matches.forEach((m) => {
      if (m.round !== null && m.round !== undefined) {
        rounds.add(String(m.round));
      }
    });
    return Array.from(rounds).sort((a, b) => Number(a) - Number(b));
  }, [matches]);

  // Filter matches
  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      const replaysCount = matchReplaysCount.get(m.id) || 0;
      if (onlyWithReplays && replaysCount === 0) return false;

      if (filterType === 'league' && m.tournament_id) return false;
      if (filterType === 'tournament' && !m.tournament_id) return false;

      if (selectedLeague !== 'all' && m.league !== selectedLeague) return false;
      if (selectedTournament !== 'all' && String(m.tournament_id) !== String(selectedTournament)) return false;
      if (selectedRound !== 'all' && String(m.round) !== String(selectedRound)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const homeName = teamsMap.get(m.home_team_id || '')?.name?.toLowerCase() || '';
        const awayName = teamsMap.get(m.away_team_id || '')?.name?.toLowerCase() || '';
        const leagueName = (m.league || '').toLowerCase();
        if (!homeName.includes(q) && !awayName.includes(q) && !leagueName.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [matches, matchReplaysCount, onlyWithReplays, filterType, selectedLeague, selectedTournament, selectedRound, searchQuery, teamsMap]);

  // Watch video in browser or native player
  const handleWatchVideo = async (url?: string | null) => {
    if (!url) return;
    try {
      triggerIosCrescendoHaptic();
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      Alert.alert('Xatolik', 'Videoni ochib bo\'lmadi');
    }
  };

  // Download and share/save video
  const handleDownloadAndShare = async (event: MatchEventItem, match: MatchItem) => {
    if (!event.replay_video_url) return;
    setDownloadingEventId(event.id);
    triggerIosCrescendoHaptic();

    try {
      const homeTeam = teamsMap.get(match.home_team_id || '')?.name || 'Home';
      const awayTeam = teamsMap.get(match.away_team_id || '')?.name || 'Away';
      const playerName = event.player ? `${event.player.first_name}_${event.player.last_name}` : 'Goal';
      const minute = event.minute ? `${event.minute}m` : 'Replay';
      const safeFilename = `${minute}_${homeTeam}_vs_${awayTeam}_${playerName}.mp4`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

      const fileUri = `${FileSystem.cacheDirectory}${safeFilename}`;

      const downloadResult = await FileSystem.downloadAsync(event.replay_video_url, fileUri);

      if (downloadResult.status !== 200) {
        throw new Error('Yuklab olishda xatolik yuz berdi');
      }

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(downloadResult.uri, {
          mimeType: 'video/mp4',
          dialogTitle: 'Videoni montaj uchun saqlash yoki yuborish',
          UTI: 'public.mpeg-4',
        });
      } else {
        Alert.alert('Muvaffaqiyatli', `Video yuklandi: ${downloadResult.uri}`);
      }
    } catch (err: any) {
      Alert.alert('Xatolik', err?.message || 'Videoni yuklab olishda muammo yuz berdi');
    } finally {
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
    setOnlyWithReplays(true);
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
          <Text style={styles.statLabel}>Jami Replaylar</Text>
        </View>
        <View style={[styles.statBox, styles.statBoxActive]}>
          <Text style={[styles.statNum, { color: '#10b981' }]}>{matchesWithReplays}</Text>
          <Text style={styles.statLabel}>Replayli O'yinlar</Text>
        </View>
      </View>

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
          initialNumToRender={8}
          renderItem={({ item }) => {
            const replaysCount = matchReplaysCount.get(item.id) || 0;
            const homeTeam = teamsMap.get(item.home_team_id || '');
            const awayTeam = teamsMap.get(item.away_team_id || '');
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
                    {item.round && (
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
      <Modal visible={Boolean(selectedMatch)} animationType="slide" transparent={false}>
        <View style={[styles.modalContainer, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: isDark ? '#1e293b' : '#e2e8f0' }]}>
            <TouchableOpacity style={styles.btnModalClose} onPress={() => setSelectedMatch(null)}>
              <Ionicons name="close" size={24} color={isDark ? '#fff' : '#0f172a'} />
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
                  {teamsMap.get(selectedMatch.home_team_id || '')?.logo_url ? (
                    <ExpoImage
                      source={{ uri: teamsMap.get(selectedMatch.home_team_id || '')?.logo_url }}
                      style={styles.scoreCardLogo}
                      contentFit="contain"
                    />
                  ) : (
                    <Text style={{ fontSize: 24 }}>⚽</Text>
                  )}
                  <Text style={styles.scoreCardTeamName}>
                    {teamsMap.get(selectedMatch.home_team_id || '')?.name || 'Home'}
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
                  {teamsMap.get(selectedMatch.away_team_id || '')?.logo_url ? (
                    <ExpoImage
                      source={{ uri: teamsMap.get(selectedMatch.away_team_id || '')?.logo_url }}
                      style={styles.scoreCardLogo}
                      contentFit="contain"
                    />
                  ) : (
                    <Text style={{ fontSize: 24 }}>⚽</Text>
                  )}
                  <Text style={styles.scoreCardTeamName}>
                    {teamsMap.get(selectedMatch.away_team_id || '')?.name || 'Away'}
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
              matchEvents.map((ev, idx) => {
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
                      {hasVideo ? (
                        <TouchableOpacity
                          style={styles.videoPlayOverlay}
                          activeOpacity={0.8}
                          onPress={() => handleWatchVideo(ev.replay_video_url)}
                        >
                          <LinearGradient
                            colors={['rgba(15,23,42,0.6)', '#0f172a']}
                            style={styles.videoGradientBox}
                          >
                            <View style={styles.playIconCircle}>
                              <Ionicons name="play" size={28} color="#fff" />
                            </View>
                            <Text style={styles.playVideoHint}>Videoni ko'rish (Play)</Text>
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
                              {player ? `${player.first_name} ${player.last_name}` : 'Muallif noma\'lum'}
                              {player?.player_number ? ` #${player.player_number}` : ''}
                            </Text>
                            {ev.minute && (
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

                      {/* Assist info */}
                      {ev.assist_player && (
                        <View style={styles.assistRow}>
                          <Text style={styles.assistLabel}>👟 Assist: </Text>
                          <Text style={styles.assistName}>
                            {ev.assist_player.first_name} {ev.assist_player.last_name}
                          </Text>
                        </View>
                      )}

                      {/* Actions: Download / Share Video */}
                      {hasVideo && selectedMatch && (
                        <View style={styles.actionButtonsRow}>
                          <TouchableOpacity
                            style={[styles.btnDownload, isDownloading && { opacity: 0.7 }]}
                            onPress={() => handleDownloadAndShare(ev, selectedMatch)}
                            disabled={isDownloading}
                          >
                            {isDownloading ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Ionicons name="download-outline" size={18} color="#fff" />
                            )}
                            <Text style={styles.btnDownloadText}>
                              {isDownloading ? 'Yuklanmoqda...' : 'Yuklab olish (Montaj uchun)'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.btnWatchBrowser}
                            onPress={() => handleWatchVideo(ev.replay_video_url)}
                          >
                            <Ionicons name="open-outline" size={18} color="#10b981" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Select Picker Modal (Type, League, Tournament, Round) */}
      <Modal visible={pickerModalType !== 'none'} transparent animationType="fade">
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
