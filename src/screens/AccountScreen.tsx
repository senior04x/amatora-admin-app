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
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { ColorPicker } from '@darthrapid/react-native-color-picker';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useOrg } from '../context/OrgContext';
import { supabase, supabaseAdmin } from '../supabaseClient';

export const AccountScreen: React.FC<{ onNavigateToSettings?: () => void; onLogout?: () => void }> = ({
  onNavigateToSettings,
  onLogout,
}) => {
  const {
    orgId,
    currentOrg,
    transferWindowOpen,
    isRegistrationOpen,
    toggleTransferWindow,
    toggleRegistrationStatus,
    refreshOrg,
    updateOrgLocally,
  } = useOrg();

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

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

  useEffect(() => {
    if (currentOrg) {
      setEditName(currentOrg.name || '');
      setEditSlug(currentOrg.slug || '');
      // Email priority: admin_users (merged) > organizations.admin_email > organizations.email
      setEditEmail(currentOrg.admin_email || currentOrg.email || '');
      setEditPassword(currentOrg.admin_password || currentOrg.password || '');
      const phoneVal = currentOrg.contact_phone || currentOrg.phone || '';
      setEditPhoneSuffix(rawPhone(phoneVal));
      setEditBrandColors(Array.isArray(currentOrg.brand_colors) ? currentOrg.brand_colors : ['#00FF87']);
    }
  }, [currentOrg]);

  // Handle Organization Logo Upload
  const handlePickLogo = async () => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      setIsUploadingLogo(true);
      const asset = pickerResult.assets[0];
      const dbClient = supabaseAdmin || supabase;
      const fileExt = asset.uri.split('.').pop()?.toLowerCase() || 'png';
      const fileName = `org_logo_${orgId || 1}_${Date.now()}.${fileExt}`;

      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();

      const { error: uploadErr } = await dbClient.storage
        .from('player-photos')
        .upload(`logos/${fileName}`, arrayBuffer, { contentType: `image/${fileExt}`, upsert: true });

      if (uploadErr) {
        throw new Error(uploadErr.message);
      }

      const { data: urlData } = dbClient.storage.from('player-photos').getPublicUrl(`logos/${fileName}`);
      const publicUrl = urlData?.publicUrl || '';

      if (publicUrl) {
        await dbClient.from('organizations').update({ logo_url: publicUrl }).eq('id', orgId || 1);
        await refreshOrg();
        Alert.alert('Muvaffaqiyatli', 'Tashkilot logotipi yangilandi!');
      }
    } catch (err: any) {
      console.error('Error uploading logo:', err);
      Alert.alert('Xatolik', err.message || 'Logotipni yuklashda xatolik yuz berdi');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  // 1-to-1 SuperAdmin Organization Save Handler
  const handleSaveAdminInfo = async () => {
    if (!editName.trim()) {
      Alert.alert('Xatolik', 'Iltimos, tashkilot nomini kiriting!');
      return;
    }

    const fullPhone = editPhoneSuffix.trim() ? `+998 ${editPhoneSuffix.trim()}` : '';

    // 1. INSTANTLY update RAM state so gradient background changes immediately on device!
    updateOrgLocally({
      name: editName.trim(),
      brand_colors: editBrandColors,
      admin_email: editEmail.trim(),
      contact_phone: fullPhone,
    });

    // 2. INSTANTLY close edit mode — no waiting
    setIsEditingInfo(false);
    setIsSavingInfo(false);

    // 3. Save to database IN THE BACKGROUND (non-blocking)
    const saveToDB = async () => {
      try {
        const dbClient = supabaseAdmin || supabase;
        const targetOrgId = orgId || currentOrg?.id || 1;

        const fullPhone = editPhoneSuffix.trim() ? `+998 ${editPhoneSuffix.trim()}` : '';
        const mainUpdatePayload: any = {
          name: editName.trim(),
          slug: editSlug.trim() || editName.trim().toLowerCase().replace(/\\s+/g, '-'),
          brand_colors: editBrandColors,
        };
        if (editEmail.trim()) {
          mainUpdatePayload.admin_email = editEmail.trim();
        }
        if (fullPhone) {
          mainUpdatePayload.contact_phone = fullPhone;
        }

        // Update organizations table
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
              slug: editSlug.trim() || editName.trim().toLowerCase().replace(/\\s+/g, '-'),
              brand_colors: editBrandColors,
            })
            .eq('id', targetOrgId);
        }

        // Sync admin_users
        try {
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
          } else {
            await dbClient.from('admin_users').insert([{
              organization_id: targetOrgId,
              email: editEmail.trim() || 'admin@amatora.uz',
              password: editPassword.trim() || '123456',
              phone_number: fullPhone || '',
              role: 'org_admin',
            }]);
          }
        } catch (adminErr) {
          console.warn('admin_users sync note:', adminErr);
        }

        // Refresh org context silently in background
        refreshOrg();
      } catch (err: any) {
        console.error('Background save error:', err);
      }
    };

    // Fire and forget — don't await
    saveToDB();
  };

  // Handle Logout
  const handleLogout = () => {
    Alert.alert('Tizimdan chiqish', 'Chindan ham admin akkountidan chiqmoqchimisiz?', [
      { text: 'Bekor qilish', style: 'cancel' },
      {
        text: 'Chiqish',
        style: 'destructive',
        onPress: () => {
          if (onLogout) onLogout();
        },
      },
    ]);
  };

  // Switcher Handlers with Alert Feedback
  const handleRegistrationToggle = async (val: boolean) => {
    await toggleRegistrationStatus(val);
    Alert.alert(
      'Ro\'yxatdan O\'tish Holati',
      val
        ? "Ro'yxatdan o'tish OCHILDI! Endi yangi arizalar qabul qilinadi."
        : "Ro'yxatdan o'tish YOPILDI!"
    );
  };

  const handleTransferToggle = async (val: boolean) => {
    await toggleTransferWindow(val);
    Alert.alert(
      'Transfer Oynasi Statusi',
      val
        ? "Transfer oynasi OCHILDI! O'yinchilar tahririga ruxsat berildi."
        : "Transfer oynasi YOPILDI!"
    );
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
            onPress={handlePickLogo}
            disabled={isUploadingLogo}
          >
            {isUploadingLogo ? (
              <ActivityIndicator size="small" color="#00FF87" />
            ) : (
              <>
                <Image
                  source={{
                    uri:
                      currentOrg?.logo_url ||
                      'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=120&auto=format&fit=crop',
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
            <Text style={styles.orgName}>{currentOrg?.name || 'Havas Futbol Ligasi'}</Text>
            <View style={styles.badgeRow}>
              <View style={styles.roleBadge}>
                <Ionicons name="shield-checkmark" size={12} color="#FFFFFF" />
                <Text style={styles.roleBadgeText}>{"BOSH ADMIN"}</Text>
              </View>
              <Text style={styles.orgIdText}>{`ID: #${currentOrg?.id || 1}`}</Text>
            </View>
          </View>
        </View>

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
              <Text style={styles.toggleTitle}>{"Transfer Oynasi Statusi"}</Text>
              <Text
                style={[
                  styles.toggleSub,
                  { color: transferWindowOpen ? '#F59E0B' : '#EF4444' },
                ]}
              >
                {transferWindowOpen ? "OCHIQ (O'yinchi tahrirlashga ruxsat)" : "YOPILGAN (Arizalar qulflangan)"}
              </Text>
            </View>
          </View>
          <Switch
            value={transferWindowOpen}
            onValueChange={handleTransferToggle}
            trackColor={{ false: '#334155', true: 'rgba(245, 158, 11, 0.4)' }}
            thumbColor={transferWindowOpen ? '#F59E0B' : '#94A3B8'}
          />
        </View>

        {/* 3. Ro'yxatdan o'tkazish sayti (Registration Website Link) */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleLabelGroup}>
            <View style={[styles.toggleIconBox, { backgroundColor: 'rgba(0, 255, 135, 0.15)' }]}>
              <Ionicons name="globe-outline" size={18} color="#00FF87" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>{"Ro'yxatdan o'tkazish sayti"}</Text>
              <Text style={[styles.toggleSub, { color: '#00FF87' }]}>
                {`https://amatora.vercel.app/${currentOrg?.slug || 'tashkilot-slug'}`}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: 'rgba(0, 255, 135, 0.15)',
              borderWidth: 1,
              borderColor: 'rgba(0, 255, 135, 0.3)',
            }}
            onPress={() => {
              const url = `https://amatora.vercel.app/${currentOrg?.slug || 'tashkilot-slug'}`;
              Alert.alert(
                "Ro'yxatdan o'tkazish sayti",
                `Tashkilotingizning rasmiy ro'yxatdan o'tish veb-sayti:\n\n${url}\n\nUshbu havolani ishtirokchilar va jamoalarga yuboring.`
              );
            }}
          >
            <Ionicons name="copy-outline" size={16} color="#00FF87" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Account & Organization Details with 1-to-1 SuperAdmin Inline Editing */}
      {(() => {
        const orgColors = Array.isArray(currentOrg?.brand_colors) ? currentOrg.brand_colors : [];
        const isGradient = false;
        const CardWrapper = View;
        const wrapperProps = { style: styles.sectionCard };

        return (
          <CardWrapper {...(wrapperProps as any)}>
            <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.sectionTitle}>{"Tashkilot & Admin Ma'lumotlari"}</Text>
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
            {/* 1. Org Name Input */}
            <View style={styles.inlineInputGroup}>
              <Text style={styles.inlineInputLabel}>{"TASHKILOT NOMI *"}</Text>
              <TextInput
                style={styles.textInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Tashkilot nomini kiriting..."
                placeholderTextColor="#64748B"
              />
            </View>

            {/* 2. Org Slug Input */}
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

            {/* 3. Admin Email Input */}
            <View style={styles.inlineInputGroup}>
              <Text style={styles.inlineInputLabel}>{"ADMIN EMAIL MANZILI *"}</Text>
              <TextInput
                style={styles.textInput}
                value={editEmail}
                onChangeText={setEditEmail}
                placeholder="admin@amatora.uz"
                placeholderTextColor="#64748B"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            {/* 4. Admin Password Input with Eye Toggle */}
            <View style={styles.inlineInputGroup}>
              <Text style={styles.inlineInputLabel}>{"ADMIN PAROLI *"}</Text>
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

            {/* 5. Contact Phone Input with locked +998 prefix */}
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

            {/* 6. Brand Colors List (Gradient Builder) */}
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

              <TouchableOpacity style={styles.addColorBtn} onPress={handleAddBrandColor}>
                <Ionicons name="add" size={16} color="#00FF87" />
                <Text style={styles.addColorBtnText}>Rang qo'shish</Text>
              </TouchableOpacity>

              {/* Gradient Preview */}
              <Text style={[styles.inlineInputLabel, { marginTop: 12 }]}>{"GRADIENT KO'RINISHI (PREVIEW)"}</Text>
              <LinearGradient
                colors={(editBrandColors.length > 1 ? editBrandColors : [editBrandColors[0] || '#000', editBrandColors[0] || '#000']) as any}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientPreview}
              />
            </View>

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
            <View style={styles.infoRow}>
              <Ionicons name="business-outline" size={16} color="rgba(255,255,255,0.5)" />
              <Text style={styles.infoLabel}>{"Tashkilot:"}</Text>
              <Text style={styles.infoValue}>{currentOrg?.name || editName || 'Havas Futbol Ligasi'}</Text>
            </View>

            <View style={styles.infoRow}>
              <Ionicons name="link-outline" size={16} color="rgba(255,255,255,0.5)" />
              <Text style={styles.infoLabel}>{"Identifikator:"}</Text>
              <Text style={styles.infoValue}>{currentOrg?.slug || editSlug || 'hfl'}</Text>
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
          </CardWrapper>
        );
      })()}

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

        <TouchableOpacity
          style={styles.logoutBtn}
          activeOpacity={0.8}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={18} color="#FFFFFF" />
          <Text style={styles.logoutBtnText}>{"Tizimdan Chiqish"}</Text>
        </TouchableOpacity>
      </View>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
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
});
