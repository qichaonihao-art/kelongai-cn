const DEFAULT_SITE_CONTENT = {
  zh: {
    uiText: {
      nav: ['首页', '提取视频', '提取文案', '提取图文', '提取文章'],
      login: '登录',
      heroBadge: '免费在线视频文案提取',
      heroTitle: '支持50+平台 视频和文案提取工具',
      heroSubtitle: '一键提取视频文案、视频转音频MP3、视频提取，图片提取。支持抖音、小红书等50+平台，AI智能识别，批量下载，免费使用。',
      linkText: '链接提取文案',
      localText: '本地音视频提取文案',
      start: '开始提取',
      loading: '提取中...',
      paste: '粘贴',
      clear: '清空',
      progressTitle: '处理中，请稍候...',
      progressDetect: '正在识别链接类型和内容平台...',
      progressExtract: '正在提取标题、发布文案、标签和素材...',
      progressTranscribe: '已拿到视频素材，正在识别视频本身文案...',
      progressFinalize: '正在整理可复制、可下载的结果...',
      progressUpload: '正在上传文件并识别语音内容...',
      resultLabel: '结果',
      placeholders: {
        auto: '粘贴作品链接，自动识别并提取文案、视频、图片和Tag',
        video: '粘贴作品链接，提取视频文件',
        image: '粘贴图文作品链接，提取图片、标题、文案和Tag',
        article: '粘贴公众号文章或网页文章链接',
        text: '粘贴作品链接，提取文案、标题和Tag'
      },
      featureEyebrow: '强大功能',
      featureTitle: '不只是复制链接，而是把内容整理成可用素材',
      stepsEyebrow: '使用步骤',
      stepsTitle: '三步完成视频和文案提取',
      faqTitle: '常见问题解答',
      faqSubtitle: '关于 CopyPilot 视频文案提取工具的常见问题和详细解答',
      seoEyebrow: '热门工具',
      seoTitle: '按平台和场景快速提取内容',
      footerDesc: '支持50+平台的视频、图文、文章和文案提取工具。'
    },
    featureCards: [
      { title: '50+平台支持', text: '覆盖抖音、小红书、TikTok、快手等主流内容平台。' },
      { title: '视频文案提取', text: '自动整理视频标题、正文、作者信息和素材链接。' },
      { title: '图片内容提取', text: '适合图文笔记、电商素材和内容拆解。' },
      { title: 'AI智能识别', text: '自动识别链接类型，减少手动选择和复制整理。' }
    ],
    steps: [
      ['复制链接', '从抖音、小红书等平台复制作品分享链接。'],
      ['粘贴提取', '把链接粘贴到输入框，点击开始提取。'],
      ['复制结果', '获取文案、图片或视频素材链接，继续整理使用。']
    ],
    faqs: [
      ['CopyPilot 完全免费吗？有使用次数限制吗？', 'CopyPilot 当前公开版本免费使用，可以直接提取视频文案、下载视频、提取图片、音频和文章内容。核心工具打开页面即可使用。'],
      ['支持哪些视频平台？是否支持海外平台？', 'CopyPilot 支持 50+ 主流内容平台，包括抖音、小红书、快手、B站、微博、公众号文章、TikTok、YouTube、Instagram、Lemon8 等。只要是公开可访问的作品链接，通常都可以尝试提取。'],
      ['视频文案识别的准确率如何？支持哪些语言？', '音频清晰时，语音转文字效果会更好。当前支持中文、英语、日语、韩语等常见语言。如果视频声音较小、背景噪音较大、多人同时说话或音乐较重，识别准确度可能会受到影响。']
    ]
  },
  en: {
    uiText: {
      nav: ['Home', 'Video', 'Text', 'Images', 'Articles'],
      login: 'Sign in',
      heroBadge: 'Free online content extractor',
      heroTitle: 'Extract videos, captions, images, and articles from 50+ platforms',
      heroSubtitle: 'Paste a link to extract video captions, MP3/audio, downloadable videos, images, and post metadata. Supports Douyin, Xiaohongshu, TikTok, and more.',
      linkText: 'Extract from link',
      localText: 'Upload audio/video',
      start: 'Extract',
      loading: 'Extracting...',
      paste: 'Paste',
      clear: 'Clear',
      progressTitle: 'Processing, please wait...',
      progressDetect: 'Detecting link type and platform...',
      progressExtract: 'Extracting title, caption, tags, and media...',
      progressTranscribe: 'Video found. Transcribing the spoken content...',
      progressFinalize: 'Preparing copyable and downloadable results...',
      progressUpload: 'Uploading the file and recognizing speech...',
      resultLabel: 'Result',
      placeholders: {
        auto: 'Paste a post link to auto extract captions, videos, images, and tags',
        video: 'Paste a post link to extract video files',
        image: 'Paste an image post link to extract images, title, caption, and tags',
        article: 'Paste a WeChat article or web article link',
        text: 'Paste a post link to extract caption, title, and tags'
      },
      featureEyebrow: 'Features',
      featureTitle: 'Turn links into reusable content assets',
      stepsEyebrow: 'How it works',
      stepsTitle: 'Extract content in three steps',
      faqTitle: 'Frequently Asked Questions',
      faqSubtitle: 'Common questions and detailed answers about CopyPilot content extraction tools',
      seoEyebrow: 'Popular tools',
      seoTitle: 'Find tools by platform and workflow',
      footerDesc: 'A video, image, article, and caption extraction tool for 50+ platforms.'
    },
    featureCards: [
      { title: '50+ platforms', text: 'Supports Douyin, Xiaohongshu, TikTok, Kuaishou, and more content platforms.' },
      { title: 'Caption extraction', text: 'Collect titles, captions, author details, and media links automatically.' },
      { title: 'Image extraction', text: 'Useful for image posts, ecommerce assets, and content breakdowns.' },
      { title: 'Smart routing', text: 'Detects link types and routes them to the right extraction workflow.' }
    ],
    steps: [
      ['Copy a link', 'Copy a shared post or article link from a supported platform.'],
      ['Paste and extract', 'Paste the link into CopyPilot and start extraction.'],
      ['Use the result', 'Copy captions, download images, preview videos, or reuse article layouts.']
    ],
    faqs: [
      ['Is CopyPilot completely free? Are there usage limits?', 'CopyPilot is currently free for core extraction workflows. You can extract captions, videos, images, audio, and article content directly from the browser.'],
      ['Which platforms are supported? Are overseas platforms supported?', 'CopyPilot targets 50+ mainstream platforms, including Douyin, Xiaohongshu, Kuaishou, Bilibili, Weibo, WeChat articles, TikTok, YouTube, Instagram, Lemon8, and more. Publicly accessible links usually work best.'],
      ['How accurate is video speech-to-text? Which languages are supported?', 'Speech recognition works best when the audio is clear. Chinese, English, Japanese, Korean, and other common languages are supported, while heavy background noise, music, or overlapping voices may reduce accuracy.']
    ]
  }
};

