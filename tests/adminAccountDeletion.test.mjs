import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { submitAdminAccountDeletion } from '../src/api/adminAccountDeletion.ts';

const requestId = '78c321bf-38e9-4aa1-b8c4-273a764f22ee';

function testClient(respond) {
  return createClient('https://example.test', 'test-key', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      assert.equal(new URL(input).pathname, '/rest/v1/rpc/request_admin_account_deletion');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), {});
      return respond();
    } },
  });
}

test('submits without client-supplied user, organization or role and displays the server request ID', async () => {
  assert.equal(await submitAdminAccountDeletion(testClient(() => Response.json(requestId))), requestId);
});

test('rejects permission denial and an unavailable RPC', async () => {
  for (const status of [403, 404, 503]) {
    const client = testClient(() => Response.json({ message: 'Unavailable' }, { status }));
    await assert.rejects(submitAdminAccountDeletion(client), /not accepted/);
  }
});

test('does not report success for an empty or malformed receipt', async () => {
  for (const body of [null, '', 'not-a-request-id', { id: requestId }]) {
    await assert.rejects(
      submitAdminAccountDeletion(testClient(() => Response.json(body))),
      /not accepted/,
    );
  }
});

test('can retry the same request after transport failure and accept the returned receipt', async () => {
  let failed = false;
  const client = testClient(() => {
    if (failed) return Response.json(requestId);
    failed = true;
    throw new Error('Network unavailable');
  });
  await assert.rejects(submitAdminAccountDeletion(client), /not accepted/);
  assert.equal(await submitAdminAccountDeletion(client), requestId);
});
