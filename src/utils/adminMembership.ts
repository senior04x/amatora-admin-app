// Authority comes from the database record matched to a verified Auth UID.
// Cached organization IDs, emails and user_metadata never grant admin access.
export function validatedAdminOrganization(userId: string, record: unknown): number {
  const value = record as { id?: unknown; role?: unknown; organization_id?: unknown } | null;
  if (!userId || !value || value.id !== userId || !['org_admin', 'super_admin'].includes(String(value.role))
    || typeof value.organization_id !== 'number' || !Number.isSafeInteger(value.organization_id) || value.organization_id <= 0) {
    throw new Error('Administrator huquqi yoki tashkiloti tasdiqlanmadi.');
  }
  return value.organization_id;
}
