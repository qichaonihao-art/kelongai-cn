import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_SENTENCES = 120;
const TTL_MS = 2 * 60 * 60 * 1000;
const idPattern = /^[a-f0-9]{24}$/;

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function applyCopyEdits(sentences, edits) {
  if (!Array.isArray(edits) || edits.length > MAX_SENTENCES) throw fail('文案修改结果格式无效', 502);
  const byIndex = new Map();
  for (const entry of edits) {
    const index = Number(entry?.index);
    if (!Number.isInteger(index) || index < 0 || index >= sentences.length || byIndex.has(index)) {
      throw fail('模型返回了重复或不存在的句子编号，请人工检查', 422);
    }
    if (!Array.isArray(entry.patches) || entry.patches.length > 8) throw fail('模型返回的替换项无效', 422);
    byIndex.set(index, entry.patches);
  }
  return sentences.map((sentence, index) => {
    const original = sentence.text;
    let revised = original;
    const changes = [];
    for (const patch of byIndex.get(index) || []) {
      const from = String(patch?.from || '');
      const to = String(patch?.to || '');
      if (!from || !to || from === to || !revised.includes(from) || revised.split(from).length !== 2) {
        throw fail(`第 ${index + 1} 句的替换无法准确定位，请人工检查`, 422);
      }
      revised = revised.replace(from, to);
      changes.push({ from, to });
    }
    const lengthRatio = original.length ? revised.length / original.length : 1;
    return {
      ...sentence, original, revised, changes,
      needsReview: lengthRatio < 0.78 || lengthRatio > 1.22 || changes.length > 3,
    };
  });
}

export function normalizeCopySentences(raw, duration) {
  if (!Array.isArray(raw) || raw.length > MAX_SENTENCES) throw fail('语音句子过多，请先截短素材', 422);
  const result = raw.map((s) => ({
    text: String(s?.text || '').trim(),
    speakerId: String(s?.speaker_id ?? '0'),
    start: Number(s?.begin_time) / 1000,
    end: Number(s?.end_time) / 1000,
  })).filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  result.sort((a, b) => a.start - b.start);
  if (!result.length || result.some((s, i) => s.start < 0 || s.end > duration + 0.4 || (i && s.start < result[i - 1].end - 0.05))) {
    throw fail('转写时间轴缺失或有多人同时说话，请先人工整理素材', 422);
  }
  return result;
}

