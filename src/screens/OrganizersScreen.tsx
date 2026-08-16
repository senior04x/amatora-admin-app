import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';

interface OrganizersScreenProps {
  onGoBack?: () => void;
}

export const OrganizersScreen: React.FC<OrganizersScreenProps> = ({ onGoBack }) => {
  const { orgId, currentOrg, showToast } = useOrg();
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'logs'>('users');
  const [organizersList, setOrganizersList] = useState<any[]>([]);
  const [loadingOrganizers, setLoadingOrganizers] = useState(false);
  const [showAddOrganizerForm, setShowAddOrganizerForm] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgEmail, setNewOrgEmail] = useState('');
  const [newOrgPassword, setNewOrgPassword] = useState('');
  const [newOrgAvatar, setNewOrgAvatar] = useState<string | null>(null);
  const [isCreatingOrgUser, setIsCreatingOrgUser] = useState(false);

  // Login Activity Logs State
  const [loginLogs, setLoginLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const fetchOrganizers = async () => {
    try {
      setLoadingOrganizers(true);
      const dbClient = supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;

      const { data, error } = await dbClient
        .from('organization_users')
        .select('*')
        .eq('organization_id', targetOrgId)
        .order('id', { ascending: false });

      if (!error && data) {
        setOrganizersList(data);
      } else {
        setOrganizersList([]);
      }
    } catch (e) {
      console.error('Fetch organizers error:', e);
    } finally {
      setLoadingOrganizers(false);
    }
  };

  const fetchLoginLogs = async () => {
    try {
      setLoadingLogs(true);
      const dbClient = supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;

      const { data, error } = await dbClient
        .from('user_login_logs')
        .select('*')
        .eq('organization_id', targetOrgId)
        .order('login_at', { ascending: false })
        .limit(100);

      if (!error && data) {
        setLoginLogs(data);
      } else {
        setLoginLogs([]);
      }
    } catch (e) {
      console.error('Fetch login logs error:', e);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchOrganizers();
    fetchLoginLogs();
  }, [currentOrg?.id, orgId]);

  const formatLogTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('uz-UZ', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (e) {
      return dateStr;
    }
  };

  const handlePickAvatar = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false, // Instant selection without slow cropper delay
        quality: 0.6,
        base64: true,
      });

      if (!res.canceled && res.assets[0]) {
        const asset = res.assets[0];
        if (asset.base64) {
          setNewOrgAvatar(`data:image/jpeg;base64,${asset.base64}`);
        } else {
          setNewOrgAvatar(asset.uri);
        }
      }
    } catch (e) {
      console.error('Avatar pick error:', e);
    }
  };

  const uploadAvatarToSupabase = async (dbClient: any, localUri: string): Promise<string | null> => {
    try {
      if (!localUri) return null;
      if (localUri.startsWith('http://') || localUri.startsWith('https://')) {
        return localUri;
      }

      const fileExt = 'jpg';
      const fileName = `user_avatar_${Date.now()}.${fileExt}`;
      const filePath = `user-avatars/${fileName}`;

      let arrayBuffer: ArrayBuffer | null = null;
      if (localUri.startsWith('data:image')) {
        const base64Data = localUri.split(',')[1];
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
        arrayBuffer = decodeBase64(base64Data).buffer as ArrayBuffer;
      } else {
        const res = await fetch(localUri);
        const blob = await res.blob();
        arrayBuffer = await new Response(blob).arrayBuffer();
      }

      const { error: uploadError } = await dbClient.storage
        .from('player-photos')
        .upload(filePath, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) {
        console.warn('Avatar storage upload warn:', uploadError);
      }

      const { data: urlData } = dbClient.storage
        .from('player-photos')
        .getPublicUrl(filePath);

      return urlData?.publicUrl || localUri;
    } catch (e) {
      console.error('Upload avatar to Supabase error:', e);
      return localUri;
    }
  };

  const handleCreateOrganizer = async () => {
    if (!newOrgEmail.trim() || !newOrgPassword.trim() || !newOrgName.trim()) {
      Alert.alert('Xatolik', 'Iltimos, barcha maydonlarni to\'ldiring!');
      return;
    }

    try {
      setIsCreatingOrgUser(true);
      const dbClient = supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;

      // Upload avatar image to Supabase Storage bucket first to get public HTTP URL
      let uploadedAvatarUrl: string | null = null;
      if (newOrgAvatar) {
        uploadedAvatarUrl = await uploadAvatarToSupabase(dbClient, newOrgAvatar);
      }

      const { error } = await dbClient.from('organization_users').insert([
        {
          organization_id: targetOrgId,
          email: newOrgEmail.trim().toLowerCase(),
          password: newOrgPassword.trim(),
          full_name: newOrgName.trim(),
          role: 'user',
          avatar_url: uploadedAvatarUrl || null,
        },
      ]);

      if (error) {
        throw new Error(error.message);
      }

      if (showToast) {
        showToast({ message: 'Yangi organizator (user) saqlandi!', type: 'success' });
      } else {
        Alert.alert('Muvaffaqiyatli', 'Yangi organizator (user) saqlandi!');
      }

      setNewOrgName('');
      setNewOrgEmail('');
      setNewOrgPassword('');
      setNewOrgAvatar(null);
      setShowAddOrganizerForm(false);
      fetchOrganizers();
    } catch (err: any) {
      Alert.alert('Xatolik', err.message || 'Organizator qo\'shishda xatolik yuz berdi');
    } finally {
      setIsCreatingOrgUser(false);
    }
  };

  const handleDeleteOrganizer = async (id: any) => {
    Alert.alert('Tasdiqlash', 'Ushbu organizatorni o\'chirmoqchimisiz?', [
      { text: 'Bekor qilish', style: 'cancel' },
      {
        text: 'O\'chirish',
        style: 'destructive',
        onPress: async () => {
          try {
            const dbClient = supabase;
            await dbClient.from('organization_users').delete().eq('id', id);
            fetchOrganizers();
            if (showToast) {
              showToast({ message: 'Organizator o\'chirildi', type: 'info' });
            }
          } catch (e) {
            console.error('Delete organizer error:', e);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Top Bar Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onGoBack}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle}>{"Organizatorlar Bilan Ishlash"}</Text>
          <Text style={styles.headerSub}>{`Tashkilot ID: #${currentOrg?.id || orgId}`}</Text>
        </View>
      </View>

      {/* SubTab Switcher */}
      <View style={styles.subTabRow}>
        <TouchableOpacity
          style={[styles.subTabBtn, activeSubTab === 'users' && styles.subTabBtnActive]}
          onPress={() => setActiveSubTab('users')}
          activeOpacity={0.8}
        >
          <Ionicons name="people" size={16} color={activeSubTab === 'users' ? '#38BDF8' : '#94A3B8'} />
          <Text style={[styles.subTabText, activeSubTab === 'users' && styles.subTabTextActive]}>{"Userlar (" + organizersList.length + ")"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.subTabBtn, activeSubTab === 'logs' && styles.subTabBtnActive]}
          onPress={() => {
            setActiveSubTab('logs');
            fetchLoginLogs();
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="location" size={16} color={activeSubTab === 'logs' ? '#38BDF8' : '#94A3B8'} />
          <Text style={[styles.subTabText, activeSubTab === 'logs' && styles.subTabTextActive]}>{"Kirish Tarixi va Joylashuvi"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeSubTab === 'users' ? (
          <>
            {/* Action Button: Add User */}
            {!showAddOrganizerForm ? (
              <TouchableOpacity
                style={styles.addBtn}
                activeOpacity={0.8}
                onPress={() => setShowAddOrganizerForm(true)}
              >
                <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
                <Ionicons name="person-add" size={20} color="#38BDF8" />
                <Text style={styles.addBtnText}>{"Yangi User (Organizator) Qo'shish"}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.formCard}>
                <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
                <Text style={styles.formTitle}>{"Yangi Organizator Kiritish"}</Text>

                {/* Avatar Image Picker Button */}
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.12)',
                  }}
                  onPress={handlePickAvatar}
                  activeOpacity={0.8}
                >
                  {newOrgAvatar ? (
                    <Image source={{ uri: newOrgAvatar }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                  ) : (
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(56, 189, 248, 0.2)', justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name="camera-outline" size={20} color="#38BDF8" />
                    </View>
                  )}
                  <Text style={{ color: '#E2E8F0', fontSize: 13, fontWeight: '600' }}>
                    {newOrgAvatar ? "Rasm tanlandi (O'zgartirish)" : "User Rasmini Yuklash (Galereyadan)"}
                  </Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.input}
                  placeholder="F.I.SH (Ism Familiya)"
                  placeholderTextColor="#64748B"
                  value={newOrgName}
                  onChangeText={setNewOrgName}
                />

                <TextInput
                  style={[styles.input, { marginTop: 10 }]}
                  placeholder="Login Email"
                  placeholderTextColor="#64748B"
                  value={newOrgEmail}
                  onChangeText={setNewOrgEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <TextInput
                  style={[styles.input, { marginTop: 10 }]}
                  placeholder="Parol"
                  placeholderTextColor="#64748B"
                  value={newOrgPassword}
                  onChangeText={setNewOrgPassword}
                  secureTextEntry
                />

                <View style={styles.formActions}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => setShowAddOrganizerForm(false)}
                  >
                    <Text style={styles.cancelBtnText}>{"Bekor qilish"}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={handleCreateOrganizer}
                    disabled={isCreatingOrgUser}
                  >
                    {isCreatingOrgUser ? (
                      <ActivityIndicator size="small" color="#000000" />
                    ) : (
                      <Text style={styles.saveBtnText}>{"Saqlash"}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Organizers List Section */}
            <Text style={styles.sectionTitle}>{"Mavjud Organizatorlar"}</Text>

            {loadingOrganizers ? (
              <ActivityIndicator size="small" color="#38BDF8" style={{ marginVertical: 30 }} />
            ) : organizersList.length === 0 ? (
              <View style={styles.emptyCard}>
                <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
                <Ionicons name="people-outline" size={48} color="rgba(255,255,255,0.2)" />
                <Text style={styles.emptyText}>{"Hozircha biriktirilgan organizatorlar yo'q"}</Text>
              </View>
            ) : (
              organizersList.map((item) => (
                <View key={item.id} style={styles.userCard}>
                  <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
                  {item.avatar_url ? (
                    <Image source={{ uri: item.avatar_url }} style={{ width: 42, height: 42, borderRadius: 21, marginRight: 12 }} />
                  ) : (
                    <View style={styles.avatarBox}>
                      <Ionicons name="person" size={20} color="#38BDF8" />
                    </View>
                  )}

                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{item.full_name || 'Organizator'}</Text>
                    <Text style={styles.userEmail}>{item.email}</Text>
                    <Text style={styles.userPassword}>{`Parol: ${item.password}`}</Text>
                  </View>

                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDeleteOrganizer(item.id)}
                  >
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </>
        ) : (
          <>
            {/* Login Activity Logs View */}
            <Text style={styles.sectionTitle}>{"Foydalanuvchilar Kirish Tarixi va Joylashuvlari"}</Text>

            {loadingLogs ? (
              <ActivityIndicator size="small" color="#38BDF8" style={{ marginVertical: 30 }} />
            ) : loginLogs.length === 0 ? (
              <View style={styles.emptyCard}>
                <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
                <Ionicons name="location-outline" size={48} color="rgba(255,255,255,0.2)" />
                <Text style={styles.emptyText}>{"Hozircha kirish tarixi yo'q"}</Text>
              </View>
            ) : (
              loginLogs.map((log) => (
                <View key={log.id} style={styles.logCard}>
                  <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
                  
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <View style={styles.logAvatar}>
                      <Ionicons name="person-circle" size={22} color="#38BDF8" />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.logUserName}>{log.user_name || log.user_email}</Text>
                      <Text style={styles.logUserEmail}>{log.user_email}</Text>
                    </View>

                    <View style={styles.roleBadge}>
                      <Text style={styles.roleBadgeText}>{(log.user_role || 'user').toUpperCase()}</Text>
                    </View>
                  </View>

                  <View style={styles.logDivider} />

                  <View style={styles.logRow}>
                    <Ionicons name="time-outline" size={15} color="#38BDF8" />
                    <Text style={styles.logDetailText}>{`Kirgan vaqti: ${formatLogTime(log.login_at)}`}</Text>
                  </View>

                  <View style={[styles.logRow, { marginTop: 4 }]}>
                    <Ionicons name="location-outline" size={15} color="#4ADE80" />
                    <Text style={[styles.logDetailText, { color: '#E2E8F0', fontWeight: '600' }]}>
                      {`Joylashuv: ${log.location_address || 'Aniqlanmadi'}`}
                    </Text>
                  </View>

                  {log.device_info && (
                    <View style={[styles.logRow, { marginTop: 4 }]}>
                      <Ionicons name="hardware-chip-outline" size={15} color="#94A3B8" />
                      <Text style={styles.logSubText}>{`Qurilma: ${log.device_info}`}</Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
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
    marginBottom: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  subTabRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  subTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  subTabBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  subTabText: {
    color: '#94A3B8',
    fontSize: 12.5,
    fontWeight: '600',
  },
  subTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  scrollContent: {
    paddingBottom: 140,
    gap: 16,
  },
  logCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  logAvatar: {
    marginRight: 8,
  },
  logUserName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  logUserEmail: {
    color: '#94A3B8',
    fontSize: 12,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  roleBadgeText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
  },
  logDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 8,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logDetailText: {
    color: '#CBD5E1',
    fontSize: 12.5,
  },
  logSubText: {
    color: '#94A3B8',
    fontSize: 11.5,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1.2,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    overflow: 'hidden',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  formCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    overflow: 'hidden',
  },
  formTitle: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  emptyCard: {
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 10,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  avatarBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  userEmail: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  userPassword: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
});
