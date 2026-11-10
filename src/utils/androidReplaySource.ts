const HOST = 'xzzyhfyazwohdqqbjiiy.supabase.co';
const cache = new Map<string, { expires: number; result: Promise<string> }>();

export function androidReplayCandidate(uri: string): string | null {
    try {
        const url = new URL(uri);
        if (url.protocol !== 'https:' || url.hostname !== HOST || !url.pathname.startsWith('/storage/v1/object/public/replays/') || !/\.mp4$/i.test(url.pathname) || /\.android\.mp4$/i.test(url.pathname)) return null;
        url.pathname = url.pathname.replace(/\.mp4$/i, '.android.mp4');
        return url.toString();
    } catch { return null; }
}

export function resolveAndroidReplay(uri: string): Promise<string> {
    const candidate = androidReplayCandidate(uri);
    if (!candidate) return Promise.resolve(uri);
    const existing = cache.get(uri);
    if (existing && existing.expires > Date.now()) return existing.result;
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    const result = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        try {
            const response = await fetch(candidate, { method: 'HEAD', signal: controller.signal });
            return response.ok && Number(response.headers.get('content-length')) > 0 ? candidate : uri;
        } catch { return uri; }
        finally { clearTimeout(timeout); }
    })();
    cache.set(uri, { expires: Date.now() + 10 * 60 * 1000, result });
    return result;
}

