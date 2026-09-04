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
  Platform,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { BlurView } from '../components/SafeBlurView';
import { getTournamentTeams } from '../utils/tournamentUtils';

const uriToArrayBuffer = async (uri: string): Promise<ArrayBuffer> => {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const buffer = await new Response(blob).arrayBuffer();
    if (buffer && buffer.byteLength > 0) {
      return buffer;
    }
  } catch (e) {}

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

const uploadFileToSupabase = async (
  bucket: string,
  filePath: string,
  localUri: string,
  mimeType: string
): Promise<string | null> => {
  try {
    if (!localUri || (!localUri.startsWith('file:') && !localUri.startsWith('content:') && !localUri.startsWith('ph:'))) {
      return localUri;
    }

    const arrayBuffer = await uriToArrayBuffer(localUri);
    const targetBucket = bucket || 'player-photos';
    let { error: uploadError } = await supabase.storage
      .from(targetBucket)
      .upload(filePath, arrayBuffer, { contentType: mimeType, upsert: true });

    let activeBucket = targetBucket;
    if (uploadError && targetBucket !== 'player-photos') {
      const retry = await supabase.storage
        .from('player-photos')
        .upload(filePath, arrayBuffer, { contentType: mimeType, upsert: true });
      if (!retry.error) {
        uploadError = null;
        activeBucket = 'player-photos';
      }
    }

    if (uploadError) {
      console.error('Supabase storage upload failed:', uploadError);
      return null;
    }

    const { data: urlData } = supabase.storage.from(activeBucket).getPublicUrl(filePath);
    return urlData?.publicUrl || null;
  } catch (err) {
    console.error('uploadFileToSupabase error:', err);
    return null;
  }
};

