export type VoicePlatform = 'zhipu' | 'aliyun' | 'volcengine' | 'siliconflow';

export interface VoiceConfigStatus {
  reachable: boolean;
  zhipuApiKey: boolean;
  aliyunApiKey: boolean;
  siliconFlowApiKey: boolean;
  volcAppKey: boolean;
  volcAccessKey: boolean;
  volcSpeakerId: boolean;
  mockMode: boolean;
}

export interface ClonedVoice {
  id: string;
  name: string;
  provider: VoicePlatform;
  providerLabel: string;
  remoteVoiceId: string;
  engineModel: string;
  resourceId?: string;
  createdAt: string;
}

export interface GeneratedAudio {
  id: string;
  text: string;
  timestamp: string;
  duration: string;
  audioUrl: string;
  voiceName: string;
  providerLabel: string;
  engineModel: string;
}

export interface VoiceCredentials {
  apiKey?: string;
  speakerId?: string;
}

const ALIYUN_TARGET_MODEL = 'qwen3-tts-vc-realtime-2026-01-15';
const MOCK_ALIYUN_TARGET_MODEL = 'mock-cosyvoice';
const VOLC_RESOURCE_ID = 'seed-icl-2.0';
const SILICONFLOW_VOICE_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';
const SILICONFLOW_RESPONSE_FORMAT = 'wav';

async function parseJsonSafely(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readApiErrorMessage(json: any, fallback: string) {
  const parts = [
    typeof json?.error === 'string' ? json.error : '',
    typeof json?.detail === 'string' ? json.detail : '',
    typeof json?.upstreamBodySummary === 'string' ? json.upstreamBodySummary : '',
  ].filter(Boolean);

  return parts.length ? parts.join(' | ') : fallback;
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取音频文件失败，请重新选择文件。'));
    reader.readAsDataURL(file);
  });
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('读取音频文件失败，请重新选择文件。'));
    reader.readAsDataURL(file);
  });
}

function detectAudioFormat(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  if (extension === 'mp3' || extension === 'm4a' || extension === 'wav') {
    return extension;
  }
  return 'wav';
}

export async function getVoiceConfigStatus(): Promise<VoiceConfigStatus> {
  try {
    const response = await fetch('/api/config/status', {
      credentials: 'include',
    });
    const json = await parseJsonSafely(response);

    if (!response.ok) {
      throw new Error(json?.error || '读取服务端配置失败');
    }

    return {
      reachable: true,
      zhipuApiKey: !!json?.serverManaged?.zhipuApiKey,
      aliyunApiKey: !!json?.serverManaged?.aliyunApiKey,
      siliconFlowApiKey: !!json?.serverManaged?.siliconFlowApiKey,
      volcAppKey: !!json?.serverManaged?.volcAppKey,
      volcAccessKey: !!json?.serverManaged?.volcAccessKey,
      volcSpeakerId: !!json?.serverManaged?.volcSpeakerId,
      mockMode: !!json?.serverManaged?.voiceCloneMockMode,
    };
  } catch {
    return {
      reachable: false,
      zhipuApiKey: false,
      aliyunApiKey: false,
      siliconFlowApiKey: false,
      volcAppKey: false,
      volcAccessKey: false,
      volcSpeakerId: false,
      mockMode: false,
    };
  }
}

