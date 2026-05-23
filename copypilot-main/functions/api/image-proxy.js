export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const imageUrl = requestUrl.searchParams.get('url');
  const index = requestUrl.searchParams.get('index') || '1';

  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return new Response('Missing image url', { status: 400 });
  }

  const upstream = await fetch(imageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      Referer: 'https://www.xiaohongshu.com/'
    }
  });

  if (!upstream.ok) {
    return new Response('Image download failed', { status: upstream.status });
  }

  const contentType = upstream.headers.get('Content-Type') || 'image/jpeg';
  const extension = getImageExtension(contentType, imageUrl);
  const headers = new Headers(upstream.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', `attachment; filename="copypilot-image-${index}.${extension}"`);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

function getImageExtension(contentType, url) {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';

  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]{3,5})(?:$|[!?])/i);
    if (match) return match[1].toLowerCase();
  } catch {
    // fall through
  }

  return 'jpg';
}
