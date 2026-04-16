import type { ClonedVoice, VoicePlatform } from "@/src/lib/voice";

const VOICES_STORAGE_KEY = 'kelongai.savedVoices';
const ACTIVE_VOICE_ID_STORAGE_KEY = 'kelongai.activeVoiceId';
const VALID_PROVIDERS: VoicePlatform[] = ['zhipu', 'aliyun', 'volcengine', 'siliconflow'];

function isValidProvider(value: unknown): value is VoicePlatform {
  return typeof value === 'string' && VALID_PROVIDERS.includes(value as VoicePlatform);
}

function isValidVoice(value: unknown): value is ClonedVoice {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const voice = value as Record<string, unknown>;

  return (
    typeof voice.id === 'string' &&
    typeof voice.name === 'string' &&
    isValidProvider(voice.provider) &&
    typeof voice.providerLabel === 'string' &&
    typeof voice.remoteVoiceId === 'string' &&
    typeof voice.engineModel === 'string' &&
    typeof voice.createdAt === 'string' &&
    (voice.resourceId === undefined || typeof voice.resourceId === 'string')
  );
}

export function loadSavedVoices(): ClonedVoice[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(VOICES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isValidVoice);
  } catch {
    window.localStorage.removeItem(VOICES_STORAGE_KEY);
    return [];
  }
}

export function saveSavedVoices(voices: ClonedVoice[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(VOICES_STORAGE_KEY, JSON.stringify(voices));
}

export function loadActiveVoiceId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(ACTIVE_VOICE_ID_STORAGE_KEY);
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

export function saveActiveVoiceId(activeVoiceId: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!activeVoiceId) {
    window.localStorage.removeItem(ACTIVE_VOICE_ID_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(ACTIVE_VOICE_ID_STORAGE_KEY, activeVoiceId);
}
