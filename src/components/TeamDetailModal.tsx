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

interface Props {
  visible: boolean;
  team: any;
  mode: 'view' | 'edit';
  onClose: () => void;
  onRefresh: () => void;
}

export const TeamDetailModal: React.FC<Props> = ({
  visible,
  team,
  mode: initialMode,
  onClose,
  onRefresh,
}) => {
  if (!visible || !team) return null;

  const [currentMode, setCurrentMode] = useState<'view' | 'edit'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [teamPlayers, setTeamPlayers] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    name: team.name || '',
    captain_name: team.captain_name || '',
    captain_phone: team.captain_phone || '',
    region: team.region || '',
    league: team.league || '',
    logo_url: team.logo_url || '',
    status: team.status || 'pending',
  });

  useEffect(() => {
    fetchTeamPlayers();
  }, [team.id]);

  const fetchTeamPlayers = async () => {
    try {
      const { data } = await supabase
        .from('applications')
        .select('*')
        .eq('team_id', team.id)
        .order('created_at', { ascending: false });

      if (data) setTeamPlayers(data);
    } catch (e) {}
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const updatePayload = {
        name: formData.name,
        captain_name: formData.captain_name,
        captain_phone: formData.captain_phone,
        region: formData.region,
        league: formData.league,
        logo_url: formData.logo_url,
        status: formData.status,
      };

      const { error } = await supabase.from('teams').update(updatePayload).eq('id', team.id);
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
      "Jamoani o'chirish",
      "O'chirsangiz jamoa va uning barcha ma'lumotlari o'chib ketadi! Tasdiqlaysizmi?",
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "O'chirish",
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('teams').delete().eq('id', team.id);
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalHeaderTitle}>
              {currentMode === 'view' ? "Jamoa Profili" : "Jamoani Tahrirlash"}
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
                        formData.logo_url ||
                        'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=150&auto=format&fit=crop',
                    }}
                    style={styles.heroLogo}
                  />
                  <Text style={styles.heroName}>{team.name}</Text>
                  {team.league ? <Text style={styles.heroLeague}>Liga: {team.league}</Text> : null}
                </View>

                <View style={styles.gridDetails}>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Kapitan Ismi</Text>
                    <Text style={styles.detailVal}>{team.captain_name || '—'}</Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Kapitan Telefoni</Text>
                    <Text style={styles.detailVal}>{team.captain_phone || '—'}</Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>Hudud</Text>
                    <Text style={styles.detailVal}>{team.region || '—'}</Text>
                  </View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>{"O'yinchilar Soni"}</Text>
                    <Text style={[styles.detailVal, { color: '#00FF66' }]}>
                      {teamPlayers.length} ta o'yinchi
                    </Text>
                  </View>
                </View>

                {/* Team Players List Preview */}
                <Text style={styles.sectionTitle}>Jamoa O'yinchilari ({teamPlayers.length})</Text>
                {teamPlayers.slice(0, 5).map((p) => (
                  <View key={p.id} style={styles.playerMiniRow}>
                    <Image
                      source={{
                        uri:
                          p.photo_url ||
                          'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop',
                      }}
                      style={styles.playerMiniAvatar}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.playerMiniName}>
                        {p.first_name} {p.last_name}
                      </Text>
                      <Text style={styles.playerMiniSub}>{p.phone || 'Tel yo\'q'}</Text>
                    </View>
                    <Text style={styles.playerMiniPos}>№{p.player_number || '—'}</Text>
                  </View>
                ))}

                {/* Actions */}
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.btnEdit} onPress={() => setCurrentMode('edit')}>
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
                  <Text style={styles.label}>Jamoa Nomi</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.name}
                    onChangeText={(val) => setFormData({ ...formData, name: val })}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Kapitan Ismi</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.captain_name}
                    onChangeText={(val) => setFormData({ ...formData, captain_name: val })}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Kapitan Telefoni</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.captain_phone}
                    onChangeText={(val) => setFormData({ ...formData, captain_phone: val })}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Liga</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.league}
                    onChangeText={(val) => setFormData({ ...formData, league: val })}
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
  heroLogo: {
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
  heroLeague: {
    color: '#00FF66',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  gridDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
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
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  playerMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    gap: 10,
  },
  playerMiniAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#334155',
  },
  playerMiniName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  playerMiniSub: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
  },
  playerMiniPos: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
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
