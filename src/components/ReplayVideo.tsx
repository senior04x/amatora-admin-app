'use dom';

import { useEffect, useRef, useState } from 'react';
import type { DOMProps } from 'expo/dom';

export default function ReplayVideo({ uri, paused, dom }: { uri: string; paused: boolean; dom?: DOMProps }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (paused) video.current?.pause(); }, [paused]);

  return <main style={{ position: 'fixed', inset: 0, background: '#080e18', color: '#fff' }}>
    <video ref={video} src={uri} controls playsInline autoPlay={!paused} preload="metadata"
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', display: failed ? 'none' : 'block' }} />
    {failed && <div style={{ display: 'grid', placeContent: 'center', height: '100%', textAlign: 'center', fontFamily: 'system-ui' }}>
      <p>Videoni ochib bo‘lmadi.</p>
      <button onClick={() => {
        setFailed(false);
        video.current?.load();
        if (!paused) void video.current?.play().catch(() => {});
      }}>Qayta urinish</button>
    </div>}
  </main>;
}
