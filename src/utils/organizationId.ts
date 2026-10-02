/** Missing organization IDs must never resolve to a real customer's ID. */
export function parseOrganizationId(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function requireOrganizationId(value: unknown): number {
  const id = parseOrganizationId(value);
  if (id === null) throw new Error('Tashkilotingiz aniqlanmadi. Qayta kiring.');
  return id;
}
