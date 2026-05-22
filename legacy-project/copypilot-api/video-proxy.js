export async function onRequestGet(context) {
  const url = new URL(context.request.url).searchParams.get('url');
  if (!url || !/^https?:\/\//i.test(url)) {
    return new Response('Missing video url', { status: 400 });
  }

  const range = context.request.headers.get('Range');
  const upstream = await fetch(url, {
    headers: {
      ...(range ? { Range: range } : {}),
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      Referer: 'https://www.douyin.com/'
    }
  });

  const headers = new Headers(upstream.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=3600');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}
