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

  const renderTournamentCard = ({ item }: { item: any }) => {
    const stats = getTournStats(item.id);
    const isCollab = item.isCollab;
    const isArchived = item.status === 'archived';

    return (
      <View style={[s.cardWrapper, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <ImageBackground
          source={item.export_bg_url ? { uri: item.export_bg_url } : undefined}
          style={s.cardBackground}
          imageStyle={{ borderRadius: 16, opacity: 0.35 }}
        >
          <View style={s.cardOverlay}>
            {/* Top Bar: Status & Badges */}
            <View style={s.cardTopRow}>
              <View style={s.statusBadgeRow}>
                <View style={[s.statusBadge, isArchived ? s.statusArchived : s.statusActive]}>
                  <Text style={s.statusText}>{isArchived ? 'ARXIV' : 'FAOL'}</Text>
                </View>
                {isCollab && (
                  <View style={s.collabBadge}>
                    <Ionicons name="people" size={12} color="#00FF66" />
                    <Text style={s.collabBadgeText}>Hamkorlik</Text>
                  </View>
                )}
              </View>

              {!isReadOnlyUser && !isCollab && (
                <TouchableOpacity
                  onPress={() => handleDeleteTournament(item)}
                  style={s.cardDeleteBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={16} color="#FF5252" />
                </TouchableOpacity>
              )}
            </View>

            {/* Center Info: Logo & Name */}
            <View style={s.cardCenter}>
              {item.logo_url ? (
                <Image source={{ uri: item.logo_url }} style={s.tournLogo} resizeMode="contain" />
              ) : (
                <View style={s.tournLogoPlaceholder}>
                  <Ionicons name="ribbon-outline" size={32} color="#EC4899" />
                </View>
              )}
              <Text style={s.tournTitle} numberOfLines={2}>{item.name}</Text>
              {item.description ? (
                <Text style={s.tournDesc} numberOfLines={2}>{item.description}</Text>
              ) : null}
            </View>

            {/* Stats Row */}
            <View style={s.statsRow}>
              <View style={s.statPill}>
                <Ionicons name="time-outline" size={13} color="#FBBF24" />
                <Text style={s.statText}>{`${item.match_duration || 90} daq`}</Text>
              </View>
              <View style={s.statPill}>
                <Ionicons name="trophy-outline" size={13} color="#38BDF8" />
                <Text style={s.statText}>{`${stats.leaguesCount} ta liga`}</Text>
              </View>
              <View style={s.statPill}>
                <Ionicons name="shield-outline" size={13} color="#34D399" />
                <Text style={s.statText}>{`${stats.teamsCount} ta jamoa`}</Text>
              </View>
            </View>

            {/* Bottom Actions */}
            {!isReadOnlyUser && (
              <View style={s.cardBottomActions}>
                {!isCollab && (
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => handleOpenLeaguesModal(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="list-outline" size={15} color="#38BDF8" />
                    <Text style={[s.actionBtnText, { color: '#38BDF8' }]}>Ligalar</Text>
                  </TouchableOpacity>
                )}
                {!isCollab && (
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => handleOpenCollabModal(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="people-outline" size={15} color="#A78BFA" />
                    <Text style={[s.actionBtnText, { color: '#A78BFA' }]}>Hamkorlik</Text>
                  </TouchableOpacity>
                )}
                {!isCollab && (
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => handleOpenEditModal(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="create-outline" size={15} color="#00FF66" />
                    <Text style={[s.actionBtnText, { color: '#00FF66' }]}>Tahrirlash</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </ImageBackground>
      </View>
    );
  };

  return (
    <View style={[s.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      {/* Top Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          {onGoBack && (
            <TouchableOpacity style={s.backBtn} onPress={onGoBack} activeOpacity={0.7}>
              {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />}
              <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <View>
            <Text style={s.headerTitle}>Turnirlar</Text>
            <Text style={s.headerSubtitle}>Ko'p ligali kubok va turnirlar boshqaruvi</Text>
          </View>
        </View>

        {!isReadOnlyUser && (
          <TouchableOpacity style={s.createBtn} onPress={handleOpenCreateModal} activeOpacity={0.8}>
            <Ionicons name="add" size={18} color="#000000" />
            <Text style={s.createBtnText}>Yangi</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Incoming Invitations List */}
      {incomingCollabs.length > 0 && (
        <View style={s.invitationsBox}>
          <View style={s.invitationHeader}>
            <Ionicons name="mail-unread-outline" size={16} color="#FBBF24" />
            <Text style={s.invitationTitle}>Hamkorlik takliflari ({incomingCollabs.length})</Text>
          </View>
          {incomingCollabs.map((collab: any) => (
            <View key={collab.id} style={s.invitationItem}>
              <View style={{ flex: 1 }}>
                <Text style={s.invitationTournName}>{collab.tournament?.name || 'Turnir'}</Text>
                <Text style={s.invitationSender}>Taklif etuvchi: {collab.sender_org?.name || 'Tashkilot'}</Text>
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
          <ActivityIndicator size="large" color="#00FF66" />
        </View>
      ) : tournaments.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="ribbon-outline" size={56} color="rgba(255,255,255,0.2)" />
          <Text style={s.emptyTitle}>Hozircha turnirlar mavjud emas</Text>
          <Text style={s.emptySub}>
            Turnir yaratish orqali bir nechta ligalarni birlashtirib kubok musobaqasini o'tkazing
          </Text>
          {!isReadOnlyUser && (
            <TouchableOpacity style={s.emptyCreateBtn} onPress={handleOpenCreateModal}>
              <Ionicons name="add-circle-outline" size={18} color="#000000" />
              <Text style={s.emptyCreateBtnText}>Turnir yaratish</Text>
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00FF66" />}
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
  cardWrapper: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardBackground: {
    width: '100%',
  },
  cardOverlay: {
    padding: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: 'rgba(0,255,102,0.15)',
  },
  statusArchived: {
    backgroundColor: 'rgba(148,163,184,0.2)',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#00FF66',
    letterSpacing: 0.5,
  },
  collabBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,255,102,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  collabBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#00FF66',
  },
  cardDeleteBtn: {
    padding: 4,
  },
  cardCenter: {
    alignItems: 'center',
    marginBottom: 14,
  },
  tournLogo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 10,
  },
  tournLogoPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(236,72,153,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  tournTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 4,
  },
  tournDesc: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  statText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
  },
  cardBottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 12,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 5,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
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
