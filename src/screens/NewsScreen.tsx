import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
  Dimensions,
  Platform,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from '../components/SafeBlurView';
import * as ImagePicker from 'expo-image-picker';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../supabaseClient';
import { adminNotificationService } from '../utils/adminNotificationService';
import { useScrollDockHandler } from '../utils/scrollDock';

const { width } = Dimensions.get('window');

// Base64 to ArrayBuffer helper for 100% reliable Supabase storage uploads
const decodeBase64 = (base64String: string): Uint8Array => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64String.replace(/[\t\n\r]/g, '');
  while (str.length % 4 !== 0) {
    str += '=';
  }

  const len = str.length;
  let validLen = len;
  if (str.endsWith('==')) validLen -= 2;
  else if (str.endsWith('=')) validLen -= 1;

  const arrayLen = Math.floor((validLen * 3) / 4);
  const bytes = new Uint8Array(arrayLen);

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = chars.indexOf(str.charAt(i));
    const encoded2 = chars.indexOf(str.charAt(i + 1));
    const encoded3 = chars.indexOf(str.charAt(i + 2));
    const encoded4 = chars.indexOf(str.charAt(i + 3));

    const manifest1 = (encoded1 << 2) | (encoded2 >> 4);
    bytes[p++] = manifest1;

    if (encoded3 !== 64 && p < arrayLen) {
      const manifest2 = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      bytes[p++] = manifest2;
    }
    if (encoded4 !== 64 && p < arrayLen) {
      const manifest3 = ((encoded3 & 3) << 6) | encoded4;
      bytes[p++] = manifest3;
    }
  }

  return bytes;
};

