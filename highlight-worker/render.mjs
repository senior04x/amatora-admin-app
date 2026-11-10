import { spawn } from 'node:child_process';
import { copyFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { join } from 'node:path';

const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const ffprobe = process.env.FFPROBE || 'ffprobe';
const font = process.env.HIGHLIGHT_FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function run(command, args, cwd, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, signal, windowsHide: true });
    let output = '', diagnostics = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-8192); });
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4096); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(diagnostics || 'Media command failed')));
  });
}

export function storageUrl(origin, value, buckets) {
  const url = new URL(value);
  if (url.origin !== origin || url.username || url.password) throw new Error('Unexpected media host');
  const prefix = '/storage/v1/object/public/';
  if (!url.pathname.startsWith(prefix) || !buckets.includes(url.pathname.slice(prefix.length).split('/')[0])) {
    throw new Error('Unexpected media bucket');
  }
  return url;
}

export async function download(url, file, maxBytes, signal) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) });
  if (!response.ok || !response.body) throw new Error('Source unavailable');
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel();
    throw new Error('Source exceeds limit');
  }
  let bytes = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, _, done) {
      bytes += chunk.length;
      done(bytes > maxBytes ? new Error('Source exceeds limit') : null, chunk);
    }
  }), createWriteStream(file), { signal });
}

const clean = (value, max) => [...String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, max).join('');
const text = (file, x, y, size, color) =>
  `drawtext=fontfile=font.ttf:textfile=${file}:expansion=none:x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}`;

export async function renderHighlight({ directory, clips, total, loadClip, loadPhoto, signal, onProgress }) {
  await copyFile(font, join(directory, 'font.ttf'));
  const segments = [];
  for (const [index, clip] of clips.entries()) {
    signal.throwIfAborted();
    const id = index + 1;
    const input = `clip-${id}.mp4`, output = `segment-${id}.mp4`;
    await loadClip(clip, join(directory, input), signal);
    let hasPhoto = false;
    if (clip.player?.photo_url) {
      try {
        await loadPhoto(clip.player.photo_url, join(directory, 'portrait'), signal);
        await run(ffmpeg, ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-i', 'portrait',
          '-frames:v', '1', '-vf', 'scale=96:96:force_original_aspect_ratio=increase,crop=96:96', 'portrait.png'], directory, signal);
        hasPhoto = true;
      } catch { signal.throwIfAborted(); }
    }
    const stream = JSON.parse(await run(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-show_entries',
      'stream=codec_type:format=duration', '-of', 'json', input], directory, signal));
    const duration = Number(stream.format?.duration);
    if (!Number.isFinite(duration) || duration < 0.25 || duration > 60 || !stream.streams?.some(s => s.codec_type === 'video')) throw new Error('Invalid clip');
    const hasAudio = stream.streams.some(s => s.codec_type === 'audio');
    const player = [clip.player?.first_name, clip.player?.last_name].filter(Boolean).join(' ');
    const label = [clip.team?.name || 'Jamoa', clip.player?.player_number != null ? `#${clip.player.player_number}` : '',
      clip.minute != null ? `${clip.minute}′` : '', clip.event_type === 'own_goal' ? 'Avtogol' : clip.event_type === 'penalty_goal' ? 'Penalti' : ''].filter(Boolean).join('  •  ');
    await Promise.all([
      writeFile(join(directory, 'rank.txt'), `TOP ${total}   /   ${String(id).padStart(2, '0')}`),
      writeFile(join(directory, 'name.txt'), clean(player || 'Muallifsiz gol', 38)),
      writeFile(join(directory, 'club.txt'), clean(label, 62)),
      writeFile(join(directory, 'mark.txt'), 'AMATORA  /  GOLLAR'),
      writeFile(join(directory, 'initials.txt'), player.split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase() || 'GOL'),
    ]);
    const args = ['-v', 'error', '-y', '-threads', '2', '-protocol_whitelist', 'file', '-i', input];
    const photoIndex = hasAudio ? 1 : 2;
    if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    if (hasPhoto) args.push('-i', 'portrait.png');
    const filters = ['fps=30', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2',
      'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x08111d', 'setsar=1',
      'drawbox=x=42:y=42:w=239:h=46:color=0x08111d@0.95:t=fill', text('mark.txt', 56, 56, 19, '0x8af6c9'),
      'drawbox=x=42:y=529:w=760:h=149:color=0x08111d@0.94:t=fill',
      'drawbox=x=42:y=529:w=5:h=149:color=0x34e8a5:t=fill',
      'drawbox=x=62:y=555:w=96:h=96:color=0x154638:t=fill',
      text('rank.txt', 176, 548, 19, '0x8af6c9'), text('name.txt', 176, 575, 28, 'white'),
      text('club.txt', 176, 618, 17, '0xcbd5e1')];
    if (!hasPhoto) filters.push(text('initials.txt', '110-tw/2', '603-th/2', 25, 'white'));
    const video = `[0:v:0]${filters.join(',')}[base]`;
    const graph = hasPhoto ? `${video};[base][${photoIndex}:v]overlay=62:555:repeatlast=1[v]` : video;
    await run(ffmpeg, [...args, '-filter_complex_threads', '1', '-filter_complex', graph,
      '-map', hasPhoto ? '[v]' : '[base]', '-map', hasAudio ? '0:a:0' : '1:a:0',
      '-af', 'aresample=48000,apad', '-ac', '2', '-t', String(duration), '-c:v', 'libx264',
      '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'main',
      '-c:a', 'aac', '-b:a', '112k', output], directory, signal);
    segments.push(`file '${output}'`);
    onProgress(id);
  }
  await writeFile(join(directory, 'segments.txt'), segments.join('\n'));
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', 'segments.txt',
    '-c', 'copy', '-movflags', '+faststart', 'highlight.mp4'], directory, signal);
  return join(directory, 'highlight.mp4');
}
