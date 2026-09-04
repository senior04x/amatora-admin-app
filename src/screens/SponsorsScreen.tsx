import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Image,
  ActivityIndicator,
  Modal,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from '../components/SafeBlurView';
import * as ImagePicker from 'expo-image-picker';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../supabaseClient';
import { getActiveOrgTournaments } from '../utils/tournamentUtils';

// Skeleton Loader Pulse Component
const SkeletonItem: React.FC<{ style?: any }> = ({ style }) => {
  const { colors } = useTheme();
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
          backgroundColor: Platform.OS === 'android' ? colors.border : '#334155',
          borderRadius: 12,
        },
        style,
        { opacity },
      ]}
    />
  );
};

// Helper: Convert base64 string to Uint8Array ArrayBuffer
const decodeBase64 = (b64: string): Uint8Array => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = b64.replace(/=+$/, '');
  let output = new Uint8Array((str.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < str.length; i += 4) {
    let n =
      (chars.indexOf(str[i]) << 18) |
      (chars.indexOf(str[i + 1]) << 12) |
      ((chars.indexOf(str[i + 2]) || 0) << 6) |
      (chars.indexOf(str[i + 3]) || 0);
    output[p++] = (n >> 16) & 0xff;
    if (str[i + 2] !== '=' && str[i + 2] !== undefined) output[p++] = (n >> 8) & 0xff;
    if (str[i + 3] !== '=' && str[i + 3] !== undefined) output[p++] = n & 0xff;
  }
  return output;
};

const assetToArrayBuffer = async (asset: ImagePicker.ImagePickerAsset): Promise<ArrayBuffer> => {
  if (asset.base64) {
    const uint8 = decodeBase64(asset.base64);
    return uint8.buffer as ArrayBuffer;
  }
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to ArrayBuffer'));
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
};