const getRelativeTime = (dateString?: string | number | Date): string => {
  if (!dateString) return 'Hozir';
  const now = Date.now();
  const past = new Date(dateString).getTime();
  if (isNaN(past)) return 'Hozir';

  const diffInSeconds = Math.floor((now - past) / 1000);

  if (diffInSeconds < 10) {
    return 'Hozir';
  }
  if (diffInSeconds < 60) {
    return `${diffInSeconds} soniya oldin`;
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} daqiqa oldin`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} soat oldin`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays} kun oldin`;
  }

  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInDays < 30) {
    return `${diffInWeeks} hafta oldin`;
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInDays < 365) {
    return `${diffInMonths} oy oldin`;
  }

  const diffInYears = Math.floor(diffInDays / 365);
  return `${diffInYears} yil oldin`;
};

export const NewsScreen: React.FC = () => {
  const { orgId, currentOrg } = useOrg();
  const { isDark, colors } = useTheme();
  const scrollDockProps = useScrollDockHandler();
  const [newsList, setNewsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('Barchasi');

  // Add & Edit News Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNews, setEditingNews] = useState<any | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>("O'yinlar");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Full View Detail Modal State
  const [selectedNewsForView, setSelectedNewsForView] = useState<any | null>(null);

  // Delete Confirmation Modal State
  const [newsToDelete, setNewsToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const categories = ['Turnirlar', 'Jamoalar', 'Transferlar', "O'yinlar"];

  useEffect(() => {
    fetchNews();
  }, [orgId]);

  const fetchNews = async () => {
    try {
      setLoading(true);
      const dbClient = supabase;
      let query = dbClient
        .from('news')
        .select('*')
        .order('created_at', { ascending: false });

      if (orgId) {
        query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
      }

      const { data, error } = await query;

      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') {
          console.warn('News table not found in Supabase Dashboard.');
          setNewsList([]);
        } else {
          console.warn('News fetch error:', error);
          const { data: fallbackData } = await dbClient
            .from('news')
            .select('*')
            .order('created_at', { ascending: false });
          setNewsList(fallbackData || []);
        }
      } else {
        setNewsList(data || []);
      }
    } catch (err) {
      console.error('Error fetching news:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchNews();
  };

  // Reset Form State
  const resetForm = () => {
    setEditingNews(null);
    setTitle('');
    setCategory("O'yinlar");
    setImageUri(null);
    setImageBase64(null);
    setContent('');
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (item: any) => {
    setEditingNews(item);
    setTitle(item.title || '');
    setCategory(item.category || "O'yinlar");
    setImageUri(item.image_url || null);
    setImageBase64(null);
    setContent(item.content || '');
    if (selectedNewsForView) {
      setSelectedNewsForView(null);
    }
    setIsModalOpen(true);
  };

  // Instant Gallery Image Pick
  const handlePickImage = async () => {
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

      const selectedAsset = pickerResult.assets[0];
      setImageUri(selectedAsset.uri);
      setImageBase64(selectedAsset.base64 || null);
    } catch (err) {
      console.error('Error picking news image:', err);
      Alert.alert('Xatolik', 'Rasm tanlashda xatolik yuz berdi');
    }
  };

  const removeImage = () => {
    setImageUri(null);
    setImageBase64(null);
  };

  // Upload image to Supabase Storage
  const uploadNewsImage = async (): Promise<string> => {
    if (!imageUri) return '';
    if (imageUri.startsWith('https://') && imageUri.includes('supabase.co/storage')) {
      return imageUri; // Already public Supabase URL
    }

    const dbClient = supabase;
    const fileExt = imageUri.includes('data:image/')
      ? (imageUri.split(';')[0].split('/')[1] || 'png')
      : (imageUri.split('?')[0].split('.').pop()?.toLowerCase() || 'png');
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `news/${fileName}`;

    let arrayBuffer: Uint8Array | ArrayBuffer | null = null;

    if (imageBase64) {
      arrayBuffer = decodeBase64(imageBase64);
    } else {
      const response = await fetch(imageUri);
      const blob = await response.blob();
      arrayBuffer = await new Response(blob).arrayBuffer();
    }

    if (!arrayBuffer) throw new Error('Rasm ma’lumotlari olinmadi');

    let activeBucket = 'news-images';
    let uploadRes = await dbClient.storage
      .from('news-images')
      .upload(filePath, arrayBuffer, { contentType: `image/${fileExt}`, upsert: true });

    if (uploadRes.error) {
      console.warn('news-images bucket failed, fallback to player-photos...', uploadRes.error);
      activeBucket = 'player-photos';
      uploadRes = await dbClient.storage
        .from('player-photos')
        .upload(filePath, arrayBuffer, { contentType: `image/${fileExt}`, upsert: true });
    }

    if (uploadRes.error) {
      throw new Error('Rasm yuklashda xatolik: ' + uploadRes.error.message);
    }

    const { data: urlData } = dbClient.storage.from(activeBucket).getPublicUrl(filePath);
    return urlData?.publicUrl || '';
  };

  // Create or Update News Submit Handler
  const handleSaveNews = async () => {
    if (!title.trim()) {
      Alert.alert('Xatolik', 'Iltimos, yangilik sarlavhasini kiriting!');
      return;
    }

    setSubmitting(true);
    try {
      const dbClient = supabase;
      let finalImageUrl = imageUri || '';

      // Upload if it's not already a public Supabase Storage URL
      if (imageUri && (!imageUri.startsWith('http') || imageUri.startsWith('blob:') || imageUri.startsWith('data:'))) {
        finalImageUrl = await uploadNewsImage();
      }

      const payload: any = {
        title: title.trim(),
        category: category,
        image_url: finalImageUrl,
        content: content.trim(),
      };

      if (editingNews) {
        // UPDATE EXSITING NEWS
        const { error } = await dbClient.from('news').update(payload).eq('id', editingNews.id);
        if (error) throw error;

        Alert.alert('Muvaffaqiyatli', 'Yangilik tahrirlandi va saqlandi!');
      } else {
        // INSERT NEW NEWS
        payload.organization_id = orgId || null;
        payload.views = 0;

        const { data: createdNews, error } = await dbClient.from('news').insert([payload]).select().single();
        if (error) throw error;

        // Trigger push notification to all organization members
        adminNotificationService.notifyNewsPublished({
          title: title.trim(),
          summary: content.trim().slice(0, 120),
          newsId: createdNews?.id,
          organizationId: orgId || 1,
        });

        Alert.alert('Muvaffaqiyatli', 'Yangilik muvaffaqiyatli chop etildi!');
      }

      setIsModalOpen(false);
      resetForm();
      fetchNews();
    } catch (err: any) {
      console.error('Error saving news:', err);
      Alert.alert('Xatolik', err.message || 'Yangilikni saqlashda xatolik yuz berdi');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete News Handler
  const executeDeleteNews = async () => {
    if (!newsToDelete) return;
    setIsDeleting(true);
    try {
      const dbClient = supabase;
      const imageUrl = newsToDelete.image_url;

      if (imageUrl && imageUrl.includes('news-images')) {
        const path = imageUrl.split('/news-images/')[1];
        if (path) {
          try {
            await dbClient.storage.from('news-images').remove([path]);
          } catch (e) {
            console.warn('Storage file remove warning:', e);
          }
        }
      }

      const { error } = await dbClient.from('news').delete().eq('id', newsToDelete.id);
      if (error) throw error;

      setNewsList((prev) => prev.filter((n) => n.id !== newsToDelete.id));
      if (selectedNewsForView?.id === newsToDelete.id) {
        setSelectedNewsForView(null);
      }
      setNewsToDelete(null);
      Alert.alert('Muvaffaqiyatli', "Yangilik o'chirildi!");
    } catch (err: any) {
      console.error('Error deleting news:', err);
      Alert.alert('Xatolik', "O'chirishda xatolik yuz berdi: " + (err.message || ''));
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredList = filterCategory === 'Barchasi'
    ? newsList
    : newsList.filter((n) => (n.category || '').toLowerCase().includes(filterCategory.toLowerCase()));

  return (
    <ScrollView
      style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === 'android' ? 120 : 100 }}
      showsVerticalScrollIndicator={false}
      {...scrollDockProps}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentGreen} />}
    >
      {/* HEADER SECTION */}
      <View style={styles.headerRow}>
        <View style={[styles.headerIconBox, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(74, 222, 128, 0.15)' : '#DCFCE7', borderColor: colors.border }]}>
          <Ionicons name="newspaper" size={24} color={colors.accentGreen} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>{"Yangiliklar Boshqaruvi"}</Text>
          <Text style={[styles.screenSub, { color: colors.textMuted }]}>
            {`Ilova uchun rasmiy yangiliklarni yaratish, tahrirlash va ko'rish (${currentOrg?.name || 'Amatora'})`}
          </Text>
        </View>
      </View>

      {/* CREATE NEWS BUTTON */}
      <TouchableOpacity
        style={[styles.createNewsBtn, { backgroundColor: colors.accentGreen }]}
        activeOpacity={0.8}
        onPress={handleOpenCreate}
      >
        <Ionicons name="add-circle" size={22} color="#000000" />
        <Text style={styles.createNewsBtnText}>{"YANGILIK QO'SHISH"}</Text>
      </TouchableOpacity>

      {/* CATEGORY FILTER TABS */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryScroll}
      >
        {['Barchasi', ...categories].map((cat) => {
          const isActive = filterCategory === cat;
          return (
            <TouchableOpacity
              key={cat}
              style={[
                styles.categoryTab,
                Platform.OS === 'android' && {
                  backgroundColor: colors.bgCard,
                  borderColor: colors.border,
                },
                isActive && {
                  backgroundColor: isDark ? 'rgba(74, 222, 128, 0.22)' : '#DCFCE7',
                  borderColor: colors.accentGreen,
                },
              ]}
              activeOpacity={0.8}
              onPress={() => setFilterCategory(cat)}
            >
              <Text
                style={[
                  styles.categoryTabText,
                  { color: colors.textMuted },
                  isActive && { color: colors.accentGreen, fontWeight: '900' },
                ]}
              >
                {cat.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* NEWS GRID LIST */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.accentGreen} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>{"Yangiliklar yuklanmoqda..."}</Text>
        </View>
      ) : filteredList.length === 0 ? (
        <View style={[styles.emptyBox, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Ionicons name="newspaper-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{"Hozircha yangiliklar yo'q"}</Text>
          <Text style={[styles.emptySub, { color: colors.textMuted }]}>{"Tugmani bosib birinchi yangilikni e'lon qiling"}</Text>
        </View>
      ) : (
        <View style={styles.gridContainer}>
          {filteredList.map((item) => {
            const formattedDate = getRelativeTime(item.created_at);
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.newsCard,
                  Platform.OS === 'android' && {
                    backgroundColor: colors.bgCard,
                    borderColor: colors.border,
                  },
                ]}
                activeOpacity={0.85}
                onPress={() => setSelectedNewsForView(item)}
              >
                {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
                {/* News Image */}
                {item.image_url ? (
                  <ExpoImage source={{ uri: item.image_url }} cachePolicy="memory-disk" style={styles.newsCardImg} contentFit="cover" />
                ) : (
                  <View style={[styles.newsCardImgPlaceholder, { backgroundColor: colors.bgCardElevated }]}>
                    <Ionicons name="image-outline" size={42} color={colors.textMuted} />
                  </View>
                )}

                {/* News Details */}
                <View style={styles.newsCardBody}>
                  {/* Category Pill */}
                  <View style={[styles.categoryBadge, { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                    <Text style={[styles.categoryBadgeText, { color: colors.textPrimary }]}>{(item.category || "O'YINLAR").toUpperCase()}</Text>
                  </View>

                  {/* Title */}
                  <Text style={[styles.newsTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                    {item.title}
                  </Text>

                  {/* Content Snippet */}
                  {item.content ? (
                    <Text style={[styles.newsSnippet, { color: colors.textSecondary }]} numberOfLines={3}>
                      {item.content}
                    </Text>
                  ) : null}

                  {/* Bottom Footer Action Buttons */}
                  <View style={[styles.newsCardFooter, { borderTopColor: colors.border }]}>
                    <Text style={[styles.newsDateText, { color: colors.textMuted }]}>{formattedDate}</Text>

                    <View style={styles.actionButtonsGroup}>
                      {/* EDIT BUTTON */}
                      <TouchableOpacity
                        style={[styles.editBtn, { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                        activeOpacity={0.8}
                        onPress={() => handleOpenEdit(item)}
                      >
                        <Ionicons name="create-outline" size={15} color={colors.accentGreen} />
                        <Text style={[styles.editBtnText, { color: colors.textPrimary }]}>{"Tahrirlash"}</Text>
                      </TouchableOpacity>

                      {/* DELETE BUTTON */}
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        activeOpacity={0.8}
                        onPress={() => setNewsToDelete(item)}
                      >
                        <Ionicons name="trash-outline" size={15} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* FULL DETAIL VIEW MODAL */}
      <Modal visible={!!selectedNewsForView} transparent animationType="fade" onRequestClose={() => setSelectedNewsForView(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.viewModalContainer, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
            {/* View Modal Header */}
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{"YANGILIK MANZARASI"}</Text>
              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: colors.bgCardElevated }]}
                onPress={() => setSelectedNewsForView(null)}
              >
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {selectedNewsForView && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Full Image */}
                {selectedNewsForView.image_url ? (
                  <ExpoImage
                    source={{ uri: selectedNewsForView.image_url }}
                    cachePolicy="memory-disk"
                    style={styles.viewFullImg}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.viewImgPlaceholder, { backgroundColor: colors.bgCardElevated }]}>
                    <Ionicons name="image-outline" size={54} color={colors.textMuted} />
                  </View>
                )}

                <View style={{ paddingVertical: 14 }}>
                  {/* Category Pill & Date */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <View style={[styles.categoryBadge, { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                      <Text style={[styles.categoryBadgeText, { color: colors.textPrimary }]}>
                        {(selectedNewsForView.category || "O'YINLAR").toUpperCase()}
                      </Text>
                    </View>
                    <Text style={[styles.newsDateText, { color: colors.textMuted }]}>
                      {new Date(selectedNewsForView.created_at || Date.now()).toLocaleDateString('uz-UZ')}
                    </Text>
                  </View>

                  {/* Full Title */}
                  <Text style={[styles.viewFullTitle, { color: colors.textPrimary }]}>{selectedNewsForView.title}</Text>

                  {/* Full Content */}
                  <Text style={[styles.viewFullContent, { color: colors.textSecondary }]}>
                    {selectedNewsForView.content || "Yangilik matni mavjud emas."}
                  </Text>
                </View>

                {/* Bottom Actions inside Full View */}
                <View style={[styles.viewModalActionRow, { borderTopColor: colors.border }]}>
                  <TouchableOpacity
                    style={[styles.viewEditBtn, { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                    activeOpacity={0.8}
                    onPress={() => handleOpenEdit(selectedNewsForView)}
                  >
                    <Ionicons name="create" size={18} color={colors.accentGreen} />
                    <Text style={[styles.viewEditBtnText, { color: colors.textPrimary }]}>{"Tahrirlash"}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.viewDeleteBtn}
                    activeOpacity={0.8}
                    onPress={() => {
                      const target = selectedNewsForView;
                      setSelectedNewsForView(null);
                      setNewsToDelete(target);
                    }}
                  >
                    <Ionicons name="trash" size={18} color="#FFFFFF" />
                    <Text style={styles.viewDeleteBtnText}>{"O'chirish"}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* CREATE / EDIT NEWS MODAL */}
      <Modal visible={isModalOpen} transparent animationType="slide" onRequestClose={() => setIsModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
            {/* Modal Header */}
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                {editingNews ? "YANGILIKNI TAHRIRLASH" : "YANGILIK YARATISH"}
              </Text>
              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: colors.bgCardElevated }]}
                onPress={() => {
                  setIsModalOpen(false);
                  resetForm();
                }}
              >
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Title Input */}
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.textMuted }]}>{"YANGILIK SARLAVHASI *"}</Text>
                <TextInput
                  style={[styles.textInput, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, color: colors.textPrimary }]}
                  placeholder="Sarlavhani kiriting..."
                  placeholderTextColor={colors.textMuted}
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              {/* Category Picker */}
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.textMuted }]}>{"KATEGORIYA TANLANG *"}</Text>
                <View style={styles.categoryGrid}>
                  {categories.map((cat) => {
                    const isSelected = category === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[
                          styles.categoryOptionBtn,
                          Platform.OS === 'android' && {
                            backgroundColor: colors.bgCardElevated,
                            borderColor: colors.border,
                          },
                          isSelected && {
                            backgroundColor: isDark ? 'rgba(74, 222, 128, 0.22)' : '#DCFCE7',
                            borderColor: colors.accentGreen,
                          },
                        ]}
                        activeOpacity={0.8}
                        onPress={() => setCategory(cat)}
                      >
                        <Text
                          style={[
                            styles.categoryOptionText,
                            { color: colors.textSecondary },
                            isSelected && { color: colors.accentGreen, fontWeight: '900' },
                          ]}
                        >
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Image Picker */}
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.textMuted }]}>{"RASM YUKLASH"}</Text>

                {imageUri ? (
                  <View style={[styles.imagePreviewContainer, { borderColor: colors.border }]}>
                    <ExpoImage source={{ uri: imageUri }} cachePolicy="memory-disk" style={styles.previewImage} contentFit="cover" />
                    <TouchableOpacity style={styles.removeImageBtn} onPress={removeImage}>
                      <Ionicons name="close" size={16} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.uploadDropzone, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                    activeOpacity={0.8}
                    onPress={handlePickImage}
                  >
                    <Ionicons name="cloud-upload-outline" size={32} color={colors.textMuted} />
                    <Text style={[styles.uploadDropzoneText, { color: colors.textPrimary }]}>{"Rasm tanlash uchun bosing"}</Text>
                    <Text style={[styles.uploadDropzoneSub, { color: colors.textMuted }]}>{"PNG, JPG, WEBP • Max 5MB"}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Content Input */}
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.textMuted }]}>{"YANGILIK MATNI"}</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, color: colors.textPrimary }]}
                  placeholder="Batafsil yangilik matnini kiriting..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={5}
                  value={content}
                  onChangeText={setContent}
                />
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActionRow}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { backgroundColor: colors.bgCardElevated }]}
                  activeOpacity={0.8}
                  onPress={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.textPrimary }]}>{"Bekor qilish"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen }, submitting && { opacity: 0.6 }]}
                  activeOpacity={0.8}
                  onPress={handleSaveNews}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <Text style={[styles.submitBtnText, { color: '#000000' }]}>
                      {editingNews ? "Saqlash" : "Chop etish"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal visible={!!newsToDelete} transparent animationType="fade" onRequestClose={() => setNewsToDelete(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.deleteModalContainer, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
            <Ionicons name="alert-circle" size={44} color="#EF4444" style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={[styles.deleteModalTitle, { color: colors.textPrimary }]}>{"Yangilikni o'chirish"}</Text>
            <Text style={[styles.deleteModalSub, { color: colors.textMuted }]}>
              {`Chindan ham "${newsToDelete?.title || 'ushbu yangilik'}"ni o'chirmoqchimisiz?`}
            </Text>

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: colors.bgCardElevated }]}
                activeOpacity={0.8}
                onPress={() => setNewsToDelete(null)}
                disabled={isDeleting}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textPrimary }]}>{"Yo'q, bekor qilish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.deleteConfirmBtn, isDeleting && { opacity: 0.6 }]}
                activeOpacity={0.8}
                onPress={executeDeleteNews}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.deleteConfirmBtnText}>{"Ha, o'chirish"}</Text>
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
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 255, 135, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 135, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  screenSub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  createNewsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FF87',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 18,
    shadowColor: '#00FF87',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  createNewsBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.5,
  },
  categoryScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 16,
  },
  categoryTab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  categoryTabActive: {
    backgroundColor: 'rgba(0, 255, 135, 0.22)',
    borderColor: '#00FF87',
  },
  categoryTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
  },
  categoryTabTextActive: {
    color: '#00FF87',
    fontWeight: '900',
  },
  loadingBox: {
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyBox: {
    paddingVertical: 50,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.3)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderStyle: 'dashed',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#CBD5E1',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  gridContainer: {
    gap: 16,
  },
  newsCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  newsCardImg: {
    width: '100%',
    height: 180,
  },
  newsCardImgPlaceholder: {
    width: '100%',
    height: 140,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newsCardBody: {
    padding: 16,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  newsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 22,
    marginBottom: 6,
  },
  newsSnippet: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 19,
    marginBottom: 12,
  },
  newsCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  newsDateText: {
    fontSize: 9.5,
    color: 'rgba(148, 163, 184, 0.65)',
    fontWeight: '600',
    opacity: 0.7,
  },
  actionButtonsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  editBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  deleteBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '85%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    padding: 20,
    overflow: 'hidden',
  },
  viewModalContainer: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    padding: 20,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewFullImg: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    marginBottom: 10,
  },
  viewImgPlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  viewFullTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    lineHeight: 25,
    marginBottom: 12,
  },
  viewFullContent: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 22,
    marginBottom: 16,
  },
  viewModalActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  viewEditBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  viewEditBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  viewDeleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    paddingVertical: 12,
    borderRadius: 12,
  },
  viewDeleteBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#CBD5E1',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryOptionBtn: {
    width: '48%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  categoryOptionBtnActive: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  categoryOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#CBD5E1',
  },
  categoryOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  uploadDropzone: {
    height: 120,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  uploadDropzoneText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  uploadDropzoneSub: {
    color: '#64748B',
    fontSize: 10,
  },
  imagePreviewContainer: {
    position: 'relative',
    height: 180,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
  },
  deleteModalContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    padding: 20,
    overflow: 'hidden',
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 6,
  },
  deleteModalSub: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  deleteConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    alignItems: 'center',
  },
  deleteConfirmBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
  },
});
