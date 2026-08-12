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
import { BlurView } from 'expo-blur';
import { useOrg } from '../context/OrgContext';
import { supabase, supabaseAdmin } from '../supabaseClient';

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

export const ProfileUpdatesScreen: React.FC = () => {
  const { orgId } = useOrg();
  const [activeTab, setActiveTab] = useState<'players' | 'teams'>('players');
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);

  // Delete confirmation modal state
  const [itemToDelete, setItemToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchProfileUpdateRequests();
  }, [orgId]);

  const dbClient = supabaseAdmin || supabase;

  const fetchProfileUpdateRequests = async () => {
    setLoading(true);
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

  // Approve Request: Update existing player ONLY & mark request as processed
  const handleApprove = async (reqItem: any) => {
    setProcessingId(reqItem.id);
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

        const { error: playerErr } = await dbClient.from('applications').update(updatePayload).eq('id', targetPlayerId);
        if (playerErr) {
          console.error('Error updating player record:', playerErr);
          Alert.alert('Xatolik', "O'yinchi ma'lumotlarini yangilashda xatolik: " + playerErr.message);
          return;
        }

        // Also update players table if present
        await dbClient.from('players').update(updatePayload).eq('id', targetPlayerId);
      }

      const ticketErr = await updateTicketStatus(reqItem.id, 'approved');
      if (ticketErr) {
        console.error('Error approving request:', ticketErr);
        Alert.alert('Xatolik', 'Arizani tasdiqlashda xatolik: ' + ticketErr.message);
        return;
      }

      Alert.alert('Muvaffaqiyatli', "Ariza muvaffaqiyatli tasdiqlandi va o'yinchi ma'lumotlari yangilandi!");
      fetchProfileUpdateRequests();
    } catch (err: any) {
      console.error('Error approving request:', err);
      Alert.alert('Xatolik', 'Xatolik yuz berdi: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (reqItem: any) => {
    setProcessingId(reqItem.id);
    try {
      const error = await updateTicketStatus(reqItem.id, 'rejected');
      if (error) {
        Alert.alert('Xatolik', 'Arizani rad etishda xatolik: ' + error.message);
        return;
      }
      Alert.alert('Ma’lumot', 'Ariza rad etildi!');
      fetchProfileUpdateRequests();
    } catch (err: any) {
      console.error('Error rejecting request:', err);
      Alert.alert('Xatolik', 'Xatolik yuz berdi: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const executeDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    setProcessingId(itemToDelete.id);
    try {
      const { error } = await dbClient.from('applications').delete().eq('id', itemToDelete.id);
      if (error) {
        Alert.alert('Xatolik', "Arizani o'chirishda xatolik: " + error.message);
        return;
      }
      setItemToDelete(null);
      fetchProfileUpdateRequests();
    } catch (err: any) {
      console.error('Error deleting request:', err);
      Alert.alert('Xatolik', 'Xatolik yuz berdi: ' + err.message);
    } finally {
      setIsDeleting(false);
      setProcessingId(null);
    }
  };

  const filteredRequests = requests.filter((r) => {
    if (activeTab === 'players') return !r.team_id || r.type !== 'team';
    return r.team_id || r.type === 'team';
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      {/* HEADER ROW */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.screenTitle}>{"Ma'lumotlar Almashinuvi"}</Text>
          <Text style={styles.screenSub}>{"O'yinchilar ma'lumotlarini tahrirlash arizalari"}</Text>
        </View>

        <TouchableOpacity style={styles.refreshBtn} onPress={fetchProfileUpdateRequests}>
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.refreshBtnText}>{"Yangilash"}</Text>
        </TouchableOpacity>
      </View>

      {/* TABS & FILTER BAR */}
      <View style={styles.filterRow}>
        <View style={styles.tabContainer}>
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

            const oldPhoto = oldData.photoUrl || oldData.photo || req.photo_url || req.photo || req.avatar || '';
            const newPhoto = newData.photoUrl || newData.photo || oldPhoto;

            const commentMeta = extractMetaFromComment(req.comment);

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

            const isProcessing = processingId === req.id;

            return (
              <View key={req.id} style={[styles.updateCard, { borderColor: `${statusColor}33` }]}>
                <BlurView intensity={80} tint="dark" experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined} style={StyleSheet.absoluteFill} />
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

                  <View style={[styles.statusBadge, { backgroundColor: `${statusColor}1A`, borderColor: `${statusColor}40` }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
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

                {/* CARD ACTION BUTTONS */}
                <View style={styles.cardActionsRow}>
                  {isPending && (
                    <TouchableOpacity
                      style={[styles.actionIconBtn, styles.rejectIconBtn]}
                      onPress={() => handleReject(req)}
                      disabled={isProcessing}
                    >
                      <Ionicons name="close" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.actionIconBtn, styles.deleteIconBtn]}
                    onPress={() => setItemToDelete(req)}
                    disabled={isProcessing}
                  >
                    <Ionicons name="trash-outline" size={20} color="#EF4444" />
                  </TouchableOpacity>

                  {isPending && (
                    <TouchableOpacity
                      style={[styles.actionIconBtn, styles.approveIconBtn]}
                      onPress={() => handleApprove(req)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <ActivityIndicator size="small" color="#000000" />
                      ) : (
                        <Ionicons name="checkmark" size={20} color="#000000" />
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

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
    justifyContent: 'space-between',
    marginBottom: 16,
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
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 255, 102, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 102, 0.3)',
  },
  refreshBtnText: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 18,
  },
  tabContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
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
});
