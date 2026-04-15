import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Native HTML5 audio player output. Accepts URL string, object with `url`,
 * or a base64 data payload wrapped to data:audio/mpeg.
 */
export function coerceAudioSrc(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === 'string') {
    if (data.startsWith('http') || data.startsWith('data:')) return data;
    return `data:audio/mpeg;base64,${data}`;
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['url', 'src', 'href', 'audio']) {
      const v = obj[key];
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

export function AudioOutput({ data, loading }: RenderProps): React.ReactElement {
  if (loading) return <div className="floom-output floom-output-audio loading">…</div>;
  const src = coerceAudioSrc(data);
  if (!src) {
    return (
      <div className="floom-output floom-output-audio">
        <em>No audio data</em>
      </div>
    );
  }
  return (
    <audio
      className="floom-output floom-output-audio"
      controls
      src={src}
      style={{ width: '100%' }}
    />
  );
}
