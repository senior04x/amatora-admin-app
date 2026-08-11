import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AddMatchModal: React.FC<Props> = ({ visible, onClose, onSuccess }) => {
  const { orgId } = useOrg();
  const [loading, setLoading] = useState(false);

  // Form Fields
  const [leagues, setLeagues] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);

  const [selectedLeague, setSelectedLeague] = useState('');
  const [homeTeamId, setHomeTeamId] = useState('');
  const [awayTeamId, setAwayTeamId] = useState('');
  const [matchDate, setMatchDate] = useState('');
  const [matchTime, setMatchTime] = useState('');
  const [stadiumName, setStadiumName] = useState('');
  const [matchRound, setMatchRound] = useState('');
  const [importance, setImportance] = useState<'oddiy' | 'ortacha' | 'markaziy'>('oddiy');
  const [youtubeLink, setYoutubeLink] = useState('');

  // Dropdown visibility
  const [showLeaguePicker, setShowLeaguePicker] = useState(false);
  const [showHomePicker, setShowHomePicker] = useState(false);
  const [showAwayPicker, setShowAwayPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      fetchLeaguesAndTeams();
      // Default today date & time
      const today = new Date().toISOString().split('T')[0];
      setMatchDate(today);
      setMatchTime('18:00');
    }
  }, [visible, orgId]);

  const fetchLeaguesAndTeams = async () => {
    try {
      const [leaguesRes, teamsRes] = await Promise.all([
        supabase.from('leagues').select('id, name'),
        supabase.from('teams').select('id, name, league'),
      ]);

      if (leaguesRes.data) {
        setLeagues(leaguesRes.data);
        if (leaguesRes.data.length > 0) setSelectedLeague(leaguesRes.data[0].name);
      }
      if (teamsRes.data) {
        setTeams(teamsRes.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const filteredTeams = teams.filter(
    (t) => !selectedLeague || !t.league || t.league.includes(selectedLeague)
  );

  const handleSaveMatch = async () => {
    if (!homeTeamId || !awayTeamId) {
      Alert.alert("Xatolik", "Iltimos, Mezbon va Mehmon jamoalarni tanlang!");
      return;
    }

    if (homeTeamId === awayTeamId) {
      Alert.alert("Xatolik", "Mezbon va Mehmon bir xil jamoa bo'la olmaydi!");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        organization_id: orgId || 1,
        league: selectedLeague,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        date: matchDate,
        time: matchTime,
        location: stadiumName.trim() || 'Stadion',
        round: matchRound.trim() || '1-tur',
        importance: importance,
        youtube_link: youtubeLink.trim() || null,
        status: 'scheduled',
      };

      const { error } = await supabase.from('matches').insert([payload]);
      if (error) throw error;

      Alert.alert("Muvaffaqiyatli", "Yangi o'yin jadvalga qo'shildi! ⚽");
      if (onSuccess) onSuccess();
      onClose();

      // Reset form
      setHomeTeamId('');
      setAwayTeamId('');
      setMatchRound('');
      setStadiumName('');
      setYoutubeLink('');
    } catch (err: any) {
      Alert.alert("Xatolik", err.message || "O'yin qo'shishda xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIconBox}>
                <Ionicons name="football" size={20} color="#00FF66" />
              </View>
              <Text style={styles.modalTitle}>{"Tezkor O'yin Qo'shish"}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color="rgba(255, 255, 255, 0.6)" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {/* 1. Liga tanlash */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{"Liganu Tanlang"}</Text>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => setShowLeaguePicker(!showLeaguePicker)}
              >
                <Text style={styles.dropdownText}>{selectedLeague || "Liganu tanlang"}</Text>
                <Ionicons name="chevron-down" size={18} color="rgba(255, 255, 255, 0.5)" />
              </TouchableOpacity>

              {showLeaguePicker && (
                <View style={styles.pickerMenu}>
                  {leagues.map((lg) => (
                    <TouchableOpacity
                      key={lg.id}
                      style={styles.pickerItem}
                      onPress={() => {
                        setSelectedLeague(lg.name);
                        setShowLeaguePicker(false);
                      }}
                    >
                      <Text style={styles.pickerItemText}>{lg.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* 2. Tur (Round) */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{"Nechanchi Tur / Bosqich"}</Text>
              <TextInput
                style={styles.input}
                placeholder="masalan: 1-tur yoki Chorak final"
                placeholderTextColor="rgba(255, 255, 255, 0.35)"
                value={matchRound}
                onChangeText={setMatchRound}
              />
            </View>

            {/* 3. Jamoalar (Mezbon vs Mehmon) */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{"Mezbon Jamoa (Home)"}</Text>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => setShowHomePicker(!showHomePicker)}
              >
                <Text style={styles.dropdownText}>
                  {teams.find((t) => t.id === homeTeamId)?.name || "Mezbon jamoani tanlang"}
                </Text>
                <Ionicons name="chevron-down" size={18} color="rgba(255, 255, 255, 0.5)" />
              </TouchableOpacity>

              {showHomePicker && (
                <View style={styles.pickerMenu}>
                  {filteredTeams.map((tm) => (
                    <TouchableOpacity
                      key={tm.id}
                      style={styles.pickerItem}
                      onPress={() => {
                        setHomeTeamId(tm.id);
                        setShowHomePicker(false);
                      }}
                    >
                      <Text style={styles.pickerItemText}>{tm.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{"Mehmon Jamoa (Away)"}</Text>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => setShowAwayPicker(!showAwayPicker)}
              >
                <Text style={styles.dropdownText}>
                  {teams.find((t) => t.id === awayTeamId)?.name || "Mehmon jamoani tanlang"}
                </Text>
                <Ionicons name="chevron-down" size={18} color="rgba(255, 255, 255, 0.5)" />
              </TouchableOpacity>

              {showAwayPicker && (
                <View style={styles.pickerMenu}>
                  {filteredTeams.map((tm) => (
                    <TouchableOpacity
                      key={tm.id}
                      style={styles.pickerItem}
                      onPress={() => {
                        setAwayTeamId(tm.id);
                        setShowAwayPicker(false);
                      }}
                    >
                      <Text style={styles.pickerItemText}>{tm.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* 4. Sana va Vaqt */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.label}>{"Sana (YYYY-MM-DD)"}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2026-08-15"
                  placeholderTextColor="rgba(255, 255, 255, 0.35)"
                  value={matchDate}
                  onChangeText={setMatchDate}
                />
              </View>

              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.label}>{"Vaqt (HH:MM)"}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="18:00"
                  placeholderTextColor="rgba(255, 255, 255, 0.35)"
                  value={matchTime}
                  onChangeText={setMatchTime}
                />
              </View>
            </View>

            {/* 5. Stadion / Maydon */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{"Stadion / Maydon Nomi"}</Text>
              <TextInput
                style={styles.input}
                placeholder="masalan: Markaziy Stadion 1-Maydon"
                placeholderTextColor="rgba(255, 255, 255, 0.35)"
                value={stadiumName}
                onChangeText={setStadiumName}
              />
            </View>

            {/* 6. O'yin Muhimligi (Importance) */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{"O'yin Muhimligi"}</Text>
              <View style={styles.importanceRow}>
                {(['oddiy', 'ortacha', 'markaziy'] as const).map((imp) => (
                  <TouchableOpacity
                    key={imp}
                    style={[
                      styles.impBtn,
                      importance === imp && styles.impBtnActive,
                    ]}
                    onPress={() => setImportance(imp)}
                  >
                    <Text
                      style={[
                        styles.impBtnText,
                        importance === imp && styles.impBtnTextActive,
                      ]}
                    >
                      {imp === 'oddiy' ? 'Oddiy' : imp === 'ortacha' ? "O'rtacha" : 'Markaziy 🔥'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 7. YouTube Live Stream Link (Optional) */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{"YouTube Translyatsiya Linki (Ixtiyoriy)"}</Text>
              <TextInput
                style={styles.input}
                placeholder="https://youtube.com/live/..."
                placeholderTextColor="rgba(255, 255, 255, 0.35)"
                value={youtubeLink}
                onChangeText={setYoutubeLink}
              />
            </View>

            {/* Actions */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.btnCancel} onPress={onClose}>
                <Text style={styles.btnCancelText}>Bekor qilish</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnSave}
                onPress={handleSaveMatch}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.btnSaveText}>{"O'yinni Qo'shish"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 17, 0.88)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 255, 102, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
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
    gap: 14,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12.5,
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
    fontSize: 13.5,
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  dropdownText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  pickerMenu: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    maxHeight: 160,
  },
  pickerItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  pickerItemText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  importanceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  impBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  impBtnActive: {
    backgroundColor: '#00FF66',
    borderColor: '#00FF66',
  },
  impBtnText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    fontWeight: '700',
  },
  impBtnTextActive: {
    color: '#000000',
    fontWeight: '900',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
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
    flex: 2,
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
