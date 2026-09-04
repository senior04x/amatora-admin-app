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
  ImageBackground,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from '../components/SafeBlurView';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import * as MediaLibrary from 'expo-media-library';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../supabaseClient';
import { getStageDisplayTitle, getActiveOrgTournaments, parseTournamentTier } from '../utils/tournamentUtils';

// Pleyoff (knockout) bosqichlari — guruh bosqichidan farqli, raqamli tur emas, bitta bosqich
const KNOCKOUT_STAGES = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final'];

// Helper component for scaling 1080x1080 canvas graphics for device previews
const ScaledCanvasPreview = ({
  children,
  refObj,
  width = 1080,
  height = 1080,
}: {
  children: React.ReactNode;
  refObj: any;
  width?: number;
  height?: number;
}) => {
  const [containerWidth, setContainerWidth] = useState(0);

  const containerHeight = containerWidth > 0 ? containerWidth * (height / width) : 0;
  const scale = containerWidth > 0 ? containerWidth / width : 0.33;
  const shiftX = containerWidth > 0 ? -(width - containerWidth) / 2 : 0;
  const shiftY = containerWidth > 0 ? -(height - containerHeight) / 2 : 0;

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - containerWidth) > 1) {
          setContainerWidth(w);
        }
      }}
      style={{
        width: '100%',
        aspectRatio: width / height,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#0a0d12',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.15)',
      }}
    >
      {containerWidth > 0 && (
        <View
          style={{
            width,
            height,
            transform: [
              { translateX: shiftX },
              { translateY: shiftY },
              { scale: scale },
            ],
          }}
        >
          <ViewShot
            ref={refObj}
            options={{ format: 'png', quality: 1.0, width, height }}
            style={{ width, height, backgroundColor: '#0a0d12' }}
          >
            {children}
          </ViewShot>
        </View>
      )}
    </View>
  );
};

// Skeleton Loader Pulse Item Component
const SkeletonItem: React.FC<{ style?: any }> = ({ style }) => {
  const { isDark, colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          backgroundColor: Platform.OS === 'android' ? (isDark ? '#334155' : '#E2E8F0') : '#334155',
          borderRadius: 12,
        },
        style,
        { opacity },
      ]}
    />
  );
};

