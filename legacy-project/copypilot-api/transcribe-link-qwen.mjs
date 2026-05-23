import { extractByUrl, json } from './_tikhub.js';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const QWEN_ASR_MODEL = 'qwen3-asr-flash';
const QWEN_ASR_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MAX_AUDIO_DURATION_SECONDS = 600;
const FFMPEG_TIMEOUT_MS = 120_000;
const QWEN_TIMEOUT_MS = 300_000;

async function extractAudioFromUrl(videoUrl, outputPath) {
  const headers = [
    'Referer: https://www.douyin.com/',
    'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  ].join('\r\n') + '\r\n';

  await execFileAsync('ffmpeg', [
    '-y',
    '-headers', headers,
    '-i', videoUrl,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-b:a', '32k',
    '-f', 'mp3',
    '-t', String(MAX_AUDIO_DURATION_SECONDS),
    outputPath,
  ], { timeout: FFMPEG_TIMEOUT_MS });
}

async function transcribeWithQwen(audioPath) {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.ALIYUN_API_KEY || '';
  if (!apiKey) {
    throw new Error('服务端未配置 DashScope API Key');
  }

  const audioBuffer = await readFile(audioPath);
  const base64Audio = audioBuffer.toString('base64');
  const dataUri = `data:audio/mp3;base64,${base64Audio}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);

  try {
    const response = await fetch(QWEN_ASR_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: QWEN_ASR_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: dataUri }
              }
            ]
          }
        ],
        stream: false,
        asr_options: {
          language: 'zh',
          enable_itn: false
        }
      })
    });

    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    if (!response.ok) {
      const errorMsg = responseJson?.error?.message || responseJson?.message || `HTTP ${response.status}`;
      throw new Error(`千问 ASR 返回错误：${errorMsg}`);
    }

    return responseJson?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const tikhubKey = env.TIKHUB_API_KEY;
  const tikhubBaseUrl = env.TIKHUB_BASE_URL || 'https://api.tikhub.io';

  if (!tikhubKey) {
    return json({ ok: false, message: '提取服务暂未配置完成。' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求格式不正确。' }, 400);
  }

  const url = String(body.url || '').trim();
  if (!url) return json({ ok: false, message: '缺少作品链接。' }, 400);

  const tempDir = await mkdtemp(join(tmpdir(), 'cp-qwen-'));

  try {
    // 1. Extract video info via TikHub
    const sourceData = await extractByUrl({ apiKey: tikhubKey, baseUrl: tikhubBaseUrl, url });

    // 2. Fastest path: subtitles
    const subtitleUrl = getSubtitleLinks(sourceData)[0];
    if (subtitleUrl) {
      const subtitleText = await fetchSubtitleText(subtitleUrl);
      if (subtitleText) {
        return json({
          ok: true,
          data: {
            ...sourceData,
            text: subtitleText,
            transcript: subtitleText,
            publishedText: getPublishedText(sourceData),
            transcriptSource: 'subtitle'
          }
        });
      }
    }

    // 3. Get video URL
    const videoUrl = getVideoLinks(sourceData)[0];
    if (!videoUrl) {
      return json({
        ok: false,
        message: '已解析作品信息，但没有拿到可转写的视频源。',
        data: sourceData
      }, 502);
    }

    // 4. Extract audio directly from URL with FFmpeg (no full video download)
    const audioPath = join(tempDir, 'audio.mp3');
    await extractAudioFromUrl(videoUrl, audioPath);

    // 5. Transcribe with Qwen ASR
    const transcript = await transcribeWithQwen(audioPath);

    const publishedText = getPublishedText(sourceData);

    return json({
      ok: true,
      data: {
        ...sourceData,
        text: transcript,
        transcript: transcript,
        publishedText,
        transcriptSource: 'qwen-asr'
      }
    });
  } catch (error) {
    return json({ ok: false, message: error.message || '转写失败' }, 502);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Helpers copied from transcribe-link.js
function getVideoLinks(data) {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data || {};
  const video = detail.video || data?.video || {};
  const links = [];

  if (video.play_addr?.url_list?.length) links.push(...video.play_addr.url_list);
  if (video.download_addr?.url_list?.length) links.push(...video.download_addr.url_list);
  if (detail.video_url) links.push(detail.video_url);
  if (data?.video_url) links.push(data.video_url);
  if (data?.videos?.items?.length) {
    const sortedVideos = [...data.videos.items].sort((a, b) => Number(b.hasAudio) - Number(a.hasAudio));
    links.push(...sortedVideos.map((item) => item.url));
  }
  return [...new Set(links)].filter(Boolean);
}

function getSubtitleLinks(data) {
  const items = data?.subtitles?.items || data?.subtitle?.items || data?.captions?.items || [];
  return items
    .map((item) => typeof item === 'string' ? item : item?.url)
    .filter(Boolean);
}

async function fetchSubtitleText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    }
  });
  if (!response.ok) return '';
  const raw = await response.text();
  return parseSubtitleText(raw);
}

function parseSubtitleText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  try {
    const payload = JSON.parse(text);
    const events = payload.events || payload.body?.events || [];
    const lines = events
      .flatMap((event) => event.segs || event.segments || [])
      .map((seg) => seg.utf8 || seg.text || '')
      .join('')
      .split(/\n+/)
      .map(cleanSubtitleLine)
      .filter(Boolean);
    if (lines.length) return dedupeLines(lines).join('\n');
  } catch {
    // XML subtitle format is handled below.
  }

  const xmlLines = [...text.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => cleanSubtitleLine(decodeEntities(match[1])))
    .filter(Boolean);
  if (xmlLines.length) return dedupeLines(xmlLines).join('\n');

  return cleanSubtitleLine(decodeEntities(text));
}

function cleanSubtitleLine(value) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeLines(lines) {
  const output = [];
  for (const line of lines) {
    if (line && line !== output[output.length - 1]) output.push(line);
  }
  return output;
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function getPublishedText(data) {
  return (
    data?.description ||
    data?.desc ||
    data?.caption ||
    data?.aweme_detail?.desc ||
    data?.itemInfo?.itemStruct?.desc ||
    data?.note?.desc ||
    ''
  );
}