export const SponsorsScreen: React.FC = () => {
  const { orgId, currentOrg } = useOrg();
  const { colors, isDark } = useTheme();
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [mainSponsor, setMainSponsorState] = useState<any | null>(null);

  const [leagues, setLeagues] = useState<any[]>([]);
  const [showLeagueSettings, setShowLeagueSettings] = useState(false);
  const [showSponsorsSection, setShowSponsorsSection] = useState(true);

  // Turnirlarda homiy ko'rinishi (Liga & Turnir / Liga / Turnir scope filtri)
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [showTournamentSettings, setShowTournamentSettings] = useState(false);
  const [filterScope, setFilterScope] = useState<'all' | 'league' | 'tournament'>('all');

  // Modal State for Delete
  const [sponsorToDelete, setSponsorToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Main Sponsor Picker Overlay State
  const [showMainPicker, setShowMainPicker] = useState(false);

  useEffect(() => {
    fetchSponsors();
    fetchLeagues();
    fetchTournaments();
  }, [orgId]);

  const dbClient = supabase;

  // 1. Fetch Leagues and Sponsor Visibility Settings
  const fetchLeagues = async () => {
    try {
      let data: any[] | null = null;
      if (orgId) {
        const { data: orgLeagues } = await dbClient
          .from('leagues')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: true });
        if (orgLeagues && orgLeagues.length > 0) {
          data = orgLeagues;
        }
      }
      if (!data) {
        let query = dbClient.from('leagues').select('*').order('created_at', { ascending: true });
        if (orgId) {
          query = query.eq('organization_id', orgId);
        }
        const res = await query;
        data = res.data || [];
      }

      // Fetch System Sponsor Visibility Settings
      const { data: systemSettings } = await dbClient
        .from('sponsors')
        .select('*')
        .like('name', 'LEAGUE_SHOW_SPONSORS_%');

      const settingsMap: Record<string, boolean> = {};
      (systemSettings || []).forEach((s: any) => {
        const key = s.name.replace('LEAGUE_SHOW_SPONSORS_', '');
        settingsMap[key] = s.logo_url === 'true';
      });

      const processed = (data || []).map((l: any) => {
        let showSponsorsVal: boolean | undefined = undefined;
        if (l.id !== undefined && l.id !== null && settingsMap[`${l.id}`] !== undefined) {
          showSponsorsVal = settingsMap[`${l.id}`];
        } else if (l.name && settingsMap[l.name] !== undefined) {
          showSponsorsVal = settingsMap[l.name];
        } else if (l.show_sponsors !== undefined && l.show_sponsors !== null) {
          showSponsorsVal = l.show_sponsors !== false;
        } else {
          showSponsorsVal = true;
        }
        return {
          ...l,
          show_sponsors: showSponsorsVal !== false,
        };
      });
      setLeagues(processed);
    } catch (e) {
      console.error('Error fetching leagues in SponsorsScreen:', e);
    }
  };

  // 2. Toggle League Sponsors Visibility
  const toggleLeagueSponsors = async (league: any) => {
    const nextVal = !league.show_sponsors;
    setLeagues((prev) =>
      prev.map((l) => (l.id === league.id ? { ...l, show_sponsors: nextVal } : l))
    );

    try {
      const keysToSave = [`LEAGUE_SHOW_SPONSORS_${league.id}`, `LEAGUE_SHOW_SPONSORS_${league.name}`];
      for (const keyName of keysToSave) {
        if (!keyName) continue;
        const { data: existing } = await dbClient
          .from('sponsors')
          .select('id')
          .eq('name', keyName)
          .maybeSingle();

        if (existing) {
          await dbClient
            .from('sponsors')
            .update({ logo_url: String(nextVal) })
            .eq('id', existing.id);
        } else {
          await dbClient.from('sponsors').insert([
            {
              name: keyName,
              logo_url: String(nextVal),
              organization_id: orgId || null,
              is_main: false,
            },
          ]);
        }
      }

      await dbClient
        .from('leagues')
        .update({ show_sponsors: nextVal })
        .eq('id', league.id);
    } catch (e) {
      console.error('Error toggling league sponsors:', e);
    }
  };

  // 2b. Fetch Tournaments and their Sponsor Visibility Settings
  // (tournaments jadvalida show_sponsors ustuni yo'q — leagues bilan bir xil
  // sponsors-jadval kalit/qiymat konvensiyasi orqali saqlanadi, sxema o'zgarishisiz)
  const fetchTournaments = async () => {
    try {
      if (!orgId) {
        setTournaments([]);
        return;
      }
      const data = await getActiveOrgTournaments(orgId);

      const { data: systemSettings } = await dbClient
        .from('sponsors')
        .select('*')
        .like('name', 'TOURNAMENT_SHOW_SPONSORS_%');

      const settingsMap: Record<string, boolean> = {};
      (systemSettings || []).forEach((s: any) => {
        const key = s.name.replace('TOURNAMENT_SHOW_SPONSORS_', '');
        settingsMap[key] = s.logo_url === 'true';
      });

      const processed = (data || []).map((t: any) => {
        let showSponsorsVal: boolean | undefined = undefined;
        if (t.id !== undefined && t.id !== null && settingsMap[`${t.id}`] !== undefined) {
          showSponsorsVal = settingsMap[`${t.id}`];
        } else if (t.name && settingsMap[t.name] !== undefined) {
          showSponsorsVal = settingsMap[t.name];
        } else {
          showSponsorsVal = true;
        }
        return {
          ...t,
          show_sponsors: showSponsorsVal !== false,
        };
      });
      setTournaments(processed);
    } catch (e) {
      console.error('Error fetching tournaments in SponsorsScreen:', e);
    }
  };

  // 2c. Toggle Tournament Sponsors Visibility
  const toggleTournamentSponsors = async (tournament: any) => {
    const nextVal = !tournament.show_sponsors;
    setTournaments((prev) =>
      prev.map((t) => (t.id === tournament.id ? { ...t, show_sponsors: nextVal } : t))
    );

    try {
      const keysToSave = [`TOURNAMENT_SHOW_SPONSORS_${tournament.id}`, `TOURNAMENT_SHOW_SPONSORS_${tournament.name}`];
      for (const keyName of keysToSave) {
        if (!keyName) continue;
        const { data: existing } = await dbClient
          .from('sponsors')
          .select('id')
          .eq('name', keyName)
          .maybeSingle();

        if (existing) {
          await dbClient
            .from('sponsors')
            .update({ logo_url: String(nextVal) })
            .eq('id', existing.id);
        } else {
          await dbClient.from('sponsors').insert([
            {
              name: keyName,
              logo_url: String(nextVal),
              organization_id: orgId || null,
              is_main: false,
            },
          ]);
        }
      }
    } catch (e) {
      console.error('Error toggling tournament sponsors:', e);
    }
  };

  // 3. Fetch Sponsors List
  const fetchSponsors = async () => {
    setLoading(true);
    try {
      let loadedSponsors: any[] = [];
      if (orgId) {
        const { data: orgSponsors } = await dbClient
          .from('sponsors')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false });
        loadedSponsors = orgSponsors || [];
      } else {
        const { data } = await dbClient
          .from('sponsors')
          .select('*')
          .is('organization_id', null)
          .order('created_at', { ascending: false });
        loadedSponsors = data || [];
      }

      // Filter out internal system keys & background images by name OR logo_url (case-insensitive)
      const realSponsors = loadedSponsors.filter((s: any) => {
        if (!s) return false;
        const uName = String(s.name || '').toUpperCase();
        const rawUrl = String(s.logo_url || '').trim();
        const uUrl = rawUrl.toUpperCase();

        // 1. Must not be internal system signal, replay trigger, or config keys
        if (
          uName.startsWith('SCHEDULE_BANNER') ||
          uName.startsWith('YT_BANNER') ||
          uName.startsWith('YT_OAUTH') ||
          uName.startsWith('MATCH_TIMER') ||
          uName.startsWith('REMOTE_') ||
          uName.includes('REMOTE_FINISH') ||
          uName.includes('REMOTE_GOAL') ||
          uName.includes('MATCH_TIMER') ||
          uName.startsWith('LEAGUE_SHOW_SPONSORS') ||
          uName.startsWith('LEAGUE_BG') ||
          uName.startsWith('EXPORT_BG') ||
          uName.startsWith('BG_') ||
          uName.endsWith('_BG') ||
          uName.includes('BACKGROUND') ||
          uUrl.includes('LEAGUE-BACKGROUNDS') ||
          uUrl.includes('LEAGUE_BG') ||
          uUrl.includes('EXPORT_BG') ||
          uUrl.includes('EXPORT-BG')
        ) {
          return false;
        }

        // 2. Must be a valid image URL (not a JSON string payload like {"timestamp":...})
        if (rawUrl.startsWith('{') || rawUrl.startsWith('[') || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') && !rawUrl.startsWith('file://') && !rawUrl.startsWith('data:'))) {
          return false;
        }

        return true;
      });

      setSponsors(realSponsors);

      const mainFromDb = realSponsors.find((s: any) => s.is_main === true);
      setMainSponsorState(mainFromDb || null);
    } catch (err) {
      console.error('Error fetching sponsors:', err);
    } finally {
      setLoading(false);
    }
  };

  // 4. Upload Sponsor Logo Image
  const handleUploadSponsor = async () => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const selectedAsset = pickerResult.assets[0];
      setUploading(true);

      const dbClient = supabase;
      const fileExt = selectedAsset.uri.split('.').pop() || 'png';
      const fileName = `sponsor_${Date.now()}.${fileExt}`;

      let arrayBuffer: Uint8Array | ArrayBuffer | null = null;

      if (selectedAsset.base64) {
        arrayBuffer = decodeBase64(selectedAsset.base64);
      } else {
        const response = await fetch(selectedAsset.uri);
        const blob = await response.blob();
        arrayBuffer = await new Response(blob).arrayBuffer();
      }

      if (!arrayBuffer) throw new Error('Rasm fayli oqimi olinmadi');

      let activeBucket = 'sponsors';
      let uploadRes = await dbClient.storage
        .from('sponsors')
        .upload(fileName, arrayBuffer, { contentType: `image/${fileExt}`, upsert: true });

      if (uploadRes.error) {
        console.warn('sponsors bucket failed, fallback to player-photos...', uploadRes.error);
        activeBucket = 'player-photos';
        uploadRes = await dbClient.storage
          .from('player-photos')
          .upload(fileName, arrayBuffer, { contentType: `image/${fileExt}`, upsert: true });
      }

      if (uploadRes.error) {
        console.error('Storage upload failed:', uploadRes.error);
        throw new Error('Rasm yuklashda xatolik: ' + uploadRes.error.message);
      }

      const { data: urlData } = dbClient.storage.from(activeBucket).getPublicUrl(fileName);
      const publicUrl = urlData?.publicUrl;

      if (!publicUrl) throw new Error('Public URL olinmadi');

      const sponsorName = selectedAsset.fileName || `Homiy_${Date.now()}`;

      let insertData: any[] | null = null;
      let insertErr: any = null;

      try {
        const res = await dbClient
          .from('sponsors')
          .insert([
            {
              name: sponsorName,
              logo_url: publicUrl,
              organization_id: orgId || null,
              is_main: false,
            },
          ])
          .select();
        insertData = res.data;
        insertErr = res.error;
      } catch (e) {
        const res = await dbClient
          .from('sponsors')
          .insert([
            {
              name: sponsorName,
              logo_url: publicUrl,
              is_main: false,
            },
          ])
          .select();
        insertData = res.data;
        insertErr = res.error;
      }

      if (insertErr) throw insertErr;

      if (insertData && insertData.length > 0) {
        setSponsors((prev) => [{ ...insertData[0], is_selected: true }, ...prev]);
        Alert.alert('Muvaffaqiyatli', 'Yangi homiy logotipi yuklandi va saqlandi!');
      } else {
        fetchSponsors();
        Alert.alert('Muvaffaqiyatli', 'Yangi homiy logotipi saqlandi!');
      }
    } catch (err: any) {
      console.error('Error uploading sponsor:', err);
      Alert.alert('Xatolik', 'Yuklashda xatolik yuz berdi: ' + (err.message || ''));
    } finally {
      setUploading(false);
    }
  };

  // 5. Set Main Sponsor
  const handleSetMainSponsor = async (sponsor: any) => {
    const isCurrentMain = mainSponsor?.id === sponsor?.id;
    const targetMain = isCurrentMain ? null : sponsor;

    setMainSponsorState(targetMain);

    setSponsors((prev) =>
      prev.map((s) => {
        if (targetMain && s.id === targetMain.id) {
          return { ...s, is_main: true, is_selected: false };
        }
        return { ...s, is_main: false };
      })
    );

    try {
      if (orgId) {
        await dbClient.from('sponsors').update({ is_main: false }).eq('organization_id', orgId);
      }
      await dbClient.from('sponsors').update({ is_main: false }).is('organization_id', null);

      if (targetMain) {
        await dbClient
          .from('sponsors')
          .update({ is_main: true })
          .eq('id', targetMain.id);
      }
    } catch (e) {
      console.error('Error updating main sponsor in DB:', e);
    }
  };

  // 6. Toggle Secondary Sponsor Selection (Active / Inactive)
  const toggleSelectSponsor = async (sponsor: any) => {
    if (mainSponsor?.id === sponsor.id) return;

    const currentSelected = sponsor.is_selected !== false;
    const nextState = !currentSelected;

    setSponsors((prev) =>
      prev.map((s) => (s.id === sponsor.id ? { ...s, is_selected: nextState } : s))
    );
  };

  // 7. Execute Delete Sponsor
  const executeDeleteSponsor = async () => {
    if (!sponsorToDelete) return;
    setIsDeleting(true);
    try {
      const fileName = sponsorToDelete.logo_url?.split('/').pop();
      if (fileName) {
        try {
          await dbClient.storage.from('sponsors').remove([fileName]);
          await dbClient.storage.from('player-photos').remove([fileName]);
          await dbClient.storage.from('player-photos').remove([`league-backgrounds/${fileName}`]);
        } catch (e) {
          console.warn('Storage file remove warning:', e);
        }
      }

      const { error } = await dbClient.from('sponsors').delete().eq('id', sponsorToDelete.id);
      if (error) throw error;

      setSponsors((prev) => prev.filter((s) => s.id !== sponsorToDelete.id));
      if (mainSponsor?.id === sponsorToDelete.id) {
        setMainSponsorState(null);
      }

      setSponsorToDelete(null);
      Alert.alert('Muvaffaqiyatli', "Homiy o'chirildi!");
    } catch (err: any) {
      console.error('Error deleting sponsor:', err);
      Alert.alert('Xatolik', "O'chirishda xatolik yuz berdi: " + (err.message || ''));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ScrollView style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      {/* HEADER SECTION */}
      <View style={styles.headerRow}>
        <View style={[styles.headerIconBox, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7', borderColor: isDark ? 'rgba(245, 158, 11, 0.3)' : '#FDE68A' }]}>
          <Ionicons name="ribbon" size={24} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.screenTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Homiylar Boshqaruvi"}</Text>
          <Text style={[styles.screenSub, Platform.OS === 'android' && { color: colors.textMuted }]}>
            {`Tashkilot (${currentOrg?.name || 'Asosiy'}) uchun Bosh Homiy va homiylarni belgilash`}
          </Text>
        </View>
      </View>

      {/* Scope Selector: Liga & Turnir / Liga / Turnir — quyidagi bo'limlar shunga qarab ko'rinadi */}
      {(leagues.length > 0 || tournaments.length > 0) && (
        <View style={styles.scopeSelectorContainer}>
          <TouchableOpacity
            style={[styles.scopeSelectorBtn, filterScope === 'all' && styles.scopeSelectorBtnActive]}
            onPress={() => setFilterScope('all')}
            activeOpacity={0.8}
          >
            {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="globe-outline" size={14} color={filterScope === 'all' ? '#38BDF8' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')} />
            <Text style={[styles.scopeSelectorText, filterScope === 'all' && { color: '#38BDF8' }, Platform.OS === 'android' && { color: filterScope === 'all' ? '#38BDF8' : colors.textMuted }]} numberOfLines={1}>
              Liga & Turnir
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scopeSelectorBtn, filterScope === 'league' && styles.scopeSelectorBtnActiveLeague]}
            onPress={() => setFilterScope('league')}
            activeOpacity={0.8}
          >
            {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="trophy-outline" size={14} color={filterScope === 'league' ? '#F59E0B' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')} />
            <Text style={[styles.scopeSelectorText, filterScope === 'league' && { color: '#F59E0B' }, Platform.OS === 'android' && { color: filterScope === 'league' ? '#F59E0B' : colors.textMuted }]} numberOfLines={1}>
              Liga
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scopeSelectorBtn, filterScope === 'tournament' && styles.scopeSelectorBtnActiveTournament]}
            onPress={() => setFilterScope('tournament')}
            activeOpacity={0.8}
          >
            {Platform.OS === 'ios' && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <Ionicons name="ribbon-outline" size={14} color={filterScope === 'tournament' ? '#EC4899' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.5)')} />
            <Text style={[styles.scopeSelectorText, filterScope === 'tournament' && { color: '#EC4899' }, Platform.OS === 'android' && { color: filterScope === 'tournament' ? '#EC4899' : colors.textMuted }]} numberOfLines={1}>
              Turnir
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SECTION 1: League Sponsors Visibility Accordion */}
      {leagues.length > 0 && filterScope !== 'tournament' && (
        <View style={[styles.sectionAccordionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
          <TouchableOpacity
            style={[styles.accordionHeaderBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}
            activeOpacity={0.8}
            onPress={() => setShowLeagueSettings(!showLeagueSettings)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="sparkles" size={20} color={colors.accentGreen} />
              <Text style={[styles.accordionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ligalarda Homiy Ko'rinishi"}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.accordionSubText, Platform.OS === 'android' && { color: colors.textMuted }, showLeagueSettings && { color: colors.accentGreen }]}>
                {showLeagueSettings ? 'Yopish' : 'Ochish'}
              </Text>
              <Ionicons
                name={showLeagueSettings ? "chevron-up" : "chevron-down"}
                size={18}
                color={showLeagueSettings ? colors.accentGreen : (Platform.OS === 'android' ? colors.textMuted : "#94A3B8")}
              />
            </View>
          </TouchableOpacity>

          {showLeagueSettings && (
            <View style={[styles.accordionBody, Platform.OS === 'android' && { borderTopColor: colors.border }]}>
              <Text style={[styles.leagueTipText, Platform.OS === 'android' && { color: colors.textSecondary }]}>
                {"⭐ Bosh Homiy har doim barcha ligalar shablonlarida (yuqori o'ng burchakda) ko'rinadi. Pastki homiylar stripini har bir liga uchun yoqish yoki o'chirish:"}
              </Text>

              <View style={{ gap: 10, marginTop: 12 }}>
                {leagues.map((league) => {
                  const isShow = league.show_sponsors !== false;
                  return (
                    <TouchableOpacity
                      key={league.id}
                      style={[
                        styles.leagueRowCard,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                        isShow && (Platform.OS === 'android' ? { backgroundColor: isDark ? 'rgba(0, 255, 102, 0.08)' : '#ECFDF5', borderColor: colors.accentGreen } : { backgroundColor: 'rgba(0, 255, 102, 0.08)', borderColor: 'rgba(0, 255, 102, 0.4)' }),
                      ]}
                      activeOpacity={0.8}
                      onPress={() => toggleLeagueSponsors(league)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        {league.logo_url ? (
                          <Image source={{ uri: league.logo_url }} style={styles.leagueRowLogo} />
                        ) : (
                          <Ionicons name="trophy-outline" size={22} color="#F59E0B" />
                        )}
                        <Text style={[styles.leagueRowName, Platform.OS === 'android' && { color: colors.textPrimary }]}>{league.name}</Text>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[styles.leagueStatusText, { color: isShow ? colors.accentGreen : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.4)') }]}>
                          {isShow ? "YONIQLIK" : "O'CHIQ"}
                        </Text>
                        <Switch
                          value={isShow}
                          onValueChange={() => toggleLeagueSponsors(league)}
                          trackColor={{ false: '#334155', true: '#059669' }}
                          thumbColor={isShow ? colors.accentGreen : (Platform.OS === 'android' ? colors.border : '#94A3B8')}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      )}

      {/* SECTION 1b: Tournament Sponsors Visibility Accordion */}
      {tournaments.length > 0 && filterScope !== 'league' && (
        <View style={[styles.sectionAccordionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
          <TouchableOpacity
            style={[styles.accordionHeaderBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}
            activeOpacity={0.8}
            onPress={() => setShowTournamentSettings(!showTournamentSettings)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="ribbon" size={20} color="#EC4899" />
              <Text style={[styles.accordionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Turnirlarda Homiy Ko'rinishi"}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.accordionSubText, Platform.OS === 'android' && { color: colors.textMuted }, showTournamentSettings && { color: '#EC4899' }]}>
                {showTournamentSettings ? 'Yopish' : 'Ochish'}
              </Text>
              <Ionicons
                name={showTournamentSettings ? "chevron-up" : "chevron-down"}
                size={18}
                color={showTournamentSettings ? '#EC4899' : (Platform.OS === 'android' ? colors.textMuted : "#94A3B8")}
              />
            </View>
          </TouchableOpacity>

          {showTournamentSettings && (
            <View style={[styles.accordionBody, Platform.OS === 'android' && { borderTopColor: colors.border }]}>
              <Text style={[styles.leagueTipText, Platform.OS === 'android' && { color: colors.textSecondary }]}>
                {"⭐ Bosh Homiy har doim barcha turnir shablonlarida ko'rinadi. Pastki homiylar stripini har bir turnir uchun yoqish yoki o'chirish:"}
              </Text>

              <View style={{ gap: 10, marginTop: 12 }}>
                {tournaments.map((tournament) => {
                  const isShow = tournament.show_sponsors !== false;
                  return (
                    <TouchableOpacity
                      key={tournament.id}
                      style={[
                        styles.leagueRowCard,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border },
                        isShow && (Platform.OS === 'android' ? { backgroundColor: isDark ? 'rgba(236, 72, 153, 0.08)' : '#FDF2F8', borderColor: '#EC4899' } : { backgroundColor: 'rgba(236, 72, 153, 0.08)', borderColor: 'rgba(236, 72, 153, 0.4)' }),
                      ]}
                      activeOpacity={0.8}
                      onPress={() => toggleTournamentSponsors(tournament)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                        {tournament.logo_url ? (
                          <Image source={{ uri: tournament.logo_url }} style={styles.leagueRowLogo} />
                        ) : (
                          <Ionicons name="ribbon-outline" size={22} color="#EC4899" />
                        )}
                        <Text style={[styles.leagueRowName, Platform.OS === 'android' && { color: colors.textPrimary }]}>{tournament.name}</Text>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[styles.leagueStatusText, { color: isShow ? '#EC4899' : (Platform.OS === 'android' ? colors.textMuted : 'rgba(255,255,255,0.4)') }]}>
                          {isShow ? "YONIQLIK" : "O'CHIQ"}
                        </Text>
                        <Switch
                          value={isShow}
                          onValueChange={() => toggleTournamentSponsors(tournament)}
                          trackColor={{ false: '#334155', true: '#EC4899' }}
                          thumbColor={isShow ? '#EC4899' : (Platform.OS === 'android' ? colors.border : '#94A3B8')}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      )}

      {/* SECTION 2 & 3: Main Sponsor Direct Select + Image Upload */}
      <View style={[styles.sectionAccordionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
        <TouchableOpacity
          style={[styles.accordionHeaderBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}
          activeOpacity={0.8}
          onPress={() => setShowSponsorsSection(!showSponsorsSection)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="images" size={20} color={colors.accentGreen} />
            <Text style={[styles.accordionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{`Homiylar Ro'yxati (${sponsors.length}ta homiy)`}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.accordionSubText, Platform.OS === 'android' && { color: colors.textMuted }, showSponsorsSection && { color: colors.accentGreen }]}>
              {showSponsorsSection ? 'Yopish' : 'Ochish'}
            </Text>
            <Ionicons
              name={showSponsorsSection ? "chevron-up" : "chevron-down"}
              size={18}
              color={showSponsorsSection ? colors.accentGreen : (Platform.OS === 'android' ? colors.textMuted : "#94A3B8")}
            />
          </View>
        </TouchableOpacity>

        {showSponsorsSection && (
          <View style={[styles.accordionBody, Platform.OS === 'android' && { borderTopColor: colors.border }]}>
            {/* MAIN SPONSOR DIRECT SELECT BOX */}
            <View style={[styles.mainSponsorGoldCard, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FFFBEB', borderColor: isDark ? 'rgba(245, 158, 11, 0.4)' : '#FCD34D' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={[styles.goldStarCircle, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.25)' : '#FEF3C7' }]}>
                  <Ionicons name="star" size={22} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.goldCardTitle, Platform.OS === 'android' && { color: isDark ? '#FEF08A' : '#B45309' }]}>{"Tashkilot Bosh Homiysi"}</Text>
                  <Text style={[styles.goldCardSub, Platform.OS === 'android' && { color: isDark ? 'rgba(255, 255, 255, 0.7)' : '#78350F' }]}>{"Yuqori o'ng burchakda turadigan asosiy homiyni tanlang:"}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.mainPickerSelectBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: isDark ? 'rgba(245, 158, 11, 0.5)' : '#FCD34D' }]}
                activeOpacity={0.8}
                onPress={() => setShowMainPicker(true)}
              >
                {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
                {mainSponsor ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Image source={{ uri: mainSponsor.logo_url }} style={{ width: 24, height: 24, borderRadius: 12, resizeMode: 'contain' }} />
                    <Text style={[styles.mainPickerText, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                      {`⭐ ${mainSponsor.name || 'Homiy'} (Bosh Homiy)`}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.mainPickerText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"-- Bosh homiy yo'q (Tanlanmagan) --"}</Text>
                )}
                <Ionicons name="chevron-down" size={18} color="#F59E0B" />
              </TouchableOpacity>
            </View>

            {/* UPLOAD SPONSOR LOGO BUTTON */}
            <TouchableOpacity
              style={[styles.uploadBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }, uploading && { opacity: 0.6 }]}
              activeOpacity={0.8}
              onPress={handleUploadSponsor}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={20} color="#000000" />
                  <Text style={styles.uploadBtnText}>{"Yangi homiy logotipini yuklash"}</Text>
                </>
              )}
            </TouchableOpacity>

            {/* SPONSORS GRID LIST */}
            {loading ? (
              <View style={styles.gridContainer}>
                {[1, 2, 3, 4].map((k) => (
                  <View key={k} style={[styles.sponsorCardSkeleton, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                    <SkeletonItem style={{ width: '100%', height: 100, borderRadius: 12 }} />
                    <SkeletonItem style={{ width: 100, height: 14, borderRadius: 4, marginTop: 10 }} />
                  </View>
                ))}
              </View>
            ) : sponsors.length === 0 ? (
              <View style={[styles.emptySponsorsBox, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                <Ionicons name="sparkles-outline" size={42} color={colors.accentGreen} />
                <Text style={[styles.emptySponsorsText, Platform.OS === 'android' && { color: colors.textMuted }]}>
                  {"Hali homiylar kiritilmagan. Yuqoridagi tugma orqali yangi homiy yuklang."}
                </Text>
              </View>
            ) : (
              <View style={styles.gridContainer}>
                {sponsors.map((sponsor) => {
                  const isMain = mainSponsor?.id === sponsor.id;
                  const isSelected = !isMain && sponsor.is_selected !== false;

                  return (
                    <View
                      key={sponsor.id}
                      style={[
                        styles.sponsorCard,
                        Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border },
                        isMain && (Platform.OS === 'android' ? { borderColor: '#F59E0B', backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FFFBEB' } : styles.sponsorCardMain),
                        isSelected && !isMain && (Platform.OS === 'android' ? { borderColor: colors.accentGreen, backgroundColor: isDark ? 'rgba(0, 255, 102, 0.08)' : '#ECFDF5' } : styles.sponsorCardSelected),
                      ]}
                    >
                      {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
                      {/* Top Status Badge */}
                      <View style={{ width: '100%', alignItems: 'center' }}>
                        {isMain ? (
                          <View style={[styles.mainSponsorBadge, Platform.OS === 'android' && { backgroundColor: '#F59E0B', borderColor: '#F59E0B' }]}>
                            <Ionicons name="star" size={12} color="#000000" />
                            <Text style={[styles.mainSponsorBadgeText, Platform.OS === 'android' && { color: '#000000' }]}>{"BOSH HOMIY"}</Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.statusBadge,
                              isSelected ? styles.statusBadgeActive : styles.statusBadgeInactive,
                              Platform.OS === 'android' && isSelected && { backgroundColor: isDark ? 'rgba(0, 255, 102, 0.15)' : '#DCFCE7', borderColor: colors.accentGreen },
                              Platform.OS === 'android' && !isSelected && { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2', borderColor: '#EF4444' },
                            ]}
                          >
                            <Ionicons
                              name={isSelected ? "checkmark-circle" : "close-circle"}
                              size={12}
                              color={isSelected ? (Platform.OS === 'android' ? colors.accentGreen : "#00FF66") : "#EF4444"}
                            />
                            <Text style={[styles.statusBadgeText, { color: isSelected ? (Platform.OS === 'android' ? colors.accentGreen : '#00FF66') : '#EF4444' }]}>
                              {isSelected ? "AKTIV" : "NOFAOL"}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Centered Sponsor Logo Image */}
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={[styles.logoImgContainer, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#F3F4F6' }]}
                        onPress={() => toggleSelectSponsor(sponsor)}
                      >
                        <Image source={{ uri: sponsor.logo_url }} style={styles.sponsorLogoImg} />
                      </TouchableOpacity>

                      {/* Sponsor Name */}
                      <Text style={[styles.sponsorNameTag, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                        {sponsor.name && !sponsor.name.startsWith('sponsor_') ? sponsor.name : 'Homiy logotipi'}
                      </Text>

                      {/* Bottom Action Buttons in 1 single row */}
                      <View style={styles.sponsorCardFooter}>
                        <TouchableOpacity
                          style={[
                            styles.btnActionSmall,
                            Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, borderWidth: 1 },
                            isMain && (Platform.OS === 'android' ? { backgroundColor: '#F59E0B', borderColor: '#F59E0B' } : styles.btnActionSmallMain),
                          ]}
                          onPress={() => handleSetMainSponsor(sponsor)}
                        >
                          <Ionicons name="star" size={14} color={isMain ? "#000000" : "#F59E0B"} />
                          <Text style={[styles.btnActionTextSmall, Platform.OS === 'android' && { color: colors.textPrimary }, isMain && { color: '#000000' }]} numberOfLines={1}>
                            {isMain ? "Bosh Homiy" : "Bosh Homiy Qilish"}
                          </Text>
                        </TouchableOpacity>

                        {!isMain && (
                          <TouchableOpacity
                            style={[
                              styles.btnActionSmall,
                              Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, borderWidth: 1 },
                              isSelected && (Platform.OS === 'android' ? { backgroundColor: isDark ? 'rgba(0, 255, 102, 0.15)' : '#DCFCE7', borderColor: colors.accentGreen } : styles.btnActionSmallActive),
                            ]}
                            onPress={() => toggleSelectSponsor(sponsor)}
                          >
                            <Ionicons
                              name={isSelected ? "eye" : "eye-off"}
                              size={14}
                              color={isSelected ? (Platform.OS === 'android' ? colors.accentGreen : "#00FF66") : (Platform.OS === 'android' ? colors.textMuted : "#94A3B8")}
                            />
                            <Text style={[styles.btnActionTextSmall, Platform.OS === 'android' && { color: colors.textPrimary }, isSelected && { color: colors.accentGreen }]} numberOfLines={1}>
                              {isSelected ? "Aktiv" : "Nofaol"}
                            </Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={[styles.btnDeleteSmall, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2' }]}
                          onPress={() => setSponsorToDelete(sponsor)}
                        >
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </View>

      {/* MAIN SPONSOR SELECTOR MODAL */}
      <Modal visible={showMainPicker} transparent animationType="fade" onRequestClose={() => setShowMainPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowMainPicker(false)}>
          <View style={[styles.modalCard, { maxWidth: 420, maxHeight: '80%' }, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
            <View style={[styles.modalHeader, Platform.OS === 'android' && { borderBottomColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="star" size={20} color="#F59E0B" />
                <Text style={[styles.modalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Bosh Homiyni Tanlang"}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowMainPicker(false)}>
                <Ionicons name="close" size={22} color={Platform.OS === 'android' ? colors.textPrimary : "#94A3B8"} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: 10 }}>
              {/* Option 0: None */}
              <TouchableOpacity
                style={[styles.pickerOptionRow, Platform.OS === 'android' && { borderBottomColor: colors.border }]}
                onPress={() => {
                  if (mainSponsor) handleSetMainSponsor(mainSponsor);
                  setShowMainPicker(false);
                }}
              >
                <Ionicons name="close-circle-outline" size={22} color={Platform.OS === 'android' ? colors.textMuted : "#94A3B8"} style={{ marginRight: 12 }} />
                <Text style={[styles.pickerOptionText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"-- Bosh homiy yo'q (Tanlanmagan) --"}</Text>
                {!mainSponsor && <Ionicons name="checkmark" size={18} color={colors.accentGreen} style={{ marginLeft: 'auto' }} />}
              </TouchableOpacity>

              {sponsors.map((s) => {
                const isSelected = mainSponsor?.id === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.pickerOptionRow, Platform.OS === 'android' && { borderBottomColor: colors.border }]}
                    onPress={() => {
                      handleSetMainSponsor(s);
                      setShowMainPicker(false);
                    }}
                  >
                    <Image source={{ uri: s.logo_url }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 12, resizeMode: 'contain' }} />
                    <Text style={[styles.pickerOptionText, Platform.OS === 'android' && { color: colors.textPrimary }, isSelected && { color: '#F59E0B', fontWeight: '900' }]}>
                      {`⭐ ${s.name || 'Homiy'}`}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={18} color="#F59E0B" style={{ marginLeft: 'auto' }} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal visible={!!sponsorToDelete} transparent animationType="fade" onRequestClose={() => setSponsorToDelete(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 400, padding: 22, alignItems: 'center' }, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
            <View style={styles.deleteIconBg}>
              <Ionicons name="trash-outline" size={32} color="#EF4444" />
            </View>
            <Text style={[styles.deleteTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Homiyni O'chirish"}</Text>
            <Text style={[styles.deleteSub, Platform.OS === 'android' && { color: colors.textMuted }]}>
              {"Haqiqatan ham ushbu homiy logotipini bazadan va xotiradan o'chirib tashlamoqchimisiz?"}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginTop: 20 }}>
              <TouchableOpacity style={[styles.modalCancelBtn, { flex: 1 }, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, borderWidth: 1 }]} onPress={() => setSponsorToDelete(null)}>
                <Text style={[styles.modalCancelText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Bekor qilish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSaveBtn, { flex: 1, backgroundColor: '#EF4444' }]}
                onPress={executeDeleteSponsor}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={[styles.modalSaveText, { color: '#FFFFFF' }]}>{"O'chirish"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  headerIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  screenTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  screenSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  scopeSelectorContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  scopeSelectorBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(30, 41, 59, 0.65)' : '#1E293B',
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  scopeSelectorBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.1)',
  },
  scopeSelectorBtnActiveLeague: {
    borderColor: '#F59E0B',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.1)',
  },
  scopeSelectorBtnActiveTournament: {
    borderColor: '#EC4899',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(236, 72, 153, 0.12)' : 'rgba(236, 72, 153, 0.1)',
  },
  scopeSelectorText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11.5,
    fontWeight: '800',
  },
  sectionAccordionCard: {
    backgroundColor: 'transparent',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
    marginBottom: 16,
  },
  accordionHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  accordionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  accordionSubText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  accordionBody: {
    padding: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  leagueTipText: {
    color: '#94A3B8',
    fontSize: 12.5,
    lineHeight: 18,
  },
  leagueRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  leagueRowLogo: {
    width: 30,
    height: 30,
    borderRadius: 15,
    resizeMode: 'contain',
  },
  leagueRowName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  leagueStatusText: {
    fontSize: 11,
    fontWeight: '900',
  },
  mainSponsorGoldCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  goldStarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldCardTitle: {
    color: '#FEF08A',
    fontSize: 15,
    fontWeight: '800',
  },
  goldCardSub: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11.5,
    marginTop: 2,
  },
  mainPickerSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: 'hidden',
  },
  mainPickerText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FF66',
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 20,
  },
  uploadBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '900',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sponsorCardSkeleton: {
    width: '48%',
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 12,
  },
  emptySponsorsBox: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  emptySponsorsText: {
    color: '#94A3B8',
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 10,
  },
  sponsorCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    padding: 16,
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  sponsorCardMain: {
    borderColor: 'rgba(255, 255, 255, 0.4)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  sponsorCardSelected: {
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  mainSponsorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'center',
  },
  mainSponsorBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'center',
  },
  statusBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  statusBadgeInactive: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  logoImgContainer: {
    width: 100,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 6,
  },
  sponsorLogoImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  sponsorNameTag: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  sponsorCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    marginTop: 4,
  },
  btnActionSmall: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingVertical: 6,
  },
  btnActionSmallMain: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  btnActionSmallActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  btnActionTextSmall: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '800',
  },
  btnDeleteSmall: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  pickerOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  pickerOptionText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  deleteIconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  deleteTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  deleteSub: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  modalSaveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '900',
  },
});