// Full Screen Cards Skeleton Component
const ExportSkeleton: React.FC = () => {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {[1, 2, 3, 4].map((key) => (
        <View key={key} style={[styles.exportSectionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {/* Card Header Skeleton */}
          <View style={styles.sectionHeaderRow}>
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonItem style={{ width: 180, height: 20, borderRadius: 6 }} />
              <SkeletonItem style={{ width: 240, height: 14, borderRadius: 4 }} />
            </View>
            <SkeletonItem style={{ width: 90, height: 34, borderRadius: 12 }} />
          </View>

          {/* Canvas Preview Box Skeleton */}
          <View style={{ width: '100%', aspectRatio: 1, backgroundColor: '#0F172A', borderRadius: 16, overflow: 'hidden', padding: 20, justifyContent: 'space-between' }}>
            {/* Top header inside canvas skeleton */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <SkeletonItem style={{ width: 90, height: 32, borderRadius: 8 }} />
              <SkeletonItem style={{ width: 110, height: 32, borderRadius: 8 }} />
              <SkeletonItem style={{ width: 90, height: 32, borderRadius: 8 }} />
            </View>

            {/* Content rows inside canvas skeleton */}
            <View style={{ gap: 10, marginVertical: 14 }}>
              {[1, 2, 3, 4, 5].map((rowKey) => (
                <View key={rowKey} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <SkeletonItem style={{ width: 32, height: 32, borderRadius: 16 }} />
                  <SkeletonItem style={{ flex: 1, height: 26, borderRadius: 8 }} />
                  <SkeletonItem style={{ width: 44, height: 26, borderRadius: 8 }} />
                </View>
              ))}
            </View>

            {/* Footer sponsors skeleton */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, alignItems: 'center' }}>
              <SkeletonItem style={{ width: 60, height: 18, borderRadius: 4 }} />
              <SkeletonItem style={{ width: 60, height: 18, borderRadius: 4 }} />
              <SkeletonItem style={{ width: 60, height: 18, borderRadius: 4 }} />
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
};

export const compareMatches = (a: any, b: any) => {
  // 1. Sort by match_date (ascending: earlier date first)
  const dateA = a?.match_date ? String(a.match_date).trim() : '';
  const dateB = b?.match_date ? String(b.match_date).trim() : '';
  if (dateA !== dateB) {
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA.localeCompare(dateB);
  }

  // 2. Sort by match_time (ascending: earlier time first, e.g. 20:45 before 21:45)
  const timeA = a?.match_time ? String(a.match_time).trim().substring(0, 5) : '';
  const timeB = b?.match_time ? String(b.match_time).trim().substring(0, 5) : '';
  if (timeA !== timeB) {
    if (!timeA) return 1;
    if (!timeB) return -1;
    return timeA.localeCompare(timeB);
  }

  // 3. Sort by field / location (1-maydon before 2-maydon)
  const getFieldNum = (loc: any) => {
    if (!loc) return 999;
    const match = String(loc).match(/\d+/);
    return match ? parseInt(match[0], 10) : 999;
  };

  const fieldA = getFieldNum(a?.location);
  const fieldB = getFieldNum(b?.location);
  if (fieldA !== fieldB) {
    return fieldA - fieldB;
  }

  const locA = String(a?.location || '').toLowerCase();
  const locB = String(b?.location || '').toLowerCase();
  if (locA !== locB) {
    return locA.localeCompare(locB);
  }

  // 4. Fallback ID
  return (a?.id || 0) - (b?.id || 0);
};

export const isRealSponsor = (s: any) => {
  if (!s || !s.name) return false;
  const uName = String(s.name).trim().toUpperCase();
  const rawUrl = String(s.logo_url || '').trim();
  const uUrl = rawUrl.toUpperCase();

  // 1. Filter out all system config keys, banners, tokens, timers, remote triggers, overrides
  if (
    uName.startsWith('BANNER_') ||
    uName.startsWith('SCHEDULE_BANNER') ||
    uName.startsWith('YT_BANNER') ||
    uName.startsWith('YT_OAUTH') ||
    uName.startsWith('MATCH_TIMER') ||
    uName.startsWith('REMOTE_') ||
    uName.includes('REMOTE_FINISH') ||
    uName.includes('REMOTE_GOAL') ||
    uName.includes('MATCH_TIMER') ||
    uName.startsWith('LEAGUE_SHOW_SPONSORS') ||
    uName.startsWith('STANDINGS_OVERRIDE') ||
    uName.startsWith('REGISTRATION_OPEN') ||
    uName.startsWith('POLL_VOTES') ||
    uName.startsWith('LEAGUE_BG') ||
    uName.startsWith('EXPORT_BG') ||
    uName.startsWith('BG_') ||
    uName.endsWith('_BG') ||
    uName.includes('BACKGROUND') ||
    uUrl.includes('EXPO_PUSH') ||
    uUrl.includes('LEAGUE-BACKGROUNDS') ||
    uUrl.includes('LEAGUE_BG') ||
    uUrl.includes('EXPORT_BG') ||
    uUrl.includes('EXPORT-BG')
  ) {
    return false;
  }

  // 2. Must have a valid image URL (not JSON string or boolean)
  if (
    rawUrl.startsWith('{') ||
    rawUrl.startsWith('[') ||
    rawUrl === 'true' ||
    rawUrl === 'false' ||
    (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') && !rawUrl.startsWith('data:') && !rawUrl.startsWith('file:') && !rawUrl.startsWith('blob:'))
  ) {
    return false;
  }

  return true;
};

export const ExportScreen: React.FC = () => {
  const { orgId, collabLeagueIds, collabLeagueNames } = useOrg();
  const { isDark, colors } = useTheme();
  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  const [savedLeagueSelection, setSavedLeagueSelection] = useState<any>(null);
  const [showLeagueDropdown, setShowLeagueDropdown] = useState(false);

  // Turnir eksporti: "Liga / Turnir" 2-segmentli tanlov (Export har doim BITTA aniq
  // subyekt — liga yoki turnir — uchun ishlaydi, shuning uchun boshqa sahifalardagi
  // 3-segmentli "hammasi" varianti bu yerda ma'noga ega emas).
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [exportScope, setExportScope] = useState<'league' | 'tournament'>('league');
  const [selectedTournament, setSelectedTournament] = useState<any>(null);
  const [showTournamentDropdown, setShowTournamentDropdown] = useState(false);

  const [selectedRound, setSelectedRound] = useState<string>('1');
  const [availableRounds, setAvailableRounds] = useState<string[]>(['1']);
  const [showRoundDropdown, setShowRoundDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloadingSection, setDownloadingSection] = useState<string | null>(null);

  // Data State for PNG Graphics
  const [teams, setTeams] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [scorers, setScorers] = useState<any[]>([]);
  const [assists, setAssists] = useState<any[]>([]);
  const [cardPlayers, setCardPlayers] = useState<any[]>([]);
  const [orgData, setOrgData] = useState<any>(null);
  const [collabInfo, setCollabInfo] = useState<any>(null);
  const [mainSponsorLogo, setMainSponsorLogo] = useState<string | null>(null);
  const [secondarySponsors, setSecondarySponsors] = useState<any[]>([]);
  const [rawCardEvents, setRawCardEvents] = useState<any[]>([]);
  const [rawGoalEvents, setRawGoalEvents] = useState<any[]>([]);
  const [showCardsModal, setShowCardsModal] = useState(false);

  // PDF Export Modal State
  const [showPDFModal, setShowPDFModal] = useState(false);
  const [pdfMode, setPdfMode] = useState<'all' | 'team' | 'league' | null>(null);
  const [selectedPDFTeamId, setSelectedPDFTeamId] = useState<string>('');
  const [selectedPDFLeagueName, setSelectedPDFLeagueName] = useState<string>('');
  const [allApplications, setAllApplications] = useState<any[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [isPDFExporting, setIsPDFExporting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // ViewShot Refs
  const standingsRef = useRef<any>(null);
  const scheduleRef = useRef<any>(null);
  const cardsRef = useRef<any>(null);
  const scorersRef = useRef<any>(null);

  // Match Schedule Day & Part pagination states (max 8 matches per 1x1 image)
  const [selectedScheduleDayIdx, setSelectedScheduleDayIdx] = useState<number>(0);
  const [selectedSchedulePartIdx, setSelectedSchedulePartIdx] = useState<number>(0);
  const [exportingDayNumber, setExportingDayNumber] = useState<number | null>(null);

  useEffect(() => {
    fetchLeagues();
    fetchOrgData();
    fetchTournaments();
  }, [orgId]);

  const fetchTournaments = async () => {
    try {
      if (!orgId) return;
      const list = await getActiveOrgTournaments(orgId);
      setTournaments(list || []);
    } catch (e) {
      console.error('Error fetching tournaments for export:', e);
    }
  };

  const buildTournamentProxy = (t: any) => ({
    id: `tournament_${t.id}`,
    name: t.name,
    logo_url: t.logo_url,
    bg_image: t.export_bg_url || t.bg_image || null,
    isCollab: !!t.isCollab,
    org1: t.org1,
    org2: t.org2,
    _isTournament: true,
    _tournamentId: t.id,
  });

  const handleSetExportScope = (scope: 'league' | 'tournament') => {
    if (scope === exportScope) return;
    setExportScope(scope);
    setShowLeagueDropdown(false);
    setShowTournamentDropdown(false);
    setShowRoundDropdown(false);
    if (scope === 'tournament') {
      const t = selectedTournament || tournaments[0];
      if (t) {
        setSelectedTournament(t);
        setSelectedLeague(buildTournamentProxy(t));
      } else {
        // Turnirlar hali yuklanmagan yoki mavjud emas — quyidagi useEffect
        // tournaments ro'yxati kelganda avtomatik birinchisini tanlaydi.
        setSelectedLeague(null);
      }
    } else if (savedLeagueSelection) {
      setSelectedLeague(savedLeagueSelection);
    }
  };

  // Turnirlar ro'yxati (async) scope 'tournament'ga o'tilgandan KEYIN kelib qolishi
  // mumkin — shunday holatda birinchi turnirni avtomatik tanlaydi.
  useEffect(() => {
    if (exportScope === 'tournament' && !selectedTournament && tournaments.length > 0) {
      const t = tournaments[0];
      setSelectedTournament(t);
      setSelectedLeague(buildTournamentProxy(t));
    }
  }, [tournaments, exportScope]);

  const fetchOrgData = async () => {
    try {
      const dbClient = supabase;
      if (orgId) {
        const { data } = await dbClient.from('organizations').select('*').eq('id', orgId).single();
        if (data) setOrgData(data);
      } else {
        const { data } = await dbClient.from('organizations').select('*').limit(1).single();
        if (data) setOrgData(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (exportScope === 'tournament') {
      if (selectedTournament) {
        fetchTournamentData(selectedTournament);
      }
    } else if (selectedLeague) {
      fetchLeagueData(selectedLeague);
    }
  }, [exportScope, selectedTournament, selectedLeague, orgId, collabLeagueNames]);

  const fetchLeagues = async () => {
    setLoading(true);
    try {
      const dbClient = supabase;
      let query = dbClient.from('leagues').select('*').order('name');
      if (orgId) {
        if (collabLeagueIds && collabLeagueIds.length > 0) {
          query = query.or(`organization_id.eq.${orgId},id.in.(${collabLeagueIds.join(',')})`);
        } else {
          query = query.eq('organization_id', orgId);
        }
      }
      const { data: leaguesData } = await query;

      if (leaguesData && leaguesData.length > 0) {
        const { data: systemSponsors } = await dbClient
          .from('sponsors')
          .select('name, logo_url')
          .or('name.like.LEAGUE_BG_%,name.like.LEAGUE_SHOW_SPONSORS_%');

        const bgMap: any = {};
        const showSponsorsMap: Record<string, boolean> = {};
        if (systemSponsors) {
          systemSponsors.forEach((s: any) => {
            if (s.name.startsWith('LEAGUE_BG_')) {
              const lId = s.name.replace('LEAGUE_BG_', '');
              bgMap[lId] = s.logo_url;
            } else if (s.name.startsWith('LEAGUE_SHOW_SPONSORS_')) {
              const lId = s.name.replace('LEAGUE_SHOW_SPONSORS_', '');
              showSponsorsMap[lId] = s.logo_url === 'true';
            }
          });
        }

        const merged = leaguesData.map((l: any) => {
          let activeBg = null;
          const sysBg = bgMap[l.id] || bgMap[String(l.id)] || bgMap[l.name];

          if (sysBg && sysBg !== 'none' && sysBg !== 'false') {
            activeBg = sysBg;
          } else if (sysBg === 'none' || sysBg === 'false') {
            activeBg = null;
          } else {
            activeBg = l.bg_image || l.export_bg_url || null;
          }

          let showSponsorsVal: boolean = true;
          if (l.id !== undefined && l.id !== null && showSponsorsMap[`${l.id}`] !== undefined) {
            showSponsorsVal = showSponsorsMap[`${l.id}`];
          } else if (l.name && showSponsorsMap[l.name] !== undefined) {
            showSponsorsVal = showSponsorsMap[l.name];
          } else if (l.show_sponsors !== undefined && l.show_sponsors !== null) {
            showSponsorsVal = l.show_sponsors !== false;
          }

          return {
            ...l,
            bg_image: activeBg,
            show_sponsors: showSponsorsVal,
          };
        });

        setLeagues(merged);
        setSavedLeagueSelection(merged[0]);
        if (exportScope !== 'tournament') {
          setSelectedLeague(merged[0]);
        }
      } else {
        setLeagues([]);
        setSavedLeagueSelection(null);
        if (exportScope !== 'tournament') {
          setSelectedLeague(null);
        }
        setLoading(false);
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const fetchAllPDFData = async () => {
    try {
      const dbClient = supabase;

      let appQuery = dbClient
        .from('applications')
        .select('id, team_id, first_name, last_name, father_name, photo_url, passport_series, passport_number, birth_date, position, player_number')
        .order('created_at', { ascending: false });

      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          try {
            const { data: cTeams } = await dbClient
              .from('teams')
              .select('id')
              .in('league', collabLeagueNames);
            const cTeamIds = (cTeams || []).map((t: any) => t.id).filter(Boolean);
            if (cTeamIds.length > 0) {
              appQuery = appQuery.or(`organization_id.eq.${orgId},team_id.in.(${cTeamIds.join(',')})`);
            } else {
              appQuery = appQuery.eq('organization_id', orgId);
            }
          } catch (e) {
            appQuery = appQuery.eq('organization_id', orgId);
          }
        } else {
          appQuery = appQuery.eq('organization_id', orgId);
        }
      }
      const { data: appsData } = await appQuery;
      if (appsData) setAllApplications(appsData);

      let teamQuery = dbClient.from('teams').select('*').order('name');
      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map(n => `"${n.replace(/"/g, '""')}"`).join(',');
          teamQuery = teamQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          teamQuery = teamQuery.eq('organization_id', orgId);
        }
      }
      const { data: teamsData } = await teamQuery;
      if (teamsData) {
        setAllTeams(teamsData);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLeagueData = async (leagueObj: any) => {
    setLoading(true);
    setTeams([]);
    setMatches([]);
    setScorers([]);
    setAssists([]);
    setCardPlayers([]);
    setCollabInfo(null);
    setMainSponsorLogo(null);
    setSecondarySponsors([]);

    const leagueId = typeof leagueObj === 'object' ? leagueObj?.id : leagueObj;
    const leagueName = typeof leagueObj === 'object' ? leagueObj?.name : (selectedLeague?.name || '');

    try {
      const dbClient = supabase;

      // Parallel fetch of 3 independent queries: collabs, sponsors, teams.
      // (Matches endi bularning tagida, teamIds ma'lum bo'lgandan KEYIN, faqat shu liga
      // jamoalariga tegishli qatorlar bilan cheklab olinadi — avval butun tashkilotning
      // BARCHA o'yinlari pagination'siz yuklanardi, bu ~50,000 concurrent user sharoitida
      // scale muammosi edi.)
      const [collabRes, sponsorsRes, teamsRes] = await Promise.all([
        leagueId
          ? dbClient
              .from('league_collabs')
              .select('*, sender_org:organizations!sender_org_id(id, name, logo_url), receiver_org:organizations!receiver_org_id(id, name, logo_url)')
              .eq('league_id', leagueId)
              .eq('status', 'accepted')
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),

        (() => {
          let spQuery = dbClient
            .from('sponsors')
            .select('*')
            .order('created_at', { ascending: false });
          if (orgId) {
            spQuery = spQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
          }
          return spQuery;
        })(),

        (() => {
          let teamQuery = dbClient
            .from('teams')
            .select('*')
            .in('status', ['approved', 'partially_approved']);
          if (orgId) {
            if (collabLeagueNames && collabLeagueNames.length > 0) {
              const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
              teamQuery = teamQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
            } else {
              teamQuery = teamQuery.eq('organization_id', orgId);
            }
          }
          return teamQuery;
        })()
      ]);

      // 0. Set Collab Info
      setCollabInfo(collabRes?.data || null);

      // 1. Process Sponsors and Overrides Map
      const allSp = sponsorsRes?.data || [];
      const overridesMap: Record<string, any> = {};
      const settingsMap: Record<string, boolean> = {};

      allSp.forEach((s: any) => {
        if (s.name && s.name.startsWith('STANDINGS_OVERRIDE_')) {
          const tId = s.name.replace('STANDINGS_OVERRIDE_', '');
          try {
            overridesMap[tId] = JSON.parse(s.logo_url);
          } catch (e) {}
        }
        if (s.name && s.name.startsWith('LEAGUE_SHOW_SPONSORS_')) {
          const key = s.name.replace('LEAGUE_SHOW_SPONSORS_', '');
          settingsMap[key] = s.logo_url === 'true';
        }
      });

      // Filter real sponsors using the same logic as SponsorsScreen.tsx and Standings.jsx
      const realSponsors = allSp.filter(isRealSponsor);

      // Check whether secondary sponsors strip is enabled for this league
      let showSponsorsForThisLeague = true;
      if (leagueId !== undefined && leagueId !== null && settingsMap[`${leagueId}`] !== undefined) {
        showSponsorsForThisLeague = settingsMap[`${leagueId}`];
      } else if (leagueName && settingsMap[leagueName] !== undefined) {
        showSponsorsForThisLeague = settingsMap[leagueName];
      } else if (typeof leagueObj === 'object' && leagueObj?.show_sponsors !== undefined && leagueObj?.show_sponsors !== null) {
        showSponsorsForThisLeague = leagueObj.show_sponsors !== false;
      }

      // 1. BOSH HOMIY (Main Sponsor) is ALWAYS visible in the top-right corner across all leagues!
      const main = realSponsors.find((s: any) => s.is_main === true) || (realSponsors.length > 0 ? realSponsors[0] : null);
      if (main?.logo_url) {
        setMainSponsorLogo(main.logo_url);
      } else {
        setMainSponsorLogo(null);
      }

      // 2. SECONDARY SPONSORS (Bottom strip) - displayed ONLY when enabled for this league
      if (showSponsorsForThisLeague && realSponsors.length > 0) {
        const secondaries = realSponsors.filter((s: any) => s.id !== main?.id && s.is_selected !== false);
        setSecondarySponsors(secondaries.filter((s: any) => !!s.logo_url));
      } else {
        setSecondarySponsors([]);
      }

      // 2. Process Teams
      const teamsList = teamsRes?.data || [];
      const leagueNameClean = String(leagueName || '').trim().toLowerCase();
      const filteredTeams = teamsList.filter((t: any) => {
        if (!leagueNameClean) return true;
        if (t.league) {
          const tLeague = String(t.league).toLowerCase();
          return tLeague.includes(leagueNameClean) || leagueNameClean.includes(tLeague);
        }
        return false;
      });

      let targetTeams = filteredTeams.length > 0 ? filteredTeams : teamsList;
      let teamIds = new Set(targetTeams.map((t: any) => t.id));
      let targetTeamIds = Array.from(teamIds);
      const teamIdsCsv = targetTeamIds.length > 0 ? targetTeamIds.join(',') : null;

      // 3. Fetch & Process Matches — matches jadvalida liga 'league' (text) ustuni orqali saqlanadi
      let matchQuery = dbClient
        .from('matches')
        .select('*, home_team_data:teams!matches_home_team_id_fkey(name, logo_url), away_team_data:teams!matches_away_team_id_fkey(name, logo_url)')
        .order('match_date', { ascending: true });

      if (leagueName) {
        matchQuery = matchQuery.ilike('league', `%${leagueName.trim()}%`);
      } else if (teamIdsCsv) {
        matchQuery = matchQuery.or(`home_team_id.in.(${teamIdsCsv}),away_team_id.in.(${teamIdsCsv})`);
      } else if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          matchQuery = matchQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          matchQuery = matchQuery.eq('organization_id', orgId);
        }
      }

      let { data: matchesQueryData, error: matchErr } = await matchQuery;
      if (matchErr) {
        console.warn('Primary matchQuery error in fetchLeagueData:', matchErr);
      }

      // Xavfsiz fallback: agar league nomi bo'yicha topilmasa, teamIds yoki orgId bo'yicha qayta tekshiramiz
      if ((!matchesQueryData || matchesQueryData.length === 0 || matchErr) && (teamIdsCsv || orgId)) {
        let fallbackQuery = dbClient
          .from('matches')
          .select('*, home_team_data:teams!matches_home_team_id_fkey(name, logo_url), away_team_data:teams!matches_away_team_id_fkey(name, logo_url)')
          .order('match_date', { ascending: true });

        if (teamIdsCsv) {
          fallbackQuery = fallbackQuery.or(`home_team_id.in.(${teamIdsCsv}),away_team_id.in.(${teamIdsCsv})`);
        } else if (orgId) {
          fallbackQuery = fallbackQuery.eq('organization_id', orgId);
        }
        const { data: fbData } = await fallbackQuery;
        if (fbData && fbData.length > 0) {
          matchesQueryData = fbData;
        }
      }

      const allMatchesData = matchesQueryData || [];
      const allLeagueMatches = allMatchesData.filter((m: any) => {
        // Faqat liga o'yinlari (turnir o'yinlarini aralashtirmaymiz)
        if (m.tournament_id) return false;
        const mLeague = String(m.league || '').trim().toLowerCase();
        if (leagueNameClean && (mLeague === leagueNameClean || mLeague.includes(leagueNameClean) || leagueNameClean.includes(mLeague))) {
          return true;
        }
        if (teamIds.has(m.home_team_id) || teamIds.has(m.away_team_id)) {
          return true;
        }
        return false;
      });

      // O'yinlarda qatnashayotgan jamoalarni ham targetTeams ro'yxatiga qo'shamiz
      const targetTeamMap = new Map<any, any>();
      targetTeams.forEach((t: any) => targetTeamMap.set(t.id, t));
      allLeagueMatches.forEach((m: any) => {
        if (m.home_team_id && !targetTeamMap.has(m.home_team_id)) {
          const found = teamsList.find((t: any) => t.id === m.home_team_id);
          if (found) {
            targetTeamMap.set(found.id, found);
            teamIds.add(found.id);
          }
        }
        if (m.away_team_id && !targetTeamMap.has(m.away_team_id)) {
          const found = teamsList.find((t: any) => t.id === m.away_team_id);
          if (found) {
            targetTeamMap.set(found.id, found);
            teamIds.add(found.id);
          }
        }
      });
      targetTeams = Array.from(targetTeamMap.values());
      targetTeamIds = Array.from(teamIds);

      // Haqiqiy turlar ro'yxatini aniqlash (1..maxRound va mavjud turlar)
      const roundSet = new Set<string>();
      let maxRound = 0;
      allLeagueMatches.forEach((m: any) => {
        if (m.round !== null && m.round !== undefined) {
          const rStr = String(m.round).trim();
          if (rStr) {
            roundSet.add(rStr);
            const num = parseInt(rStr, 10);
            if (!isNaN(num) && num > maxRound) {
              maxRound = num;
            }
          }
        }
      });

      // Agar maxRound aniqlangan bo'lsa (masalan 7), 1 dan 7 gacha barcha turlarni kiritamiz
      for (let i = 1; i <= maxRound; i++) {
        roundSet.add(String(i));
      }

      const sortedRounds = Array.from(roundSet).sort((a, b) => {
        const numA = Number(a.replace(/[^0-9]/g, ''));
        const numB = Number(b.replace(/[^0-9]/g, ''));
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
          return numA - numB;
        }
        return a.localeCompare(b);
      });

      const roundOpts: string[] = ['all', ...(sortedRounds.length > 0 ? sortedRounds : ['1'])];
      setAvailableRounds(roundOpts);

      const finishedMatchesList = allLeagueMatches.filter((m: any) =>
        m.status === 'finished' || (m.home_score !== null && m.away_score !== null && m.home_score !== undefined && m.away_score !== undefined)
      );
      const finishedRounds = finishedMatchesList.map((m: any) => Number(m.round || 1)).filter((r: any) => !isNaN(r));
      const latestFinishedRound = finishedRounds.length > 0 ? Math.max(...finishedRounds) : (maxRound > 0 ? 1 : 1);
      setSelectedRound(String(latestFinishedRound));

      // 4. Compute Standings Table with Overrides applied
      const tableMap: any = {};
      targetTeams.forEach((t: any) => {
        tableMap[t.id] = {
          ...t,
          raw_played: 0,
          raw_won: 0,
          raw_drawn: 0,
          raw_lost: 0,
          raw_gf: 0,
          raw_ga: 0,
          raw_pts: 0,
        };
      });

      finishedMatchesList.forEach((m: any) => {
        const hId = m.home_team_id;
        const aId = m.away_team_id;
        const hScore = parseInt(m.home_score || 0);
        const aScore = parseInt(m.away_score || 0);

        if (tableMap[hId]) {
          tableMap[hId].raw_played += 1;
          tableMap[hId].raw_gf += hScore;
          tableMap[hId].raw_ga += aScore;
          if (hScore > aScore) {
            tableMap[hId].raw_won += 1;
            tableMap[hId].raw_pts += 3;
          } else if (hScore === aScore) {
            tableMap[hId].raw_drawn += 1;
            tableMap[hId].raw_pts += 1;
          } else {
            tableMap[hId].raw_lost += 1;
          }
        }

        if (tableMap[aId]) {
          tableMap[aId].raw_played += 1;
          tableMap[aId].raw_gf += aScore;
          tableMap[aId].raw_ga += hScore;
          if (aScore > hScore) {
            tableMap[aId].raw_won += 1;
            tableMap[aId].raw_pts += 3;
          } else if (aScore === hScore) {
            tableMap[aId].raw_drawn += 1;
            tableMap[aId].raw_pts += 1;
          } else {
            tableMap[aId].raw_lost += 1;
          }
        }
      });

      const computedStandings = Object.values(tableMap)
        .filter((t: any) => !t.is_archived)
        .map((t: any) => {
          const ovr = overridesMap[String(t.id)] || {};
          const played_offset = parseInt(ovr.played_offset || 0);
          const won_offset = parseInt(ovr.won_offset || 0);
          const draw_offset = parseInt(ovr.draw_offset || 0);
          const lost_offset = parseInt(ovr.lost_offset || 0);
          const gf_offset = parseInt(ovr.gf_offset || 0);
          const ga_offset = parseInt(ovr.ga_offset || 0);
          const pts_offset = parseInt(ovr.pts_offset || t.penalty_points || 0);

          t.played = Math.max(0, t.raw_played + played_offset);
          t.won = Math.max(0, t.raw_won + won_offset);
          t.drawn = Math.max(0, t.raw_drawn + draw_offset);
          t.lost = Math.max(0, t.raw_lost + lost_offset);
          t.gf = Math.max(0, t.raw_gf + gf_offset);
          t.ga = Math.max(0, t.raw_ga + ga_offset);
          t.points = t.raw_pts + pts_offset;
          t.gd = t.gf - t.ga;
          return t;
        })
        .sort((a: any, b: any) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.gd !== a.gd) return b.gd - a.gd;
          if (b.gf !== a.gf) return b.gf - a.gf;
          return b.won - a.won;
        });

      setTeams(computedStandings);

      const enrichedMatches = allLeagueMatches.map((m: any) => ({
        ...m,
        home_team: m.home_team_data?.name || m.home_team || m.home_team_name || 'Jamoa 1',
        away_team: m.away_team_data?.name || m.away_team || m.away_team_name || 'Jamoa 2',
        home_team_logo: m.home_team_data?.logo_url,
        away_team_logo: m.away_team_data?.logo_url,
      }));
      enrichedMatches.sort(compareMatches);
      setMatches(enrichedMatches);

      // 5. Fetch Events with targeted team_id filter, specific lightweight columns and pagination
      let eventsData: any[] = [];
      if (targetTeamIds.length > 0) {
        let page = 0;
        const PAGE_SIZE = 1000;
        while (true) {
          const { data: pageEvents, error: evErr } = await dbClient
            .from('match_events')
            .select('id, event_type, player_id, team_id, match_id, player:applications(first_name, last_name, photo_url), team:teams(name, logo_url)')
            .in('team_id', targetTeamIds)
            .in('event_type', ['goal', 'assist', 'yellow_card', 'red_card'])
            .order('id', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

          if (evErr) {
            console.error('Error fetching match_events:', evErr);
            break;
          }
          if (!pageEvents || pageEvents.length === 0) break;
          eventsData = eventsData.concat(pageEvents);
          if (pageEvents.length < PAGE_SIZE) break;
          page++;
        }
      }

      if (eventsData && eventsData.length > 0) {
        const filteredEvents = eventsData.filter((e: any) => teamIds.has(e.team_id));
        const goalMap: any = {};
        const assistMap: any = {};
        const cardMap: any = {};

        filteredEvents.forEach((ev: any) => {
          const pId = ev.player_id || ev.id;
          const pName = ev.player ? `${ev.player.first_name || ''} ${ev.player.last_name || ''}`.trim() : (ev.player_name || 'O\'yinchi');
          const pTeam = ev.team ? ev.team.name : (ev.team_name || 'Jamoa');
          const pPhoto = ev.player?.photo_url || ev.player_photo || ev.team?.logo_url;

          if (ev.event_type === 'goal') {
            if (!goalMap[pId]) goalMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, goals: 0, played: 1 };
            goalMap[pId].goals += 1;
          }
          if (ev.event_type === 'assist') {
            if (!assistMap[pId]) assistMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, assists: 0, played: 1 };
            assistMap[pId].assists += 1;
          }
          if (ev.event_type === 'yellow_card' || ev.event_type === 'red_card') {
            if (!cardMap[pId]) cardMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, yellow: 0, red: 0 };
            if (ev.event_type === 'yellow_card') cardMap[pId].yellow += 1;
            if (ev.event_type === 'red_card') cardMap[pId].red += 1;
          }
        });

        setScorers(Object.values(goalMap).sort((a: any, b: any) => b.goals - a.goals));
        setAssists(Object.values(assistMap).sort((a: any, b: any) => b.assists - a.assists));
        setCardPlayers(Object.values(cardMap).sort((a: any, b: any) => (b.yellow + b.red * 2) - (a.yellow + a.red * 2)));

        const cardEvents = filteredEvents.filter((ev: any) => ev.event_type === 'yellow_card' || ev.event_type === 'red_card');
        const goalEvents = filteredEvents.filter((ev: any) => ev.event_type === 'goal');
        setRawCardEvents(cardEvents);
        setRawGoalEvents(goalEvents);
      }
    } catch (e) {
      console.error('Error in fetchLeagueData:', e);
    } finally {
      setLoading(false);
    }
  };

  // Turnir eksporti uchun ma'lumotlarni yuklaydi — fetchLeagueData bilan bir xil
  // state'larni to'ldiradi (teams/matches/scorers/assists/cardPlayers/availableRounds/
  // sponsor state'lari), shunda MAVJUD render/PDF kodi ularni AVTOMATIK ishlatadi.
  // Jamoalar/o'yinlar to'g'ridan-to'g'ri `tournament_id` FK orqali (liga nomi bo'yicha
  // matnli qidiruv shart emas, tezroq va aniqroq) va server tomonida filtrlanadi.
  const fetchTournamentData = async (tournamentObj: any) => {
    setLoading(true);
    setTeams([]);
    setMatches([]);
    setScorers([]);
    setAssists([]);
    setCardPlayers([]);
    setCollabInfo(null);
    setMainSponsorLogo(null);
    setSecondarySponsors([]);

    const tournamentId = tournamentObj?.id;

    try {
      const dbClient = supabase;

      if (tournamentObj?.isCollab) {
        setCollabInfo({ sender_org: tournamentObj.org1, receiver_org: tournamentObj.org2 });
      }

      const [sponsorsRes, matchesRes] = await Promise.all([
        (() => {
          let spQuery = dbClient
            .from('sponsors')
            .select('*')
            .order('created_at', { ascending: false });
          if (orgId) {
            spQuery = spQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
          }
          return spQuery;
        })(),

        tournamentId
          ? dbClient
              .from('matches')
              .select('*, home_team_data:teams!matches_home_team_id_fkey(name, logo_url), away_team_data:teams!matches_away_team_id_fkey(name, logo_url)')
              .eq('tournament_id', tournamentId)
              .order('match_date', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      // 1. Homiylar — TOURNAMENT_SHOW_SPONSORS_ konvensiyasi (SponsorsScreen.tsx bilan bir xil)
      const allSp = sponsorsRes?.data || [];
      const settingsMap: Record<string, boolean> = {};
      allSp.forEach((s: any) => {
        if (s.name && s.name.startsWith('TOURNAMENT_SHOW_SPONSORS_')) {
          const key = s.name.replace('TOURNAMENT_SHOW_SPONSORS_', '');
          settingsMap[key] = s.logo_url === 'true';
        }
      });
      const realSponsors = allSp.filter(isRealSponsor);

      let showSponsorsForThisTournament = true;
      if (tournamentId !== undefined && tournamentId !== null && settingsMap[`${tournamentId}`] !== undefined) {
        showSponsorsForThisTournament = settingsMap[`${tournamentId}`];
      } else if (tournamentObj?.name && settingsMap[tournamentObj.name] !== undefined) {
        showSponsorsForThisTournament = settingsMap[tournamentObj.name];
      }

      const main = realSponsors.find((s: any) => s.is_main === true) || (realSponsors.length > 0 ? realSponsors[0] : null);
      setMainSponsorLogo(main?.logo_url || null);

      if (showSponsorsForThisTournament && realSponsors.length > 0) {
        const secondaries = realSponsors.filter((s: any) => s.id !== main?.id && s.is_selected !== false);
        setSecondarySponsors(secondaries.filter((s: any) => !!s.logo_url));
      } else {
        setSecondarySponsors([]);
      }

      // 2. O'yinlar — bevosita tournament_id bo'yicha (server tomonida, scale-safe)
      const allTournamentMatches = matchesRes?.data || [];

      // 3. Jamoalarni yuklaymiz:
      // Turnirga biriktirilgan barcha ligalarni aniqlaymiz (jadvalda barcha 40 ta jamoa chiqishi uchun)
      let tournLeagues: any[] = [];
      if (tournamentId) {
        const { data: tlData } = await dbClient
          .from('tournament_leagues')
          .select('*, league:league_id(*)')
          .eq('tournament_id', tournamentId);
        tournLeagues = (tlData || []).map((tl: any) => tl.league).filter(Boolean);

        // 2-darajali turnir bo'lsa va liga belgilanmagan bo'lsa, ota turnir ligalaridan olamiz
        if (tournLeagues.length === 0 && tournamentObj?.description?.includes('PARENT:')) {
          const pMatch = tournamentObj.description.match(/PARENT:(\d+)/);
          if (pMatch?.[1]) {
            const { data: parentLeaguesData } = await dbClient
              .from('tournament_leagues')
              .select('*, league:league_id(*)')
              .eq('tournament_id', pMatch[1]);
            tournLeagues = (parentLeaguesData || []).map((tl: any) => tl.league).filter(Boolean);
          }
        }
      }

      let allTournTeams: any[] = [];
      if (tournLeagues.length > 0) {
        const lIds = tournLeagues.map((l: any) => l.id);
        const { data: lTeams } = await dbClient
          .from('teams')
          .select('*')
          .in('league_id', lIds);
        allTournTeams = lTeams || [];
      }

      // O'yinlar ishtirokchilarini ham jamoalar ro'yxatiga qo'shamiz (hech qanday jamoa tushib qolmasligi uchun)
      const matchTeamIdSet = new Set<any>();
      allTournamentMatches.forEach((m: any) => {
        if (m.home_team_id) matchTeamIdSet.add(m.home_team_id);
        if (m.away_team_id) matchTeamIdSet.add(m.away_team_id);
      });

      const existingTeamIds = new Set(allTournTeams.map((t: any) => t.id));
      const missingMatchTeamIds = Array.from(matchTeamIdSet).filter((id) => !existingTeamIds.has(id));
      if (missingMatchTeamIds.length > 0) {
        const { data: extraTeams } = await dbClient
          .from('teams')
          .select('*')
          .in('id', missingMatchTeamIds);
        if (extraTeams) {
          allTournTeams = [...allTournTeams, ...extraTeams];
        }
      }

      // Agar hali ligalar ham, o'yinlar ham topilmasa, tashkilotning barcha jamoalarini yuklaymiz
      if (allTournTeams.length === 0 && orgId) {
        const { data: orgTeams } = await dbClient
          .from('teams')
          .select('*')
          .eq('organization_id', orgId);
        allTournTeams = orgTeams || [];
      }

      const targetTeams = allTournTeams;

      // 4. Bosqichlar ro'yxati: guruh turlari (1..N) + mavjud pleyoff bosqichlari
      let maxGroupRound = 0;
      const knockoutStagesPresent = new Set<string>();
      allTournamentMatches.forEach((m: any) => {
        if (m.stage && m.stage !== 'group') {
          knockoutStagesPresent.add(m.stage);
        } else if (m.round && parseInt(m.round) > maxGroupRound) {
          maxGroupRound = parseInt(m.round);
        }
      });

      const roundOpts: string[] = ['all'];
      for (let i = 1; i <= maxGroupRound; i++) {
        roundOpts.push(String(i));
      }
      KNOCKOUT_STAGES.forEach((stg) => {
        if (knockoutStagesPresent.has(stg)) roundOpts.push(stg);
      });
      setAvailableRounds(roundOpts);

      const finishedMatchesList = allTournamentMatches.filter((m: any) =>
        m.status === 'finished' || (m.home_score !== null && m.away_score !== null && m.home_score !== undefined && m.away_score !== undefined)
      );

      // Default: eng so'nggi bosqich (guruh bo'lsa eng katta tur, aks holda eng oxirgi
      // yakunlangan pleyoff bosqichi) — "Barchasi" emas.
      let defaultRound = 'all';
      const finishedKnockout = finishedMatchesList.filter((m: any) => m.stage && m.stage !== 'group');
      if (finishedKnockout.length > 0) {
        let latestIdx = -1;
        finishedKnockout.forEach((m: any) => {
          const idx = KNOCKOUT_STAGES.indexOf(m.stage);
          if (idx > latestIdx) latestIdx = idx;
        });
        defaultRound = latestIdx >= 0 ? KNOCKOUT_STAGES[latestIdx] : 'all';
      } else {
        const finishedGroupRounds = finishedMatchesList
          .filter((m: any) => !m.stage || m.stage === 'group')
          .map((m: any) => Number(m.round || 1))
          .filter((r: any) => !isNaN(r));
        defaultRound = finishedGroupRounds.length > 0
          ? String(Math.max(...finishedGroupRounds))
          : (roundOpts.length > 1 ? roundOpts[roundOpts.length - 1] : 'all');
      }
      setSelectedRound(defaultRound);

      // 5. Standings — faqat guruh bosqichi o'yinlari asosida (pleyoff W/D/L jadvalga aralashmaydi)
      const tableMap: any = {};
      targetTeams.forEach((t: any) => {
        tableMap[t.id] = {
          ...t,
          raw_played: 0, raw_won: 0, raw_drawn: 0, raw_lost: 0, raw_gf: 0, raw_ga: 0, raw_pts: 0,
        };
      });

      finishedMatchesList
        .filter((m: any) => !m.stage || m.stage === 'group')
        .forEach((m: any) => {
          const hId = m.home_team_id;
          const aId = m.away_team_id;
          const hScore = parseInt(m.home_score || 0);
          const aScore = parseInt(m.away_score || 0);

          if (tableMap[hId]) {
            tableMap[hId].raw_played += 1;
            tableMap[hId].raw_gf += hScore;
            tableMap[hId].raw_ga += aScore;
            if (hScore > aScore) { tableMap[hId].raw_won += 1; tableMap[hId].raw_pts += 3; }
            else if (hScore === aScore) { tableMap[hId].raw_drawn += 1; tableMap[hId].raw_pts += 1; }
            else { tableMap[hId].raw_lost += 1; }
          }
          if (tableMap[aId]) {
            tableMap[aId].raw_played += 1;
            tableMap[aId].raw_gf += aScore;
            tableMap[aId].raw_ga += hScore;
            if (aScore > hScore) { tableMap[aId].raw_won += 1; tableMap[aId].raw_pts += 3; }
            else if (aScore === hScore) { tableMap[aId].raw_drawn += 1; tableMap[aId].raw_pts += 1; }
            else { tableMap[aId].raw_lost += 1; }
          }
        });

      const computedStandings = Object.values(tableMap)
        .filter((t: any) => !t.is_archived)
        .map((t: any) => {
          t.played = t.raw_played;
          t.won = t.raw_won;
          t.drawn = t.raw_drawn;
          t.lost = t.raw_lost;
          t.gf = t.raw_gf;
          t.ga = t.raw_ga;
          t.points = t.raw_pts;
          t.gd = t.gf - t.ga;
          return t;
        })
        .sort((a: any, b: any) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.gd !== a.gd) return b.gd - a.gd;
          if (b.gf !== a.gf) return b.gf - a.gf;
          return b.won - a.won;
        });

      setTeams(computedStandings);

      const enrichedMatches = allTournamentMatches.map((m: any) => ({
        ...m,
        home_team: m.home_team_data?.name || m.home_team || m.home_team_name || 'Jamoa 1',
        away_team: m.away_team_data?.name || m.away_team || m.away_team_name || 'Jamoa 2',
        home_team_logo: m.home_team_data?.logo_url,
        away_team_logo: m.away_team_data?.logo_url,
      }));
      enrichedMatches.sort(compareMatches);
      setMatches(enrichedMatches);

      // 6. Voqealar (gol/pas/kartochka) — team_id bo'yicha, pagination bilan (scale-safe)
      const targetTeamIds = targetTeams.map((t: any) => t.id);
      let eventsData: any[] = [];
      if (targetTeamIds.length > 0) {
        let page = 0;
        const PAGE_SIZE = 1000;
        while (true) {
          const { data: pageEvents, error: evErr } = await dbClient
            .from('match_events')
            .select('id, event_type, player_id, team_id, match_id, player:applications(first_name, last_name, photo_url), team:teams(name, logo_url)')
            .in('team_id', targetTeamIds)
            .in('event_type', ['goal', 'assist', 'yellow_card', 'red_card'])
            .order('id', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

          if (evErr) {
            console.error('Error fetching match_events (tournament):', evErr);
            break;
          }
          if (!pageEvents || pageEvents.length === 0) break;
          eventsData = eventsData.concat(pageEvents);
          if (pageEvents.length < PAGE_SIZE) break;
          page++;
        }
      }

      if (eventsData && eventsData.length > 0) {
        const matchIdsInTournament = new Set(allTournamentMatches.map((m: any) => m.id));
        const filteredEvents = eventsData.filter((e: any) => matchIdsInTournament.has(e.match_id));
        const goalMap: any = {};
        const assistMap: any = {};
        const cardMap: any = {};

        filteredEvents.forEach((ev: any) => {
          const pId = ev.player_id || ev.id;
          const pName = ev.player ? `${ev.player.first_name || ''} ${ev.player.last_name || ''}`.trim() : (ev.player_name || 'O\'yinchi');
          const pTeam = ev.team ? ev.team.name : (ev.team_name || 'Jamoa');
          const pPhoto = ev.player?.photo_url || ev.player_photo || ev.team?.logo_url;

          if (ev.event_type === 'goal') {
            if (!goalMap[pId]) goalMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, goals: 0, played: 1 };
            goalMap[pId].goals += 1;
          }
          if (ev.event_type === 'assist') {
            if (!assistMap[pId]) assistMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, assists: 0, played: 1 };
            assistMap[pId].assists += 1;
          }
          if (ev.event_type === 'yellow_card' || ev.event_type === 'red_card') {
            if (!cardMap[pId]) cardMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, yellow: 0, red: 0 };
            if (ev.event_type === 'yellow_card') cardMap[pId].yellow += 1;
            if (ev.event_type === 'red_card') cardMap[pId].red += 1;
          }
        });

        setScorers(Object.values(goalMap).sort((a: any, b: any) => b.goals - a.goals));
        setAssists(Object.values(assistMap).sort((a: any, b: any) => b.assists - a.assists));
        setCardPlayers(Object.values(cardMap).sort((a: any, b: any) => (b.yellow + b.red * 2) - (a.yellow + a.red * 2)));

        const cardEvents = filteredEvents.filter((ev: any) => ev.event_type === 'yellow_card' || ev.event_type === 'red_card');
        const goalEvents = filteredEvents.filter((ev: any) => ev.event_type === 'goal');
        setRawCardEvents(cardEvents);
        setRawGoalEvents(goalEvents);
      }
    } catch (e) {
      console.error('Error in fetchTournamentData:', e);
    } finally {
      setLoading(false);
    }
  };

  // Belgilangan "Tur" filtriga bitta o'yin mos keladimi — guruh bosqichi (raqamli tur)
  // va pleyoff bosqichlari (stage nomi) uchun bir xil ishlaydigan umumiy tekshiruv.
  const matchInSelectedRound = (m: any): boolean => {
    if (!m) return false;
    if (!selectedRound || selectedRound === 'all') return true;
    if (KNOCKOUT_STAGES.includes(selectedRound)) {
      return (m.stage || 'group') === selectedRound;
    }
    return String(m.round || '') === String(selectedRound);
  };

  // Tanlangan "Tur" uchun ko'rinadigan yorliq matni (masalan "3-TUR" yoki "YARIM FINAL")
  const selectedRoundLabel = (): string => {
    if (!selectedRound || selectedRound === 'all') return '';
    if (KNOCKOUT_STAGES.includes(selectedRound)) {
      return getStageDisplayTitle(selectedRound, null);
    }
    return `${selectedRound}-TUR`;
  };

  // Process Cards Export (Barcha or Belgilangan tur)
  const processCardsExport = async (filterMode: 'all' | 'round') => {
    setShowCardsModal(false);

    try {
      const cardMap: any = {};

      const filteredEvents = rawCardEvents.filter((ev: any) => {
        if (filterMode === 'all') return true;
        if (!selectedRound || selectedRound === 'all') return true;
        const matchObj = matches.find((m: any) => String(m.id) === String(ev.match_id));
        return matchInSelectedRound(matchObj);
      });

      filteredEvents.forEach((ev: any) => {
        const pId = ev.player_id || ev.id;
        const pName = ev.player ? `${ev.player.first_name || ''} ${ev.player.last_name || ''}`.trim() : (ev.player_name || "O'yinchi");
        const pTeam = ev.team ? ev.team.name : (ev.team_name || 'Jamoa');
        const pPhoto = ev.player?.photo_url || ev.player_photo || ev.team?.logo_url;

        if (!cardMap[pId]) cardMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, yellow: 0, red: 0 };
        if (ev.event_type === 'yellow_card') cardMap[pId].yellow += 1;
        if (ev.event_type === 'red_card') cardMap[pId].red += 1;
      });

      const updatedList = Object.values(cardMap).sort((a: any, b: any) => (b.yellow + b.red * 2) - (a.yellow + a.red * 2));
      setCardPlayers(updatedList);

      // Brief delay for React re-render of canvas before capture
      await new Promise((resolve) => setTimeout(resolve, 150));

      await handleExportPNG(cardsRef, 'Kartochkalar_Jadvali');
    } catch (e) {
      console.error(e);
      Alert.alert("Xatolik", "Kartochkalar rasmini yuklashda xatolik yuz berdi");
      setDownloadingSection(null);
    }
  };

  // Capture & Save PNG Image directly to device photo gallery (or share fallback)
  const handleExportPNG = async (ref: any, sectionName: string) => {
    setDownloadingSection(sectionName);
    try {
      if (!ref || !ref.current) {
        Alert.alert("Xatolik", "Rasm yaratish obyekti topilmadi.");
        return;
      }
      const uri = await ref.current.capture();
      let savedToGallery = false;
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.createAssetAsync(uri);
          savedToGallery = true;
        }
      } catch (permErr) {
        console.warn('MediaLibrary gallery save error:', permErr);
      }

      if (savedToGallery) {
        Alert.alert("Muvaffaqiyatli! 📸", "Rasm to'g'ridan-to'g'ri telefon galereyasiga saqlandi!");
      } else {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: `${(exportScope === 'tournament' ? selectedTournament?.name : selectedLeague?.name) || 'AMATORA'} - ${sectionName} PNG`,
            UTI: 'public.png',
          });
        } else {
          Alert.alert("Muvaffaqiyatli", `Rasm yaratildi: ${uri}`);
        }
      }
    } catch (e: any) {
      console.error(e);
      Alert.alert("Xatolik", "Rasmni eksport qilishda xatolik yuz berdi");
    } finally {
      setDownloadingSection(null);
    }
  };

  // Kunlar bo'yicha eksport: Agar kunda 8 tadan ko'p o'yin bo'lsa (masalan 14 ta), bitta tugma bilan 2 ta rasmni galereyaga saqlaydi
  const handleExportDaySchedule = async (dayGroup: any) => {
    if (exportingDayNumber !== null) return;
    setExportingDayNumber(dayGroup.dayNumber);

    try {
      let canSaveToGallery = false;
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        canSaveToGallery = status === 'granted';
      } catch (permErr) {
        console.warn('MediaLibrary permission check error:', permErr);
      }

      const totalChunks = dayGroup.chunks.length;
      let savedCount = 0;

      // Make sure this day is active
      const dayIndex = scheduleDayGroups.findIndex((g: any) => g.dayNumber === dayGroup.dayNumber);
      if (dayIndex >= 0) {
        setSelectedScheduleDayIdx(dayIndex);
      }

      for (let cIdx = 0; cIdx < totalChunks; cIdx++) {
        setSelectedSchedulePartIdx(cIdx);
        // Wait for re-render and native layout
        await new Promise(resolve => setTimeout(resolve, 300));

        if (!scheduleRef || !scheduleRef.current) {
          throw new Error("Rasm yaratish obyekti topilmadi.");
        }

        const uri = await scheduleRef.current.capture();

        if (canSaveToGallery) {
          await MediaLibrary.createAssetAsync(uri);
          savedCount++;
        } else {
          const isAvailable = await Sharing.isAvailableAsync();
          if (isAvailable) {
            await Sharing.shareAsync(uri, {
              mimeType: 'image/png',
              dialogTitle: `${selectedLeague?.name || 'AMATORA'} - ${dayGroup.dayNumber}-kun (${cIdx + 1}-qism)`,
              UTI: 'public.png',
            });
            savedCount++;
          }
        }

        if (cIdx < totalChunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      if (canSaveToGallery) {
        Alert.alert(
          "Muvaffaqiyatli! 📸",
          `${dayGroup.dayNumber}-kun (${dayGroup.formattedDate}) uchun ${savedCount} ta rasm to'g'ridan-to'g'ri telefoningiz galereyasiga saqlandi!`
        );
      } else {
        Alert.alert(
          "Muvaffaqiyatli",
          `${dayGroup.dayNumber}-kun uchun ${savedCount} ta rasm tayyorlandi.`
        );
      }
    } catch (e: any) {
      console.error('Error exporting day schedule:', e);
      Alert.alert("Xatolik", "O'yin jadvalini eksport qilishda xatolik yuz berdi: " + (e.message || ''));
    } finally {
      setExportingDayNumber(null);
    }
  };

  // HTML Generator for PDF Export
  const generatePDFHTML = (teamsToProcess: any[], titleText: string) => {
    const teamsHtml = teamsToProcess.map((team) => {
      const teamPlayers = allApplications.filter(
        (a) => String(a.team_id) === String(team.id) || a.team_name === team.name
      );

      const rowsHtml = teamPlayers.length > 0
        ? teamPlayers.map((app, idx) => {
            const avatar = app.photo_url || app.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&fit=crop';
            const fullName = `${app.last_name || ''} ${app.first_name || ''}<br/><small style="color: #64748b;">${app.father_name || ''}</small>`.trim();
            const passStr = (app.passport_series || '') + (app.passport_number || '') || '-';
            const birthDate = app.birth_date ? new Date(app.birth_date).toLocaleDateString('ru-RU') : '-';
            const pos = app.position || '-';
            const num = app.player_number ? `#${app.player_number}` : '-';

            return `
              <tr>
                <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
                <td style="text-align: center;">
                  <img src="${avatar}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;" />
                </td>
                <td style="font-weight: 600; text-transform: uppercase;">${fullName}</td>
                <td style="text-align: center; font-weight: 600;">${passStr}</td>
                <td style="text-align: center;">${birthDate}</td>
                <td style="text-align: center;">${pos}</td>
                <td style="text-align: center; font-weight: bold; color: #16a34a;">${num}</td>
              </tr>
            `;
          }).join('')
        : `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 15px;">Ushbu jamoada birorta o'yinchi ro'yxatdan o'tmagan</td></tr>`;

      const logo = team.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&fit=crop';

      return `
        <div style="page-break-inside: avoid; margin-bottom: 30px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
          <div style="background: #0f172a; color: #fff; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${logo}" style="width: 38px; height: 38px; border-radius: 50%; border: 2px solid #38bdf8; object-fit: cover;" />
              <div>
                <h3 style="margin: 0; font-size: 16px; font-weight: 800; text-transform: uppercase; color: #fff;">${team.name}</h3>
                <span style="font-size: 11px; color: #94a3b8;">${team.league || selectedLeague?.name || 'AMATORA LEAGUE'}</span>
              </div>
            </div>
            <div style="font-size: 12px; background: rgba(255,255,255,0.1); padding: 4px 10px; border-radius: 20px;">
              Jamoa a'zolari: <strong>${teamPlayers.length} ta</strong>
            </div>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: #f8fafc; color: #475569; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0;">
                <th style="padding: 8px; width: 30px; text-align: center;">#</th>
                <th style="padding: 8px; width: 45px; text-align: center;">Rasm</th>
                <th style="padding: 8px; text-align: left;">F.I.SH</th>
                <th style="padding: 8px; text-align: center;">Pasport / ID</th>
                <th style="padding: 8px; text-align: center;">Tug'ilgan sana</th>
                <th style="padding: 8px; text-align: center;">Amplua</th>
                <th style="padding: 8px; text-align: center; width: 40px;">No</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 20px; padding: 0; color: #1e293b; background: #fff; }
            .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 15px; border-bottom: 2px solid #0f172a; margin-bottom: 20px; }
            .header-title { font-size: 22px; font-weight: 900; color: #0f172a; text-transform: uppercase; margin: 0; }
            .header-subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
            .date { font-size: 11px; color: #94a3b8; text-align: right; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="header-title">${titleText}</h1>
              <div class="header-subtitle">AMATORA LEAGUE OFFICIAL PLAYER ROSTER & APPLICATION PDF REPORT</div>
            </div>
            <div class="date">Yaratilgan sana: ${new Date().toLocaleDateString('ru-RU')}</div>
          </div>
          ${teamsHtml}
        </body>
      </html>
    `;
  };

  const handleExecutePDFExport = async (mode: 'all' | 'team' | 'league') => {
    setIsPDFExporting(true);
    setPdfError(null);

    try {
      let teamsToExport: any[] = [];
      let docTitle = "AMATORA LEAGUE - O'YINCHILAR RO'YXATI";

      if (mode === 'league') {
        if (!selectedPDFLeagueName) {
          setPdfError("Iltimos, liga tanlang!");
          setIsPDFExporting(false);
          return;
        }
        teamsToExport = (allTeams.length > 0 ? allTeams : teams).filter(
          (t) => String(t.league || '').toLowerCase().includes(selectedPDFLeagueName.toLowerCase()) || String(t.league_id) === String(selectedPDFLeagueName)
        );
        docTitle = `${selectedPDFLeagueName.toUpperCase()} - JAMOALAR VA O'YINCHILAR`;
      } else if (mode === 'team') {
        if (!selectedPDFTeamId) {
          setPdfError("Iltimos, jamoa tanlang!");
          setIsPDFExporting(false);
          return;
        }
        const targetTeam = (allTeams.length > 0 ? allTeams : teams).find(
          (t) => String(t.id) === String(selectedPDFTeamId)
        );
        if (targetTeam) {
          teamsToExport = [targetTeam];
          docTitle = `${targetTeam.name.toUpperCase()} - JAMOA TARKIBI`;
        }
      } else {
        teamsToExport = allTeams.length > 0 ? allTeams : teams;
        docTitle = "BARCHA JAMOALAR VA O'YINCHILAR RO'YXATI";
      }

      if (teamsToExport.length === 0) {
        setPdfError("Eksport qilish uchun jamoalar topilmadi!");
        setIsPDFExporting(false);
        return;
      }

      const htmlContent = generatePDFHTML(teamsToExport, docTitle);
      const { uri } = await Print.printToFileAsync({ html: htmlContent });

      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `${docTitle}.pdf`,
        UTI: 'com.adobe.pdf',
      });

      setShowPDFModal(false);
    } catch (e: any) {
      console.error(e);
      setPdfError("PDF yaratishda xatolik yuz berdi");
    } finally {
      setIsPDFExporting(false);
    }
  };

  // Calculate active match count for NATIJALAR card sizing
  const currentRoundMatches = (selectedRound && selectedRound !== 'all')
    ? matches.filter(matchInSelectedRound)
    : matches;
  const activeMatchCount = currentRoundMatches.length > 0 ? currentRoundMatches.length : matches.length;

  // Match Schedule Day & Part Groups (Splits matches by day; max 8 matches per 1x1 image chunk)
  const scheduleDayGroups = React.useMemo(() => {
    let listToRender: any[] = [];
    if (selectedRound && selectedRound !== 'all') {
      listToRender = matches.filter(matchInSelectedRound);
    } else {
      const scheduledList = matches.filter((m: any) =>
        m.status === 'scheduled' ||
        m.status === 'first_half' ||
        m.status === 'second_half' ||
        m.status === 'half_time' ||
        (m.home_score === null && m.away_score === null && m.status !== 'finished')
      );
      if (scheduledList.length > 0) {
        const rounds = scheduledList.map((m: any) => Number(m.round || 1)).filter(r => !isNaN(r));
        const activeRoundNumber = rounds.length > 0 ? Math.min(...rounds) : 1;
        listToRender = matches.filter((m: any) => Number(m.round || 1) === activeRoundNumber);
      } else {
        const rounds = matches.map((m: any) => Number(m.round || 1)).filter(r => !isNaN(r));
        const activeRoundNumber = rounds.length > 0 ? Math.max(...rounds) : 1;
        listToRender = matches.filter((m: any) => Number(m.round || 1) === activeRoundNumber);
      }
    }
    if (listToRender.length === 0) listToRender = matches;

    const sorted = [...listToRender].sort(compareMatches);

    const map = new Map<string, any[]>();
    sorted.forEach((m: any) => {
      const d = m.match_date ? String(m.match_date).trim() : (m.date ? String(m.date).trim() : 'Belgilanmagan');
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(m);
    });

    const groups: any[] = [];
    let dayIdx = 1;
    map.forEach((matchesList, rawDate) => {
      const formattedDate = rawDate !== 'Belgilanmagan'
        ? rawDate.split('-').reverse().join('.')
        : 'Belgilanmagan';

      const chunks: any[][] = [];
      const CHUNK_SIZE = 8;
      for (let i = 0; i < matchesList.length; i += CHUNK_SIZE) {
        chunks.push(matchesList.slice(i, i + CHUNK_SIZE));
      }

      groups.push({
        dayNumber: dayIdx++,
        date: rawDate,
        formattedDate,
        matches: matchesList,
        chunks,
      });
    });

    return groups;
  }, [matches, selectedRound]);


  // Dynamic values for Standings Table canvas (Enlarged team name fonts)
  const isTournament = exportScope === 'tournament';
  const teamCount = teams.length;
  let rowPadding = 9.7;
  let fontSize = 22.5;
  let logoSize = 36.8;
  let headerPadding = 11.6;
  let headerFontSize = 18.5;

  if (teamCount > 18) {
    rowPadding = 3.8;
    fontSize = 15.5;
    logoSize = 23.2;
    headerPadding = 5.8;
    headerFontSize = 14.5;
  } else if (teamCount > 14) {
    rowPadding = 5.8;
    fontSize = 18;
    logoSize = 29.1;
    headerPadding = 7.7;
    headerFontSize = 16.5;
  } else if (teamCount > 11) {
    rowPadding = 7.7;
    fontSize = 19.5;
    logoSize = 33;
    headerPadding = 9.7;
    headerFontSize = 17.5;
  }

  // 9:16 Tournament Standings Poster (1080x1920 matching UEFA format)
  const tournCanvasHeight = 1920;
  const tFontSize = teamCount > 35 ? 13.5 : teamCount > 24 ? 15 : teamCount > 16 ? 16.5 : 18;
  const tLogoSize = teamCount > 35 ? 20 : teamCount > 24 ? 24 : teamCount > 16 ? 28 : 34;

  const zone1Limit = 8;
  const zone2Limit = 24;
  const zone1Label = '1\\8 FINAL';
  const zone2Label = '1\\16 FINAL';
  const zone3Label = 'TURNIRNI TARK ETADIGANLAR';

  const orgName = (orgData?.name || 'AMATORA').toUpperCase();
  const tournName = (selectedTournament?.name || 'TURNIR').toUpperCase();
  const parsedTourn = parseTournamentTier(selectedTournament);
  const tournColor = parsedTourn.color || (parsedTourn.tier === 2 ? '#38BDF8' : '#22C55E');
  const tournRowHeight = teamCount > 35 ? 31 : teamCount > 24 ? 33 : teamCount > 16 ? 38 : 44;
  const tournTableWidth = 710;
  const tournStatsWidth = 184;
  const tournBracketWidth = 54;
  const tournLeftBlockWidth = tournTableWidth - tournStatsWidth - tournBracketWidth; // 472px

  // Theme check for graphics (matching Standings.jsx)
  const isCollab = isTournament ? (selectedTournament?.isCollab || !!collabInfo) : (selectedLeague?.isCollab || !!collabInfo);
  const exportBgUrl = isTournament
    ? (selectedTournament?.export_bg_url || selectedTournament?.bg_image || selectedTournament?.bg_url || selectedLeague?.export_bg_url || selectedLeague?.bg_image || null)
    : (selectedLeague?.export_bg_url || selectedLeague?.bg_image || null);

  return (
    <View style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      {/* Header Selector Card */}
      <View style={[
        styles.headerCard,
        Platform.OS === 'android' && { backgroundColor: colors.bgPrimary, borderBottomColor: colors.border },
      ]}>
        {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}

        {/* Liga / Turnir Scope Toggle */}
        <View style={styles.exportScopeToggle}>
          <TouchableOpacity
            style={[styles.exportScopeBtn, exportScope === 'league' && styles.exportScopeBtnActiveLeague]}
            onPress={() => handleSetExportScope('league')}
            activeOpacity={0.8}
          >
            <Ionicons name="trophy-outline" size={14} color={exportScope === 'league' ? '#F59E0B' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')} />
            <Text style={[styles.exportScopeText, exportScope === 'league' && { color: '#F59E0B' }, Platform.OS === 'android' && { color: exportScope === 'league' ? '#F59E0B' : colors.textMuted }]}>
              {"Liga"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.exportScopeBtn, exportScope === 'tournament' && styles.exportScopeBtnActiveTournament]}
            onPress={() => handleSetExportScope('tournament')}
            activeOpacity={0.8}
          >
            <Ionicons name="ribbon-outline" size={14} color={exportScope === 'tournament' ? '#EC4899' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')} />
            <Text style={[styles.exportScopeText, exportScope === 'tournament' && { color: '#EC4899' }, Platform.OS === 'android' && { color: exportScope === 'tournament' ? '#EC4899' : colors.textMuted }]}>
              {"Turnir"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dropdownsRow}>
          {/* League / Tournament Dropdown Trigger (scope-aware) */}
          <View style={styles.dropdownWrapper}>
            <Text style={[styles.dropdownLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{exportScope === 'tournament' ? "Turnir:" : "Liga:"}</Text>
            <TouchableOpacity
              style={[styles.dropdownBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              onPress={() => {
                if (exportScope === 'tournament') {
                  setShowTournamentDropdown(true);
                } else {
                  setShowLeagueDropdown(true);
                }
                setShowRoundDropdown(false);
              }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 4 }}>
                <Ionicons name={exportScope === 'tournament' ? 'ribbon' : 'trophy'} size={15} color={exportScope === 'tournament' ? '#EC4899' : '#F59E0B'} />
                <Text style={[styles.dropdownBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                  {selectedLeague?.name || (exportScope === 'tournament' ? "Turnirlarni yuklash..." : "Ligalarni yuklash...")}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={Platform.OS === 'android' ? colors.textMuted : "#94A3B8"} />
            </TouchableOpacity>
          </View>

          {/* Round Dropdown Trigger */}
          <View style={styles.dropdownWrapper}>
            <Text style={[styles.dropdownLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Tur (Round):"}</Text>
            <TouchableOpacity
              style={[styles.dropdownBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              onPress={() => {
                setShowRoundDropdown(true);
                setShowLeagueDropdown(false);
              }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 4 }}>
                <Ionicons name="layers" size={15} color="#38BDF8" />
                <Text style={[styles.dropdownBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                  {selectedRound === 'all' ? 'Barchasi' : (KNOCKOUT_STAGES.includes(selectedRound) ? getStageDisplayTitle(selectedRound, null) : `${selectedRound}-Tur`)}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={Platform.OS === 'android' ? colors.textMuted : "#94A3B8"} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* League Selection Modal Picker */}
      <Modal
        visible={showLeagueDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLeagueDropdown(false)}
        statusBarTranslucent
      >
        <View style={styles.filterModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowLeagueDropdown(false)}
          />
          <View style={[
            styles.filterModalContent,
            Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }
          ]}>
            {Platform.OS === 'ios' && <BlurView intensity={95} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            
            <View style={[styles.filterModalHeader, Platform.OS === 'android' && { borderBottomColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="trophy" size={20} color="#F59E0B" />
                <Text style={[styles.filterModalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ligani tanlang"}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowLeagueDropdown(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.filterModalCloseBtn}
              >
                <Ionicons name="close" size={20} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.7)"} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={true} nestedScrollEnabled>
              {leagues.length === 0 ? (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                    {"Ligalar topilmadi"}
                  </Text>
                </View>
              ) : (
                leagues.map((lg) => {
                  const isSelected = selectedLeague?.id === lg.id;
                  return (
                    <TouchableOpacity
                      key={lg.id}
                      style={[
                        styles.filterModalItem,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                        isSelected && styles.filterModalItemActive,
                        Platform.OS === 'android' && isSelected && {
                          backgroundColor: isDark ? 'rgba(0, 255, 102, 0.15)' : '#ECFDF5',
                          borderColor: colors.accentGreen,
                        },
                      ]}
                      onPress={() => {
                        setSelectedLeague(lg);
                        setSavedLeagueSelection(lg);
                        setShowLeagueDropdown(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 }}>
                        {lg.logo_url ? (
                          <Image source={{ uri: lg.logo_url }} style={{ width: 26, height: 26, borderRadius: 13, resizeMode: 'cover' }} />
                        ) : (
                          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(245, 158, 11, 0.2)', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="trophy-outline" size={14} color="#F59E0B" />
                          </View>
                        )}
                        <Text
                          style={[
                            styles.filterModalItemText,
                            Platform.OS === 'android' && { color: colors.textPrimary },
                            isSelected && styles.filterModalItemTextActive,
                            Platform.OS === 'android' && isSelected && { color: colors.accentGreen },
                          ]}
                          numberOfLines={1}
                        >
                          {lg.name}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={20} color={Platform.OS === 'android' ? colors.accentGreen : "#00FF66"} />
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Tournament Selection Modal Picker */}
      <Modal
        visible={showTournamentDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTournamentDropdown(false)}
        statusBarTranslucent
      >
        <View style={styles.filterModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowTournamentDropdown(false)}
          />
          <View style={[
            styles.filterModalContent,
            Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }
          ]}>
            {Platform.OS === 'ios' && <BlurView intensity={95} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}

            <View style={[styles.filterModalHeader, Platform.OS === 'android' && { borderBottomColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="ribbon" size={20} color="#EC4899" />
                <Text style={[styles.filterModalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Turnirni tanlang"}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowTournamentDropdown(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.filterModalCloseBtn}
              >
                <Ionicons name="close" size={20} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.7)"} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={true} nestedScrollEnabled>
              {tournaments.length === 0 ? (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                    {"Turnirlar topilmadi"}
                  </Text>
                </View>
              ) : (
                tournaments.map((t: any) => {
                  const isSelected = String(selectedTournament?.id) === String(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[
                        styles.filterModalItem,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                        isSelected && styles.filterModalItemActive,
                        Platform.OS === 'android' && isSelected && {
                          backgroundColor: isDark ? 'rgba(0, 255, 102, 0.15)' : '#ECFDF5',
                          borderColor: colors.accentGreen,
                        },
                      ]}
                      onPress={() => {
                        setSelectedTournament(t);
                        setSelectedLeague(buildTournamentProxy(t));
                        setShowTournamentDropdown(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 }}>
                        {t.logo_url ? (
                          <Image source={{ uri: t.logo_url }} style={{ width: 26, height: 26, borderRadius: 13, resizeMode: 'cover' }} />
                        ) : (
                          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(236, 72, 153, 0.2)', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="ribbon-outline" size={14} color="#EC4899" />
                          </View>
                        )}
                        <Text
                          style={[
                            styles.filterModalItemText,
                            Platform.OS === 'android' && { color: colors.textPrimary },
                            isSelected && styles.filterModalItemTextActive,
                            Platform.OS === 'android' && isSelected && { color: colors.accentGreen },
                          ]}
                          numberOfLines={1}
                        >
                          {t.name}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={20} color={Platform.OS === 'android' ? colors.accentGreen : "#00FF66"} />
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Round Selection Modal Picker */}
      <Modal
        visible={showRoundDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRoundDropdown(false)}
        statusBarTranslucent
      >
        <View style={styles.filterModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowRoundDropdown(false)}
          />
          <View style={[
            styles.filterModalContent,
            Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }
          ]}>
            {Platform.OS === 'ios' && <BlurView intensity={95} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            
            <View style={[styles.filterModalHeader, Platform.OS === 'android' && { borderBottomColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="layers" size={20} color="#38BDF8" />
                <Text style={[styles.filterModalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Turni tanlang"}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowRoundDropdown(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.filterModalCloseBtn}
              >
                <Ionicons name="close" size={20} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.7)"} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={true} nestedScrollEnabled>
              {availableRounds.map((r) => {
                const isSelected = selectedRound === r;
                const stageMatch = matches.find((m: any) => String(m.round) === String(r) && m.stage && m.stage !== 'group');
                const roundTitle = r === 'all'
                  ? 'Barcha turlar'
                  : (KNOCKOUT_STAGES.includes(r)
                      ? getStageDisplayTitle(r, null)
                      : (stageMatch ? getStageDisplayTitle(stageMatch.stage, stageMatch.round) : `${r}-Tur`));
                return (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.filterModalItem,
                      Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                      isSelected && styles.filterModalItemActive,
                      Platform.OS === 'android' && isSelected && {
                        backgroundColor: isDark ? 'rgba(0, 255, 102, 0.15)' : '#ECFDF5',
                        borderColor: colors.accentGreen,
                      },
                    ]}
                    onPress={() => {
                      setSelectedRound(r);
                      setShowRoundDropdown(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 }}>
                      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: isSelected ? 'rgba(0, 255, 102, 0.2)' : 'rgba(56, 189, 248, 0.2)', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons
                          name={r === 'all' ? "grid-outline" : "flag-outline"}
                          size={14}
                          color={isSelected ? (Platform.OS === 'android' ? colors.accentGreen : "#00FF66") : "#38BDF8"}
                        />
                      </View>
                      <Text
                        style={[
                          styles.filterModalItemText,
                          Platform.OS === 'android' && { color: colors.textPrimary },
                          isSelected && styles.filterModalItemTextActive,
                          Platform.OS === 'android' && isSelected && { color: colors.accentGreen },
                        ]}
                      >
                        {roundTitle}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={20} color={Platform.OS === 'android' ? colors.accentGreen : "#00FF66"} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {loading ? (
        <ExportSkeleton />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {/* 1. TURNIR JADVALI (1080x1080 PNG GRAPHIC MATCHING IMAGE 2 1-TO-1) */}
          <View style={[styles.exportSectionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"1. Turnir Jadvali"}</Text>
                <Text style={[styles.sectionSubtitle, Platform.OS === 'android' && { color: colors.textMuted }]}>
                  {isTournament ? "9:16 Formatdagi Turnir Jadvali PNG" : "1:1 Formatdagi Standings Post PNG (1080x1080)"}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.downloadBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                onPress={() => handleExportPNG(standingsRef, 'Turnir_Jadvali')}
                disabled={downloadingSection === 'Turnir_Jadvali'}
              >
                {downloadingSection === 'Turnir_Jadvali' ? (
                  <ActivityIndicator size="small" color={Platform.OS === 'android' ? colors.textPrimary : "#000000"} />
                ) : (
                  <>
                    <Ionicons name="download" size={16} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
                    <Text style={[styles.downloadBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"PNG yuklab olish"}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Scaled Preview Wrapper */}
            <ScaledCanvasPreview refObj={standingsRef} width={1080} height={isTournament ? tournCanvasHeight : 1080}>
              {isTournament ? (
                <ImageBackground
                  source={exportBgUrl ? { uri: exportBgUrl } : undefined}
                  style={{ width: 1080, height: tournCanvasHeight, backgroundColor: '#030718' }}
                  resizeMode="cover"
                >
                  <View
                    style={{
                      flex: 1,
                      backgroundColor: exportBgUrl ? 'rgba(3, 7, 24, 0.60)' : '#030718',
                      width: 1080,
                      height: tournCanvasHeight,
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingHorizontal: 28,
                      paddingVertical: 24,
                    }}
                  >
                    {/* Top Header */}
                    <View style={{ height: 115, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, width: 1080 - 56 }}>
                      {/* Left Emblem */}
                      <View style={{ width: 220, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {isCollab ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            {selectedTournament?.org1?.logo_url || orgData?.logo_url ? (
                              <Image source={{ uri: selectedTournament?.org1?.logo_url || orgData?.logo_url }} style={{ height: 70, width: 70, resizeMode: 'contain' }} />
                            ) : null}
                            <Text style={{ color: '#94a3b8', fontSize: 14, fontWeight: 'bold' }}>✕</Text>
                            {selectedTournament?.org2?.logo_url ? (
                              <Image source={{ uri: selectedTournament?.org2?.logo_url }} style={{ height: 60, width: 60, resizeMode: 'contain' }} />
                            ) : null}
                          </View>
                        ) : (
                          orgData?.logo_url ? (
                            <Image source={{ uri: orgData.logo_url }} style={{ maxHeight: 85, maxWidth: 200, width: 180, height: 85, resizeMode: 'contain' }} />
                          ) : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Ionicons name="football" size={28} color="#FFFFFF" />
                              <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 1.5 }}>{"AMATORA"}</Text>
                            </View>
                          )
                        )}
                      </View>

                      {/* Center: Tournament Logo / Title */}
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        {selectedTournament?.logo_url ? (
                          <Image source={{ uri: selectedTournament.logo_url }} style={{ maxHeight: 90, maxWidth: 420, width: 360, height: 90, resizeMode: 'contain' }} />
                        ) : (
                          <View style={{ alignItems: 'center' }}>
                            <Text style={{ fontSize: 13, color: tournColor, fontWeight: '800', letterSpacing: 3 }}>{orgName}</Text>
                            <Text style={{ fontSize: 26, color: '#ffffff', fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' }}>{tournName}</Text>
                          </View>
                        )}
                      </View>

                      {/* Right Brand / Media Logo */}
                      <View style={{ width: 220, alignItems: 'flex-end', justifyContent: 'center' }}>
                        {mainSponsorLogo ? (
                          <Image source={{ uri: mainSponsorLogo }} style={{ maxHeight: 75, maxWidth: 200, width: 180, height: 75, resizeMode: 'contain' }} />
                        ) : (
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={{ fontSize: 19, fontWeight: '900', color: '#ffffff', letterSpacing: 1 }}>{orgName}</Text>
                            <Text style={{ fontSize: 12, fontWeight: '800', color: tournColor, letterSpacing: 2 }}>{"FUTBOL MEDIA"}</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Center Section: Left Rotated Title + Compact Table & Right Zone Column */}
                    <View style={{ width: 1080 - 56, flexDirection: 'row', gap: 16, alignItems: 'flex-start', justifyContent: 'flex-start', paddingLeft: 20 }}>
                      {/* Left Column with Rotated Title (Clean typography, side-by-side parallel lines) */}
                      <View
                        style={{
                          width: 95,
                          height: Math.min(zone2Limit, teamCount) * tournRowHeight,
                          justifyContent: 'center',
                          alignItems: 'center',
                          position: 'relative',
                        }}
                      >
                        <View
                          style={{
                            width: Math.min(640, (Math.min(zone2Limit, teamCount) * tournRowHeight) - 10),
                            height: 95,
                            position: 'absolute',
                            transform: [{ rotate: '-90deg' }],
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 16.5,
                              fontWeight: '800',
                              color: tournColor,
                              letterSpacing: 7.5,
                              textTransform: 'uppercase',
                              textAlign: 'center',
                            }}
                            numberOfLines={1}
                          >
                            {`${orgName} ${tournName.includes('LIGA') ? tournName : `${tournName} LIGASI`}`}
                          </Text>
                          <Text
                            style={{
                              fontSize: 56,
                              fontWeight: '900',
                              color: '#FFFFFF',
                              letterSpacing: 4.5,
                              textTransform: 'uppercase',
                              textAlign: 'center',
                            }}
                            numberOfLines={1}
                          >
                            {"TURNIR JADVALI"}
                          </Text>
                        </View>
                      </View>

                      {/* Unified Table + Bracket Container (Width: tournTableWidth = 710px) */}
                      <View
                        style={{
                          width: tournTableWidth,
                          flexDirection: 'column',
                          overflow: 'hidden',
                          borderRadius: 4,
                        }}
                      >
                        <View style={{ width: tournTableWidth, flexDirection: 'row' }}>
                          {/* Table Container (Width: tournTableWidth - tournBracketWidth = 656px) */}
                          <View
                            style={{
                              width: tournTableWidth - tournBracketWidth,
                              flexDirection: 'column',
                            }}
                          >
                            {/* Table Header (Height: 38) */}
                            <View
                              style={{
                                height: 38,
                                flexDirection: 'row',
                                alignItems: 'center',
                                borderBottomWidth: 1,
                                borderBottomColor: 'rgba(255, 255, 255, 0.1)',
                              }}
                            >
                              {/* Left Header (# & JAMOALAR) */}
                              <View
                                style={{
                                  width: tournLeftBlockWidth,
                                  height: '100%',
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  paddingHorizontal: 10,
                                  backgroundColor: exportBgUrl ? 'rgba(7, 18, 48, 0.95)' : '#07153B',
                                }}
                              >
                                <Text style={{ width: 38, textAlign: 'center', color: '#ffffff', fontWeight: '900', fontSize: tFontSize }}>{"#"}</Text>
                                <Text style={{ flex: 1, paddingLeft: 8, color: '#ffffff', fontWeight: '900', fontSize: tFontSize, letterSpacing: 1 }}>{"JAMOALAR"}</Text>
                              </View>

                              {/* Right Header (O'YIN, T/N, OCHKO: width: 184) */}
                              <View
                                style={{
                                  width: tournStatsWidth,
                                  height: '100%',
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  backgroundColor: exportBgUrl ? 'rgba(23, 63, 181, 0.95)' : '#173FB5',
                                }}
                              >
                                <Text style={{ width: 56, textAlign: 'center', color: '#ffffff', fontWeight: '900', fontSize: tFontSize }}>{"O'YIN"}</Text>
                                <Text style={{ width: 56, textAlign: 'center', color: '#ffffff', fontWeight: '900', fontSize: tFontSize }}>{"T/N"}</Text>
                                <Text style={{ width: 72, textAlign: 'center', color: '#ffffff', fontWeight: '900', fontSize: tFontSize }}>{"OCHKO"}</Text>
                              </View>
                            </View>

                            {/* Table Body */}
                            <View style={{ width: tournTableWidth - tournBracketWidth, flexDirection: 'column' }}>
                              {teams.length === 0 ? (
                                <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}>
                                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, fontWeight: '700' }}>{"JAMOALAR MAVJUD EMAS"}</Text>
                                </View>
                              ) : (
                                teams.map((t: any, idx: number) => {
                                  const rank = idx + 1;
                                  const inZone1 = rank <= zone1Limit;
                                  const inZone2 = rank > zone1Limit && rank <= zone2Limit;
                                  const inZone3 = rank > zone2Limit;

                                  const isZone1End = rank === zone1Limit;
                                  const isZone2End = rank === zone2Limit;

                                  let borderBottomColor = 'rgba(255, 255, 255, 0.05)';
                                  let borderBottomWidth = 1;
                                  if (isZone1End && rank < teamCount) {
                                    borderBottomColor = tournColor;
                                    borderBottomWidth = 3.5;
                                  } else if (isZone2End && rank < teamCount) {
                                    borderBottomColor = '#EF4444';
                                    borderBottomWidth = 3.5;
                                  }

                                  const leftBg = inZone3
                                    ? (exportBgUrl ? 'rgba(19, 67, 223, 0.90)' : '#1343DF')
                                    : (exportBgUrl ? 'rgba(7, 18, 48, 0.90)' : '#07153B');

                                  const rightBg = inZone3
                                    ? (exportBgUrl ? 'rgba(19, 67, 223, 0.90)' : '#1343DF')
                                    : (exportBgUrl ? 'rgba(23, 63, 181, 0.92)' : '#173FB5');

                                  return (
                                    <View
                                      key={t.id || idx}
                                      style={{
                                        width: tournTableWidth - tournBracketWidth,
                                        height: tournRowHeight,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        borderBottomWidth,
                                        borderBottomColor,
                                      }}
                                    >
                                      {/* Left Team Info Section */}
                                      <View
                                        style={{
                                          width: tournLeftBlockWidth,
                                          height: '100%',
                                          flexDirection: 'row',
                                          alignItems: 'center',
                                          paddingHorizontal: 10,
                                          backgroundColor: leftBg,
                                        }}
                                      >
                                        <Text
                                          style={{
                                            width: 38,
                                            textAlign: 'center',
                                            fontWeight: '900',
                                            fontSize: tFontSize,
                                            color: '#FFFFFF',
                                          }}
                                        >
                                          {rank}
                                        </Text>

                                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, gap: 8 }}>
                                          {t.logo_url ? (
                                            <Image
                                              source={{ uri: t.logo_url }}
                                              style={{ width: tLogoSize, height: tLogoSize, borderRadius: tLogoSize / 2, resizeMode: 'cover', backgroundColor: 'rgba(255,255,255,0.08)' }}
                                            />
                                          ) : (
                                            <View style={{ width: tLogoSize, height: tLogoSize, borderRadius: tLogoSize / 2, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                                              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>{(t.name || '?')[0]}</Text>
                                            </View>
                                          )}
                                          <Text
                                            style={{
                                              flex: 1,
                                              color: '#FFFFFF',
                                              fontSize: tFontSize,
                                              fontWeight: '800',
                                              textTransform: 'uppercase',
                                              letterSpacing: 0.3,
                                            }}
                                            numberOfLines={1}
                                          >
                                            {t.name}
                                          </Text>
                                        </View>
                                      </View>

                                      {/* Right Stats Section (Royal Blue Block) */}
                                      <View
                                        style={{
                                          width: tournStatsWidth,
                                          height: '100%',
                                          flexDirection: 'row',
                                          alignItems: 'center',
                                          backgroundColor: rightBg,
                                        }}
                                      >
                                        <Text style={{ width: 56, textAlign: 'center', color: '#FFFFFF', fontWeight: '700', fontSize: tFontSize }}>
                                          {t.played ?? 0}
                                        </Text>
                                        <Text style={{ width: 56, textAlign: 'center', color: '#FFFFFF', fontWeight: '800', fontSize: tFontSize }}>
                                          {t.gd ?? 0}
                                        </Text>
                                        <Text style={{ width: 72, textAlign: 'center', color: '#FFFFFF', fontWeight: '900', fontSize: tFontSize }}>
                                          {t.points ?? 0}
                                        </Text>
                                      </View>
                                    </View>
                                  );
                                })
                              )}
                            </View>
                          </View>

                          {/* Right Bracket Column (flush next to table, matching row heights) */}
                          <View
                            style={{
                              width: tournBracketWidth,
                              flexDirection: 'column',
                              backgroundColor: exportBgUrl ? 'rgba(23, 63, 181, 0.92)' : '#173FB5',
                            }}
                          >
                            {/* Top spacer matching header */}
                            <View style={{ height: 38, backgroundColor: exportBgUrl ? 'rgba(23, 63, 181, 0.95)' : '#173FB5', borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }} />

                            {/* Zone 1 (1\8 FINAL) */}
                            <View
                              style={{
                                height: Math.min(zone1Limit, teamCount) * tournRowHeight,
                                justifyContent: 'center',
                                alignItems: 'center',
                                backgroundColor: exportBgUrl ? 'rgba(23, 63, 181, 0.92)' : '#173FB5',
                                borderBottomWidth: teamCount > zone1Limit ? 3.5 : 0,
                                borderBottomColor: tournColor,
                                position: 'relative',
                                overflow: 'hidden',
                              }}
                            >
                              <View style={{ width: 220, height: tournBracketWidth, position: 'absolute', transform: [{ rotate: '90deg' }], justifyContent: 'center', alignItems: 'center' }}>
                                <Text style={{ fontSize: 13, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 }}>
                                  {zone1Label}
                                </Text>
                              </View>
                            </View>

                            {/* Zone 2 (1\16 FINAL) */}
                            {teamCount > zone1Limit && (
                              <View
                                style={{
                                  height: Math.min(zone2Limit - zone1Limit, Math.max(0, teamCount - zone1Limit)) * tournRowHeight,
                                  justifyContent: 'center',
                                  alignItems: 'center',
                                  backgroundColor: exportBgUrl ? 'rgba(23, 63, 181, 0.92)' : '#173FB5',
                                  borderBottomWidth: teamCount > zone2Limit ? 3.5 : 0,
                                  borderBottomColor: '#EF4444',
                                  position: 'relative',
                                  overflow: 'hidden',
                                }}
                              >
                                <View style={{ width: 260, height: tournBracketWidth, position: 'absolute', transform: [{ rotate: '90deg' }], justifyContent: 'center', alignItems: 'center' }}>
                                  <Text style={{ fontSize: 13, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 }}>
                                    {zone2Label}
                                  </Text>
                                </View>
                              </View>
                            )}

                            {/* Zone 3 (TURNIRNI TARK ETADIGANLAR) */}
                            {teamCount > zone2Limit && (
                              <View
                                style={{
                                  height: Math.max(0, teamCount - zone2Limit) * tournRowHeight,
                                  justifyContent: 'center',
                                  alignItems: 'center',
                                  backgroundColor: exportBgUrl ? 'rgba(19, 67, 223, 0.90)' : '#1343DF',
                                  position: 'relative',
                                  overflow: 'hidden',
                                }}
                              >
                                <View style={{ width: 340, height: tournBracketWidth, position: 'absolute', transform: [{ rotate: '90deg' }], justifyContent: 'center', alignItems: 'center' }}>
                                  <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFFFFF', letterSpacing: 3 }} numberOfLines={1}>
                                    {zone3Label}
                                  </Text>
                                </View>
                              </View>
                            )}
                          </View>
                        </View>

                        {/* Bottom Accent Bar matching reference image */}
                        <View
                          style={{
                            width: tournTableWidth,
                            height: 22,
                            backgroundColor: exportBgUrl ? 'rgba(19, 67, 223, 0.90)' : '#1343DF',
                          }}
                        />
                      </View>
                    </View>

                    {/* Bottom Social Handle */}
                    <View style={{ height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
                      <View style={{ paddingVertical: 6, paddingHorizontal: 26, borderRadius: 22, backgroundColor: 'rgba(5, 12, 35, 0.85)', borderWidth: 1.2, borderColor: 'rgba(255, 255, 255, 0.2)' }}>
                        <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 1.2 }}>
                          {`@${(orgData?.slug || orgData?.name || selectedTournament?.name || 'havas_football').toLowerCase().replace(/[^a-z0-9]/g, '_')}`}
                        </Text>
                      </View>
                    </View>
                  </View>
                </ImageBackground>
              ) : (
                <ImageBackground
                  source={exportBgUrl ? { uri: exportBgUrl } : undefined}
                  style={{ width: 1080, height: 1080, backgroundColor: '#062354' }}
                  resizeMode="cover"
                >
                <View style={{ flex: 1, backgroundColor: 'rgba(10, 13, 18, 0.82)', width: 1080, height: 1080, justifyContent: 'space-between' }}>
                  
                  {/* Export Header */}
                  <View style={{ height: 180, paddingTop: 65, paddingHorizontal: 45, paddingBottom: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 1080 }}>
                    {/* Left: Collab or Org Logo */}
                    <View style={{ width: 280, minWidth: 280, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'flex-start' }}>
                      {isCollab && collabInfo ? (
                        <>
                          <Image
                            source={{ uri: collabInfo.sender_org?.logo_url || orgData?.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&fit=crop' }}
                            style={{ height: 105, width: 105, resizeMode: 'contain' }}
                          />
                          <Image
                            source={require('../../x.png')}
                            style={{ height: 20, width: 20, opacity: 0.7, tintColor: '#fff', resizeMode: 'contain' }}
                          />
                          <Image
                            source={{ uri: collabInfo.receiver_org?.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&fit=crop' }}
                            style={{ height: 95, width: 95, resizeMode: 'contain' }}
                          />
                        </>
                      ) : (
                        orgData?.logo_url ? (
                          <Image source={{ uri: orgData.logo_url }} style={{ height: 115, width: 240, resizeMode: 'contain' }} />
                        ) : (
                          <Text style={{ color: '#00FF66', fontSize: 32, fontWeight: '900', letterSpacing: 1.5 }}>{"AMATORA"}</Text>
                        )
                      )}
                    </View>

                    {/* Center: League Logo / Name */}
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }}>
                      {selectedLeague?.logo_url ? (
                        <Image source={{ uri: selectedLeague.logo_url }} style={{ maxHeight: 125, maxWidth: 460, width: 380, height: 125, resizeMode: 'contain' }} />
                      ) : (
                        <Text style={{ color: '#ffffff', fontSize: 42, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' }}>
                          {selectedLeague?.name || 'AMATORA LEAGUE'}
                        </Text>
                      )}
                    </View>

                    {/* Right: Main Sponsor Logo ONLY */}
                    <View style={{ width: 280, minWidth: 280, alignItems: 'flex-end', justifyContent: 'center' }}>
                      {mainSponsorLogo ? (
                        <Image source={{ uri: mainSponsorLogo }} style={{ maxHeight: 115, maxWidth: 290, width: 260, height: 115, resizeMode: 'contain' }} />
                      ) : (
                        <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 20, fontWeight: '900', letterSpacing: 1 }}>{"OFFICIAL"}</Text>
                      )}
                    </View>
                  </View>

                  {/* Main Grid Content (Centered vertically with breathing margin) */}
                  <View style={{ flex: 1, justifyContent: 'center', width: 1080, paddingVertical: 12 }}>
                    <View style={{ flexDirection: 'row', paddingHorizontal: 45, gap: 18, width: 1080, alignItems: 'center' }}>
                      
                      {/* Left Column: Standings Table */}
                      <View style={{ flex: 1.15, backgroundColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)', overflow: 'hidden', flexDirection: 'column', alignSelf: 'center' }}>
                        {/* Table Header */}
                        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255, 255, 255, 0.14)', paddingVertical: headerPadding, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: 'rgba(255, 255, 255, 0.25)' }}>
                          <Text style={{ width: 34, textAlign: 'center', color: '#ffffff', fontWeight: '900', fontSize: headerFontSize }}>{"#"}</Text>
                          <Text style={{ flex: 1, marginLeft: 8, color: '#ffffff', fontWeight: '900', fontSize: headerFontSize }}>{"JAMOA"}</Text>
                          <Text style={{ width: 44, textAlign: 'center', color: '#ffffff', fontWeight: '900', fontSize: headerFontSize }}>{"O'"}</Text>
                          <Text style={{ width: 44, textAlign: 'center', color: '#ffffff', fontWeight: '900', fontSize: headerFontSize }}>{"T/N"}</Text>
                          <Text style={{ width: 44, textAlign: 'center', color: '#ffffff', fontWeight: '900', fontSize: headerFontSize }}>{"O"}</Text>
                        </View>

                        {/* Table Body */}
                        <View style={{ justifyContent: 'flex-start' }}>
                          {teams.length === 0 ? (
                            <View style={{ padding: 30, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 16, fontWeight: '700' }}>{"JAMOALAR MAVJUD EMAS"}</Text>
                            </View>
                          ) : (
                            teams.map((t: any, idx: number) => (
                              <View key={t.id || idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: rowPadding, paddingHorizontal: 14, borderBottomWidth: idx < teams.length - 1 ? 1 : 0, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}>
                                <Text style={{ width: 34, textAlign: 'center', color: idx === 0 ? '#F59E0B' : '#ffffff', fontWeight: '900', fontSize: fontSize }}>{idx + 1}</Text>
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                  {t.logo_url ? (
                                    <Image source={{ uri: t.logo_url }} style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2, marginRight: 10, resizeMode: 'cover' }} />
                                  ) : (
                                    <View style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2, marginRight: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                      <Text style={{ color: '#fff', fontSize: logoSize * 0.5, fontWeight: '900' }}>{(t.name || '?')[0]?.toUpperCase()}</Text>
                                    </View>
                                  )}
                                  <Text style={{ color: '#ffffff', fontSize: fontSize, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.3 }} numberOfLines={1}>{t.name}</Text>
                                </View>
                                <Text style={{ width: 44, textAlign: 'center', color: 'rgba(255, 255, 255, 0.9)', fontWeight: '800', fontSize: fontSize }}>{t.played !== undefined ? t.played : 0}</Text>
                                <Text style={{ width: 44, textAlign: 'center', color: 'rgba(255, 255, 255, 0.9)', fontWeight: '800', fontSize: fontSize }}>{t.gd !== undefined ? t.gd : 0}</Text>
                                <Text style={{ width: 44, textAlign: 'center', color: '#FFFFFF', fontWeight: '900', fontSize: fontSize }}>{t.points !== undefined ? t.points : 0}</Text>
                              </View>
                            ))
                          )}
                        </View>
                      </View>

                      {/* Right Column: 3 Cards (Results, Top Scorers, Assists) - 1-to-1 matching Standings.jsx */}
                      <View style={{ flex: 0.85, flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
                        
                        {/* Card 1: NATIJALAR */}
                        <View style={{ backgroundColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)', overflow: 'hidden' }}>
                          <Text style={{ textAlign: 'center', paddingVertical: 9, paddingHorizontal: 12, fontSize: 16, fontWeight: '900', color: '#ffffff', textTransform: 'uppercase', backgroundColor: 'rgba(255, 255, 255, 0.14)', borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.25)', letterSpacing: 0.5 }}>
                            {(() => {
                              if (KNOCKOUT_STAGES.includes(selectedRound)) return `${selectedRoundLabel()} NATIJALARI`;
                              const stageMatch = matches.find((m: any) => selectedRound !== 'all' && String(m.round) === String(selectedRound) && m.stage && m.stage !== 'group');
                              if (stageMatch) return `${getStageDisplayTitle(stageMatch.stage, stageMatch.round)} NATIJALARI`;
                              return selectedRound === 'all' ? "NATIJALAR" : `${selectedRound}-TUR NATIJALARI`;
                            })()}
                          </Text>
                          <View style={{ justifyContent: 'flex-start', paddingTop: 2, paddingBottom: 4, paddingHorizontal: 8 }}>
                            {(() => {
                              const roundMatches = (selectedRound && selectedRound !== 'all')
                                ? matches.filter(matchInSelectedRound)
                                : matches;
                              const listToRender = roundMatches.length > 0 ? roundMatches : matches;

                              const matchCount = listToRender.length;
                              let resultRowPadding = 8;
                              let resultFontSize = 18.5;
                              let resultLogoSize = 34;
                              let resultScoreFontSize = 21;

                              if (matchCount > 6) {
                                resultRowPadding = 5.5;
                                resultFontSize = 16.5;
                                resultLogoSize = 28;
                                resultScoreFontSize = 18.5;
                              } else if (matchCount <= 4) {
                                resultRowPadding = 11;
                                resultFontSize = 20.5;
                                resultLogoSize = 38;
                                resultScoreFontSize = 23;
                              }

                              const getDynamicResultTeamFontSize = (name: string, baseSize: number) => {
                                const len = String(name || '').trim().length;
                                if (len > 15) return Math.round(baseSize * 0.62 * 10) / 10;
                                if (len > 12) return Math.round(baseSize * 0.74 * 10) / 10;
                                if (len > 9) return Math.round(baseSize * 0.84 * 10) / 10;
                                if (len > 7) return Math.round(baseSize * 0.92 * 10) / 10;
                                return baseSize;
                              };

                              return listToRender.length === 0 ? (
                                <Text style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', fontSize: 13.5, fontWeight: '600', paddingVertical: 16, textTransform: 'uppercase' }}>{"NATIJALAR KIRITILMAGAN"}</Text>
                              ) : (
                                listToRender.slice(0, 8).map((m: any, idx: number) => {
                                  const homeName = m.home_team || 'Jamoa 1';
                                  const awayName = m.away_team || 'Jamoa 2';
                                  const homeFontSize = getDynamicResultTeamFontSize(homeName, resultFontSize);
                                  const awayFontSize = getDynamicResultTeamFontSize(awayName, resultFontSize);

                                  return (
                                    <View key={m.id || idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: resultRowPadding, paddingHorizontal: 6, borderBottomWidth: idx < Math.min(8, listToRender.length) - 1 ? 1 : 0, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}>
                                      {/* Home Team */}
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                                        {m.home_team_logo ? (
                                          <Image source={{ uri: m.home_team_logo }} style={{ width: resultLogoSize, height: resultLogoSize, borderRadius: resultLogoSize / 2, resizeMode: 'cover' }} />
                                        ) : (
                                          <View style={{ width: resultLogoSize, height: resultLogoSize, borderRadius: resultLogoSize / 2, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                            <Text style={{ color: '#fff', fontSize: resultLogoSize * 0.45, fontWeight: '900' }}>{(homeName || '?')[0]}</Text>
                                          </View>
                                        )}
                                        <Text
                                          style={{
                                            color: '#ffffff',
                                            fontSize: homeFontSize,
                                            fontWeight: '800',
                                            textTransform: 'uppercase',
                                            flexShrink: 1,
                                            lineHeight: Math.round(homeFontSize * 1.15),
                                          }}
                                          numberOfLines={1}
                                          adjustsFontSizeToFit={true}
                                          minimumFontScale={0.65}
                                        >
                                          {homeName}
                                        </Text>
                                      </View>

                                      {/* Score */}
                                      <Text style={{ color: '#ffffff', fontSize: resultScoreFontSize, fontWeight: '900', paddingHorizontal: 6 }}>
                                        {m.home_score !== undefined && m.home_score !== null ? `${m.home_score}-${m.away_score}` : 'VS'}
                                      </Text>

                                      {/* Away Team */}
                                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flex: 1 }}>
                                        {m.away_team_logo ? (
                                          <Image source={{ uri: m.away_team_logo }} style={{ width: resultLogoSize, height: resultLogoSize, borderRadius: resultLogoSize / 2, resizeMode: 'cover' }} />
                                        ) : (
                                          <View style={{ width: resultLogoSize, height: resultLogoSize, borderRadius: resultLogoSize / 2, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                            <Text style={{ color: '#fff', fontSize: resultLogoSize * 0.45, fontWeight: '900' }}>{(awayName || '?')[0]}</Text>
                                          </View>
                                        )}
                                        <Text
                                          style={{
                                            color: '#ffffff',
                                            fontSize: awayFontSize,
                                            fontWeight: '800',
                                            textTransform: 'uppercase',
                                            flexShrink: 1,
                                            textAlign: 'right',
                                            lineHeight: Math.round(awayFontSize * 1.15),
                                          }}
                                          numberOfLines={1}
                                          adjustsFontSizeToFit={true}
                                          minimumFontScale={0.65}
                                        >
                                          {awayName}
                                        </Text>
                                      </View>
                                    </View>
                                  );
                                })
                              );
                            })()}
                          </View>
                        </View>

                        {/* Card 2: TO'PURARLAR */}
                        <View style={{ backgroundColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)', overflow: 'hidden' }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(255, 255, 255, 0.14)', borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.25)' }}>
                            <Text style={{ fontSize: 16, fontWeight: '900', color: '#ffffff', textTransform: 'uppercase' }}>{"TO'PURARLAR"}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ width: 30, textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#ffffff' }}>{"O'"}</Text>
                              <Text style={{ width: 30, textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#ffffff' }}>{"G"}</Text>
                            </View>
                          </View>
                          <View style={{ justifyContent: 'flex-start' }}>
                            {scorers.length === 0 ? (
                              <Text style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', fontSize: 13.5, fontWeight: '600', paddingVertical: 12, textTransform: 'uppercase' }}>{"TO'PURARLAR MAVJUD EMAS"}</Text>
                            ) : (
                              scorers.slice(0, 3).map((p: any, idx: number) => (
                                <View key={p.id || idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: idx < 2 ? 1 : 0, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}>
                                  {p.avatar ? (
                                    <Image source={{ uri: p.avatar }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, resizeMode: 'cover' }} />
                                  ) : (
                                    <View style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>{(p.name || '?')[0]}</Text>
                                    </View>
                                  )}
                                  <Text style={{ flex: 1, color: '#ffffff', fontSize: 15.5, fontWeight: '800', textTransform: 'uppercase' }} numberOfLines={1}>{p.name}</Text>
                                  <Text style={{ width: 30, textAlign: 'center', color: '#ffffff', fontSize: 16, fontWeight: '800' }}>{p.played || 1}</Text>
                                  <Text style={{ width: 30, textAlign: 'center', color: '#ffffff', fontSize: 17.5, fontWeight: '900' }}>{p.goals}</Text>
                                </View>
                              ))
                            )}
                          </View>
                        </View>

                        {/* Card 3: ASSISTENTLAR */}
                        <View style={{ backgroundColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)', overflow: 'hidden' }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(255, 255, 255, 0.14)', borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.25)' }}>
                            <Text style={{ fontSize: 16, fontWeight: '900', color: '#ffffff', textTransform: 'uppercase' }}>{"ASSISTENTLAR"}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ width: 30, textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#ffffff' }}>{"O'"}</Text>
                              <Text style={{ width: 30, textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#ffffff' }}>{"A"}</Text>
                            </View>
                          </View>
                          <View style={{ justifyContent: 'flex-start' }}>
                            {assists.length === 0 ? (
                              <Text style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', fontSize: 13.5, fontWeight: '600', paddingVertical: 12, textTransform: 'uppercase' }}>{"ASSISTENTLAR MAVJUD EMAS"}</Text>
                            ) : (
                              assists.slice(0, 3).map((p: any, idx: number) => (
                                <View key={p.id || idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: idx < 2 ? 1 : 0, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}>
                                  {p.avatar ? (
                                    <Image source={{ uri: p.avatar }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, resizeMode: 'cover' }} />
                                  ) : (
                                    <View style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>{(p.name || '?')[0]}</Text>
                                    </View>
                                  )}
                                  <Text style={{ flex: 1, color: '#ffffff', fontSize: 15.5, fontWeight: '800', textTransform: 'uppercase' }} numberOfLines={1}>{p.name}</Text>
                                  <Text style={{ width: 30, textAlign: 'center', color: '#ffffff', fontSize: 16, fontWeight: '800' }}>{p.played || 1}</Text>
                                  <Text style={{ width: 30, textAlign: 'center', color: '#ffffff', fontSize: 17.5, fontWeight: '900' }}>{p.assists}</Text>
                                </View>
                              ))
                            )}
                          </View>
                        </View>

                      </View>
                    </View>
                  </View>

                  {/* Footer Sponsors Row (Only Secondary Sponsors; Hidden if empty) */}
                  {secondarySponsors.length > 0 ? (
                    <View style={{ width: 1080, height: 75, paddingBottom: 25, paddingTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
                        {secondarySponsors.slice(0, 6).map((s: any, idx: number) => {
                          const isLast = idx === Math.min(secondarySponsors.length, 6) - 1;
                          const logoUri = typeof s === 'string' ? s : (s?.logo_url || '');
                          if (!logoUri) return null;
                          return (
                            <React.Fragment key={s.id || idx}>
                              <Image source={{ uri: logoUri }} style={{ height: 40, maxWidth: 140, width: 110, resizeMode: 'contain', opacity: 0.9 }} />
                              {!isLast && (
                                <View style={{ height: 22, width: 1.5, backgroundColor: '#ffffff', opacity: 0.4 }} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </View>
                    </View>
                  ) : (
                    <View style={{ height: 45, width: 1080 }} />
                  )}

                </View>
              </ImageBackground>
            )}
          </ScaledCanvasPreview>
          </View>

          {/* 2. O'YIN JADVALI (1080x1080 MATCH FIXTURES GRAPHIC) */}
          {(() => {
            const currentScheduleRound = (() => {
              if (selectedRound && selectedRound !== 'all') return selectedRound;
              const scheduledList = matches.filter((m: any) =>
                m.status === 'scheduled' ||
                m.status === 'first_half' ||
                m.status === 'second_half' ||
                m.status === 'half_time' ||
                (m.home_score === null && m.away_score === null && m.status !== 'finished')
              );
              if (scheduledList.length > 0) {
                const rounds = scheduledList.map((m: any) => Number(m.round || 1)).filter(r => !isNaN(r));
                return rounds.length > 0 ? String(Math.min(...rounds)) : '1';
              }
              const rounds = matches.map((m: any) => Number(m.round || 1)).filter(r => !isNaN(r));
              return rounds.length > 0 ? String(Math.max(...rounds)) : '1';
            })();
            const currentScheduleRoundLabel = KNOCKOUT_STAGES.includes(currentScheduleRound)
              ? getStageDisplayTitle(currentScheduleRound, null)
              : `${currentScheduleRound}-TUR`;

            const safeDayIdx = Math.min(selectedScheduleDayIdx, Math.max(0, scheduleDayGroups.length - 1));
            const activeDayGroup = scheduleDayGroups[safeDayIdx] || null;
            const safePartIdx = activeDayGroup ? Math.min(selectedSchedulePartIdx, Math.max(0, activeDayGroup.chunks.length - 1)) : 0;
            const activeChunkMatches = activeDayGroup ? (activeDayGroup.chunks[safePartIdx] || []) : [];

            return (
              <View style={[styles.exportSectionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
                <View style={styles.sectionHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{`2. O'yin Jadvali (${currentScheduleRoundLabel})`}</Text>
                    <Text style={[styles.sectionSubtitle, Platform.OS === 'android' && { color: colors.textMuted }]}>
                      {activeDayGroup 
                        ? `1:1 Format (${activeDayGroup.dayNumber}-kun: ${activeDayGroup.formattedDate}${activeDayGroup.chunks.length > 1 ? ` • ${safePartIdx + 1}-qism` : ''})`
                        : "1:1 Formatdagi Match Fixtures PNG (1080x1080)"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.downloadBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                    onPress={() => handleExportPNG(scheduleRef, 'Oyin_Jadvali')}
                    disabled={downloadingSection === 'Oyin_Jadvali'}
                  >
                    {downloadingSection === 'Oyin_Jadvali' ? (
                      <ActivityIndicator size="small" color={Platform.OS === 'android' ? colors.textPrimary : "#000000"} />
                    ) : (
                      <>
                        <Ionicons name="download" size={16} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
                        <Text style={[styles.downloadBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Joriy Rasmni Yuklash"}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Kunlar bo'yicha yuklab olish tugmalari (40 ta jamoa / 20 ta o'yin sig'ishi uchun kunlarga bo'lingan) */}
                {scheduleDayGroups.length > 0 && (
                  <View style={{ marginVertical: 14, gap: 10 }}>
                    <Text style={[styles.sectionSubtitle, Platform.OS === 'android' && { color: colors.textMuted }, { fontWeight: '700', textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.8 }]}>
                      {"📅 Kunlar bo'yicha yuklab olish (Galereyaga saqlash):"}
                    </Text>
                    
                    {scheduleDayGroups.map((dayGroup: any, idx: number) => {
                      const isSelected = safeDayIdx === idx;
                      const isBusy = exportingDayNumber === dayGroup.dayNumber;

                      return (
                        <View
                          key={dayGroup.date}
                          style={{
                            backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : (Platform.OS === 'android' ? colors.bgCardElevated : 'rgba(255, 255, 255, 0.05)'),
                            borderRadius: 14,
                            borderWidth: 1.5,
                            borderColor: isSelected ? '#38BDF8' : 'rgba(255, 255, 255, 0.15)',
                            padding: 12,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          <TouchableOpacity
                            style={{ flex: 1 }}
                            onPress={() => {
                              setSelectedScheduleDayIdx(idx);
                              setSelectedSchedulePartIdx(0);
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={{ color: isSelected ? '#38BDF8' : '#ffffff', fontSize: 15, fontWeight: '900' }}>
                                {`📅 ${dayGroup.dayNumber}-kun (${dayGroup.formattedDate})`}
                              </Text>
                              {isSelected && (
                                <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.25)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                                  <Text style={{ color: '#38BDF8', fontSize: 10, fontWeight: '800' }}>{"TANLANGAN"}</Text>
                                </View>
                              )}
                            </View>
                            <Text style={{ color: 'rgba(255, 255, 255, 0.65)', fontSize: 12, marginTop: 3 }}>
                              {`${dayGroup.matches.length} ta o'yin ${dayGroup.chunks.length > 1 ? `• ${dayGroup.chunks.length} ta rasm (8 tadan)` : '• 1 ta rasm'}`}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={{
                              backgroundColor: isBusy ? 'rgba(0, 255, 102, 0.5)' : '#00FF66',
                              paddingVertical: 9,
                              paddingHorizontal: 14,
                              borderRadius: 10,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 6,
                            }}
                            onPress={() => handleExportDaySchedule(dayGroup)}
                            disabled={isBusy || exportingDayNumber !== null}
                            activeOpacity={0.8}
                          >
                            {isBusy ? (
                              <ActivityIndicator size="small" color="#000" />
                            ) : (
                              <Ionicons name="download" size={16} color="#000" />
                            )}
                            <Text style={{ color: '#000', fontWeight: '900', fontSize: 13 }}>
                              {isBusy ? "Saqlanmoqda..." : (dayGroup.chunks.length > 1 ? `${dayGroup.chunks.length} ta rasm yuklash` : "Yuklab olish")}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}

                    {/* Agar tanlangan kunda 8 tadan ko'p o'yin bo'lsa (2 ta qism), qismlar orasida o'tish tugmalari */}
                    {activeDayGroup && activeDayGroup.chunks.length > 1 && (
                      <View style={{ marginTop: 6 }}>
                        <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
                          {`Ko'rish uchun qismni tanlang (${activeDayGroup.dayNumber}-kun):`}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {activeDayGroup.chunks.map((chunk: any[], cIdx: number) => {
                            const isPartActive = safePartIdx === cIdx;
                            return (
                              <TouchableOpacity
                                key={cIdx}
                                style={{
                                  flex: 1,
                                  paddingVertical: 8,
                                  paddingHorizontal: 12,
                                  borderRadius: 10,
                                  backgroundColor: isPartActive ? '#38BDF8' : 'rgba(255, 255, 255, 0.08)',
                                  borderWidth: 1,
                                  borderColor: isPartActive ? '#38BDF8' : 'rgba(255, 255, 255, 0.15)',
                                  alignItems: 'center',
                                }}
                                onPress={() => setSelectedSchedulePartIdx(cIdx)}
                                activeOpacity={0.7}
                              >
                                <Text style={{ color: isPartActive ? '#050c1f' : '#ffffff', fontWeight: '900', fontSize: 13 }}>
                                  {`${cIdx + 1}-Qism (${chunk.length} ta o'yin)`}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    )}
                  </View>
                )}

            <ScaledCanvasPreview refObj={scheduleRef} width={1080} height={1080}>
              <ImageBackground
                source={exportBgUrl ? { uri: exportBgUrl } : undefined}
                style={{ width: 1080, height: 1080, backgroundColor: '#062354' }}
                resizeMode="cover"
              >
                <View style={{ flex: 1, backgroundColor: 'rgba(10, 13, 18, 0.82)', width: 1080, height: 1080, justifyContent: 'space-between' }}>
                  
                  {/* Export Header */}
                  <View style={{ height: 180, paddingTop: 65, paddingHorizontal: 45, paddingBottom: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 1080 }}>
                    <View style={{ width: 280, minWidth: 280, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'flex-start' }}>
                      {isCollab && collabInfo ? (
                        <>
                          <Image source={{ uri: collabInfo.sender_org?.logo_url || orgData?.logo_url }} style={{ height: 105, width: 105, resizeMode: 'contain' }} />
                          <Image source={require('../../x.png')} style={{ height: 20, width: 20, opacity: 0.7, tintColor: '#fff', resizeMode: 'contain' }} />
                          <Image source={{ uri: collabInfo.receiver_org?.logo_url }} style={{ height: 95, width: 95, resizeMode: 'contain' }} />
                        </>
                      ) : (
                        orgData?.logo_url ? (
                          <Image source={{ uri: orgData.logo_url }} style={{ height: 115, width: 240, resizeMode: 'contain' }} />
                        ) : (
                          <Text style={{ color: '#00FF66', fontSize: 32, fontWeight: '900', letterSpacing: 1.5 }}>{"AMATORA"}</Text>
                        )
                      )}
                    </View>
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      {selectedLeague?.logo_url ? (
                        <Image source={{ uri: selectedLeague.logo_url }} style={{ maxHeight: 110, maxWidth: 460, width: 380, height: 110, resizeMode: 'contain' }} />
                      ) : (
                        <Text style={{ color: '#ffffff', fontSize: 38, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' }}>
                          {selectedLeague?.name || 'AMATORA LEAGUE'}
                        </Text>
                      )}
                      {activeDayGroup && (
                        <View style={{ marginTop: 6, backgroundColor: 'rgba(56, 189, 248, 0.2)', borderWidth: 1, borderColor: '#38BDF8', paddingVertical: 4, paddingHorizontal: 14, borderRadius: 12 }}>
                          <Text style={{ color: '#38BDF8', fontSize: 16, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 }}>
                            {`${activeDayGroup.dayNumber}-KUN (${activeDayGroup.formattedDate})${activeDayGroup.chunks.length > 1 ? ` • ${safePartIdx + 1}-QISM` : ''}`}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={{ width: 280, minWidth: 280, alignItems: 'flex-end', justifyContent: 'center' }}>
                      {mainSponsorLogo ? (
                        <Image source={{ uri: mainSponsorLogo }} style={{ maxHeight: 115, maxWidth: 290, width: 260, height: 115, resizeMode: 'contain' }} />
                      ) : (
                        <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 20, fontWeight: '900' }}>{"OFFICIAL"}</Text>
                      )}
                    </View>
                  </View>

                  {/* Matches List (Max 8 matches per 1x1 image chunk for crystal clear readability) */}
                  <View style={{ flex: 1, paddingHorizontal: 45, justifyContent: 'center' }}>
                    {(() => {
                      const matchesToRender = activeChunkMatches.length > 0
                        ? activeChunkMatches
                        : matches.slice(0, 8);

                      const currentRoundMatches = matchesToRender.filter((m: any) => !m.is_postponed);
                      const postponedMatches = matchesToRender.filter((m: any) => m.is_postponed);
                      const totalCount = currentRoundMatches.length + postponedMatches.length;

                      let rowPaddingVertical = 8.5;
                      let rowPaddingHorizontal = 18;
                      let teamFontSize = 28;
                      let teamLogoSize = 62;
                      let timeBoxFontSize = 38;
                      let timeDateFontSize = 13;
                      let matchGap = 12;

                      if (totalCount > 6) {
                        rowPaddingVertical = 6.5;
                        rowPaddingHorizontal = 14;
                        teamFontSize = 26;
                        teamLogoSize = 56;
                        timeBoxFontSize = 34;
                        timeDateFontSize = 12;
                        matchGap = 10;
                      }

                      const renderMatchRow = (m: any, isPostponedRow = false) => {
                        const isMatchFinished = m.status === 'finished' || (m.home_score !== undefined && m.home_score !== null && (m.home_score > 0 || m.away_score > 0 || m.status === 'finished'));
                        const formattedDate = m.match_date ? m.match_date.split('-').reverse().join('.') : (m.date ? m.date.split('-').reverse().join('.') : '');
                        const formattedTime = (m.match_time || m.time || '18:00').substring(0, 5);

                        const centerValue = !isMatchFinished
                          ? formattedTime
                          : `${m.home_score || 0} - ${m.away_score || 0}`;

                        return (
                          <View
                            key={m.id}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: isPostponedRow ? 'rgba(255, 59, 48, 0.2)' : 'rgba(255, 255, 255, 0.15)',
                              borderRadius: 40,
                              borderWidth: 1,
                              borderColor: isPostponedRow ? 'rgba(255, 59, 48, 0.65)' : 'rgba(255, 255, 255, 0.3)',
                              paddingVertical: rowPaddingVertical,
                              paddingHorizontal: rowPaddingHorizontal,
                              width: '85%',
                              alignSelf: 'center',
                            }}
                          >
                            {/* Home Team Logo */}
                            {m.home_team_logo ? (
                              <Image source={{ uri: m.home_team_logo }} style={{ width: teamLogoSize, height: teamLogoSize, borderRadius: teamLogoSize / 2, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.8)', backgroundColor: '#fff', resizeMode: 'cover' }} />
                            ) : (
                              <View style={{ width: teamLogoSize, height: teamLogoSize, borderRadius: teamLogoSize / 2, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.8)', backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: '#fff', fontSize: teamLogoSize * 0.45, fontWeight: '900' }}>{(m.home_team || '?')[0]}</Text>
                              </View>
                            )}

                            {/* Home Team Name */}
                            <Text style={{ flex: 1, color: '#ffffff', fontSize: teamFontSize, lineHeight: teamFontSize * 0.95, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 6 }} numberOfLines={2}>
                              {m.home_team}
                            </Text>

                            {/* Center Time & Date Box */}
                            <View style={{ width: 200, alignItems: 'center', justifyContent: 'center' }}>
                              {formattedDate ? (
                                <Text style={{ fontSize: timeDateFontSize, fontWeight: '700', color: '#ffffff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
                                  {formattedDate}
                                </Text>
                              ) : null}
                              <Text style={{ fontSize: timeBoxFontSize, fontWeight: '900', color: '#ffffff', textAlign: 'center', lineHeight: timeBoxFontSize * 1.05 }}>
                                {centerValue}
                              </Text>
                            </View>

                            {/* Away Team Name */}
                            <Text style={{ flex: 1, color: '#ffffff', fontSize: teamFontSize, lineHeight: teamFontSize * 0.95, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 6 }} numberOfLines={2}>
                              {m.away_team}
                            </Text>

                            {/* Away Team Logo */}
                            {m.away_team_logo ? (
                              <Image source={{ uri: m.away_team_logo }} style={{ width: teamLogoSize, height: teamLogoSize, borderRadius: teamLogoSize / 2, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.8)', backgroundColor: '#fff', resizeMode: 'cover' }} />
                            ) : (
                              <View style={{ width: teamLogoSize, height: teamLogoSize, borderRadius: teamLogoSize / 2, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.8)', backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: '#fff', fontSize: teamLogoSize * 0.45, fontWeight: '900' }}>{(m.away_team || '?')[0]}</Text>
                              </View>
                            )}
                            
                            {/* Small Round Badge in Right Corner */}
                            <View style={{ position: 'absolute', right: 18, top: 4, opacity: 0.45 }}>
                              <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
                                {m.stage && m.stage !== 'group' ? getStageDisplayTitle(m.stage, m.round) : (m.round ? `${m.round}-TUR` : currentScheduleRoundLabel)}
                              </Text>
                            </View>
                          </View>
                        );
                      };

                      return matchesToRender.length === 0 ? (
                        <Text style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', fontSize: 22, fontWeight: '700' }}>{"O'YINLAR MAVJUD EMAS"}</Text>
                      ) : (
                        <View style={{ gap: matchGap }}>
                          {currentRoundMatches.map((m: any, idx: number) => renderMatchRow(m, false))}

                          {postponedMatches.length > 0 && (
                            <View style={{ marginTop: 10, gap: matchGap, width: '100%', alignItems: 'center' }}>
                              <View style={{ backgroundColor: 'rgba(255, 59, 48, 0.35)', borderWidth: 1, borderColor: 'rgba(255, 59, 48, 0.75)', paddingVertical: 4, paddingHorizontal: 16, borderRadius: 10 }}>
                                <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 }}>
                                  {postponedMatches.length > 1 ? "QOLDIRILGAN O'YINLAR" : "QOLDIRILGAN O'YIN"}
                                </Text>
                              </View>
                              {postponedMatches.map((m: any, idx: number) => renderMatchRow(m, true))}
                            </View>
                          )}
                        </View>
                      );
                    })()}
                  </View>

                  {/* Footer Sponsors */}
                  {secondarySponsors.length > 0 ? (
                    <View style={{ width: 1080, height: 75, paddingBottom: 25, paddingTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
                        {secondarySponsors.slice(0, 6).map((s: any, idx: number) => {
                          const isLast = idx === Math.min(secondarySponsors.length, 6) - 1;
                          const logoUri = typeof s === 'string' ? s : (s?.logo_url || '');
                          if (!logoUri) return null;
                          return (
                            <React.Fragment key={s.id || idx}>
                              <Image source={{ uri: logoUri }} style={{ height: 40, maxWidth: 140, width: 110, resizeMode: 'contain', opacity: 0.9 }} />
                              {!isLast && (
                                <View style={{ height: 22, width: 1.5, backgroundColor: '#ffffff', opacity: 0.4 }} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </View>
                    </View>
                  ) : (
                    <View style={{ height: 45, width: 1080 }} />
                  )}

                </View>
              </ImageBackground>
            </ScaledCanvasPreview>
          </View>
          );
        })()}

          {/* 3. QIZIL VA SARIQ KARTOCHKALAR (1080x1080 CARDS EXPORT MATCHING AMATORA-ORGANIZATION/ADMIN 1-TO-1) */}
          <View style={[styles.exportSectionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                  {selectedRound && selectedRound !== 'all' ? `3. Qizil va Sariq Kartochkalar (${selectedRoundLabel()})` : "3. Qizil va Sariq Kartochkalar (BARCHA)"}
                </Text>
                <Text style={[styles.sectionSubtitle, Platform.OS === 'android' && { color: colors.textMuted }]}>{"1:1 Formatdagi Cards & Penalties PNG (1080x1080)"}</Text>
              </View>
              <TouchableOpacity
                style={[styles.downloadBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                onPress={() => handleExportPNG(cardsRef, 'Kartochkalar_Jadvali')}
                disabled={downloadingSection === 'Kartochkalar_Jadvali'}
              >
                {downloadingSection === 'Kartochkalar_Jadvali' ? (
                  <ActivityIndicator size="small" color={Platform.OS === 'android' ? colors.textPrimary : "#000000"} />
                ) : (
                  <>
                    <Ionicons name="download" size={16} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
                    <Text style={[styles.downloadBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"PNG (1x1)"}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <ScaledCanvasPreview refObj={cardsRef} width={1080} height={1080}>
              <ImageBackground
                source={exportBgUrl ? { uri: exportBgUrl } : undefined}
                style={{ width: 1080, height: 1080, backgroundColor: '#062354' }}
                resizeMode="cover"
              >
                <View style={{ flex: 1, backgroundColor: 'rgba(10, 13, 18, 0.82)', width: 1080, height: 1080, justifyContent: 'space-between' }}>
                  
                  {/* Export Header */}
                  <View style={{ height: 180, paddingTop: 65, paddingHorizontal: 45, paddingBottom: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 1080 }}>
                    <View style={{ width: 280, minWidth: 280, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'flex-start' }}>
                      {isCollab && collabInfo ? (
                        <>
                          <Image source={{ uri: collabInfo.sender_org?.logo_url || orgData?.logo_url }} style={{ height: 105, width: 105, resizeMode: 'contain' }} />
                          <Image source={require('../../x.png')} style={{ height: 20, width: 20, opacity: 0.7, tintColor: '#fff', resizeMode: 'contain' }} />
                          <Image source={{ uri: collabInfo.receiver_org?.logo_url }} style={{ height: 95, width: 95, resizeMode: 'contain' }} />
                        </>
                      ) : (
                        orgData?.logo_url ? (
                          <Image source={{ uri: orgData.logo_url }} style={{ height: 115, width: 240, resizeMode: 'contain' }} />
                        ) : (
                          <Text style={{ color: '#00FF66', fontSize: 32, fontWeight: '900', letterSpacing: 1.5 }}>{"AMATORA"}</Text>
                        )
                      )}
                    </View>
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      {selectedLeague?.logo_url ? (
                        <Image source={{ uri: selectedLeague.logo_url }} style={{ maxHeight: 125, maxWidth: 460, width: 380, height: 125, resizeMode: 'contain' }} />
                      ) : (
                        <Text style={{ color: '#ffffff', fontSize: 42, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' }}>
                          {selectedLeague?.name || 'AMATORA LEAGUE'}
                        </Text>
                      )}
                    </View>
                    <View style={{ width: 280, minWidth: 280, alignItems: 'flex-end', justifyContent: 'center' }}>
                      {mainSponsorLogo ? (
                        <Image source={{ uri: mainSponsorLogo }} style={{ maxHeight: 115, maxWidth: 290, width: 260, height: 115, resizeMode: 'contain' }} />
                      ) : (
                        <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 20, fontWeight: '900' }}>{"OFFICIAL"}</Text>
                      )}
                    </View>
                  </View>

                  {/* Title Banner (Removed as requested - Card headers inside already contain titles) */}

                  {/* Body Grid: Yellow & Red Card Glassmorphism Tables (Vertically Centered) */}
                  <View style={{ flex: 1, justifyContent: 'center', width: 1080 }}>
                    {(() => {
                      const cardMap: any = {};
                      const filteredEvents = rawCardEvents.filter((ev: any) => {
                        if (!selectedRound || selectedRound === 'all') return true;
                        const matchObj = matches.find((m: any) => String(m.id) === String(ev.match_id));
                        return matchInSelectedRound(matchObj);
                      });

                      filteredEvents.forEach((ev: any) => {
                        const pId = ev.player_id || ev.id;
                        const pName = ev.player ? `${ev.player.first_name || ''} ${ev.player.last_name || ''}`.trim() : (ev.player_name || "O'yinchi");
                        const pTeam = ev.team ? ev.team.name : (ev.team_name || 'Jamoa');
                        const pPhoto = ev.player?.photo_url || ev.player_photo || ev.team?.logo_url;

                        if (!cardMap[pId]) cardMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, yellow: 0, red: 0 };
                        if (ev.event_type === 'yellow_card') cardMap[pId].yellow += 1;
                        if (ev.event_type === 'red_card') cardMap[pId].red += 1;
                      });

                      const displayCardPlayers = Object.values(cardMap).sort((a: any, b: any) => (b.yellow + b.red * 2) - (a.yellow + a.red * 2));
                      const yellowList = displayCardPlayers.filter((p: any) => p.yellow > 0);
                      const redList = displayCardPlayers.filter((p: any) => p.red > 0);

                      return (
                        <View style={{ flexDirection: 'row', paddingHorizontal: 45, gap: 20, width: 1080 }}>
                          
                          {/* Yellow Cards Table */}
                          <View style={{ flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.12)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.25)', overflow: 'hidden' }}>
                            <View style={{ backgroundColor: 'rgba(234, 179, 8, 0.25)', borderBottomWidth: 1, borderBottomColor: 'rgba(234, 179, 8, 0.4)', paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={{ color: '#FEF08A', fontSize: 17, fontWeight: '900' }}>{"🟨 SARIQ KARTOCHKALAR"}</Text>
                              <Text style={{ color: '#FEF08A', fontSize: 16, fontWeight: '900' }}>{"SONI"}</Text>
                            </View>
                            <View style={{ justifyContent: 'flex-start' }}>
                              {yellowList.length === 0 ? (
                                <Text style={{ padding: 30, textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>{"SARIQ KARTOCHKA OLGANLAR MAVJUD EMAS"}</Text>
                              ) : (
                                yellowList.slice(0, 7).map((p: any, idx: number) => (
                                  <View key={p.id || idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}>
                                    {p.avatar ? (
                                      <Image source={{ uri: p.avatar }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, resizeMode: 'cover' }} />
                                    ) : (
                                      <View style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>{(p.name || '?')[0]}</Text>
                                      </View>
                                    )}
                                    <Text style={{ flex: 1, color: '#ffffff', fontSize: 15.5, fontWeight: '800', textTransform: 'uppercase' }} numberOfLines={1}>{p.name}</Text>
                                    <View style={{ backgroundColor: 'rgba(234, 179, 8, 0.3)', borderWidth: 1, borderColor: 'rgba(234, 179, 8, 0.5)', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 12 }}>
                                      <Text style={{ color: '#FEF08A', fontSize: 16, fontWeight: '900' }}>{`${p.yellow} ta`}</Text>
                                    </View>
                                  </View>
                                ))
                              )}
                            </View>
                          </View>

                          {/* Red Cards Table */}
                          <View style={{ flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.12)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.25)', overflow: 'hidden' }}>
                            <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.25)', borderBottomWidth: 1, borderBottomColor: 'rgba(239, 68, 68, 0.4)', paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={{ color: '#FCA5A5', fontSize: 17, fontWeight: '900' }}>{"🟥 QIZIL KARTOCHKALAR"}</Text>
                              <Text style={{ color: '#FCA5A5', fontSize: 16, fontWeight: '900' }}>{"SONI"}</Text>
                            </View>
                            <View style={{ justifyContent: 'flex-start' }}>
                              {redList.length === 0 ? (
                                <Text style={{ padding: 30, textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>{"QIZIL KARTOCHKA OLGANLAR MAVJUD EMAS"}</Text>
                              ) : (
                                redList.slice(0, 7).map((p: any, idx: number) => (
                                  <View key={p.id || idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}>
                                    {p.avatar ? (
                                      <Image source={{ uri: p.avatar }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, resizeMode: 'cover' }} />
                                    ) : (
                                      <View style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>{(p.name || '?')[0]}</Text>
                                      </View>
                                    )}
                                    <Text style={{ flex: 1, color: '#ffffff', fontSize: 15.5, fontWeight: '800', textTransform: 'uppercase' }} numberOfLines={1}>{p.name}</Text>
                                    <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.3)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.5)', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 12 }}>
                                      <Text style={{ color: '#FCA5A5', fontSize: 16, fontWeight: '900' }}>{`${p.red} ta`}</Text>
                                    </View>
                                  </View>
                                ))
                              )}
                            </View>
                          </View>

                        </View>
                      );
                    })()}
                  </View>

                  {/* Footer Sponsors */}
                  {secondarySponsors.length > 0 ? (
                    <View style={{ width: 1080, height: 75, paddingBottom: 25, paddingTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
                        {secondarySponsors.slice(0, 6).map((s: any, idx: number) => {
                          const isLast = idx === Math.min(secondarySponsors.length, 6) - 1;
                          const logoUri = typeof s === 'string' ? s : (s?.logo_url || '');
                          if (!logoUri) return null;
                          return (
                            <React.Fragment key={s.id || idx}>
                              <Image source={{ uri: logoUri }} style={{ height: 40, maxWidth: 140, width: 110, resizeMode: 'contain', opacity: 0.9 }} />
                              {!isLast && (
                                <View style={{ height: 22, width: 1.5, backgroundColor: '#ffffff', opacity: 0.4 }} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </View>
                    </View>
                  ) : (
                    <View style={{ height: 45, width: 1080 }} />
                  )}

                </View>
              </ImageBackground>
            </ScaledCanvasPreview>
          </View>

          {/* 4. TO'PURARLAR JADVALI (1080x1080 TOP SCORERS STANDALONE GRAPHIC) */}
          <View style={[styles.exportSectionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                  {selectedRound && selectedRound !== 'all' ? `4. To'purarlar Jadvali (${selectedRoundLabel()})` : "4. To'purarlar Jadvali (BARCHA)"}
                </Text>
                <Text style={[styles.sectionSubtitle, Platform.OS === 'android' && { color: colors.textMuted }]}>{"1:1 Formatdagi Top Scorers PNG (1080x1080)"}</Text>
              </View>
              <TouchableOpacity
                style={[styles.downloadBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                onPress={() => handleExportPNG(scorersRef, 'Topurarlar_Jadvali')}
                disabled={downloadingSection === 'Topurarlar_Jadvali'}
              >
                {downloadingSection === 'Topurarlar_Jadvali' ? (
                  <ActivityIndicator size="small" color={Platform.OS === 'android' ? colors.textPrimary : "#000000"} />
                ) : (
                  <>
                    <Ionicons name="download" size={16} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
                    <Text style={[styles.downloadBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"PNG (1x1)"}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <ScaledCanvasPreview refObj={scorersRef} width={1080} height={1080}>
              <ImageBackground
                source={exportBgUrl ? { uri: exportBgUrl } : undefined}
                style={{ width: 1080, height: 1080, backgroundColor: '#062354' }}
                resizeMode="cover"
              >
                <View style={{ flex: 1, backgroundColor: 'rgba(10, 13, 18, 0.82)', width: 1080, height: 1080, justifyContent: 'space-between' }}>
                  
                  {/* Export Header */}
                  <View style={{ height: 180, paddingTop: 65, paddingHorizontal: 45, paddingBottom: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 1080 }}>
                    <View style={{ width: 280, minWidth: 280, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'flex-start' }}>
                      {isCollab && collabInfo ? (
                        <>
                          <Image source={{ uri: collabInfo.sender_org?.logo_url || orgData?.logo_url }} style={{ height: 105, width: 105, resizeMode: 'contain' }} />
                          <Image source={require('../../x.png')} style={{ height: 20, width: 20, opacity: 0.7, tintColor: '#fff', resizeMode: 'contain' }} />
                          <Image source={{ uri: collabInfo.receiver_org?.logo_url }} style={{ height: 95, width: 95, resizeMode: 'contain' }} />
                        </>
                      ) : (
                        orgData?.logo_url ? (
                          <Image source={{ uri: orgData.logo_url }} style={{ height: 115, width: 240, resizeMode: 'contain' }} />
                        ) : (
                          <Text style={{ color: '#00FF66', fontSize: 32, fontWeight: '900', letterSpacing: 1.5 }}>{"AMATORA"}</Text>
                        )
                      )}
                    </View>
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      {selectedLeague?.logo_url ? (
                        <Image source={{ uri: selectedLeague.logo_url }} style={{ maxHeight: 125, maxWidth: 460, width: 380, height: 125, resizeMode: 'contain' }} />
                      ) : (
                        <Text style={{ color: '#ffffff', fontSize: 42, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' }}>
                          {selectedLeague?.name || 'AMATORA LEAGUE'}
                        </Text>
                      )}
                    </View>
                    <View style={{ width: 280, minWidth: 280, alignItems: 'flex-end', justifyContent: 'center' }}>
                      {mainSponsorLogo ? (
                        <Image source={{ uri: mainSponsorLogo }} style={{ maxHeight: 115, maxWidth: 290, width: 260, height: 115, resizeMode: 'contain' }} />
                      ) : (
                        <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 20, fontWeight: '900' }}>{"OFFICIAL"}</Text>
                      )}
                    </View>
                  </View>

                  {/* Scorers Unified Glassmorphism Table (Vertically Centered - 10 Rows) */}
                  <View style={{ flex: 1, paddingHorizontal: 45, marginVertical: 10, justifyContent: 'center' }}>
                    {(() => {
                      const goalMap: any = {};
                      const filteredEvents = rawGoalEvents.filter((ev: any) => {
                        if (!selectedRound || selectedRound === 'all') return true;
                        const matchObj = matches.find((m: any) => String(m.id) === String(ev.match_id));
                        return matchInSelectedRound(matchObj);
                      });

                      filteredEvents.forEach((ev: any) => {
                        const pId = ev.player_id || ev.id;
                        const pName = ev.player ? `${ev.player.first_name || ''} ${ev.player.last_name || ''}`.trim() : (ev.player_name || "O'yinchi");
                        const pTeam = ev.team ? ev.team.name : (ev.team_name || 'Jamoa');
                        const pPhoto = ev.player?.photo_url || ev.player_photo || ev.team?.logo_url;

                        if (!goalMap[pId]) goalMap[pId] = { id: pId, name: pName, team: pTeam, avatar: pPhoto, goals: 0 };
                        goalMap[pId].goals += 1;
                      });

                      const displayScorers = Object.values(goalMap).sort((a: any, b: any) => b.goals - a.goals);
                      const roundLabel = selectedRound && selectedRound !== 'all' ? selectedRoundLabel() : 'BARCHA TURLAR';

                      return (
                        <View style={{ width: '86%', alignSelf: 'center', backgroundColor: 'rgba(255, 255, 255, 0.12)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.25)', overflow: 'hidden' }}>
                          {/* Unified Card Header */}
                          <View style={{ backgroundColor: 'rgba(255, 255, 255, 0.16)', borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.25)', paddingVertical: 14, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Ionicons name="football" size={26} color="#FFFFFF" style={{ marginRight: 10 }} />
                              <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 1 }}>{`TO'PURARLAR JADVALI (${roundLabel})`}</Text>
                            </View>
                            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '900' }}>{"GOLLAR"}</Text>
                          </View>

                          {/* Unified Table Body */}
                          <View style={{ justifyContent: 'flex-start' }}>
                            {displayScorers.length === 0 ? (
                              <Text style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 18, fontWeight: '700' }}>{"TO'PURARLAR MAVJUD EMAS"}</Text>
                            ) : (
                              displayScorers.slice(0, 10).map((s: any, idx: number) => {
                                const isLast = idx === Math.min(displayScorers.length, 10) - 1;
                                return (
                                  <View key={s.id || idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 20, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: 'rgba(255, 255, 255, 0.12)' }}>
                                    {idx === 0 ? (
                                      <View style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="medal" size={28} color="#FFD700" />
                                      </View>
                                    ) : idx === 1 ? (
                                      <View style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="medal" size={28} color="#C0C0C0" />
                                      </View>
                                    ) : idx === 2 ? (
                                      <View style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="medal" size={28} color="#CD7F32" />
                                      </View>
                                    ) : (
                                      <Text style={{ width: 40, textAlign: 'center', color: 'rgba(255, 255, 255, 0.8)', fontSize: 22, fontWeight: '900' }}>{idx + 1}</Text>
                                    )}

                                    {s.avatar ? (
                                      <Image source={{ uri: s.avatar }} style={{ width: 48, height: 48, borderRadius: 24, marginRight: 14, resizeMode: 'cover' }} />
                                    ) : (
                                      <View style={{ width: 48, height: 48, borderRadius: 24, marginRight: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900' }}>{(s.name || '?')[0]}</Text>
                                      </View>
                                    )}
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ color: '#ffffff', fontSize: 21, fontWeight: '800', textTransform: 'uppercase' }} numberOfLines={1}>{s.name}</Text>
                                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '600' }}>{s.team}</Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255, 255, 255, 0.16)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)', paddingVertical: 5, paddingHorizontal: 16, borderRadius: 10 }}>
                                      <Ionicons name="football" size={20} color="#FFFFFF" />
                                      <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}>{`${s.goals} ta`}</Text>
                                    </View>
                                  </View>
                                );
                              })
                            )}
                          </View>
                        </View>
                      );
                    })()}
                  </View>

                  {/* Footer Sponsors */}
                  {secondarySponsors.length > 0 ? (
                    <View style={{ width: 1080, height: 75, paddingBottom: 25, paddingTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
                        {secondarySponsors.slice(0, 6).map((s: any, idx: number) => {
                          const isLast = idx === Math.min(secondarySponsors.length, 6) - 1;
                          const logoUri = typeof s === 'string' ? s : (s?.logo_url || '');
                          if (!logoUri) return null;
                          return (
                            <React.Fragment key={s.id || idx}>
                              <Image source={{ uri: logoUri }} style={{ height: 40, maxWidth: 140, width: 110, resizeMode: 'contain', opacity: 0.9 }} />
                              {!isLast && (
                                <View style={{ height: 22, width: 1.5, backgroundColor: '#ffffff', opacity: 0.4 }} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </View>
                    </View>
                  ) : (
                    <View style={{ height: 45, width: 1080 }} />
                  )}

                </View>
              </ImageBackground>
            </ScaledCanvasPreview>
          </View>

          {/* 5. PDF YUKLAB OLISH */}
          <View style={[styles.exportSectionCard, { borderColor: '#10B981', backgroundColor: Platform.OS === 'android' ? (isDark ? 'rgba(16, 185, 129, 0.06)' : '#ECFDF5') : 'rgba(16, 185, 129, 0.06)' }]}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, { color: '#10B981' }]}>{"5. PDF Hujjat Eksporti"}</Text>
                <Text style={[styles.sectionSubtitle, Platform.OS === 'android' && { color: colors.textMuted }]}>
                  {"Jamoalar va o'yinchilarning to'liq ma'lumotlarini PDF formatida yuklab olish"}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.downloadBtn, { backgroundColor: '#10B981', borderColor: '#10B981' }]}
                onPress={() => {
                  setShowPDFModal(true);
                  fetchAllPDFData();
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="document-text" size={16} color="#FFFFFF" />
                <Text style={[styles.downloadBtnText, { color: '#FFFFFF' }]}>{"PDF Yuklab Olish"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}

      {/* PDF EXPORT MODAL */}
      <Modal visible={showPDFModal} transparent animationType="slide">
        <View style={styles.pdfOverlay}>
          <View style={[styles.pdfCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
            {/* Modal Header */}
            <View style={[styles.pdfHeader, Platform.OS === 'android' && { borderBottomColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="document-text" size={22} color="#10B981" />
                <Text style={[styles.pdfTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"PDF Yuklab Olish"}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPDFModal(false)}>
                <Ionicons name="close" size={22} color={Platform.OS === 'android' ? colors.textPrimary : "rgba(255,255,255,0.6)"} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 12 }}>
              {/* Mode Buttons Row */}
              <View style={styles.pdfModeRow}>
                <TouchableOpacity
                  style={[
                    styles.pdfModeBtn,
                    Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                    pdfMode === 'league' && styles.pdfModeBtnActive,
                    Platform.OS === 'android' && pdfMode === 'league' && { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
                  ]}
                  onPress={() => setPdfMode('league')}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.pdfModeText,
                    Platform.OS === 'android' && { color: colors.textMuted },
                    pdfMode === 'league' && styles.pdfModeTextActive,
                    Platform.OS === 'android' && pdfMode === 'league' && { color: '#000000' },
                  ]}>
                    {"Liga bo'yicha"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pdfModeBtn,
                    Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                    pdfMode === 'team' && styles.pdfModeBtnActive,
                    Platform.OS === 'android' && pdfMode === 'team' && { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
                  ]}
                  onPress={() => setPdfMode('team')}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.pdfModeText,
                    Platform.OS === 'android' && { color: colors.textMuted },
                    pdfMode === 'team' && styles.pdfModeTextActive,
                    Platform.OS === 'android' && pdfMode === 'team' && { color: '#000000' },
                  ]}>
                    {"Bitta jamoa"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pdfModeAllBtn,
                    Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                    pdfMode === 'all' && { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
                  ]}
                  onPress={() => setPdfMode('all')}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.pdfModeAllText,
                    Platform.OS === 'android' && { color: colors.textPrimary },
                    Platform.OS === 'android' && pdfMode === 'all' && { color: '#000000' },
                  ]}>{"Barchasini yuklash"}</Text>
                </TouchableOpacity>
              </View>

              {/* Mode: League Select */}
              {pdfMode === 'league' && (
                <View style={[styles.pdfSectionBox, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                  <Text style={[styles.pdfLabel, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Liga tanlang:"}</Text>
                  <ScrollView style={{ maxHeight: 150 }} showsVerticalScrollIndicator={false}>
                    {leagues.map((lg) => (
                      <TouchableOpacity
                        key={lg.id}
                        style={[
                          styles.pdfOptionRow,
                          Platform.OS === 'android' && { borderBottomColor: colors.border },
                          selectedPDFLeagueName === lg.name && styles.pdfOptionRowActive,
                          Platform.OS === 'android' && selectedPDFLeagueName === lg.name && { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5' },
                        ]}
                        onPress={() => setSelectedPDFLeagueName(lg.name)}
                      >
                        <Text style={[
                          styles.pdfOptionText,
                          Platform.OS === 'android' && { color: colors.textSecondary },
                          selectedPDFLeagueName === lg.name && styles.pdfOptionTextActive,
                          Platform.OS === 'android' && selectedPDFLeagueName === lg.name && { color: colors.accentGreen },
                        ]}>
                          {lg.name}
                        </Text>
                        {selectedPDFLeagueName === lg.name && (
                          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <View style={styles.pdfActionRow}>
                    <TouchableOpacity style={[styles.pdfBackBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 }]} onPress={() => setPdfMode(null)}>
                      <Text style={[styles.pdfBackText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ortga"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pdfSubmitBtn, { backgroundColor: '#10B981' }]}
                      onPress={() => handleExecutePDFExport('league')}
                      disabled={isPDFExporting}
                    >
                      {isPDFExporting ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Ionicons name="download" size={16} color="#FFFFFF" />
                          <Text style={styles.pdfSubmitText}>{"Yuklab olish"}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Mode: Team Select */}
              {pdfMode === 'team' && (
                <View style={[styles.pdfSectionBox, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                  <Text style={[styles.pdfLabel, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Jamoa tanlang:"}</Text>
                  <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
                    {(allTeams.length > 0 ? allTeams : teams).length > 0 ? (
                      (allTeams.length > 0 ? allTeams : teams).map((tm) => (
                        <TouchableOpacity
                          key={tm.id}
                          style={[
                            styles.pdfOptionRow,
                            Platform.OS === 'android' && { borderBottomColor: colors.border },
                            selectedPDFTeamId === String(tm.id) && styles.pdfOptionRowActive,
                            Platform.OS === 'android' && selectedPDFTeamId === String(tm.id) && { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5' },
                          ]}
                          onPress={() => setSelectedPDFTeamId(String(tm.id))}
                        >
                          <Text style={[
                            styles.pdfOptionText,
                            Platform.OS === 'android' && { color: colors.textSecondary },
                            selectedPDFTeamId === String(tm.id) && styles.pdfOptionTextActive,
                            Platform.OS === 'android' && selectedPDFTeamId === String(tm.id) && { color: colors.accentGreen },
                          ]}>
                            {tm.name}
                          </Text>
                          {selectedPDFTeamId === String(tm.id) && (
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                          )}
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text style={{ color: Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)', padding: 12, fontSize: 12, textAlign: 'center' }}>
                        {"Jamoalar topilmadi"}
                      </Text>
                    )}
                  </ScrollView>

                  <View style={styles.pdfActionRow}>
                    <TouchableOpacity style={[styles.pdfBackBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 }]} onPress={() => setPdfMode(null)}>
                      <Text style={[styles.pdfBackText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ortga"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pdfSubmitBtn, { backgroundColor: '#10B981' }]}
                      onPress={() => handleExecutePDFExport('team')}
                      disabled={isPDFExporting}
                    >
                      {isPDFExporting ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Ionicons name="download" size={16} color="#FFFFFF" />
                          <Text style={styles.pdfSubmitText}>{"Yuklab olish"}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Mode: All Export */}
              {pdfMode === 'all' && (
                <View style={[styles.pdfSectionBox, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                  <View style={[styles.pdfInfoBox, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.1)' : '#ECFDF5', borderColor: '#10B981' }]}>
                    <Ionicons name="information-circle" size={20} color="#10B981" />
                    <Text style={[styles.pdfInfoText, Platform.OS === 'android' && { color: colors.textSecondary }]}>
                      {"Siz barcha jamoalar va ularning o'yinchilarini PDF ga yuklab olasiz."}
                    </Text>
                  </View>

                  <View style={styles.pdfActionRow}>
                    <TouchableOpacity style={[styles.pdfBackBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 }]} onPress={() => setPdfMode(null)}>
                      <Text style={[styles.pdfBackText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ortga"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pdfSubmitBtn, { backgroundColor: '#10B981' }]}
                      onPress={() => handleExecutePDFExport('all')}
                      disabled={isPDFExporting}
                    >
                      {isPDFExporting ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Ionicons name="download" size={16} color="#FFFFFF" />
                          <Text style={styles.pdfSubmitText}>{"Barchasini yuklash"}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Error Banner */}
              {pdfError && (
                <View style={styles.pdfErrorBox}>
                  <Ionicons name="alert-circle" size={18} color="#EF4444" />
                  <Text style={styles.pdfErrorText}>{pdfError}</Text>
                </View>
              )}

              {/* Info Text Footer */}
              <View style={[styles.pdfFooterDescBox, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 }]}>
                <Text style={[styles.pdfFooterDescText, Platform.OS === 'android' && { color: colors.textMuted }]}>
                  {"📄 PDF fayli o'yinchilarning rasmlari, ismlari, pasport, amplua va jismoniy ma'lumotlari bilan birga yaratiladi."}
                </Text>
              </View>
            </ScrollView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCard: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1.2,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 10,
    elevation: 4,
  },
  exportScopeToggle: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  exportScopeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  exportScopeBtnActiveLeague: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  exportScopeBtnActiveTournament: {
    backgroundColor: 'rgba(236, 72, 153, 0.14)',
    borderColor: 'rgba(236, 72, 153, 0.4)',
  },
  exportScopeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '800',
  },
  dropdownsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dropdownWrapper: {
    flex: 1,
  },
  dropdownLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  filterModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 99999,
  },
  filterModalContent: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '65%',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    padding: 18,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 25,
  },
  filterModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
  },
  filterModalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  filterModalCloseBtn: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterModalItemActive: {
    backgroundColor: 'rgba(0, 255, 102, 0.15)',
    borderColor: 'rgba(0, 255, 102, 0.45)',
  },
  filterModalItemText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  filterModalItemTextActive: {
    color: '#00FF66',
    fontWeight: '800',
  },
  scrollContent: {
    padding: 16,
    gap: 20,
    paddingBottom: 140,
  },
  exportSectionCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    padding: 16,
    gap: 14,
    overflow: 'hidden',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  downloadBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },

  // PDF Export Modal Styles
  pdfOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pdfCard: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    padding: 20,
    overflow: 'hidden',
  },
  pdfHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  pdfTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  pdfModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pdfModeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
  },
  pdfModeBtnActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  pdfModeText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  pdfModeTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  pdfModeAllBtn: {
    flex: 1.2,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
  },
  pdfModeAllText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  pdfSectionBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  pdfLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  pdfOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  pdfOptionRowActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  pdfOptionText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  pdfOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  pdfActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  pdfBackBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  pdfBackText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  pdfSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  pdfSubmitText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  pdfInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  pdfInfoText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  pdfErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    padding: 10,
    borderRadius: 10,
  },
  pdfErrorText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700',
  },
  pdfFooterDescBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    padding: 12,
    borderRadius: 10,
  },
  pdfFooterDescText: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
  },
});
