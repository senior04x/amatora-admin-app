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
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { SwipeRow } from '../components/SwipeRow';
import { MatchControlScreen } from './MatchControlScreen';
import { useFinishedMatchesData, useTeamsData, useLeaguesData } from '../api/hooks';
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

export const FinishedMatchesScreen: React.FC<{
  onGoBack?: () => void;
  onNavigateToCreate?: () => void;
}> = ({ onGoBack, onNavigateToCreate }) => {
  const { orgId, collabLeagueNames } = useOrg();
  const queryClient = useQueryClient();

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
      await dbClient.from('sponsors').delete().eq('name', `MATCH_TIMER_${targetId}`);
      await dbClient.from('match_events').delete().eq('match_id', targetId);
      await dbClient.from('match_stats').delete().eq('match_id', targetId);

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
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {onGoBack && (
            <TouchableOpacity style={styles.backBtn} onPress={onGoBack} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <View>
            <Text style={styles.headerTitle}>{"Yakunlangan O'yinlar"}</Text>
            <Text style={styles.headerSub}>{"Tugagan uchrashuvlar natijalari"}</Text>
          </View>
        </View>

        <View style={styles.finishedCountBadge}>
          <Ionicons name="checkmark-done" size={14} color="#10B981" />
          <Text style={styles.finishedCountText}>{`${filteredMatches.length} ta`}</Text>
        </View>
      </View>

      {/* 2 Select Filters: Liga, Tur */}
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
      </View>

      {/* Dropdown Options */}
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

      {/* Matches List */}
      {loading && page === 0 ? (
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
          <MatchCardSkeleton />
          <MatchCardSkeleton />
          <MatchCardSkeleton />
        </ScrollView>
      ) : filteredMatches.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-done-circle-outline" size={64} color="rgba(255,255,255,0.15)" />
          <Text style={styles.emptyTitle}>{"Yakunlangan o'yinlar topilmadi"}</Text>
          <Text style={styles.emptySub}>{"Hozircha yakunlangan uchrashuvlar mavjud emas"}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredMatches}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00FF66" />}
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
                <View style={styles.matchCard}>
                  {/* Card Top Row */}
                  <View style={styles.cardTopRow}>
                    <View style={styles.leagueTag}>
                      <Text style={styles.leagueTagText}>{item.league || 'LIGA'}</Text>
                      {item.round && <Text style={styles.roundTagText}>{` • ${item.round}`}</Text>}
                    </View>

                    <View style={styles.finishedBadge}>
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
                        style={styles.teamLogo}
                      />
                      <Text style={styles.teamName} numberOfLines={2}>
                        {homeName}
                      </Text>
                    </View>

                    {/* Final Score */}
                    <View style={styles.scoreContainer}>
                      <View style={styles.scoreBadge}>
                        <Text style={styles.scoreText}>
                          {item.home_score ?? 0} : {item.away_score ?? 0}
                        </Text>
                      </View>
                      {item.home_penalty_score !== undefined && item.away_penalty_score !== undefined && (item.home_penalty_score > 0 || item.away_penalty_score > 0) && (
                        <Text style={styles.penaltyText}>
                          {`Pen: (${item.home_penalty_score} - ${item.away_penalty_score})`}
                        </Text>
                      )}
                      <Text style={styles.matchDateSubText}>{mDate || ''}</Text>
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

                  {/* Bottom Action / Details Bar */}
                  <View style={styles.cardBottomBar}>
                    <View style={styles.locationInfo}>
                      <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.6)" />
                      <Text style={styles.locationText}>
                        {item.location === '2-maydon' ? '2-Maydon' : '1-Maydon'}
                        {item.stadium_name ? ` • ${item.stadium_name}` : ''}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={styles.detailsBtn}
                      onPress={() => setActiveControlMatch(item)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="stats-chart-outline" size={14} color="#00FF66" />
                      <Text style={styles.detailsBtnText}>{"Bayonnoma"}</Text>
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
          <View style={[styles.modalCard, { maxHeight: '90%' }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{"O'yinni Tahrirlash"}</Text>
              <TouchableOpacity onPress={() => setEditingMatch(null)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            {editingMatch && (
              <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
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

                <Text style={styles.inputLabel}>{"Tur / Bosqich:"}</Text>
                <TextInput
                  style={styles.modalTextInput}
                  value={editRound}
                  onChangeText={setEditRound}
                  placeholder="Masalan: 1 yoki 1-tur"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                />

                <Text style={styles.inputLabel}>{"Sana va Vaqt:"}</Text>
                <View style={styles.dateTimeRow}>
                  <TouchableOpacity style={styles.pickerTriggerBtn} onPress={() => setShowDatePicker(true)}>
                    <Ionicons name="calendar-outline" size={16} color="#00FF66" />
                    <Text style={styles.pickerTriggerText}>{editMatchDate || 'Sana tanlang'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.pickerTriggerBtn} onPress={() => setShowTimePicker(true)}>
                    <Ionicons name="time-outline" size={16} color="#00FF66" />
                    <Text style={styles.pickerTriggerText}>{editMatchTime || 'Vaqt tanlang'}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.modalSaveBtn, savingEdit && { opacity: 0.6 }]}
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
          <View style={styles.deleteModalCard}>
            <View style={styles.deleteModalIcon}>
              <Ionicons name="trash-outline" size={32} color="#EF4444" />
            </View>
            <Text style={styles.deleteModalTitle}>{"O'yinni o'chirish"}</Text>
            <Text style={styles.deleteModalSub}>{"Ushbu uchrashuv va unga tegishli barcha statistikalar o'chiriladi. Rozimisiz?"}</Text>
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
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.deleteConfirmText}>{"O'chirish"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* iOS/Android Pickers */}
      {showDatePicker && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
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

      {showTimePicker && (
        <DateTimePicker
          value={tempTime}
          mode="time"
          is24Hour
          display="default"
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
    backgroundColor: '#151A24',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  filterSelectBtnActive: {
    borderColor: '#00FF66',
    backgroundColor: 'rgba(0,255,102,0.08)',
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
    backgroundColor: '#1E2433',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 6,
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
    backgroundColor: '#151A24',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
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
    backgroundColor: '#1E2433',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
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
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#151A24',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
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
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  deleteModalCard: {
    backgroundColor: '#151A24',
    borderRadius: 20,
    padding: 22,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
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