export async function ensureSiteContent(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS site_content (
      content_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  await db.prepare(
    `INSERT OR IGNORE INTO site_content (content_key, value_json)
     VALUES ('main', ?)`
  ).bind(JSON.stringify(DEFAULT_SITE_CONTENT)).run();
}

export async function getSiteContent(db) {
  await ensureSiteContent(db);
  const row = await db.prepare('SELECT value_json FROM site_content WHERE content_key = ?').bind('main').first();
  return normalizeSiteContent(parseJson(row?.value_json) || DEFAULT_SITE_CONTENT);
}

export async function saveSiteContent(db, input) {
  await ensureSiteContent(db);
  const content = normalizeSiteContent(input);
  await db.prepare(
    `INSERT INTO site_content (content_key, value_json, updated_at)
     VALUES ('main', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(content_key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = CURRENT_TIMESTAMP`
  ).bind(JSON.stringify(content)).run();
  return content;
}

export function defaultSiteContent() {
  return cloneJson(DEFAULT_SITE_CONTENT);
}

function normalizeSiteContent(input) {
  return {
    zh: normalizeLangContent(input?.zh, DEFAULT_SITE_CONTENT.zh),
    en: normalizeLangContent(input?.en, DEFAULT_SITE_CONTENT.en)
  };
}

function normalizeLangContent(input, fallback) {
  return {
    uiText: {
      ...fallback.uiText,
      ...(isPlainObject(input?.uiText) ? cleanObject(input.uiText) : {})
    },
    featureCards: normalizeCards(input?.featureCards, fallback.featureCards),
    steps: normalizePairs(input?.steps, fallback.steps),
    faqs: normalizePairs(input?.faqs, fallback.faqs),
    toolPages: normalizeToolPages(input?.toolPages, fallback.toolPages)
  };
}

function normalizeToolPages(value, fallback = {}) {
  const source = isPlainObject(value) ? value : (isPlainObject(fallback) ? fallback : {});
  const output = {};
  for (const [path, item] of Object.entries(source)) {
    if (!path.startsWith('/') || !isPlainObject(item)) continue;
    const page = {
      badge: String(item.badge || '').trim(),
      title: String(item.title || '').trim(),
      subtitle: String(item.subtitle || '').trim(),
      seoTitle: String(item.seoTitle || '').trim()
    };
    if (page.badge || page.title || page.subtitle || page.seoTitle) output[path] = page;
  }
  return output;
}

function normalizeCards(value, fallback) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return source.slice(0, 12).map((item) => ({
    title: String(item?.title || '').trim(),
    text: String(item?.text || '').trim()
  })).filter((item) => item.title || item.text);
}

function normalizePairs(value, fallback) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return source.slice(0, 30).map((item) => {
    if (Array.isArray(item)) return [String(item[0] || '').trim(), String(item[1] || '').trim()];
    return [String(item?.title || item?.question || '').trim(), String(item?.text || item?.answer || '').trim()];
  }).filter(([title, text]) => title || text);
}

function cleanObject(value) {
  const output = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (Array.isArray(item)) output[key] = item.map((entry) => String(entry || '').trim()).filter(Boolean);
    else if (isPlainObject(item)) output[key] = cleanObject(item);
    else if (item !== undefined && item !== null) output[key] = String(item).trim();
  }
  return output;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value) {
  try {
    return JSON.parse(value || '');
  } catch {
    return null;
  }
}
