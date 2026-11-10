import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { saveReplayToGallery, GalleryPermissionError } from '../utils/replayGallery';

export type HighlightClip = { id: string; name: string; team: string; number?: string | number | null; photo?: string | null };
export type HighlightSize = 5 | 10;

const endpoint = (() => {
  try {
    const url = new URL(process.env.EXPO_PUBLIC_HIGHLIGHT_WORKER_URL ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
})();
type Job = { id: string; token: string };
type Progress = { state: 'rendering' | 'ready' | 'failed'; completed: number };

async function request<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  if (!endpoint) throw new Error('not configured');
  const response = await fetch(endpoint + path, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

export default function HighlightEditor({ organizationId, clips, size, dark, onSize, onRemove, onMove, onClose }: {
  organizationId: number; clips: HighlightClip[]; size: HighlightSize; dark: boolean;
  onSize: (size: HighlightSize) => void; onRemove: (id: string) => void;
  onMove: (index: number, delta: number) => void; onClose: () => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const progress = useQuery({
    queryKey: ['highlightProgress', job?.id],
    enabled: !!job,
    queryFn: ({ signal }) => request<Progress>(`/v1/highlights/${job!.id}`, job!.token, { signal }),
    refetchInterval: query => query.state.status === 'error' || ['ready', 'failed'].includes(query.state.data?.state ?? '') ? false : 4000,
    refetchOnWindowFocus: false,
    retry: 1,
    gcTime: 0,
  });
  const busy = submitting || saving || (!!job && !progress.isError && (!progress.data || progress.data.state === 'rendering'));
  const ready = progress.data?.state === 'ready';
  const locked = busy || ready;
  const fg = dark ? '#f8fafc' : '#11212a';
  const muted = dark ? '#a7b7c7' : '#526473';

  async function build() {
    if (busy || clips.length !== size || !endpoint) return;
    setError('');
    setSubmitting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('401');
      const result = await request<{ id: string }>('/v1/highlights', token, {
        method: 'POST', body: JSON.stringify({ organizationId, size, eventIds: clips.map(clip => clip.id) }),
      });
      setJob({ id: result.id, token });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(code === '429' ? "Montaj xizmati band. Birozdan keyin yana urinib ko‘ring."
        : code === '401' || code === '403' ? "Bu tashkilot uchun montaj ruxsati tasdiqlanmadi."
        : "Montajni boshlashning imkoni bo‘lmadi. Qayta urinib ko‘ring.");
    } finally { setSubmitting(false); }
  }

  async function save() {
    if (!job || !endpoint || !ready || saving) return;
    setSaving(true);
    setError('');
    try {
      await saveReplayToGallery(`${endpoint}/v1/highlights/${job.id}/file`, `AMATORA-Top-${size}-${Date.now()}.mp4`,
        { Authorization: `Bearer ${job.token}` });
      Alert.alert('Montaj saqlandi', 'MP4 telefon galereyasiga saqlandi.');
    } catch (e) {
      setError(e instanceof GalleryPermissionError ? 'Galereyaga saqlash uchun ruxsat bering.' : "MP4 saqlanmadi. Yana urinib ko‘ring.");
    } finally { setSaving(false); }
  }

  return <View style={[styles.panel, { backgroundColor: dark ? '#182836' : '#fff', borderColor: dark ? '#334155' : '#dbe6e1' }]}>
    <View style={styles.header}>
      <View style={styles.mark}><Ionicons name="film-outline" color="#89f5c8" size={21} /></View>
      <View style={styles.grow}>
        <Text style={[styles.kicker, { color: dark ? '#89f5c8' : '#087c58' }]}>AMATORA / GOLLAR</Text>
        <Text style={[styles.title, { color: fg }]}>Highlight montaji</Text>
      </View>
      <TouchableOpacity disabled={busy} onPress={onClose} accessibilityLabel="Montaj oynasini yopish" style={styles.icon}>
        <Ionicons name="close" size={24} color={muted} />
      </TouchableOpacity>
    </View>
    <View style={styles.switcher}>{([5, 10] as const).map(option =>
      <TouchableOpacity key={option} disabled={locked || clips.length > option} onPress={() => onSize(option)}
        accessibilityRole="button" accessibilityState={{ selected: size === option }}
        style={[styles.option, { backgroundColor: size === option ? '#09654b' : dark ? '#233645' : '#eaf4ef' }]}>
        <Text style={{ color: size === option ? '#fff' : fg, fontWeight: '800' }}>Top {option}</Text>
      </TouchableOpacity>)}</View>
    <Text style={{ color: muted, lineHeight: 20 }}>
      {clips.length} / {size} gol tanlandi. O‘yinlardan klip tanlang va ularni kerakli tartibga qo‘ying.
    </Text>
    {clips.map((clip, i) => <View key={clip.id} style={[styles.row, { borderColor: dark ? '#334155' : '#e3ece8' }]}>
      <Text style={[styles.rank, { color: muted }]}>{String(i + 1).padStart(2, '0')}</Text>
      {clip.photo ? <Image source={clip.photo} style={styles.avatar} /> :
        <View style={[styles.avatar, styles.placeholder]}><Ionicons name="person-outline" size={18} color="#a7f3d0" /></View>}
      <View style={styles.grow}>
        <Text numberOfLines={1} style={{ color: fg, fontWeight: '800' }}>{clip.name}</Text>
        <Text numberOfLines={1} style={{ color: muted, fontSize: 12 }}>{clip.team}{clip.number != null ? ` · #${clip.number}` : ''}</Text>
      </View>
      <TouchableOpacity accessibilityLabel="Yuqoriga surish" onPress={() => onMove(i, -1)} disabled={locked || i === 0} style={styles.icon}>
        <Ionicons name="chevron-up" size={19} color={locked || i === 0 ? '#64748b55' : muted} />
      </TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Pastga surish" onPress={() => onMove(i, 1)} disabled={locked || i === clips.length - 1} style={styles.icon}>
        <Ionicons name="chevron-down" size={19} color={locked || i === clips.length - 1 ? '#64748b55' : muted} />
      </TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Golni olib tashlash" onPress={() => onRemove(clip.id)} disabled={locked} style={styles.icon}>
        <Ionicons name="close-circle-outline" size={19} color={locked ? '#64748b55' : muted} />
      </TouchableOpacity>
    </View>)}
    {busy && <View style={styles.header}><ActivityIndicator color="#10b981" />
      <Text style={{ color: fg }}>{saving ? 'Galereyaga saqlanmoqda…' : `Montaj tayyorlanmoqda · ${progress.data?.completed ?? 0}/${size}`}</Text></View>}
    {!!(error || progress.isError || progress.data?.state === 'failed' || !endpoint) && <Text accessibilityRole="alert" style={{ color: dark ? '#fcd39b' : '#864400' }}>
      {error || (!endpoint ? 'MP4 eksport xizmati hali ulanmagan.' : "Montajni yakunlab bo‘lmadi. Qayta urinib ko‘ring.")}
    </Text>}
    <TouchableOpacity accessibilityRole="button" disabled={busy || !endpoint || clips.length !== size}
      onPress={() => void (ready ? save() : build())}
      style={[styles.cta, (busy || !endpoint || clips.length !== size) && { opacity: 0.48 }]}>
      <Ionicons name={ready ? 'download-outline' : 'film-outline'} size={19} color="#fff" />
      <Text style={styles.ctaText}>{ready ? 'MP4 ni galereyaga saqlash' : `Top ${size} MP4 tayyorlash`}</Text>
    </TouchableOpacity>
    {ready && <TouchableOpacity onPress={() => { setJob(null); setError(''); }} disabled={saving}>
      <Text style={{ color: muted, textAlign: 'center', padding: 8 }}>Yangi montaj boshlash</Text>
    </TouchableOpacity>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 13 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  grow: { flex: 1, minWidth: 0 },
  mark: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#0c4739', alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { fontSize: 22, fontWeight: '900', marginTop: 2 },
  switcher: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 11 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 8 },
  rank: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'], marginRight: 2 },
  avatar: { height: 33, width: 33, borderRadius: 8 },
  placeholder: { backgroundColor: '#174535', alignItems: 'center', justifyContent: 'center' },
  icon: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  cta: { backgroundColor: '#09654b', borderRadius: 11, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: '#fff', fontWeight: '900' },
});
