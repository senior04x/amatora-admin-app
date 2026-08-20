import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../supabaseClient';
import { useOrg } from '../context/OrgContext';
import { adminNotificationService } from '../utils/adminNotificationService';

interface Props {
  onBack?: () => void;
  onSuccess?: () => void;
}

export const CreateMatchScreen: React.FC<Props> = ({ onSuccess }) => {
  const { orgId } = useOrg();
  const [loading, setLoading] = useState(false);

  // DB Data
  const [leagues, setLeagues] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);

  // Form Fields
  const [selectedLeague, setSelectedLeague] = useState('');
  const [homeTeamId, setHomeTeamId] = useState('');
  const [awayTeamId, setAwayTeamId] = useState('');

  // Field Selection (1-maydon vs 2-maydon)
  const [selectedField, setSelectedField] = useState<'1-maydon' | '2-maydon'>('1-maydon');

  // Date & Time Objects for Picker
  const [tempDate, setTempDate] = useState<Date>(() => new Date());
  const [tempTime, setTempTime] = useState<Date>(() => {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    return d;
  });

  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [matchTime, setMatchTime] = useState('18:00');

  const [stadiumName, setStadiumName] = useState('');
  const [matchRound, setMatchRound] = useState('1');
  const [importance, setImportance] = useState<'oddiy' | 'ortacha' | 'markaziy'>('oddiy');

  // Hidden YouTube Link Toggle & Postponed Toggle
  const [enableYtLink, setEnableYtLink] = useState(false);
  const [youtubeLink, setYoutubeLink] = useState('');
  const [isPostponed, setIsPostponed] = useState(false);

  // Pickers modal visibility
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Secret collapsible stages menu
  const [showSecretStages, setShowSecretStages] = useState(false);

  // Dropdown Pickers
  const [showLeaguePicker, setShowLeaguePicker] = useState(false);
  const [showHomePicker, setShowHomePicker] = useState(false);
  const [showAwayPicker, setShowAwayPicker] = useState(false);
  const [showFieldPicker, setShowFieldPicker] = useState(false);

  useEffect(() => {
    fetchLeaguesAndTeams();
  }, [orgId]);

  const fetchLeaguesAndTeams = async () => {
    try {
      let leaguesQuery = supabase.from('leagues').select('*').order('name');
      let teamsQuery = supabase.from('teams').select('*').order('name');

      if (orgId) {
        leaguesQuery = leaguesQuery.eq('organization_id', orgId);
        teamsQuery = teamsQuery.eq('organization_id', orgId);
      }

      const [leaguesRes, teamsRes] = await Promise.all([leaguesQuery, teamsQuery]);

      if (leaguesRes.data) {
        setLeagues(leaguesRes.data);
        if (leaguesRes.data.length > 0) {
          setSelectedLeague(leaguesRes.data[0].name);
        }
      }
      if (teamsRes.data) {
        setTeams(teamsRes.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Filter teams by chosen league (excluding archived teams)
  const filteredTeams = teams.filter(
    (t) => !t.is_archived && (!selectedLeague || !t.league || t.league.split(',').map((s: string) => s.trim()).includes(selectedLeague))
  );

  const homeTeam = teams.find((t) => t.id === homeTeamId);
  const awayTeam = teams.find((t) => t.id === awayTeamId);

  // Confirm Date Selection (OK Button)
  const confirmDateSelection = () => {
    const validDate = tempDate instanceof Date && !isNaN(tempDate.getTime()) ? tempDate : new Date();
    const formattedDate = validDate.toISOString().split('T')[0];
    setMatchDate(formattedDate);
    setShowDatePicker(false);
  };

  // Confirm Time Selection (OK Button)
  const confirmTimeSelection = () => {
    const validTime = tempTime instanceof Date && !isNaN(tempTime.getTime()) ? tempTime : new Date();
    const hours = String(validTime.getHours()).padStart(2, '0');
    const minutes = String(validTime.getMinutes()).padStart(2, '0');
    setMatchTime(`${hours}:${minutes}`);
    setShowTimePicker(false);
  };

  const setPresetDate = (daysToAdd: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysToAdd);
    setTempDate(d);
    setMatchDate(d.toISOString().split('T')[0]);
  };

  const handleSaveMatch = async () => {
    if (!selectedLeague) {
      Alert.alert("Xatolik", "Iltimos, Liganu tanlang!");
      return;
    }
    if (!homeTeamId || !awayTeamId) {
      Alert.alert("Xatolik", "Iltimos, Mezbon va Mehmon jamoalarni tanlang!");
      return;
    }
    if (homeTeamId === awayTeamId) {
      Alert.alert("Xatolik", "Mezbon va Mehmon bir xil jamoa bo'la olmaydi!");
      return;
    }
    if (!matchDate || !matchTime) {
      Alert.alert("Xatolik", "Iltimos, O'yin sanasi va vaqtini kiriting!");
      return;
    }

    setLoading(true);
    try {
      const dbClient = supabase;
      const activeOrgId = Number(orgId) || 1;

      // Conflict Guard: check if another match is scheduled on the exact same field, date & time
      let conflictQuery = dbClient
        .from('matches')
        .select('id, home_team_id, away_team_id, location, match_date, match_time')
        .eq('location', selectedField)
        .eq('match_date', matchDate)
        .eq('match_time', matchTime);

      if (orgId) {
        conflictQuery = conflictQuery.eq('organization_id', activeOrgId);
      }

      const { data: existingMatches, error: conflictErr } = await conflictQuery;

      if (conflictErr) {
        console.warn('Conflict check note:', conflictErr);
      }

      if (existingMatches && existingMatches.length > 0) {
        setLoading(false);
        Alert.alert(
          "Maydon Band!",
          `Ushbu "${selectedField === '1-maydon' ? '1-Maydon' : '2-Maydon'}"da ${matchDate} kuni soat ${matchTime} da boshqa o'yin rejalashtirilgan! Iltimos, boshqa vaqt yoki maydonni tanlang.`
        );
        return;
      }

      const parsedRound = parseInt(matchRound, 10) || 1;

      // Clean DB Payload with valid schema columns
      const basePayload: any = {
        organization_id: activeOrgId,
        league: selectedLeague,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        match_date: matchDate,
        match_time: matchTime,
        location: stadiumName?.trim() || selectedField,
        round: parsedRound,
        youtube_link: enableYtLink ? (youtubeLink.trim() || null) : null,
        status: 'scheduled',
        importance: importance || 'oddiy',
      };

      const { data: insertedData, error } = await dbClient.from('matches').insert([basePayload]).select();

      if (error) {
        console.error('Insert match error:', error);
        throw error;
      }

      // Trigger push notification to both teams
      try {
        const homeTeamObj = teams.find((t) => t.id === homeTeamId);
        const awayTeamObj = teams.find((t) => t.id === awayTeamId);

        adminNotificationService.notifyMatchScheduled({
          homeTeamId,
          awayTeamId,
          homeTeamName: homeTeamObj?.name || 'Jamoa 1',
          awayTeamName: awayTeamObj?.name || 'Jamoa 2',
          matchDate,
          matchTime,
          stadium: stadiumName?.trim() || selectedField,
          matchId: insertedData?.[0]?.id ? String(insertedData[0].id) : undefined,
          organizationId: activeOrgId,
        }).catch((err) => console.warn('Match push error:', err));
      } catch (pushErr) {
        console.warn('Push error:', pushErr);
      }

      if (Platform.OS === 'web') {
        window.alert("Yangi o'yin jadvalga muvaffaqiyatli kiritildi! ✓");
        if (onSuccess) onSuccess();
      } else {
        Alert.alert("Muvaffaqiyatli", "Yangi o'yin jadvalga kiritildi!", [
          {
            text: "OK",
            onPress: () => {
              if (onSuccess) onSuccess();
            },
          },
        ]);
      }
    } catch (e: any) {
      console.error('Create match error:', e);
      if (Platform.OS === 'web') {
        window.alert("Xatolik: " + (e.message || "O'yinni saqlashda xatolik yuz berdi"));
      } else {
        Alert.alert("Xatolik", e.message || "O'yinni saqlashda xatolik yuz berdi");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{"Yangi O'yin Yaratish"}</Text>
          <Text style={styles.headerSub}>{"Turnir o'yini jadvalini shakllantiring"}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 1. Liga Tanlash */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>{"1. Liga / Musobaqa *"}</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setShowLeaguePicker(true)}>
            <Text style={styles.selectBtnText}>{selectedLeague || "Liganu tanlang"}</Text>
            <Ionicons name="chevron-down" size={18} color="rgba(255, 255, 255, 0.5)" />
          </TouchableOpacity>
        </View>

        {/* 2. Mezbon Jamoa */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>{"2. Mezbon Jamoa (Home) *"}</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setShowHomePicker(true)}>
            {homeTeam ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image
                  source={{
                    uri:
                      homeTeam.logo_url ||
                      'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop',
                  }}
                  style={{ width: 22, height: 22, borderRadius: 6 }}
                />
                <Text style={styles.selectBtnText}>{homeTeam.name}</Text>
              </View>
            ) : (
              <Text style={styles.selectBtnPlaceholder}>{"Mezbon jamoani tanlang"}</Text>
            )}
            <Ionicons name="chevron-down" size={18} color="rgba(255, 255, 255, 0.5)" />
          </TouchableOpacity>
        </View>

        {/* 3. Mehmon Jamoa */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>{"3. Mehmon Jamoa (Away) *"}</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setShowAwayPicker(true)}>
            {awayTeam ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image
                  source={{
                    uri:
                      awayTeam.logo_url ||
                      'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop',
                  }}
                  style={{ width: 22, height: 22, borderRadius: 6 }}
                />
                <Text style={styles.selectBtnText}>{awayTeam.name}</Text>
              </View>
            ) : (
              <Text style={styles.selectBtnPlaceholder}>{"Mehmon jamoani tanlang"}</Text>
            )}
            <Ionicons name="chevron-down" size={18} color="rgba(255, 255, 255, 0.5)" />
          </TouchableOpacity>
        </View>

        {/* Live Preview Card */}
        {homeTeam && awayTeam && (
          <View style={styles.vsPreviewCard}>
            <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.vsTeamCol}>
              <Image source={{ uri: homeTeam.logo_url }} style={styles.vsTeamLogo} />
              <Text style={styles.vsTeamName} numberOfLines={1}>
                {homeTeam.name}
              </Text>
            </View>
            <View style={styles.vsBadge}>
              <Text style={styles.vsBadgeText}>VS</Text>
            </View>
            <View style={styles.vsTeamCol}>
              <Image source={{ uri: awayTeam.logo_url }} style={styles.vsTeamLogo} />
              <Text style={styles.vsTeamName} numberOfLines={1}>
                {awayTeam.name}
              </Text>
            </View>
          </View>
        )}

        {/* 4. Maydon / Location Selection */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>{"4. Maydon (Stream Joylashuvi) *"}</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setShowFieldPicker(true)}>
            <Text style={styles.selectBtnText}>
              {selectedField === '1-maydon' ? "1-Maydon (Asosiy)" : "2-Maydon (Qo'shimcha)"}
            </Text>
            <Ionicons name="chevron-down" size={18} color="rgba(255, 255, 255, 0.5)" />
          </TouchableOpacity>
        </View>

        {/* 5. Tur / Bosqich */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{"5. Tur / Bosqich *"}</Text>
            <TouchableOpacity onPress={() => setShowSecretStages(!showSecretStages)}>
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>
                {showSecretStages ? "Yashirish ▲" : "Bosqichlar (Final/Pley-off) ▼"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick Round Number Buttons */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((num) => (
              <TouchableOpacity
                key={num}
                style={[styles.roundChip, matchRound === num && styles.roundChipActive]}
                onPress={() => setMatchRound(num)}
              >
                <Text style={[styles.roundChipText, matchRound === num && styles.roundChipTextActive]}>
                  {num}-tur
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Secret Collapsible Stages */}
          {showSecretStages && (
            <View style={styles.secretStagesContainer}>
              <Text style={styles.secretStagesTitle}>{"Nokaut & Play-Off Bosqichlari:"}</Text>
              <View style={styles.secretStagesGrid}>
                {['1/16 Final', '1/8 Final', 'Chorak Final', 'Yarim Final', '3-O\'rin uchun', 'FINAL'].map((st) => (
                  <TouchableOpacity
                    key={st}
                    style={[styles.secretStageChip, matchRound === st && styles.secretStageChipActive]}
                    onPress={() => setMatchRound(st)}
                  >
                    <Text style={[styles.secretStageText, matchRound === st && styles.secretStageTextActive]}>
                      {st}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <TextInput
            style={styles.input}
            placeholder="Kiritilgan tur: masalan 1-tur yoki Final"
            placeholderTextColor="rgba(255, 255, 255, 0.35)"
            value={matchRound}
            onChangeText={setMatchRound}
          />
        </View>

        {/* 6. Date & Time Selection Modals */}
        <View style={styles.rowTwoCols}>
          {/* Match Date */}
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>{"6. Sana *"}</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
              <Text style={{ color: matchDate ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)', fontSize: 13.5 }}>
                {matchDate || "YYYY-MM-DD"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Match Time */}
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>{"Vaqt *"}</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowTimePicker(true)}>
              <Text style={{ color: matchTime ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)', fontSize: 13.5 }}>
                {matchTime || "HH:MM"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Date Picker Modal */}
          <Modal visible={showDatePicker} transparent animationType="fade">
            <View style={styles.pickerModalOverlay}>
              <View style={styles.pickerModalCard}>
                <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
                <View style={styles.pickerModalHeader}>
                  <Text style={styles.pickerModalTitle}>O'yin Sanasini Tanlang 📅</Text>
                </View>

                {/* Preset Quick Date Buttons */}
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                  <TouchableOpacity style={styles.roundChip} onPress={() => setPresetDate(0)}>
                    <Text style={styles.roundChipText}>Bugun</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.roundChip} onPress={() => setPresetDate(1)}>
                    <Text style={styles.roundChipText}>Ertaga</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.roundChip} onPress={() => setPresetDate(2)}>
                    <Text style={styles.roundChipText}>Indin</Text>
                  </TouchableOpacity>
                </View>

                <DateTimePicker
                  value={tempDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant="dark"
                  onChange={(_, d) => d && setTempDate(d)}
                />

                <View style={styles.pickerModalActionRow}>
                  <TouchableOpacity
                    style={styles.pickerCancelBtn}
                    onPress={() => setShowDatePicker(false)}
                  >
                    <Text style={styles.pickerCancelText}>Bekor</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.pickerOkBtn} onPress={confirmDateSelection}>
                    <Text style={styles.pickerOkText}>OK • Tasdiqlash</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Time Picker Modal */}
          <Modal visible={showTimePicker} transparent animationType="fade">
            <View style={styles.pickerModalOverlay}>
              <View style={styles.pickerModalCard}>
                <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
                <View style={styles.pickerModalHeader}>
                  <Text style={styles.pickerModalTitle}>O'yin Vaqtini Tanlang ⏰</Text>
                </View>

                <DateTimePicker
                  value={tempTime}
                  mode="time"
                  is24Hour
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant="dark"
                  onChange={(_, t) => t && setTempTime(t)}
                />

                <View style={styles.pickerModalActionRow}>
                  <TouchableOpacity
                    style={styles.pickerCancelBtn}
                    onPress={() => setShowTimePicker(false)}
                  >
                    <Text style={styles.pickerCancelText}>Bekor</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.pickerOkBtn} onPress={confirmTimeSelection}>
                    <Text style={styles.pickerOkText}>OK • Tasdiqlash</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>

        {/* 7. Stadion Nomi */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>{"7. Stadion / Kompleks Nomi"}</Text>
          <TextInput
            style={styles.input}
            placeholder="masalan: Markaziy Arena"
            placeholderTextColor="rgba(255, 255, 255, 0.35)"
            value={stadiumName}
            onChangeText={setStadiumName}
          />
        </View>

        {/* 8. O'yin Muhimligi (Importance) */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>{"8. O'yin Muhimligi Statusi"}</Text>
          <View style={styles.importanceRow}>
            {(['oddiy', 'ortacha', 'markaziy'] as const).map((imp) => (
              <TouchableOpacity
                key={imp}
                style={[styles.impBtn, importance === imp && styles.impBtnActive]}
                onPress={() => setImportance(imp)}
              >
                {imp === 'markaziy' ? (
                  <Ionicons
                    name="flame-outline"
                    size={16}
                    color={importance === 'markaziy' ? '#000000' : '#FF9500'}
                    style={{ marginRight: 4 }}
                  />
                ) : null}
                <Text style={[styles.impBtnText, importance === imp && styles.impBtnTextActive]}>
                  {imp === 'oddiy' ? 'Oddiy' : imp === 'ortacha' ? "O'rtacha" : 'Markaziy'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 9. YouTube Translyatsiya Linki (Yashirin Switch Toggle) */}
        <View style={styles.switchRowCard}>
          <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>{"YouTube Translyatsiya Linki 📺"}</Text>
            <Text style={styles.switchSubText}>{"Jonli efir havolasini kiritish uchun yoqing"}</Text>
          </View>
          <Switch
            value={enableYtLink}
            onValueChange={setEnableYtLink}
            trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: 'rgba(255, 255, 255, 0.35)' }}
            thumbColor={enableYtLink ? '#FFFFFF' : '#94A3B8'}
          />
        </View>

        {enableYtLink && (
          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder="https://youtube.com/live/..."
              placeholderTextColor="rgba(255, 255, 255, 0.35)"
              value={youtubeLink}
              onChangeText={setYoutubeLink}
            />
          </View>
        )}

        {/* 10. Qoldirilgan O'yin Switcher (Postponed Toggle) */}
        <View style={styles.switchRowCard}>
          <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>{"O'yin Qoldirilgan Statusi ⏸️"}</Text>
            <Text style={styles.switchSubText}>{"Uchrashuv noma'lum muddatga qoldirilgan bo'lsa yoqing"}</Text>
          </View>
          <Switch
            value={isPostponed}
            onValueChange={setIsPostponed}
            trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: '#EF4444' }}
            thumbColor={isPostponed ? '#FFFFFF' : '#94A3B8'}
          />
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={styles.submitBtn}
          onPress={handleSaveMatch}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.submitBtnText}>{"O'yinni Jadvalga Saqlash"}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* --- MODALS FOR DROPDOWNS --- */}
      {/* League Selector Modal */}
      <Modal visible={showLeaguePicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Liganu Tanlang 🏆</Text>
              <TouchableOpacity onPress={() => setShowLeaguePicker(false)}>
                <Ionicons name="close" size={22} color="rgba(255, 255, 255, 0.6)" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {leagues.map((l) => (
                <TouchableOpacity
                  key={l.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setSelectedLeague(l.name);
                    setShowLeaguePicker(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{l.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Home Team Picker Modal */}
      <Modal visible={showHomePicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Mezbon Jamoani Tanlang 🏠</Text>
              <TouchableOpacity onPress={() => setShowHomePicker(false)}>
                <Ionicons name="close" size={22} color="rgba(255, 255, 255, 0.6)" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {filteredTeams.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setHomeTeamId(t.id);
                    setShowHomePicker(false);
                  }}
                >
                  <Image source={{ uri: t.logo_url }} style={styles.pickerTeamLogo} />
                  <Text style={styles.pickerItemText}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Away Team Picker Modal */}
      <Modal visible={showAwayPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Mehmon Jamoani Tanlang ✈️</Text>
              <TouchableOpacity onPress={() => setShowAwayPicker(false)}>
                <Ionicons name="close" size={22} color="rgba(255, 255, 255, 0.6)" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {filteredTeams.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setAwayTeamId(t.id);
                    setShowAwayPicker(false);
                  }}
                >
                  <Image source={{ uri: t.logo_url }} style={styles.pickerTeamLogo} />
                  <Text style={styles.pickerItemText}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Field Location Picker Modal */}
      <Modal visible={showFieldPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Maydonni Tanlang 📍</Text>
              <TouchableOpacity onPress={() => setShowFieldPicker(false)}>
                <Ionicons name="close" size={22} color="rgba(255, 255, 255, 0.6)" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.pickerItem}
              onPress={() => {
                setSelectedField('1-maydon');
                setShowFieldPicker(false);
              }}
            >
              <Text style={styles.pickerItemText}>1-Maydon (Asosiy)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerItem}
              onPress={() => {
                setSelectedField('2-maydon');
                setShowFieldPicker(false);
              }}
            >
              <Text style={styles.pickerItemText}>2-Maydon (Qo'shimcha)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  headerSub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  scrollContent: {
    paddingBottom: 130,
    gap: 18,
  },
  inputGroup: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 14,
    height: 48,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 14,
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 14,
    height: 48,
    paddingHorizontal: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  selectBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  selectBtnPlaceholder: {
    color: 'rgba(255, 255, 255, 0.35)',
    fontSize: 14,
  },
  rowTwoCols: {
    flexDirection: 'row',
    gap: 12,
  },
  roundChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  roundChipActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  roundChipText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontWeight: '700',
  },
  roundChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  secretStagesContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    padding: 12,
    borderRadius: 14,
    gap: 8,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  secretStagesTitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    fontWeight: '700',
  },
  secretStagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  secretStageChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  secretStageChipActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  secretStageText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  secretStageTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  switchRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  switchLabel: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  switchSubText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  pickerTeamLogo: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  pickerItemText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  vsPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  vsTeamCol: {
    alignItems: 'center',
    flex: 1,
  },
  vsTeamLogo: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 6,
  },
  vsTeamName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  vsBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  vsBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  importanceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  impBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  impBtnActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  impBtnText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12.5,
    fontWeight: '700',
  },
  impBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  submitBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  /* Picker Modal Overlay */
  pickerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pickerModalCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    overflow: 'hidden',
  },
  pickerModalHeader: {
    marginBottom: 16,
  },
  pickerModalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  pickerModalActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    width: '100%',
  },
  pickerCancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  pickerCancelText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  pickerOkBtn: {
    flex: 1.5,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  pickerOkText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});
