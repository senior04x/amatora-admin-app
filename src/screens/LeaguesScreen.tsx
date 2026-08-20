import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  ImageBackground,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  RefreshControl,
  Dimensions,
  Animated,
  PanResponder,
  Vibration,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';

const uriToArrayBuffer = async (uri: string): Promise<ArrayBuffer> => {
  // 1. Direct fetch arrayBuffer (Fastest & SDK 54 recommended)
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const buffer = await new Response(blob).arrayBuffer();
    if (buffer && buffer.byteLength > 0) {
      return buffer;
    }
  } catch (e) {
    // Proceed to fallback
  }

  // 2. XHR Fallback for local files on Android/iOS
  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = function () {
        if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
          resolve(xhr.response);
        } else {
          reject(new Error(`XHR Status ${xhr.status}`));
        }
      };
      xhr.onerror = function () {
        reject(new Error('XHR error'));
      };
      xhr.responseType = 'arraybuffer';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
  } catch (xhrErr) {
    // 3. expo-file-system/legacy fallback
    try {
      const FileSystemLegacy = require('expo-file-system/legacy');
      const base64 = await FileSystemLegacy.readAsStringAsync(uri, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });
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
      const uint8Arr = decodeBase64(base64);
      return uint8Arr.buffer as ArrayBuffer;
    } catch (legacyErr) {
      throw new Error(`Faylni o'qishda xatolik yuz berdi`);
    }
  }
};

// Reliable cross-platform helper to upload local file URI to Supabase Storage as a public HTTP URL
const uploadFileToSupabase = async (
  dbClient: any,
  bucket: string,
  filePath: string,
  localUri: string,
  mimeType: string
): Promise<string | null> => {
  try {
    if (!localUri || (!localUri.startsWith('file:') && !localUri.startsWith('content:') && !localUri.startsWith('ph:'))) {
      return localUri; // Already a remote public HTTP/HTTPS URL
    }

    const arrayBuffer = await uriToArrayBuffer(localUri);

    // Primary bucket is 'player-photos' (existing bucket in Supabase schema)
    const targetBucket = bucket || 'player-photos';
    let { error: uploadError } = await dbClient.storage
      .from(targetBucket)
      .upload(filePath, arrayBuffer, { contentType: mimeType, upsert: true });

    let activeBucket = targetBucket;

    // Fallback if initial bucket fails or doesn't exist
    if (uploadError && targetBucket !== 'player-photos') {
      console.warn(`Bucket '${targetBucket}' error, trying 'player-photos'...`, uploadError);
      const retry = await dbClient.storage
        .from('player-photos')
        .upload(filePath, arrayBuffer, { contentType: mimeType, upsert: true });
      if (!retry.error) {
        uploadError = null;
        activeBucket = 'player-photos';
      }
    }

    if (uploadError && activeBucket !== 'sponsors') {
      console.warn(`Trying 'sponsors' bucket fallback...`, uploadError);
      const retrySponsors = await dbClient.storage
        .from('sponsors')
        .upload(filePath, arrayBuffer, { contentType: mimeType, upsert: true });
      if (!retrySponsors.error) {
        uploadError = null;
        activeBucket = 'sponsors';
      }
    }

    if (uploadError) {
      console.error('Supabase storage upload failed:', uploadError);
      return null;
    }

    const { data: urlData } = dbClient.storage.from(activeBucket).getPublicUrl(filePath);
    return urlData?.publicUrl || null;
  } catch (err) {
    console.error('uploadFileToSupabase error:', err);
    return null;
  }
};

const SCREEN_WIDTH = Dimensions.get('window').width;

// Telegram-Style Swipeable League Card (Smooth & Instant, No Vibration)
const SwipeableLeagueCard = ({
  item,
  isOpen,
  setIsSwiping,
  onSwipeOpen,
  onSwipeClose,
  onDelete,
  renderContent,
}: any) => {
  const panX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isOpen) {
      Animated.spring(panX, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();
    }
  }, [isOpen]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        Math.abs(gs.dx) > 12 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderGrant: () => {
        setIsSwiping(true);
        onSwipeOpen();
      },
      onPanResponderMove: (_, gs) => {
        if (gs.dx < 0) {
          // Clamp swipe to max -90px (width of red delete button)
          panX.setValue(Math.max(gs.dx, -90));
        } else {
          panX.setValue(0);
        }
      },
      onPanResponderRelease: (_, gs) => {
        setIsSwiping(false);
        if (gs.dx < -30) {
          // Snap open to show red delete button (-90px)
          Animated.spring(panX, { toValue: -90, useNativeDriver: true, bounciness: 3 }).start();
        } else {
          // Reset closed (0px)
          Animated.spring(panX, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start(() => onSwipeClose());
        }
      },
      onPanResponderTerminate: () => {
        setIsSwiping(false);
        Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start(() => onSwipeClose());
      },
    })
  ).current;

  const resetSwipe = () => {
    Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start(() => onSwipeClose());
  };

  return (
    <View style={swipeStyles.container}>
      {/* Red Delete Action behind card */}
      <TouchableOpacity style={swipeStyles.deleteBack} onPress={() => { resetSwipe(); onDelete(); }} activeOpacity={0.8}>
        <Ionicons name="trash-bin" size={22} color="#FFFFFF" />
        <Text style={swipeStyles.deleteText}>{"O'chirish"}</Text>
      </TouchableOpacity>

      {/* Foreground Card */}
      <Animated.View style={[swipeStyles.foreground, { transform: [{ translateX: panX }] }]} {...panResponder.panHandlers}>
        {renderContent(item)}
      </Animated.View>
    </View>
  );
};

const swipeStyles = StyleSheet.create({
  container: {
    position: 'relative',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#FF3B30',
  },
  deleteBack: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 90,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    zIndex: 1,
  },
  deleteText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  foreground: {
    zIndex: 2,
    borderRadius: 18,
  },
});

// Animated Skeleton Loader Component for Leagues Screen
const LeagueSkeletonLoader = () => {
  const opacityAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, { toValue: 0.7, duration: 750, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0.3, duration: 750, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <ScrollView contentContainerStyle={s.gridContent} showsVerticalScrollIndicator={false}>
      {[1, 2, 3].map((key) => (
        <Animated.View key={key} style={[s.skeletonCard, { opacity: opacityAnim }]}>
          <View style={s.skeletonTopRow}>
            <View style={s.skeletonBgBtn} />
          </View>
          <View style={s.skeletonCenter}>
            <View style={s.skeletonLogo} />
            <View style={s.skeletonTitle} />
            <View style={s.skeletonBadgesRow}>
              <View style={s.skeletonBadge} />
              <View style={s.skeletonBadge} />
            </View>
          </View>
          <View style={s.skeletonActionTabs}>
            <View style={s.skeletonTab} />
            <View style={s.skeletonTab} />
          </View>
        </Animated.View>
      ))}
    </ScrollView>
  );
};