export async function createVoiceClone(options: {
  platform: VoicePlatform;
  file: File;
  preferredName: string;
  referenceText?: string;
  credentials?: VoiceCredentials;
  mockMode?: boolean;
}): Promise<ClonedVoice> {
  const { platform, file, preferredName, referenceText, credentials, mockMode = false } = options;

  if (platform === 'zhipu') {
    const audioData = await readFileAsDataUrl(file);
    const response = await fetch('/api/voice/zhipu', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: credentials?.apiKey || '',
        preferredName,
        audioData,
        fileName: file.name,
        sampleText: '你好，这是一个内部工具的试听文本。',
        mockMode,
      }),
    });
    const json = await parseJsonSafely(response);

    if (!response.ok) {
      throw new Error(readApiErrorMessage(json, '智谱音色创建失败'));
    }

    return {
      id: createId('voice'),
      name: preferredName,
      provider: 'zhipu',
      providerLabel: '智谱',
      remoteVoiceId: json?.voice || createId('zhipu_voice'),
      engineModel: 'glm-tts',
      createdAt: new Date().toLocaleString(),
    };
  }

  if (platform === 'aliyun') {
    const audioData = await readFileAsDataUrl(file);
    const targetModel = mockMode ? MOCK_ALIYUN_TARGET_MODEL : ALIYUN_TARGET_MODEL;
    const response = await fetch('/api/voice/aliyun', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: credentials?.apiKey || '',
        targetModel,
        preferredName,
        audioData,
        mockMode,
      }),
    });
    const json = await parseJsonSafely(response);

    if (!response.ok) {
      throw new Error(readApiErrorMessage(json, '阿里云音色创建失败'));
    }

    return {
      id: createId('voice'),
      name: preferredName,
      provider: 'aliyun',
      providerLabel: '阿里云',
      remoteVoiceId: json?.output?.voice || json?.voiceId || createId('aliyun_voice'),
      engineModel: targetModel,
      createdAt: new Date().toLocaleString(),
    };
  }

  if (platform === 'siliconflow') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', SILICONFLOW_VOICE_MODEL);
    formData.append('customName', preferredName);
    formData.append('text', referenceText || '');
    formData.append('response_format', SILICONFLOW_RESPONSE_FORMAT);

    const response = await fetch('/api/siliconflow/upload-voice', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const json = await parseJsonSafely(response);

    if (!response.ok) {
      throw new Error(readApiErrorMessage(json, 'SiliconFlow 参考音频上传失败'));
    }

    return {
      id: createId('voice'),
      name: preferredName,
      provider: 'siliconflow',
      providerLabel: 'SiliconFlow 声音克隆',
      remoteVoiceId: json?.uri || createId('siliconflow_voice'),
      engineModel: json?.model || SILICONFLOW_VOICE_MODEL,
      createdAt: new Date().toLocaleString(),
    };
  }

  const audioData = await readFileAsBase64(file);
  const response = await fetch('/api/voice/volcengine', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      speakerId: credentials?.speakerId || '',
      resourceId: VOLC_RESOURCE_ID,
      audioData,
      audioFormat: detectAudioFormat(file.name),
      mockMode,
    }),
  });
  const json = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(json?.error || json?.message || '火山引擎音色创建失败');
  }

  return {
    id: createId('voice'),
    name: preferredName,
    provider: 'volcengine',
    providerLabel: '火山引擎',
    remoteVoiceId: json?.speaker_id || credentials?.speakerId || createId('volc_voice'),
    engineModel: 'volcengine-voice-clone',
    resourceId: VOLC_RESOURCE_ID,
    createdAt: new Date().toLocaleString(),
  };
}

async function getAudioDurationLabel(audioUrl: string) {
  return new Promise<string>((resolve) => {
    const audio = new Audio(audioUrl);
    audio.preload = 'metadata';

    const finalize = (value: string) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      resolve(value);
    };

    audio.onloadedmetadata = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        finalize('未知时长');
        return;
      }

      const totalSeconds = Math.max(1, Math.round(audio.duration));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      finalize(`${minutes}:${String(seconds).padStart(2, '0')}`);
    };

    audio.onerror = () => finalize('未知时长');
  });
}

export async function generateSpeech(options: {
  voice: ClonedVoice;
  text: string;
  credentials?: VoiceCredentials;
  mockMode?: boolean;
}): Promise<GeneratedAudio> {
  const { voice, text, credentials, mockMode = false } = options;
  const endpoint = voice.provider === 'zhipu'
    ? '/api/tts/zhipu'
    : voice.provider === 'aliyun'
      ? '/api/tts/aliyun'
      : voice.provider === 'siliconflow'
        ? '/api/siliconflow/create-speech'
      : '/api/tts/volcengine';
  const payload = voice.provider === 'zhipu'
    ? {
        apiKey: credentials?.apiKey || '',
        voice: voice.remoteVoiceId,
        text,
        mockMode,
      }
    : voice.provider === 'aliyun'
      ? {
        apiKey: credentials?.apiKey || '',
        model: voice.engineModel,
        voice: voice.remoteVoiceId,
        text,
        mockMode,
      }
      : voice.provider === 'siliconflow'
        ? {
          model: voice.engineModel || SILICONFLOW_VOICE_MODEL,
          input: text,
          voice: voice.remoteVoiceId,
          response_format: SILICONFLOW_RESPONSE_FORMAT,
          mockMode,
        }
      : {
        speakerId: voice.remoteVoiceId,
        resourceId: voice.resourceId || VOLC_RESOURCE_ID,
        text,
        mockMode,
      };

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const json = await parseJsonSafely(response);
    throw new Error(readApiErrorMessage(json, `${voice.providerLabel} 语音生成失败`));
  }

  const blob = await response.blob();
  const audioUrl = URL.createObjectURL(blob);
  const duration = await getAudioDurationLabel(audioUrl);

  return {
    id: createId('audio'),
    text,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    duration,
    audioUrl,
    voiceName: voice.name,
    providerLabel: voice.providerLabel,
    engineModel: voice.engineModel,
  };
}
