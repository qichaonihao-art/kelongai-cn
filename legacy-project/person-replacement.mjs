import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, copyFile, rename, stat, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const PERSON_MODELS = ['doubao-seedance-2-0-260128', 'doubao-seedance-2-5-260628'];
export function validatePersonOptions(body) {
  const model = String(body.model || PERSON_MODELS[0]);
  const resolution = String(body.resolution || '720p');
  const audioMode = String(body.audioMode || 'preserve');
  const prompt = String(body.prompt || '').trim();
  const dialogue = ['rewrite', 'new-voice'].includes(audioMode) ? String(body.dialogue || '').trim() : '';
  const voiceDescription = audioMode === 'new-voice' ? String(body.voiceDescription || '').trim() : '';
  const requestId = String(body.creationRequestId || '');
  if (!PERSON_MODELS.includes(model)) throw new Error('人物替换请选择 Seedance 2.0 或 2.5');
  if (!(model === PERSON_MODELS[1] ? ['720p'] : ['480p', '720p']).includes(resolution)) throw new Error('人物替换支持480P或720P');
  if (!['preserve', 'rewrite', 'new-voice', 'silent', 'generate'].includes(audioMode)) throw new Error('请选择有效的声音模式');
  if (['rewrite', 'new-voice'].includes(audioMode) && (!dialogue || dialogue.length > 2000)) throw new Error('请填写新台词，最多2000字');
  if (voiceDescription.length > 500) throw new Error('音色描述最多500字');
  if (!prompt || prompt.length > 6000) throw new Error('请填写人物替换要求，最多6000字');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) throw new Error('缺少有效的提交编号，请刷新后重试');
  return { model, resolution, audioMode, prompt, dialogue, voiceDescription, requestId };
}
export function buildPersonPrompt(job) {
  let audioRule;
  if (job.audioVersion !== 2) audioRule = job.audioMode === 'generate' ? '按用户要求生成声音，涉及口播时保持口型与台词同步。' : '生成画面保持完整，不因声音设置删改镜头或动作；本次不生成声音，音轨将在生成后处理。';
  else if (job.audioMode === 'preserve') audioRule = job.sourceHasAudio
    ? '只替换人物形象，原视频的台词、音色、说话语气、语速、停顿、背景音乐、环境声和音效均保持不变。让新人物的口型与原视频人声逐字同步，不增删或改写台词，不增加新的配音或背景音乐。'
    : '原视频没有音轨，输出保持静音，不新增台词、配音、背景音乐或音效。';
  else if (job.audioMode === 'rewrite') audioRule = `将视频1中唯一主要人物的人声作为原音色参考，沿用其声线、音色、口音与自然表达方式，但把原台词完整替换为下方新台词。只说新台词，不混入、重复或朗读原视频旧台词，不增删或同义改写新台词。人物嘴部和必要的说话微表情必须按新台词的实际发音重新同步，不沿用旧台词口型。尽量保留原来的背景音乐、环境声、音效及主要肢体动作，不添加新配乐。\n新台词：\n${job.dialogue}\n新台词结束。台词仅用于发声和口型，不作为画面字幕，也不得根据台词增添场景、商品或剧情。`;
  else if (job.audioMode === 'new-voice') audioRule = `不继承视频1的原人声音色，也不沿用原台词。为替换后的新人物生成新的自然人声。目标音色：${job.voiceDescription || '结合本次人物要求，为新人物匹配自然合适的声音，不沿用原人物声线'}。音色描述只决定声音，不得反过来改变用户指定的人物外貌或性别。只说下方完整新台词，不增删或同义改写，不混入或重复原视频旧台词。人物口型和必要的说话微表情必须根据新声音和新台词的实际发音重新同步，不沿用原台词口型。尽量保留原来的背景音乐、环境声、音效和主要肢体动作，不额外添加配乐。\n新台词：\n${job.dialogue}\n新台词结束。音色描述不朗读，台词不转成字幕，不根据台词增添场景、商品或剧情。`;
  else if (job.audioMode === 'silent') audioRule = '本次输出静音，不生成台词、配音、背景音乐或音效；画面和动作保持完整。';
  else audioRule = '按用户要求生成声音，涉及口播时保持口型与台词同步。';
  return `编辑视频1，替换其中唯一的主要人物，并生成面部自然可见的新人物成片。
【输入视频与成片的区别】
视频1中脸部的马赛克、像素块、模糊或遮脸层，是上传前添加的临时预处理，不是人物外貌、服装、原片特效或成片风格，不属于需要保留的画面内容。视频1提供镜头、构图、主要肢体动作、朝向、节奏、场景和按下述声音要求使用的音频；它的脸部打码不作为新人物的视觉参考。
${job.hasPortrait ? '图片1决定新人物的面部与外观，结合本次人物要求生成自然的新脸，不继承视频1的脸部打码。' : '根据本次人物要求生成一个外观连贯的新人物和新的自然面部，不尝试识别或还原原人物被遮住的身份。'}
本次人物要求：${job.prompt}
【人物替换与保留范围】
替换范围明确包括新人物的全部可见面部，以及原来覆盖在该人物脸部并随脸移动的打码区域。每个能看见新人物面部的画面，都应呈现符合原机位、朝向、距离和光线的自然新脸；可见的眼睛、鼻子、嘴部及皮肤纹理连贯，眨眼与表情自然。转头、侧脸、移动和说话期间，新脸保持身份一致，面部遮罩不随人物继续保留。
“其他不变”“保持原样”等约束仅适用于替换范围以外的内容，明确不适用于原人物脸部打码；清除该打码并生成新脸是本次必须完成的编辑。保留真实的手部、头发或道具遮挡，保持原来的正面、侧面或背面朝向；不为展示面部而强行转头、改变机位、推近镜头或增加特写。
保持原视频镜头数量、镜头先后、机位、构图、主要肢体动作顺序、整体节奏和时长，尽量保持背景、家具、商品及手部接触关系不变。除人物替换、脸部打码清除和下述声音编辑外，不增加其他改动。肢体、手指与商品接触合理，不新增人物、道具、镜头、字幕或水印。
声音与口型要求：${audioRule}
【成片面部要求】最终视频展示的是新的自然人物面部，不复制、保留或重新添加输入视频的人脸马赛克、像素方块、模糊遮脸、遮脸贴片、黑条或面部遮罩，也不能把这些遮挡当作新人物的一部分。面部清晰度符合原片景别和景深，保持真实遮挡及原有镜头，不强行锐化或放大面部。`;
}

