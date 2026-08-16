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
  TextInput,
  Alert,
  Animated,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';
import { adminNotificationService } from '../utils/adminNotificationService';

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

// Animated Card Component for Transfer Requests with Paper Flying, Red Overlay & Particle Shatter
const TransferCardItem: React.FC<{
  item: any;
  statusColor: string;
  statusLabel: string;
  isPending: boolean;
  isApproved: boolean;
  isRejected: boolean;
  onApprove: (item: any, startAnim: () => Promise<void>) => void;
  onReject: (item: any, startAnim: () => Promise<void>) => void;
  onDeletePress: (item: any, startAnim: () => Promise<void>) => void;
  onEditPress: (item: any) => void;
  onStatusClick: (item: any) => void;
}> = ({
  item,
  statusColor,
  statusLabel,
  isPending,
  isApproved,
  isRejected,
  onApprove,
  onReject,
  onDeletePress,
  onEditPress,
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

  // Paper Fly Animation for Approval
  const runApproveAnim = (): Promise<void> => {
    return new Promise((resolve) => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -280, duration: 550, useNativeDriver: true }),
        Animated.timing(translateX, { toValue: 120, duration: 550, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.05, duration: 550, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 550, useNativeDriver: true }),
      ]).start(() => resolve());
    });
  };

  // Red Overlay + Fly Animation for Rejection
  const runRejectAnim = (): Promise<void> => {
    return new Promise((resolve) => {
      Animated.timing(redOverlay, { toValue: 1, duration: 220, useNativeDriver: true }).start(() => {
        Animated.parallel([
          Animated.timing(translateY, { toValue: -280, duration: 500, useNativeDriver: true }),
          Animated.timing(translateX, { toValue: 160, duration: 500, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.05, duration: 500, useNativeDriver: true }),
          Animated.timing(rotate, { toValue: -1, duration: 500, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]).start(() => resolve());
      });
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
          styles.transferCard,
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
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />

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

        {/* Card Top Action Bar */}
        <View style={styles.cardHeader}>
          {/* Status Pill (Disabled for approved transfers) */}
          {isApproved ? (
            <View style={[styles.statusPill, { backgroundColor: 'rgba(0, 255, 102, 0.12)', borderColor: 'rgba(0, 255, 102, 0.35)' }]}>
              <Ionicons name="checkmark-circle" size={14} color="#00FF66" />
              <Text style={[styles.statusPillText, { color: '#00FF66' }]}>{statusLabel}</Text>
              <Ionicons name="lock-closed" size={11} color="#00FF66" style={{ marginLeft: 4, opacity: 0.8 }} />
            </View>
          ) : (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onStatusClick(item)}
              style={[styles.statusPill, { backgroundColor: `${statusColor}1A`, borderColor: `${statusColor}40` }]}
            >
              <Ionicons
                name={isRejected ? "close-circle" : "time-outline"}
                size={14}
                color={statusColor}
              />
              <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
              <Ionicons name="options-outline" size={12} color={statusColor} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          )}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.iconActionBtn} onPress={() => onEditPress(item)}>
              <Ionicons name="pencil" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.iconActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}
              onPress={() => onDeletePress(item, runDeleteAnim)}
            >
              <Ionicons name="trash-outline" size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Player Profile Header */}
        <View style={styles.playerRow}>
          {item.player_photo ? (
            <Image source={{ uri: item.player_photo }} style={styles.playerAvatar} />
          ) : (
            <View style={styles.playerAvatarFallback}>
              <Text style={styles.playerAvatarInitial}>{(item.player_name || '?')[0]}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.playerName}>{item.player_name || "O'yinchi"}</Text>
            <Text style={styles.transferReason}>
              {item.reason ? `"${item.reason}"` : "Transfer so'rovi"}
            </Text>
          </View>
        </View>

        {/* Teams Movement Flow Box */}
        <View style={styles.teamsFlowBox}>
          {/* Old Team */}
          <View style={styles.teamSide}>
            {item.old_team_logo ? (
              <Image source={{ uri: item.old_team_logo }} style={styles.teamLogo} />
            ) : (
              <View style={styles.teamLogoFallback}>
                <Ionicons name="shield-outline" size={18} color="rgba(255,255,255,0.4)" />
              </View>
            )}
            <Text style={styles.teamName} numberOfLines={1}>
              {item.old_team_name || 'Eski jamoasi'}
            </Text>
          </View>

          {/* Swap Arrow Icon */}
          <View style={styles.swapCircle}>
            <Ionicons name="arrow-forward" size={18} color="#00FF66" />
          </View>

          {/* New Team */}
          <View style={styles.teamSide}>
            {item.new_team_logo ? (
              <Image source={{ uri: item.new_team_logo }} style={styles.teamLogo} />
            ) : (
              <View style={styles.teamLogoFallback}>
                <Ionicons name="shield-outline" size={18} color="rgba(255,255,255,0.4)" />
              </View>
            )}
            <Text style={[styles.teamName, { color: '#00FF66' }]} numberOfLines={1}>
              {item.new_team_name || 'Yangi jamoasi'}
            </Text>
          </View>
        </View>

        {/* Card Action Buttons (Icon-only buttons matching ProfileUpdatesScreen) */}
        <View style={styles.cardActionsRow}>
          {isPending && (
            <>
              <TouchableOpacity
                style={[styles.btnAction, styles.btnReject]}
                onPress={() => onReject(item, runRejectAnim)}
              >
                <Ionicons name="close" size={20} color="#EF4444" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btnAction, styles.btnApprove]}
                onPress={() => onApprove(item, runApproveAnim)}
              >
                <Ionicons name="checkmark" size={20} color="#000000" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
};

export const TransfersScreen: React.FC = () => {
  const { orgId, currentOrg, transferWindowOpen, setTransferWindowOpen } = useOrg();

  // Data State
  const [transfers, setTransfers] = useState<any[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [windowLoading, setWindowLoading] = useState(false);
  const [windowToggling, setWindowToggling] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [showApprovedModal, setShowApprovedModal] = useState(false);
  const [showRejectedModal, setShowRejectedModal] = useState(false);
  const [approvedSearchQuery, setApprovedSearchQuery] = useState('');
  const [rejectedSearchQuery, setRejectedSearchQuery] = useState('');

  // Edit Modal State
  const [editingTransfer, setEditingTransfer] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    player_name: '',
    player_photo: '',
    reason: '',
    status: 'pending',
    league_id: '',
    league_name: '',
    old_team_id: '',
    old_team_name: '',
    old_team_logo: '',
    new_team_id: '',
    new_team_name: '',
    new_team_logo: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Active Picker Overlay inside Edit Modal
  const [activePicker, setActivePicker] = useState<'league' | 'old_team' | 'new_team' | 'status' | null>(null);

  // Delete Confirmation Modal State
  const [transferToDelete, setTransferToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Testing status change modal state
  const [statusModalItem, setStatusModalItem] = useState<any | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    fetchTransfers();
    fetchWindowStatus();

    // Supabase Realtime subscription for transfers
    const channel = supabase
      .channel('admin_transfers_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transfers' },
        () => {
          fetchTransfers(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTransfers(true);
    await fetchWindowStatus();
    setRefreshing(false);
  }, [orgId]);

  const dbClient = supabase;

  const handleQuickStatusChange = async (newStatus: string) => {
    if (!statusModalItem) return;
    setUpdatingStatus(true);
    try {
      await handleUpdateTransferStatus(statusModalItem, newStatus);
      setStatusModalItem(null);
    } catch (e: any) {
      Alert.alert('Xatolik', e.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  // 1. Fetch Transfer Window Status
  const fetchWindowStatus = async () => {
    setWindowLoading(true);
    try {
      const { data } = await dbClient
        .from('organizations')
        .select('transfer_window_open')
        .eq('id', orgId || 1)
        .maybeSingle();

      if (data && data.transfer_window_open !== undefined && data.transfer_window_open !== null) {
        setTransferWindowOpen(!!data.transfer_window_open);
      }
    } catch (e) {
      console.error('Fetch window status error:', e);
    } finally {
      setWindowLoading(false);
    }
  };

  // 2. Fetch Transfers, Teams, and Leagues (Matching amatora-organization logic)
  const fetchTransfers = async (isRefreshing = false) => {
    if (!isRefreshing) setLoading(true);
    try {
      const targetOrgId = orgId || 1;

      // Fetch Teams
      const { data: orgTeams } = await dbClient
        .from('teams')
        .select('id, name, logo_url, league, league_id, league_name')
        .eq('organization_id', targetOrgId)
        .order('name');

      if (orgTeams) {
        setAllTeams(orgTeams);
      }

      // Fetch Leagues
      const { data: orgLeagues } = await dbClient
        .from('leagues')
        .select('id, name')
        .eq('organization_id', targetOrgId)
        .order('name');

      if (orgLeagues) {
        setLeagues(orgLeagues);
      }

      const teamIdSet = new Set((orgTeams || []).map((t) => String(t.id)));

      const { data, error } = await dbClient
        .from('transfers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching transfers:', error);
        setTransfers([]);
      } else {
        const allTransfers = data || [];
        const orgTransfers = allTransfers.filter((t: any) => {
          if (t.organization_id && Number(t.organization_id) === Number(targetOrgId)) return true;
          const oldMatch = t.old_team_id && teamIdSet.has(String(t.old_team_id));
          const newMatch = t.new_team_id && teamIdSet.has(String(t.new_team_id));
          if (oldMatch || newMatch) return true;
          if (!t.organization_id && (Number(targetOrgId) === 1 || teamIdSet.size === 0)) return true;
          return false;
        });
        setTransfers(orgTransfers);
      }
    } catch (e) {
      console.error('Fetch transfers error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 3. Toggle Transfer Window & Send Push Notifications
  const handleToggleTransferWindow = async (val: boolean) => {
    if (windowToggling) return;
    setWindowToggling(true);
    setTransferWindowOpen(val);

    try {
      const { error } = await dbClient
        .from('organizations')
        .update({ transfer_window_open: val })
        .eq('id', orgId || 1);

      if (error) throw error;

      if (val) {
        sendTransferWindowNotification();
      }
    } catch (err: any) {
      console.error('Error toggling transfer window:', err);
      Alert.alert('Xatolik', "Transfer oynasini o'zgartirishda xatolik yuz berdi");
      setTransferWindowOpen(!val);
    } finally {
      setWindowToggling(false);
    }
  };

  const sendTransferWindowNotification = async () => {
    try {
      const { data: orgTeams } = await dbClient
        .from('teams')
        .select('id')
        .eq('organization_id', orgId || 1);

      if (!orgTeams || orgTeams.length === 0) return;
      const teamIds = orgTeams.map((t) => t.id);

      const { data: players } = await dbClient
        .from('applications')
        .select('expo_push_token')
        .in('team_id', teamIds)
        .not('expo_push_token', 'is', null);

      if (!players || players.length === 0) return;

      const tokens = players
        .map((p) => p.expo_push_token)
        .filter((t) => t && t.startsWith('ExponentPushToken'));

      if (tokens.length === 0) return;

      const messages = tokens.map((token) => ({
        to: token,
        sound: 'default',
        title: '🔄 Transfer oynasi ochildi!',
        body: `${currentOrg?.name || 'Tashkilot'} uchun transfer oynasi ochildi. Boshqa jamoaga o'tish so'rovini yuborishingiz mumkin.`,
        data: { type: 'transfer_window_opened' },
      }));

      for (let i = 0; i < messages.length; i += 100) {
        const batch = messages.slice(i, i + 100);
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(batch),
        }).catch((err) => console.warn('Push send error:', err));
      }
    } catch (err) {
      console.warn('Notification send error:', err);
    }
  };

  // 4. Status Action Handler (Approve / Reject / Pending with Atomic RPC)
  const handleUpdateTransferStatus = async (transfer: any, newStatus: string) => {
    try {
      const oldStatus = transfer.status;
      if (oldStatus === newStatus) return;

      if (newStatus === 'approved') {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('approve_transfer_request', {
          p_transfer_id: Number(transfer.id),
        });

        if (rpcErr || !rpcRes?.success) {
          const { error: transferError } = await dbClient
            .from('transfers')
            .update({ status: 'approved' })
            .eq('id', transfer.id);
          if (transferError) throw transferError;

          if (transfer.player_id && transfer.new_team_id) {
            await dbClient.from('applications').update({ team_id: transfer.new_team_id }).eq('id', transfer.player_id);
            await dbClient.from('players').update({ team_id: transfer.new_team_id }).eq('id', transfer.player_id);
          }
        }
      } else if (newStatus === 'rejected') {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('reject_transfer_request', {
          p_transfer_id: Number(transfer.id),
        });

        if (rpcErr || !rpcRes?.success) {
          const { error: transferError } = await dbClient
            .from('transfers')
            .update({ status: 'rejected' })
            .eq('id', transfer.id);
          if (transferError) throw transferError;
        }
      } else {
        const { error: transferError } = await dbClient
          .from('transfers')
          .update({ status: newStatus })
          .eq('id', transfer.id);
        if (transferError) throw transferError;
      }

      // Trigger push notification to player and involved teams
      adminNotificationService.notifyTransferStatus({
        playerId: transfer.player_id || transfer.playerId,
        playerName: transfer.player_name || transfer.playerName || 'Futbolchi',
        oldTeamId: transfer.old_team_id,
        newTeamId: transfer.new_team_id,
        oldTeamName: transfer.old_team_name || transfer.oldTeamName,
        newTeamName: transfer.new_team_name || transfer.newTeamName,
        status: newStatus,
      });

      fetchTransfers();
    } catch (err: any) {
      console.error('Error updating transfer status:', err);
      Alert.alert('Xatolik', err.message || "Statusni o'zgartirishda xatolik yuz berdi");
    }
  };

  const handleApproveWithAnim = async (item: any, animFunc: () => Promise<void>) => {
    if (animFunc) await animFunc();
    await handleUpdateTransferStatus(item, 'approved');
  };

  const handleRejectWithAnim = async (item: any, animFunc: () => Promise<void>) => {
    if (animFunc) await animFunc();
    await handleUpdateTransferStatus(item, 'rejected');
  };

  const handleDeleteWithAnim = async (item: any, animFunc: () => Promise<void>) => {
    setTransferToDelete({ ...item, animFunc });
  };

  // 5. Delete Transfer
  const executeDeleteTransfer = async () => {
    if (!transferToDelete) return;
    setIsDeleting(true);
    try {
      if (transferToDelete.animFunc) {
        await transferToDelete.animFunc();
      }
      const { error } = await dbClient
        .from('transfers')
        .delete()
        .eq('id', transferToDelete.id);

      if (error) throw error;

      setTransferToDelete(null);
      fetchTransfers();
    } catch (err: any) {
      console.error('Error deleting transfer:', err);
      Alert.alert('Xatolik', "O'chirishda xatolik yuz berdi");
    } finally {
      setIsDeleting(false);
    }
  };

  // 6. Save Edit Form
  const handleSaveEdit = async () => {
    if (!editingTransfer) return;
    setSavingEdit(true);
    try {
      const selectedOld = allTeams.find((t) => String(t.id) === String(editForm.old_team_id));
      const selectedNew = allTeams.find((t) => String(t.id) === String(editForm.new_team_id));
      const selectedLeague = leagues.find((l) => String(l.id) === String(editForm.league_id));

      const oldTeamId = selectedOld ? selectedOld.id : editForm.old_team_id || null;
      const oldTeamName = selectedOld ? selectedOld.name : editForm.old_team_name;
      const oldTeamLogo = selectedOld ? selectedOld.logo_url : editForm.old_team_logo;

      const newTeamId = selectedNew ? selectedNew.id : editForm.new_team_id || null;
      const newTeamName = selectedNew ? selectedNew.name : editForm.new_team_name;
      const newTeamLogo = selectedNew ? selectedNew.logo_url : editForm.new_team_logo;

      const leagueId = selectedLeague ? selectedLeague.id : editForm.league_id || null;
      const leagueName = selectedLeague ? selectedLeague.name : editForm.league_name;

      const oldStatus = editingTransfer.status;
      const newStatus = editForm.status;

      const { error } = await dbClient
        .from('transfers')
        .update({
          reason: editForm.reason,
          status: newStatus,
          league_id: leagueId,
          league_name: leagueName,
          old_team_id: oldTeamId,
          old_team_name: oldTeamName,
          old_team_logo: oldTeamLogo,
          new_team_id: newTeamId,
          new_team_name: newTeamName,
          new_team_logo: newTeamLogo,
        })
        .eq('id', editingTransfer.id);

      if (error) throw error;

      if (editingTransfer.player_id) {
        if (newStatus === 'approved' && newTeamId) {
          await dbClient
            .from('applications')
            .update({ team_id: newTeamId })
            .eq('id', editingTransfer.player_id);

          await dbClient
            .from('players')
            .update({ team_id: newTeamId })
            .eq('id', editingTransfer.player_id);
        } else if (
          oldStatus === 'approved' &&
          (newStatus === 'pending' || newStatus === 'rejected') &&
          oldTeamId
        ) {
          await dbClient
            .from('applications')
            .update({ team_id: oldTeamId })
            .eq('id', editingTransfer.player_id);

          await dbClient
            .from('players')
            .update({ team_id: oldTeamId })
            .eq('id', editingTransfer.player_id);
        }
      }

      setEditingTransfer(null);
      fetchTransfers();
    } catch (err: any) {
      console.error('Error saving transfer edit:', err);
      Alert.alert('Xatolik', 'Saqlashda xatolik yuz berdi: ' + (err.message || ''));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenEdit = (t: any) => {
    setEditingTransfer(t);

    let foundLeagueId = t.league_id || '';
    let foundLeagueName = t.league_name || '';

    // Check old team for league if missing
    if (!foundLeagueName && t.old_team_id) {
      const teamObj = allTeams.find((tm) => String(tm.id) === String(t.old_team_id));
      if (teamObj) {
        foundLeagueId = teamObj.league_id || teamObj.league || foundLeagueId;
        foundLeagueName = teamObj.league_name || teamObj.league || foundLeagueName;
      }
    }

    // Match with leagues array or fallback to first league
    if (leagues.length > 0) {
      const matchLg = leagues.find((lg) => String(lg.id) === String(foundLeagueId) || lg.name === foundLeagueName);
      if (matchLg) {
        foundLeagueId = matchLg.id;
        foundLeagueName = matchLg.name;
      } else if (!foundLeagueName && leagues[0]) {
        foundLeagueId = leagues[0].id;
        foundLeagueName = leagues[0].name;
      }
    }

    setEditForm({
      player_name: t.player_name || '',
      player_photo: t.player_photo || '',
      reason: t.reason || '',
      status: t.status || 'pending',
      league_id: foundLeagueId,
      league_name: foundLeagueName,
      old_team_id: t.old_team_id || '',
      old_team_name: t.old_team_name || '',
      old_team_logo: t.old_team_logo || '',
      new_team_id: t.new_team_id || '',
      new_team_name: t.new_team_name || '',
      new_team_logo: t.new_team_logo || '',
    });
    setActivePicker(null);
  };

  // Filtered List
  const filteredTransfers = transfers.filter((t) => {
    if (filter === 'all') return true;
    return t.status === filter;
  });

  const pendingCount = transfers.filter((t) => t.status === 'pending').length;
  const approvedCount = transfers.filter((t) => t.status === 'approved').length;
  const rejectedCount = transfers.filter((t) => t.status === 'rejected').length;

  const filterTabs = [
    { key: 'pending', label: 'Kutilmoqda', count: pendingCount, color: '#F59E0B' },
    { key: 'approved', label: 'Tasdiqlangan', count: approvedCount, color: '#00FF66' },
    { key: 'rejected', label: 'Rad etilgan', count: rejectedCount, color: '#EF4444' },
    { key: 'all', label: 'Barchasi', count: transfers.length, color: '#8B5CF6' },
  ];

  return (
    <View style={styles.container}>
      {/* FIXED TOP HEADER (Title, status filter icons) */}
      <View style={styles.fixedHeaderContainer}>
        <BlurView intensity={50} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />

        {/* HEADER ROW */}
        <View style={styles.headerRow}>
          <View style={styles.headerIconBox}>
            <Ionicons name="swap-horizontal" size={24} color="#00FF66" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>{"Transferlar Boshqaruvi"}</Text>
            <Text style={styles.screenSub}>{"Jamoalar o'rtasidagi o'yinchilar o'tish so'rovlari"}</Text>
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
        {/* 1. Transfer Window Toggle Switch Card */}
        <View style={[styles.windowCard, { borderColor: transferWindowOpen ? 'rgba(0, 255, 102, 0.4)' : 'rgba(239, 68, 68, 0.4)' }]}>
          <View style={styles.windowLeft}>
            <View style={[styles.windowIcon, { backgroundColor: transferWindowOpen ? 'rgba(0, 255, 102, 0.15)' : 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons
                name={transferWindowOpen ? "flash" : "lock-closed"}
                size={24}
                color={transferWindowOpen ? "#00FF66" : "#EF4444"}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.windowTitle}>{"Transfer Oynasi Holati"}</Text>
              <Text style={[styles.windowStatus, { color: transferWindowOpen ? '#00FF66' : 'rgba(255,255,255,0.6)' }]}>
                {transferWindowOpen
                  ? "Transfer oynasi OCHIQ — o'yinchilar so'rov yuborishi mumkin"
                  : "Transfer oynasi YOPIQ — o'yinchilar so'rov yuborolmaydi"}
              </Text>
            </View>
          </View>
          {windowLoading || windowToggling ? (
            <ActivityIndicator size="small" color={transferWindowOpen ? "#00FF66" : "#EF4444"} />
          ) : (
            <Switch
              value={transferWindowOpen}
              onValueChange={handleToggleTransferWindow}
              trackColor={{ false: '#334155', true: '#059669' }}
              thumbColor={transferWindowOpen ? '#00FF66' : '#94A3B8'}
            />
          )}
        </View>

        {/* 2. Transfers List Section */}
        {loading ? (
          <View style={{ gap: 14 }}>
            {[1, 2, 3].map((k) => (
              <View key={k} style={styles.cardSkeleton}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <SkeletonItem style={{ width: 44, height: 44, borderRadius: 22 }} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <SkeletonItem style={{ width: 140, height: 18, borderRadius: 4 }} />
                    <SkeletonItem style={{ width: 100, height: 12, borderRadius: 4 }} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : filteredTransfers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="swap-horizontal-outline" size={48} color="rgba(255,255,255,0.2)" />
            <Text style={styles.emptyTitle}>{"Transfer so'rovlari topilmadi"}</Text>
            <Text style={styles.emptyText}>{"Ushbu bo'limda mos keladigan transfer arizalari mavjud emas."}</Text>
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            {filteredTransfers.map((item) => {
              const isApproved = item.status === 'approved';
              const isRejected = item.status === 'rejected';
              const isPending = item.status === 'pending';

              const statusColor = isApproved ? '#00FF66' : isRejected ? '#EF4444' : '#F59E0B';
              const statusLabel = isApproved ? 'Tasdiqlangan' : isRejected ? 'Rad etilgan' : 'Kutilmoqda';

              return (
                <TransferCardItem
                  key={item.id}
                  item={item}
                  statusColor={statusColor}
                  statusLabel={statusLabel}
                  isPending={isPending}
                  isApproved={isApproved}
                  isRejected={isRejected}
                  onApprove={(t, anim) => handleApproveWithAnim(t, anim)}
                  onReject={(t, anim) => handleRejectWithAnim(t, anim)}
                  onDeletePress={(t, anim) => handleDeleteWithAnim(t, anim)}
                  onEditPress={(t) => handleOpenEdit(t)}
                  onStatusClick={(t) => setStatusModalItem(t)}
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
              {"Transfer Holatini O'zgartirish"}
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

      {/* Edit Transfer Modal */}
      <Modal visible={!!editingTransfer} transparent animationType="slide" onRequestClose={() => setEditingTransfer(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} />
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="pencil" size={20} color="#00FF66" />
                <Text style={styles.modalTitle}>{"Transferni Tahrirlash"}</Text>
              </View>
              <TouchableOpacity onPress={() => setEditingTransfer(null)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Modal Form */}
            <ScrollView style={{ padding: 18 }} contentContainerStyle={{ gap: 14 }}>
              {/* Field 1: Player Name (READ-ONLY) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{"O'yinchi (Tahrirlab bo'lmaydi)"}</Text>
                <View style={styles.readOnlyPlayerBox}>
                  {editForm.player_photo ? (
                    <Image source={{ uri: editForm.player_photo }} style={styles.readOnlyAvatar} />
                  ) : (
                    <View style={styles.readOnlyAvatarFallback}>
                      <Text style={styles.readOnlyInitial}>{(editForm.player_name || '?')[0]}</Text>
                    </View>
                  )}
                  <Text style={styles.readOnlyPlayerName}>{editForm.player_name || "O'yinchi"}</Text>
                  <Ionicons name="lock-closed" size={16} color="#64748B" style={{ marginLeft: 'auto' }} />
                </View>
              </View>

              {/* Field 2: League Selection (Interactive Select) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{"Liga"}</Text>
                <TouchableOpacity
                  style={styles.pickerSelectBtn}
                  activeOpacity={0.7}
                  onPress={() => setActivePicker('league')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="trophy-outline" size={18} color="#F59E0B" />
                    <Text style={styles.pickerSelectText}>
                      {editForm.league_name || '-- Liganu tanlang --'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              {/* Field 3: Old Team Selection (Interactive Select) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{"Eski Jamoa"}</Text>
                <TouchableOpacity
                  style={styles.pickerSelectBtn}
                  activeOpacity={0.7}
                  onPress={() => setActivePicker('old_team')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    {editForm.old_team_logo ? (
                      <Image source={{ uri: editForm.old_team_logo }} style={{ width: 22, height: 22, borderRadius: 11 }} />
                    ) : (
                      <Ionicons name="shield-outline" size={18} color="#94A3B8" />
                    )}
                    <Text style={styles.pickerSelectText} numberOfLines={1}>
                      {editForm.old_team_name || '-- Jamoani tanlang --'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              {/* Field 4: New Team Selection (Interactive Select) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{"Yangi Jamoa"}</Text>
                <TouchableOpacity
                  style={styles.pickerSelectBtn}
                  activeOpacity={0.7}
                  onPress={() => setActivePicker('new_team')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    {editForm.new_team_logo ? (
                      <Image source={{ uri: editForm.new_team_logo }} style={{ width: 22, height: 22, borderRadius: 11 }} />
                    ) : (
                      <Ionicons name="shield-outline" size={18} color="#00FF66" />
                    )}
                    <Text style={[styles.pickerSelectText, editForm.new_team_name ? { color: '#00FF66' } : null]} numberOfLines={1}>
                      {editForm.new_team_name || '-- Jamoani tanlang --'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              {/* Field 5: Status Selection */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{"Status"}</Text>
                {editingTransfer?.status === 'approved' ? (
                  <View style={[styles.pickerSelectBtn, { backgroundColor: 'rgba(0, 255, 102, 0.08)', borderColor: 'rgba(0, 255, 102, 0.3)' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="checkmark-circle" size={18} color="#00FF66" />
                      <Text style={[styles.pickerSelectText, { color: '#00FF66' }]}>
                        {"Tasdiqlangan (O'zgartirib bo'lmaydi)"}
                      </Text>
                    </View>
                    <Ionicons name="lock-closed" size={16} color="#00FF66" />
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.pickerSelectBtn}
                    activeOpacity={0.7}
                    onPress={() => setActivePicker('status')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons
                        name={editForm.status === 'approved' ? "checkmark-circle" : editForm.status === 'rejected' ? "close-circle" : "time-outline"}
                        size={18}
                        color={editForm.status === 'approved' ? "#00FF66" : editForm.status === 'rejected' ? "#EF4444" : "#F59E0B"}
                      />
                      <Text style={styles.pickerSelectText}>
                        {editForm.status === 'approved'
                          ? 'Tasdiqlangan (Approved)'
                          : editForm.status === 'rejected'
                          ? 'Rad etilgan (Rejected)'
                          : 'Kutilmoqda (Pending)'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={18} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Field 6: Reason */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{"Transfer Sababi"}</Text>
                <TextInput
                  style={[styles.textInput, { height: 75, textAlignVertical: 'top', paddingTop: 10 }]}
                  multiline
                  value={editForm.reason}
                  onChangeText={(val) => setEditForm({ ...editForm, reason: val })}
                  placeholder="Sababini yozing..."
                  placeholderTextColor="#64748B"
                />
              </View>
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEditingTransfer(null)}>
                <Text style={styles.modalCancelText}>{"Bekor qilish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={18} color="#000000" />
                    <Text style={styles.modalSaveText}>{"Saqlash"}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* INLINE PICKER OVERLAY PANEL */}
            {activePicker && (
              <View style={styles.inlinePickerOverlay}>
                <View style={styles.inlinePickerHeader}>
                  <Text style={styles.inlinePickerTitle}>
                    {activePicker === 'league'
                      ? 'Liganu Tanlang'
                      : activePicker === 'old_team'
                      ? 'Eski Jamoani Tanlang'
                      : activePicker === 'new_team'
                      ? 'Yangi Jamoani Tanlang'
                      : 'Statusni Tanlang'}
                  </Text>
                  <TouchableOpacity onPress={() => setActivePicker(null)}>
                    <Ionicons name="close-circle" size={24} color="#94A3B8" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ flex: 1, padding: 12 }}>
                  {activePicker === 'league' && (
                    leagues.length === 0 ? (
                      <Text style={styles.emptyPickerText}>{"Ligalar topilmadi"}</Text>
                    ) : (
                      leagues.map((l) => (
                        <TouchableOpacity
                          key={l.id}
                          style={styles.pickerOptionRow}
                          onPress={() => {
                            setEditForm((prev) => ({
                              ...prev,
                              league_id: l.id,
                              league_name: l.name,
                            }));
                            setActivePicker(null);
                          }}
                        >
                          <Ionicons name="trophy-outline" size={20} color="#F59E0B" style={{ marginRight: 12 }} />
                          <Text style={styles.pickerOptionText}>{l.name}</Text>
                          {String(editForm.league_id) === String(l.id) && (
                            <Ionicons name="checkmark" size={18} color="#00FF66" style={{ marginLeft: 'auto' }} />
                          )}
                        </TouchableOpacity>
                      ))
                    )
                  )}

                  {(activePicker === 'old_team' || activePicker === 'new_team') && (
                    allTeams.length === 0 ? (
                      <Text style={styles.emptyPickerText}>{"Jamoalar topilmadi"}</Text>
                    ) : (
                      allTeams.map((t) => {
                        const isSelected =
                          activePicker === 'old_team'
                            ? String(editForm.old_team_id) === String(t.id)
                            : String(editForm.new_team_id) === String(t.id);

                        return (
                          <TouchableOpacity
                            key={t.id}
                            style={styles.pickerOptionRow}
                            onPress={() => {
                              if (activePicker === 'old_team') {
                                setEditForm((prev) => ({
                                  ...prev,
                                  old_team_id: t.id,
                                  old_team_name: t.name,
                                  old_team_logo: t.logo_url,
                                }));
                              } else {
                                setEditForm((prev) => ({
                                  ...prev,
                                  new_team_id: t.id,
                                  new_team_name: t.name,
                                  new_team_logo: t.logo_url,
                                }));
                              }
                              setActivePicker(null);
                            }}
                          >
                            {t.logo_url ? (
                              <Image source={{ uri: t.logo_url }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 12 }} />
                            ) : (
                              <Ionicons name="shield-outline" size={20} color="#94A3B8" style={{ marginRight: 12 }} />
                            )}
                            <Text style={styles.pickerOptionText}>{t.name}</Text>
                            {isSelected && (
                              <Ionicons name="checkmark" size={18} color="#00FF66" style={{ marginLeft: 'auto' }} />
                            )}
                          </TouchableOpacity>
                        );
                      })
                    )
                  )}

                  {activePicker === 'status' && (
                    <>
                      <TouchableOpacity
                        style={styles.pickerOptionRow}
                        onPress={() => {
                          setEditForm((prev) => ({ ...prev, status: 'pending' }));
                          setActivePicker(null);
                        }}
                      >
                        <Ionicons name="time-outline" size={20} color="#F59E0B" style={{ marginRight: 12 }} />
                        <Text style={styles.pickerOptionText}>{"Kutilmoqda (Pending)"}</Text>
                        {editForm.status === 'pending' && (
                          <Ionicons name="checkmark" size={18} color="#00FF66" style={{ marginLeft: 'auto' }} />
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.pickerOptionRow}
                        onPress={() => {
                          setEditForm((prev) => ({ ...prev, status: 'approved' }));
                          setActivePicker(null);
                        }}
                      >
                        <Ionicons name="checkmark-circle-outline" size={20} color="#00FF66" style={{ marginRight: 12 }} />
                        <Text style={styles.pickerOptionText}>{"Tasdiqlangan (Approved)"}</Text>
                        {editForm.status === 'approved' && (
                          <Ionicons name="checkmark" size={18} color="#00FF66" style={{ marginLeft: 'auto' }} />
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.pickerOptionRow}
                        onPress={() => {
                          setEditForm((prev) => ({ ...prev, status: 'rejected' }));
                          setActivePicker(null);
                        }}
                      >
                        <Ionicons name="close-circle-outline" size={20} color="#EF4444" style={{ marginRight: 12 }} />
                        <Text style={styles.pickerOptionText}>{"Rad etilgan (Rejected)"}</Text>
                        {editForm.status === 'rejected' && (
                          <Ionicons name="checkmark" size={18} color="#00FF66" style={{ marginLeft: 'auto' }} />
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal visible={!!transferToDelete} transparent animationType="fade" onRequestClose={() => setTransferToDelete(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 400, padding: 22, alignItems: 'center' }]}>
            <View style={styles.deleteIconBg}>
              <Ionicons name="trash-outline" size={32} color="#EF4444" />
            </View>
            <Text style={styles.deleteTitle}>{"Transfer So'rovini O'chirish"}</Text>
            <Text style={styles.deleteSub}>
              {"Haqiqatan ham ushbu transfer so'rovini bazadan o'chirib tashlamoqchimisiz?"}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginTop: 20 }}>
              <TouchableOpacity style={[styles.modalCancelBtn, { flex: 1 }]} onPress={() => setTransferToDelete(null)}>
                <Text style={styles.modalCancelText}>{"Bekor qilish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSaveBtn, { flex: 1, backgroundColor: '#EF4444' }]}
                onPress={executeDeleteTransfer}
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

      {/* FULL-PAGE MODAL: APPROVED TRANSFERS */}
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
              <Text style={styles.modalPageTitle}>{"Qabul Qilingan Transferlar"}</Text>
              <Text style={styles.modalPageSub}>{"Tasdiqlangan barcha transfer arizalari ro'yxati"}</Text>
            </View>
          </View>

          {/* SEARCH BAR */}
          <View style={styles.modalSearchBox}>
            <Ionicons name="search" size={18} color="rgba(255, 255, 255, 0.4)" />
            <TextInput
              style={styles.modalSearchInput}
              placeholder="O'yinchi yoki Jamoa bo'yicha qidiruv..."
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

          {/* APPROVED CARDS LIST */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 60, gap: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {transfers
              .filter((t) => {
                if (t.status !== 'approved') return false;
                if (approvedSearchQuery.trim()) {
                  const q = approvedSearchQuery.toLowerCase();
                  const nameStr = `${t.player_name || ''} ${t.old_team_name || ''} ${t.new_team_name || ''} ${t.league_name || ''}`.toLowerCase();
                  return nameStr.includes(q);
                }
                return true;
              })
              .map((item) => (
                <TransferCardItem
                  key={item.id}
                  item={item}
                  statusColor="#00FF66"
                  statusLabel="✓ Tasdiqlangan"
                  isPending={false}
                  isApproved={true}
                  isRejected={false}
                  onApprove={() => {}}
                  onReject={() => {}}
                  onDeletePress={(t, anim) => handleDeleteWithAnim(t, anim)}
                  onEditPress={(t) => handleOpenEdit(t)}
                  onStatusClick={(t) => setStatusModalItem(t)}
                />
              ))}
          </ScrollView>
        </View>
      </Modal>

      {/* FULL-PAGE MODAL: REJECTED TRANSFERS */}
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
              <Text style={styles.modalPageTitle}>{"Rad Etilgan Transferlar"}</Text>
              <Text style={styles.modalPageSub}>{"Rad etilgan barcha transfer arizalari ro'yxati"}</Text>
            </View>
          </View>

          {/* SEARCH BAR */}
          <View style={styles.modalSearchBox}>
            <Ionicons name="search" size={18} color="rgba(255, 255, 255, 0.4)" />
            <TextInput
              style={styles.modalSearchInput}
              placeholder="O'yinchi yoki Jamoa bo'yicha qidiruv..."
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

          {/* REJECTED CARDS LIST */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 60, gap: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {transfers
              .filter((t) => {
                if (t.status !== 'rejected') return false;
                if (rejectedSearchQuery.trim()) {
                  const q = rejectedSearchQuery.toLowerCase();
                  const nameStr = `${t.player_name || ''} ${t.old_team_name || ''} ${t.new_team_name || ''} ${t.league_name || ''}`.toLowerCase();
                  return nameStr.includes(q);
                }
                return true;
              })
              .map((item) => (
                <TransferCardItem
                  key={item.id}
                  item={item}
                  statusColor="#EF4444"
                  statusLabel="✕ Rad etilgan"
                  isPending={false}
                  isApproved={false}
                  isRejected={true}
                  onApprove={() => {}}
                  onReject={() => {}}
                  onDeletePress={(t, anim) => handleDeleteWithAnim(t, anim)}
                  onEditPress={(t) => handleOpenEdit(t)}
                  onStatusClick={(t) => setStatusModalItem(t)}
                />
              ))}
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
    gap: 12,
  },
  headerIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 255, 102, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
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
  windowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    marginBottom: 18,
  },
  windowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  windowIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  windowTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  windowStatus: {
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
  },
  filterScroll: {
    marginBottom: 18,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  filterLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  filterBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  filterBadgeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  cardSkeleton: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
  },
  emptyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 10,
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
  transferCard: {
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
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  iconActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    resizeMode: 'cover',
  },
  playerAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerAvatarInitial: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  playerName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  transferReason: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  teamsFlowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  teamSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamLogo: {
    width: 30,
    height: 30,
    borderRadius: 15,
    resizeMode: 'contain',
  },
  teamLogoFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  swapCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  btnAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  btnReject: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  btnApprove: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  btnRevert: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  btnActionText: {
    fontSize: 13,
    fontWeight: '800',
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
    fontSize: 17,
    fontWeight: '800',
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  readOnlyPlayerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  readOnlyAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
    resizeMode: 'cover',
  },
  readOnlyAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  readOnlyInitial: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  readOnlyPlayerName: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
  },
  textInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
  },
  pickerSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerSelectText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
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
  inlinePickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 20,
    zIndex: 999,
  },
  inlinePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  inlinePickerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  emptyPickerText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
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
    fontSize: 14,
    fontWeight: '600',
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
});
