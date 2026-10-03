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
