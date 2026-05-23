export const siteOrigin = 'https://copypilot.cc';
export const siteName = 'CopyPilot';

const coreFaqsZh = [
  ['CopyPilot 完全免费吗？', '当前公开版免费使用，核心工具打开页面即可使用。免费版统一每天 10 次，转文字支持 5 分钟以内的音视频。'],
  ['支持哪些平台？', '支持抖音、小红书、快手、B站、微博、公众号文章、TikTok、YouTube、Instagram、Lemon8 等主流内容平台，公开可访问的链接效果最好。'],
  ['提取失败怎么办？', '请确认链接公开可访问、没有过期或被删除。部分平台接口变化、私密内容、版权限制和网络问题都可能导致失败。']
];

const coreFaqsEn = [
  ['Is CopyPilot free?', 'The public version is free for core tools. Free users get 10 daily extractions and speech-to-text for media up to 5 minutes.'],
  ['Which platforms are supported?', 'CopyPilot supports Douyin, Xiaohongshu, Kuaishou, Bilibili, Weibo, WeChat articles, TikTok, YouTube, Instagram, Lemon8, and more. Public links work best.'],
  ['Why can extraction fail?', 'Private posts, expired links, deleted content, platform limits, copyright restrictions, and temporary API changes can all cause failures.']
];