export function createCopyTransferService({ uploadTempDir, voiceService, exec, editText, probeDuration, scheduleCleanup }) {
  const plans = new Map();
  const outputs = new Map();

  async function analyze(body) {
    const sourceId = String(body?.sourceId || '');
    if (!idPattern.test(sourceId)) throw fail('素材编号无效');
    const target = body?.target || {};
    const fields = ['sourceProduct', 'name', 'usage', 'material', 'scenes', 'instructions'];
    const profile = Object.fromEntries(fields.map((field) => [field, String(target[field] || '').trim().slice(0, 500)]));
    if (!profile.name || !profile.usage) throw fail('请填写目标产品名称和使用方式');
    const separated = await voiceService.separateForCopy({ sourceId, scene: 'Narrate' });
    if (separated.musicId && !existsSync(path.join(uploadTempDir, `${separated.musicId}_vt_music.wav`))) {
      throw fail('原背景音乐暂不可用，请重新分析', 422);
    }
    const sentences = normalizeCopySentences(separated.sentences, separated.endSeconds);
    const edits = await editText({ sentences, profile });
    const revised = applyCopyEdits(sentences, edits);
    const speakerMap = new Map(separated.speakers.map((sp) => [String(sp.speakerId), sp]));
    const needsReview = separated.speakers.length > 1 || revised.some((s) => s.needsReview || (s.changes.length && (!speakerMap.has(s.speakerId) || speakerMap.get(s.speakerId).durationSeconds < 3)));
    const planId = randomBytes(12).toString('hex');
    const plan = {
      sourceId, planId, profile, sentences: revised, speakers: separated.speakers,
      vocalId: separated.vocalId, musicId: separated.musicId,
      duration: separated.endSeconds, expiresAt: Date.now() + TTL_MS,
    };
    plans.set(planId, plan);
    setTimeout(() => plans.delete(planId), TTL_MS).unref?.();
    return { planId, profile, sentences: revised, speakers: separated.speakers.map(({ speakerId, label, durationSeconds, vocalUrl }) => ({ speakerId, label, durationSeconds, vocalUrl })), needsReview, duration: plan.duration };
  }

  async function render(body, req) {
    const planId = String(body?.planId || '');
    const plan = plans.get(planId);
    if (!plan || plan.expiresAt < Date.now()) throw fail('预览已过期，请重新分析素材', 410);
    const vocalPath = path.join(uploadTempDir, `${plan.vocalId}_vt_vocal.wav`);
    const musicPath = plan.musicId ? path.join(uploadTempDir, `${plan.musicId}_vt_music.wav`) : '';
    if (!existsSync(vocalPath) || (musicPath && !existsSync(musicPath))) throw fail('音轨已过期，请重新分析素材', 410);
    const revisions = body?.revisions;
    if (!Array.isArray(revisions) || revisions.length !== plan.sentences.length) throw fail('请先检查全部文案');
    const edited = plan.sentences.map((sentence, index) => {
      const revised = String(revisions[index] || '').trim();
      if (!revised || revised.length > 300 || revised.length > sentence.original.length * 1.35 + 5) {
        throw fail(`第 ${index + 1} 句长度不适合原音轨，请缩短后重试`, 422);
      }
      return { ...sentence, revised };
    });
    const replacements = [];
    for (const sentence of edited) {
      if (sentence.original === sentence.revised) continue;
      const speaker = plan.speakers.find((sp) => String(sp.speakerId) === sentence.speakerId);
      if (!speaker || speaker.durationSeconds < 3) throw fail('说话人样本不足 3 秒，请换一段清晰原声素材', 422);
      const generated = await voiceService.synthesizeMp3({ vocalId: speaker.vocalId, text: sentence.revised }, req);
      const audioPath = path.join(uploadTempDir, path.basename(new URL(generated.audioUrl, 'http://localhost').pathname));
      const length = await probeDuration(audioPath);
      const slot = sentence.end - sentence.start;
      const tempo = length / slot;
      if (!Number.isFinite(tempo) || tempo < 0.85 || tempo > 1.15) {
        throw fail(`「${sentence.original.slice(0, 18)}」新语音时长与原句相差过大，请调整字数后重试`, 422);
      }
      replacements.push({ ...sentence, audioPath, tempo });
    }
    const outputId = randomBytes(12).toString('hex');
    const outputPath = path.join(uploadTempDir, `${outputId}_copy_transfer.mp3`);
    // Keep the source music on its original timeline. Unchanged vocal windows are
    // copied exactly; only revised sentence windows use synthesized voice.
    const inputs = ['-i', vocalPath];
    if (musicPath) inputs.push('-i', musicPath);
    for (const replacement of replacements) inputs.push('-i', replacement.audioPath);
    const filters = [musicPath ? '[1:a]aresample=24000,volume=0.9[bed]' : `anullsrc=r=24000:cl=mono,atrim=duration=${plan.duration.toFixed(3)}[bed]`];
    const parts = ['[bed]'];
    let cursor = 0;
    let clipIndex = 0;
    const addOriginal = (start, end) => {
      if (end - start < 0.025) return;
      const label = `orig${clipIndex++}`;
      const span = end - start;
      filters.push(`[0:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.015,afade=t=out:st=${Math.max(0, span - 0.015).toFixed(3)}:d=0.015,adelay=${Math.round(start * 1000)}:all=1[${label}]`);
      parts.push(`[${label}]`);
    };
    replacements.forEach((replacement, index) => {
      addOriginal(cursor, replacement.start);
      const label = `new${index}`;
      const span = replacement.end - replacement.start;
      filters.push(`[${index + (musicPath ? 2 : 1)}:a]aresample=24000,atempo=${replacement.tempo.toFixed(5)},atrim=duration=${span.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.015,afade=t=out:st=${Math.max(0, span - 0.015).toFixed(3)}:d=0.015,adelay=${Math.round(replacement.start * 1000)}:all=1[${label}]`);
      parts.push(`[${label}]`);
      cursor = replacement.end;
    });
    addOriginal(cursor, plan.duration);
    filters.push(`${parts.join('')}amix=inputs=${parts.length}:duration=longest:normalize=0,apad,atrim=duration=${plan.duration.toFixed(3)},alimiter=limit=0.95[out]`);
    await exec('ffmpeg', [
      '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]',
      '-c:a', 'libmp3lame', '-b:a', '192k', outputPath,
    ], { timeout: 3 * 60 * 1000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
    scheduleCleanup(outputPath);
    const fileName = `${plan.profile.name.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 36)}_${plan.sourceId.slice(0, 6)}.mp3`;
    outputs.set(outputId, { outputPath, fileName, expiresAt: Date.now() + TTL_MS });
    setTimeout(() => outputs.delete(outputId), TTL_MS).unref?.();
    return {
      outputId,
      audioUrl: `/uploads/${path.basename(outputPath)}`,
      fileName,
      duration: plan.duration, size: (await stat(outputPath)).size,
    };
  }

  async function bundle(body) {
    const ids = body?.outputIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw fail('请选择已生成的 MP3');
    const items = ids.map((id) => outputs.get(String(id)));
    if (items.some((item) => !item || item.expiresAt < Date.now() || !existsSync(item.outputPath))) {
      throw fail('部分音频已过期，请重新生成后下载', 410);
    }
    const bundleId = randomBytes(12).toString('hex');
    const folder = path.join(uploadTempDir, `${bundleId}_copy_package`);
    const archive = path.join(uploadTempDir, `${bundleId}_copy_package.tar.gz`);
    await mkdir(folder);
    try {
      const names = [];
      for (const [index, item] of items.entries()) {
        const name = `${String(index + 1).padStart(3, '0')}_${item.fileName}`;
        await link(item.outputPath, path.join(folder, name));
        names.push(name);
      }
      await exec('tar', ['-czf', archive, '-C', folder, ...names], { timeout: 3 * 60 * 1000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
      scheduleCleanup(archive);
      return { archiveUrl: `/uploads/${path.basename(archive)}`, fileName: '文案转移_MP3合集.tar.gz' };
    } finally { await rm(folder, { recursive: true, force: true }); }
  }

  return { analyze, render, bundle };
}