// Leagues Screen Component
export const LeaguesScreen: React.FC = () => {
  const { orgId, userRole, collabLeagueIds } = useOrg();
  const isReadOnlyUser = userRole === 'user';
  const [leagues, setLeagues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingLeague, setEditingLeague] = useState<any>(null);
  const [formName, setFormName] = useState('');
  const [formLogo, setFormLogo] = useState('');
  const [formBgImage, setFormBgImage] = useState('');
  const [formSeason, setFormSeason] = useState('2026/2027');
  const [formDuration, setFormDuration] = useState<number>(60);
  const [formHalves, setFormHalves] = useState('2');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'archived'>('active');
  const [formSaving, setFormSaving] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  // 100% Glassmorphism Custom Alert state
  const [glassAlert, setGlassAlert] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon?: string;
    onClose?: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
  });

  const showSuccessGlassAlert = (title: string, message: string, onClose?: () => void) => {
    setGlassAlert({
      visible: true,
      title,
      message,
      icon: 'checkmark-circle-outline',
      onClose,
    });
  };

  // Collab Modal state
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [selectedLeagueForCollab, setSelectedLeagueForCollab] = useState<any>(null);
  const [targetOrgEmail, setTargetOrgEmail] = useState('');
  const [sendingCollab, setSendingCollab] = useState(false);

  const handleOpenCollabModal = (league: any) => {
    if (isReadOnlyUser) return;
    setSelectedLeagueForCollab(league);
    setTargetOrgEmail('');
    setShowCollabModal(true);
  };

  const handleSendCollab = async () => {
    const emailToSearch = targetOrgEmail.trim().toLowerCase();
    if (!selectedLeagueForCollab || !emailToSearch) {
      Alert.alert('Xatolik', 'Tashkilot admin email manzilini kiriting');
      return;
    }
    setSendingCollab(true);
    try {
      const dbClient = supabase;
      let foundOrgId = null;
      let foundOrgName = '';

      // 1. Search in admin_users
      const { data: adminUser } = await dbClient
        .from('admin_users')
        .select('organization_id, email')
        .ilike('email', emailToSearch)
        .maybeSingle();

      if (adminUser?.organization_id) {
        foundOrgId = adminUser.organization_id;
      } else {
        // 2. Search in organizations
        const { data: orgByEmail } = await dbClient
          .from('organizations')
          .select('id, name')
          .ilike('admin_email', emailToSearch)
          .maybeSingle();

        if (orgByEmail?.id) {
          foundOrgId = orgByEmail.id;
          foundOrgName = orgByEmail.name;
        }
      }

      if (!foundOrgId) {
        Alert.alert('Xatolik', `"${targetOrgEmail}" e-mail manzili bo'yicha hech qanday tashkilot topilmadi! Email manzilini to'g'ri kiritganingizga ishonch hosil qiling.`);
        return;
      }

      if (Number(foundOrgId) === Number(orgId)) {
        Alert.alert('Xatolik', "O'z tashkilotingizga sherikchilik taklifini yubora olmaysiz!");
        return;
      }

      if (!foundOrgName) {
        const { data: orgObj } = await dbClient
          .from('organizations')
          .select('name')
          .eq('id', foundOrgId)
          .maybeSingle();
        foundOrgName = orgObj?.name || 'Tashkilot';
      }

      // Check existing collab
      const { data: existingCollab } = await dbClient
        .from('league_collabs')
        .select('id, status')
        .eq('league_id', selectedLeagueForCollab.id)
        .or(`and(sender_org_id.eq.${orgId},receiver_org_id.eq.${foundOrgId}),and(sender_org_id.eq.${foundOrgId},receiver_org_id.eq.${orgId})`)
        .maybeSingle();

      if (existingCollab) {
        const statusText = existingCollab.status === 'accepted' ? 'qabul qilingan' : 'kutilayotgan takliflar ro\'yxatida mavjud';
        Alert.alert('Xatolik', `"${foundOrgName}" tashkilotiga ushbu liga bo'yicha sherikchilik taklifi allaqachon ${statusText}!`);
        return;
      }

      // Send request
      const { error } = await dbClient.from('league_collabs').insert({
        league_id: selectedLeagueForCollab.id,
        sender_org_id: orgId,
        receiver_org_id: foundOrgId,
        status: 'pending',
      });

      if (error) throw error;

      showSuccessGlassAlert('Muvaffaqiyatli yuborildi', `"${selectedLeagueForCollab.name}" ligasi bo'yicha sherikchilik taklifi "${foundOrgName}" (${targetOrgEmail}) tashkilotiga muvaffaqiyatli yuborildi!`);
      setShowCollabModal(false);
      setSelectedLeagueForCollab(null);
      setTargetOrgEmail('');
      fetchLeagues();
    } catch (err: any) {
      console.error('Send collab error:', err);
      Alert.alert('Xatolik', 'Taklif yuborishda xatolik: ' + (err.message || ''));
    } finally {
      setSendingCollab(false);
    }
  };

  useEffect(() => {
    fetchLeagues();
  }, [orgId]);

  const fetchLeagues = async () => {
    setLoading(true);
    try {
      const dbClient = supabase;
      let query = dbClient.from('leagues').select('*').order('created_at', { ascending: false });
      if (orgId) {
        if (collabLeagueIds && collabLeagueIds.length > 0) {
          query = query.or(`organization_id.eq.${orgId},id.in.(${collabLeagueIds.join(',')})`);
        } else {
          query = query.eq('organization_id', orgId);
        }
      }
      const { data: leaguesData, error } = await query;
      if (error) console.error(error);

      if (leaguesData && leaguesData.length > 0) {
        // 1. Fetch LEAGUE_BG_%, LEAGUE_DURATION_%, LEAGUE_START_DATE_%, LEAGUE_END_DATE_% from sponsors table
        const { data: dateSponsors } = await dbClient
          .from('sponsors')
          .select('name, logo_url')
          .or('name.like.LEAGUE_BG_%,name.like.LEAGUE_DURATION_%,name.like.LEAGUE_START_DATE_%,name.like.LEAGUE_END_DATE_%');

        const bgMap: any = {};
        const durationMap: any = {};
        const startMap: any = {};
        const endMap: any = {};

        if (dateSponsors) {
          dateSponsors.forEach((s: any) => {
            if (s.name.startsWith('LEAGUE_BG_')) {
              const lId = s.name.replace('LEAGUE_BG_', '');
              bgMap[lId] = s.logo_url;
            } else if (s.name.startsWith('LEAGUE_DURATION_')) {
              const lId = s.name.replace('LEAGUE_DURATION_', '');
              durationMap[lId] = parseInt(s.logo_url) || 60;
            } else if (s.name.startsWith('LEAGUE_START_DATE_')) {
              const lId = s.name.replace('LEAGUE_START_DATE_', '');
              startMap[lId] = s.logo_url;
            } else if (s.name.startsWith('LEAGUE_END_DATE_')) {
              const lId = s.name.replace('LEAGUE_END_DATE_', '');
              endMap[lId] = s.logo_url;
            }
          });
        }

        // 2. Fetch league_collabs and partner organizations
        let collabList: any[] = [];
        try {
          const { data: cData } = await dbClient
            .from('league_collabs')
            .select('*, sender_org:organizations!sender_org_id(id, name, logo_url), receiver_org:organizations!receiver_org_id(id, name, logo_url)');
          if (cData) {
            collabList = cData;
          } else {
            const { data: plainC } = await dbClient.from('league_collabs').select('*');
            if (plainC && plainC.length > 0) {
              const { data: orgs } = await dbClient.from('organizations').select('id, name, logo_url');
              const orgMap: any = {};
              (orgs || []).forEach((o: any) => { orgMap[o.id] = o; });
              collabList = plainC.map((c: any) => ({
                ...c,
                sender_org: orgMap[c.sender_org_id],
                receiver_org: orgMap[c.receiver_org_id],
              }));
            }
          }
        } catch (e) {
          try {
            const { data: plainC } = await dbClient.from('league_collabs').select('*');
            if (plainC && plainC.length > 0) {
              const { data: orgs } = await dbClient.from('organizations').select('id, name, logo_url');
              const orgMap: any = {};
              (orgs || []).forEach((o: any) => { orgMap[o.id] = o; });
              collabList = plainC.map((c: any) => ({
                ...c,
                sender_org: orgMap[c.sender_org_id],
                receiver_org: orgMap[c.receiver_org_id],
              }));
            }
          } catch (err) {}
        }

        const collabMap: Record<string | number, any[]> = {};
        collabList.forEach((c: any) => {
          if (!collabMap[c.league_id]) collabMap[c.league_id] = [];
          collabMap[c.league_id].push(c);
        });

        const merged = leaguesData.map((l: any) => ({
          ...l,
          bg_image: l.bg_image || l.export_bg_url || bgMap[l.id] || bgMap[String(l.id)] || null,
          match_duration: l.match_duration || durationMap[l.id] || durationMap[String(l.id)] || 60,
          start_date: l.start_date || startMap[l.id] || startMap[String(l.id)] || '',
          end_date: l.end_date || endMap[l.id] || endMap[String(l.id)] || '',
          collabs: collabMap[l.id] || collabMap[String(l.id)] || [],
        }));

        setLeagues(merged);
      } else {
        setLeagues([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLeagues();
  }, [orgId]);

  // Create / Update League (1-to-1 Match with Admin Panel DB Logic)
  const handleSaveLeague = async () => {
    if (isReadOnlyUser) return;
    if (!formName.trim()) {
      Alert.alert('Xatolik', 'Liga nomini kiriting');
      return;
    }
    setFormSaving(true);
    try {
      const dbClient = supabase;
      let finalLogoUrl = formLogo;
      let finalBgUrl = formBgImage;

      // 1. Upload Logo if local URI selected in form
      if (formLogo && (formLogo.startsWith('file:') || formLogo.startsWith('content:') || formLogo.startsWith('ph:'))) {
        const fileExt = formLogo.split('.').pop() || 'png';
        const fileName = `league_logo_${Date.now()}.${fileExt}`;
        const filePath = `league-logos/${fileName}`;
        const mimeType = `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;
        const uploadedLogo = await uploadFileToSupabase(dbClient, 'player-photos', filePath, formLogo, mimeType);
        if (uploadedLogo) finalLogoUrl = uploadedLogo;
      }

      // 2. Upload Bg Image if local URI selected in form
      if (formBgImage && (formBgImage.startsWith('file:') || formBgImage.startsWith('content:') || formBgImage.startsWith('ph:'))) {
        const fileExt = formBgImage.split('.').pop() || 'png';
        const fileName = `league_bg_${Date.now()}.${fileExt}`;
        const filePath = `league-backgrounds/${fileName}`;
        const mimeType = `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;
        const uploadedBg = await uploadFileToSupabase(dbClient, 'player-photos', filePath, formBgImage, mimeType);
        if (uploadedBg) finalBgUrl = uploadedBg;
      }

      const safePayload: any = {
        name: formName.trim(),
        logo_url: finalLogoUrl || null,
        export_bg_url: finalBgUrl || null,
      };
      if (orgId) safePayload.organization_id = orgId;

      const fullPayload: any = {
        ...safePayload,
        season: formSeason.trim() || '2026/2027',
        match_duration: formDuration,
        half_count: parseInt(formHalves) || 2,
        start_date: formStartDate ? formStartDate : null,
        end_date: formEndDate ? formEndDate : null,
        status: formStatus,
        bg_image: finalBgUrl || null,
        export_bg_url: finalBgUrl || null,
      };

      let targetId = editingLeague?.id;

      if (editingLeague) {
        // Try update fullPayload, fallback to safePayload
        try {
          const { error: updateErr } = await dbClient.from('leagues').update(fullPayload).eq('id', targetId);
          if (updateErr) throw updateErr;
        } catch (e) {
          await dbClient.from('leagues').update(safePayload).eq('id', targetId);
        }
      } else {
        // Try insert fullPayload, fallback to safePayload
        try {
          const { data: newL, error: insErr } = await dbClient.from('leagues').insert(fullPayload).select().single();
          if (insErr) throw insErr;
          if (newL) targetId = newL.id;
        } catch (e) {
          const { data: newL } = await dbClient.from('leagues').insert(safePayload).select().single();
          if (newL) targetId = newL.id;
        }
      }

      // 3. Sync metadata to sponsors table (LEAGUE_BG_, LEAGUE_DURATION_, LEAGUE_START_DATE_)
      if (targetId) {
        try {
          // Duration key
          const durKey = `LEAGUE_DURATION_${targetId}`;
          const { data: exDur } = await dbClient.from('sponsors').select('id').eq('name', durKey).maybeSingle();
          if (exDur) {
            await dbClient.from('sponsors').update({ logo_url: String(formDuration) }).eq('id', exDur.id);
          } else {
            await dbClient.from('sponsors').insert({ name: durKey, logo_url: String(formDuration) });
          }

          // BG image key
          if (finalBgUrl) {
            const bgKey = `LEAGUE_BG_${targetId}`;
            const { data: exBg } = await dbClient.from('sponsors').select('id').eq('name', bgKey).maybeSingle();
            if (exBg) {
              await dbClient.from('sponsors').update({ logo_url: finalBgUrl }).eq('id', exBg.id);
            } else {
              await dbClient.from('sponsors').insert({ name: bgKey, logo_url: finalBgUrl });
            }
          }

          // Start date key
          if (formStartDate) {
            const startKey = `LEAGUE_START_DATE_${targetId}`;
            const { data: exStart } = await dbClient.from('sponsors').select('id').eq('name', startKey).maybeSingle();
            if (exStart) {
              await dbClient.from('sponsors').update({ logo_url: formStartDate }).eq('id', exStart.id);
            } else {
              await dbClient.from('sponsors').insert({ name: startKey, logo_url: formStartDate });
            }
          }

          // End date key
          if (formEndDate) {
            const endKey = `LEAGUE_END_DATE_${targetId}`;
            const { data: exEnd } = await dbClient.from('sponsors').select('id').eq('name', endKey).maybeSingle();
            if (exEnd) {
              await dbClient.from('sponsors').update({ logo_url: formEndDate }).eq('id', exEnd.id);
            } else {
              await dbClient.from('sponsors').insert({ name: endKey, logo_url: formEndDate });
            }
          }
        } catch (e) {}
      }

      setShowModal(false);
      resetForm();
      showSuccessGlassAlert(
        'Muvaffaqiyatli saqlandi',
        editingLeague
          ? `"${formName.trim()}" ligasi ma'lumotlari muvaffaqiyatli saqlandi!`
          : `"${formName.trim()}" ligasi muvaffaqiyatli yaratildi!`
      );
      await fetchLeagues();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Xatolik', 'Ligani saqlashda xatolik yuz berdi: ' + (e.message || ''));
    } finally {
      setFormSaving(false);
    }
  };

  // Delete League (deletes collabs, sponsors metadata, and leagues)
  const handleDeleteLeague = (league: any) => {
    Alert.alert(
      "Ligani o'chirish",
      `"${league.name}" ligasini o'chirishni xohlaysizmi? Bu amalni qaytarib bo'lmaydi.`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "O'chirish",
          style: 'destructive',
          onPress: async () => {
            try {
              const dbClient = supabase;
              const lId = league.id;
              // 1. Delete collabs
              await dbClient.from('league_collabs').delete().eq('league_id', lId);
              // 2. Delete metadata in sponsors table
              try {
                await dbClient.from('sponsors').delete().or(`name.eq.LEAGUE_BG_${lId},name.eq.LEAGUE_DURATION_${lId},name.eq.LEAGUE_START_DATE_${lId},name.eq.LEAGUE_END_DATE_${lId}`);
              } catch (e) {}
              // 3. Delete league
              await dbClient.from('leagues').delete().eq('id', lId);
              showSuccessGlassAlert('Muvaffaqiyatli o\'chirildi', `"${league.name}" ligasi muvaffaqiyatli o'chirildi!`);
              await fetchLeagues();
            } catch (e: any) {
              console.error(e);
              Alert.alert('Xatolik', 'Ligani o\'chirishda xatolik: ' + (e.message || ''));
            }
          },
        },
      ]
    );
  };

  // Disconnect / Delete Collab Connection
  const handleDisconnectCollab = (collabId: any) => {
    Alert.alert(
      "Collabni uzish",
      "Ushbu tashkilot bilan sherikchilikni uzishni xohlaysizmi?",
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "Uzish",
          style: 'destructive',
          onPress: async () => {
            try {
              const dbClient = supabase;
              const { error } = await dbClient.from('league_collabs').delete().eq('id', collabId);
              if (error) throw error;

              showSuccessGlassAlert("Collab uzildi", "Sherikchilik muvaffaqiyatli uzildi!");
              if (editingLeague) {
                const updatedCollabs = (editingLeague.collabs || []).filter((c: any) => c.id !== collabId);
                setEditingLeague({ ...editingLeague, collabs: updatedCollabs });
              }
              await fetchLeagues();
            } catch (e: any) {
              console.error(e);
              Alert.alert('Xatolik', 'Collabni uzishda xatolik: ' + (e.message || ''));
            }
          },
        },
      ]
    );
  };

  // Open Edit Modal
  const handleEditLeague = (league: any) => {
    if (isReadOnlyUser) return;
    setEditingLeague(league);
    setFormName(league.name || '');
    setFormLogo(league.logo_url || '');
    setFormBgImage(league.bg_image || '');
    setFormSeason(league.season || '2026/2027');
    setFormDuration(league.match_duration || 60);
    setFormHalves(String(league.half_count || 2));
    setFormStartDate(league.start_date || '');
    setFormEndDate(league.end_date || '');
    setFormStatus(league.status || 'active');
    setShowModal(true);
  };

  // Open Create Modal
  const handleCreateLeague = () => {
    if (isReadOnlyUser) return;
    resetForm();
    setShowModal(true);
  };

  const resetForm = () => {
    setEditingLeague(null);
    setFormName('');
    setFormLogo('');
    setFormBgImage('');
    setFormSeason('2026/2027');
    setFormDuration(60);
    setFormHalves('2');
    setFormStartDate('');
    setFormEndDate('');
    setFormStatus('active');
  };

  // Upload Background Image (Sync to all bg columns: export_bg_url, bg_image, schedule_banner_url, etc. and sponsors)
  const handleUploadBgImage = (league: any) => {
    if (isReadOnlyUser) return;
    requestAnimationFrame(async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 0.8,
          allowsEditing: false, // Crop completely disabled for instant performance
        });

        if (!result.canceled && result.assets[0]) {
          setUploadingLogoLeagueId(league.id);
          const uri = result.assets[0].uri;
          const cleanUri = uri.split('?')[0];
          const rawExt = cleanUri.split('.').pop()?.toLowerCase() || 'jpg';
          const fileExt = (rawExt === 'heic' || rawExt === 'heif') ? 'jpg' : rawExt;
          const fileName = `league_bg_${league.id}_${Date.now()}.${fileExt}`;
          const filePath = `league-backgrounds/${fileName}`;
          const mimeType = fileExt === 'png' ? 'image/png' : 'image/jpeg';

          const dbClient = supabase;
          const publicUrl = await uploadFileToSupabase(dbClient, 'player-photos', filePath, uri, mimeType);

          if (publicUrl) {
            // 1. Update export_bg_url on leagues table (guaranteed DB column matching Settings.jsx)
            const { error: bgErr } = await dbClient.from('leagues').update({ export_bg_url: publicUrl }).eq('id', league.id);
            if (bgErr) {
              console.warn('DB update export_bg_url warn:', bgErr);
            }

            // 2. Always sync sponsors table keys used by website (LEAGUE_BG_, BANNER_SCHEDULE_, BANNER_YT_)
            const keysToSync = [
              `LEAGUE_BG_${league.id}`,
              `BANNER_SCHEDULE_${league.organization_id || orgId}_${league.name}`,
              `BANNER_YT_${league.organization_id || orgId}_${league.name}`,
            ];

            for (const key of keysToSync) {
              try {
                const { data: exBg } = await dbClient.from('sponsors').select('id').eq('name', key).maybeSingle();
                if (exBg) {
                  await dbClient.from('sponsors').update({ logo_url: publicUrl }).eq('id', exBg.id);
                } else {
                  await dbClient.from('sponsors').insert({ name: key, logo_url: publicUrl });
                }
              } catch (e) {}
            }

            showSuccessGlassAlert('Orqa fon saqlandi', `"${league.name}" ligasi orqa fon rasmi muvaffaqiyatli saqlandi!`);
            await fetchLeagues();
          } else {
            Alert.alert('Xatolik', 'Orqa fon rasmini bazaga yuklashda xatolik yuz berdi. Internetni tekshiring.');
          }
        }
      } catch (e) {
        console.error(e);
        Alert.alert('Xatolik', 'Rasm yuklashda xatolik yuz berdi');
      } finally {
        setUploadingLogoLeagueId(null);
      }
    });
  };

  // Delete Background Image (Clears export_bg_url, bg_image, and sponsors LEAGUE_BG_)
  const handleDeleteBgImage = async (league: any) => {
    if (isReadOnlyUser) return;
    Alert.alert('Orqa fonni o\'chirish', 'Orqa fon rasmini o\'chirishni xohlaysizmi?', [
      { text: 'Yo\'q', style: 'cancel' },
      {
        text: 'Ha',
        style: 'destructive',
        onPress: async () => {
          try {
            const dbClient = supabase;
            try {
              await dbClient.from('leagues').update({
                export_bg_url: null,
                bg_image: null,
                schedule_banner_url: null,
                banner_url: null,
                yt_banner_url: null,
              }).eq('id', league.id);
            } catch (e) {
              await dbClient.from('leagues').update({ export_bg_url: null }).eq('id', league.id);
            }
            try {
              const bgKey = `LEAGUE_BG_${league.id}`;
              await dbClient.from('sponsors').delete().eq('name', bgKey);
            } catch (e) {}
            await fetchLeagues();
          } catch (e) {
            console.error(e);
          }
        },
      },
    ]);
  };

  // Inline logo uploading state
  const [uploadingLogoLeagueId, setUploadingLogoLeagueId] = useState<string | number | null>(null);

  // Upload Logo Image (Crop completely disabled + inline spinner loader + public HTTP URL)
  const handleUploadLogo = (league: any) => {
    if (isReadOnlyUser) return;
    requestAnimationFrame(async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 0.8,
          allowsEditing: false, // Crop completely disabled for instant performance
        });

        if (!result.canceled && result.assets[0]) {
          setUploadingLogoLeagueId(league.id); // Show loader only during upload
          const uri = result.assets[0].uri;
          const cleanUri = uri.split('?')[0];
          const rawExt = cleanUri.split('.').pop()?.toLowerCase() || 'png';
          const fileExt = (rawExt === 'heic' || rawExt === 'heif') ? 'png' : rawExt;
          const fileName = `league_logo_${league.id}_${Date.now()}.${fileExt}`;
          const filePath = `league-logos/${fileName}`;
          const mimeType = fileExt === 'png' ? 'image/png' : 'image/jpeg';

          const dbClient = supabase;
          const publicUrl = await uploadFileToSupabase(dbClient, 'player-photos', filePath, uri, mimeType);

          if (publicUrl) {
            await dbClient.from('leagues').update({ logo_url: publicUrl }).eq('id', league.id);
            showSuccessGlassAlert('Logo saqlandi', `"${league.name}" ligasi logosi muvaffaqiyatli saqlandi!`);
            await fetchLeagues();
          } else {
            Alert.alert('Xatolik', 'Logo rasmini bazaga yuklashda xatolik yuz berdi. Internetni tekshiring.');
          }
        }
      } catch (e) {
        console.error(e);
        Alert.alert('Xatolik', 'Logo yuklashda xatolik yuz berdi');
      } finally {
        setUploadingLogoLeagueId(null);
      }
    });
  };

  // Swipe-to-delete & scroll lock state
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);

  // Render League Card Content (no delete button — swipe to delete)
  const renderLeagueCardContent = (item: any) => {
    const duration = item.match_duration || 60;
    const halves = item.half_count || 2;
    const halfTime = Math.round(duration / halves);

    return (
      <View style={s.card}>
        <ImageBackground
          source={item.bg_image ? { uri: item.bg_image } : undefined}
          style={s.cardFullBg}
          imageStyle={s.cardFullBgImage}
          resizeMode="cover"
        >
          <View style={s.cardDarkOverlay}>
            {/* Top Row: Upload BG (Only for Admins) */}
            {!isReadOnlyUser && (
              <View style={s.cardTopRow}>
                <TouchableOpacity style={s.uploadBgBtn} onPress={() => handleUploadBgImage(item)} activeOpacity={0.8}>
                  <Ionicons name="cloud-upload-outline" size={13} color="rgba(255,255,255,0.9)" />
                  <Text style={s.uploadBgBtnText}>{"Bg image"}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Center Content */}
            <View style={s.cardCenterContent}>
              {uploadingLogoLeagueId === item.id ? (
                <View style={s.freeLogoWrap}>
                  <ActivityIndicator size="small" color="#00FF66" />
                  <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 4, fontWeight: '700' }}>{"Yuklanmoqda..."}</Text>
                </View>
              ) : (item.logo_url || item.logo || item.logoUrl) ? (
                <TouchableOpacity
                  disabled={isReadOnlyUser}
                  onPress={() => !isReadOnlyUser && handleUploadLogo(item)}
                  activeOpacity={isReadOnlyUser ? 1 : 0.8}
                  style={s.freeLogoWrap}
                >
                  <Image source={{ uri: item.logo_url || item.logo || item.logoUrl }} style={s.freeLogoImg} resizeMode="contain" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  disabled={isReadOnlyUser}
                  onPress={() => !isReadOnlyUser && handleUploadLogo(item)}
                  activeOpacity={isReadOnlyUser ? 1 : 0.8}
                  style={s.freeLogoWrap}
                >
                  <Ionicons name="trophy" size={38} color="#FFFFFF" />
                </TouchableOpacity>
              )}
              <Text style={s.cardTitle} numberOfLines={2}>{item.name}</Text>
              <View style={s.badgesRow}>
                <View style={s.badgeSeason}>
                  <Text style={s.badgeIcon}>{"📅"}</Text>
                  <Text style={s.badgeSeasonText}>{item.season || '2026/2027'}</Text>
                </View>
                <View style={s.badgeDuration}>
                  <Text style={s.badgeIcon}>{"⏱"}</Text>
                  <Text style={s.badgeDurationText}>{`${duration} daq (${halfTime}x${halves})`}</Text>
                </View>
              </View>
              {/* Collab Partners Row (Right below Season & Duration Badges) */}
              {item.collabs && item.collabs.length > 0 && (
                <View style={s.collabRow}>
                  {item.collabs.map((collab: any) => {
                    const isSender = Number(collab.sender_org_id) === Number(orgId);
                    const partnerOrg = isSender ? collab.receiver_org : collab.sender_org;
                    const partnerName = partnerOrg?.name || 'Hamkor Tashkilot';
                    const isAccepted = collab.status === 'accepted';

                    return (
                      <View key={collab.id} style={[s.collabGlassBadge, !isAccepted && s.collabGlassBadgePending]}>
                        {partnerOrg?.logo_url || partnerOrg?.logo ? (
                          <Image source={{ uri: partnerOrg.logo_url || partnerOrg.logo }} style={{ width: 14, height: 14, borderRadius: 7 }} resizeMode="contain" />
                        ) : (
                          <Ionicons
                            name={isAccepted ? "people-outline" : "paper-plane-outline"}
                            size={12}
                            color={isAccepted ? "#00FF66" : "rgba(255,255,255,0.8)"}
                          />
                        )}
                        <Text style={s.collabBadgeText} numberOfLines={1}>
                          {isAccepted ? `Hamkor: ${partnerName}` : `Taklif: ${partnerName} (kutilmoqda)`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Bottom: Action Tabs — Collab & Edit */}
            {!isReadOnlyUser && (
              <View style={s.actionTabs}>
                <TouchableOpacity style={s.actionTab} onPress={() => handleOpenCollabModal(item)} activeOpacity={0.7}>
                  <Ionicons name="paper-plane-outline" size={14} color="rgba(255,255,255,0.8)" />
                  <Text style={s.actionTabText}>{"Collab"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.actionTab} onPress={() => handleEditLeague(item)} activeOpacity={0.7}>
                  <Ionicons name="create-outline" size={16} color="rgba(255,255,255,0.8)" />
                  <Text style={s.actionTabText}>{"Tahrirlash"}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ImageBackground>
      </View>
    );
  };

  // Render each item wrapped in SwipeableLeagueCard
  const renderLeagueCard = ({ item }: { item: any }) => {
    if (isReadOnlyUser) {
      return renderLeagueCardContent(item);
    }
    return (
      <SwipeableLeagueCard
        item={item}
        isOpen={openSwipeId === String(item.id)}
        setIsSwiping={setIsSwiping}
        onSwipeOpen={() => setOpenSwipeId(String(item.id))}
        onSwipeClose={() => { if (openSwipeId === String(item.id)) setOpenSwipeId(null); }}
        onDelete={() => handleDeleteLeague(item)}
        renderContent={renderLeagueCardContent}
      />
    );
  };

  return (
    <View style={s.container}>
      {/* Page Header */}
      <View style={s.pageHeader}>
        <View style={s.pageHeaderLeft}>
          <Ionicons name="trophy-outline" size={22} color="#FFFFFF" />
          <Text style={s.pageTitle}>{"Tashkilot Ligalari Boshqaruvi"}</Text>
        </View>
      </View>

      <Text style={s.sectionLabel}>{`MAVJUD LIGALAR (${leagues.length})`}</Text>

      {loading ? (
        <LeagueSkeletonLoader />
      ) : leagues.length === 0 ? (
        <View style={s.emptyCard}>
          <Ionicons name="trophy-outline" size={48} color="rgba(255,255,255,0.15)" />
          <Text style={s.emptyTitle}>{"Hozircha ligalar mavjud emas"}</Text>
          <Text style={s.emptySub}>{"Yangi liga qo'shish uchun pastdagi tugmani bosing"}</Text>
        </View>
      ) : (
        <FlatList
          data={leagues}
          keyExtractor={(item) => item.id?.toString()}
          contentContainerStyle={s.gridContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!isSwiping}
          onScrollBeginDrag={() => {
            if (openSwipeId) setOpenSwipeId(null);
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00FF66" />}
          renderItem={renderLeagueCard}
          ListFooterComponent={
            !isReadOnlyUser ? (
              <TouchableOpacity style={s.addBtn} onPress={handleCreateLeague} activeOpacity={0.8}>
                <Ionicons name="add-circle" size={20} color="#000000" />
                <Text style={s.addBtnText}>{"Yangi Liga Qo'shish"}</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* If empty, still show add button */}
      {!loading && leagues.length === 0 && !isReadOnlyUser && (
        <TouchableOpacity style={s.addBtn} onPress={handleCreateLeague} activeOpacity={0.8}>
          <Ionicons name="add" size={20} color="#FFFFFF" />
          <Text style={s.addBtnText}>{"LIGA QO'SHISH"}</Text>
        </TouchableOpacity>
      )}

      {/* Create / Edit League Modal (1-to-1 Match with Admin Screenshot) */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            {/* Modal Header */}
            <View style={s.modalHeader}>
              <View style={s.modalHeaderTitleRow}>
                <Ionicons name="create-outline" size={18} color="#00AAFF" />
                <Text style={s.modalTitle} numberOfLines={1}>
                  {editingLeague ? `"${editingLeague.name}" Ligasini Tahrirlash` : "Yangi Liga Qo'shish"}
                </Text>
              </View>
              <TouchableOpacity style={s.modalClose} onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
              {/* Row 1: Liga Nomi & Liga Logosi */}
              <View style={s.formRow}>
                <View style={s.formHalf}>
                  <Text style={s.inputLabel}>{"LIGA NOMI"}</Text>
                  <TextInput
                    style={s.input}
                    value={formName}
                    onChangeText={setFormName}
                    placeholder="Pro liga"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                  />
                </View>
                <View style={s.formHalf}>
                  <Text style={s.inputLabel}>{"LIGA LOGOSI"}</Text>
                  <View style={s.logoUploadRow}>
                    {formLogo ? (
                      <View style={s.logoPreviewContainer}>
                        <Image source={{ uri: formLogo }} style={s.logoMiniPreview} resizeMode="contain" />
                        <TouchableOpacity style={s.logoDeleteBtn} onPress={() => setFormLogo('')} activeOpacity={0.7}>
                          <Ionicons name="trash-outline" size={14} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    <TouchableOpacity
                      style={s.logoPickBtn}
                      onPress={async () => {
                        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.8, allowsEditing: false });
                        if (!res.canceled && res.assets[0]) {
                          setFormLogo(res.assets[0].uri);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="cloud-upload-outline" size={15} color="#00AAFF" />
                      <Text style={s.logoPickBtnText} numberOfLines={1}>
                        {formLogo ? "Logo almashtirish" : "Logo yuklash"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Row 1.5: Liga Orqa Fon Rasmi (Bg Image) */}
              <View style={{ marginTop: 12 }}>
                <Text style={s.inputLabel}>{"LIGA ORQA FON RASMI (BG IMAGE)"}</Text>
                <View style={s.logoUploadRow}>
                  {formBgImage ? (
                    <View style={s.logoPreviewContainer}>
                      <Image source={{ uri: formBgImage }} style={s.logoMiniPreview} resizeMode="cover" />
                      <TouchableOpacity style={s.logoDeleteBtn} onPress={() => setFormBgImage('')} activeOpacity={0.7}>
                        <Ionicons name="trash-outline" size={14} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={s.logoPickBtn}
                    onPress={async () => {
                      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.8, allowsEditing: false });
                      if (!res.canceled && res.assets[0]) {
                        setFormBgImage(res.assets[0].uri);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="image-outline" size={15} color="#00FF66" />
                    <Text style={s.logoPickBtnText} numberOfLines={1}>
                      {formBgImage ? "Orqa fonni almashtirish" : "Orqa fon rasm yuklash"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Row 2: O'yin Davomiyligi & Boshlanish Sanasi */}
              <View style={s.formRow}>
                <View style={s.formHalf}>
                  <Text style={s.inputLabel}>{"O'YIN DAVOMIYLIGI"}</Text>
                  <TouchableOpacity
                    style={s.selectInput}
                    onPress={() => setShowDurationPicker(!showDurationPicker)}
                    activeOpacity={0.8}
                  >
                    <Text style={s.selectInputText}>{`${formDuration} daqiqa (${Math.round(formDuration / 2)} + ${Math.round(formDuration / 2)})`}</Text>
                    <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.5)" />
                  </TouchableOpacity>

                  {/* Dropdown Options */}
                  {showDurationPicker && (
                    <View style={s.dropdownList}>
                      {[90, 80, 70, 60, 50, 40, 30].map((dur) => (
                        <TouchableOpacity
                          key={dur}
                          style={[s.dropdownItem, formDuration === dur && s.dropdownItemActive]}
                          onPress={() => {
                            setFormDuration(dur);
                            setShowDurationPicker(false);
                          }}
                        >
                          <Text style={[s.dropdownItemText, formDuration === dur && s.dropdownItemTextActive]}>
                            {`${dur} daqiqa (${Math.round(dur / 2)} + ${Math.round(dur / 2)})`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                <View style={s.formHalf}>
                  <Text style={s.inputLabel}>{"BOSHLANISH SANASI"}</Text>
                  <View style={s.dateInputWrap}>
                    <TextInput
                      style={s.dateInput}
                      value={formStartDate}
                      onChangeText={setFormStartDate}
                      placeholder="mm/dd/yyyy"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                    />
                    <Ionicons name="calendar-outline" size={16} color="rgba(255,255,255,0.4)" style={s.calendarIcon} />
                  </View>
                </View>
              </View>

              {/* Row 3: Tugash Sanasi */}
              <View style={s.formRow}>
                <View style={s.formHalf}>
                  <Text style={s.inputLabel}>{"TUGASH SANASI"}</Text>
                  <View style={s.dateInputWrap}>
                    <TextInput
                      style={s.dateInput}
                      value={formEndDate}
                      onChangeText={setFormEndDate}
                      placeholder="mm/dd/yyyy"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                    />
                    <Ionicons name="calendar-outline" size={16} color="rgba(255,255,255,0.4)" style={s.calendarIcon} />
                  </View>
                </View>
                <View style={s.formHalf} />
              </View>

              {/* Row 4: Liga Holati */}
              <View style={{ marginTop: 12 }}>
                <Text style={s.inputLabel}>{"LIGA HOLATI"}</Text>
                <TouchableOpacity
                  style={s.selectInput}
                  onPress={() => setShowStatusPicker(!showStatusPicker)}
                  activeOpacity={0.8}
                >
                  <Text style={s.selectInputText}>
                    {formStatus === 'active' ? '🟢  FAOL MAVSUM' : '📦  YAKUNLANGAN'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.5)" />
                </TouchableOpacity>

                {showStatusPicker && (
                  <View style={s.dropdownList}>
                    <TouchableOpacity
                      style={[s.dropdownItem, formStatus === 'active' && s.dropdownItemActive]}
                      onPress={() => {
                        setFormStatus('active');
                        setShowStatusPicker(false);
                      }}
                    >
                      <Text style={s.dropdownItemText}>{"🟢  FAOL MAVSUM"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.dropdownItem, formStatus === 'archived' && s.dropdownItemActive]}
                      onPress={() => {
                        setFormStatus('archived');
                        setShowStatusPicker(false);
                      }}
                    >
                      <Text style={s.dropdownItemText}>{"📦  YAKUNLANGAN"}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Row 5: Collab / Co-host Boshqaruvi (Taklif yuborish, hamkorlar logosi va uzish) */}
              <View style={s.collabSectionBox}>
                <View style={s.collabSectionHeader}>
                  <Ionicons name="people-outline" size={16} color="#00FF66" />
                  <Text style={s.collabSectionTitle}>{"SHERIKCHILIK (COLLAB / CO-HOST)"}</Text>
                </View>

                {/* List of active collabs for this league */}
                {editingLeague?.collabs && editingLeague.collabs.length > 0 ? (
                  <View style={s.collabListInModal}>
                    {editingLeague.collabs.map((c: any) => {
                      const isSender = Number(c.sender_org_id) === Number(orgId);
                      const partnerOrg = isSender ? c.receiver_org : c.sender_org;
                      const partnerName = partnerOrg?.name || 'Hamkor Tashkilot';
                      const isAccepted = c.status === 'accepted';

                      return (
                        <View key={c.id} style={s.collabItemCard}>
                          <View style={s.collabItemLeft}>
                            {partnerOrg?.logo_url || partnerOrg?.logo ? (
                              <Image source={{ uri: partnerOrg.logo_url || partnerOrg.logo }} style={s.collabItemLogo} resizeMode="contain" />
                            ) : (
                              <View style={s.collabItemLogoFallback}>
                                <Ionicons name="business-outline" size={16} color="#00FF66" />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={s.collabItemName} numberOfLines={1}>{partnerName}</Text>
                              <Text style={[s.collabItemStatus, { color: isAccepted ? '#00FF66' : '#FBBF24' }]}>
                                {isAccepted ? '🟢 Hamkor (Co-host)' : '📩 Taklif kutilmoqda'}
                              </Text>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={s.disconnectCollabBtn}
                            onPress={() => handleDisconnectCollab(c.id)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="unlink-outline" size={14} color="#EF4444" />
                            <Text style={s.disconnectCollabBtnText}>{"Uzish"}</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={s.noCollabText}>{"Hozircha birorta tashkilot bilan sherikchilik o'rnatilmagan."}</Text>
                )}

                {/* Add new collab input */}
                <View style={s.addCollabBoxInModal}>
                  <Text style={s.inputLabel}>{"HAMKOR TASHKILOT E-MAIL MANZILI *"}</Text>
                  <View style={s.addCollabRowInModal}>
                    <TextInput
                      style={[s.input, { flex: 1 }]}
                      value={targetOrgEmail}
                      onChangeText={setTargetOrgEmail}
                      placeholder="admin@tashkilot.uz"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={s.sendCollabBtnInModal}
                      onPress={async () => {
                        if (!editingLeague) {
                          Alert.alert('Eslatma', 'Collab taklifini yuborish uchun avval ligani saqlang.');
                          return;
                        }
                        setSelectedLeagueForCollab(editingLeague);
                        await handleSendCollab();
                      }}
                      disabled={sendingCollab || !targetOrgEmail.trim()}
                      activeOpacity={0.8}
                    >
                      {sendingCollab ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <>
                          <Ionicons name="paper-plane-outline" size={14} color="#000" />
                          <Text style={s.sendCollabBtnText}>{"Taklif"}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Modal Actions matching Screenshot */}
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelSquareBtn} onPress={() => setShowModal(false)} activeOpacity={0.8}>
                <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>

              <TouchableOpacity style={s.saveFullBtn} onPress={handleSaveLeague} disabled={formSaving} activeOpacity={0.8}>
                {formSaving ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.saveFullBtnText}>{"Saqlash"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Collab Request Modal (1-to-1 Match with Web Admin) */}
      <Modal visible={showCollabModal} transparent animationType="fade" onRequestClose={() => setShowCollabModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View style={s.modalHeaderTitleRow}>
                <Ionicons name="paper-plane-outline" size={18} color="#00FF66" />
                <Text style={s.modalTitle} numberOfLines={1}>
                  {"Sherikchilik Taklifi Yuborish (Co-host)"}
                </Text>
              </View>
              <TouchableOpacity style={s.modalClose} onPress={() => setShowCollabModal(false)}>
                <Ionicons name="close" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <View style={s.modalBody}>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
                {`"${selectedLeagueForCollab?.name || 'Liga'}" ligasini birgalikda (co-host) olib borish uchun hamkor tashkilotning admin email manzilini kiriting:`}
              </Text>

              <Text style={s.inputLabel}>{"TASHKILOT ADMIN EMAIL MANZILI *"}</Text>
              <View style={s.dateInputWrap}>
                <TextInput
                  style={s.input}
                  value={targetOrgEmail}
                  onChangeText={setTargetOrgEmail}
                  placeholder="masalan: admin@tashkilot.uz"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelSquareBtn} onPress={() => setShowCollabModal(false)} activeOpacity={0.8}>
                <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>

              <TouchableOpacity style={s.saveFullBtn} onPress={handleSendCollab} disabled={sendingCollab || !targetOrgEmail.trim()} activeOpacity={0.8}>
                {sendingCollab ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.saveFullBtnText}>{"Taklifni Yuborish"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 100% Glassmorphism Alert Modal (Strictly Black & White) */}
      <Modal
        visible={glassAlert.visible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setGlassAlert(prev => ({ ...prev, visible: false }));
          if (glassAlert.onClose) glassAlert.onClose();
        }}
      >
        <View style={s.glassAlertOverlay}>
          <View style={s.glassAlertCard}>
            <View style={s.glassAlertIconBox}>
              <Ionicons name={(glassAlert.icon as any) || "checkmark-circle-outline"} size={34} color="#FFFFFF" />
            </View>
            <Text style={s.glassAlertTitle}>{glassAlert.title}</Text>
            <Text style={s.glassAlertMessage}>{glassAlert.message}</Text>
            <TouchableOpacity
              style={s.glassAlertBtn}
              onPress={() => {
                const cb = glassAlert.onClose;
                setGlassAlert(prev => ({ ...prev, visible: false }));
                if (cb) cb();
              }}
              activeOpacity={0.7}
            >
              <Text style={s.glassAlertBtnText}>{"Tushunarli"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 12,
  },

  /* Page Header */
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  pageHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pageTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 14,
  },

  /* Grid & Content */
  gridContent: {
    paddingBottom: 120,
    gap: 16,
  },

  /* League Card (1 Column / Full Width) */
  card: {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },

  /* Full Background Image */
  cardFullBg: {
    width: '100%',
    minHeight: 200,
    backgroundColor: 'rgba(6, 35, 84, 0.6)',
  },
  cardFullBgImage: {
    borderRadius: 18,
  },

  /* Dark Glass Overlay (covers entire card) */
  cardDarkOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    padding: 12,
    justifyContent: 'space-between',
  },

  /* Top Row: Upload BG & Delete BG */
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  /* Delete BG corner */
  deleteBgCorner: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Center Content */
  cardCenterContent: {
    alignItems: 'center',
    paddingVertical: 8,
  },

  /* Direct Free Floating Logo (No Wrapper Container Div) */
  freeLogoWrap: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    width: '90%',
    height: 95,
  },
  freeLogoImg: {
    width: '100%',
    height: '100%',
  },

  /* Upload BG Button */
  uploadBgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderStyle: 'dashed',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  uploadBgBtnText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 9,
    fontWeight: '700',
  },

  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  /* Badges Row */
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  badgeSeason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeSeasonText: {
    color: '#FCA5A5',
    fontSize: 9,
    fontWeight: '800',
  },
  badgeDuration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0, 255, 102, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeDurationText: {
    color: '#00FF66',
    fontSize: 9,
    fontWeight: '800',
  },
  badgeIcon: {
    fontSize: 9,
  },

  /* Collab Partners Row (Right below Season & Duration Badges) */
  collabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  collabGlassBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 102, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.35)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  collabGlassBadgePending: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  collabBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },

  /* Action Tabs (Transparent Container, Glassmorphic Buttons) */
  actionTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    marginTop: 10,
    gap: 8,
  },
  actionTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  actionTabText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },

  /* Add Button (Dark Colorless Glassmorphism) */
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(18, 18, 18, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 14,
    marginBottom: 24,
    marginHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  /* Skeleton Loader Styles */
  skeletonCard: {
    width: '100%',
    minHeight: 200,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  skeletonTopRow: {
    alignItems: 'flex-start',
  },
  skeletonBgBtn: {
    width: 80,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  skeletonCenter: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  skeletonLogo: {
    width: 100,
    height: 55,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  skeletonTitle: {
    width: '50%',
    height: 18,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  skeletonBadgesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  skeletonBadge: {
    width: 75,
    height: 18,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  skeletonActionTabs: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  skeletonTab: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },

  /* Loading & Empty */
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  emptyTitle: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 14,
  },
  emptySub: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },

  /* Modal (1-to-1 Match with Admin Screenshot) */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: '#0D1526',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  modalClose: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    padding: 16,
  },
  inputLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#151F32',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  formRow: {
    flexDirection: 'row',
    gap: 10,
  },
  formHalf: {
    flex: 1,
  },

  /* Logo Upload Row */
  logoUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  logoMiniPreview: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backgroundColor: '#000',
  },
  logoDeleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPickBtn: {
    flex: 1,
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 170, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 170, 255, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  logoPickBtnText: {
    color: '#00AAFF',
    fontSize: 11.5,
    fontWeight: '700',
  },

  /* Custom Select / Dropdown */
  selectInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#151F32',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectInputText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  dropdownList: {
    backgroundColor: '#1B273D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    marginTop: 4,
    overflow: 'hidden',
    elevation: 5,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(0, 255, 102, 0.12)',
  },
  dropdownItemText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    fontWeight: '600',
  },
  dropdownItemTextActive: {
    color: '#00FF66',
    fontWeight: '800',
  },

  /* Date Input */
  dateInputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  dateInput: {
    backgroundColor: '#151F32',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingRight: 32,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  calendarIcon: {
    position: 'absolute',
    right: 10,
  },

  /* Modal Actions Footer */
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  cancelSquareBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveFullBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#00FF66',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveFullBtnText: {
    color: '#000000',
    fontSize: 13.5,
    fontWeight: '900',
  },

  /* 100% Glassmorphism Alert Modal Styles (Strictly Black & White) */
  glassAlertOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  glassAlertCard: {
    width: '85%',
    maxWidth: 340,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
  glassAlertIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  glassAlertTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  glassAlertMessage: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 22,
  },
  glassAlertBtn: {
    width: '100%',
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glassAlertBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  /* Collab Section in Edit League Modal */
  collabSectionBox: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  collabSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  collabSectionTitle: {
    color: '#00FF66',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  collabListInModal: {
    gap: 8,
    marginBottom: 12,
  },
  collabItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  collabItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  collabItemLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  collabItemLogoFallback: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 255, 102, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collabItemName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  collabItemStatus: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  disconnectCollabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  disconnectCollabBtnText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
  noCollabText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  addCollabBoxInModal: {
    marginTop: 4,
  },
  addCollabRowInModal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  sendCollabBtnInModal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#00FF66',
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 42,
    justifyContent: 'center',
  },
  sendCollabBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
});