// Telegram-Style Swipeable Tournament Card (1:1 with LeaguesScreen's SwipeableLeagueCard)
const SwipeableTournamentCard = ({
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
          panX.setValue(Math.max(gs.dx, -90));
        } else {
          panX.setValue(0);
        }
      },
      onPanResponderRelease: (_, gs) => {
        setIsSwiping(false);
        if (gs.dx < -30) {
          Animated.spring(panX, { toValue: -90, useNativeDriver: true, bounciness: 3 }).start();
        } else {
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

  const handleAction = () => {
    resetSwipe();
    if (onDelete) onDelete();
  };

  return (
    <View style={tournSwipeStyles.container}>
      {/* Action behind card (Delete) */}
      <TouchableOpacity
        style={tournSwipeStyles.deleteBack}
        onPress={handleAction}
        activeOpacity={0.8}
      >
        <Ionicons name="trash-bin" size={22} color="#FFFFFF" />
        <Text style={tournSwipeStyles.deleteText}>{"O'chirish"}</Text>
      </TouchableOpacity>

      {/* Foreground Card */}
      <Animated.View style={[tournSwipeStyles.foreground, { transform: [{ translateX: panX }] }]} {...panResponder.panHandlers}>
        {renderContent(item)}
      </Animated.View>
    </View>
  );
};

const tournSwipeStyles = StyleSheet.create({
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

export const TournamentsScreen: React.FC<{ onGoBack?: () => void }> = ({ onGoBack }) => {
  const { orgId, userRole, showToast } = useOrg();
  const { colors, isDark } = useTheme();
  const isReadOnlyUser = userRole === 'user';

  const [tournaments, setTournaments] = useState<any[]>([]);
  const [tournamentLeagues, setTournamentLeagues] = useState<any[]>([]);
  const [allLeagues, setAllLeagues] = useState<any[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [incomingCollabs, setIncomingCollabs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Swipe-to-delete & scroll lock state (1:1 with LeaguesScreen)
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);

  // Tournament Create/Edit Modal
  const [showModal, setShowModal] = useState(false);
  const [editingTournament, setEditingTournament] = useState<any>(null);
  const [formName, setFormName] = useState('');
  const [formLogo, setFormLogo] = useState('');
  const [formBgImage, setFormBgImage] = useState('');
  const [formDuration, setFormDuration] = useState<number>(90);
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'archived'>('active');
  const [savingTournament, setSavingTournament] = useState(false);

  // Attach Leagues Modal
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [selectedTournForLeagues, setSelectedTournForLeagues] = useState<any>(null);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [savingLeagues, setSavingLeagues] = useState(false);

  // Co-host Modal
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [selectedTournForCollab, setSelectedTournForCollab] = useState<any>(null);
  const [targetOrgEmail, setTargetOrgEmail] = useState('');
  const [sendingCollab, setSendingCollab] = useState(false);
  const [tournCollabsList, setTournCollabsList] = useState<any[]>([]);

  const fetchTournamentsData = useCallback(async () => {
    if (!orgId) return;
    try {
      // 1. Fetch own tournaments
      const { data: ownTourns, error: ownErr } = await supabase
        .from('tournaments')
        .select('*')
        .eq('organization_id', orgId)
        .order('id', { ascending: true });

      if (ownErr && ownErr.code !== 'PGRST205') {
        console.warn('Error fetching own tournaments:', ownErr.message);
      }

      // 2. Fetch tournament collabs
      const { data: tournCollabs } = await supabase
        .from('tournament_cohosts')
        .select(`
          *,
          tournament:tournament_id (*),
          sender_org:sender_org_id (id, name, logo_url),
          receiver_org:receiver_org_id (id, name, logo_url)
        `)
        .or(`receiver_org_id.eq.${orgId},sender_org_id.eq.${orgId}`)
        .order('created_at', { ascending: false });

      if (tournCollabs) {
        setTournCollabsList(tournCollabs);
        setIncomingCollabs(
          tournCollabs.filter(
            (c: any) => Number(c.receiver_org_id) === Number(orgId) && c.status === 'pending'
          )
        );
      } else {
        setTournCollabsList([]);
        setIncomingCollabs([]);
      }

      // Merge own and accepted collab tournaments
      const acceptedCollabs = (tournCollabs || []).filter((c: any) => c.status === 'accepted');
      const collabTournaments = acceptedCollabs
        .map((c: any) => {
          if (!c.tournament) return null;
          return {
            ...c.tournament,
            isCollab: true,
            org1: c.sender_org,
            org2: c.receiver_org,
          };
        })
        .filter((t: any) => t && Number(t.organization_id) !== Number(orgId));

      const allTournMap = new Map();
      (ownTourns || []).forEach((t: any) => allTournMap.set(t.id, { ...t, isOwn: true }));
      collabTournaments.forEach((t: any) => {
        if (!allTournMap.has(t.id)) {
          allTournMap.set(t.id, { ...t, isOwn: false, isCollab: true });
        }
      });
      setTournaments(Array.from(allTournMap.values()));

      // 3. Fetch tournament leagues
      const { data: tLeagues } = await supabase
        .from('tournament_leagues')
        .select('*, league:league_id (id, name, logo_url)');
      setTournamentLeagues(tLeagues || []);

      // 4. Fetch available leagues for this org
      const { data: orgLeagues } = await supabase
        .from('leagues')
        .select('id, name, logo_url, organization_id')
        .order('name');
      setAllLeagues(orgLeagues || []);

      // 5. Fetch teams
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, name, league, organization_id');
      setAllTeams(teamsData || []);
    } catch (err) {
      console.error('Error fetching tournaments data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchTournamentsData();
  }, [fetchTournamentsData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTournamentsData();
  };

  // Create / Edit modal helpers
  const handleOpenCreateModal = () => {
    if (isReadOnlyUser) return;
    setEditingTournament(null);
    setFormName('');
    setFormLogo('');
    setFormBgImage('');
    setFormDuration(90);
    setFormStartDate('');
    setFormEndDate('');
    setFormDescription('');
    setFormStatus('active');
    setShowModal(true);
  };

  const handleOpenEditModal = (t: any) => {
    if (isReadOnlyUser) return;
    setEditingTournament(t);
    setFormName(t.name || '');
    setFormLogo(t.logo_url || '');
    setFormBgImage(t.export_bg_url || '');
    setFormDuration(t.match_duration || 90);
    setFormStartDate(t.start_date || '');
    setFormEndDate(t.end_date || '');
    setFormDescription(t.description || '');
    setFormStatus(t.status || 'active');
    setShowModal(true);
  };

  const handlePickLogo = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        setFormLogo(uri);
        if (showToast) showToast({ message: 'Rasm tanlandi, saqlashda yuklanadi', type: 'info' });
      }
    } catch (e) {}
  };

  const handlePickBgImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: 0.8,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        setFormBgImage(uri);
        if (showToast) showToast({ message: 'Fon rasmi tanlandi', type: 'info' });
      }
    } catch (e) {}
  };

  const handleSaveTournament = async () => {
    if (!formName.trim()) {
      Alert.alert('Xatolik', 'Turnir nomini kiriting');
      return;
    }
    setSavingTournament(true);

    try {
      let finalLogo = formLogo;
      if (formLogo && (formLogo.startsWith('file:') || formLogo.startsWith('content:'))) {
        const fileExt = formLogo.split('.').pop() || 'png';
        const fileName = `tourn_logo_${Date.now()}.${fileExt}`;
        const uploaded = await uploadFileToSupabase('player-photos', `tournaments/${fileName}`, formLogo, 'image/png');
        if (uploaded) finalLogo = uploaded;
      }

      let finalBg = formBgImage;
      if (formBgImage && (formBgImage.startsWith('file:') || formBgImage.startsWith('content:'))) {
        const fileExt = formBgImage.split('.').pop() || 'jpg';
        const fileName = `tourn_bg_${Date.now()}.${fileExt}`;
        const uploaded = await uploadFileToSupabase('player-photos', `tournaments/${fileName}`, formBgImage, 'image/jpeg');
        if (uploaded) finalBg = uploaded;
      }

      const payload = {
        name: formName.trim(),
        logo_url: finalLogo.trim() || null,
        export_bg_url: finalBg.trim() || null,
        start_date: formStartDate.trim() || null,
        end_date: formEndDate.trim() || null,
        description: formDescription.trim() || null,
        match_duration: Number(formDuration) || 90,
        status: formStatus,
      };

      if (editingTournament) {
        const { error } = await supabase
          .from('tournaments')
          .update(payload)
          .eq('id', editingTournament.id);
        if (error) throw error;
        if (showToast) showToast({ message: 'Turnir muvaffaqiyatli yangilandi ✓', type: 'success' });
      } else {
        const { error } = await supabase
          .from('tournaments')
          .insert([{ ...payload, organization_id: orgId }]);
        if (error) throw error;
        if (showToast) showToast({ message: 'Turnir muvaffaqiyatli yaratildi ✓', type: 'success' });
      }

      setShowModal(false);
      await fetchTournamentsData();
    } catch (err: any) {
      console.error('Error saving tournament:', err);
      Alert.alert('Xatolik', err.message || 'Turnirni saqlashda xatolik yuz berdi');
    } finally {
      setSavingTournament(false);
    }
  };

  const handleDeleteTournament = (t: any) => {
    if (isReadOnlyUser) return;
    Alert.alert(
      "Turnirni o'chirish",
      `"${t.name}" turnirini o'chirishni tasdiqlaysizmi? Unga bog'langan ligalar va o'yinlar ajratiladi.`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "O'chirish",
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('tournaments').delete().eq('id', t.id);
              if (error) throw error;
              if (showToast) showToast({ message: "Turnir o'chirildi ✓", type: 'info' });
              await fetchTournamentsData();
            } catch (err: any) {
              Alert.alert('Xatolik', err.message || "Turnirni o'chirishda xatolik");
            }
          },
        },
      ]
    );
  };

  // Attached Leagues Modal Handlers
  const handleOpenLeaguesModal = (t: any) => {
    setSelectedTournForLeagues(t);
    const linkedIds = tournamentLeagues
      .filter((tl: any) => Number(tl.tournament_id) === Number(t.id))
      .map((tl: any) => Number(tl.league_id));
    setSelectedLeagueIds(linkedIds);
    setShowLeaguesModal(true);
  };

  const toggleLeagueId = (id: number) => {
    setSelectedLeagueIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSaveTournamentLeagues = async () => {
    if (!selectedTournForLeagues) return;
    setSavingLeagues(true);
    try {
      const tournId = selectedTournForLeagues.id;
      // 1. Delete existing links
      await supabase.from('tournament_leagues').delete().eq('tournament_id', tournId);

      // 2. Insert selected
      if (selectedLeagueIds.length > 0) {
        const rows = selectedLeagueIds.map((lId) => ({
          tournament_id: tournId,
          league_id: lId,
        }));
        const { error } = await supabase.from('tournament_leagues').insert(rows);
        if (error) throw error;
      }

      if (showToast) showToast({ message: 'Ligalari muvaffaqiyatli saqlandi ✓', type: 'success' });
      setShowLeaguesModal(false);
      setSelectedTournForLeagues(null);
      await fetchTournamentsData();
    } catch (err: any) {
      Alert.alert('Xatolik', err.message || 'Ligalarni saqlashda xatolik yuz berdi');
    } finally {
      setSavingLeagues(false);
    }
  };

  // Co-host Modal Handlers
  const handleOpenCollabModal = (t: any) => {
    setSelectedTournForCollab(t);
    setTargetOrgEmail('');
    setShowCollabModal(true);
  };

  const handleSendCollabInvitation = async () => {
    const email = targetOrgEmail.trim().toLowerCase();
    if (!email || !selectedTournForCollab) {
      Alert.alert('Xatolik', 'Hamkor tashkilot admin email manzilini kiriting');
      return;
    }
    setSendingCollab(true);

    try {
      let targetOrgId = null;
      let targetOrgName = '';

      const { data: adminUser } = await supabase
        .from('admin_users')
        .select('organization_id, email')
        .ilike('email', email)
        .maybeSingle();

      if (adminUser?.organization_id) {
        targetOrgId = adminUser.organization_id;
      } else {
        const { data: orgObj } = await supabase
          .from('organizations')
          .select('id, name')
          .ilike('admin_email', email)
          .maybeSingle();
        if (orgObj?.id) {
          targetOrgId = orgObj.id;
          targetOrgName = orgObj.name;
        }
      }

      if (!targetOrgId) {
        Alert.alert('Xatolik', `"${email}" emailiga ega tashkilot topilmadi.`);
        return;
      }

      if (Number(targetOrgId) === Number(orgId)) {
        Alert.alert('Xatolik', "O'z tashkilotingizga taklif yubora olmaysiz.");
        return;
      }

      const { error: insErr } = await supabase.from('tournament_cohosts').insert([
        {
          tournament_id: selectedTournForCollab.id,
          sender_org_id: orgId,
          receiver_org_id: targetOrgId,
          status: 'pending',
        },
      ]);
      if (insErr) throw insErr;

      Alert.alert('Muvaffaqiyatli', `Hamkorlik taklifi yuborildi!`);
      setShowCollabModal(false);
      setSelectedTournForCollab(null);
      setTargetOrgEmail('');
      await fetchTournamentsData();
    } catch (err: any) {
      Alert.alert('Xatolik', err.message || 'Taklif yuborishda xatolik yuz berdi');
    } finally {
      setSendingCollab(false);
    }
  };

  const handleAcceptCollab = async (collabId: number) => {
    try {
      await supabase.from('tournament_cohosts').update({ status: 'accepted' }).eq('id', collabId);
      if (showToast) showToast({ message: 'Hamkorlik qabul qilindi ✓', type: 'success' });
      await fetchTournamentsData();
    } catch (e) {}
  };

  const handleRejectCollab = async (collabId: number) => {
    try {
      await supabase.from('tournament_cohosts').update({ status: 'rejected' }).eq('id', collabId);
      if (showToast) showToast({ message: 'Hamkorlik rad etildi', type: 'info' });
      await fetchTournamentsData();
    } catch (e) {}
  };

  // Direct Upload Logo for Tournament Card
  const [uploadingLogoTournId, setUploadingLogoTournId] = useState<number | string | null>(null);
  const [uploadingBgTournId, setUploadingBgTournId] = useState<number | string | null>(null);

  const handleDirectUploadLogo = (tourn: any) => {
    if (isReadOnlyUser) return;
    requestAnimationFrame(async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 0.8,
          allowsEditing: false,
        });

        if (!result.canceled && result.assets[0]) {
          const uri = result.assets[0].uri;
          setUploadingLogoTournId(tourn.id);
          setTournaments((prev: any[]) =>
            prev.map((t: any) => (t.id === tourn.id ? { ...t, logo_url: uri } : t))
          );
          if (showToast) showToast({ message: `"${tourn.name}" logosi yangilanmoqda...`, type: 'info', duration: 2000 });

          const cleanUri = uri.split('?')[0];
          const rawExt = cleanUri.split('.').pop()?.toLowerCase() || 'png';
          const fileExt = (rawExt === 'heic' || rawExt === 'heif') ? 'png' : rawExt;
          const fileName = `tourn_logo_${tourn.id}_${Date.now()}.${fileExt}`;
          const filePath = `tournaments/${fileName}`;
          const mimeType = fileExt === 'png' ? 'image/png' : 'image/jpeg';

          const publicUrl = await uploadFileToSupabase('player-photos', filePath, uri, mimeType);
          if (publicUrl) {
            await supabase.from('tournaments').update({ logo_url: publicUrl }).eq('id', tourn.id);
            if (showToast) showToast({ message: `"${tourn.name}" logosi saqlandi ✓`, type: 'success', duration: 2500 });
          }
        }
      } catch (e) {
        console.error('handleDirectUploadLogo error:', e);
      } finally {
        setUploadingLogoTournId(null);
      }
    });
  };

  // Direct Upload Background Image for Tournament Card
  const handleDirectUploadBg = (tourn: any) => {
    if (isReadOnlyUser) return;
    requestAnimationFrame(async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 0.8,
          allowsEditing: false,
        });

        if (!result.canceled && result.assets[0]) {
          const uri = result.assets[0].uri;
          setUploadingBgTournId(tourn.id);
          setTournaments((prev: any[]) =>
            prev.map((t: any) => (t.id === tourn.id ? { ...t, export_bg_url: uri } : t))
          );
          if (showToast) showToast({ message: `"${tourn.name}" fon rasmi yangilanmoqda...`, type: 'info', duration: 2000 });

          const cleanUri = uri.split('?')[0];
          const rawExt = cleanUri.split('.').pop()?.toLowerCase() || 'jpg';
          const fileExt = (rawExt === 'heic' || rawExt === 'heif') ? 'jpg' : rawExt;
          const fileName = `tourn_bg_${tourn.id}_${Date.now()}.${fileExt}`;
          const filePath = `tournaments/${fileName}`;
          const mimeType = fileExt === 'png' ? 'image/png' : 'image/jpeg';

          const publicUrl = await uploadFileToSupabase('player-photos', filePath, uri, mimeType);
          if (publicUrl) {
            await supabase.from('tournaments').update({ export_bg_url: publicUrl }).eq('id', tourn.id);
            if (showToast) showToast({ message: `"${tourn.name}" fon rasmi saqlandi ✓`, type: 'success', duration: 2500 });
          }
        }
      } catch (e) {
        console.error('handleDirectUploadBg error:', e);
      } finally {
        setUploadingBgTournId(null);
      }
    });
  };

  // Delete Background Image from Tournament Card
  const handleDeleteBgImage = (tourn: any) => {
    if (isReadOnlyUser) return;
    Alert.alert("Orqa fonni o'chirish", "Orqa fon rasmini o'chirishni xohlaysizmi?", [
      { text: "Yo'q", style: 'cancel' },
      {
        text: 'Ha',
        style: 'destructive',
        onPress: async () => {
          setTournaments((prev: any[]) =>
            prev.map((t: any) => (t.id === tourn.id ? { ...t, export_bg_url: null } : t))
          );
          await supabase.from('tournaments').update({ export_bg_url: null }).eq('id', tourn.id);
          if (showToast) showToast({ message: "Orqa fon o'chirildi", type: 'info', duration: 2000 });
        },
      },
    ]);
  };

  // Toggle Tournament Status (Faol / Nofaol)
  const handleToggleStatus = async (tourn: any) => {
    if (isReadOnlyUser) return;
    const isCurrentlyActive = tourn.status !== 'archived' && tourn.status !== 'completed';
    const nextStatus = isCurrentlyActive ? 'archived' : 'active';

    setTournaments((prev: any[]) =>
      prev.map((t: any) => (t.id === tourn.id ? { ...t, status: nextStatus } : t))
    );

    try {
      await supabase.from('tournaments').update({ status: nextStatus }).eq('id', tourn.id);
      if (showToast) {
        showToast({
          message: nextStatus === 'active' ? `"${tourn.name}" faollashtirildi ✓` : `"${tourn.name}" arxivlandi`,
          type: nextStatus === 'active' ? 'success' : 'info',
        });
      }
    } catch (e) {
      console.error('Toggle status error:', e);
      fetchTournamentsData();
    }
  };

  // Helper to count attached leagues and teams for a tournament
  const getTournStats = (tId: number) => {
    const linked = tournamentLeagues.filter((tl: any) => Number(tl.tournament_id) === Number(tId));
    const leaguesObj = linked.map((tl: any) => tl.league).filter(Boolean);
    const teams = getTournamentTeams(leaguesObj, allTeams);
    return {
      leaguesCount: linked.length,
      teamsCount: teams.length,
    };
  };

  // Render Tournament Card Content (no delete button — swipe to delete, 1:1 with LeaguesScreen)
  const renderTournamentCardContent = (item: any) => {
    const stats = getTournStats(item.id);
    const duration = item.match_duration || 90;
    const halfTime = Math.round(duration / 2);
    const isCollab = item.isCollab;
    const isActive = item.status !== 'archived' && item.status !== 'completed';

    return (
      <View style={[s.card, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <ImageBackground
          source={item.export_bg_url ? { uri: item.export_bg_url } : undefined}
          style={s.cardFullBg}
          imageStyle={s.cardFullBgImage}
          resizeMode="cover"
        >
          <View style={s.cardDarkOverlay}>
            {/* Top Row: Upload BG & Status Switcher */}
            <View style={s.cardTopRow}>
              {!isReadOnlyUser && !isCollab ? (
                <TouchableOpacity style={s.uploadBgBtn} onPress={() => handleDirectUploadBg(item)} activeOpacity={0.8}>
                  <Ionicons name="cloud-upload-outline" size={13} color="rgba(255,255,255,0.9)" />
                  <Text style={s.uploadBgBtnText}>{"Bg image"}</Text>
                </TouchableOpacity>
              ) : isCollab ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(236,72,153,0.25)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(236,72,153,0.4)' }}>
                  <Ionicons name="link-outline" size={12} color="#EC4899" />
                  <Text style={{ color: '#EC4899', fontSize: 10, fontWeight: '800', marginLeft: 4 }}>{"HAMKOR TURNIR"}</Text>
                </View>
              ) : <View />}

              {/* Status Switcher Button */}
              <TouchableOpacity
                style={[
                  s.statusSwitcherBtn,
                  isActive ? s.statusSwitcherActive : s.statusSwitcherInactive
                ]}
                onPress={() => handleToggleStatus(item)}
                activeOpacity={0.7}
                disabled={isReadOnlyUser || isCollab}
              >
                <View style={[
                  s.statusIndicatorDot,
                  isActive ? s.statusDotActive : s.statusDotInactive
                ]} />
                <Text style={[
                  s.statusSwitcherText,
                  isActive ? s.statusTextActive : s.statusTextInactive
                ]}>
                  {isActive ? "FAOL" : "NOFAOL"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Center Content: Floating Logo, Title, Badges */}
            <View style={s.cardCenterContent}>
              {uploadingLogoTournId === item.id ? (
                <View style={s.freeLogoWrap}>
                  <ActivityIndicator size="small" color="#EC4899" />
                  <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 4, fontWeight: '700' }}>{"Yuklanmoqda..."}</Text>
                </View>
              ) : item.logo_url ? (
                <TouchableOpacity
                  disabled={isReadOnlyUser || isCollab}
                  onPress={() => !isReadOnlyUser && !isCollab && handleDirectUploadLogo(item)}
                  activeOpacity={isReadOnlyUser || isCollab ? 1 : 0.8}
                  style={s.freeLogoWrap}
                >
                  <Image source={{ uri: item.logo_url }} style={s.freeLogoImg} resizeMode="contain" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  disabled={isReadOnlyUser || isCollab}
                  onPress={() => !isReadOnlyUser && !isCollab && handleDirectUploadLogo(item)}
                  activeOpacity={isReadOnlyUser || isCollab ? 1 : 0.8}
                  style={s.freeLogoWrap}
                >
                  <Ionicons name="ribbon-outline" size={44} color="#EC4899" />
                </TouchableOpacity>
              )}

              <Text style={s.cardTitle} numberOfLines={2}>{item.name}</Text>

              <View style={s.badgesRow}>
                {item.start_date ? (
                  <View style={s.badgeSeason}>
                    <Text style={s.badgeIcon}>{"📅"}</Text>
                    <Text style={s.badgeSeasonText}>{item.start_date}</Text>
                  </View>
                ) : null}
                <View style={s.badgeDuration}>
                  <Text style={s.badgeIcon}>{"⏱"}</Text>
                  <Text style={s.badgeDurationText}>{`${duration} daq (${halfTime}x2)`}</Text>
                </View>
                <View style={s.badgeTournLeagues}>
                  <Ionicons name="layers-outline" size={11} color="#38BDF8" />
                  <Text style={s.badgeTournLeaguesText}>{`${stats.leaguesCount} ta liga`}</Text>
                </View>
                <View style={s.badgeTournTeams}>
                  <Ionicons name="shield-outline" size={11} color="#34D399" />
                  <Text style={s.badgeTournTeamsText}>{`${stats.teamsCount} ta jamoa`}</Text>
                </View>
              </View>
            </View>

            {/* Bottom Action Tabs: Ligalar, Tahrirlash — O'chirish endi swipe orqali (LeaguesScreen bilan bir xil) */}
            {!isReadOnlyUser && !isCollab && (
              <View style={s.actionTabs}>
                <TouchableOpacity
                  style={[s.actionTab, s.actionTabLeagues]}
                  onPress={() => handleOpenLeaguesModal(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="layers-outline" size={15} color="#38BDF8" />
                  <Text style={[s.actionTabText, { color: '#38BDF8' }]}>{`Ligalar (${stats.leaguesCount})`}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.actionTab}
                  onPress={() => handleOpenEditModal(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="create-outline" size={16} color="rgba(255,255,255,0.85)" />
                  <Text style={s.actionTabText}>{"Tahrirlash"}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ImageBackground>
      </View>
    );
  };

  // Render each item wrapped in SwipeableTournamentCard (swipe left to reveal delete — 1:1 with LeaguesScreen)
  const renderTournamentCard = ({ item }: { item: any }) => {
    if (isReadOnlyUser || item.isCollab) {
      return renderTournamentCardContent(item);
    }
    return (
      <SwipeableTournamentCard
        item={item}
        isOpen={openSwipeId === String(item.id)}
        setIsSwiping={setIsSwiping}
        onSwipeOpen={() => setOpenSwipeId(String(item.id))}
        onSwipeClose={() => { if (openSwipeId === String(item.id)) setOpenSwipeId(null); }}
        onDelete={() => handleDeleteTournament(item)}
        renderContent={renderTournamentCardContent}
      />
    );
  };

  return (
    <View style={[s.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      {/* Top Header */}
      <View style={[s.header, Platform.OS === 'android' && { borderBottomColor: colors.border }]}>
        <View style={s.headerLeft}>
          {onGoBack && (
            <TouchableOpacity style={[s.backBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard }]} onPress={onGoBack} activeOpacity={0.7}>
              {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />}
              <Ionicons name="arrow-back" size={20} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
            </TouchableOpacity>
          )}
          <View>
            <Text style={[s.headerTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>Turnirlar</Text>
            <Text style={[s.headerSubtitle, Platform.OS === 'android' && { color: colors.textMuted }]}>Ko'p ligali kubok va turnirlar boshqaruvi</Text>
          </View>
        </View>

        {!isReadOnlyUser && (
          <TouchableOpacity style={[s.createBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]} onPress={handleOpenCreateModal} activeOpacity={0.8}>
            <Ionicons name="add" size={18} color={Platform.OS === 'android' ? '#FFFFFF' : '#000000'} />
            <Text style={[s.createBtnText, Platform.OS === 'android' && { color: '#FFFFFF' }]}>Yangi</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Incoming Invitations List */}
      {incomingCollabs.length > 0 && (
        <View style={[s.invitationsBox, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(251, 191, 36, 0.1)' : '#FEF3C7', borderColor: isDark ? 'rgba(251, 191, 36, 0.25)' : '#FDE68A' }]}>
          <View style={s.invitationHeader}>
            <Ionicons name="mail-unread-outline" size={16} color="#FBBF24" />
            <Text style={s.invitationTitle}>Hamkorlik takliflari ({incomingCollabs.length})</Text>
          </View>
          {incomingCollabs.map((collab: any) => (
            <View key={collab.id} style={[s.invitationItem, Platform.OS === 'android' && { borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.invitationTournName, Platform.OS === 'android' && { color: colors.textPrimary }]}>{collab.tournament?.name || 'Turnir'}</Text>
                <Text style={[s.invitationSender, Platform.OS === 'android' && { color: colors.textMuted }]}>Taklif etuvchi: {collab.sender_org?.name || 'Tashkilot'}</Text>
              </View>
              <View style={s.invitationActions}>
                <TouchableOpacity
                  style={s.acceptBtn}
                  onPress={() => handleAcceptCollab(collab.id)}
                >
                  <Ionicons name="checkmark" size={16} color="#000" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.rejectBtn}
                  onPress={() => handleRejectCollab(collab.id)}
                >
                  <Ionicons name="close" size={16} color="#FFF" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={s.centerLoading}>
          <ActivityIndicator size="large" color={Platform.OS === 'android' ? colors.accentGreen : "#00FF66"} />
        </View>
      ) : tournaments.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="ribbon-outline" size={56} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.2)"} />
          <Text style={[s.emptyTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>Hozircha turnirlar mavjud emas</Text>
          <Text style={[s.emptySub, Platform.OS === 'android' && { color: colors.textMuted }]}>
            Turnir yaratish orqali bir nechta ligalarni birlashtirib kubok musobaqasini o'tkazing
          </Text>
          {!isReadOnlyUser && (
            <TouchableOpacity style={[s.emptyCreateBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]} onPress={handleOpenCreateModal}>
              <Ionicons name="add-circle-outline" size={18} color={Platform.OS === 'android' ? '#FFFFFF' : '#000000'} />
              <Text style={[s.emptyCreateBtnText, Platform.OS === 'android' && { color: '#FFFFFF' }]}>Turnir yaratish</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={tournaments}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderTournamentCard}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!isSwiping}
          onScrollBeginDrag={() => {
            if (openSwipeId) setOpenSwipeId(null);
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Platform.OS === 'android' ? colors.accentGreen : "#00FF66"} />}
        />
      )}

      {/* Create / Edit Tournament Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>
                {editingTournament ? "Turnirni tahrirlash" : "Yangi turnir yaratish"}
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={s.fieldLabel}>Turnir nomi *</Text>
              <TextInput
                style={s.input}
                value={formName}
                onChangeText={setFormName}
                placeholder="Masalan: Chempionlar Kubogi 2026"
                placeholderTextColor="rgba(255,255,255,0.3)"
              />

              <View style={s.rowFields}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={s.fieldLabel}>O'yin davomiyligi (daq)</Text>
                  <TextInput
                    style={s.input}
                    value={String(formDuration)}
                    onChangeText={(val) => setFormDuration(Number(val) || 90)}
                    keyboardType="numeric"
                    placeholder="90"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={s.fieldLabel}>Holat</Text>
                  <View style={s.statusToggleRow}>
                    <TouchableOpacity
                      style={[s.statusToggleBtn, formStatus === 'active' && s.statusToggleBtnActive]}
                      onPress={() => setFormStatus('active')}
                    >
                      <Text style={[s.statusToggleText, formStatus === 'active' && s.statusToggleTextActive]}>Faol</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.statusToggleBtn, formStatus === 'archived' && s.statusToggleBtnArchived]}
                      onPress={() => setFormStatus('archived')}
                    >
                      <Text style={[s.statusToggleText, formStatus === 'archived' && s.statusToggleTextActive]}>Arxiv</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View style={s.rowFields}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={s.fieldLabel}>Boshlanish sanasi</Text>
                  <TextInput
                    style={s.input}
                    value={formStartDate}
                    onChangeText={setFormStartDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={s.fieldLabel}>Tugash sanasi</Text>
                  <TextInput
                    style={s.input}
                    value={formEndDate}
                    onChangeText={setFormEndDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                  />
                </View>
              </View>

              <Text style={s.fieldLabel}>Tavsif</Text>
              <TextInput
                style={[s.input, s.textArea]}
                value={formDescription}
                onChangeText={setFormDescription}
                placeholder="Turnir haqida qisqacha ma'lumot..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                multiline
                numberOfLines={3}
              />

              {/* Logo & Background Pickers */}
              <View style={s.imagePickersRow}>
                <TouchableOpacity style={s.imagePickerBtn} onPress={handlePickLogo}>
                  <Ionicons name="image-outline" size={20} color="#38BDF8" />
                  <Text style={s.imagePickerText} numberOfLines={1}>
                    {formLogo ? 'Logo tanlandi ✓' : 'Logo yuklash'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.imagePickerBtn} onPress={handlePickBgImage}>
                  <Ionicons name="color-palette-outline" size={20} color="#F472B6" />
                  <Text style={s.imagePickerText} numberOfLines={1}>
                    {formBgImage ? 'Fon tanlandi ✓' : 'Fon rasmi'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

            <View style={s.modalFooter}>
              <TouchableOpacity
                style={s.saveBtn}
                onPress={handleSaveTournament}
                disabled={savingTournament}
              >
                {savingTournament ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.saveBtnText}>
                    {editingTournament ? "O'zgarishlarni saqlash" : "Turnirni yaratish"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Attach Leagues Modal */}
      <Modal visible={showLeaguesModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Ligalarni biriktirish</Text>
                <Text style={s.modalSubtitle}>{selectedTournForLeagues?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowLeaguesModal(false)}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={[s.fieldLabel, { marginBottom: 12 }]}>
                Ushbu turnirda qatnashadigan ligalarni tanlang:
              </Text>
              {allLeagues.map((league: any) => {
                const isSelected = selectedLeagueIds.includes(Number(league.id));
                return (
                  <TouchableOpacity
                    key={league.id}
                    style={[s.leagueSelectItem, isSelected && s.leagueSelectItemActive]}
                    onPress={() => toggleLeagueId(Number(league.id))}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      {league.logo_url ? (
                        <Image source={{ uri: league.logo_url }} style={s.selectLeagueLogo} resizeMode="contain" />
                      ) : (
                        <Ionicons name="trophy-outline" size={18} color="#FBBF24" style={{ marginRight: 10 }} />
                      )}
                      <Text style={[s.selectLeagueName, isSelected && s.selectLeagueNameActive]}>
                        {league.name}
                      </Text>
                    </View>
                    <Ionicons
                      name={isSelected ? "checkbox" : "square-outline"}
                      size={22}
                      color={isSelected ? "#00FF66" : "rgba(255,255,255,0.4)"}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={s.modalFooter}>
              <TouchableOpacity
                style={s.saveBtn}
                onPress={handleSaveTournamentLeagues}
                disabled={savingLeagues}
              >
                {savingLeagues ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.saveBtnText}>Ligalarni saqlash</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Co-host Modal */}
      <Modal visible={showCollabModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Turnirda sherikchilik (Co-host)</Text>
                <Text style={s.modalSubtitle}>{selectedTournForCollab?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowCollabModal(false)}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={s.fieldLabel}>Sherik tashkilot admin email manzili</Text>
              <TextInput
                style={s.input}
                value={targetOrgEmail}
                onChangeText={setTargetOrgEmail}
                placeholder="admin@sherik-tashkilot.uz"
                placeholderTextColor="rgba(255,255,255,0.3)"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <TouchableOpacity
                style={[s.saveBtn, { marginTop: 12 }]}
                onPress={handleSendCollabInvitation}
                disabled={sendingCollab}
              >
                {sendingCollab ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.saveBtnText}>Taklif yuborish</Text>
                )}
              </TouchableOpacity>

              <Text style={[s.fieldLabel, { marginTop: 24, marginBottom: 8 }]}>
                Mavjud hamkorlar
              </Text>
              {tournCollabsList
                .filter((c: any) => Number(c.tournament_id) === Number(selectedTournForCollab?.id))
                .map((c: any) => {
                  const partner =
                    Number(c.sender_org_id) === Number(orgId) ? c.receiver_org : c.sender_org;
                  return (
                    <View key={c.id} style={s.cohostItem}>
                      <Text style={s.cohostName}>{partner?.name || 'Tashkilot'}</Text>
                      <View
                        style={[
                          s.cohostStatusBadge,
                          c.status === 'accepted' ? s.cohostAccepted : s.cohostPending,
                        ]}
                      >
                        <Text style={s.cohostStatusText}>
                          {c.status === 'accepted' ? 'Qabul qilingan' : 'Kutilmoqda'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00FF66',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#000000',
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  /* Tournament Card (1:1 with LeaguesScreen card) */
  card: {
    width: '100%',
    minHeight: 200,
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
    marginBottom: 16,
  },
  cardFullBg: {
    width: '100%',
    minHeight: 200,
    backgroundColor: 'rgba(6, 35, 84, 0.6)',
  },
  cardFullBgImage: {
    borderRadius: 18,
  },
  cardDarkOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
    padding: 12,
    justifyContent: 'space-between',
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  deleteBgCorner: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  statusSwitcherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    gap: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  statusSwitcherActive: {
    borderColor: 'rgba(0, 255, 102, 0.5)',
    backgroundColor: 'rgba(0, 255, 102, 0.15)',
  },
  statusSwitcherInactive: {
    borderColor: 'rgba(255, 68, 68, 0.5)',
    backgroundColor: 'rgba(255, 68, 68, 0.15)',
  },
  statusIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDotActive: {
    backgroundColor: '#00FF66',
  },
  statusDotInactive: {
    backgroundColor: '#FF4444',
  },
  statusSwitcherText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  statusTextActive: {
    color: '#00FF66',
  },
  statusTextInactive: {
    color: '#FF4444',
  },
  cardCenterContent: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  freeLogoWrap: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    width: '90%',
    height: 90,
  },
  freeLogoImg: {
    width: '100%',
    height: '100%',
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
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 4,
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
  badgeTournLeagues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTournLeaguesText: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '800',
  },
  badgeTournTeams: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTournTeamsText: {
    color: '#34D399',
    fontSize: 9,
    fontWeight: '800',
  },
  actionTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    marginTop: 8,
    gap: 8,
  },
  actionTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  actionTabLeagues: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  actionTabDelete: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  actionTabText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  emptyCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00FF66',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 20,
    gap: 6,
  },
  emptyCreateBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000000',
  },
  invitationsBox: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: 'rgba(251,191,36,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.25)',
    padding: 12,
  },
  invitationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  invitationTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FBBF24',
  },
  invitationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  invitationTournName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  invitationSender: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  invitationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  acceptBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#00FF66',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(239,68,68,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#38BDF8',
    marginTop: 2,
  },
  modalBody: {
    padding: 20,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 6,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 14,
  },
  textArea: {
    height: 70,
    textAlignVertical: 'top',
  },
  rowFields: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  statusToggleRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 3,
  },
  statusToggleBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  statusToggleBtnActive: {
    backgroundColor: '#00FF66',
  },
  statusToggleBtnArchived: {
    backgroundColor: '#94A3B8',
  },
  statusToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },
  statusToggleTextActive: {
    color: '#000000',
  },
  imagePickersRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
    marginBottom: 20,
  },
  imagePickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderStyle: 'dashed',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  imagePickerText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.8)',
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  saveBtn: {
    backgroundColor: '#00FF66',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000000',
  },
  leagueSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  leagueSelectItemActive: {
    backgroundColor: 'rgba(0,255,102,0.08)',
    borderColor: 'rgba(0,255,102,0.3)',
  },
  selectLeagueLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 10,
  },
  selectLeagueName: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
  },
  selectLeagueNameActive: {
    color: '#00FF66',
    fontWeight: '700',
  },
  cohostItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  cohostName: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  cohostStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  cohostAccepted: {
    backgroundColor: 'rgba(0,255,102,0.15)',
  },
  cohostPending: {
    backgroundColor: 'rgba(251,191,36,0.15)',
  },
  cohostStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