// One durable row owns both external task IDs. Never automatically repeat an ambiguous paid POST.
export function createPersonReplacementService(deps) {
  const { getDb, root, probe, exec, getConfig, fetchTask } = deps;
  const fetcher = deps.fetch || globalThis.fetch;
  let initialized = false;
  let running = false;
  let timer;
  const creating = new Set();
  function db() {
    const connection = getDb();
    if (!initialized) {
      connection.exec('CREATE TABLE IF NOT EXISTS person_replacement_jobs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL)');
      initialized = true;
    }
    return connection;
  }
  function get(id) {
    const row = db().prepare('SELECT data FROM person_replacement_jobs WHERE id = ?').get(id);
    return row ? JSON.parse(row.data) : null;
  }
  function byRequest(id) {
    const row = db().prepare('SELECT data FROM person_replacement_jobs WHERE request_id = ?').get(id);
    return row ? JSON.parse(row.data) : null;
  }
  function save(job, update = {}) {
    Object.assign(job, update, { updatedAt: Date.now() });
    db().prepare('UPDATE person_replacement_jobs SET data = ? WHERE id = ?').run(JSON.stringify(job), job.id);
    return job;
  }
  const filePath = (job, name) => path.join(root, job.id, name);
  const assetUrl = (job, name) => `${job.baseUrl}/api/person-replacement/media/${job.id}/${job.mediaToken}/${name}`;
  function view(job) {
    if (!job) return null;
    const { id, stage, error, notice, model, resolution, audioMode, prompt, dialogue, voiceDescription, createdAt, updatedAt, duration, hasPortrait, sourceName, ambiguous, failedStage } = job;
    return { id, stage, error, notice, model, resolution, audioMode, prompt, dialogue, voiceDescription, createdAt, updatedAt, duration, hasPortrait, sourceName, ambiguous: !!ambiguous,
      canRetry: stage === 'failed' && !ambiguous && failedStage !== 'uploading',
      videoUrl: stage === 'completed' ? assetUrl(job, 'result.mp4') : '',
      maskedVideoUrl: job.maskedReady ? assetUrl(job, 'masked.mp4') : '',
      generatedVideoUrl: job.generatedUrl ? assetUrl(job, 'generated.mp4') : '' };
  }
  function list() {
    return db().prepare('SELECT data FROM person_replacement_jobs ORDER BY rowid DESC LIMIT 50').all().map(row => view(JSON.parse(row.data)));
  }
  async function create(body, baseUrl) {
    const options = validatePersonOptions(body);
    const previous = byRequest(options.requestId);
    if (previous) return view(previous);
    const config = getConfig();
    if (!config.mediaKey || !config.seedanceKey) throw new Error('服务端需要配置 AI MediaKit 和 Seedance 的访问凭证');
    if (!/^https?:\/\//.test(baseUrl || '')) throw new Error('请先配置可公网访问的素材地址 PUBLIC_BASE_URL');
    const files = Array.isArray(body.files) ? body.files : [];
    const videos = files.filter(file => file.type?.startsWith('video/'));
    const images = files.filter(file => file.type?.startsWith('image/'));
    if (videos.length !== 1 || images.length > 1 || files.length !== videos.length + images.length) throw new Error('请上传1个单人原视频，最多搭配1张人物参考图');
    const video = videos[0];
    if (!/\.(mp4|mov)$/i.test(video.name) || video.size > 50 * 1024 * 1024) throw new Error('原视频请使用50MB以内的MP4或MOV');
    if (images[0] && (!['image/jpeg', 'image/png', 'image/webp'].includes(images[0].type) || images[0].size > 10 * 1024 * 1024)) throw new Error('人物参考图请使用10MB以内的JPG、PNG或WebP');
    const job = { ...options, audioVersion: 2, id: randomUUID(), mediaToken: randomUUID(), baseUrl: baseUrl.replace(/\/$/, ''), stage: 'uploading',
      createdAt: Date.now(), updatedAt: Date.now(), hasPortrait: !!images[0], sourceName: video.name, error: '', notice: '' };
    // Reserve before asynchronous file writes, so repeated clicks cannot create duplicate jobs.
    db().prepare('INSERT INTO person_replacement_jobs (id, request_id, data) VALUES (?, ?, ?)').run(job.id, job.requestId, JSON.stringify(job));
    creating.add(job.id);
    try {
      await mkdir(path.join(root, job.id), { recursive: true });
      await writeFile(filePath(job, 'source.mp4'), Buffer.from(await video.arrayBuffer()));
      const metadata = await probe(filePath(job, 'source.mp4'));
      const maxDuration = options.model === PERSON_MODELS[0] ? 15 : 30;
      if (metadata.durationSeconds < 4 || metadata.durationSeconds > maxDuration) throw new Error(`所选模型支持4-${maxDuration}秒视频，当前为${metadata.durationSeconds.toFixed(1)}秒，请先裁剪或切换模型`);
      if (Math.max(metadata.width, metadata.height) > 4096) throw new Error('原视频分辨率不能超过4K');
      job.sourceHasAudio = await hasAudio(filePath(job, 'source.mp4'));
      if (job.audioMode === 'rewrite' && !job.sourceHasAudio) throw new Error('原视频没有音轨，无法参考原音色，请使用含人声的原视频');
      if (images[0]) {
        job.portraitName = images[0].type === 'image/png' ? 'portrait.png' : images[0].type === 'image/webp' ? 'portrait.webp' : 'portrait.jpg';
        await writeFile(filePath(job, job.portraitName), Buffer.from(await images[0].arrayBuffer()));
      }
      save(job, { stage: 'queued', duration: metadata.durationSeconds, metadata });
      schedule(10);
    } catch (error) {
      save(job, { stage: 'failed', failedStage: 'uploading', error: error.message });
      throw error;
    } finally { creating.delete(job.id); }
    return view(job);
  }
  async function jsonRequest(url, options = {}) {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(60000) });
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.success === false) {
      const error = new Error(json?.error?.message || json?.error || json?.message || `服务请求失败（HTTP ${response.status}）`);
      // A 4xx definitively rejected the request; 5xx or missing/malformed success is ambiguous.
      error.definite = response.status >= 400 && response.status < 500;
      throw error;
    }
    if (!json) throw new Error('服务未返回有效结果，需核对任务是否已提交');
    return json;
  }
  async function hasAudio(file) {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'json', file], { timeout: 30000 });
    return (JSON.parse(String(stdout || '{}')).streams || []).some(stream => stream.codec_type === 'audio');
  }
  async function download(url, destination) {
    if (!/^https?:\/\//i.test(url)) throw new Error('上游没有返回有效的视频地址');
    const response = await fetcher(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error(`视频下载失败（HTTP ${response.status}）`);
    let bytes = 0;
    const limit = new Transform({ transform(chunk, encoding, done) {
      bytes += chunk.length;
      done(bytes > 100 * 1024 * 1024 ? new Error('处理结果超过100MB') : null, chunk);
    } });
    const temporary = `${destination}.partial`;
    try {
      await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(temporary));
      await probe(temporary);
      await rename(temporary, destination);
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  async function submit(job, kind, url, payload, key) {
    const stage = kind === 'blur' ? 'submitting_blur' : 'submitting_generation';
    save(job, { stage });
    try {
      const result = await jsonRequest(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const externalId = kind === 'blur' ? result.task_id : result.id || result.data?.id || result.task_id;
      if (!externalId) throw new Error('服务未返回任务编号，需核对是否已提交');
      save(job, kind === 'blur' ? { stage: 'blurring', blurTaskId: externalId } : { stage: 'generating', generationTaskId: externalId });
    } catch (error) {
      save(job, { stage: 'failed', failedStage: stage, ambiguous: !error.definite,
        error: error.definite ? error.message : `${error.message}。提交结果未确认，为避免重复扣费，不会自动重新提交，请先在火山后台核对。` });
    }
  }
  async function step(job) {
    const config = getConfig();
    const headers = { Authorization: `Bearer ${config.mediaKey}` };
    if (job.stage === 'queued') {
      // MediaKit requires 25-60fps; normalize only when the source falls outside this range.
      if (!(job.metadata.fps >= 25 && job.metadata.fps <= 60)) {
        save(job, { stage: 'normalizing' });
        await exec('ffmpeg', ['-y', '-i', filePath(job, 'source.mp4'), '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', filePath(job, 'input.mp4')], { timeout: 180000 });
      }
      return submit(job, 'blur', `${config.mediaBase}/api/v1/tools/face-blur-video`, {
        video_url: assetUrl(job, job.stage === 'normalizing' ? 'input.mp4' : 'source.mp4'), mask_mode: 'mosaic', mask_strength: 'medium',
      }, config.mediaKey);
    }
    if (job.stage === 'blurring') {
      const result = await jsonRequest(`${config.mediaBase}/api/v1/tasks/${encodeURIComponent(job.blurTaskId)}`, { headers });
      const task = result.data || result;
      task.status = String(task.status || '').toLowerCase();
      if (['failed', 'cancelled', 'canceled', 'expired'].includes(task.status)) {
        save(job, { stage: 'failed', failedStage: 'blurring', error: task.error?.message || task.error_message || task.message || '人脸打码失败', blurTaskFailed: true });
      } else if (task.status === 'completed') {
        const url = task.result?.video_url;
        if (!url) throw new Error('人脸打码任务完成，但未返回视频地址');
        save(job, { stage: 'saving_mask', maskDownloadUrl: url });
      }
      return;
    }
    if (job.stage === 'saving_mask') {
      await download(job.maskDownloadUrl, filePath(job, 'masked.mp4'));
      // Keep the source voice available to the model even if MediaKit returns only masked video.
      if (job.audioVersion === 2 && job.sourceHasAudio && !await hasAudio(filePath(job, 'masked.mp4'))) {
        await exec('ffmpeg', ['-y', '-i', filePath(job, 'masked.mp4'), '-i', filePath(job, 'source.mp4'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', filePath(job, 'masked-audio.mp4')], { timeout: 180000 });
        await rename(filePath(job, 'masked-audio.mp4'), filePath(job, 'masked.mp4'));
      }
      const info = await stat(filePath(job, 'masked.mp4'));
      if (info.size > 50 * 1024 * 1024) throw new Error('打码结果超过模型50MB限制，请缩短视频后再试');
      save(job, { stage: 'ready', maskedReady: true });
      return;
    }
    if (job.stage === 'ready') {
      const content = [{ type: 'text', text: buildPersonPrompt(job) }, { type: 'video_url', video_url: { url: assetUrl(job, 'masked.mp4') }, role: 'reference_video' }];
      if (job.hasPortrait) content.push({ type: 'image_url', image_url: { url: assetUrl(job, job.portraitName) }, role: 'reference_image' });
      return submit(job, 'generation', 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
        model: job.model, content, duration: job.model === PERSON_MODELS[1] ? -1 : Math.max(4, Math.min(15, Math.ceil(job.duration))),
        ...(job.model === PERSON_MODELS[1] ? { omni_reference_task_type: 'edit' } : {}),
        ratio: 'adaptive', resolution: job.resolution, generate_audio: job.audioVersion === 2
          ? job.audioMode !== 'silent' && (job.audioMode !== 'preserve' || job.sourceHasAudio)
          : job.audioMode === 'generate', watermark: false,
      }, config.seedanceKey);
    }
    if (job.stage === 'generating') {
      const task = await fetchTask(job.generationTaskId);
      if (['failed', 'cancelled', 'canceled', 'expired'].includes(String(task.status).toLowerCase())) {
        save(job, { stage: 'failed', failedStage: 'generating', generationTaskFailed: true, error: task.errorMessage || '人物替换生成失败' });
      } else if (task.videoUrl) save(job, { stage: 'finalizing', generatedUrl: task.videoUrl });
      return;
    }
    if (job.stage === 'finalizing') {
      await download(job.generatedUrl, filePath(job, 'generated.mp4'));
      const generated = await probe(filePath(job, 'generated.mp4'));
      if (job.audioVersion === 2) {
        let notice = '';
        if (job.audioMode === 'silent' || (job.audioMode === 'preserve' && !job.sourceHasAudio)) {
          await exec('ffmpeg', ['-y', '-i', filePath(job, 'generated.mp4'), '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', filePath(job, 'result.partial.mp4')], { timeout: 180000 });
        } else if (await hasAudio(filePath(job, 'generated.mp4'))) {
          // Native audio and lips were generated together. Do not overwrite or retime them.
          await copyFile(filePath(job, 'generated.mp4'), filePath(job, 'result.partial.mp4'));
        } else if (job.audioMode === 'preserve') {
          if (Math.abs(generated.durationSeconds - job.duration) > .15) {
            save(job, { stage: 'failed', failedStage: 'generating', generationTaskFailed: true, error: '模型未返回声音，且时长与原片不一致，请查看生成画面后重试' });
            return;
          }
          await exec('ffmpeg', ['-y', '-i', filePath(job, 'generated.mp4'), '-i', filePath(job, 'source.mp4'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-t', String(generated.durationSeconds), '-movflags', '+faststart', filePath(job, 'result.partial.mp4')], { timeout: 180000 });
          notice = '模型未返回声音，已用原音轨补回，请检查口型是否匹配。';
        } else {
          save(job, { stage: 'failed', failedStage: 'generating', generationTaskFailed: true, error: '模型未返回要求的人声，请查看生成结果后重试；不会用旧音轨覆盖新台词。' });
          return;
        }
        await probe(filePath(job, 'result.partial.mp4'));
        await rename(filePath(job, 'result.partial.mp4'), filePath(job, 'result.mp4'));
        save(job, { stage: 'completed', error: '', notice });
        return;
      }
      // Legacy tasks retain their original audio policy across a server upgrade.
      // Follow the original timeline; do not loop or stretch the original voice track.
      if (Math.abs(generated.durationSeconds - job.duration) > 1.1) throw new Error('生成视频时长与原片差异过大，请查看生成结果后再处理');
      const args = ['-y', '-i', filePath(job, 'generated.mp4')];
      if (job.audioMode === 'preserve') args.push('-i', filePath(job, 'source.mp4'), '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-af', `apad=whole_dur=${job.duration}`);
      else if (job.audioMode === 'silent') args.push('-map', '0:v:0', '-c:v', 'copy', '-an');
      else args.push('-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy');
      if (generated.durationSeconds < job.duration) {
        const copyIndex = args.indexOf('-c:v');
        if (copyIndex >= 0) args.splice(copyIndex, 2);
        else { const codecIndex = args.indexOf('-c'); if (codecIndex >= 0) args.splice(codecIndex, 2, '-c:a', 'copy'); }
        args.push('-vf', `tpad=stop_mode=clone:stop_duration=${job.duration - generated.durationSeconds}`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18');
      }
      args.push('-t', String(job.duration), '-movflags', '+faststart', filePath(job, 'result.partial.mp4'));
      await exec('ffmpeg', args, { timeout: 180000 });
      await probe(filePath(job, 'result.partial.mp4'));
      await rename(filePath(job, 'result.partial.mp4'), filePath(job, 'result.mp4'));
      save(job, { stage: 'completed', error: '', notice: '' });
    }
  }
  async function tick() {
    if (running) return;
    running = true;
    try {
      const rows = db().prepare('SELECT data FROM person_replacement_jobs').all();
      // Bound concurrent media downloads/transcodes and provider requests.
      const pending = rows.map(row => JSON.parse(row.data)).filter(job => !['failed', 'completed'].includes(job.stage));
      for (let index = 0; index < pending.length; index += 2) await Promise.all(pending.slice(index, index + 2).map(async job => {
        if (creating.has(job.id)) return;
        if (['submitting_blur', 'submitting_generation'].includes(job.stage)) {
          save(job, { stage: 'failed', failedStage: job.stage, ambiguous: true, error: '服务重启时提交尚未确认，请先在火山后台核对，避免重复扣费。' }); return;
        }
        if (job.stage === 'uploading') { save(job, { stage: 'failed', failedStage: 'uploading', error: '原视频上传未完成，请重新上传' }); return; }
        if (job.stage === 'normalizing') save(job, { stage: 'queued' });
        const stage = job.stage;
        try { await step(job); if (!['failed', 'completed'].includes(job.stage)) save(job, { pollErrors: 0, notice: '' }); }
        catch (error) {
          if (['blurring', 'generating'].includes(stage) && (job.pollErrors || 0) < 20) save(job, { pollErrors: (job.pollErrors || 0) + 1, notice: `查询暂未成功，正在继续查询：${error.message}` });
          else save(job, { stage: 'failed', failedStage: stage, error: error.message });
        }
      }));
    } finally { running = false; }
  }
  function schedule(delay = 10000) {
    if (timer) return;
    timer = setTimeout(async () => { timer = null; try { await tick(); } catch (error) { console.error('[person replacement]', error.message); } schedule(); }, delay);
    timer.unref?.();
  }
  function retry(id) {
    const job = get(id);
    if (!job) throw new Error('任务不存在');
    if (job.stage !== 'failed') return view(job);
    if (job.ambiguous) throw new Error('提交结果未确认，请先在火山后台核对，不可重复提交');
    if (job.failedStage === 'uploading') throw new Error('上传未完成，请重新上传');
    let stage;
    if (job.generationTaskId && !job.generationTaskFailed) stage = 'generating';
    else if (job.generatedUrl && !job.generationTaskFailed) stage = 'finalizing';
    else if (job.maskedReady) stage = 'ready';
    else if (job.blurTaskId && !job.blurTaskFailed) stage = 'blurring';
    else stage = 'queued';
    save(job, { stage, error: '', notice: '', pollErrors: 0,
      ...(stage === 'ready' ? { generationTaskId: '', generatedUrl: '' } : {}),
      ...(stage === 'queued' ? { blurTaskId: '', maskDownloadUrl: '' } : {}),
      generationTaskFailed: false, blurTaskFailed: false });
    schedule(10);
    return view(job);
  }
  async function media(req, res, id, token, name) {
    const job = get(id);
    if (!job || token !== job.mediaToken || !['source.mp4', 'input.mp4', 'masked.mp4', 'result.mp4', 'generated.mp4', 'portrait.jpg', 'portrait.png', 'portrait.webp'].includes(name)) { res.writeHead(404); res.end(); return; }
    try {
      const destination = filePath(job, name);
      const info = await stat(destination);
      let start = 0, end = info.size - 1;
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
      }
      const type = name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      res.writeHead(range ? 206 : 200, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
      if (req.method === 'HEAD') res.end();
      else { const stream = createReadStream(destination, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  }
  return { create, get: id => view(get(id)), byRequest: id => view(byRequest(id)), list, retry, media, tick, start: () => schedule(100), stop: () => { clearTimeout(timer); timer = null; },
    async resultFile(id) { const job = get(id); if (!job || job.stage !== 'completed') throw new Error('视频尚未完成'); return { path: filePath(job, 'result.mp4'), name: `人物替换-${job.sourceName.replace(/\.[^.]+$/, '')}.mp4`, model: job.model, prompt: job.prompt }; } };
}
