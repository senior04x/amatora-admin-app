
import type { User } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { parseOrganizationId } from '../utils/organizationId';
import { resolveMatchOwner } from '../utils/organizationOwner';

export const MATCH_ORGANIZER_ROLE = 'amatora_organizer';

export async function loadMatchOrganizerProfile(expectedUserId: string) {
  const { data, error } = await supabase.rpc('current_match_organizer').maybeSingle();
  const profile = data as {
    id: number; organization_id: number; full_name: string; email: string; avatar_url: string | null;
    role: 'user'; auth_user_id: string;
  } | null;
  if (error || !profile || profile.auth_user_id !== expectedUserId || !parseOrganizationId(profile.organization_id)) {
    throw new Error('Organizator akkaunti faollashtirilmagan. Bosh Adminga murojaat qiling.');
  }
  return profile;
}

export async function resolveAdminAppAccount(user: User) {
  if (user.role === MATCH_ORGANIZER_ROLE) {
    const profile = await loadMatchOrganizerProfile(user.id);
    return { role: 'user' as const, organizationId: profile.organization_id, name: profile.full_name, profile };
  }
  if (user.role !== 'authenticated') throw new Error('Akkaunt roli tasdiqlanmadi.');
  const organizationId = await resolveMatchOwner(supabase, user);
  if (!organizationId) throw new Error('Bu akkauntga tashkilot boshqaruvi biriktirilmagan.');
  return { role: 'org_admin' as const, organizationId, name: 'Bosh Admin', profile: null };
}

type OrganizerChange =
  | { organizationId: number; email: string; password: string; name: string; avatarUrl?: string | null }
  | { organizationId: number; action: 'remove'; profileId: number };

export async function manageMatchOrganizer(body: OrganizerChange) {
  const { data, error } = await supabase.functions.invoke('manage-match-organizer', { body });
  if (!error && data?.success) return;
  const context = error && 'context' in error ? error.context : null;
  const result = context instanceof Response ? await context.json().catch(() => null) : null;
  switch (result?.code) {
    case 'OWNER_REQUIRED': throw new Error('Bu tashkilot uchun Bosh Admin vakolati tasdiqlanmagan.');
    case 'PROFILE_CONFLICT': throw new Error('Bu email boshqa profilga bog‘langan yoki organizator allaqachon faol.');
    case 'EMAIL_ALREADY_REGISTERED': throw new Error('Bu email bilan kirish akkaunti allaqachon mavjud.');
    case 'INVALID_INPUT': throw new Error('Email, ism va parolni tekshiring. Parol kamida 8 belgidan iborat bo‘lsin.');
    default: throw new Error('Organizator akkauntini saqlab bo‘lmadi. Qayta urinib ko‘ring.');
  }
}
