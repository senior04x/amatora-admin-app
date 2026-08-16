import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  RefreshControl,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';
import { adminNotificationService } from '../utils/adminNotificationService';

// Helper functions for parsing instagram & metadata from comments
const getInstaUser = (val: any) => {
  if (!val) return '';
  if (typeof val === 'string') {
    const match = val.match(/instagram\.com\/([^\/\]]+)/);
    if (match?.[1]) return match[1].replace(/^@/, '').trim();
    return val.replace(/^@/, '').trim();
  }
  return '';
};

const extractInstaFromComment = (comment: string) => {
  if (!comment) return '';
  const match = comment.match(/\[INSTAGRAM:([^\]]+)\]/);
  if (match?.[1]) {
    return getInstaUser(match[1]);
  }
  return '';
};

const extractMetaFromComment = (comment: string) => {
  if (!comment) return {};
  const metaMatch = comment.match(/\[METADATA:({[^\]]+})\]/);
  if (metaMatch?.[1]) {
    try {
      return JSON.parse(metaMatch[1]);
    } catch (e) {}
  }
  return {};
};

// Skeleton Item Pulse Component
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

// Single Field Diff Comparison Row
const DiffRow: React.FC<{
  label: string;
  oldVal: string;
  newVal: string;
  showOnlyChanged: boolean;
}> = ({ label, oldVal, newVal, showOnlyChanged }) => {
  const cleanOld = String(oldVal || '').trim();
  const cleanNew = String(newVal || '').trim();

  const isChanged =
    cleanOld !== cleanNew &&
    cleanOld !== '' &&
    cleanNew !== '' &&
    cleanOld !== '—' &&
    cleanNew !== '—';

  if (showOnlyChanged && !isChanged) return null;

  return (
    <View
      style={[
        styles.diffRowContainer,
        isChanged && {
          backgroundColor: 'rgba(0, 255, 102, 0.08)',
          borderColor: 'rgba(0, 255, 102, 0.3)',
        },
      ]}
    >
      <View style={styles.diffRowTop}>
        <Text
          style={[
            styles.diffRowLabel,
            { color: isChanged ? '#00FF66' : 'rgba(255,255,255,0.4)' },
          ]}
        >
          {label}
        </Text>
        {isChanged ? (
          <View style={styles.changedBadge}>
            <Text style={styles.changedBadgeText}>{"O'ZGARGAN"}</Text>
          </View>
        ) : (
          <Text style={styles.sameText}>{"Bir xil"}</Text>
        )}
      </View>

      <View style={styles.diffValuesRow}>
        <Text
          style={[
            styles.diffOldVal,
            { color: isChanged ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)' },
          ]}
          numberOfLines={1}
        >
          {oldVal || '—'}
        </Text>

        <Ionicons
          name="arrow-forward"
          size={14}
          color={isChanged ? '#00FF66' : 'rgba(255,255,255,0.2)'}
        />

        <Text
          style={[
            styles.diffNewVal,
            { color: isChanged ? '#00FF66' : 'rgba(255,255,255,0.7)', fontWeight: isChanged ? '900' : '400' },
          ]}
          numberOfLines={1}
        >
          {newVal || '—'}
        </Text>
      </View>
    </View>
  );
};

