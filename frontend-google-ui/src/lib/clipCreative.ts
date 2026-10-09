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
  return CLIP_PRODUCT_OPTIONS.some(([value]) => value === type)
    ? type as ReplacementProductType : mode === 'replace' ? 'hanging' : 'generic';
}

// 直接反推以原片为准，类型只帮助识别，不能套入换款结构或固定广告框架。
export function directProductContext(type: ReplacementProductType): string {
  if (type === 'generic') return '';
  const name = CLIP_PRODUCT_OPTIONS.find(([value]) => value === type)![1];
  return `【原视频产品类型：${name}】\n本次只反推原视频实际可见的产品、材质、结构和动作。所选类型仅用于识别，不为原片补造看不到的背面、支架、背胶、挂绳或尺寸，不套用其他产品的展开、揭膜或拆装动作，不套用AI素材40个固定框架。若选择与原片明显不符，指出差异并仍以原片为准。\n`;
}
