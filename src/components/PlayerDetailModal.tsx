import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';

interface Props {
  visible: boolean;
  player: any;
  mode: 'view' | 'edit';
  onClose: () => void;
  onRefresh: () => void;
  onRequireClosedWarning: () => void;
}

export const PlayerDetailModal: React.FC<Props> = ({
  visible,
  player,
  mode: initialMode,
  onClose,
  onRefresh,
  onRequireClosedWarning,
}) => {
  if (!visible || !player) return null;

  const { transferWindowOpen } = useOrg();
  const [currentMode, setCurrentMode] = useState<'view' | 'edit'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);

  const extractInstaUser = (p: any) => {
    if (!p) return '';
    if (p.instagram_username) return p.instagram_username;
    if (p.comment) {
      const match = p.comment.match(/\[INSTAGRAM:https?:\/\/[^\/]+\/([^\/\]]+)/);
      if (match?.[1]) return match[1];
    }
    return '';
  };

  const extractMeta = (p: any) => {
    let citizenship = p.citizenship || '';
    let height = p.height || '';
    let weight = p.weight || '';
    if (p.comment) {
      const metaMatch = p.comment.match(/\[METADATA:({[^\]]+})\]/);
      if (metaMatch?.[1]) {
        try {
          const obj = JSON.parse(metaMatch[1]);
          if (obj.citizenship) citizenship = obj.citizenship;
          if (obj.height) height = obj.height;
          if (obj.weight) weight = obj.weight;
        } catch (e) {}
      }
    }
    return { citizenship, height, weight };
  };

  const initialMeta = extractMeta(player);

  const [formData, setFormData] = useState({
    first_name: player.first_name || '',
    last_name: player.last_name || '',
    father_name: player.father_name || '',
    phone: player.phone || '',
    passport_series: player.passport_series || '',
    passport_number: player.passport_number || '',
    birth_date: player.birth_date || '',
    position: player.position || '',
    player_number: player.player_number ? String(player.player_number) : '',
    photo_url: player.photo_url || '',
    team_id: player.team_id || '',
    instagram_username: extractInstaUser(player),
    citizenship: initialMeta.citizenship,
    height: initialMeta.height,
    weight: initialMeta.weight,
    status: player.status || 'pending',
  });

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async () => {
    const { data } = await supabase.from('teams').select('id, name, league');
    if (data) setTeams(data);
  };

  const handleStartEdit = () => {
    if (!transferWindowOpen) {
      onRequireClosedWarning();
      return;
    }
    setCurrentMode('edit');
  };

  const handleSave = async () => {
    if (!transferWindowOpen) {
      onRequireClosedWarning();
      return;
    }

    setLoading(true);
    try {
      const cleanInsta = (formData.instagram_username || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '');
      const instaUrl = cleanInsta ? `https://www.instagram.com/${cleanInsta}/` : null;

      const metaObj = {
        citizenship: formData.citizenship || '',
        height: formData.height || '',
        weight: formData.weight || '',
      };

      const currentComment = player.comment || '';
      const cleanComment = currentComment
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

      const updatePayload = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        father_name: formData.father_name,
        phone: formData.phone,
        passport_series: formData.passport_series,
        passport_number: formData.passport_number,
        birth_date: formData.birth_date,
        position: formData.position,
        player_number: formData.player_number ? Number(formData.player_number) : null,
        photo_url: formData.photo_url,
        team_id: formData.team_id || null,
        comment: updatedComment.trim(),
        status: formData.status,
      };

      const { error } = await supabase.from('applications').update(updatePayload).eq('id', player.id);
      if (error) throw error;

      onRefresh();
      setCurrentMode('view');
    } catch (err: any) {
      Alert.alert('Xatolik', err.message || 'Saqlashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    Alert.alert(
      "O'yinchini o'chirish",
      "O'chirsangiz barcha ma'lumotlar o'chib ketadi! Tasdiqlaysizmi?",
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "O'chirish",
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('applications').delete().eq('id', player.id);
              onRefresh();
              onClose();
            } catch (err) {
              Alert.alert("O'chirishda xatolik yuz berdi");
            }
          },
        },
      ]
    );
  };

  const getTeamName = (teamId: string) => {
    if (!teamId) return 'Yakkaxon';
    const found = teams.find((t) => t.id === teamId);
    return found ? found.name : "Noma'lum";
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Top Header Bar */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalHeaderTitle}>
              {currentMode === 'view' ? "O'yinchi Profili" : "O'yinchini Tahrirlash"}
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color="rgba(255, 255, 255, 0.6)" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {currentMode === 'view' ? (
              /* VIEW MODE */
              <View>
                <View style={styles.profileHero}>
                  <Image
                    source={{
                      uri:
                        formData.photo_url ||
                        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop',
                    }}
                    style={styles.heroAvatar}
                  />
                  <Text style={styles.heroName}>
                    {player.first_name} {player.last_name}
                  </Text>
                  <Text style={styles.heroTeam}>{getTeamName(player.team_id)}</Text>
                </View>

                <View style={styles.gridDetails}>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Telefon</Text>
                    <Text style={styles.detailVal}>{player.phone || '—'}</Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Pasport</Text>
                    <Text style={styles.detailVal}>
                      {player.passport_series || ''} {player.passport_number || '—'}
                    </Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>{"Tug'ilgan sana"}</Text>
                    <Text style={styles.detailVal}>{player.birth_date || '—'}</Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Pozitsiya</Text>
                    <Text style={styles.detailVal}>{player.position || '—'}</Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Raqam</Text>
                    <Text style={styles.detailVal}>#{player.player_number || '—'}</Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Instagram</Text>
                    <Text style={[styles.detailVal, { color: '#E1306C' }]}>
                      {formData.instagram_username ? `@${formData.instagram_username}` : '—'}
                    </Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Millati</Text>
                    <Text style={styles.detailVal}>{formData.citizenship || '—'}</Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>{"Bo'yi / Vazni"}</Text>
                    <Text style={styles.detailVal}>
                      {formData.height ? `${formData.height}sm` : '—'} / {formData.weight ? `${formData.weight}kg` : '—'}
                    </Text>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.btnEdit} onPress={handleStartEdit}>
                    <Ionicons name="create-outline" size={18} color="#000" />
                    <Text style={styles.btnEditText}>Tahrirlash</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.btnDelete} onPress={handleDelete}>
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    <Text style={styles.btnDeleteText}>{"O'chirish"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* EDIT MODE */
              <View style={styles.formContainer}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Ism</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.first_name}
                    onChangeText={(val) => setFormData({ ...formData, first_name: val })}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Familiya</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.last_name}
                    onChangeText={(val) => setFormData({ ...formData, last_name: val })}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Telefon</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.phone}
                    onChangeText={(val) => setFormData({ ...formData, phone: val })}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Pasport Seriya & Raqam</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Seriya"
                      value={formData.passport_series}
                      onChangeText={(val) => setFormData({ ...formData, passport_series: val })}
                    />
                    <TextInput
                      style={[styles.input, { flex: 2 }]}
                      placeholder="Raqam"
                      value={formData.passport_number}
                      onChangeText={(val) => setFormData({ ...formData, passport_number: val })}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Pozitsiya & Raqam</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TextInput
                      style={[styles.input, { flex: 2 }]}
                      placeholder="Hujumchi, Darvozabon..."
                      value={formData.position}
                      onChangeText={(val) => setFormData({ ...formData, position: val })}
                    />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Raqam"
                      keyboardType="numeric"
                      value={formData.player_number}
                      onChangeText={(val) => setFormData({ ...formData, player_number: val })}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Instagram Username</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="masalan: username"
                    value={formData.instagram_username}
                    onChangeText={(val) => setFormData({ ...formData, instagram_username: val })}
                  />
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.btnCancel} onPress={() => setCurrentMode('view')}>
                    <Text style={styles.btnCancelText}>Bekor qilish</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.btnSave} onPress={handleSave} disabled={loading}>
                    {loading ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <Text style={styles.btnSaveText}>Saqlash</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 17, 0.85)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    paddingHorizontal: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingVertical: 16,
  },
  profileHero: {
    alignItems: 'center',
    marginBottom: 20,
  },
  heroAvatar: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: '#334155',
    marginBottom: 10,
  },
  heroName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  heroTeam: {
    color: '#00FF66',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  gridDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  detailCard: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  detailLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '600',
  },
  detailVal: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  btnEdit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#00FF66',
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnEditText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
  btnDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnDeleteText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '800',
  },
  formContainer: {
    gap: 14,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  btnCancel: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnCancelText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '700',
  },
  btnSave: {
    flex: 1,
    backgroundColor: '#00FF66',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnSaveText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
});
