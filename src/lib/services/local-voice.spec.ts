import { describe, expect, it } from 'vitest';
import {
  LOCAL_VOICE_DEFAULT_URL,
  buildLocalVoiceUrl,
  normalizeLocalVoiceProvider,
  type LocalVoiceProviderMode
} from './local-voice';

describe('local voice provider', () => {
  it('uses a localhost websocket URL by default', () => {
    expect(LOCAL_VOICE_DEFAULT_URL).toBe('ws://127.0.0.1:8765/ws/voice');
    expect(buildLocalVoiceUrl()).toBe(LOCAL_VOICE_DEFAULT_URL);
    expect(buildLocalVoiceUrl('http://127.0.0.1:9000')).toBe('ws://127.0.0.1:9000/ws/voice');
  });

  it('accepts only supported provider modes', () => {
    expect(normalizeLocalVoiceProvider('local')).toBe('local');
    expect(normalizeLocalVoiceProvider('openai')).toBe('openai');
    expect(normalizeLocalVoiceProvider('other' as LocalVoiceProviderMode)).toBe('local');
  });
});
