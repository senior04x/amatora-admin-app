import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';

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

export const CardsScreen: React.FC<{ onGoBack?: () => void }> = ({ onGoBack }) => {
  const { orgId, currentOrg, collabLeagueNames, collabLeagueIds } = useOrg();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [showLeagueModal, setShowLeagueModal] = useState(false);

  const [selectedRound, setSelectedRound] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [teams, setTeams] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [playersList, setPlayersList] = useState<any[]>([]);

  useEffect(() => {
    fetchLeaguesAndData();
  }, [orgId, collabLeagueIds]);

  const fetchLeaguesAndData = async () => {
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
      const loadedLeagues = leaguesData || [];
      setLeagues(loadedLeagues);

      if (loadedLeagues.length > 0) {
        const initialLeague = loadedLeagues[0].name;
        setSelectedLeague((prev) => (prev ? prev : initialLeague));
      }

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

      // 1. Fetch Teams (including collab)
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

      // 2. Fetch Matches (including collab)
      let matchesQuery = dbClient.from('matches').select('id, round, tour, league, home_team_id, away_team_id');
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

      // 3. Fetch Events (yellow_card & red_card)
      const { data: eventsData, error: eventsError } = await dbClient
        .from('match_events')
        .select(`
          id, 
          event_type, 
          minute, 
          player_id, 
          team_id, 
          match_id, 
          player:player_id(id, first_name, last_name, photo_url, player_number), 
          team:team_id(id, name, logo_url, league),
          match:match_id(id, round, tour, league)
        `)
        .in('event_type', ['yellow_card', 'red_card']);

      if (eventsError) {
        const { data: fbEvents } = await dbClient
          .from('match_events')
          .select('*')
          .in('event_type', ['yellow_card', 'red_card']);
        setEvents(fbEvents || []);
      } else {
        setEvents(eventsData || []);
      }

      // 4. Fetch Players for fallback info
      let playersQuery = dbClient
        .from('applications')
        .select('id, first_name, last_name, player_number, photo_url, team_id');
      if (orgId) {
        playersQuery = playersQuery.eq('organization_id', orgId);
      }
      const { data: playersData } = await playersQuery;
      setPlayersList(playersData || []);
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
    matches.forEach((m) => map.set(m.id, m));
    return map;
  }, [matches]);

  const teamMap = useMemo(() => {
    const map = new Map();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  const playerAppMap = useMemo(() => {
    const map = new Map();
    playersList.forEach((p) => map.set(p.id, p));
    return map;
  }, [playersList]);

  // Dynamic available rounds for the selected league
  const roundOptions = useMemo(() => {
    let maxRound = 0;
    matches.forEach((m) => {
      const matchLeague = String(m.league || '').toLowerCase();
      const sel = selectedLeague.toLowerCase();
      if (!sel || matchLeague.includes(sel)) {
        const r = parseInt(m.round || m.tour || '0', 10);
        if (r > maxRound) maxRound = r;
      }
    });

    events.forEach((e) => {
      const eventTeam = teamMap.get(e.team_id) || e.team;
      const teamLeague = String(eventTeam?.league || e.match?.league || '').toLowerCase();
      const sel = selectedLeague.toLowerCase();
      if (!sel || teamLeague.includes(sel)) {
        const evRound = parseInt(e.match?.round || e.match?.tour || matchMap.get(e.match_id)?.round || '0', 10);
        if (evRound > maxRound) maxRound = evRound;
      }
    });

    if (maxRound === 0) maxRound = 1;
    const list: string[] = ['all'];
    for (let i = 1; i <= maxRound; i++) {
      list.push(String(i));
    }
    return list;
  }, [matches, events, selectedLeague, teamMap, matchMap]);

  // Aggregated Card Players
  const cardPlayers = useMemo(() => {
    const cardMap = new Map<string, CardPlayer>();

    events.forEach((e) => {
      if (!e.player_id) return;
      if (e.event_type !== 'yellow_card' && e.event_type !== 'red_card') return;

      const eventTeam = teamMap.get(e.team_id) || e.team;
      const teamLeague = String(eventTeam?.league || e.match?.league || '').toLowerCase();
      const sel = selectedLeague.toLowerCase().trim();

      // League Filter
      if (sel && !teamLeague.includes(sel)) return;

      // Round Filter
      if (selectedRound && selectedRound !== 'all') {
        const evRound =
          e.match?.round !== undefined && e.match?.round !== null
            ? String(e.match.round)
            : e.match?.tour !== undefined && e.match?.tour !== null
            ? String(e.match.tour)
            : String(matchMap.get(e.match_id)?.round || matchMap.get(e.match_id)?.tour || '');
        if (evRound && evRound !== selectedRound) return;
      }

      const pId = String(e.player_id);
      if (!cardMap.has(pId)) {
        const appInfo = playerAppMap.get(e.player_id);
        const pObj = e.player || {};

        const firstName = pObj.first_name || appInfo?.first_name || '';
        const lastName = pObj.last_name || appInfo?.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || "Noma'lum o'yinchi";
        const photoUrl = pObj.photo_url || appInfo?.photo_url || '';
        const playerNumber = pObj.player_number || appInfo?.player_number || '';

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

  // PDF Export
  const handleExportPDF = async () => {
    if (exportingPDF) return;
    setExportingPDF(true);

    try {
      const orgTitle = currentOrg?.name || 'Amatora Admin';
      const leagueTitle = selectedLeague || 'Barcha Ligalar';
      const roundTitle = selectedRound === 'all' ? 'Barcha turlar' : `${selectedRound}-tur`;
      const dateStr = new Date().toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const rowsHtml = cardPlayers
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
          <td colspan="7" style="padding: 30px; text-align: center; color: #94a3b8; font-style: italic;">Kartochkalar mavjud emas</td>
        </tr>
      `;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${leagueTitle} - Kartochkalar</title>
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
            <h1 class="title">${leagueTitle} • ${roundTitle}</h1>
            <p class="sub-title">Tashkilot: <b>${orgTitle}</b> &nbsp;|&nbsp; Sana: <b>${dateStr}</b></p>
          </div>

          <div class="stats-bar">
            <div class="stat-box">
              <div class="stat-val" style="color: #facc15;">${statsSummary.totalYellow}</div>
              <div class="stat-lbl">Sariq Kartochkalar</div>
            </div>
            <div class="stat-box">
              <div class="stat-val" style="color: #ef4444;">${statsSummary.totalRed}</div>
              <div class="stat-lbl">Qizil Kartochkalar</div>
            </div>
            <div class="stat-box">
              <div class="stat-val" style="color: #38bdf8;">${statsSummary.totalCards}</div>
              <div class="stat-lbl">Jami Kartochkalar</div>
            </div>
            <div class="stat-box">
              <div class="stat-val" style="color: #ffffff;">${statsSummary.totalPlayers}</div>
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
              ${cardPlayers.length > 0 ? rowsHtml : emptyRowHtml}
            </tbody>
          </table>
        </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html: htmlContent });
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
      <View style={styles.cardItem}>
        <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />

        {/* Rank & Photo */}
        <View style={styles.playerLeftRow}>
          <Text style={styles.rankText}>{index + 1}</Text>
          <View style={styles.avatarWrapper}>
            <ExpoImage
              source={{ uri: item.photoUrl || DEFAULT_AVATAR }}
              style={styles.avatar}
              cachePolicy="memory-disk"
            />
            {Boolean(item.playerNumber) && (
              <View style={styles.numberBadge}>
                <Text style={styles.numberText}>{item.playerNumber}</Text>
              </View>
            )}
          </View>

          {/* Details */}
          <View style={styles.playerDetails}>
            <Text style={styles.playerName} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.teamRow}>
              {Boolean(item.teamLogo) && (
                <ExpoImage
                  source={{ uri: item.teamLogo || DEFAULT_TEAM_LOGO }}
                  style={styles.teamLogo}
                  cachePolicy="memory-disk"
                />
              )}
              <Text style={styles.teamName} numberOfLines={1}>
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
              <Text style={styles.cardCountText}>{item.yellowCards}</Text>
            </View>
            <Text style={styles.cardBadgeLabel}>{"Sariq"}</Text>
          </View>

          {/* Red Card Badge */}
          <View style={styles.cardBadgeBox}>
            <View style={[styles.cardIconBlock, styles.redCardBlock]}>
              <Text style={styles.cardCountText}>{item.redCards}</Text>
            </View>
            <Text style={styles.cardBadgeLabel}>{"Qizil"}</Text>
          </View>

          {/* Total Badge */}
          <View style={styles.cardBadgeBox}>
            <View style={[styles.cardIconBlock, styles.totalCardBlock]}>
              <Text style={[styles.cardCountText, { color: '#38BDF8' }]}>{item.totalCards}</Text>
            </View>
            <Text style={styles.cardBadgeLabel}>{"Jami"}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <View style={styles.topHeaderTitleRow}>
          {onGoBack && (
            <TouchableOpacity onPress={onGoBack} style={styles.backBtn} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <View style={styles.headerIconWrap}>
            <MaterialCommunityIcons name="cards-outline" size={24} color="#FACC15" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>{"Kartochkalar"}</Text>
            <Text style={styles.screenSubtitle}>{"Sariq va qizil kartochkalar monitoringi"}</Text>
          </View>

          {/* PDF Export Button */}
          <TouchableOpacity
            style={styles.pdfExportBtn}
            onPress={handleExportPDF}
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

        {/* League Selector Button */}
        <TouchableOpacity
          style={styles.leagueSelectorBtn}
          onPress={() => setShowLeagueModal(true)}
          activeOpacity={0.8}
        >
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          <Ionicons name="trophy-outline" size={18} color="#FACC15" />
          <Text style={styles.leagueSelectorText} numberOfLines={1}>
            {selectedLeague || "Ligani tanlang"}
          </Text>
          <Ionicons name="chevron-down" size={18} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>

        {/* Round Filter Tabs */}
        <View style={styles.roundScrollWrapper}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={roundOptions}
            keyExtractor={(item) => item}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
            renderItem={({ item }) => {
              const isSelected = selectedRound === item;
              return (
                <TouchableOpacity
                  style={[styles.roundChip, isSelected && styles.roundChipActive]}
                  onPress={() => setSelectedRound(item)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.roundChipText, isSelected && styles.roundChipTextActive]}>
                    {item === 'all' ? "Barcha turlar" : `${item}-tur`}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* Search Input */}
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.4)" />
          <TextInput
            style={styles.searchInput}
            placeholder="O'yinchi, forma yoki jamoa..."
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {Boolean(searchQuery) && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Summary KPI Cards */}
      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { borderColor: 'rgba(250, 204, 21, 0.3)' }]}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <Text style={[styles.kpiValue, { color: '#FACC15' }]}>{statsSummary.totalYellow}</Text>
          <Text style={styles.kpiLabel}>{"Sariq"}</Text>
        </View>

        <View style={[styles.kpiCard, { borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <Text style={[styles.kpiValue, { color: '#EF4444' }]}>{statsSummary.totalRed}</Text>
          <Text style={styles.kpiLabel}>{"Qizil"}</Text>
        </View>

        <View style={[styles.kpiCard, { borderColor: 'rgba(56, 189, 248, 0.3)' }]}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <Text style={[styles.kpiValue, { color: '#38BDF8' }]}>{statsSummary.totalCards}</Text>
          <Text style={styles.kpiLabel}>{"Jami"}</Text>
        </View>

        <View style={[styles.kpiCard, { borderColor: 'rgba(255, 255, 255, 0.15)' }]}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <Text style={[styles.kpiValue, { color: '#FFFFFF' }]}>{statsSummary.totalPlayers}</Text>
          <Text style={styles.kpiLabel}>{"O'yinchilar"}</Text>
        </View>
      </View>

      {/* Main Players Cards List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FACC15" />
          <Text style={styles.loadingText}>{"Kartochkalar yuklanmoqda..."}</Text>
        </View>
      ) : (
        <FlatList
          data={cardPlayers}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderCardPlayerItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130, gap: 10 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FACC15" />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="shield-check-outline" size={48} color="rgba(255,255,255,0.2)" />
              <Text style={styles.emptyTitle}>{"Kartochkalar mavjud emas"}</Text>
              <Text style={styles.emptySub}>
                {"Tanlangan liga yoki tur bo'yicha hech qanday kartochka qayd etilmagan."}
              </Text>
            </View>
          }
        />
      )}

      {/* League Selection Modal */}
      <Modal
        visible={showLeagueModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLeagueModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowLeagueModal(false)}
        >
          <View style={styles.modalContent}>
            <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
            <Text style={styles.modalTitle}>{"Ligani tanlang"}</Text>

            <FlatList
              data={leagues}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => {
                const isSelected = selectedLeague === item.name;
                return (
                  <TouchableOpacity
                    style={[styles.modalItem, isSelected && styles.modalItemActive]}
                    onPress={() => {
                      setSelectedLeague(item.name);
                      setShowLeagueModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="trophy"
                      size={18}
                      color={isSelected ? '#FACC15' : 'rgba(255,255,255,0.5)'}
                    />
                    <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>
                      {item.name}
                    </Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color="#FACC15" />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
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
  leagueSelectorBtn: {
    marginHorizontal: 16,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  leagueSelectorText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  roundScrollWrapper: {
    paddingVertical: 2,
  },
  roundChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  roundChipActive: {
    backgroundColor: '#FACC15',
    borderColor: '#FACC15',
  },
  roundChipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12.5,
    fontWeight: '700',
  },
  roundChipTextActive: {
    color: '#0F172A',
    fontWeight: '900',
  },
  searchBox: {
    marginHorizontal: 16,
    height: 40,
    borderRadius: 10,
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
});
