import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderHighlight, storageUrl } from './render.mjs';

const run = (tool, args) => execFileSync(process.env[tool] || tool.toLowerCase(), args, { encoding: 'utf8' });

test('only accepts known public storage origins and buckets', () => {
  const origin = 'https://project.supabase.co';
  const prefix = '/storage/v1/object/public/replays/';
  assert.equal(storageUrl(origin, origin + prefix + 'match/goal.mp4', ['replays']).origin, origin);
  for (const url of ['https://localhost' + prefix + 'a', origin + prefix + '../../private/file', origin + '/auth/v1/user']) {
    assert.throws(() => storageUrl(origin, url, ['replays']));
  }
});

for (const total of [5, 10]) test(`renders Top ${total} as H.264/AAC MP4 with ordered clips and visible graphics`, { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amatora-highlight-test-'));
  try {
    const input = join(directory, 'source.mp4'), sound = join(directory, 'sound.mp4'), portrait = join(directory, 'headshot.png');
    run('FFMPEG', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=240x320:r=25',
      '-t', '0.5', '-c:v', 'libx264', input]);
    run('FFMPEG', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=480x240:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '0.5', '-c:v', 'libx264', '-c:a', 'aac', sound]);
    run('FFMPEG', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=yellow:s=80x120', '-frames:v', '1', portrait]);
    const progress = [];
    const output = await renderHighlight({ directory, total, signal: AbortSignal.timeout(55_000),
      clips: Array.from({ length: total }, (_, i) => ({
        index: i, minute: i, event_type: 'goal', team: { name: "O‘zbekiston FC" },
        player: i % 2 ? null : { first_name: "O‘tkir", last_name: "Yo‘ldoshev 100% : test", player_number: 0, photo_url: 'photo' },
      })),
      loadClip: (clip, file) => copyFile(clip.index % 2 ? input : sound, file),
      loadPhoto: (_, file) => copyFile(portrait, file),
      onProgress: value => progress.push(value),
    });
    assert.equal(progress.length, total);
    const probe = JSON.parse(run('FFPROBE', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
    assert.deepEqual(probe.streams.map(stream => stream.codec_name), ['h264', 'aac']);
    assert.equal(probe.streams[0].pix_fmt, 'yuv420p');
    assert.equal(probe.streams[0].width, 1280);
    assert.equal(probe.streams[0].height, 720);
    assert.ok(Math.abs(Number(probe.format.duration) - total * 0.5) < 0.6);
    assert.ok((await stat(output)).size > 10_000);
    function rgb(x, y, at) {
      return execFileSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-ss', at, '-i', output, '-frames:v', '1',
        '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-']);
    }
    const face = rgb(100, 600, '0.2');
    assert.ok(face[0] > 200 && face[1] > 200 && face[2] < 30, 'portrait is composited into the exported frame');
    const first = rgb(640, 350, '0.2'), second = rgb(640, 350, '0.8');
    assert.ok(first[0] > 200 && second[2] > 200, 'export follows the submitted order');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
