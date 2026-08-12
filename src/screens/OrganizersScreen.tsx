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
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '../context/OrgContext';
import { supabase, supabaseAdmin } from '../supabaseClient';

interface OrganizersScreenProps {
  onGoBack?: () => void;
}

export const OrganizersScreen: React.FC<OrganizersScreenProps> = ({ onGoBack }) => {
  const { orgId, currentOrg, showToast } = useOrg();
  const [organizersList, setOrganizersList] = useState<any[]>([]);
  const [loadingOrganizers, setLoadingOrganizers] = useState(false);
  const [showAddOrganizerForm, setShowAddOrganizerForm] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgEmail, setNewOrgEmail] = useState('');
  const [newOrgPassword, setNewOrgPassword] = useState('');
  const [isCreatingOrgUser, setIsCreatingOrgUser] = useState(false);

  const fetchOrganizers = async () => {
    try {
      setLoadingOrganizers(true);
      const dbClient = supabaseAdmin || supabase;
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

  useEffect(() => {
    fetchOrganizers();
  }, [currentOrg?.id, orgId]);

  const handleCreateOrganizer = async () => {
    if (!newOrgEmail.trim() || !newOrgPassword.trim() || !newOrgName.trim()) {
      Alert.alert('Xatolik', 'Iltimos, barcha maydonlarni to\'ldiring!');
      return;
    }

    try {
      setIsCreatingOrgUser(true);
      const dbClient = supabaseAdmin || supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;

      const { error } = await dbClient.from('organization_users').insert([
        {
          organization_id: targetOrgId,
          email: newOrgEmail.trim().toLowerCase(),
          password: newOrgPassword.trim(),
          full_name: newOrgName.trim(),
          role: 'user',
        },
      ]);

      if (error) {
        throw new Error(error.message);
      }

      if (supabaseAdmin && supabaseAdmin.auth && supabaseAdmin.auth.admin) {
        try {
          await supabaseAdmin.auth.admin.createUser({
            email: newOrgEmail.trim().toLowerCase(),
            password: newOrgPassword.trim(),
            email_confirm: true,
          });
        } catch (authErr) {
          console.warn('Auth admin create note:', authErr);
        }
      }

      if (showToast) {
        showToast({ message: 'Yangi organizator (user) saqlandi!', type: 'success' });
      } else {
        Alert.alert('Muvaffaqiyatli', 'Yangi organizator (user) saqlandi!');
      }

      setNewOrgName('');
      setNewOrgEmail('');
      setNewOrgPassword('');
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
            const dbClient = supabaseAdmin || supabase;
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

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
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
          <ActivityIndicator size="medium" color="#38BDF8" style={{ marginVertical: 30 }} />
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
              <View style={styles.avatarBox}>
                <Ionicons name="person" size={20} color="#38BDF8" />
              </View>

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
  scrollContent: {
    paddingBottom: 140,
    gap: 16,
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
