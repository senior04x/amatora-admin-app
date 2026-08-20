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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';

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

  const scale = containerWidth > 0 ? containerWidth / width : 0.33;
  const shift = containerWidth > 0 ? -(width - containerWidth) / 2 : 0;

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
              { translateX: shift },
              { translateY: shift },
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
          backgroundColor: '#334155',
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
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {[1, 2, 3, 4].map((key) => (
        <View key={key} style={styles.exportSectionCard}>
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

export const ExportScreen: React.FC = () => {
  const { orgId, collabLeagueIds, collabLeagueNames } = useOrg();
  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  const [showLeagueDropdown, setShowLeagueDropdown] = useState(false);
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

  useEffect(() => {
    fetchLeagues();
    fetchAllPDFData();
    fetchOrgData();
  }, [orgId]);

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
    if (selectedLeague) {
      fetchLeagueData(selectedLeague);
    }
  }, [selectedLeague]);

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
        const { data: bgSponsors } = await dbClient
          .from('sponsors')
          .select('name, logo_url')
          .like('name', 'LEAGUE_BG_%');

        const bgMap: any = {};
        if (bgSponsors) {
          bgSponsors.forEach((s: any) => {
            const lId = s.name.replace('LEAGUE_BG_', '');
            bgMap[lId] = s.logo_url;
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

          return {
            ...l,
            bg_image: activeBg,
          };
        });

        setLeagues(merged);
        setSelectedLeague(merged[0]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllPDFData = async () => {
    try {
      const dbClient = supabase;

      let appQuery = dbClient.from('applications').select('*').order('created_at', { ascending: false });
      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map(n => `"${n.replace(/"/g, '""')}"`).join(',');
          appQuery = appQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
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

      // 0. Collab Info
      if (leagueId) {
        try {
          const { data: cData } = await dbClient
            .from('league_collabs')
            .select('*, sender_org:organizations!sender_org_id(id, name, logo_url), receiver_org:organizations!receiver_org_id(id, name, logo_url)')
            .eq('league_id', leagueId)
            .eq('status', 'accepted')
            .limit(1)
            .maybeSingle();

          setCollabInfo(cData || null);
        } catch (e) {
          setCollabInfo(null);
        }
      }

      // Fetch All Sponsors
      try {
        let spQuery = dbClient
          .from('sponsors')
          .select('id, name, logo_url, is_main, organization_id')
          .not('logo_url', 'is', null)
          .order('created_at', { ascending: false });

        if (orgId) {
          spQuery = spQuery.eq('organization_id', orgId);
        }

        const { data: allSp, error: spErr } = await spQuery;

        if (spErr) {
          console.error('Error querying sponsors in ExportScreen:', spErr);
        }

        // Check if sponsors are allowed for this specific league
        let showSponsorsForThisLeague = true;

        if (typeof leagueObj === 'object' && leagueObj?.show_sponsors === false) {
          showSponsorsForThisLeague = false;
        }

        if (allSp && leagueId) {
          const leagueSettingKey = `LEAGUE_SHOW_SPONSORS_${leagueId}`;
          const leagueSettingKeyByName = leagueName ? `LEAGUE_SHOW_SPONSORS_${leagueName}` : '';
          const systemSetting = allSp.find(
            (s: any) => s.name === leagueSettingKey || (leagueSettingKeyByName && s.name === leagueSettingKeyByName)
          );
          if (systemSetting) {
            showSponsorsForThisLeague = systemSetting.logo_url === 'true';
          }
        }

        if (allSp && allSp.length > 0) {
          // Filter real sponsors excluding system keys (case-insensitive)
          const realSponsors = allSp.filter((s: any) => {
            if (!s.name) return false;
            const uName = String(s.name).toUpperCase();
            const uUrl = String(s.logo_url || '').toUpperCase();
            if (
              uName.startsWith('SCHEDULE_BANNER') ||
              uName.startsWith('YT_BANNER') ||
              uName.startsWith('YT_OAUTH') ||
              uName.startsWith('MATCH_TIMER') ||
              uName.startsWith('LEAGUE_SHOW_SPONSORS') ||
              uName.startsWith('REGISTRATION_OPEN') ||
              uName.startsWith('POLL_VOTES') ||
              uUrl.includes('EXPO_PUSH')
            ) {
              return false;
            }
            return true;
          });

          if (showSponsorsForThisLeague && realSponsors.length > 0) {
            const main = realSponsors.find((s: any) => s.is_main === true);
            const secondaries = realSponsors.filter((s: any) => !s.is_main);

            if (main?.logo_url) {
              setMainSponsorLogo(main.logo_url);
            } else if (realSponsors[0]?.logo_url) {
              setMainSponsorLogo(realSponsors[0].logo_url);
            }

            setSecondarySponsors(secondaries.map((s: any) => s.logo_url).filter(Boolean));
          } else {
            setMainSponsorLogo(null);
            setSecondarySponsors([]);
          }
        } else {
          setMainSponsorLogo(null);
          setSecondarySponsors([]);
        }
      } catch (e) {
        console.error('Error fetching sponsors in ExportScreen:', e);
      }

      // 1. Fetch Teams (including Collab)
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

      const { data: allOrgTeams } = await teamQuery;
      const teamsList = allOrgTeams || [];

      const filteredTeams = teamsList.filter((t: any) => {
        if (!leagueName && !leagueId) return true;
        if (leagueId && t.league_id && String(t.league_id) === String(leagueId)) return true;
        if (leagueName && t.league) {
          return String(t.league).toLowerCase().includes(String(leagueName).toLowerCase());
        }
        return false;
      });

      const targetTeams = filteredTeams.length > 0 ? filteredTeams : (
        teamsList.filter((t: any) => leagueId && String(t.league_id) === String(leagueId))
      );

      const teamIds = new Set(targetTeams.map((t: any) => t.id));

      // 2. Fetch Matches (All matches: both finished and scheduled, including Collab)
      let matchQuery = dbClient
        .from('matches')
        .select('*, home_team_data:teams!matches_home_team_id_fkey(name, logo_url), away_team_data:teams!matches_away_team_id_fkey(name, logo_url)')
        .order('match_date', { ascending: true });

      if (orgId) {
        if (collabLeagueNames && collabLeagueNames.length > 0) {
          const escapedNames = collabLeagueNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
          matchQuery = matchQuery.or(`organization_id.eq.${orgId},league.in.(${escapedNames})`);
        } else {
          matchQuery = matchQuery.eq('organization_id', orgId);
        }
      }

      const { data: allMatchesData } = await matchQuery;

      const allLeagueMatches = (allMatchesData || []).filter((m: any) =>
        teamIds.has(m.home_team_id) || teamIds.has(m.away_team_id) || (leagueId && String(m.league_id) === String(leagueId))
      );

      let maxRound = 0;
      allLeagueMatches.forEach((m: any) => {
        if (m.round && parseInt(m.round) > maxRound) {
          maxRound = parseInt(m.round);
        }
      });
      if (maxRound === 0) maxRound = 1;

      const roundOpts: string[] = ['all'];
      for (let i = 1; i <= maxRound; i++) {
        roundOpts.push(String(i));
      }
      setAvailableRounds(roundOpts);

      // Default selected round for filters: find latest finished round or 1
      const finishedMatchesList = allLeagueMatches.filter((m: any) =>
        m.status === 'finished' || (m.home_score !== null && m.away_score !== null && m.home_score !== undefined && m.away_score !== undefined)
      );
      const finishedRounds = finishedMatchesList.map((m: any) => Number(m.round || 1)).filter(r => !isNaN(r));
      const latestFinishedRound = finishedRounds.length > 0 ? Math.max(...finishedRounds) : 1;
      setSelectedRound(String(latestFinishedRound));

      // 3. Compute Standings Table (using finished matches ONLY)
      const tableMap: any = {};
      targetTeams.forEach((t: any) => {
        tableMap[t.id] = {
          ...t,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          gf: 0,
          ga: 0,
          gd: 0,
          points: t.penalty_points || 0,
        };
      });

      finishedMatchesList.forEach((m: any) => {
        const hId = m.home_team_id;
        const aId = m.away_team_id;
        const hScore = parseInt(m.home_score || 0);
        const aScore = parseInt(m.away_score || 0);

        if (tableMap[hId]) {
          tableMap[hId].played += 1;
          tableMap[hId].gf += hScore;
          tableMap[hId].ga += aScore;
          if (hScore > aScore) {
            tableMap[hId].won += 1;
            tableMap[hId].points += 3;
          } else if (hScore === aScore) {
            tableMap[hId].drawn += 1;
            tableMap[hId].points += 1;
          } else {
            tableMap[hId].lost += 1;
          }
        }

        if (tableMap[aId]) {
          tableMap[aId].played += 1;
          tableMap[aId].gf += aScore;
          tableMap[aId].ga += hScore;
          if (aScore > hScore) {
            tableMap[aId].won += 1;
            tableMap[aId].points += 3;
          } else if (aScore === hScore) {
            tableMap[aId].drawn += 1;
            tableMap[aId].points += 1;
          } else {
            tableMap[aId].lost += 1;
          }
        }
      });

      const computedStandings = Object.values(tableMap)
        .map((t: any) => {
          t.gd = t.gf - t.ga;
          return t;
        })
        .sort((a: any, b: any) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.gd !== a.gd) return b.gd - a.gd;
          return b.gf - a.gf;
        });

      setTeams(computedStandings);

      const enrichedMatches = allLeagueMatches.map((m: any) => ({
        ...m,
        home_team: m.home_team_data?.name || m.home_team || m.home_team_name || 'Jamoa 1',
        away_team: m.away_team_data?.name || m.away_team || m.away_team_name || 'Jamoa 2',
        home_team_logo: m.home_team_data?.logo_url,
        away_team_logo: m.away_team_data?.logo_url,
      }));
      setMatches(enrichedMatches);

      // 4. Fetch Events
      const { data: eventsData } = await dbClient
        .from('match_events')
        .select('*, player:applications(first_name, last_name, photo_url), team:teams(name, logo_url)')
        .in('event_type', ['goal', 'assist', 'yellow_card', 'red_card']);

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
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Process Cards Export (Barcha or Belgilangan tur)
  const processCardsExport = async (filterMode: 'all' | 'round') => {
    setShowCardsModal(false);

    try {
      const cardMap: any = {};

      const filteredEvents = rawCardEvents.filter((ev: any) => {
        if (filterMode === 'all') return true;
        const matchObj = matches.find((m: any) => String(m.id) === String(ev.match_id));
        const matchRoundStr = matchObj ? String(matchObj.round || '') : '';
        const targetRoundStr = (selectedRound && selectedRound !== 'all') ? String(selectedRound) : '';
        if (targetRoundStr) {
          return matchRoundStr === targetRoundStr;
        }
        return true;
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

  // Capture & Download PNG Image
  const handleExportPNG = async (ref: any, sectionName: string) => {
    setDownloadingSection(sectionName);
    try {
      if (!ref || !ref.current) {
        Alert.alert("Xatolik", "Rasm yaratish obyekti topilmadi.");
        return;
      }
      const uri = await ref.current.capture();
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: `${selectedLeague?.name || 'AMATORA'} - ${sectionName} PNG`,
          UTI: 'public.png',
        });
      } else {
        Alert.alert("Muvaffaqiyatli", `Rasm yaratildi: ${uri}`);
      }
    } catch (e: any) {
      console.error(e);
      Alert.alert("Xatolik", "Rasmni eksport qilishda xatolik yuz berdi");
    } finally {
      setDownloadingSection(null);
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
    ? matches.filter((m: any) => String(m.round || '') === String(selectedRound))
    : matches;
  const activeMatchCount = currentRoundMatches.length > 0 ? currentRoundMatches.length : matches.length;

  // Dynamic values for Standings Table canvas (Enlarged team name fonts)
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

  // Theme check for graphics (matching Standings.jsx)
  const isCollab = selectedLeague?.isCollab || !!collabInfo;
  const exportBgUrl = selectedLeague?.bg_image || null;

  return (
    <View style={styles.container}>
      {/* Header Selector Card */}
      <View style={[styles.headerCard, (showLeagueDropdown || showRoundDropdown) && { zIndex: 9999, elevation: 20 }]}>
        <View style={[styles.dropdownsRow, (showLeagueDropdown || showRoundDropdown) && { zIndex: 9999, elevation: 20 }]}>
          {/* League Dropdown */}
          <View style={[styles.dropdownWrapper, showLeagueDropdown && { zIndex: 10000, elevation: 25 }]}>
            <Text style={styles.dropdownLabel}>{"Liga:"}</Text>
            <TouchableOpacity
              style={styles.dropdownBtn}
              onPress={() => {
                setShowLeagueDropdown(!showLeagueDropdown);
                setShowRoundDropdown(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownBtnText} numberOfLines={1}>
                {selectedLeague?.name || "Ligalarni yuklash..."}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#94A3B8" />
            </TouchableOpacity>

            {showLeagueDropdown && (
              <View style={styles.dropdownMenu}>
                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled showsVerticalScrollIndicator={true}>
                  {leagues.map((lg) => (
                    <TouchableOpacity
                      key={lg.id}
                      style={[
                        styles.dropdownItem,
                        selectedLeague?.id === lg.id && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedLeague(lg);
                        setShowLeagueDropdown(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          selectedLeague?.id === lg.id && styles.dropdownItemTextActive,
                        ]}
                      >
                        {lg.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Round Dropdown */}
          <View style={[styles.dropdownWrapper, showRoundDropdown && { zIndex: 10000, elevation: 25 }]}>
            <Text style={styles.dropdownLabel}>{"Tur (Round):"}</Text>
            <TouchableOpacity
              style={styles.dropdownBtn}
              onPress={() => {
                setShowRoundDropdown(!showRoundDropdown);
                setShowLeagueDropdown(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownBtnText}>
                {selectedRound === 'all' ? 'Barchasi' : `${selectedRound}-Tur`}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#94A3B8" />
            </TouchableOpacity>

            {showRoundDropdown && (
              <View style={styles.dropdownMenu}>
                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled showsVerticalScrollIndicator={true}>
                  {availableRounds.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[
                        styles.dropdownItem,
                        selectedRound === r && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedRound(r);
                        setShowRoundDropdown(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          selectedRound === r && styles.dropdownItemTextActive,
                        ]}
                      >
                        {r === 'all' ? 'Barcha turlar' : `${r}-Tur`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </View>

      {loading ? (
        <ExportSkeleton />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {/* 1. TURNIR JADVALI (1080x1080 PNG GRAPHIC MATCHING IMAGE 2 1-TO-1) */}
          <View style={styles.exportSectionCard}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{"1. Turnir Jadvali"}</Text>
                <Text style={styles.sectionSubtitle}>{"1:1 Formatdagi Standings Post PNG (1080x1080)"}</Text>
              </View>
              <TouchableOpacity
                style={styles.downloadBtn}
                onPress={() => handleExportPNG(standingsRef, 'Turnir_Jadvali')}
                disabled={downloadingSection === 'Turnir_Jadvali'}
              >
                {downloadingSection === 'Turnir_Jadvali' ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <>
                    <Ionicons name="download" size={16} color="#000000" />
                    <Text style={styles.downloadBtnText}>{"PNG (1x1)"}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Scaled Preview Wrapper */}
            <ScaledCanvasPreview refObj={standingsRef} width={1080} height={1080}>
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
                            {selectedRound === 'all' ? "NATIJALAR" : `${selectedRound}-TUR NATIJALARI`}
                          </Text>
                          <View style={{ justifyContent: 'flex-start', paddingTop: 2, paddingBottom: 4, paddingHorizontal: 8 }}>
                            {(() => {
                              const roundMatches = (selectedRound && selectedRound !== 'all')
                                ? matches.filter((m: any) => String(m.round || '') === String(selectedRound))
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

                              return listToRender.length === 0 ? (
                                <Text style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', fontSize: 13.5, fontWeight: '600', paddingVertical: 16, textTransform: 'uppercase' }}>{"NATIJALAR KIRITILMAGAN"}</Text>
                              ) : (
                                listToRender.slice(0, 8).map((m: any, idx: number) => (
                                  <View key={m.id || idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: resultRowPadding, paddingHorizontal: 6, borderBottomWidth: idx < Math.min(8, listToRender.length) - 1 ? 1 : 0, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}>
                                    {/* Home Team */}
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                                      {m.home_team_logo ? (
                                        <Image source={{ uri: m.home_team_logo }} style={{ width: resultLogoSize, height: resultLogoSize, borderRadius: resultLogoSize / 2, resizeMode: 'cover' }} />
                                      ) : (
                                        <View style={{ width: resultLogoSize, height: resultLogoSize, borderRadius: resultLogoSize / 2, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                                          <Text style={{ color: '#fff', fontSize: resultLogoSize * 0.45, fontWeight: '900' }}>{(m.home_team || '?')[0]}</Text>
                                        </View>
                                      )}
                                      <Text style={{ color: '#ffffff', fontSize: resultFontSize, fontWeight: '800', textTransform: 'uppercase', flexShrink: 1, lineHeight: Math.round(resultFontSize * 1.15) }}>{m.home_team}</Text>
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
                                          <Text style={{ color: '#fff', fontSize: resultLogoSize * 0.45, fontWeight: '900' }}>{(m.away_team || '?')[0]}</Text>
                                        </View>
                                      )}
                                      <Text style={{ color: '#ffffff', fontSize: resultFontSize, fontWeight: '800', textTransform: 'uppercase', flexShrink: 1, textAlign: 'right', lineHeight: Math.round(resultFontSize * 1.15) }}>{m.away_team}</Text>
                                    </View>
                                  </View>
                                ))
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
                          return (
                            <React.Fragment key={s.id || idx}>
                              <Image source={{ uri: s.logo_url }} style={{ height: 40, maxWidth: 140, width: 110, resizeMode: 'contain', opacity: 0.9 }} />
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

            return (
              <View style={styles.exportSectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionTitle}>{`2. O'yin Jadvali (${currentScheduleRound}-TUR)`}</Text>
                    <Text style={styles.sectionSubtitle}>{"1:1 Formatdagi Match Fixtures PNG (1080x1080)"}</Text>
                  </View>
              <TouchableOpacity
                style={styles.downloadBtn}
                onPress={() => handleExportPNG(scheduleRef, 'Oyin_Jadvali')}
                disabled={downloadingSection === 'Oyin_Jadvali'}
              >
                {downloadingSection === 'Oyin_Jadvali' ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <>
                    <Ionicons name="download" size={16} color="#000000" />
                    <Text style={styles.downloadBtnText}>{"PNG (1x1)"}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

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



                  {/* Matches List (1-to-1 matching Schedule.jsx and Schedule.css) */}
                  <View style={{ flex: 1, paddingHorizontal: 45, justifyContent: 'center' }}>
                    {(() => {
                      let activeRoundNumber = 1;
                      let listToRender: any[] = [];
                      let hasScheduledMatches = false;

                      if (selectedRound && selectedRound !== 'all') {
                        activeRoundNumber = Number(selectedRound);
                        listToRender = matches.filter((m: any) => String(m.round || '') === String(selectedRound));
                        hasScheduledMatches = listToRender.some((m: any) =>
                          m.status === 'scheduled' ||
                          m.status === 'first_half' ||
                          m.status === 'second_half' ||
                          m.status === 'half_time' ||
                          (m.home_score === null && m.away_score === null && m.status !== 'finished')
                        );
                      } else {
                        // Automatically find the upcoming round with scheduled matches
                        const scheduledList = matches.filter((m: any) =>
                          m.status === 'scheduled' ||
                          m.status === 'first_half' ||
                          m.status === 'second_half' ||
                          m.status === 'half_time' ||
                          (m.home_score === null && m.away_score === null && m.status !== 'finished')
                        );

                        if (scheduledList.length > 0) {
                          const rounds = scheduledList.map((m: any) => Number(m.round || 1)).filter(r => !isNaN(r));
                          activeRoundNumber = rounds.length > 0 ? Math.min(...rounds) : 1;
                          listToRender = matches.filter((m: any) => Number(m.round || 1) === activeRoundNumber);
                          hasScheduledMatches = true;
                        } else {
                          // Fallback to the latest round when no scheduled matches remain in the league
                          const rounds = matches.map((m: any) => Number(m.round || 1)).filter(r => !isNaN(r));
                          activeRoundNumber = rounds.length > 0 ? Math.max(...rounds) : 1;
                          listToRender = matches.filter((m: any) => Number(m.round || 1) === activeRoundNumber);
                          hasScheduledMatches = false;
                        }
                      }

                      if (listToRender.length === 0) {
                        listToRender = matches;
                      }

                      const currentRoundMatches = listToRender.filter((m: any) => !m.is_postponed);
                      const postponedMatches = listToRender.filter((m: any) => m.is_postponed);
                      const totalCount = currentRoundMatches.length + postponedMatches.length;

                      let rowPaddingVertical = 9;
                      let rowPaddingHorizontal = 18;
                      let teamFontSize = 30;
                      let teamLogoSize = 65;
                      let timeBoxFontSize = 40;
                      let timeDateFontSize = 14;
                      let matchGap = 14;

                      if (totalCount > 6) {
                        rowPaddingVertical = 6.5;
                        rowPaddingHorizontal = 14;
                        teamFontSize = 26.5;
                        teamLogoSize = 58;
                        timeBoxFontSize = 36;
                        timeDateFontSize = 13;
                        matchGap = 10;
                      }

                      const renderMatchRow = (m: any, isPostponedRow = false) => {
                        const isMatchFinished = m.status === 'finished' || (m.home_score !== undefined && m.home_score !== null && (m.home_score > 0 || m.away_score > 0 || m.status === 'finished'));
                        const formattedDate = m.match_date ? m.match_date.split('-').reverse().join('.') : (m.date ? m.date.split('-').reverse().join('.') : '');
                        const formattedTime = (m.match_time || m.time || '18:00').substring(0, 5);

                        // If scheduled matches exist, show time. If no scheduled matches in league, fallback to score.
                        const centerValue = (hasScheduledMatches || !isMatchFinished)
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
                            
                            {/* Small Round Badge in Right Corner with low opacity */}
                            <View style={{ position: 'absolute', right: 18, top: 4, opacity: 0.45 }}>
                              <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
                                {`${activeRoundNumber}-TUR`}
                              </Text>
                            </View>
                          </View>
                        );
                      };

                      return listToRender.length === 0 ? (
                        <Text style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', fontSize: 22, fontWeight: '700' }}>{"O'YINLAR MAVJUD EMAS"}</Text>
                      ) : (
                        <View style={{ gap: matchGap }}>
                          {currentRoundMatches.slice(0, 8).map((m: any, idx: number) => renderMatchRow(m, false))}

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
                          return (
                            <React.Fragment key={s.id || idx}>
                              <Image source={{ uri: s.logo_url }} style={{ height: 40, maxWidth: 140, width: 110, resizeMode: 'contain', opacity: 0.9 }} />
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
          <View style={styles.exportSectionCard}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>
                  {selectedRound && selectedRound !== 'all' ? `3. Qizil va Sariq Kartochkalar (${selectedRound}-TUR)` : "3. Qizil va Sariq Kartochkalar (BARCHA)"}
                </Text>
                <Text style={styles.sectionSubtitle}>{"1:1 Formatdagi Cards & Penalties PNG (1080x1080)"}</Text>
              </View>
              <TouchableOpacity
                style={styles.downloadBtn}
                onPress={() => handleExportPNG(cardsRef, 'Kartochkalar_Jadvali')}
                disabled={downloadingSection === 'Kartochkalar_Jadvali'}
              >
                {downloadingSection === 'Kartochkalar_Jadvali' ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <>
                    <Ionicons name="download" size={16} color="#000000" />
                    <Text style={styles.downloadBtnText}>{"PNG (1x1)"}</Text>
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
                        const matchRoundStr = matchObj ? String(matchObj.round || '') : '';
                        return matchRoundStr === String(selectedRound);
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
                          return (
                            <React.Fragment key={s.id || idx}>
                              <Image source={{ uri: s.logo_url }} style={{ height: 40, maxWidth: 140, width: 110, resizeMode: 'contain', opacity: 0.9 }} />
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
          <View style={styles.exportSectionCard}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>
                  {selectedRound && selectedRound !== 'all' ? `4. To'purarlar Jadvali (${selectedRound}-TUR)` : "4. To'purarlar Jadvali (BARCHA)"}
                </Text>
                <Text style={styles.sectionSubtitle}>{"1:1 Formatdagi Top Scorers PNG (1080x1080)"}</Text>
              </View>
              <TouchableOpacity
                style={styles.downloadBtn}
                onPress={() => handleExportPNG(scorersRef, 'Topurarlar_Jadvali')}
                disabled={downloadingSection === 'Topurarlar_Jadvali'}
              >
                {downloadingSection === 'Topurarlar_Jadvali' ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <>
                    <Ionicons name="download" size={16} color="#000000" />
                    <Text style={styles.downloadBtnText}>{"PNG (1x1)"}</Text>
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
                        const matchRoundStr = matchObj ? String(matchObj.round || '') : '';
                        return matchRoundStr === String(selectedRound);
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
                      const roundLabel = selectedRound && selectedRound !== 'all' ? `${selectedRound}-TUR` : 'BARCHA TURLAR';

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
                          return (
                            <React.Fragment key={s.id || idx}>
                              <Image source={{ uri: s.logo_url }} style={{ height: 40, maxWidth: 140, width: 110, resizeMode: 'contain', opacity: 0.9 }} />
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
          <View style={[styles.exportSectionCard, { borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.06)' }]}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, { color: '#10B981' }]}>{"5. PDF Hujjat Eksporti"}</Text>
                <Text style={styles.sectionSubtitle}>
                  {"Jamoalar va o'yinchilarning to'liq ma'lumotlarini PDF formatida yuklab olish"}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.downloadBtn, { backgroundColor: '#10B981' }]}
                onPress={() => setShowPDFModal(true)}
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
          <View style={styles.pdfCard}>
            <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            {/* Modal Header */}
            <View style={styles.pdfHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="document-text" size={22} color="#10B981" />
                <Text style={styles.pdfTitle}>{"PDF Yuklab Olish"}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPDFModal(false)}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 12 }}>
              {/* Mode Buttons Row */}
              <View style={styles.pdfModeRow}>
                <TouchableOpacity
                  style={[styles.pdfModeBtn, pdfMode === 'league' && styles.pdfModeBtnActive]}
                  onPress={() => setPdfMode('league')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pdfModeText, pdfMode === 'league' && styles.pdfModeTextActive]}>
                    {"Liga bo'yicha"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.pdfModeBtn, pdfMode === 'team' && styles.pdfModeBtnActive]}
                  onPress={() => setPdfMode('team')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pdfModeText, pdfMode === 'team' && styles.pdfModeTextActive]}>
                    {"Bitta jamoa"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pdfModeAllBtn}
                  onPress={() => setPdfMode('all')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.pdfModeAllText}>{"Barchasini yuklash"}</Text>
                </TouchableOpacity>
              </View>

              {/* Mode: League Select */}
              {pdfMode === 'league' && (
                <View style={styles.pdfSectionBox}>
                  <Text style={styles.pdfLabel}>{"Liga tanlang:"}</Text>
                  <ScrollView style={{ maxHeight: 150 }} showsVerticalScrollIndicator={false}>
                    {leagues.map((lg) => (
                      <TouchableOpacity
                        key={lg.id}
                        style={[
                          styles.pdfOptionRow,
                          selectedPDFLeagueName === lg.name && styles.pdfOptionRowActive,
                        ]}
                        onPress={() => setSelectedPDFLeagueName(lg.name)}
                      >
                        <Text style={[styles.pdfOptionText, selectedPDFLeagueName === lg.name && styles.pdfOptionTextActive]}>
                          {lg.name}
                        </Text>
                        {selectedPDFLeagueName === lg.name && (
                          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <View style={styles.pdfActionRow}>
                    <TouchableOpacity style={styles.pdfBackBtn} onPress={() => setPdfMode(null)}>
                      <Text style={styles.pdfBackText}>{"Ortga"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.pdfSubmitBtn}
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
                <View style={styles.pdfSectionBox}>
                  <Text style={styles.pdfLabel}>{"Jamoa tanlang:"}</Text>
                  <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
                    {(allTeams.length > 0 ? allTeams : teams).length > 0 ? (
                      (allTeams.length > 0 ? allTeams : teams).map((tm) => (
                        <TouchableOpacity
                          key={tm.id}
                          style={[
                            styles.pdfOptionRow,
                            selectedPDFTeamId === String(tm.id) && styles.pdfOptionRowActive,
                          ]}
                          onPress={() => setSelectedPDFTeamId(String(tm.id))}
                        >
                          <Text style={[styles.pdfOptionText, selectedPDFTeamId === String(tm.id) && styles.pdfOptionTextActive]}>
                            {tm.name}
                          </Text>
                          {selectedPDFTeamId === String(tm.id) && (
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                          )}
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text style={{ color: 'rgba(255,255,255,0.5)', padding: 12, fontSize: 12, textAlign: 'center' }}>
                        {"Jamoalar topilmadi"}
                      </Text>
                    )}
                  </ScrollView>

                  <View style={styles.pdfActionRow}>
                    <TouchableOpacity style={styles.pdfBackBtn} onPress={() => setPdfMode(null)}>
                      <Text style={styles.pdfBackText}>{"Ortga"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.pdfSubmitBtn}
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
                <View style={styles.pdfSectionBox}>
                  <View style={styles.pdfInfoBox}>
                    <Ionicons name="information-circle" size={20} color="#10B981" />
                    <Text style={styles.pdfInfoText}>
                      {"Siz barcha jamoalar va ularning o'yinchilarini PDF ga yuklab olasiz."}
                    </Text>
                  </View>

                  <View style={styles.pdfActionRow}>
                    <TouchableOpacity style={styles.pdfBackBtn} onPress={() => setPdfMode(null)}>
                      <Text style={styles.pdfBackText}>{"Ortga"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.pdfSubmitBtn}
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
              <View style={styles.pdfFooterDescBox}>
                <Text style={styles.pdfFooterDescText}>
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
    backgroundColor: 'rgba(10, 15, 29, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1.2,
    borderBottomColor: 'rgba(255, 255, 255, 0.18)',
    zIndex: 999,
    elevation: 15,
  },
  dropdownsRow: {
    flexDirection: 'row',
    gap: 12,
    zIndex: 999,
  },
  dropdownWrapper: {
    flex: 1,
    position: 'relative',
    zIndex: 999,
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 102, 0.3)',
    borderRadius: 12,
    zIndex: 10000,
    elevation: 30,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.7,
    shadowRadius: 16,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  dropdownItemText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  dropdownItemTextActive: {
    color: '#FFFFFF',
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
