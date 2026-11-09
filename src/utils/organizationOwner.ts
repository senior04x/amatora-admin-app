import { parseOrganizationId } from './organizationId';

type Identity = { id?: string; email?: string; email_confirmed_at?: string };
export function verifiedOwnerOrganization(user: Identity, rows: unknown): number | null {
    if (!user.id || !user.email_confirmed_at || !user.email) throw new Error('Tasdiqlangan admin sessiyasi kerak.');
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('Tashkilot bog‘lanishi noaniq.');
    if (rows.length === 0) return null;
    const row = rows[0];
    const id = parseOrganizationId(row?.id);
    if (!id || typeof row.admin_email !== 'string' || row.admin_email.toLowerCase() !== user.email.trim().toLowerCase()) {
        throw new Error('Tashkilot vakolati tasdiqlanmadi.');
    }
    return id;
}
export async function resolveOrganizationOwner(client: any, user: Identity): Promise<number | null> {
    if (!user.id || !user.email_confirmed_at || !user.email) throw new Error('Tasdiqlangan admin sessiyasi kerak.');
    const email = user.email.trim().toLowerCase().replace(/[\\%_]/g, character => '\\' + character);
    const { data, error } = await client.from('organizations').select('id,admin_email').ilike('admin_email', email).limit(2);
    if (error) throw new Error('Tashkilot ruxsatini tekshirib bo‘lmadi.');
    return verifiedOwnerOrganization(user, data);
}

export async function resolveMatchOwner(client: any, user: Identity): Promise<number | null> {
    const { data, error } = await client.rpc('current_match_owner_identity').maybeSingle();
    // Before the backend migration, use the existing verified owner lookup.
    // A real denial, an empty result, or a different UID must never fall back.
    if (error?.code === 'PGRST202') return resolveOrganizationOwner(client, user);
    if (error) throw new Error('Bosh Admin vakolatini tekshirib bo‘lmadi.');
    return user.id && data?.auth_user_id === user.id ? parseOrganizationId(data.organization_id) : null;
}
