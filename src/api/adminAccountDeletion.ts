type DeletionClient = {
  rpc(name: 'request_admin_account_deletion'): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function submitAdminAccountDeletion(client: DeletionClient): Promise<string> {
  const { data, error } = await client.rpc('request_admin_account_deletion');
  if (error || typeof data !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data)) {
    throw new Error('Account deletion request was not accepted');
  }
  return data;
}
