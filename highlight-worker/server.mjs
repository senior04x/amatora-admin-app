import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { download, renderHighlight, storageUrl } from './render.mjs';

const origin = new URL(process.env.SUPABASE_URL).origin;
const apiKey = process.env.SUPABASE_ANON_KEY;
const owners = JSON.parse(process.env.HIGHLIGHT_OWNERS || '{}');
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
if (!apiKey || Object.entries(owners).some(([org, owner]) => !/^[1-9][0-9]*$/.test(org) || !uuid.test(owner))) {
  throw new Error('Invalid highlight worker configuration');
}
const jobs = new Map();
const recent = new Map();
const ttl = 15 * 60_000;
const digest = token => createHash('sha256').update(token).digest('hex');
const goals = ['goal', 'penalty_goal', 'own_goal'];
let active = false;

class HttpError extends Error {
  constructor(status) { super(String(status)); this.status = status; }
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function rest(path, query, token) {
  const url = new URL(path, origin);
  url.search = new URLSearchParams(query);
  const response = await fetch(url, { headers: { apikey: apiKey, authorization: token },
    redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new HttpError(response.status === 401 ? 401 : 503);
  return response.json();
}

async function identity(req) {
  const token = req.headers.authorization;
  if (typeof token !== 'string' || token.length > 8192 || !/^Bearer [^\s]+$/.test(token)) throw new HttpError(401);
  const user = await rest('/auth/v1/user', {}, token);
  if (!user?.id || !user.email || !user.email_confirmed_at) throw new HttpError(403);
  return { user, token };
}

async function authorize(org, { user, token }) {
  if (owners[org] !== user.id) throw new HttpError(403);
  const email = user.email.trim().toLowerCase();
  const rows = await rest('/rest/v1/organizations', { select: 'id,admin_email',
    admin_email: 'ilike.' + email.replace(/[\\%_*]/g, c => '\\' + c), limit: '2' }, token);
  if (rows.length !== 1 || Number(rows[0].id) !== org || rows[0].admin_email?.toLowerCase() !== email) throw new HttpError(403);
}

async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString('utf8');
    if (text.length > 4096) throw new HttpError(413);
  }
  try { return JSON.parse(text); } catch { throw new HttpError(400); }
}

async function startJob(job, clips) {
  try {
    job.directory = await mkdtemp(join(tmpdir(), 'amatora-highlight-'));
    const signal = AbortSignal.timeout(7 * 60_000);
    job.file = await renderHighlight({ directory: job.directory, clips, total: clips.length, signal,
      onProgress: completed => { job.completed = completed; },
      loadClip: (clip, file, signal) => download(storageUrl(origin, clip.replay_video_url, ['replays']), file, 64 * 1024 ** 2, signal),
      loadPhoto: (photo, file, signal) => download(storageUrl(origin, photo, ['player-photos']), file, 5 * 1024 ** 2, signal),
    });
    job.state = 'ready';
  } catch (error) {
    console.error('Highlight render failed', job.id, error.name);
    job.state = 'failed';
    if (job.directory) await rm(job.directory, { recursive: true, force: true }).catch(() => {});
  } finally {
    job.expires = Date.now() + ttl;
    active = false;
  }
}

setInterval(() => {
  for (const [id, job] of jobs) {
    if (job.expires && job.expires < Date.now() && !job.downloads) {
      jobs.delete(id);
      if (job.directory) void rm(job.directory, { recursive: true, force: true }).catch(() => {});
    }
  }
  for (const [id, time] of recent) if (time + 60_000 < Date.now()) recent.delete(id);
}, 30_000).unref();

createServer(async (req, res) => {
  try {
    const path = req.url?.split('?')[0];
    if (req.method === 'GET' && path === '/watch') {
      let clip;
      try {
        const input = new URL(req.url, 'http://localhost').searchParams.get('src');
        if (!input || input.length > 2048) throw new Error();
        clip = storageUrl(origin, input, ['replays']);
      } catch { throw new HttpError(400); }
      const source = clip.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; media-src ${origin}; frame-ancestors 'none'; base-uri 'none'` });
      return res.end(`<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AMATORA · Replay</title><style>body{margin:0;min-height:100dvh;background:#09121c;color:#eaf8f1;display:grid;place-items:center;font:16px system-ui}main{width:min(100%,980px)}h1{font-size:15px;letter-spacing:2px;color:#89f5c8;margin:16px}video{display:block;width:100%;max-height:82dvh;aspect-ratio:16/9;background:#050a10}</style>
<main><h1>AMATORA / REPLAY</h1><video controls playsinline autoplay preload="metadata" src="${source}"></video></main></html>`);
    }
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, configured: Object.keys(owners).length > 0 });
    const match = /^\/v1\/highlights\/([a-f0-9-]+)(\/file)?$/.exec(path ?? '');
    if (req.method === 'GET' && match) {
      const job = jobs.get(match[1]);
      if (!job || (job.expires && job.expires < Date.now())) throw new HttpError(404);
      // The app polls with its session token. Compare it with the token verified
      // at submission; do not call Supabase Auth on every progress request.
      if (!req.headers.authorization || digest(req.headers.authorization) !== job.tokenHash) throw new HttpError(403);
      if (!match[2]) return send(res, 200, { state: job.state, completed: job.completed });
      if (job.state !== 'ready') throw new HttpError(409);
      job.downloads++;
      try {
        const file = await stat(job.file);
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': file.size,
          'content-disposition': 'attachment; filename="AMATORA-Highlight.mp4"', 'cache-control': 'private, no-store' });
        await pipeline(createReadStream(job.file), res);
      } finally { job.downloads--; }
      return;
    }
    if (req.method !== 'POST' || path !== '/v1/highlights') throw new HttpError(404);
    const body = await readBody(req);
    const { organizationId: org, eventIds, size } = body ?? {};
    if (!Number.isSafeInteger(org) || org <= 0 || ![5, 10].includes(size) || !Array.isArray(eventIds) ||
        eventIds.length !== size || new Set(eventIds).size !== size || eventIds.some(id => typeof id !== 'string' || !uuid.test(id))) {
      throw new HttpError(400);
    }
    const auth = await identity(req);
    await authorize(org, auth);
    if (active || jobs.size >= 12 || (recent.get(auth.user.id) ?? 0) + 60_000 > Date.now()) throw new HttpError(429);
    const rows = await rest('/rest/v1/match_events', {
      select: 'id,event_type,minute,replay_video_url,player:player_id(first_name,last_name,player_number,photo_url),team:team_id(name),match:matches!inner(organization_id)',
      id: `in.(${eventIds.join(',')})`, 'match.organization_id': `eq.${org}`, limit: String(size),
    }, auth.token);
    const byId = new Map(rows.map(row => [row.id, row]));
    const clips = eventIds.map(id => byId.get(id));
    if (clips.some(clip => !clip || !goals.includes(clip.event_type) || !clip.replay_video_url)) throw new HttpError(403);
    try { clips.forEach(clip => storageUrl(origin, clip.replay_video_url, ['replays'])); }
    catch { throw new HttpError(422); }
    if (active || jobs.size >= 12) throw new HttpError(429);
    active = true;
    recent.set(auth.user.id, Date.now());
    const job = { id: randomUUID(), tokenHash: digest(auth.token), state: 'rendering', completed: 0, downloads: 0 };
    jobs.set(job.id, job);
    send(res, 202, { id: job.id });
    void startJob(job, clips);
  } catch (error) {
    if (!res.headersSent) send(res, error.status || 500, { error: error.status || 500 });
    else res.destroy();
  }
}).listen(Number(process.env.PORT || 8080), '0.0.0.0');