// Animated Card Component with Paper Flying, Red Overlay & Particle Shatter
const UpdateCardItem: React.FC<{
  req: any;
  showOnlyChanged: boolean;
  isProcessing: boolean;
  statusColor: string;
  statusLabel: string;
  isPending: boolean;
  oldData: any;
  newData: any;
  oldPhoto: string;
  newPhoto: string;
  commentMeta: any;
  onApprove: (req: any, startAnim: () => Promise<void>) => void;
  onReject: (req: any, startAnim: () => Promise<void>) => void;
  onDeletePress: (req: any, startAnim: () => Promise<void>) => void;
  onStatusClick: (req: any) => void;
}> = ({
  req,
  showOnlyChanged,
  isProcessing,
  statusColor,
  statusLabel,
  isPending,
  oldData,
  newData,
  oldPhoto,
  newPhoto,
  commentMeta,
  onApprove,
  onReject,
  onDeletePress,
  onStatusClick,
}) => {
  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const redOverlay = useRef(new Animated.Value(0)).current;

  // Particle explosion state
  const [particlesActive, setParticlesActive] = useState(false);
  const particles = useRef(
    Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2 + (Math.random() * 0.4 - 0.2);
      const dist = 60 + Math.random() * 90;
      return {
        x: new Animated.Value(0),
        y: new Animated.Value(0),
        scale: new Animated.Value(1),
        opacity: new Animated.Value(1),
        targetX: Math.cos(angle) * dist,
        targetY: Math.sin(angle) * dist,
        color: ['#00FF66', '#EF4444', '#38BDF8', '#FBBF24', '#FFFFFF', '#A855F7'][i % 6],
        size: 8 + Math.floor(Math.random() * 8),
      };
    })
  ).current;

  // Shrink-to-icon Animation for Approval
  const runApproveAnim = (): Promise<void> => {
    return new Promise((resolve) => {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.04, duration: 150, useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(scale, { toValue: 0.02, duration: 380, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 380, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 40, duration: 380, useNativeDriver: true }),
        ]),
      ]).start(() => resolve());
    });
  };

  // Red Overlay + Shrink-to-icon Animation for Rejection
  const runRejectAnim = (): Promise<void> => {
    return new Promise((resolve) => {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.04, duration: 150, useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(redOverlay, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.02, duration: 380, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 380, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 40, duration: 380, useNativeDriver: true }),
        ]),
      ]).start(() => resolve());
    });
  };

  // Particle Burst Animation for Deletion
  const runDeleteAnim = (): Promise<void> => {
    return new Promise((resolve) => {
      setParticlesActive(true);
      const particleAnimations = particles.map((p) =>
        Animated.parallel([
          Animated.timing(p.x, { toValue: p.targetX, duration: 500, useNativeDriver: true }),
          Animated.timing(p.y, { toValue: p.targetY, duration: 500, useNativeDriver: true }),
          Animated.timing(p.scale, { toValue: 0.1, duration: 500, useNativeDriver: true }),
          Animated.timing(p.opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        ])
      );

      Animated.parallel([
        ...particleAnimations,
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.05, duration: 150, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start(() => resolve());
    });
  };

  const spin = rotate.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-18deg', '0deg', '18deg'],
  });

  const oldFirstName = oldData.firstName || oldData.first_name || req.first_name || '';
  const oldLastName = oldData.lastName || oldData.last_name || req.last_name || '';
  const oldName = `${oldFirstName} ${oldLastName}`.trim() || '—';

  const newFirstName = newData.firstName || req.first_name || '';
  const newLastName = newData.lastName || req.last_name || '';
  const newName = `${newFirstName} ${newLastName}`.trim() || '—';

  const oldFatherName = oldData.fatherName || oldData.father_name || req.father_name || '—';
  const newFatherName = newData.fatherName || req.father_name || '—';

  const oldPhone = oldData.phone || req.phone || '—';
  const newPhone = newData.phone || req.phone || '—';

  const oldPassport = `${oldData.passportSeries || oldData.passport_series || req.passport_series || ''} ${oldData.passportNumber || oldData.passport_number || req.passport_number || ''}`.trim() || '—';
  const newPassport = `${newData.passportSeries || req.passport_series || ''} ${newData.passportNumber || req.passport_number || ''}`.trim() || '—';

  const oldPosition = oldData.position || req.position || '—';
  const newPosition = newData.position || req.position || '—';

  const oldPlayerNumber = oldData.playerNumber ? `#${oldData.playerNumber}` : oldData.player_number ? `#${oldData.player_number}` : req.player_number ? `#${req.player_number}` : '—';
  const newPlayerNumber = newData.playerNumber ? `#${newData.playerNumber}` : req.player_number ? `#${req.player_number}` : '—';

  const oldCitizenship = oldData.citizenship || commentMeta.citizenship || req.citizenship || '—';
  const newCitizenship = newData.citizenship || oldCitizenship;

  const oldHeight = oldData.height || commentMeta.height || req.height || '';
  const oldWeight = oldData.weight || commentMeta.weight || req.weight || '';
  const oldHW = oldHeight || oldWeight ? `${oldHeight ? `${oldHeight} SM` : '—'} / ${oldWeight ? `${oldWeight} KG` : '—'}` : '— / —';

  const newHeight = newData.height || oldHeight;
  const newWeight = newData.weight || oldWeight;
  const newHW = newHeight || newWeight ? `${newHeight ? `${newHeight} SM` : '—'} / ${newWeight ? `${newWeight} KG` : '—'}` : '— / —';

  const oldBirthDate = oldData.birthDate || oldData.birth_date || req.birth_date || '—';
  const newBirthDate = newData.birthDate || req.birth_date || '—';

  const oldInsta =
    getInstaUser(oldData.instagramUsername) ||
    getInstaUser(oldData.instagram_username) ||
    getInstaUser(oldData.instagramUrl) ||
    extractInstaFromComment(req.comment) ||
    '—';
  const newInsta =
    getInstaUser(newData.instagramUsername) ||
    getInstaUser(newData.instagram_username) ||
    getInstaUser(newData.instagramUrl) ||
    extractInstaFromComment(req.comment) ||
    '—';

  return (
    <View style={{ position: 'relative' }}>
      {/* Particle Shatter Layer */}
      {particlesActive && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {particles.map((p, idx) => (
            <Animated.View
              key={idx}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: p.color,
                transform: [
                  { translateX: p.x },
                  { translateY: p.y },
                  { scale: p.scale },
                ],
                opacity: p.opacity,
                zIndex: 99,
              }}
            />
          ))}
        </View>
      )}

      <Animated.View
        style={[
          styles.updateCard,
          { borderColor: `${statusColor}33` },
          {
            transform: [
              { translateY },
              { translateX },
              { scale },
              { rotate: spin },
            ],
            opacity,
          },
        ]}
      >
        <BlurView intensity={80} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />

        {/* Animated Red Overlay Filter for Rejection */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: 'rgba(239, 68, 68, 0.35)',
              borderRadius: 18,
              borderWidth: 2,
              borderColor: '#EF4444',
              opacity: redOverlay,
              zIndex: 10,
            },
          ]}
        />

        {/* CARD HEADER */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>
            {new Date(req.created_at).toLocaleString('uz-UZ', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>

          {/* Clickable Status Badge for Testing Status Changes */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onStatusClick(req)}
            style={[styles.statusBadge, { backgroundColor: `${statusColor}1A`, borderColor: `${statusColor}40` }]}
          >
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
            <Ionicons name="options-outline" size={12} color={statusColor} style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>

        {/* PHOTO COMPARISON BOX */}
        <View style={styles.photoCompareBox}>
          <View style={styles.photoSide}>
            {oldPhoto ? (
              <Image source={{ uri: oldPhoto }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>{"Yo'q"}</Text>
              </View>
            )}
            <Text style={styles.photoLabel}>{"ESKI RASM"}</Text>
          </View>

          <Ionicons name="arrow-forward" size={18} color="#00FF66" />

          <View style={styles.photoSide}>
            {newPhoto ? (
              <Image source={{ uri: newPhoto }} style={[styles.avatarImg, { borderColor: '#00FF66', borderWidth: 2 }]} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: 'rgba(0, 255, 102, 0.1)' }]}>
                <Text style={[styles.avatarFallbackText, { color: '#00FF66' }]}>{"Bir xil"}</Text>
              </View>
            )}
            <Text style={[styles.photoLabel, { color: '#00FF66' }]}>{"YANGI RASM"}</Text>
          </View>
        </View>

        {/* DIFF ROWS COMPARISON */}
        <View style={{ gap: 8 }}>
          <DiffRow label="Ism-Familiya" oldVal={oldName} newVal={newName} showOnlyChanged={showOnlyChanged} />
          <DiffRow label="Otasining Ismi" oldVal={oldFatherName} newVal={newFatherName} showOnlyChanged={showOnlyChanged} />
          <DiffRow label="Telefon Raqami" oldVal={oldPhone} newVal={newPhone} showOnlyChanged={showOnlyChanged} />
          <DiffRow label="Pasport Seriya / Raqam" oldVal={oldPassport} newVal={newPassport} showOnlyChanged={showOnlyChanged} />
          <DiffRow label="Pozitsiya" oldVal={oldPosition} newVal={newPosition} showOnlyChanged={showOnlyChanged} />
          <DiffRow label="Forma Raqami" oldVal={oldPlayerNumber} newVal={newPlayerNumber} showOnlyChanged={showOnlyChanged} />
          <DiffRow label="Millati" oldVal={oldCitizenship} newVal={newCitizenship} showOnlyChanged={showOnlyChanged} />
          <DiffRow label="Bo'yi / Vazni" oldVal={oldHW} newVal={newHW} showOnlyChanged={showOnlyChanged} />
          <DiffRow label="Tug'ilgan Sana" oldVal={oldBirthDate} newVal={newBirthDate} showOnlyChanged={showOnlyChanged} />
          <DiffRow
            label="Instagram Username"
            oldVal={oldInsta !== '—' ? `@${oldInsta}` : '—'}
            newVal={newInsta !== '—' ? `@${newInsta}` : '—'}
            showOnlyChanged={showOnlyChanged}
          />
        </View>

        {/* CARD ACTION BUTTONS (Only shown for pending requests) */}
        {isPending ? (
          <View style={styles.cardActionsRow}>
            <TouchableOpacity
              style={[styles.actionIconBtn, styles.rejectIconBtn]}
              onPress={() => onReject(req, runRejectAnim)}
              disabled={isProcessing}
            >
              <Ionicons name="close" size={20} color="#EF4444" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionIconBtn, styles.deleteIconBtn]}
              onPress={() => onDeletePress(req, runDeleteAnim)}
              disabled={isProcessing}
            >
              <Ionicons name="trash-outline" size={20} color="#EF4444" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionIconBtn, styles.approveIconBtn]}
              onPress={() => onApprove(req, runApproveAnim)}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <Ionicons name="checkmark" size={20} color="#000000" />
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ marginTop: 12, alignItems: 'flex-end' }}>
            <View
              style={[
                styles.statusPillBadge,
                {
                  backgroundColor: `${statusColor}1F`,
                  borderColor: statusColor,
                },
              ]}
            >
              <Ionicons
                name={statusLabel.includes('Rad') || statusLabel.includes('RAD') ? "close-circle" : "checkmark-circle"}
                size={16}
                color={statusColor}
              />
              <Text style={[styles.statusPillText, { color: statusColor }]}>
                {statusLabel}
              </Text>
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
};

