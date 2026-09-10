export type LocalVoiceProviderMode = 'local' | 'openai';

export const LOCAL_VOICE_DEFAULT_URL = 'ws://127.0.0.1:8765/ws/voice';

export function normalizeLocalVoiceProvider(value: string | null | undefined): LocalVoiceProviderMode {
  if (value === 'openai' || value === 'local') return value;
  return 'local';
}

export function buildLocalVoiceUrl(baseUrl?: string): string {
  const trimmed = (baseUrl ?? LOCAL_VOICE_DEFAULT_URL).trim();
  if (!trimmed) return LOCAL_VOICE_DEFAULT_URL;
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${url.host}/ws/voice`;
    }
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      return trimmed.replace(/\/?$/, '').replace(/\/ws\/voice$/, '') + '/ws/voice';
    }
  } catch {
    // Fall through to the default localhost endpoint for invalid input.
  }
  return LOCAL_VOICE_DEFAULT_URL;
}

export class LocalVoiceError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'LocalVoiceError';
  }
}

export interface LocalVoiceConnectOptions {
  url?: string;
  onEvent(event: Record<string, unknown>): void;
  onClosed(): void;
  signal?: AbortSignal;
}

export interface LocalVoiceChannel {
  send(event: Record<string, unknown>): void;
  sendAudio(samples: Float32Array, sampleRate: number): void;
  synthesize(text: string, signal?: AbortSignal): Promise<{ audio: Float32Array; sampleRate: number }>;
  close(): void;
}

function encodeFloat32(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export async function connectLocalVoiceService(
  options: LocalVoiceConnectOptions
): Promise<LocalVoiceChannel> {
  const wsUrl = buildLocalVoiceUrl(options.url);
  const socket = new WebSocket(wsUrl);
  const pendingTts = new Map<string, {
    resolve: (value: { audio: Float32Array; sampleRate: number }) => void;
    reject: (error: Error) => void;
  }>();

  await new Promise<void>((resolve, reject) => {
    const onError = () => {
      cleanup();
      reject(
        new LocalVoiceError(
          'Local voice service is not running. Start it with python local_voice/server.py.',
          'service-unavailable'
        )
      );
    };

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      socket.close();
      reject(new LocalVoiceError('The local voice session was cancelled.', 'cancelled'));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
  });

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (import.meta.env.DEV) console.debug('[local voice] message received', payload.type);
      if (payload.type === 'tts.audio' || payload.type === 'tts.error') {
        const requestId = String(payload.request_id ?? '');
        const pending = pendingTts.get(requestId);
        if (pending) {
          pendingTts.delete(requestId);
          if (payload.type === 'tts.error') {
            pending.reject(new LocalVoiceError(String(payload.message ?? 'KemeTone synthesis failed.')));
          } else {
            const binary = atob(String(payload.audio ?? ''));
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            pending.resolve({
              audio: new Float32Array(bytes.buffer),
              sampleRate: Number(payload.sample_rate ?? 24000)
            });
          }
        }
      }
      options.onEvent(payload);
    } catch {
      // Ignore non-JSON frames from the local service.
    }
  });

  socket.addEventListener('close', () => options.onClosed());

  return {
    send(event) {
      if (socket.readyState === WebSocket.OPEN) {
        if (import.meta.env.DEV) console.debug('[local voice] message sent', event.type);
        socket.send(JSON.stringify(event));
      }
    },
    sendAudio(samples, sampleRate) {
      if (socket.readyState !== WebSocket.OPEN) return;
      const encoded = encodeFloat32(samples);
      if (import.meta.env.DEV) {
        console.debug('[local voice] audio chunk sent', {
          sampleRate,
          samples: samples.length,
          bytes: samples.byteLength
        });
      }
      socket.send(
        JSON.stringify({
          type: 'transcription.start',
          audio: encoded,
          audio_encoding: 'float32-le-base64',
          sample_rate: sampleRate
        })
      );
    },
    synthesize(text, signal) {
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const abort = () => {
          pendingTts.delete(requestId);
          reject(new LocalVoiceError('KemeTone synthesis cancelled.', 'cancelled'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        pendingTts.set(requestId, {
          resolve: (value) => {
            signal?.removeEventListener('abort', abort);
            resolve(value);
          },
          reject: (error) => {
            signal?.removeEventListener('abort', abort);
            reject(error);
          }
        });
        if (socket.readyState !== WebSocket.OPEN) {
          pendingTts.delete(requestId);
          reject(new LocalVoiceError('Local voice service is not connected.'));
          return;
        }
        socket.send(JSON.stringify({ type: 'tts.synthesize', request_id: requestId, text }));
      });
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  };
}
