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
  TextInput,
  Alert,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useOrg } from '../context/OrgContext';
import { supabase, supabaseAdmin } from '../supabaseClient';

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

export const TransfersScreen: React.FC = () => {
  const { orgId, currentOrg, transferWindowOpen, setTransferWindowOpen } = useOrg();

  // Data State
  const [transfers, setTransfers] = useState<any[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [windowLoading, setWindowLoading] = useState(false);
  const [windowToggling, setWindowToggling] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');

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

  useEffect(() => {
    fetchTransfers();
    fetchWindowStatus();
  }, [orgId]);

  const dbClient = supabaseAdmin || supabase;

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

  // 2. Fetch Transfers, Teams, and Leagues
  const fetchTransfers = async () => {
    setLoading(true);
    try {
      // Fetch Teams
      const { data: orgTeams } = await dbClient
        .from('teams')
        .select('id, name, logo_url, league, league_id, league_name')
        .eq('organization_id', orgId || 1)
        .order('name');

      if (orgTeams) {
        setAllTeams(orgTeams);
      }

      // Fetch Leagues
      const { data: orgLeagues } = await dbClient
        .from('leagues')
        .select('id, name')
        .eq('organization_id', orgId || 1)
        .order('name');

      if (orgLeagues) {
        setLeagues(orgLeagues);
      }

      const teamIdSet = new Set((orgTeams || []).map((t) => t.id));

      const { data, error } = await dbClient
        .from('transfers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching transfers:', error);
        setTransfers([]);
      } else {
        const orgTransfers = (data || []).filter(
          (t: any) =>
            t.organization_id === orgId ||
            (!t.organization_id && (teamIdSet.has(t.old_team_id) || teamIdSet.has(t.new_team_id)))
        );
        setTransfers(orgTransfers);
      }
    } catch (e) {
      console.error('Fetch transfers error:', e);
    } finally {
      setLoading(false);
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

  // 4. Update Transfer Status & Player Team Movements
  const handleUpdateTransferStatus = async (transfer: any, newStatus: string) => {
    try {
      const oldStatus = transfer.status;
      if (oldStatus === newStatus) return;

      const { error: transferError } = await dbClient
        .from('transfers')
        .update({ status: newStatus })
        .eq('id', transfer.id);

      if (transferError) throw transferError;

      if (transfer.player_id) {
        if (newStatus === 'approved' && transfer.new_team_id) {
          await dbClient
            .from('applications')
            .update({ team_id: transfer.new_team_id })
            .eq('id', transfer.player_id);

          await dbClient
            .from('players')
            .update({ team_id: transfer.new_team_id })
            .eq('id', transfer.player_id);
        } else if (
          oldStatus === 'approved' &&
          (newStatus === 'pending' || newStatus === 'rejected') &&
          transfer.old_team_id
        ) {
          await dbClient
            .from('applications')
            .update({ team_id: transfer.old_team_id })
            .eq('id', transfer.player_id);

          await dbClient
            .from('players')
            .update({ team_id: transfer.old_team_id })
            .eq('id', transfer.player_id);
        }
      }

      fetchTransfers();
    } catch (err: any) {
      console.error('Error updating transfer status:', err);
      Alert.alert('Xatolik', err.message || "Statusni o'zgartirishda xatolik yuz berdi");
    }
  };

  // 5. Delete Transfer
  const executeDeleteTransfer = async () => {
    if (!transferToDelete) return;
    setIsDeleting(true);
    try {
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
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      {/* Header Title Section */}
      <View style={styles.headerRow}>
        <View style={styles.headerIconBox}>
          <Ionicons name="swap-horizontal" size={24} color="#00FF66" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.screenTitle}>{"Transferlar Boshqaruvi"}</Text>
          <Text style={styles.screenSub}>{"Jamoalar o'rtasidagi o'yinchilar o'tish so'rovlari"}</Text>
        </View>
      </View>

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

      {/* 2. Filter Tabs Row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={{ gap: 8 }}>
        {filterTabs.map((tab) => {
          const isActive = filter === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.filterTab,
                isActive && { backgroundColor: `${tab.color}20`, borderColor: tab.color },
              ]}
              onPress={() => setFilter(tab.key as any)}
            >
              <View style={[styles.filterDot, { backgroundColor: tab.color }]} />
              <Text style={[styles.filterLabel, isActive && { color: tab.color, fontWeight: '900' }]}>
                {tab.label}
              </Text>
              {tab.count > 0 && (
                <View style={[styles.filterBadge, { backgroundColor: `${tab.color}30` }]}>
                  <Text style={[styles.filterBadgeText, { color: tab.color }]}>{tab.count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 3. Transfers List */}
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
              <View key={item.id} style={[styles.transferCard, { borderColor: `${statusColor}33` }]}>
                <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
                {/* Card Top Action Bar */}
                <View style={styles.cardHeader}>
                  <View style={[styles.statusPill, { backgroundColor: `${statusColor}1A`, borderColor: `${statusColor}40` }]}>
                    <Ionicons
                      name={isApproved ? "checkmark-circle" : isRejected ? "close-circle" : "time-outline"}
                      size={14}
                      color={statusColor}
                    />
                    <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={styles.iconActionBtn}
                      onPress={() => handleOpenEdit(item)}
                    >
                      <Ionicons name="pencil" size={16} color="#94A3B8" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.iconActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}
                      onPress={() => setTransferToDelete(item)}
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

                {/* Card Action Buttons */}
                <View style={styles.cardActionsRow}>
                  {isPending && (
                    <>
                      <TouchableOpacity
                        style={[styles.btnAction, styles.btnReject]}
                        onPress={() => handleUpdateTransferStatus(item, 'rejected')}
                      >
                        <Ionicons name="close" size={18} color="#EF4444" />
                        <Text style={[styles.btnActionText, { color: '#EF4444' }]}>{"Rad etish"}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.btnAction, styles.btnApprove]}
                        onPress={() => handleUpdateTransferStatus(item, 'approved')}
                      >
                        <Ionicons name="checkmark" size={18} color="#000000" />
                        <Text style={[styles.btnActionText, { color: '#000000', fontWeight: '900' }]}>{"Tasdiqlash"}</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {isApproved && (
                    <TouchableOpacity
                      style={[styles.btnAction, styles.btnRevert, { width: '100%' }]}
                      onPress={() => handleUpdateTransferStatus(item, 'pending')}
                    >
                      <Ionicons name="refresh-outline" size={16} color="#F59E0B" />
                      <Text style={[styles.btnActionText, { color: '#F59E0B' }]}>
                        {"Kutilmoqdaga qaytarish (Eski jamoasiga)"}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {isRejected && (
                    <>
                      <TouchableOpacity
                        style={[styles.btnAction, styles.btnRevert]}
                        onPress={() => handleUpdateTransferStatus(item, 'pending')}
                      >
                        <Ionicons name="time-outline" size={16} color="#F59E0B" />
                        <Text style={[styles.btnActionText, { color: '#F59E0B' }]}>{"Kutilmoqdaga"}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.btnAction, styles.btnApprove]}
                        onPress={() => handleUpdateTransferStatus(item, 'approved')}
                      >
                        <Ionicons name="checkmark" size={18} color="#000000" />
                        <Text style={[styles.btnActionText, { color: '#000000', fontWeight: '900' }]}>{"Tasdiqlash"}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

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

              {/* Field 5: Status Selection (Interactive Select) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{"Status"}</Text>
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
});
