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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';

// Skeleton Loader Pulse Component
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
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [mainSponsor, setMainSponsorState] = useState<any | null>(null);

  const [leagues, setLeagues] = useState<any[]>([]);
  const [showLeagueSettings, setShowLeagueSettings] = useState(false);
  const [showSponsorsSection, setShowSponsorsSection] = useState(true);

  // Modal State for Delete
  const [sponsorToDelete, setSponsorToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Main Sponsor Picker Overlay State
  const [showMainPicker, setShowMainPicker] = useState(false);

  useEffect(() => {
    fetchSponsors();
    fetchLeagues();
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
        const uUrl = String(s.logo_url || '').toUpperCase();

        if (
          uName.startsWith('SCHEDULE_BANNER') ||
          uName.startsWith('YT_BANNER') ||
          uName.startsWith('YT_OAUTH') ||
          uName.startsWith('MATCH_TIMER') ||
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
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      {/* HEADER SECTION */}
      <View style={styles.headerRow}>
        <View style={styles.headerIconBox}>
          <Ionicons name="ribbon" size={24} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.screenTitle}>{"Homiylar Boshqaruvi"}</Text>
          <Text style={styles.screenSub}>
            {`Tashkilot (${currentOrg?.name || 'Asosiy'}) uchun Bosh Homiy va homiylarni belgilash`}
          </Text>
        </View>
      </View>

      {/* SECTION 1: League Sponsors Visibility Accordion */}
      {leagues.length > 0 && (
        <View style={styles.sectionAccordionCard}>
          <TouchableOpacity
            style={styles.accordionHeaderBtn}
            activeOpacity={0.8}
            onPress={() => setShowLeagueSettings(!showLeagueSettings)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="sparkles" size={20} color="#00FF66" />
              <Text style={styles.accordionTitle}>{"Ligalarda Homiy Ko'rinishi"}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.accordionSubText, showLeagueSettings && { color: '#00FF66' }]}>
                {showLeagueSettings ? 'Yopish' : 'Ochish'}
              </Text>
              <Ionicons
                name={showLeagueSettings ? "chevron-up" : "chevron-down"}
                size={18}
                color={showLeagueSettings ? "#00FF66" : "#94A3B8"}
              />
            </View>
          </TouchableOpacity>

          {showLeagueSettings && (
            <View style={styles.accordionBody}>
              <Text style={styles.leagueTipText}>
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
                        isShow && { backgroundColor: 'rgba(0, 255, 102, 0.08)', borderColor: 'rgba(0, 255, 102, 0.4)' },
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
                        <Text style={styles.leagueRowName}>{league.name}</Text>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[styles.leagueStatusText, { color: isShow ? '#00FF66' : 'rgba(255,255,255,0.4)' }]}>
                          {isShow ? "YONIQLIK" : "O'CHIQ"}
                        </Text>
                        <Switch
                          value={isShow}
                          onValueChange={() => toggleLeagueSponsors(league)}
                          trackColor={{ false: '#334155', true: '#059669' }}
                          thumbColor={isShow ? '#00FF66' : '#94A3B8'}
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
      <View style={styles.sectionAccordionCard}>
        <TouchableOpacity
          style={styles.accordionHeaderBtn}
          activeOpacity={0.8}
          onPress={() => setShowSponsorsSection(!showSponsorsSection)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="images" size={20} color="#00FF66" />
            <Text style={styles.accordionTitle}>{`Homiylar Ro'yxati (${sponsors.length}ta homiy)`}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.accordionSubText, showSponsorsSection && { color: '#00FF66' }]}>
              {showSponsorsSection ? 'Yopish' : 'Ochish'}
            </Text>
            <Ionicons
              name={showSponsorsSection ? "chevron-up" : "chevron-down"}
              size={18}
              color={showSponsorsSection ? "#00FF66" : "#94A3B8"}
            />
          </View>
        </TouchableOpacity>

        {showSponsorsSection && (
          <View style={styles.accordionBody}>
            {/* MAIN SPONSOR DIRECT SELECT BOX */}
            <View style={styles.mainSponsorGoldCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.goldStarCircle}>
                  <Ionicons name="star" size={22} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.goldCardTitle}>{"Tashkilot Bosh Homiysi"}</Text>
                  <Text style={styles.goldCardSub}>{"Yuqori o'ng burchakda turadigan asosiy homiyni tanlang:"}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.mainPickerSelectBtn}
                activeOpacity={0.8}
                onPress={() => setShowMainPicker(true)}
              >
                {mainSponsor ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Image source={{ uri: mainSponsor.logo_url }} style={{ width: 24, height: 24, borderRadius: 12, resizeMode: 'contain' }} />
                    <Text style={styles.mainPickerText} numberOfLines={1}>
                      {`⭐ ${mainSponsor.name || 'Homiy'} (Bosh Homiy)`}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.mainPickerText}>{"-- Bosh homiy yo'q (Tanlanmagan) --"}</Text>
                )}
                <Ionicons name="chevron-down" size={18} color="#F59E0B" />
              </TouchableOpacity>
            </View>

            {/* UPLOAD SPONSOR LOGO BUTTON */}
            <TouchableOpacity
              style={[styles.uploadBtn, uploading && { opacity: 0.6 }]}
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
                  <View key={k} style={styles.sponsorCardSkeleton}>
                    <SkeletonItem style={{ width: '100%', height: 100, borderRadius: 12 }} />
                    <SkeletonItem style={{ width: 100, height: 14, borderRadius: 4, marginTop: 10 }} />
                  </View>
                ))}
              </View>
            ) : sponsors.length === 0 ? (
              <View style={styles.emptySponsorsBox}>
                <Ionicons name="sparkles-outline" size={42} color="#00FF66" />
                <Text style={styles.emptySponsorsText}>
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
                        isMain && styles.sponsorCardMain,
                        isSelected && !isMain && styles.sponsorCardSelected,
                      ]}
                    >
                      <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
                      {/* Top Status Badge */}
                      <View style={{ width: '100%', alignItems: 'center' }}>
                        {isMain ? (
                          <View style={styles.mainSponsorBadge}>
                            <Ionicons name="star" size={12} color="#000000" />
                            <Text style={styles.mainSponsorBadgeText}>{"BOSH HOMIY"}</Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.statusBadge,
                              isSelected ? styles.statusBadgeActive : styles.statusBadgeInactive,
                            ]}
                          >
                            <Ionicons
                              name={isSelected ? "checkmark-circle" : "close-circle"}
                              size={12}
                              color={isSelected ? "#00FF66" : "#EF4444"}
                            />
                            <Text style={[styles.statusBadgeText, { color: isSelected ? '#00FF66' : '#EF4444' }]}>
                              {isSelected ? "AKTIV" : "NOFAOL"}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Centered Sponsor Logo Image */}
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={styles.logoImgContainer}
                        onPress={() => toggleSelectSponsor(sponsor)}
                      >
                        <Image source={{ uri: sponsor.logo_url }} style={styles.sponsorLogoImg} />
                      </TouchableOpacity>

                      {/* Sponsor Name */}
                      <Text style={styles.sponsorNameTag} numberOfLines={1}>
                        {sponsor.name && !sponsor.name.startsWith('sponsor_') ? sponsor.name : 'Homiy logotipi'}
                      </Text>

                      {/* Bottom Action Buttons in 1 single row */}
                      <View style={styles.sponsorCardFooter}>
                        <TouchableOpacity
                          style={[styles.btnActionSmall, isMain && styles.btnActionSmallMain]}
                          onPress={() => handleSetMainSponsor(sponsor)}
                        >
                          <Ionicons name="star" size={14} color={isMain ? "#000000" : "#F59E0B"} />
                          <Text style={[styles.btnActionTextSmall, isMain && { color: '#000000' }]} numberOfLines={1}>
                            {isMain ? "Bosh Homiy" : "Bosh Homiy Qilish"}
                          </Text>
                        </TouchableOpacity>

                        {!isMain && (
                          <TouchableOpacity
                            style={[styles.btnActionSmall, isSelected && styles.btnActionSmallActive]}
                            onPress={() => toggleSelectSponsor(sponsor)}
                          >
                            <Ionicons
                              name={isSelected ? "eye" : "eye-off"}
                              size={14}
                              color={isSelected ? "#00FF66" : "#94A3B8"}
                            />
                            <Text style={[styles.btnActionTextSmall, isSelected && { color: '#00FF66' }]} numberOfLines={1}>
                              {isSelected ? "Aktiv" : "Nofaol"}
                            </Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={styles.btnDeleteSmall}
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
          <View style={[styles.modalCard, { maxWidth: 420, maxHeight: '80%' }]}>
            <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="star" size={20} color="#F59E0B" />
                <Text style={styles.modalTitle}>{"Bosh Homiyni Tanlang"}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowMainPicker(false)}>
                <Ionicons name="close" size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: 10 }}>
              {/* Option 0: None */}
              <TouchableOpacity
                style={styles.pickerOptionRow}
                onPress={() => {
                  if (mainSponsor) handleSetMainSponsor(mainSponsor);
                  setShowMainPicker(false);
                }}
              >
                <Ionicons name="close-circle-outline" size={22} color="#94A3B8" style={{ marginRight: 12 }} />
                <Text style={styles.pickerOptionText}>{"-- Bosh homiy yo'q (Tanlanmagan) --"}</Text>
                {!mainSponsor && <Ionicons name="checkmark" size={18} color="#00FF66" style={{ marginLeft: 'auto' }} />}
              </TouchableOpacity>

              {sponsors.map((s) => {
                const isSelected = mainSponsor?.id === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.pickerOptionRow}
                    onPress={() => {
                      handleSetMainSponsor(s);
                      setShowMainPicker(false);
                    }}
                  >
                    <Image source={{ uri: s.logo_url }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 12, resizeMode: 'contain' }} />
                    <Text style={[styles.pickerOptionText, isSelected && { color: '#F59E0B', fontWeight: '900' }]}>
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
          <View style={[styles.modalCard, { maxWidth: 400, padding: 22, alignItems: 'center' }]}>
            <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.deleteIconBg}>
              <Ionicons name="trash-outline" size={32} color="#EF4444" />
            </View>
            <Text style={styles.deleteTitle}>{"Homiyni O'chirish"}</Text>
            <Text style={styles.deleteSub}>
              {"Haqiqatan ham ushbu homiy logotipini bazadan va xotiradan o'chirib tashlamoqchimisiz?"}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginTop: 20 }}>
              <TouchableOpacity style={[styles.modalCancelBtn, { flex: 1 }]} onPress={() => setSponsorToDelete(null)}>
                <Text style={styles.modalCancelText}>{"Bekor qilish"}</Text>
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
  sectionAccordionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    marginBottom: 16,
  },
  accordionHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
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
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
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
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
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
