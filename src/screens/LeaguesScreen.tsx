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
import { adminNotificationService } from '../utils/adminNotificationService';

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
  onDisconnect,
  isCollab,
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
          // Clamp swipe to max -90px (width of action button)
          panX.setValue(Math.max(gs.dx, -90));
        } else {
          panX.setValue(0);
        }
      },
      onPanResponderRelease: (_, gs) => {
        setIsSwiping(false);
        if (gs.dx < -30) {
          // Snap open to show action button (-90px)
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

  const handleAction = () => {
    resetSwipe();
    if (isCollab && onDisconnect) {
      onDisconnect();
    } else if (onDelete) {
      onDelete();
    }
  };

  return (
    <View style={[swipeStyles.container, isCollab && swipeStyles.collabContainer]}>
      {/* Action behind card (Delete for own league, Disconnect for collab league) */}
      <TouchableOpacity
        style={[swipeStyles.deleteBack, isCollab && swipeStyles.collabBack]}
        onPress={handleAction}
        activeOpacity={0.8}
      >
        <Ionicons name={isCollab ? "unlink-outline" : "trash-bin"} size={22} color="#FFFFFF" />
        <Text style={swipeStyles.deleteText}>{isCollab ? "Uzish" : "O'chirish"}</Text>
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
  collabContainer: {
    backgroundColor: '#EA580C',
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
  collabBack: {
    backgroundColor: '#EA580C',
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
  const { orgId, userRole, collabLeagueIds, showToast, currentOrg } = useOrg();
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

  // Pending incoming collab requests (where this org is receiver)
  const [pendingCollabRequests, setPendingCollabRequests] = useState<any[]>([]);
  const [rejectedCollabRequests, setRejectedCollabRequests] = useState<any[]>([]);
  const [showRejectedSection, setShowRejectedSection] = useState(false);
  const rejectedAnim = useRef(new Animated.Value(0)).current;
  const [processingCollabId, setProcessingCollabId] = useState<number | null>(null);
  const [viewingLeagueDetail, setViewingLeagueDetail] = useState<any | null>(null);

  const handleOpenCollabModal = (league: any) => {
    if (isReadOnlyUser) return;
    setSelectedLeagueForCollab(league);
    setTargetOrgEmail('');
    setShowCollabModal(true);
  };

  const handleSendCollab = async () => {
    const emailToSearch = targetOrgEmail.trim().toLowerCase();
    if (!selectedLeagueForCollab || !emailToSearch) {
      if (showToast) showToast({ message: 'Tashkilot admin email manzilini kiriting', type: 'warning' });
      else Alert.alert('Xatolik', 'Tashkilot admin email manzilini kiriting');
      return;
    }

    const leagueToSend = selectedLeagueForCollab;
    const targetEmail = emailToSearch;

    // Instant modal close + feedback
    setShowCollabModal(false);
    setSelectedLeagueForCollab(null);
    setTargetOrgEmail('');
    if (showToast) {
      showToast({ message: 'Sherikchilik taklifi yuborilmoqda...', type: 'info', duration: 2500 });
    }

    // Background asynchronous execution
    requestAnimationFrame(async () => {
      try {
        const dbClient = supabase;
        let foundOrgId = null;
        let foundOrgName = '';
        let foundOrgLogo = '';

        // 1. Search in admin_users
        const { data: adminUser } = await dbClient
          .from('admin_users')
          .select('organization_id, email')
          .ilike('email', targetEmail)
          .maybeSingle();

        if (adminUser?.organization_id) {
          foundOrgId = adminUser.organization_id;
        } else {
          // 2. Search in organizations
          const { data: orgByEmail } = await dbClient
            .from('organizations')
            .select('id, name, logo_url')
            .ilike('admin_email', targetEmail)
            .maybeSingle();

          if (orgByEmail?.id) {
            foundOrgId = orgByEmail.id;
            foundOrgName = orgByEmail.name;
            foundOrgLogo = orgByEmail.logo_url;
          }
        }

        if (!foundOrgId) {
          if (showToast) showToast({ message: `"${targetEmail}" bo'yicha tashkilot topilmadi!`, type: 'error', duration: 3500 });
          else Alert.alert('Xatolik', `"${targetEmail}" e-mail manzili bo'yicha hech qanday tashkilot topilmadi!`);
          return;
        }

        if (Number(foundOrgId) === Number(orgId)) {
          if (showToast) showToast({ message: "O'z tashkilotingizga sherikchilik yubora olmaysiz!", type: 'warning' });
          else Alert.alert('Xatolik', "O'z tashkilotingizga sherikchilik taklifini yubora olmaysiz!");
          return;
        }

        if (!foundOrgName) {
          const { data: orgObj } = await dbClient
            .from('organizations')
            .select('name, logo_url')
            .eq('id', foundOrgId)
            .maybeSingle();
          foundOrgName = orgObj?.name || 'Tashkilot';
          foundOrgLogo = orgObj?.logo_url || '';
        }

        // Check existing collab
        const { data: existingCollab } = await dbClient
          .from('league_collabs')
          .select('id, status')
          .eq('league_id', leagueToSend.id)
          .or(`and(sender_org_id.eq.${orgId},receiver_org_id.eq.${foundOrgId}),and(sender_org_id.eq.${foundOrgId},receiver_org_id.eq.${orgId})`)
          .maybeSingle();

        if (existingCollab) {
          const statusText = existingCollab.status === 'accepted' ? 'allaqachon qabul qilingan' : 'kutilmoqda';
          if (showToast) showToast({ message: `"${foundOrgName}" ga taklif ${statusText}!`, type: 'warning' });
          return;
        }

        // Send request
        const { data: createdCollab, error } = await dbClient.from('league_collabs').insert({
          league_id: leagueToSend.id,
          sender_org_id: orgId,
          receiver_org_id: foundOrgId,
          status: 'pending',
        }).select().single();

        if (error) throw error;

        // Optimistic local state update on league card
        const newCollabItem = {
          id: createdCollab?.id || Date.now(),
          league_id: leagueToSend.id,
          sender_org_id: orgId,
          receiver_org_id: foundOrgId,
          status: 'pending',
          receiver_org: { id: foundOrgId, name: foundOrgName, logo_url: foundOrgLogo },
          sender_org: { id: orgId, name: currentOrg?.name, logo_url: currentOrg?.logo_url },
        };

        setLeagues(prev =>
          prev.map(l =>
            l.id === leagueToSend.id
              ? { ...l, collabs: [...(l.collabs || []), newCollabItem] }
              : l
          )
        );

        if (editingLeague && editingLeague.id === leagueToSend.id) {
          setEditingLeague((prev: any) => ({
            ...prev,
            collabs: [...(prev?.collabs || []), newCollabItem]
          }));
        }

        // Notify receiver organization about the collab request (DB notification + Expo Push)
        try {
          const senderOrgName = currentOrg?.name || 'Tashkilot';
          await dbClient.from('admin_notifications').insert({
            organization_id: foundOrgId,
            type: 'collab_request',
            title: 'Yangi sherikchilik taklifi',
            message: `"${senderOrgName}" tashkiloti "${leagueToSend.name}" ligasi bo'yicha sherikchilik taklifi yubordi`,
            is_read: false,
            metadata: JSON.stringify({ league_id: leagueToSend.id, sender_org_id: orgId }),
          });

          // Trigger Expo Push Notification to receiver organization
          adminNotificationService.notifyCollabRequest({
            receiverOrgId: foundOrgId,
            senderOrgName: senderOrgName,
            leagueName: leagueToSend.name,
            leagueId: leagueToSend.id,
          });
        } catch (notifErr) {
          console.warn('Collab notification insert failed:', notifErr);
        }

        if (showToast) {
          showToast({ message: `"${foundOrgName}" ga sheriklik taklifi yuborildi ✓`, type: 'success', duration: 3000 });
        }

        // Silent background sync without showing any loading spinner or page reload
        fetchLeagues(true);
      } catch (err: any) {
        console.error('Send collab error:', err);
        if (showToast) showToast({ message: 'Taklif yuborishda xatolik yuz berdi', type: 'error' });
      }
    });
  };

  useEffect(() => {
    fetchLeagues();
  }, [orgId]);

  const fetchLeagues = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const dbClient = supabase;

      // 0. Fetch all accepted collabs for this org to guarantee they are displayed
      let myAcceptedCollabLeagueIds: number[] = [];
      try {
        const { data: myCollabsData } = await dbClient
          .from('league_collabs')
          .select('league_id')
          .or(`receiver_org_id.eq.${orgId},sender_org_id.eq.${orgId}`)
          .eq('status', 'accepted');
        if (myCollabsData && myCollabsData.length > 0) {
          myAcceptedCollabLeagueIds = myCollabsData.map((c: any) => Number(c.league_id)).filter(Boolean);
        }
      } catch (err) {}

      // Combine with context collab ids
      const allActiveCollabIds = [...new Set([...(collabLeagueIds || []), ...myAcceptedCollabLeagueIds])];

      let query = dbClient.from('leagues').select('*').order('created_at', { ascending: false });
      if (orgId) {
        if (allActiveCollabIds.length > 0) {
          query = query.or(`organization_id.eq.${orgId},id.in.(${allActiveCollabIds.join(',')})`);
        } else {
          query = query.eq('organization_id', orgId);
        }
      }
      const { data: leaguesData, error } = await query;
      if (error) console.error(error);

      // 1. Fetch metadata from sponsors table (for ALL leagues including collabs)
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
        const { data: plainC } = await dbClient.from('league_collabs').select('*');
        if (plainC && plainC.length > 0) {
          const orgIds = [...new Set(plainC.flatMap((c: any) => [c.sender_org_id, c.receiver_org_id]).filter(Boolean))];
          const { data: orgs } = await dbClient.from('organizations').select('id, name, logo_url').in('id', orgIds);
          const orgMap: any = {};
          (orgs || []).forEach((o: any) => { orgMap[o.id] = o; });
          collabList = plainC.map((c: any) => ({
            ...c,
            sender_org: orgMap[c.sender_org_id],
            receiver_org: orgMap[c.receiver_org_id],
          }));
        }
      } catch (err) {}

      const collabMap: Record<string | number, any[]> = {};
      collabList.forEach((c: any) => {
        if (!collabMap[c.league_id]) collabMap[c.league_id] = [];
        collabMap[c.league_id].push(c);
      });

      if (leaguesData && leaguesData.length > 0) {
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

      // Helper to enrich a raw league object with all background and date metadata
      const enrichLeague = (l: any) => {
        if (!l) return null;
        const lId = l.id;
        return {
          ...l,
          bg_image: l.bg_image || l.export_bg_url || bgMap[lId] || bgMap[String(lId)] || null,
          export_bg_url: l.export_bg_url || l.bg_image || bgMap[lId] || bgMap[String(lId)] || null,
          match_duration: l.match_duration || durationMap[lId] || durationMap[String(lId)] || 60,
          start_date: l.start_date || startMap[lId] || startMap[String(lId)] || '',
          end_date: l.end_date || endMap[lId] || endMap[String(lId)] || '',
        };
      };

      // 3. Fetch incoming collab requests (pending & rejected) where this org is receiver
      try {
        const { data: incomingCollabs } = await dbClient
          .from('league_collabs')
          .select('*')
          .eq('receiver_org_id', orgId)
          .in('status', ['pending', 'rejected']);

        if (incomingCollabs && incomingCollabs.length > 0) {
          const senderOrgIds = [...new Set(incomingCollabs.map((p: any) => p.sender_org_id))];
          const leagueIds = [...new Set(incomingCollabs.map((p: any) => p.league_id))];

          const [ { data: senderOrgs }, { data: leaguesInfo } ] = await Promise.all([
            dbClient.from('organizations').select('id, name, logo_url').in('id', senderOrgIds),
            dbClient.from('leagues').select('*').in('id', leagueIds)
          ]);

          const senderMap: any = {};
          (senderOrgs || []).forEach((o: any) => { senderMap[o.id] = o; });

          const leagueMap: any = {};
          (leaguesInfo || []).forEach((l: any) => { leagueMap[l.id] = enrichLeague(l); });

          const enrichedList = incomingCollabs.map((c: any) => ({
            ...c,
            sender_org: senderMap[c.sender_org_id] || null,
            league: leagueMap[c.league_id] || null,
          }));

          const pendingList = enrichedList.filter(c => c.status === 'pending');
          const rejectedList = enrichedList.filter(c => c.status === 'rejected');

          setPendingCollabRequests(pendingList);
          setRejectedCollabRequests(rejectedList);

          if (rejectedList.length > 0) {
            Animated.timing(rejectedAnim, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }).start();
          }
        } else {
          setPendingCollabRequests([]);
          setRejectedCollabRequests([]);
        }
      } catch (pendingErr) {
        console.warn('Pending/Rejected collabs fetch error:', pendingErr);
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

  // Disconnect / Delete Collab Connection (Robust & Instant)
  const handleDisconnectCollab = (itemOrCollab: any) => {
    if (!itemOrCollab) return;

    // Resolve leagueId and collabId accurately
    const leagueId = itemOrCollab.league_id || itemOrCollab.id;
    const collabId = (itemOrCollab.league_id && itemOrCollab.id) ? itemOrCollab.id : null;
    
    // Find partners
    const isSender = Number(itemOrCollab.sender_org_id) === Number(orgId);
    const partnerOrgId = isSender 
      ? (itemOrCollab.receiver_org_id || itemOrCollab.organization_id)
      : (itemOrCollab.sender_org_id || itemOrCollab.organization_id);
    
    const partnerOrgName = (isSender 
      ? itemOrCollab.receiver_org?.name 
      : itemOrCollab.sender_org?.name) || 'Hamkor tashkilot';
      
    const leagueName = itemOrCollab.league_name || itemOrCollab.league?.name || itemOrCollab.name || editingLeague?.name || 'Liga';

    Alert.alert(
      "Sherikchilikni uzish",
      `"${leagueName}" ligasi bo'yicha sherikchilikni uzishni xohlaysizmi?`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "Uzish",
          style: 'destructive',
          onPress: () => {
            // 1. INSTANT OPTIMISTIC UI: Remove league card from screen immediately
            if (leagueId) {
              setLeagues(prev => prev.filter(l => String(l.id) !== String(leagueId)));
            }
            if (editingLeague) {
              const updatedCollabs = (editingLeague.collabs || []).filter((c: any) => 
                String(c.id) !== String(collabId) && String(c.league_id) !== String(leagueId)
              );
              setEditingLeague({ ...editingLeague, collabs: updatedCollabs });
            }

            if (showToast) {
              showToast({ message: `"${leagueName}" ligasidagi sherikchilik uzildi ✓`, type: 'info', duration: 2500 });
            }

            // 2. BACKGROUND ASYNCHRONOUS EXECUTION
            requestAnimationFrame(async () => {
              try {
                const dbClient = supabase;
                
                // Delete by collab ID if known
                if (collabId) {
                  await dbClient.from('league_collabs').delete().eq('id', collabId);
                }
                
                // Also delete by league_id & orgId match to guarantee 100% removal
                if (leagueId && orgId) {
                  await dbClient
                    .from('league_collabs')
                    .delete()
                    .eq('league_id', leagueId)
                    .or(`receiver_org_id.eq.${orgId},sender_org_id.eq.${orgId}`);
                }

                // Notify partner organization about disconnection (DB + Push)
                if (partnerOrgId && Number(partnerOrgId) !== Number(orgId)) {
                  try {
                    const myOrgName = currentOrg?.name || 'Tashkilot';
                    await dbClient.from('admin_notifications').insert({
                      organization_id: partnerOrgId,
                      type: 'collab_disconnected',
                      title: 'Sherikchilik uzildi',
                      message: `"${myOrgName}" tashkiloti "${leagueName}" ligasidagi sherikchilikni uzdi`,
                      is_read: false,
                      metadata: JSON.stringify({ league_name: leagueName, disconnected_by_org_id: orgId }),
                    });

                    // Trigger Expo Push Notification
                    adminNotificationService.notifyCollabStatus({
                      targetOrgId: partnerOrgId,
                      title: '⚡ Sherikchilik uzildi',
                      message: `"${myOrgName}" tashkiloti "${leagueName}" ligasidagi sherikchilikni uzdi.`,
                      type: 'collab_disconnected',
                      leagueName: leagueName,
                    });
                  } catch (notifErr) {}
                }

                // Silent background sync
                fetchLeagues(true);
              } catch (e: any) {
                console.error('Disconnect collab background error:', e);
              }
            });
          },
        },
      ]
    );
  };

  // Accept incoming collab request (Instant Optimistic UI & Background Execution)
  const handleAcceptCollab = (collabRequest: any) => {
    const leagueName = collabRequest.league?.name || collabRequest.league_name || 'Liga';

    // 1. INSTANT OPTIMISTIC UI: Remove from pending/rejected and immediately add to active leagues
    setPendingCollabRequests(prev => prev.filter(r => r.id !== collabRequest.id));
    setRejectedCollabRequests(prev => prev.filter(r => r.id !== collabRequest.id));

    if (collabRequest.league) {
      const newLeagueItem = {
        ...collabRequest.league,
        isCollab: true,
      };
      setLeagues(prev => {
        if (prev.some(l => l.id === newLeagueItem.id)) return prev;
        return [newLeagueItem, ...prev];
      });
    }

    if (showToast) {
      showToast({ message: `"${leagueName}" ligasi qabul qilindi ✓`, type: 'success', duration: 2500 });
    }

    // 2. BACKGROUND ASYNCHRONOUS EXECUTION
    requestAnimationFrame(async () => {
      try {
        const dbClient = supabase;
        const { error } = await dbClient
          .from('league_collabs')
          .update({ status: 'accepted' })
          .eq('id', collabRequest.id);
        if (error) throw error;

        // Notify sender organization that collab was accepted (DB + Push)
        try {
          const myOrgName = currentOrg?.name || 'Tashkilot';
          await dbClient.from('admin_notifications').insert({
            organization_id: collabRequest.sender_org_id,
            type: 'collab_accepted',
            title: 'Sherikchilik qabul qilindi',
            message: `"${myOrgName}" tashkiloti "${leagueName}" ligasi bo'yicha sherikchilik taklifingizni qabul qildi`,
            is_read: false,
            metadata: JSON.stringify({ league_id: collabRequest.league_id, accepted_by_org_id: orgId }),
          });

          // Trigger Expo Push Notification
          adminNotificationService.notifyCollabStatus({
            targetOrgId: collabRequest.sender_org_id,
            title: '🎉 Sherikchilik qabul qilindi!',
            message: `"${myOrgName}" tashkiloti "${leagueName}" ligasi bo'yicha sherikchilik taklifingizni qabul qildi.`,
            type: 'collab_accepted',
            leagueName: leagueName,
          });
        } catch (notifErr) {}

        // Silent background sync
        fetchLeagues(true);
      } catch (e: any) {
        console.error('Accept collab background error:', e);
      }
    });
  };

  // Reject incoming collab request (sets status to 'rejected' and shows rejected button with fade-in)
  const handleRejectCollab = (collabRequest: any) => {
    Alert.alert(
      "Taklifni rad etish",
      `"${collabRequest.sender_org?.name || 'Tashkilot'}" tashkilotining "${collabRequest.league?.name || 'Liga'}" ligasi bo'yicha sherikchilik taklifini rad etmoqchimisiz?`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: 'Rad etish',
          style: 'destructive',
          onPress: async () => {
            setProcessingCollabId(collabRequest.id);
            // Optimistic local move from pending to rejected
            setPendingCollabRequests(prev => prev.filter(r => r.id !== collabRequest.id));
            const updatedRejectedItem = { ...collabRequest, status: 'rejected' };
            setRejectedCollabRequests(prev => [updatedRejectedItem, ...prev.filter(r => r.id !== collabRequest.id)]);

            // Trigger smooth Fade-in animation
            Animated.timing(rejectedAnim, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }).start();

            try {
              const dbClient = supabase;
              const { error } = await dbClient
                .from('league_collabs')
                .update({ status: 'rejected' })
                .eq('id', collabRequest.id);
              if (error) throw error;

              // Notify sender organization that collab was rejected (DB + Push)
              try {
                const myOrgName = currentOrg?.name || 'Tashkilot';
                const leagueName = collabRequest.league?.name || collabRequest.league_name || 'Liga';
                await dbClient.from('admin_notifications').insert({
                  organization_id: collabRequest.sender_org_id,
                  type: 'collab_rejected',
                  title: 'Sherikchilik rad etildi',
                  message: `"${myOrgName}" tashkiloti "${leagueName}" ligasi bo'yicha sherikchilik taklifingizni rad etdi`,
                  is_read: false,
                  metadata: JSON.stringify({ league_id: collabRequest.league_id, rejected_by_org_id: orgId }),
                });

                // Trigger Expo Push Notification
                adminNotificationService.notifyCollabStatus({
                  targetOrgId: collabRequest.sender_org_id,
                  title: '❌ Sherikchilik rad etildi',
                  message: `"${myOrgName}" tashkiloti "${leagueName}" ligasi bo'yicha sherikchilik taklifingizni rad etdi.`,
                  type: 'collab_rejected',
                  leagueName: leagueName,
                });
              } catch (notifErr) {
                console.warn('Reject notification failed:', notifErr);
              }

              if (showToast) showToast({ message: 'Taklif rad etildi (Rad etilganlar ro\'yxatiga o\'tkazildi)', type: 'info' });
              await fetchLeagues(true);
            } catch (e: any) {
              console.error(e);
              Alert.alert('Xatolik', 'Rad etishda xatolik: ' + (e.message || ''));
            } finally {
              setProcessingCollabId(null);
            }
          },
        },
      ]
    );
  };

  // Permanently delete a rejected collab request
  const handleDeleteRejectedCollab = (collabRequest: any) => {
    Alert.alert(
      "Tozalash",
      `"${collabRequest.league?.name || 'Liga'}" taklifini ro'yxatdan butunlay o'chirib tashlamoqchimisiz?`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "O'chirish",
          style: 'destructive',
          onPress: async () => {
            setRejectedCollabRequests(prev => prev.filter(r => r.id !== collabRequest.id));
            try {
              const dbClient = supabase;
              await dbClient.from('league_collabs').delete().eq('id', collabRequest.id);
              if (showToast) showToast({ message: "O'chirildi", type: 'info' });
            } catch (e) {}
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

  // Upload Background Image (Instant local preview + silent background upload, NO modal alert)
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
          const uri = result.assets[0].uri;

          // 1. Instant local preview (Optimistic UI update)
          setLeagues((prev) =>
            prev.map((l) =>
              l.id === league.id ? { ...l, bg_image: uri, export_bg_url: uri } : l
            )
          );

          if (showToast) {
            showToast({ message: `"${league.name}" fon rasmi yangilanmoqda...`, type: 'info', duration: 2000 });
          }

          // 2. Silent Background Upload
          const cleanUri = uri.split('?')[0];
          const rawExt = cleanUri.split('.').pop()?.toLowerCase() || 'jpg';
          const fileExt = (rawExt === 'heic' || rawExt === 'heif') ? 'jpg' : rawExt;
          const fileName = `league_bg_${league.id}_${Date.now()}.${fileExt}`;
          const filePath = `league-backgrounds/${fileName}`;
          const mimeType = fileExt === 'png' ? 'image/png' : 'image/jpeg';

          const dbClient = supabase;
          const publicUrl = await uploadFileToSupabase(dbClient, 'player-photos', filePath, uri, mimeType);

          if (publicUrl) {
            // Update export_bg_url on leagues table
            await dbClient.from('leagues').update({ export_bg_url: publicUrl }).eq('id', league.id);

            // Sync sponsors table keys used by website (LEAGUE_BG_, BANNER_SCHEDULE_, BANNER_YT_)
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

            if (showToast) {
              showToast({ message: `"${league.name}" fon rasmi saqlandi ✓`, type: 'success', duration: 2500 });
            }
          }
        }
      } catch (e) {
        console.error('handleUploadBgImage error:', e);
        if (showToast) {
          showToast({ message: 'Rasm yuklashda xatolik yuz berdi', type: 'error' });
        }
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
            // Instant local clear
            setLeagues((prev) =>
              prev.map((l) =>
                l.id === league.id ? { ...l, bg_image: null, export_bg_url: null } : l
              )
            );

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

            if (showToast) {
              showToast({ message: 'Orqa fon o\'chirildi', type: 'info', duration: 2000 });
            }
          } catch (e) {
            console.error(e);
          }
        },
      },
    ]);
  };

  // Inline logo uploading state
  const [uploadingLogoLeagueId, setUploadingLogoLeagueId] = useState<string | number | null>(null);

  // Upload Logo Image (Instant local preview + silent background upload, NO modal alert)
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
          const uri = result.assets[0].uri;

          // 1. Instant local preview (Optimistic UI update)
          setLeagues((prev) =>
            prev.map((l) => (l.id === league.id ? { ...l, logo_url: uri } : l))
          );

          if (showToast) {
            showToast({ message: `"${league.name}" logosi yangilanmoqda...`, type: 'info', duration: 2000 });
          }

          // 2. Silent Background Upload
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
            if (showToast) {
              showToast({ message: `"${league.name}" logosi saqlandi ✓`, type: 'success', duration: 2500 });
            }
          }
        }
      } catch (e) {
        console.error('handleUploadLogo error:', e);
        if (showToast) {
          showToast({ message: 'Logo yuklashda xatolik yuz berdi', type: 'error' });
        }
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
    // Collab league = not created by this org (read-only: no edit, no collab, no upload)
    const isCollabLeague = item.organization_id && Number(item.organization_id) !== Number(orgId);

    return (
      <View style={s.card}>
        <ImageBackground
          source={item.bg_image ? { uri: item.bg_image } : undefined}
          style={s.cardFullBg}
          imageStyle={s.cardFullBgImage}
          resizeMode="cover"
        >
          <View style={s.cardDarkOverlay}>
            {/* Top Row: Upload BG (Only for Admins of own leagues) */}
            {!isReadOnlyUser && !isCollabLeague && (
              <View style={s.cardTopRow}>
                <TouchableOpacity style={s.uploadBgBtn} onPress={() => handleUploadBgImage(item)} activeOpacity={0.8}>
                  <Ionicons name="cloud-upload-outline" size={13} color="rgba(255,255,255,0.9)" />
                  <Text style={s.uploadBgBtnText}>{"Bg image"}</Text>
                </TouchableOpacity>
              </View>
            )}
            {/* Collab League Badge */}
            {isCollabLeague && (
              <View style={s.cardTopRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,170,255,0.25)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,170,255,0.4)' }}>
                  <Ionicons name="link-outline" size={12} color="#00AAFF" />
                  <Text style={{ color: '#00AAFF', fontSize: 10, fontWeight: '800', marginLeft: 4 }}>{"HAMKOR LIGA"}</Text>
                </View>
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
                  disabled={isReadOnlyUser || isCollabLeague}
                  onPress={() => !isReadOnlyUser && !isCollabLeague && handleUploadLogo(item)}
                  activeOpacity={isReadOnlyUser || isCollabLeague ? 1 : 0.8}
                  style={s.freeLogoWrap}
                >
                  <Image source={{ uri: item.logo_url || item.logo || item.logoUrl }} style={s.freeLogoImg} resizeMode="contain" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  disabled={isReadOnlyUser || isCollabLeague}
                  onPress={() => !isReadOnlyUser && !isCollabLeague && handleUploadLogo(item)}
                  activeOpacity={isReadOnlyUser || isCollabLeague ? 1 : 0.8}
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

            {/* Bottom: Action Tabs — Collab & Edit (only for own leagues) */}
            {!isReadOnlyUser && !isCollabLeague && (
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
    const isCollabItem = item.organization_id && Number(item.organization_id) !== Number(orgId);

    // Find the collab record for this league to disconnect if swiped
    const matchingCollab = (item.collabs || []).find((c: any) => 
      Number(c.sender_org_id) === Number(orgId) || Number(c.receiver_org_id) === Number(orgId)
    ) || item.collabs?.[0] || {};

    const currentCollab = {
      ...item,
      ...matchingCollab,
      league_id: item.id,
      name: item.name,
      sender_org_id: item.organization_id || matchingCollab.sender_org_id,
      receiver_org_id: orgId,
    };

    return (
      <SwipeableLeagueCard
        item={item}
        isOpen={openSwipeId === String(item.id)}
        setIsSwiping={setIsSwiping}
        onSwipeOpen={() => setOpenSwipeId(String(item.id))}
        onSwipeClose={() => { if (openSwipeId === String(item.id)) setOpenSwipeId(null); }}
        onDelete={() => handleDeleteLeague(item)}
        onDisconnect={() => handleDisconnectCollab(currentCollab)}
        isCollab={isCollabItem}
        renderContent={renderLeagueCardContent}
      />
    );
  };

  return (
    <View style={s.container}>
      {/* Page Header with Animated Rejected Collabs Button */}
      <View style={s.pageHeader}>
        <View style={s.pageHeaderLeft}>
          <Ionicons name="trophy-outline" size={22} color="#FFFFFF" />
          <Text style={s.pageTitle}>{"Tashkilot Ligalari Boshqaruvi"}</Text>
        </View>

        {!isReadOnlyUser && rejectedCollabRequests.length > 0 && (
          <Animated.View style={{ opacity: rejectedAnim }}>
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: showRejectedSection ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)',
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: showRejectedSection ? '#EF4444' : 'rgba(255,255,255,0.15)',
              }}
              onPress={() => setShowRejectedSection(!showRejectedSection)}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={14} color={showRejectedSection ? '#FF6B6B' : '#EF4444'} />
              <Text style={{ color: showRejectedSection ? '#FFFFFF' : '#EF4444', fontSize: 11, fontWeight: '700', marginLeft: 4 }}>
                {`Rad etilganlar (${rejectedCollabRequests.length})`}
              </Text>
              <Ionicons
                name={showRejectedSection ? "chevron-up" : "chevron-down"}
                size={12}
                color={showRejectedSection ? '#FFFFFF' : '#EF4444'}
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>

      <Text style={s.sectionLabel}>{`MAVJUD LIGALAR (${leagues.length})`}</Text>

      {loading ? (
        <LeagueSkeletonLoader />
      ) : leagues.length === 0 && (!isReadOnlyUser ? (pendingCollabRequests.length === 0 && rejectedCollabRequests.length === 0) : true) ? (
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
          ListHeaderComponent={
            !isReadOnlyUser ? (
              <View style={{ marginBottom: 12 }}>
                {/* 1. Rejected Collab Requests Accordion List (Admin only) */}
                {showRejectedSection && rejectedCollabRequests.length > 0 && (
                  <View style={{ marginBottom: 16, backgroundColor: 'rgba(239,68,68,0.06)', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="close-circle" size={16} color="#EF4444" style={{ marginRight: 6 }} />
                        <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>
                          {`RAD ETILGAN SHERIKCHILIK TAKLIFLARI (${rejectedCollabRequests.length})`}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => setShowRejectedSection(false)}>
                        <Ionicons name="close" size={16} color="rgba(255,255,255,0.6)" />
                      </TouchableOpacity>
                    </View>

                    {rejectedCollabRequests.map((req: any) => {
                      const lInfo = req.league || {};
                      const sOrg = req.sender_org || {};
                      const isProcessing = processingCollabId === req.id;

                      return (
                        <View key={req.id} style={{ backgroundColor: 'rgba(0,0,0,0.4)', padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>{lInfo.name || 'Liga'}</Text>
                            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{sOrg.name || 'Tashkilot'}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                            <TouchableOpacity
                              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.1)' }}
                              onPress={() => handleDeleteRejectedCollab(req)}
                            >
                              <Text style={{ color: '#94A3B8', fontSize: 11, fontWeight: '600' }}>{"O'chirish"}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: 'rgba(0,255,102,0.2)', borderWidth: 1, borderColor: 'rgba(0,255,102,0.4)' }}
                              onPress={() => handleAcceptCollab(req)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                <ActivityIndicator size="small" color="#00FF66" />
                              ) : (
                                <Text style={{ color: '#00FF66', fontSize: 11, fontWeight: '700' }}>{"Qayta Qabul Qilish"}</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

              {/* 2. Pending Incoming Collab Requests with Full Metadata */}
              {pendingCollabRequests.length > 0 && (
                <View>
                  <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 8 }]}>{`📩 KIRUVCHI SHERIKCHILIK TAKLIFLARI (${pendingCollabRequests.length})`}</Text>
                  {pendingCollabRequests.map((req: any) => {
                    const leagueInfo = req.league || {};
                    const senderOrg = req.sender_org || {};
                    const isProcessing = processingCollabId === req.id;
                    const bgSource = leagueInfo.bg_image || leagueInfo.export_bg_url;
                    const matchDur = leagueInfo.match_duration || 60;

                    return (
                      <View key={req.id} style={[s.card, { borderWidth: 1, borderColor: 'rgba(0,170,255,0.5)', marginBottom: 12 }]}>
                        <ImageBackground
                          source={bgSource ? { uri: bgSource } : undefined}
                          style={s.cardFullBg}
                          imageStyle={s.cardFullBgImage}
                          resizeMode="cover"
                        >
                          <View style={s.cardDarkOverlay}>
                            {/* Top: Taklif badge */}
                            <View style={s.cardTopRow}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,170,255,0.3)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,170,255,0.5)' }}>
                                <Ionicons name="mail-unread-outline" size={12} color="#00AAFF" />
                                <Text style={{ color: '#00AAFF', fontSize: 10, fontWeight: '800', marginLeft: 4 }}>{"SHERIKCHILIK TAKLIFI"}</Text>
                              </View>
                            </View>

                            {/* Center: League info (Clickable to view details) */}
                            <TouchableOpacity
                              style={s.cardCenterContent}
                              activeOpacity={0.8}
                              onPress={() => setViewingLeagueDetail(req)}
                            >
                              {leagueInfo.logo_url ? (
                                <View style={s.freeLogoWrap}>
                                  <Image source={{ uri: leagueInfo.logo_url }} style={s.freeLogoImg} resizeMode="contain" />
                                </View>
                              ) : (
                                <View style={s.freeLogoWrap}>
                                  <Ionicons name="trophy" size={38} color="#FFFFFF" />
                                </View>
                              )}
                              <Text style={s.cardTitle} numberOfLines={2}>{leagueInfo.name || 'Liga'}</Text>

                              {/* Sender org info */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>
                                {senderOrg.logo_url ? (
                                  <Image source={{ uri: senderOrg.logo_url }} style={{ width: 18, height: 18, borderRadius: 9, marginRight: 6 }} resizeMode="contain" />
                                ) : (
                                  <Ionicons name="business-outline" size={14} color="rgba(255,255,255,0.7)" style={{ marginRight: 6 }} />
                                )}
                                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' }}>{`${senderOrg.name || 'Tashkilot'} dan taklif`}</Text>
                              </View>

                              {/* Badges: Season & Match Duration */}
                              <View style={[s.badgesRow, { marginTop: 8 }]}>
                                <View style={s.badgeSeason}>
                                  <Text style={s.badgeIcon}>{"📅"}</Text>
                                  <Text style={s.badgeSeasonText}>{leagueInfo.season || '2026/2027'}</Text>
                                </View>
                                <View style={s.badgeDuration}>
                                  <Text style={s.badgeIcon}>{"⏱"}</Text>
                                  <Text style={s.badgeDurationText}>{`${matchDur} daq`}</Text>
                                </View>
                              </View>

                              {/* Dates row if available */}
                              {(leagueInfo.start_date || leagueInfo.end_date) && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 10 }}>
                                  {leagueInfo.start_date && (
                                    <Text style={{ color: 'rgba(0,255,102,0.85)', fontSize: 11, fontWeight: '600' }}>
                                      {`Boshlanish: ${leagueInfo.start_date}`}
                                    </Text>
                                  )}
                                  {leagueInfo.end_date && (
                                    <Text style={{ color: 'rgba(255,150,50,0.85)', fontSize: 11, fontWeight: '600' }}>
                                      {`Tugash: ${leagueInfo.end_date}`}
                                    </Text>
                                  )}
                                </View>
                              )}

                              <Text style={{ color: '#00AAFF', fontSize: 11, fontWeight: '600', marginTop: 8 }}>{"Batafsil ma'lumotlarni ko'rish 👆"}</Text>
                            </TouchableOpacity>

                            {/* Bottom: Accept / Reject buttons */}
                            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, paddingBottom: 12, paddingHorizontal: 16 }}>
                              <TouchableOpacity
                                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,255,102,0.2)', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,255,102,0.5)' }}
                                onPress={() => handleAcceptCollab(req)}
                                disabled={isProcessing}
                                activeOpacity={0.7}
                              >
                                {isProcessing ? (
                                  <ActivityIndicator size="small" color="#00FF66" />
                                ) : (
                                  <>
                                    <Ionicons name="checkmark-circle" size={18} color="#00FF66" />
                                    <Text style={{ color: '#00FF66', fontSize: 13, fontWeight: '800', marginLeft: 6 }}>{"Qabul qilish"}</Text>
                                  </>
                                )}
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,59,48,0.15)', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)' }}
                                onPress={() => handleRejectCollab(req)}
                                disabled={isProcessing}
                                activeOpacity={0.7}
                              >
                                <Ionicons name="close-circle" size={18} color="#FF3B30" />
                                <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '800', marginLeft: 6 }}>{"Rad etish"}</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </ImageBackground>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}
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
                            onPress={() => handleDisconnectCollab(c)}
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

      {/* View Collab League Details Modal */}
      <Modal visible={!!viewingLeagueDetail} transparent animationType="fade" onRequestClose={() => setViewingLeagueDetail(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { maxHeight: '85%' }]}>
            <View style={s.modalHeader}>
              <View style={s.modalHeaderTitleRow}>
                <Ionicons name="information-circle-outline" size={20} color="#00AAFF" />
                <Text style={s.modalTitle} numberOfLines={1}>
                  {"Sherikchilik Taklifi Tafsilotlari"}
                </Text>
              </View>
              <TouchableOpacity style={s.modalClose} onPress={() => setViewingLeagueDetail(null)}>
                <Ionicons name="close" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {viewingLeagueDetail && (
              <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
                {/* League Preview Banner */}
                <View style={[s.card, { height: 160, marginBottom: 16 }]}>
                  <ImageBackground
                    source={viewingLeagueDetail.league?.export_bg_url ? { uri: viewingLeagueDetail.league.export_bg_url } : undefined}
                    style={s.cardFullBg}
                    imageStyle={s.cardFullBgImage}
                    resizeMode="cover"
                  >
                    <View style={[s.cardDarkOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
                      {viewingLeagueDetail.league?.logo_url ? (
                        <Image source={{ uri: viewingLeagueDetail.league.logo_url }} style={{ width: 56, height: 56, borderRadius: 28, marginBottom: 8 }} resizeMode="contain" />
                      ) : (
                        <Ionicons name="trophy" size={42} color="#FFFFFF" style={{ marginBottom: 8 }} />
                      )}
                      <Text style={[s.cardTitle, { fontSize: 18 }]}>{viewingLeagueDetail.league?.name || 'Liga'}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 }}>{viewingLeagueDetail.league?.season || '2026/2027'}</Text>
                    </View>
                  </ImageBackground>
                </View>

                {/* Sender Org Details */}
                <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: 14, borderRadius: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ color: '#00AAFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 }}>{"YUBORUVCHI TASHKILOT"}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {viewingLeagueDetail.sender_org?.logo_url ? (
                      <Image source={{ uri: viewingLeagueDetail.sender_org.logo_url }} style={{ width: 36, height: 36, borderRadius: 18, marginRight: 12 }} resizeMode="contain" />
                    ) : (
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <Ionicons name="business-outline" size={20} color="#00FF66" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>{viewingLeagueDetail.sender_org?.name || 'Tashkilot'}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 }}>{"Co-host (sheriklik) taklif qilmoqda"}</Text>
                    </View>
                  </View>
                </View>

                {/* League Specifications */}
                <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: 14, borderRadius: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ color: '#00FF66', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 10 }}>{"LIGA PARAMETRLARI"}</Text>
                  
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{"Mavsum:"}</Text>
                    <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>{viewingLeagueDetail.league?.season || '2026/2027'}</Text>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{"O'yin davomiyligi:"}</Text>
                    <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>{`${viewingLeagueDetail.league?.match_duration || 60} daqiqa`}</Text>
                  </View>

                  {viewingLeagueDetail.league?.start_date && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{"Boshlanish sanasi:"}</Text>
                      <Text style={{ color: '#00FF66', fontSize: 13, fontWeight: '700' }}>{viewingLeagueDetail.league.start_date}</Text>
                    </View>
                  )}

                  {viewingLeagueDetail.league?.end_date && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{"Tugash sanasi:"}</Text>
                      <Text style={{ color: '#FBBF24', fontSize: 13, fontWeight: '700' }}>{viewingLeagueDetail.league.end_date}</Text>
                    </View>
                  )}
                </View>

                {/* Note about Co-hosting */}
                <View style={{ backgroundColor: 'rgba(0,170,255,0.08)', padding: 12, borderRadius: 10, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(0,170,255,0.2)' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 17 }}>
                    {"ℹ️ Ushbu sheriklikni qabul qilsangiz, mazkur liga sizning tashkilot ilovangizda va boshqaruv panelingizda to'liq ko'rinadi. Liga sozlamalarini faqat uni yaratgan tashkilot boshqarishi mumkin."}
                  </Text>
                </View>
              </ScrollView>
            )}

            {/* Modal Actions: Accept & Reject */}
            {viewingLeagueDetail && (
              <View style={[s.modalActions, { gap: 10 }]}>
                <TouchableOpacity
                  style={[s.cancelSquareBtn, { flex: 1, backgroundColor: 'rgba(255,59,48,0.15)', borderColor: 'rgba(255,59,48,0.4)', borderRadius: 10, paddingVertical: 12 }]}
                  onPress={() => {
                    const req = viewingLeagueDetail;
                    setViewingLeagueDetail(null);
                    handleRejectCollab(req);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '800' }}>{"Rad etish"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.saveFullBtn, { flex: 1.5, backgroundColor: '#00FF66' }]}
                  onPress={async () => {
                    const req = viewingLeagueDetail;
                    setViewingLeagueDetail(null);
                    await handleAcceptCollab(req);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.saveFullBtnText, { color: '#000000' }]}>{"Qabul qilish"}</Text>
                </TouchableOpacity>
              </View>
            )}
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
