import { json } from './_tikhub.js';
import { recordUsage, requireQuota } from './_auth.js';

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  const text = String(body?.text || '').trim();
  const title = String(body?.title || '').trim();
  const template = String(body?.template || 'clean');
  const images = Array.isArray(body?.images) ? body.images.map((item) => String(item || '').trim()).filter(Boolean) : [];

  if (!text) {
    return json({ ok: false, message: '缺少文章正文。' }, 400);
  }

  const quota = await requireQuota(context, 'extract');
  if (!quota.ok) return json({ ok: false, message: quota.message, needLogin: quota.status === 401 }, quota.status);

  const localDraft = buildLocalDraft({ title, text, images, template });
  const apiKey = context.env.SILICONFLOW_API_KEY;
  const model = context.env.SILICONFLOW_CHAT_MODEL || context.env.SILICONFLOW_REWRITE_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
  const headers = quota.setCookie ? { 'Set-Cookie': quota.setCookie } : {};

  if (!apiKey) {
    await recordUsage(context, quota, {
      action: 'extract',
      resultTitle: title || localDraft.title || 'AI 二创排版',
      status: 'completed'
    });
    return json({ ok: true, data: { ...localDraft, aiUsed: false, fallbackReason: 'AI 服务未配置，已生成本地规则排版稿。' } }, 200, headers);
  }

  try {
    const aiDraft = await rewriteWithSiliconFlow({ apiKey, model, title, text, images, template });
    await recordUsage(context, quota, {
      action: 'extract',
      resultTitle: title || aiDraft.title || 'AI 二创排版',
      status: 'completed'
    });
    return json({ ok: true, data: { ...aiDraft, aiUsed: true } }, 200, headers);
  } catch (error) {
    await recordUsage(context, quota, {
      action: 'extract',
      resultTitle: title || localDraft.title || 'AI 二创排版',
      status: 'completed'
    });
    return json({
      ok: true,
      data: {
        ...localDraft,
        aiUsed: false,
        fallbackReason: error.message || 'AI 二创暂时不可用，已生成本地规则排版稿。'
      }
    }, 200, headers);
  }
}

async function rewriteWithSiliconFlow({ apiKey, model, title, text, images, template }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let response;

  try {
    response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 2400,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你是公众号文章编辑和排版助手。',
            '请基于用户提供的原文进行二创，不新增未经原文支持的事实。',
            '输出 JSON，字段为 title 和 markdown。',
            'markdown 使用二级标题、短段落和重点句，适合微信公众号阅读。',
            '如果用户给了图片占位，请在适合位置保留 [图片1]、[图片2] 这样的占位符。'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            `原始标题：${title || '未识别标题'}`,
            `排版风格：${template}`,
            images.length ? `可用图片：${images.map((_, index) => `[图片${index + 1}]`).join(' ')}` : '可用图片：无',
            '原文：',
            text.slice(0, 12000)
          ].join('\n\n')
        }
      ]
    })
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AI 二创超时，已生成本地排版稿。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || 'AI 二创请求失败。');
  }

  const content = payload?.choices?.[0]?.message?.content || '';
  const parsed = parseJsonObject(content);
  const draftTitle = String(parsed?.title || title || '').trim();
  const markdown = String(parsed?.markdown || parsed?.text || content || '').trim();
  const blocks = markdownToBlocks(markdown, images);
  return {
    title: draftTitle,
    text: blocksToPlainText(blocks),
    html: buildWechatArticleHtml(blocks, { title: draftTitle, template })
  };
}

function buildLocalDraft({ title, text, images, template }) {
  const paragraphs = splitParagraphs(text).slice(0, 18);
  const blocks = [];
  const draftTitle = title ? `换个角度看：${title}` : '这篇文章换个角度还能这样写';

  blocks.push({ type: 'text', text: '这篇内容的价值，不在于把信息重新说一遍，而是把关键观点整理成更容易阅读、转发和收藏的版本。' });
  if (paragraphs.length) {
    blocks.push({ type: 'heading', text: '先说结论' });
    blocks.push({ type: 'text', text: paragraphs[0] });
  }

  const rest = paragraphs.slice(1);
  const imageBlocks = images.map((src) => ({ type: 'image', src }));
  const interval = Math.max(2, Math.ceil(rest.length / Math.max(1, imageBlocks.length + 1)));
  let imageIndex = 0;

  rest.forEach((paragraph, index) => {
    if (index === 0) blocks.push({ type: 'heading', text: '为什么这件事值得关注' });
    if (index === Math.floor(rest.length / 2)) blocks.push({ type: 'heading', text: '可以怎么理解和使用' });
    blocks.push({ type: 'text', text: paragraph });
    if ((index + 1) % interval === 0 && imageIndex < imageBlocks.length) {
      blocks.push(imageBlocks[imageIndex]);
      imageIndex += 1;
    }
  });

  while (imageIndex < imageBlocks.length) {
    blocks.push(imageBlocks[imageIndex]);
    imageIndex += 1;
  }

  blocks.push({ type: 'heading', text: '写在最后' });
  blocks.push({ type: 'text', text: '如果你也在做内容复盘或二次创作，可以先把原文拆成观点、例子和行动建议，再决定哪些部分保留、哪些部分改写。' });

  return {
    title: draftTitle,
    text: blocksToPlainText(blocks),
    html: buildWechatArticleHtml(blocks, { title: draftTitle, template })
  };
}