export const ProfileUpdatesScreen: React.FC = () => {
  const { orgId } = useOrg();
  const [activeTab, setActiveTab] = useState<'players' | 'teams'>('players');
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Full-Page Modals State for Approved & Rejected Requests
  const [showApprovedModal, setShowApprovedModal] = useState<boolean>(false);
  const [showRejectedModal, setShowRejectedModal] = useState<boolean>(false);
  const [approvedTab, setApprovedTab] = useState<'players' | 'teams'>('players');
  const [rejectedTab, setRejectedTab] = useState<'players' | 'teams'>('players');
  const [approvedSearchQuery, setApprovedSearchQuery] = useState<string>('');
  const [rejectedSearchQuery, setRejectedSearchQuery] = useState<string>('');

  // Delete confirmation modal state
  const [itemToDelete, setItemToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Testing status change modal state
  const [statusModalItem, setStatusModalItem] = useState<any | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    fetchProfileUpdateRequests();
  }, [orgId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchProfileUpdateRequests(true);
    setRefreshing(false);
  }, [orgId]);

  const dbClient = supabase;

  const handleQuickStatusChange = async (newStatus: string) => {
    if (!statusModalItem) return;
    setUpdatingStatus(true);
    try {
      const err = await updateTicketStatus(statusModalItem.id, newStatus);
      if (err) {
        Alert.alert('Xatolik', err.message);
      } else {
        setStatusModalItem(null);
        await fetchProfileUpdateRequests();
      }
    } catch (e: any) {
      Alert.alert('Xatolik', e.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const fetchProfileUpdateRequests = async (isRefreshing = false) => {
    if (!isRefreshing) setLoading(true);
    try {
      let query = dbClient
        .from('applications')
        .select('*')
        .ilike('comment', '%[PROFILE_UPDATE]%')
        .order('created_at', { ascending: false });

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data, error } = await query;
      if (error) console.error('Error fetching profile update requests:', error);

      const parsedList = (data || []).map((item: any) => {
        let parsedPayload = null;
        try {
          if (item.comment && item.comment.includes('[PROFILE_UPDATE]')) {
            const parts = item.comment.split('[PROFILE_UPDATE]');
            let jsonStr = parts[1] || '';
            const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsedPayload = JSON.parse(jsonMatch[0]);
            }
          }
        } catch (e) {
          console.warn('Failed to parse profile update payload:', e, item.comment);
        }

        return {
          ...item,
          payload: parsedPayload,
        };
      });

      setRequests(parsedList);
    } catch (err) {
      console.error('Error loading requests:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateTicketStatus = async (id: string, statusVal: string) => {
    let { error } = await dbClient.from('applications').update({ status: statusVal }).eq('id', id);
    if (error && (error.message.includes('valid_status') || error.code === '23514')) {
      const upperVal = statusVal.toUpperCase();
      const retryRes = await dbClient.from('applications').update({ status: upperVal }).eq('id', id);
      error = retryRes.error;
    }
    return error;
  };

  // Approve Request: Instant RAM Caching + Background DB Sync (NO Alerts)
  const handleApprove = async (reqItem: any) => {
    setProcessingId(reqItem.id);

    // 1. INSTANT OPTIMISTIC RAM STATE UPDATE (0ms delay)
    setRequests((prev) =>
      prev.map((r) => (r.id === reqItem.id ? { ...r, status: 'approved' } : r))
    );

    setToastMsg("Ariza muvaffaqiyatli tasdiqlandi! ✓");
    setTimeout(() => setToastMsg(null), 2500);

    // 2. Background DB Update
    try {
      const targetPlayerId = reqItem.payload?.playerId || reqItem.player_id;
      const newData = reqItem.payload?.newData || {};

      if (targetPlayerId) {
        const metaObj = {
          citizenship: newData.citizenship || '',
          height: newData.height || '',
          weight: newData.weight || '',
        };

        const cleanInsta = (newData.instagramUsername || '').trim().replace(/^@/, '');
        const instaUrl = newData.instagramUrl || (cleanInsta ? `https://www.instagram.com/${cleanInsta}/` : '');

        const { data: targetPlayer } = await dbClient
          .from('applications')
          .select('comment')
          .eq('id', targetPlayerId)
          .maybeSingle();

        const currentComment = targetPlayer?.comment || reqItem.comment || '';

        const cleanComment = currentComment
          .replace(/\[PROFILE_UPDATE\][\s\S]*/g, '')
          .replace(/\[METADATA:[^\]]+\]/g, '')
          .replace(/\[INSTAGRAM:[^\]]+\]/g, '')
          .trim();

        let updatedComment = cleanComment;
        if (metaObj.citizenship || metaObj.height || metaObj.weight) {
          updatedComment += ` [METADATA:${JSON.stringify(metaObj)}]`;
        }
        if (instaUrl) {
          updatedComment += ` [INSTAGRAM:${instaUrl}]`;
        }

        const updatePayload: any = {
          first_name: newData.firstName || reqItem.first_name,
          last_name: newData.lastName || reqItem.last_name,
          father_name: newData.fatherName || reqItem.father_name,
          phone: newData.phone || reqItem.phone,
          position: newData.position || reqItem.position,
          player_number: newData.playerNumber ? Number(newData.playerNumber) : reqItem.player_number,
          photo_url: newData.photoUrl || reqItem.photo_url,
          passport_series: newData.passportSeries || undefined,
          passport_number: newData.passportNumber || undefined,
          birth_date: newData.birthDate || undefined,
          comment: updatedComment.trim(),
        };

        Object.keys(updatePayload).forEach((key) => updatePayload[key] === undefined && delete updatePayload[key]);

        await dbClient.from('applications').update(updatePayload).eq('id', targetPlayerId);
        await dbClient.from('players').update(updatePayload).eq('id', targetPlayerId);
      }

      // Ensure the ticket itself is marked approved with team_id null so it NEVER creates a duplicate player
      if (reqItem.id !== targetPlayerId) {
        await dbClient.from('applications').update({ status: 'approved', team_id: null }).eq('id', reqItem.id);
      } else {
        await updateTicketStatus(reqItem.id, 'approved');
      }

      // Trigger push notification to player
      const targetPlayerIdForNotif = reqItem.payload?.playerId || reqItem.player_id || reqItem.id;
      adminNotificationService.notifyProfileUpdateStatus({
        playerId: targetPlayerIdForNotif,
        phone: reqItem.phone || reqItem.payload?.newData?.phone,
        playerName: `${reqItem.first_name || ''} ${reqItem.last_name || ''}`.trim() || 'Futbolchi',
        status: 'approved',
      });
    } catch (err: any) {
      console.error('Error approving request:', err);
    } finally {
      setProcessingId(null);
    }
  };

  // Reject Request: Instant RAM Caching + Background DB Sync (NO Alerts)
  const handleReject = async (reqItem: any) => {
    setProcessingId(reqItem.id);

    // 1. INSTANT OPTIMISTIC RAM STATE UPDATE (0ms delay)
    setRequests((prev) =>
      prev.map((r) => (r.id === reqItem.id ? { ...r, status: 'rejected' } : r))
    );

    setToastMsg("Ariza rad etildi! ✕");
    setTimeout(() => setToastMsg(null), 2500);

    // 2. Background DB Update
    try {
      const targetPlayerId = reqItem.payload?.playerId || reqItem.player_id;
      if (reqItem.id !== targetPlayerId) {
        await dbClient.from('applications').update({ status: 'rejected', team_id: null }).eq('id', reqItem.id);
      } else {
        await updateTicketStatus(reqItem.id, 'rejected');
      }

      // Trigger push notification to player
      adminNotificationService.notifyProfileUpdateStatus({
        playerId: targetPlayerId || reqItem.id,
        phone: reqItem.phone,
        playerName: `${reqItem.first_name || ''} ${reqItem.last_name || ''}`.trim() || 'Futbolchi',
        status: 'rejected',
      });
    } catch (err: any) {
      console.error('Error rejecting request:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleApproveWithAnim = async (reqItem: any, animFunc: () => Promise<void>) => {
    if (animFunc) await animFunc();
    await handleApprove(reqItem);
  };

  const handleRejectWithAnim = async (reqItem: any, animFunc: () => Promise<void>) => {
    if (animFunc) await animFunc();
    await handleReject(reqItem);
  };

  const handleDeleteWithAnim = async (reqItem: any, animFunc: () => Promise<void>) => {
    setItemToDelete({ ...reqItem, animFunc });
  };

  // Delete Request: Instant RAM Caching + Background DB Sync (NO Alerts)
  const executeDelete = async () => {
    if (!itemToDelete) return;
    const deleteId = itemToDelete.id;

    // 1. INSTANT OPTIMISTIC RAM STATE UPDATE (0ms delay)
    setRequests((prev) => prev.filter((r) => r.id !== deleteId));
    setItemToDelete(null);

    setToastMsg("Ariza o'chirildi! 🗑️");
    setTimeout(() => setToastMsg(null), 2500);

    // 2. Background DB Delete
    try {
      if (itemToDelete.animFunc) {
        await itemToDelete.animFunc();
      }
      await dbClient.from('applications').delete().eq('id', deleteId);
    } catch (err: any) {
      console.error('Error deleting request:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRequests = requests.filter((r) => {
    // 1. Tab filter (players vs teams)
    const matchesTab = activeTab === 'players' ? (!r.team_id || r.type !== 'team') : (r.team_id || r.type === 'team');
    if (!matchesTab) return false;

    // 2. Only show pending requests on main screen
    const statusVal = String(r.status || 'pending').toLowerCase();
    const isApproved = statusVal === 'approved' || statusVal === 'approved_update' || statusVal === 'tasdiqlangan';
    const isRejected = statusVal === 'rejected' || statusVal === 'rejected_update' || statusVal === 'rad_etilgan' || statusVal === 'rad etilgan';
    return !isApproved && !isRejected;
  });

  return (
    <View style={styles.container}>
      {/* FIXED TOP HEADER (Title, status icons, tabs, filters) */}
      <View style={styles.fixedHeaderContainer}>
        <BlurView intensity={50} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />

        {/* HEADER ROW */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>{"Ma'lumotlar Almashinuvi"}</Text>
            <Text style={styles.screenSub}>{"O'yinchilar ma'lumotlarini tahrirlash arizalari"}</Text>
          </View>

          <View style={styles.headerStatusFilterContainer}>
            <TouchableOpacity
              style={styles.statusFilterIconButton}
              onPress={() => setShowApprovedModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="checkmark-circle"
                size={22}
                color="#4ADE80"
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statusFilterIconButton}
              onPress={() => setShowRejectedModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="close-circle"
                size={22}
                color="#F87171"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* TABS & FILTER BAR */}
        <View style={styles.filterRow}>
          <View style={[styles.tabContainer, { flex: 1 }]}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'players' && styles.tabBtnActive]}
              onPress={() => setActiveTab('players')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'players' && styles.tabBtnTextActive]}>
                {"O'yinchilar"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'teams' && styles.tabBtnActive]}
              onPress={() => setActiveTab('teams')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'teams' && styles.tabBtnTextActive]}>
                {"Jamoalar"}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.toggleChangedBtn, showOnlyChanged && styles.toggleChangedBtnActive]}
            onPress={() => setShowOnlyChanged(!showOnlyChanged)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, showOnlyChanged && styles.checkboxActive]}>
              {showOnlyChanged && <Ionicons name="checkmark" size={12} color="#000000" />}
            </View>
            <Text style={[styles.toggleChangedText, showOnlyChanged && { color: '#00FF66' }]}>
              {"Faqat o'zgarganlar"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SCROLLABLE CARDS CONTENT BELOW BUTTONS WITH PULL DOWN RELOAD */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00FF66"
            colors={['#00FF66']}
          />
        }
      >
        {/* LIST SECTION */}
        {loading ? (
          <View style={{ gap: 16 }}>
            {[1, 2, 3].map((k) => (
              <View key={k} style={styles.cardSkeleton}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <SkeletonItem style={{ width: 120, height: 16, borderRadius: 4 }} />
                  <SkeletonItem style={{ width: 90, height: 20, borderRadius: 6 }} />
                </View>
                <SkeletonItem style={{ width: '100%', height: 60, borderRadius: 12, marginVertical: 14 }} />
                <View style={{ gap: 8 }}>
                  <SkeletonItem style={{ width: '100%', height: 32, borderRadius: 8 }} />
                  <SkeletonItem style={{ width: '100%', height: 32, borderRadius: 8 }} />
                </View>
              </View>
            ))}
          </View>
        ) : filteredRequests.length === 0 ? (
          <View style={styles.emptyCard}>
            <BlurView intensity={80} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
            <Ionicons name="document-text-outline" size={48} color="rgba(255,255,255,0.2)" />
            <Text style={styles.emptyTitle}>{"Arizalar topilmadi"}</Text>
            <Text style={styles.emptyText}>
              {"Hozircha ma'lumotlarni almashtirish bo'yicha arizalar mavjud emas."}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {filteredRequests.map((req) => {
              const oldData = req.payload?.oldData || {};
              const newData = req.payload?.newData || {};
              const isPending = req.status === 'pending' || !req.status;
              const isApproved = req.status === 'approved' || req.status === 'approved_update';
              const isRejected = req.status === 'rejected' || req.status === 'rejected_update';

              const statusColor = isApproved ? '#00FF66' : isRejected ? '#EF4444' : '#F59E0B';
              const statusLabel = isApproved ? 'Tasdiqlangan' : isRejected ? 'Rad Etilgan' : 'Kutilmoqda';

              const getCleanUrl = (url: any) => {
                if (!url || typeof url !== 'string') return '';
                const str = url.trim();
                if (str.startsWith('file:') || str.startsWith('content:') || str.startsWith('ph:') || str.startsWith('blob:')) return '';
                if (str.startsWith('http://') || str.startsWith('https://')) return str;
                return '';
              };

              const rawOld = oldData.photoUrl || oldData.photo || req.photo_url || req.photo || req.avatar || '';
              const rawNew = newData.photoUrl || newData.photo || '';
              const oldPhoto = getCleanUrl(rawOld);
              const newPhoto = getCleanUrl(rawNew) || oldPhoto;
              const commentMeta = extractMetaFromComment(req.comment);

              return (
                <UpdateCardItem
                  key={req.id}
                  req={req}
                  showOnlyChanged={showOnlyChanged}
                  isProcessing={processingId === req.id}
                  statusColor={statusColor}
                  statusLabel={statusLabel}
                  isPending={isPending}
                  oldData={oldData}
                  newData={newData}
                  oldPhoto={oldPhoto}
                  newPhoto={newPhoto}
                  commentMeta={commentMeta}
                  onApprove={(item, anim) => handleApproveWithAnim(item, anim)}
                  onReject={(item, anim) => handleRejectWithAnim(item, anim)}
                  onDeletePress={(item, anim) => handleDeleteWithAnim(item, anim)}
                  onStatusClick={(item) => setStatusModalItem(item)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* STATUS CHANGE TEST MODAL */}
      <Modal visible={!!statusModalItem} transparent animationType="fade" onRequestClose={() => setStatusModalItem(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 360, padding: 22 }]}>
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900', marginBottom: 6, textAlign: 'center' }}>
              {"Arizaning Holatini O'zgartirish"}
            </Text>
            <Text style={{ color: '#94A3B8', fontSize: 12, marginBottom: 18, textAlign: 'center' }}>
              {"Animatsiyalarni va sahifani qayta-qayta sinash uchun holatni tanlang:"}
            </Text>

            <View style={{ gap: 10 }}>
              <TouchableOpacity
                style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', borderWidth: 1, borderColor: '#F59E0B', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
                onPress={() => handleQuickStatusChange('pending')}
                disabled={updatingStatus}
              >
                <Text style={{ color: '#F59E0B', fontWeight: '900', fontSize: 13 }}>{"KUTILMOQDA (Pending)"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ backgroundColor: 'rgba(74, 222, 128, 0.15)', borderWidth: 1, borderColor: '#4ADE80', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
                onPress={() => handleQuickStatusChange('approved')}
                disabled={updatingStatus}
              >
                <Text style={{ color: '#4ADE80', fontWeight: '900', fontSize: 13 }}>{"TASDIQLANGAN (Approved)"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: '#EF4444', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
                onPress={() => handleQuickStatusChange('rejected')}
                disabled={updatingStatus}
              >
                <Text style={{ color: '#EF4444', fontWeight: '900', fontSize: 13 }}>{"RAD ETILGAN (Rejected)"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 6 }}
                onPress={() => setStatusModalItem(null)}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>{"Bekor qilish"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal visible={!!itemToDelete} transparent animationType="fade" onRequestClose={() => setItemToDelete(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 400, padding: 22, alignItems: 'center' }]}>
            <View style={styles.deleteIconBg}>
              <Ionicons name="trash-outline" size={32} color="#EF4444" />
            </View>
            <Text style={styles.deleteTitle}>{"Arizani O'chirish"}</Text>
            <Text style={styles.deleteSub}>
              {"Ushbu ma'lumotlarni almashtirish arizasini rostdan ham o'chirib tashlamoqchimisiz?"}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginTop: 20 }}>
              <TouchableOpacity style={[styles.modalCancelBtn, { flex: 1 }]} onPress={() => setItemToDelete(null)}>
                <Text style={styles.modalCancelText}>{"Bekor qilish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSaveBtn, { flex: 1, backgroundColor: '#EF4444' }]}
                onPress={executeDelete}
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

      {/* FLOATING TOAST NOTIFICATION */}
      {toastMsg && (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={20} color="#00FF66" />
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      )}

      {/* FULL-PAGE MODAL: APPROVED REQUESTS */}
      <Modal
        visible={showApprovedModal}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowApprovedModal(false)}
      >
        <View style={styles.modalPageContainer}>
          {/* HEADER */}
          <View style={styles.modalPageHeader}>
            <TouchableOpacity
              style={styles.modalPageBackBtn}
              onPress={() => setShowApprovedModal(false)}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={styles.modalPageTitle}>{"Qabul Qilingan Arizalar"}</Text>
              <Text style={styles.modalPageSub}>{"Tasdiqlangan va o'zgartirilgan profil arizalari ruyxati"}</Text>
            </View>
          </View>

          {/* SEARCH BAR */}
          <View style={styles.modalSearchBox}>
            <Ionicons name="search" size={18} color="rgba(255, 255, 255, 0.4)" />
            <TextInput
              style={styles.modalSearchInput}
              placeholder="F.I.SH yoki Ism bo'yicha qidiruv..."
              placeholderTextColor="rgba(255, 255, 255, 0.35)"
              value={approvedSearchQuery}
              onChangeText={setApprovedSearchQuery}
            />
            {approvedSearchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setApprovedSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color="rgba(255, 255, 255, 0.4)" />
              </TouchableOpacity>
            )}
          </View>

          {/* SUB-TABS */}
          <View style={[styles.tabContainer, { marginBottom: 14 }]}>
            <TouchableOpacity
              style={[styles.tabBtn, approvedTab === 'players' && styles.tabBtnActive]}
              onPress={() => setApprovedTab('players')}
            >
              <Text style={[styles.tabBtnText, approvedTab === 'players' && styles.tabBtnTextActive]}>
                {"O'yinchilar"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, approvedTab === 'teams' && styles.tabBtnActive]}
              onPress={() => setApprovedTab('teams')}
            >
              <Text style={[styles.tabBtnText, approvedTab === 'teams' && styles.tabBtnTextActive]}>
                {"Jamoalar"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* APPROVED CARDS LIST */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 60, gap: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {requests
              .filter((r) => {
                const statusVal = String(r.status || '').toLowerCase();
                const isApproved = statusVal === 'approved' || statusVal === 'approved_update' || statusVal === 'tasdiqlangan';
                if (!isApproved) return false;

                const matchesTab = approvedTab === 'players' ? (!r.team_id || r.type !== 'team') : (r.team_id || r.type === 'team');
                if (!matchesTab) return false;

                if (approvedSearchQuery.trim()) {
                  const q = approvedSearchQuery.toLowerCase();
                  const nameStr = `${r.first_name || ''} ${r.last_name || ''} ${r.payload?.newData?.firstName || ''} ${r.payload?.newData?.lastName || ''}`.toLowerCase();
                  return nameStr.includes(q);
                }
                return true;
              })
              .map((req) => {
                const oldData = req.payload?.oldData || {};
                const newData = req.payload?.newData || {};
                const statusColor = '#00FF66';
                const statusLabel = '✓ Tasdiqlangan';

                const getCleanUrl = (url: any) => {
                  if (!url || typeof url !== 'string') return '';
                  const str = url.trim();
                  if (str.startsWith('file:') || str.startsWith('content:') || str.startsWith('ph:') || str.startsWith('blob:')) return '';
                  if (str.startsWith('http://') || str.startsWith('https://')) return str;
                  return '';
                };

                const rawOld = oldData.photoUrl || oldData.photo || req.photo_url || req.photo || req.avatar || '';
                const rawNew = newData.photoUrl || newData.photo || '';
                const oldPhoto = getCleanUrl(rawOld);
                const newPhoto = getCleanUrl(rawNew) || oldPhoto;
                const commentMeta = extractMetaFromComment(req.comment);

                return (
                  <UpdateCardItem
                    key={req.id}
                    req={req}
                    showOnlyChanged={showOnlyChanged}
                    isProcessing={false}
                    statusColor={statusColor}
                    statusLabel={statusLabel}
                    isPending={false}
                    oldData={oldData}
                    newData={newData}
                    oldPhoto={oldPhoto}
                    newPhoto={newPhoto}
                    commentMeta={commentMeta}
                    onApprove={() => {}}
                    onReject={() => {}}
                    onDeletePress={() => {}}
                    onStatusClick={() => {}}
                  />
                );
              })}
          </ScrollView>
        </View>
      </Modal>

      {/* FULL-PAGE MODAL: REJECTED REQUESTS */}
      <Modal
        visible={showRejectedModal}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowRejectedModal(false)}
      >
        <View style={styles.modalPageContainer}>
          {/* HEADER */}
          <View style={styles.modalPageHeader}>
            <TouchableOpacity
              style={styles.modalPageBackBtn}
              onPress={() => setShowRejectedModal(false)}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={styles.modalPageTitle}>{"Rad Etilgan Arizalar"}</Text>
              <Text style={styles.modalPageSub}>{"Rad etilgan profil almashtirish arizalari ruyxati"}</Text>
            </View>
          </View>

          {/* SEARCH BAR */}
          <View style={styles.modalSearchBox}>
            <Ionicons name="search" size={18} color="rgba(255, 255, 255, 0.4)" />
            <TextInput
              style={styles.modalSearchInput}
              placeholder="F.I.SH yoki Ism bo'yicha qidiruv..."
              placeholderTextColor="rgba(255, 255, 255, 0.35)"
              value={rejectedSearchQuery}
              onChangeText={setRejectedSearchQuery}
            />
            {rejectedSearchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setRejectedSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color="rgba(255, 255, 255, 0.4)" />
              </TouchableOpacity>
            )}
          </View>

          {/* SUB-TABS */}
          <View style={[styles.tabContainer, { marginBottom: 14 }]}>
            <TouchableOpacity
              style={[styles.tabBtn, rejectedTab === 'players' && styles.tabBtnActive]}
              onPress={() => setRejectedTab('players')}
            >
              <Text style={[styles.tabBtnText, rejectedTab === 'players' && styles.tabBtnTextActive]}>
                {"O'yinchilar"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, rejectedTab === 'teams' && styles.tabBtnActive]}
              onPress={() => setRejectedTab('teams')}
            >
              <Text style={[styles.tabBtnText, rejectedTab === 'teams' && styles.tabBtnTextActive]}>
                {"Jamoalar"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* REJECTED CARDS LIST */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 60, gap: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {requests
              .filter((r) => {
                const statusVal = String(r.status || '').toLowerCase();
                const isRejected = statusVal === 'rejected' || statusVal === 'rejected_update' || statusVal === 'rad_etilgan' || statusVal === 'rad etilgan';
                if (!isRejected) return false;

                const matchesTab = rejectedTab === 'players' ? (!r.team_id || r.type !== 'team') : (r.team_id || r.type === 'team');
                if (!matchesTab) return false;

                if (rejectedSearchQuery.trim()) {
                  const q = rejectedSearchQuery.toLowerCase();
                  const nameStr = `${r.first_name || ''} ${r.last_name || ''} ${r.payload?.newData?.firstName || ''} ${r.payload?.newData?.lastName || ''}`.toLowerCase();
                  return nameStr.includes(q);
                }
                return true;
              })
              .map((req) => {
                const oldData = req.payload?.oldData || {};
                const newData = req.payload?.newData || {};
                const statusColor = '#EF4444';
                const statusLabel = '✕ Rad Etilgan';

                const getCleanUrl = (url: any) => {
                  if (!url || typeof url !== 'string') return '';
                  const str = url.trim();
                  if (str.startsWith('file:') || str.startsWith('content:') || str.startsWith('ph:') || str.startsWith('blob:')) return '';
                  if (str.startsWith('http://') || str.startsWith('https://')) return str;
                  return '';
                };

                const rawOld = oldData.photoUrl || oldData.photo || req.photo_url || req.photo || req.avatar || '';
                const rawNew = newData.photoUrl || newData.photo || '';
                const oldPhoto = getCleanUrl(rawOld);
                const newPhoto = getCleanUrl(rawNew) || oldPhoto;
                const commentMeta = extractMetaFromComment(req.comment);

                return (
                  <UpdateCardItem
                    key={req.id}
                    req={req}
                    showOnlyChanged={showOnlyChanged}
                    isProcessing={false}
                    statusColor={statusColor}
                    statusLabel={statusLabel}
                    isPending={false}
                    oldData={oldData}
                    newData={newData}
                    oldPhoto={oldPhoto}
                    newPhoto={newPhoto}
                    commentMeta={commentMeta}
                    onApprove={() => {}}
                    onReject={() => {}}
                    onDeletePress={() => {}}
                    onStatusClick={() => {}}
                  />
                );
              })}
          </ScrollView>
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
  fixedHeaderContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    zIndex: 100,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
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
  headerStatusFilterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusFilterIconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  approvedFilterBtnActive: {
    backgroundColor: 'rgba(74, 222, 128, 0.18)',
    borderColor: 'rgba(74, 222, 128, 0.5)',
  },
  rejectedFilterBtnActive: {
    backgroundColor: 'rgba(248, 113, 113, 0.18)',
    borderColor: 'rgba(248, 113, 113, 0.5)',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 3,
    height: 40,
    alignItems: 'center',
  },
  tabBtn: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  tabBtnActive: {
    backgroundColor: '#00FF66',
  },
  tabBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '800',
  },
  tabBtnTextActive: {
    color: '#000000',
  },
  toggleChangedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  toggleChangedBtnActive: {
    backgroundColor: 'rgba(0, 255, 102, 0.1)',
    borderColor: 'rgba(0, 255, 102, 0.3)',
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: '#00FF66',
    borderColor: '#00FF66',
  },
  toggleChangedText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11.5,
    fontWeight: '700',
  },
  cardSkeleton: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 18,
    padding: 16,
  },
  emptyCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 20,
    padding: 36,
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    marginTop: 10,
    overflow: 'hidden',
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 12,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 4,
  },
  updateCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    gap: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 10,
  },
  cardDate: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  photoCompareBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  photoSide: {
    alignItems: 'center',
    gap: 6,
  },
  avatarImg: {
    width: 48,
    height: 48,
    borderRadius: 12,
    resizeMode: 'cover',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  photoLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
  },
  diffRowContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  diffRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  diffRowLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  changedBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  changedBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  sameText: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 9.5,
  },
  diffValuesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  diffOldVal: {
    flex: 1,
    fontSize: 12.5,
  },
  diffNewVal: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12.5,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 6,
  },
  actionIconBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectIconBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  deleteIconBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.5)',
  },
  approveIconBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
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
  toastBanner: {
    position: 'absolute',
    top: 14,
    left: 20,
    right: 20,
    zIndex: 9999,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1.2,
    borderColor: '#00FF66',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  modalPageContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 20,
  },
  modalPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  modalPageBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPageTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  modalPageSub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 14,
    gap: 8,
  },
  modalSearchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  statusPillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