export const seoPages = [
  page('/', 'zh-CN', 'home', 'blue', '免费在线内容提取工具', '支持50+平台 视频文案提取、视频去水印工具', '支持抖音、小红书、TikTok、YouTube、Instagram、公众号文章等平台，一键提取视频、图片、标题、文案、Tag 和视频语音文案。', [
    '视频文案提取', '视频去水印', '小红书图片提取', '抖音视频提取', '公众号文章提取'
  ]),
  page('/video', 'zh-CN', 'video', 'cyan', '提取视频', '视频提取工具', '输入作品链接，提取视频预览、下载链接、标题、发布文案和 Tag，适合素材保存、二创剪辑和内容归档。', [
    '视频提取', '视频下载', '无水印视频提取', '短视频素材下载'
  ]),
  page('/text', 'zh-CN', 'text', 'indigo', '提取文案', '视频文案提取工具', '输入作品链接或上传本地音视频，提取发布文案、标题、Tag，并识别视频本身的语音文案。', [
    '视频文案提取', '视频转文字', '音频转文字', '短视频脚本提取'
  ]),
  page('/image-text', 'zh-CN', 'image', 'pink', '提取图文', '图文提取工具', '输入图文作品链接，提取图片素材、标题、正文和话题标签，适合小红书、电商素材和内容拆解。', [
    '图文提取', '图片提取', '小红书图片提取', '图文文案提取'
  ]),
  page('/article', 'zh-CN', 'article', 'green', '提取文章', '文章提取工具', '输入公众号文章、知乎文章或网页文章链接，提取标题、正文、原文图片和基础信息。', [
    '公众号文章提取', '网页正文提取', '文章图片提取', '文章排版复制'
  ]),

  page('/douyin-video-download', 'zh-CN', 'video', 'cyan', '抖音视频提取', '抖音视频提取工具', '粘贴抖音分享链接，提取视频预览、下载链接、作品标题、发布文案和话题标签。', [
    '抖音视频提取', '抖音视频去水印', '抖音视频下载', '抖音素材提取'
  ]),
  page('/douyin-caption-extractor', 'zh-CN', 'text', 'indigo', '抖音文案提取', '抖音文案提取工具', '粘贴抖音链接，提取作品标题、发布文案、话题标签，并可识别视频本身的语音文案。', [
    '抖音文案提取', '抖音标题提取', '抖音Tag提取', '抖音视频转文字'
  ]),
  page('/douyin-video-to-text', 'zh-CN', 'text', 'indigo', '抖音视频转文字', '抖音视频转文字工具', '粘贴抖音视频链接，提取平台发布文案，并对视频语音内容进行转文字识别。', [
    '抖音视频转文字', '抖音语音转文字', '抖音字幕提取', '视频文案识别'
  ]),
  page('/xiaohongshu-image-download', 'zh-CN', 'image', 'pink', '小红书图文提取', '小红书图片提取工具', '粘贴小红书笔记链接，提取图文笔记里的原图、标题、正文和话题标签。', [
    '小红书图片提取', '小红书图文提取', '小红书原图下载', '小红书文案提取'
  ]),
  page('/xiaohongshu-caption-extractor', 'zh-CN', 'text', 'indigo', '小红书文案提取', '小红书文案提取工具', '输入小红书笔记链接，提取标题、正文、话题标签和可用素材，方便整理选题和二创。', [
    '小红书文案提取', '小红书标题提取', '小红书标签提取', '小红书笔记提取'
  ]),
  page('/xiaohongshu-live-photo-download', 'zh-CN', 'image', 'pink', '小红书 Live 图提取', '小红书 Live 图提取工具', '输入小红书图文或 Live 图笔记链接，尝试提取图片素材、正文和标签信息。', [
    '小红书Live图提取', '小红书动图提取', '小红书图片保存', '小红书素材提取'
  ]),
  page('/kuaishou-video-download', 'zh-CN', 'video', 'cyan', '快手视频提取', '快手视频提取工具', '粘贴快手作品链接，提取视频素材、标题、发布文案和话题标签。', [
    '快手视频提取', '快手视频下载', '快手文案提取', '快手素材下载'
  ]),
  page('/bilibili-video-download', 'zh-CN', 'video', 'cyan', 'B站视频提取', 'B站视频提取工具', '粘贴 Bilibili 视频链接，整理视频标题、简介、基础信息和可用素材链接。', [
    'B站视频提取', 'Bilibili视频下载', 'B站文案提取', 'B站简介提取'
  ]),
  page('/weibo-video-download', 'zh-CN', 'video', 'cyan', '微博视频提取', '微博视频提取工具', '粘贴微博视频链接，提取视频素材、正文内容和话题标签。', [
    '微博视频提取', '微博视频下载', '微博文案提取', '微博话题提取'
  ]),
  page('/weibo-image-download', 'zh-CN', 'image', 'pink', '微博图文提取', '微博图文图片提取工具', '粘贴微博图文链接，提取图片素材、正文和话题标签。', [
    '微博图片提取', '微博图文提取', '微博原图下载', '微博文案提取'
  ]),
  page('/wechat-article', 'zh-CN', 'article', 'green', '公众号文章提取', '公众号文章提取工具', '粘贴微信公众号文章链接，提取文章标题、正文、原文图片和基础信息。', [
    '公众号文章提取', '微信公众号文章复制', '公众号图片提取', '公众号排版复制'
  ]),
  page('/article-studio', 'zh-CN', 'article', 'green', '公众号二创排版', '公众号文章二创排版工具', '提取公众号文章正文和图片，AI 二创后生成可编辑的公众号排版稿，复制后可粘贴到公众号后台。', [
    '公众号AI二创', '公众号排版工具', '公众号文章改写', '公众号复制排版'
  ]),
  page('/zhihu-article', 'zh-CN', 'article', 'green', '知乎文章提取', '知乎文章提取工具', '粘贴知乎文章或回答链接，提取标题、正文、图片和基础信息。', [
    '知乎文章提取', '知乎回答提取', '知乎图片提取', '网页正文提取'
  ]),
  page('/web-article', 'zh-CN', 'article', 'green', '网页文章提取', '网页文章正文提取工具', '粘贴网页文章链接，提取文章标题、正文、图片和基础信息。', [
    '网页正文提取', '网页文章提取', '网页图片提取', '文章内容提取'
  ]),
  page('/video-to-text', 'zh-CN', 'media-file', 'indigo', '视频转文字', '视频转文字工具', '上传本地视频文件，识别视频中的语音内容并整理成可复制的文字稿。', [
    '视频转文字', '视频语音识别', '视频字幕提取', '视频文案提取'
  ]),
  page('/audio-to-text', 'zh-CN', 'media-file', 'indigo', '音频转文字', '音频转文字工具', '上传本地音频文件，自动识别语音内容，快速生成可复制的文字稿。', [
    '音频转文字', '录音转文字', '音频文案提取', '语音识别工具'
  ]),

  page('/en/tiktok-video-downloader', 'en', 'video', 'cyan', 'TikTok video downloader', 'TikTok Video Downloader', 'Paste a TikTok link to extract video previews, downloadable media links, captions, and hashtags for content workflows.', [
    'TikTok video downloader', 'TikTok no watermark', 'TikTok caption extractor', 'TikTok video extract'
  ], coreFaqsEn),
  page('/en/tiktok-caption-extractor', 'en', 'text', 'indigo', 'TikTok caption extractor', 'TikTok Caption Extractor', 'Extract TikTok captions, post text, hashtags, and optional speech-to-text transcripts from public video links.', [
    'TikTok caption extractor', 'TikTok transcript', 'TikTok hashtags', 'video to text'
  ], coreFaqsEn),
  page('/en/instagram-video-downloader', 'en', 'video', 'cyan', 'Instagram video downloader', 'Instagram Video Downloader', 'Extract Instagram Reels or post video media, captions, and tags from public Instagram links.', [
    'Instagram video downloader', 'Instagram Reels downloader', 'Instagram caption extractor'
  ], coreFaqsEn),
  page('/en/instagram-caption-extractor', 'en', 'text', 'indigo', 'Instagram caption extractor', 'Instagram Caption Extractor', 'Extract Instagram captions, hashtags, and post text from public Instagram post or Reels links.', [
    'Instagram caption extractor', 'Instagram hashtags', 'Instagram post text'
  ], coreFaqsEn),
  page('/en/youtube-transcript-extractor', 'en', 'text', 'indigo', 'YouTube transcript extractor', 'YouTube Transcript Extractor', 'Extract YouTube titles, descriptions, media information, and transcript-ready text workflows from public links.', [
    'YouTube transcript extractor', 'YouTube video to text', 'YouTube caption extractor'
  ], coreFaqsEn),
  page('/en/xiaohongshu-image-downloader', 'en', 'image', 'pink', 'Xiaohongshu image downloader', 'Xiaohongshu Image Downloader', 'Extract images, titles, captions, and hashtags from Xiaohongshu notes for research and content reuse workflows.', [
    'Xiaohongshu image downloader', 'RedNote image extractor', 'Xiaohongshu caption extractor'
  ], coreFaqsEn),
  page('/en/video-to-text', 'en', 'media-file', 'indigo', 'Video to text', 'Video to Text Tool', 'Upload a local video file and convert spoken content into copyable text for notes, scripts, and repurposing.', [
    'video to text', 'video transcription', 'speech to text', 'transcript generator'
  ], coreFaqsEn),
  page('/en/audio-to-text', 'en', 'media-file', 'indigo', 'Audio to text', 'Audio to Text Tool', 'Upload local audio and convert speech into editable text for notes, interviews, podcasts, and meetings.', [
    'audio to text', 'audio transcription', 'speech recognition', 'recording to text'
  ], coreFaqsEn)
];

export const extraSitemapRoutes = [
  '/tiktok-video-download',
  '/youtube-video-download',
  '/instagram-video-download',
  '/instagram-image-download',
  '/lemon8-image-download',
  '/local-video-to-text',
  '/local-audio-to-text',
  '/privacy',
  '/terms',
  '/copyright',
  '/contact'
];

export const seoPageByPath = Object.fromEntries(seoPages.map((item) => [item.path, item]));
export const seoRoutes = [...new Set([...seoPages.map((item) => item.path), ...extraSitemapRoutes])];

function page(path, lang, toolType, theme, badge, h1, description, keywords, faqs = coreFaqsZh) {
  const title = lang === 'en'
    ? `${h1} - Free Online Tool`
    : `${h1} - 免费在线工具`;
  return {
    path,
    lang,
    htmlLang: lang === 'en' ? 'en' : 'zh-CN',
    toolType,
    theme,
    badge,
    h1,
    title,
    description,
    keywords,
    faqs,
    updated: '2026-05-18'
  };
}