function markdownToBlocks(markdown, images) {
  const blocks = [];
  const lines = String(markdown || '').split(/\r?\n/);
  let buffer = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push({ type: 'text', text: cleanMarkdown(text) });
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const imageMatch = trimmed.match(/^\[图片(\d+)\]$/);
    if (imageMatch) {
      flush();
      const src = images[Number(imageMatch[1]) - 1];
      if (src) blocks.push({ type: 'image', src });
      continue;
    }
    if (/^#{1,3}\s+/.test(trimmed)) {
      flush();
      blocks.push({ type: 'heading', text: cleanMarkdown(trimmed.replace(/^#{1,3}\s+/, '')) });
      continue;
    }
    buffer.push(trimmed.replace(/^[-*]\s+/, ''));
  }
  flush();

  return blocks.length ? blocks : splitParagraphs(markdown).map((text) => ({ type: 'text', text }));
}

function buildWechatArticleHtml(blocks, { title = '', template = 'clean' } = {}) {
  const style = getWechatTemplateStyle(template);
  const safeTitle = escapeHtml(title || '');
  const body = (blocks || []).map((block) => {
    if (block.type === 'heading') return `<h2 style="${style.heading}">${escapeHtml(block.text)}</h2>`;
    if (block.type === 'image') {
      return `<p style="${style.imageWrap}"><img src="${escapeHtml(block.src)}" style="max-width:100%;height:auto;border-radius:${style.imageRadius};" /></p>`;
    }
    return `<p style="${style.paragraph}">${escapeHtml(block.text).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return [
    `<section style="${style.section}">`,
    safeTitle ? `<h1 style="${style.title}">${safeTitle}</h1>` : '',
    body,
    '</section>'
  ].filter(Boolean).join('\n');
}

function getWechatTemplateStyle(template) {
  if (template === 'knowledge') {
    return {
      section: 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#162033;background:#ffffff;',
      title: 'font-size:22px;line-height:1.5;margin:0 0 20px;font-weight:800;color:#0f172a;border-left:5px solid #2563eb;padding-left:12px;',
      heading: 'font-size:18px;line-height:1.6;margin:30px 0 12px;font-weight:800;color:#1d4ed8;background:#eff6ff;border-radius:8px;padding:8px 12px;',
      paragraph: 'font-size:16px;line-height:1.95;margin:14px 0;color:#1f2937;',
      imageWrap: 'margin:22px 0;text-align:center;',
      imageRadius: '8px'
    };
  }
  if (template === 'marketing') {
    return {
      section: 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#201018;background:#ffffff;',
      title: 'font-size:23px;line-height:1.45;margin:0 0 22px;font-weight:900;color:#be185d;',
      heading: 'font-size:18px;line-height:1.6;margin:28px 0 12px;font-weight:800;color:#be185d;border-bottom:2px solid #fbcfe8;padding-bottom:6px;',
      paragraph: 'font-size:16px;line-height:1.95;margin:14px 0;color:#3f2430;',
      imageWrap: 'margin:22px 0;text-align:center;',
      imageRadius: '10px'
    };
  }
  return {
    section: 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;background:#ffffff;',
    title: 'font-size:22px;line-height:1.5;margin:0 0 22px;font-weight:800;color:#111827;',
    heading: 'font-size:18px;line-height:1.6;margin:28px 0 12px;font-weight:800;color:#111827;',
    paragraph: 'font-size:16px;line-height:1.95;margin:14px 0;color:#1f2937;',
    imageWrap: 'margin:20px 0;text-align:center;',
    imageRadius: '8px'
  };
}

function splitParagraphs(value) {
  return String(value || '')
    .split(/\n{2,}|\r{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function blocksToPlainText(blocks) {
  return (blocks || [])
    .map((block) => block.type === 'image' ? '[图片]' : block.text)
    .filter(Boolean)
    .join('\n\n');
}

function cleanMarkdown(value) {
  return String(value || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function parseJsonObject(value) {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
