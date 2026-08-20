import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Switch,
  Alert,
  ActivityIndicator,
  TextInput,
  Linking,
  Animated,
  Modal,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { ColorPicker } from '@darthrapid/react-native-color-picker';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';
import { triggerIosCrescendoHaptic } from '../utils/haptics';

const TextSkeleton: React.FC<{ width?: number | string; height?: number; borderRadius?: number; style?: any }> = ({
  width = 120,
  height = 16,
  borderRadius = 6,
  style,
}) => {
  const opacityAnim = React.useRef(new Animated.Value(0.3)).current;

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 0.7,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: 'rgba(255, 255, 255, 0.22)',
          opacity: opacityAnim,
        },
        style,
      ]}
    />
  );
};

export const AccountScreen: React.FC<{
  onNavigateToSettings?: () => void;
  onNavigateToOrganizers?: () => void;
  onLogout?: () => void;
}> = ({
  onNavigateToSettings,
  onNavigateToOrganizers,
  onLogout,
}) => {
  const {
    orgId,
    currentOrg,
    currentUser,
    updateCurrentUserLocally,
    refreshCurrentUser,
    loading,
    userRole,
    transferWindowOpen,
    isRegistrationOpen,
    toggleTransferWindow,
    toggleRegistrationStatus,
    refreshOrg,
    updateOrgLocally,
    showToast,
  } = useOrg();

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Organizers (User Role) Management State
  const [showOrganizersModal, setShowOrganizersModal] = useState(false);
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

  const handleOpenOrganizersModal = () => {
    setShowOrganizersModal(true);
    fetchOrganizers();
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

      Alert.alert('Muvaffaqiyatli', 'Yangi organizator (user) saqlandi!');
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
            const dbClient = supabase;
            await dbClient.from('organization_users').delete().eq('id', id);
            fetchOrganizers();
          } catch (e) {
            console.error('Delete organizer error:', e);
          }
        },
      },
    ]);
  };

  // 1-to-1 SuperAdmin Organization Edit Form State
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editName, setEditName] = useState(currentOrg?.name || '');
  const [editSlug, setEditSlug] = useState(currentOrg?.slug || '');
  const [editEmail, setEditEmail] = useState(currentOrg?.admin_email || currentOrg?.email || '');
  const [editPassword, setEditPassword] = useState(currentOrg?.admin_password || currentOrg?.password || '');
  // Phone suffix only (without +998 prefix)
  const rawPhone = (v: string) => v.replace(/^\+998\s?/, '').replace(/^\+998/, '');
  const [editPhoneSuffix, setEditPhoneSuffix] = useState(rawPhone(currentOrg?.contact_phone || currentOrg?.phone || ''));
  const [showPassword, setShowPassword] = useState(false);
  const [editBrandColors, setEditBrandColors] = useState<string[]>(
    Array.isArray(currentOrg?.brand_colors) ? currentOrg.brand_colors : ['#00FF87']
  );
  const [isSavingInfo, setIsSavingInfo] = useState(false);

  const handleAddBrandColor = () => {
    setEditBrandColors((prev) => [...prev, '#38BDF8']);
  };

  const handleUpdateBrandColor = (index: number, val: string) => {
    const updated = [...editBrandColors];
    updated[index] = val;
    setEditBrandColors(updated);
  };

  const handleRemoveBrandColor = (index: number) => {
    if (editBrandColors.length <= 1) return;
    setEditBrandColors((prev) => prev.filter((_, idx) => idx !== index));
  };

  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (userRole === 'user') {
        try {
          const dbClient = supabase;
          const { data: sessionData } = await supabase.auth.getSession();
          let sessionEmail = sessionData?.session?.user?.email || currentUser?.email;
          if (!sessionEmail) {
            sessionEmail = await AsyncStorage.getItem('@amatora_user_email');
          }

          if (sessionEmail) {
            const { data: userRec } = await dbClient
              .from('organization_users')
              .select('*')
              .ilike('email', sessionEmail)
              .maybeSingle();

            if (userRec) {
              setEditName(userRec.full_name || 'Organizator');
              setEditEmail(userRec.email || sessionEmail);
              setEditPassword(userRec.password || '');
              setUserAvatarUrl(userRec.avatar_url || null);
              return;
            }
          }
        } catch (e) {
          console.error('Fetch user account record error:', e);
        }
      }

      if (currentOrg) {
        setEditName(currentOrg.name || '');
        setEditSlug(currentOrg.slug || '');
        setEditEmail(currentOrg.admin_email || currentOrg.email || '');
        setEditPassword(currentOrg.admin_password || currentOrg.password || '');
        const phoneVal = currentOrg.contact_phone || currentOrg.phone || '';
        setEditPhoneSuffix(rawPhone(phoneVal));
        setEditBrandColors(Array.isArray(currentOrg.brand_colors) ? currentOrg.brand_colors : ['#00FF87']);
      }
    };

    loadData();
  }, [currentOrg, userRole]);

  // Handle Organization Logo Upload (SuperAdmin - Instant 0ms Preview + Background CDN Upload)
  const handlePickLogo = async () => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
        base64: false,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const asset = pickerResult.assets[0];
      const localUri = asset.uri;

      // 1. Instant 0ms local update for Header & AccountScreen
      updateOrgLocally({ logo_url: localUri });
      showToast({ message: "Tashkilot logotipi tanlandi, saqlanmoqda...", type: "info" });

      // 2. Background Asynchronous CDN Upload (Non-blocking)
      (async () => {
        try {
          const dbClient = supabase;
          const fileExt = localUri.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
          const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(fileExt) ? fileExt : 'jpg';
          const fileName = `org_logo_${orgId || 1}_${Date.now()}.${safeExt}`;

          const response = await fetch(localUri);
          const blob = await response.blob();
          const arrayBuffer = await new Response(blob).arrayBuffer();

          const { error: uploadErr } = await dbClient.storage
            .from('player-photos')
            .upload(`logos/${fileName}`, arrayBuffer, {
              contentType: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
              upsert: true
            });

          if (uploadErr) {
            console.error('Storage logo upload error:', uploadErr);
            return;
          }

          const { data: urlData } = dbClient.storage.from('player-photos').getPublicUrl(`logos/${fileName}`);
          const publicUrl = urlData?.publicUrl || '';

          if (publicUrl) {
            await dbClient.from('organizations').update({ logo_url: publicUrl }).eq('id', orgId || 1);
            updateOrgLocally({ logo_url: publicUrl });
            refreshOrg();
            showToast({ message: "Tashkilot logotipi muvaffaqiyatli saqlandi! ✅", type: "success" });
          }
        } catch (bgErr: any) {
          console.warn('Background logo upload warn:', bgErr);
        }
      })();
    } catch (err: any) {
      console.error('Error picking logo:', err);
    }
  };

  // Handle User Avatar Photo Upload (Organizator / User - Instant 0ms Preview + Background CDN Upload)
  const handlePickUserAvatar = async () => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        base64: false,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const asset = pickerResult.assets[0];
      const localUri = asset.uri;

      // 1. Instant 0ms local update for Header & AccountScreen
      setUserAvatarUrl(localUri);
      updateCurrentUserLocally({ avatar_url: localUri });
      showToast({ message: "Profil rasmi tanlandi, saqlanmoqda...", type: "info" });

      // 2. Background Asynchronous CDN Upload (Non-blocking)
      (async () => {
        try {
          const dbClient = supabase;
          const { data: sessionData } = await supabase.auth.getSession();
          const sessionEmail = sessionData?.session?.user?.email;

          const fileExt = localUri.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
          const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(fileExt) ? fileExt : 'jpg';
          const fileName = `user_avatar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${safeExt}`;

          const response = await fetch(localUri);
          const blob = await response.blob();
          const arrayBuffer = await new Response(blob).arrayBuffer();

          const { error: uploadErr } = await dbClient.storage
            .from('player-photos')
            .upload(`avatars/${fileName}`, arrayBuffer, {
              contentType: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
              upsert: true
            });

          if (uploadErr) {
            console.error('Storage avatar upload error:', uploadErr);
            showToast({ message: "Rasm yuklashda xatolik yuz berdi", type: "error" });
            return;
          }

          const { data: urlData } = dbClient.storage.from('player-photos').getPublicUrl(`avatars/${fileName}`);
          const publicUrl = urlData?.publicUrl || '';

          if (publicUrl) {
            setUserAvatarUrl(publicUrl);
            updateCurrentUserLocally({ avatar_url: publicUrl });

            if (sessionEmail) {
              await dbClient
                .from('organization_users')
                .update({ avatar_url: publicUrl })
                .ilike('email', sessionEmail);
            }
            refreshCurrentUser();
            showToast({ message: "Profil rasmingiz muvaffaqiyatli saqlandi! ✅", type: "success" });
          }
        } catch (bgErr: any) {
          console.warn('Background avatar upload warn:', bgErr);
        }
      })();
    } catch (err: any) {
      console.error('Error picking user avatar:', err);
    }
  };

  // Save Profile / Organization Info Handler
  const handleSaveAdminInfo = async () => {
    if (!editName.trim()) {
      Alert.alert('Xatolik', userRole === 'user' ? 'Iltimos, ismingizni kiriting!' : 'Iltimos, tashkilot nomini kiriting!');
      return;
    }

    triggerIosCrescendoHaptic();

    // 1. ORGANIZATOR (user role) - ONLY UPDATE organization_users TABLE
    if (userRole === 'user') {
      updateCurrentUserLocally({
        full_name: editName.trim(),
        email: editEmail.trim(),
      });

      setIsEditingInfo(false);
      setIsSavingInfo(false);

      (async () => {
        try {
          const dbClient = supabase;
          const targetOrgId = orgId || currentOrg?.id || 1;

          const userUpdatePayload: any = {
            full_name: editName.trim(),
            email: editEmail.trim(),
          };
          if (editPassword.trim()) {
            userUpdatePayload.password = editPassword.trim();
          }

          if (currentUser?.id) {
            await dbClient
              .from('organization_users')
              .update(userUpdatePayload)
              .eq('id', currentUser.id);
          } else {
            const { data: sessionData } = await supabase.auth.getSession();
            const sessionEmail = sessionData?.session?.user?.email;
            if (sessionEmail) {
              await dbClient
                .from('organization_users')
                .update(userUpdatePayload)
                .eq('organization_id', targetOrgId)
                .ilike('email', sessionEmail);
            }
          }

          refreshCurrentUser();
          showToast({ message: "Profil ma'lumotlaringiz muvaffaqiyatli saqlandi! ✅", type: "success" });
        } catch (err: any) {
          console.error('Save organizer profile error:', err);
          showToast({ message: "Saqlashda xatolik yuz berdi", type: "error" });
        }
      })();
      return;
    }

    // 2. BOSH ADMIN (org_admin / superadmin) - UPDATE organizations AND admin_users TABLES
    const fullPhone = editPhoneSuffix.trim() ? `+998 ${editPhoneSuffix.trim()}` : '';

    updateOrgLocally({
      name: editName.trim(),
      brand_colors: editBrandColors,
      admin_email: editEmail.trim(),
      contact_phone: fullPhone,
    });

    setIsEditingInfo(false);
    setIsSavingInfo(false);

    (async () => {
      try {
        const dbClient = supabase;
        const targetOrgId = orgId || currentOrg?.id || 1;

        const mainUpdatePayload: any = {
          name: editName.trim(),
          slug: editSlug.trim() || editName.trim().toLowerCase().replace(/\s+/g, '-'),
          brand_colors: editBrandColors,
        };
        if (editEmail.trim()) {
          mainUpdatePayload.admin_email = editEmail.trim();
        }
        if (fullPhone) {
          mainUpdatePayload.contact_phone = fullPhone;
        }

        const { error: primaryErr } = await dbClient
          .from('organizations')
          .update(mainUpdatePayload)
          .eq('id', targetOrgId);

        if (primaryErr) {
          console.warn('Primary org update warning, trying fallback:', primaryErr);
          await dbClient
            .from('organizations')
            .update({
              name: editName.trim(),
              slug: editSlug.trim() || editName.trim().toLowerCase().replace(/\s+/g, '-'),
              brand_colors: editBrandColors,
            })
            .eq('id', targetOrgId);
        }

        const { data: adminUser } = await dbClient
          .from('admin_users')
          .select('id')
          .eq('organization_id', targetOrgId)
          .eq('role', 'org_admin')
          .maybeSingle();

        if (adminUser) {
          const uPayload: any = {};
          if (editEmail.trim()) uPayload.email = editEmail.trim();
          if (editPassword.trim()) uPayload.password = editPassword.trim();
          if (fullPhone) uPayload.phone_number = fullPhone;
          if (Object.keys(uPayload).length > 0) {
            await dbClient.from('admin_users').update(uPayload).eq('id', adminUser.id);
          }
        }

        refreshOrg();
        showToast({ message: "Tashkilot ma'lumotlari muvaffaqiyatli saqlandi! ✅", type: "success" });
      } catch (err: any) {
        console.error('Background save error:', err);
      }
    })();
  };

  // Handle Logout
  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = () => {
    setShowLogoutModal(false);
    if (onLogout) onLogout();
  };

  // Switcher Handlers (Feedback via Top Toast in OrgContext)
  const handleRegistrationToggle = async (val: boolean) => {
    await toggleRegistrationStatus(val);
  };

  const handleTransferToggle = async (val: boolean) => {
    await toggleTransferWindow(val);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{"Admin Akkounti"}</Text>
        <Text style={styles.headerSub}>{"Tashkilot va Admin profil boshqaruvi"}</Text>
      </View>

      {/* Organization Profile Card */}
      <View style={styles.profileCard}>
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={styles.profileHeaderRow}>
          <TouchableOpacity
            style={styles.logoWrapper}
            activeOpacity={0.8}
            onPress={userRole === 'user' ? handlePickUserAvatar : handlePickLogo}
            disabled={isUploadingLogo}
          >
            {isUploadingLogo ? (
              <ActivityIndicator size="small" color="#00FF87" />
            ) : (
              <>
                <Image
                  source={{
                    uri:
                      userRole === 'user'
                        ? (currentUser?.avatar_url || userAvatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop')
                        : (currentOrg?.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=120&auto=format&fit=crop'),
                  }}
                  style={styles.orgLogo}
                />
                <View style={styles.logoEditBadge}>
                  <Ionicons name="camera" size={12} color="#000000" />
                </View>
              </>
            )}
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            {loading || (!currentOrg?.name && userRole !== 'user') ? (
              <View style={{ gap: 6, marginVertical: 4 }}>
                <TextSkeleton width={180} height={20} borderRadius={6} />
                <TextSkeleton width={100} height={14} borderRadius={4} />
              </View>
            ) : (
              <>
                <Text style={styles.orgName}>{userRole === 'user' ? (editName || 'Organizator') : currentOrg.name}</Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.roleBadge, userRole === 'user' && { backgroundColor: 'rgba(56, 189, 248, 0.25)', borderColor: 'rgba(56, 189, 248, 0.4)' }]}>
                    <Ionicons name={userRole === 'user' ? "person-circle" : "shield-checkmark"} size={12} color={userRole === 'user' ? "#38BDF8" : "#FFFFFF"} />
                    <Text style={[styles.roleBadgeText, userRole === 'user' && { color: '#38BDF8' }]}>
                      {userRole === 'user' ? "ORGANIZATOR" : "BOSH ADMIN"}
                    </Text>
                  </View>
                  {userRole !== 'user' && (
                    <Text style={styles.orgIdText}>{`Tashkilot: ${currentOrg?.name || 'Amatora'}`}</Text>
                  )}
                </View>
              </>
            )}
          </View>
        </View>

        {userRole !== 'user' && (
          <>
            <View style={styles.divider} />

            {/* Quick Toggles Section */}
            <Text style={styles.sectionTitle}>{"Tizim Kalit Sozlamalari"}</Text>

            {/* 1. Registration Switch */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleLabelGroup}>
                <View style={[styles.toggleIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                  <Ionicons name="person-add" size={18} color="#38BDF8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>{"Ro'yxatdan O'tish Holati"}</Text>
                  <Text
                    style={[
                      styles.toggleSub,
                      { color: isRegistrationOpen ? '#00FF87' : '#EF4444' },
                    ]}
                  >
                    {isRegistrationOpen ? "OCHIQ (Arizalar qabul qilinmoqda)" : "YOPILGAN (Qabul to'xtatilgan)"}
                  </Text>
                </View>
              </View>
              <Switch
                value={isRegistrationOpen}
                onValueChange={handleRegistrationToggle}
                trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: 'rgba(56, 189, 248, 0.4)' }}
                thumbColor={isRegistrationOpen ? '#38BDF8' : '#94A3B8'}
              />
            </View>

            {/* 2. Transfer Window Switch */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleLabelGroup}>
                <View style={[styles.toggleIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                  <Ionicons name="swap-horizontal" size={18} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>{"Transfer Oynasi Holati"}</Text>
                  <Text
                    style={[
                      styles.toggleSub,
                      { color: transferWindowOpen ? '#00FF87' : '#EF4444' },
                    ]}
                  >
                    {transferWindowOpen ? "OCHIQ (O'yinchilar ko'chishi mumkin)" : "YOPILGAN (O'yinchilar ko'chishi to'xtatilgan)"}
                  </Text>
                </View>
              </View>
              <Switch
                value={transferWindowOpen}
                onValueChange={handleTransferToggle}
                trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: 'rgba(245, 158, 11, 0.4)' }}
                thumbColor={transferWindowOpen ? '#F59E0B' : '#94A3B8'}
              />
            </View>

            {/* Registration Website Link Card */}
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                activeOpacity={0.8}
                onPress={() => {
                  const url = `https://amatora.uz/${currentOrg?.slug || 'hfl'}`;
                  Linking.openURL(url).catch(() => {
                    Alert.alert("Sayt havolasi", url);
                  });
                }}
              >
                <View style={[styles.toggleIconBox, { backgroundColor: 'rgba(0, 255, 135, 0.15)' }]}>
                  <Ionicons name="globe-outline" size={18} color="#00FF87" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>{"Ro'yxatdan o'tkazish sayti"}</Text>
                  <Text style={[styles.toggleSub, { color: '#00FF87', textDecorationLine: 'underline' }]} numberOfLines={1}>
                    {`https://amatora.uz/${currentOrg?.slug || 'hfl'}`}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: 'rgba(0, 255, 135, 0.15)',
                  borderWidth: 1,
                  borderColor: 'rgba(0, 255, 135, 0.3)',
                }}
                activeOpacity={0.7}
                onPress={() => {
                  const url = `https://amatora.uz/${currentOrg?.slug || 'hfl'}`;
                  Alert.alert(
                    "Nusxalandi!",
                    `Sayt havolasi:\n\n${url}\n\nUshbu havolani ishtirokchilar va jamoalarga yuboring.`
                  );
                }}
              >
                <Ionicons name="copy-outline" size={16} color="#00FF87" />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Account & Organization Details with 1-to-1 SuperAdmin Inline Editing */}
      <View style={styles.sectionCard}>
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={styles.sectionHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.sectionTitle}>
                  {userRole === 'user' ? "Mening Akkount Ma'lumotlarim" : "Tashkilot & Admin Ma'lumotlari"}
                </Text>
                <TouchableOpacity
                  style={styles.inlineEditIconBtn}
                  activeOpacity={0.8}
                  onPress={() => setIsEditingInfo(!isEditingInfo)}
                >
                  <Ionicons name={isEditingInfo ? "close-circle" : "create-outline"} size={18} color="#00FF87" />
                </TouchableOpacity>
              </View>
            </View>

        {isEditingInfo ? (
          <View style={styles.inlineFormContainer}>
            {/* 1. Name Input */}
            <View style={styles.inlineInputGroup}>
              <Text style={styles.inlineInputLabel}>{userRole === 'user' ? "ISMI VA FAMILIYASI *" : "TASHKILOT NOMI *"}</Text>
              <TextInput
                style={styles.textInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Ism Familiyani kiriting..."
                placeholderTextColor="#64748B"
              />
            </View>

            {/* 2. Slug Input (Admin Only) */}
            {userRole !== 'user' && (
              <View style={styles.inlineInputGroup}>
                <Text style={styles.inlineInputLabel}>{"IDENTIFIKATOR / SLUG *"}</Text>
                <TextInput
                  style={styles.textInput}
                  value={editSlug}
                  onChangeText={setEditSlug}
                  placeholder="tashkilot-slug"
                  placeholderTextColor="#64748B"
                  autoCapitalize="none"
                />
              </View>
            )}

            {/* 3. Email Input */}
            <View style={styles.inlineInputGroup}>
              <Text style={styles.inlineInputLabel}>{userRole === 'user' ? "LOGIN EMAIL *" : "ADMIN EMAIL MANZILI *"}</Text>
              <TextInput
                style={styles.textInput}
                value={editEmail}
                onChangeText={setEditEmail}
                placeholder="email@domain.com"
                placeholderTextColor="#64748B"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            {/* 4. Password Input with Eye Toggle */}
            <View style={styles.inlineInputGroup}>
              <Text style={styles.inlineInputLabel}>{userRole === 'user' ? "KIRISH PAROLI *" : "ADMIN PAROLI *"}</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={[styles.textInput, { flex: 1, borderWidth: 0 }]}
                  value={editPassword}
                  onChangeText={setEditPassword}
                  placeholder="Yangi parol..."
                  placeholderTextColor="#64748B"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons name={showPassword ? "eye-off" : "eye"} size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>
            </View>

            {/* 5. Contact Phone Input (Admin Only) */}
            {userRole !== 'user' && (
              <View style={styles.inlineInputGroup}>
                <Text style={styles.inlineInputLabel}>{"BOG'LANISH TELEFONI *"}</Text>
                <View style={styles.phoneInputWrapper}>
                  <View style={styles.phonePrefixBox}>
                    <Text style={styles.phonePrefixText}>{'+998'}</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    value={editPhoneSuffix}
                    onChangeText={(v) => {
                      const digits = v.replace(/[^0-9 ]/g, '');
                      setEditPhoneSuffix(digits);
                    }}
                    placeholder="90 123 45 67"
                    placeholderTextColor="#64748B"
                    keyboardType="number-pad"
                    maxLength={12}
                  />
                </View>
              </View>
            )}

            {/* 6. Brand Colors List (Admin Only) */}
            {userRole !== 'user' && (
              <View style={styles.inlineInputGroup}>
                <Text style={styles.inlineInputLabel}>{"TASHKILOT RANGLARI *"}</Text>
                <View style={styles.brandColorsList}>
                  {editBrandColors.map((colorHex, idx) => (
                    <View key={idx} style={styles.colorEditRow}>
                      <ColorPicker
                        value={colorHex}
                        onChange={(color: string) => handleUpdateBrandColor(idx, color)}
                        tabs={['picker', 'palettes']}
                      />
                      <TextInput
                        style={styles.colorHexInput}
                        value={colorHex}
                        onChangeText={(val) => handleUpdateBrandColor(idx, val)}
                        placeholder="#HEX"
                        placeholderTextColor="#64748B"
                        autoCapitalize="characters"
                        maxLength={7}
                      />
                      {editBrandColors.length > 1 && (
                        <TouchableOpacity
                          style={styles.removeColorBtn}
                          onPress={() => handleRemoveBrandColor(idx)}
                        >
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Save & Cancel Buttons */}
            <View style={styles.inlineActionRow}>
              <TouchableOpacity
                style={styles.inlineCancelBtn}
                activeOpacity={0.8}
                onPress={() => setIsEditingInfo(false)}
                disabled={isSavingInfo}
              >
                <Text style={styles.inlineCancelText}>{"Bekor qilish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.inlineSaveBtn, isSavingInfo && { opacity: 0.6 }]}
                activeOpacity={0.8}
                onPress={handleSaveAdminInfo}
                disabled={isSavingInfo}
              >
                {isSavingInfo ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <Text style={styles.inlineSaveText}>{"Saqlash"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {userRole === 'user' ? (
              <>
                <View style={styles.infoRow}>
                  <Ionicons name="person-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.infoLabel}>{"Ismi va Familiyasi:"}</Text>
                  <Text style={styles.infoValue}>{editName || 'Organizator'}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Ionicons name="mail-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.infoLabel}>{"Login Email:"}</Text>
                  <Text style={styles.infoValue}>{editEmail || '—'}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Ionicons name="key-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.infoLabel}>{"Parol:"}</Text>
                  <Text style={styles.infoValue}>{"••••••••"}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.infoRow}>
                  <Ionicons name="business-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.infoLabel}>{"Tashkilot:"}</Text>
                  {loading || (!currentOrg?.name && !editName) ? (
                    <TextSkeleton width={140} height={14} borderRadius={4} />
                  ) : (
                    <Text style={styles.infoValue}>{currentOrg?.name || editName}</Text>
                  )}
                </View>

                <View style={styles.infoRow}>
                  <Ionicons name="link-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.infoLabel}>{"Identifikator:"}</Text>
                  {loading || (!currentOrg?.slug && !editSlug) ? (
                    <TextSkeleton width={80} height={14} borderRadius={4} />
                  ) : (
                    <Text style={styles.infoValue}>{currentOrg?.slug || editSlug}</Text>
                  )}
                </View>

                <View style={styles.infoRow}>
                  <Ionicons name="mail-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.infoLabel}>{"Email:"}</Text>
                  <Text style={styles.infoValue}>
                    {editEmail || currentOrg?.admin_email || currentOrg?.email || '—'}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Ionicons name="call-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.infoLabel}>{"Telefon:"}</Text>
                  <Text style={styles.infoValue}>
                    {(() => {
                      const ph = currentOrg?.contact_phone || currentOrg?.phone || '';
                      if (ph) return ph;
                      if (editPhoneSuffix) return `+998 ${editPhoneSuffix}`;
                      return '—';
                    })()}
                  </Text>
                </View>
              </>
            )}
          </>
        )}
      </View>

      <View style={{ height: 20 }} />

      {/* Navigation Quick Links */}
      <View style={styles.sectionCard}>
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <Text style={styles.sectionTitle}>{"Boshqaruv Menyu"}</Text>

        <TouchableOpacity
          style={styles.menuLinkRow}
          activeOpacity={0.8}
          onPress={() => {
            if (onNavigateToSettings) {
              onNavigateToSettings();
            }
          }}
        >
          <View style={styles.menuIconBox}>
            <Ionicons name="settings-sharp" size={18} color="#FFFFFF" />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.menuLinkText}>{"Tizim Sozlamalari va Konfiguratsiya"}</Text>
            <Text style={styles.menuLinkSub}>{"Mobil ilova, biometriya va xavfsizlik sozlamalari"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>

        {userRole !== 'user' && (
          <TouchableOpacity
            style={styles.menuLinkRow}
            activeOpacity={0.8}
            onPress={() => {
              if (onNavigateToOrganizers) {
                onNavigateToOrganizers();
              }
            }}
          >
            <View style={[styles.menuIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Ionicons name="people-sharp" size={18} color="#38BDF8" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.menuLinkText}>{"Organizatorlar (Userlar)"}</Text>
              <Text style={styles.menuLinkSub}>{"Tashkilot xodimlariga kirish huquqlarini berish va boshqarish"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.logoutBtn}
          activeOpacity={0.8}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={18} color="#FFFFFF" />
          <Text style={styles.logoutBtnText}>{"Tizimdan Chiqish"}</Text>
        </TouchableOpacity>
      </View>

      {/* Sleek single-row Organization Info Badge at the VERY BOTTOM for Regular User */}
      {userRole === 'user' && currentOrg && (
        <View style={styles.userOrgBottomCard}>
          <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <Image
            source={{ uri: currentOrg.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop' }}
            style={styles.userOrgBottomLogo}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.userOrgBottomLabel}>{"Biriktirilgan Tashkilot"}</Text>
            <Text style={styles.userOrgBottomName}>{currentOrg.name || 'Amatora'}</Text>
          </View>
          <View style={styles.userOrgStatusPill}>
            <View style={styles.greenDot} />
            <Text style={styles.userOrgStatusText}>{"FAOL"}</Text>
          </View>
        </View>
      )}

      {/* Organizers (User Roles) Management Modal */}
      <Modal
        visible={showOrganizersModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowOrganizersModal(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={95} tint="dark" style={StyleSheet.absoluteFill} />

          <View style={[styles.glassModalCard, { maxWidth: 380, maxHeight: '85%', padding: 20 }]}>
            <BlurView intensity={85} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.glassModalTitle, { marginBottom: 2, textAlign: 'left' }]}>{"Organizatorlar Bilan Ishlash"}</Text>
                <Text style={{ color: '#94A3B8', fontSize: 12 }}>{`Tashkilot ID: #${currentOrg?.id || orgId}`}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowOrganizersModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={26} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            {!showAddOrganizerForm ? (
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  backgroundColor: 'rgba(56, 189, 248, 0.2)',
                  borderColor: '#38BDF8',
                  borderWidth: 1,
                  borderRadius: 14,
                  paddingVertical: 12,
                  width: '100%',
                  marginBottom: 16,
                }}
                activeOpacity={0.8}
                onPress={() => setShowAddOrganizerForm(true)}
              >
                <Ionicons name="person-add" size={18} color="#38BDF8" />
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>{"Yangi User (Organizator) Qo'shish"}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: '100%', backgroundColor: 'rgba(0,0,0,0.3)', padding: 14, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ color: '#38BDF8', fontWeight: '700', fontSize: 14, marginBottom: 10 }}>{"Yangi Organizator Kiritish"}</Text>
                
                <TextInput
                  style={styles.inlineInput}
                  placeholder="F.I.SH (Ism Familiya)"
                  placeholderTextColor="#64748B"
                  value={newOrgName}
                  onChangeText={setNewOrgName}
                />
                
                <TextInput
                  style={[styles.inlineInput, { marginTop: 8 }]}
                  placeholder="Login Email"
                  placeholderTextColor="#64748B"
                  value={newOrgEmail}
                  onChangeText={setNewOrgEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <TextInput
                  style={[styles.inlineInput, { marginTop: 8 }]}
                  placeholder="Parol"
                  placeholderTextColor="#64748B"
                  value={newOrgPassword}
                  onChangeText={setNewOrgPassword}
                  secureTextEntry
                />

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <TouchableOpacity
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center' }}
                    onPress={() => setShowAddOrganizerForm(false)}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 13 }}>{"Bekor qilish"}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#38BDF8', alignItems: 'center' }}
                    onPress={handleCreateOrganizer}
                    disabled={isCreatingOrgUser}
                  >
                    {isCreatingOrgUser ? (
                      <ActivityIndicator size="small" color="#000000" />
                    ) : (
                      <Text style={{ color: '#000000', fontWeight: '700', fontSize: 13 }}>{"Saqlash"}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
              {loadingOrganizers ? (
                <ActivityIndicator size="small" color="#38BDF8" style={{ marginVertical: 20 }} />
              ) : organizersList.length === 0 ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Ionicons name="people-outline" size={40} color="rgba(255,255,255,0.2)" />
                  <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 8 }}>{"Hozircha organizatorlar yo'q"}</Text>
                </View>
              ) : (
                organizersList.map((item) => (
                  <View
                    key={item.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      borderRadius: 14,
                      padding: 12,
                      marginBottom: 8,
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.1)',
                    }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(56, 189, 248, 0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                      <Ionicons name="person" size={18} color="#38BDF8" />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>{item.full_name || 'Organizator'}</Text>
                      <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 2 }}>{item.email}</Text>
                      <Text style={{ color: '#64748B', fontSize: 11, marginTop: 1 }}>{`Parol: ${item.password}`}</Text>
                    </View>

                    <TouchableOpacity onPress={() => handleDeleteOrganizer(item.id)} style={{ padding: 6 }}>
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Glassmorphism Logout Confirmation Modal */}
      <Modal
        visible={showLogoutModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
          
          <View style={styles.glassModalCard}>
            <BlurView intensity={85} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
            
            <Text style={styles.glassModalTitle}>{"Akkountdan chiqmoqchimisiz?"}</Text>

            <View style={styles.glassModalActions}>
              <TouchableOpacity
                style={styles.glassModalBtnStay}
                activeOpacity={0.7}
                onPress={() => setShowLogoutModal(false)}
              >
                <Text style={styles.glassModalTextStay}>{"Qolish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.glassModalBtnLogout}
                activeOpacity={0.7}
                onPress={confirmLogout}
              >
                <Text style={styles.glassModalTextLogout}>{"Chiqish"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  glassModalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    overflow: 'hidden',
  },
  glassModalTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 22,
    letterSpacing: 0.2,
  },
  glassModalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  glassModalBtnStay: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  glassModalTextStay: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  glassModalBtnLogout: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  glassModalTextLogout: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '700',
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  scrollContent: {
    paddingBottom: 140,
    gap: 16,
  },
  header: {
    marginBottom: 4,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  profileCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    gap: 16,
    overflow: 'hidden',
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoWrapper: {
    position: 'relative',
    width: 62,
    height: 62,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orgLogo: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  logoEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  roleBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  orgIdText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  inlineEditIconBtn: {
    padding: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  toggleLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 10,
  },
  toggleIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  toggleSub: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    gap: 14,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  infoLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  infoValue: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
    textAlign: 'right',
  },
  inlineFormContainer: {
    gap: 12,
    marginTop: 4,
  },
  inlineInputGroup: {
    gap: 4,
  },
  brandColorsList: {
    gap: 8,
    marginTop: 4,
  },
  colorEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorSquare: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  colorHexInput: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#FFF',
    fontSize: 13,
    height: 36,
  },
  removeColorBtn: {
    width: 36,
    height: 36,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addColorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 255, 135, 0.1)',
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  addColorBtnText: {
    color: '#00FF87',
    fontSize: 12,
    fontWeight: '700',
  },
  gradientPreview: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginTop: 4,
  },
  inlineInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalSaveBtn: {
    backgroundColor: '#00FF87',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  modalSaveBtnText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: 'bold',
  },
  inlineInputLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#CBD5E1',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 13.5,
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingRight: 10,
  },
  eyeBtn: {
    padding: 6,
  },
  phoneInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  phonePrefixBox: {
    backgroundColor: 'rgba(0, 255, 135, 0.12)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  phonePrefixText: {
    color: '#00FF87',
    fontWeight: '900',
    fontSize: 13.5,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 13.5,
  },
  inlineActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  inlineCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  inlineCancelText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  inlineSaveBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#00FF87',
    alignItems: 'center',
  },
  inlineSaveText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 12,
  },
  menuLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  menuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 255, 135, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLinkText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  menuLinkSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    marginTop: 4,
  },
  logoutBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // User Role Bottom Organization Badge Styles
  userOrgBottomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 12,
    overflow: 'hidden',
  },
  userOrgBottomLogo: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  userOrgBottomLabel: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  userOrgBottomName: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '900',
  },
  userOrgStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  userOrgStatusText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
