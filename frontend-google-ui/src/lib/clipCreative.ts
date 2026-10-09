import type { ReplacementProductType } from './productReplacement';

export type ClipCreativeMode = 'direct' | 'replace';
export type ClipAudioMode = 'none' | 'original' | 'voice';
export const CLIP_PRODUCT_OPTIONS = [
  ['hanging', '挂画／卷轴'], ['sticker', '贴画'], ['ornament', '固定一体摆台'], ['generic', '其他产品／元素'],
] as const;

export interface ClipCreativePayload {
  file: File;
  previewUrl: string;
  serverMediaToken: string;
  productType?: ReplacementProductType;
  audioMode: ClipAudioMode;
  audioFile?: File;
  requiredImageFile?: File;
  audioDurationSeconds?: number;
}
export type IncomingCreativeClip = ClipCreativePayload & { mode: ClipCreativeMode; token: number };

export function resolveClipProductType(type: unknown, mode: ClipCreativeMode): ReplacementProductType {
  if (mode === 'direct') return 'generic';
  return CLIP_PRODUCT_OPTIONS.some(([value]) => value === type)
    ? type as ReplacementProductType : 'hanging';
}
