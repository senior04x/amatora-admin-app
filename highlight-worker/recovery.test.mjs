import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

test('recovers the owner’s completed download after a worker restart and accepts a refreshed session', async () => {
  const owner = '12345678-1234-1234-1234-123456789abc';
  const jobId = 'aaaaaaaa-1234-1234-1234-123456789abc';
  const mock = createServer((req, res) => {
    const isOwner = req.headers.authorization === 'Bearer refreshed';
    const isOther = req.headers.authorization === 'Bearer other';
    const respond = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url.startsWith('/auth/v1/user') && (isOwner || isOther)) {
      return respond(200, { id: isOwner ? owner : 'other', email: 'owner@example.test', email_confirmed_at: 'today' });
    }
    if (req.url.startsWith('/rest/v1/organizations') && isOwner) return respond(200, [{ id: 1, admin_email: 'owner@example.test' }]);
    respond(401, {});
  }).listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));

  const root = await mkdtemp(join(tmpdir(), 'amatora-highlight-recovery-'));
  let worker;
  try {
    const dir = join(root, jobId);
    await mkdir(dir);
    await writeFile(join(dir, 'highlight.mp4'), 'test file');
    await writeFile(join(dir, 'job.json'), JSON.stringify({
      id: jobId, owner, org: 1, state: 'ready', clips: Array(5).fill({}), completed: 5,
      createdAt: Date.now(), expires: Date.now() + 60_000,
    }));
    worker = spawn(process.execPath, ['highlight-worker/server.mjs'], { env: { ...process.env, PORT: String(port),
      HIGHLIGHT_DATA_DIR: root, SUPABASE_URL: `http://127.0.0.1:${mock.address().port}`,
      SUPABASE_ANON_KEY: 'test', HIGHLIGHT_OWNERS: JSON.stringify({ 1: owner }) }, stdio: 'ignore', windowsHide: true });
    const url = `http://127.0.0.1:${port}`;
    let online = false;
    for (let attempt = 0; attempt < 30 && !online; attempt++) {
      try { online = (await fetch(url + '/health')).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(online);
    const request = (suffix, token) => fetch(url + '/v1/highlights/' + suffix, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal((await request('latest?organizationId=1', 'other')).status, 403);
    assert.equal((await request(jobId + '/file', 'other')).status, 403);
    const latest = await request('latest?organizationId=1', 'refreshed');
    assert.equal(latest.status, 200);
    assert.equal((await latest.json()).id, jobId);
    const file = await request(jobId + '/file', 'refreshed');
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'video/mp4');
    assert.equal(await file.text(), 'test file');
  } finally {
    if (worker && worker.exitCode === null) {
      const exited = once(worker, 'exit');
      worker.kill();
      await exited;
    }
    await new Promise(resolve => mock.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
