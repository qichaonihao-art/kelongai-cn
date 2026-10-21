export const WAN_EDIT_MODEL = 'wan3.0-video';
export const isWanEdit = job => job.model === WAN_EDIT_MODEL;
export const editProviderLabel = job => isWanEdit(job) ? '阿里云万相' : '火山';
export const editModelLabel = job => isWanEdit(job) ? '万相 3.0' : 'Seedance';
export const editMaxDuration = model => model === 'doubao-seedance-2-5-260628' ? 30 : 15;
export function buildWanEditPayload(job, prompt, videoUrl, imageUrl) {
  return {
    model: WAN_EDIT_MODEL,
    input: { prompt, media: [{ type: 'reference_video', url: videoUrl }, ...(imageUrl ? [{ type: 'reference_image', url: imageUrl }] : [])] },
    parameters: { resolution: job.resolution.toUpperCase(), ratio: 'adaptive', duration: -1,
      audio: job.audioMode !== 'silent' && (job.audioMode !== 'preserve' || job.sourceHasAudio),
      prompt_extend: false, watermark: false },
  };
}
export function normalizeWanEditTask(payload) {
  const output = payload?.output || {};
  return { status: String(output.task_status || '').toLowerCase(), videoUrl: output.video_url || '',
    errorMessage: output.message || payload.message || '', payload,
    originalPrompt: output.orig_prompt || '',
    createdAt: output.submit_time ? Date.parse(output.submit_time.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(output.submit_time) ? '' : '+08:00')) / 1000 : undefined };
}
