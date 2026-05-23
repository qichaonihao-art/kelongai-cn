const DEFAULT_ZONE_ID = '6c011589c563b3455c7e8a3f787efa37';
const DEFAULT_ZONE_NAME = 'copypilot.cc';
const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

export async function onRequestGet({ request, env }) {
  try {
    const adminKey = env.ANALYTICS_ADMIN_KEY;
    if (!adminKey) return json({ ok: false, message: '统计后台访问码未配置。' }, 500);

    const providedKey = request.headers.get('x-analytics-key') || '';
    if (!safeEqual(providedKey, adminKey)) {
      return json({ ok: false, message: '统计访问码不正确。' }, 401);
    }

    const apiToken = env.CLOUDFLARE_ANALYTICS_TOKEN || env.CLOUDFLARE_API_TOKEN;
    if (!apiToken) return json({ ok: false, message: 'Cloudflare 统计 Token 未配置。' }, 500);

    const url = new URL(request.url);
    const rangeHours = clampNumber(Number(url.searchParams.get('range') || 48), 1, 72);
    const now = new Date();
    const start = new Date(now.getTime() - rangeHours * 60 * 60 * 1000);
    const zoneTag = env.CLOUDFLARE_ZONE_ID || DEFAULT_ZONE_ID;
    const zoneName = env.CLOUDFLARE_ZONE_NAME || DEFAULT_ZONE_NAME;

    const [hourly, daily, topPaths, topTraffic, topCountries, productEvents] = await Promise.all([
      fetchHourly({ apiToken, zoneTag, start, end: now }),
      fetchDaily({ apiToken, zoneTag, days: 7 }),
      fetchTopPaths({ apiToken, zoneTag, zoneName, now, sortBy: 'count' }),
      fetchTopPaths({ apiToken, zoneTag, zoneName, now, sortBy: 'bytes' }),
      fetchTopCountries({ apiToken, zoneTag, zoneName, now }),
      fetchProductEvents({ db: env.DB, hours: rangeHours })
    ]);

    const totals = summarizeHourly(hourly);
    const byLocalDay = groupByLocalDay(hourly);
    const topHours = [...hourly]
      .sort((a, b) => b.pageViews - a.pageViews)
      .slice(0, 10);

    return json({
      ok: true,
      data: {
        meta: {
          zoneName,
          rangeHours,
          generatedAt: now.toISOString(),
          periodLocal: `${formatLocalDateTime(start)} - ${formatLocalDateTime(now)}`,
          note: 'Cloudflare 的 uniques 是按统计窗口去重；小时相加会重复，UTC 日报的 uniques 更接近单日访客。'
        },
        totals,
        byLocalDay,
        daily,
        topHours,
        topPaths,
        topTraffic,
        topCountries,
        productEvents
      },
    });
  } catch (error) {
    return json({ ok: false, message: error.message || '统计数据读取失败。' }, 500);
  }
}

async function fetchProductEvents({ db, hours }) {
  if (!db) return emptyProductEvents();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  try {
    const [events, paths, platforms] = await Promise.all([
      db.prepare(
        `SELECT event_name AS eventName, COUNT(*) AS count
         FROM product_events
         WHERE datetime(created_at) >= datetime(?)
         GROUP BY event_name
         ORDER BY count DESC`
      ).bind(since).all(),
      db.prepare(
        `SELECT path, COUNT(*) AS count
         FROM product_events
         WHERE datetime(created_at) >= datetime(?) AND path IS NOT NULL AND path != ''
         GROUP BY path
         ORDER BY count DESC
         LIMIT 20`
      ).bind(since).all(),
      db.prepare(
        `SELECT platform, COUNT(*) AS count
         FROM product_events
         WHERE datetime(created_at) >= datetime(?) AND platform IS NOT NULL AND platform != ''
         GROUP BY platform
         ORDER BY count DESC
         LIMIT 15`
      ).bind(since).all()
    ]);

    const eventRows = events.results || [];
    const map = Object.fromEntries(eventRows.map((row) => [row.eventName, Number(row.count || 0)]));
    return {
      totals: eventRows,
      funnel: [
        { label: '页面访问', eventName: 'page_view', count: map.page_view || 0 },
        { label: '粘贴链接', eventName: 'paste_link', count: map.paste_link || 0 },
        { label: '开始提取', eventName: 'extract_start', count: map.extract_start || 0 },
        { label: '提取成功', eventName: 'extract_success', count: map.extract_success || 0 },
        { label: '提取失败', eventName: 'extract_failed', count: map.extract_failed || 0 },
        { label: '复制结果', eventName: 'copy_text', count: map.copy_text || 0 },
        { label: 'AI 二创开始', eventName: 'rewrite_start', count: map.rewrite_start || 0 },
        { label: 'AI 二创成功', eventName: 'rewrite_success', count: map.rewrite_success || 0 }
      ],
      topPaths: paths.results || [],
      platforms: platforms.results || []
    };
  } catch {
    return emptyProductEvents();
  }
}

function emptyProductEvents() {
  return {
    totals: [],
    funnel: [],
    topPaths: [],
    platforms: []
  };
}

async function fetchHourly({ apiToken, zoneTag, start, end }) {
  const query = `
    query($zoneTag: string!, $filter: ZoneHttpRequests1hGroupsFilter_InputObject!) {
      viewer {
        zones(filter: {zoneTag: $zoneTag}) {
          httpRequests1hGroups(limit: 1000, filter: $filter, orderBy: [datetime_ASC]) {
            dimensions { datetime }
            sum { requests bytes cachedRequests cachedBytes pageViews }
            uniq { uniques }
          }
        }
      }
    }
  `;
  const payload = await cloudflareQuery(apiToken, query, {
    zoneTag,
    filter: {
      datetime_geq: formatIso(start),
      datetime_lt: formatIso(end)
    }
  });

  return (payload.viewer?.zones?.[0]?.httpRequests1hGroups || []).map((row) => ({
    utcHour: row.dimensions.datetime,
    localHour: formatLocalHour(row.dimensions.datetime),
    requests: row.sum.requests || 0,
    pageViews: row.sum.pageViews || 0,
    bytes: row.sum.bytes || 0,
    cachedRequests: row.sum.cachedRequests || 0,
    cachedBytes: row.sum.cachedBytes || 0,
    uniques: row.uniq.uniques || 0
  }));
}

async function fetchDaily({ apiToken, zoneTag, days }) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const query = `
    query($zoneTag: string!, $filter: ZoneHttpRequests1dGroupsFilter_InputObject!) {
      viewer {
        zones(filter: {zoneTag: $zoneTag}) {
          httpRequests1dGroups(limit: 10, filter: $filter, orderBy: [date_ASC]) {
            dimensions { date }
            sum { requests bytes cachedRequests cachedBytes pageViews }
            uniq { uniques }
          }
        }
      }
    }
  `;
  const payload = await cloudflareQuery(apiToken, query, {
    zoneTag,
    filter: {
      date_geq: start.toISOString().slice(0, 10),
      date_leq: end.toISOString().slice(0, 10)
    }
  });

  return (payload.viewer?.zones?.[0]?.httpRequests1dGroups || []).map((row) => ({
    dateUtc: row.dimensions.date,
    requests: row.sum.requests || 0,
    pageViews: row.sum.pageViews || 0,
    bytes: row.sum.bytes || 0,
    cachedRequests: row.sum.cachedRequests || 0,
    cachedBytes: row.sum.cachedBytes || 0,
    uniques: row.uniq.uniques || 0
  }));
}

async function fetchTopPaths({ apiToken, zoneTag, zoneName, now, sortBy }) {
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const query = `
    query($zoneTag: string!, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!) {
      viewer {
        zones(filter: {zoneTag: $zoneTag}) {
          httpRequestsAdaptiveGroups(limit: 200, filter: $filter) {
            dimensions { clientRequestPath }
            count
            sum { visits edgeResponseBytes }
          }
        }
      }
    }
  `;
  const payload = await cloudflareQuery(apiToken, query, {
    zoneTag,
    filter: {
      datetime_geq: formatIso(start),
      datetime_lt: formatIso(now),
      clientRequestHTTPHost: zoneName
    }
  });

  const rows = (payload.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || []).map((row) => ({
    path: row.dimensions.clientRequestPath || '/',
    requests: row.count || 0,
    visits: row.sum.visits || 0,
    bytes: row.sum.edgeResponseBytes || 0
  }));

  return rows
    .sort((a, b) => sortBy === 'bytes' ? b.bytes - a.bytes : b.requests - a.requests)
    .slice(0, 15);
}

async function fetchTopCountries({ apiToken, zoneTag, zoneName, now }) {
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const query = `
    query($zoneTag: string!, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!) {
      viewer {
        zones(filter: {zoneTag: $zoneTag}) {
          httpRequestsAdaptiveGroups(limit: 80, filter: $filter) {
            dimensions { clientCountryName }
            count
            sum { visits edgeResponseBytes }
          }
        }
      }
    }
  `;
  const payload = await cloudflareQuery(apiToken, query, {
    zoneTag,
    filter: {
      datetime_geq: formatIso(start),
      datetime_lt: formatIso(now),
      clientRequestHTTPHost: zoneName
    }
  });

  return (payload.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [])
    .map((row) => ({
      country: row.dimensions.clientCountryName || 'Unknown',
      requests: row.count || 0,
      visits: row.sum.visits || 0,
      bytes: row.sum.edgeResponseBytes || 0
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 12);
}

async function cloudflareQuery(apiToken, query, variables) {
  const response = await fetch(CF_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.errors?.length) {
    const message = payload?.errors?.[0]?.message || payload?.message || 'Cloudflare 统计查询失败。';
    throw new Error(message);
  }
  return payload.data;
}

function summarizeHourly(rows) {
  const requests = sum(rows, 'requests');
  const pageViews = sum(rows, 'pageViews');
  const bytes = sum(rows, 'bytes');
  const cachedRequests = sum(rows, 'cachedRequests');
  const cachedBytes = sum(rows, 'cachedBytes');
  return {
    requests,
    pageViews,
    bytes,
    cachedRequests,
    cachedBytes,
    hourlyUniqueSum: sum(rows, 'uniques'),
    cacheRate: requests ? cachedRequests / requests : 0
  };
}

function groupByLocalDay(rows) {
  const groups = new Map();
  for (const row of rows) {
    const date = formatLocalDate(row.utcHour);
    const item = groups.get(date) || {
      date,
      requests: 0,
      pageViews: 0,
      bytes: 0,
      hourlyUniqueSum: 0
    };
    item.requests += row.requests;
    item.pageViews += row.pageViews;
    item.bytes += row.bytes;
    item.hourlyUniqueSum += row.uniques;
    groups.set(date, item);
  }
  return [...groups.values()];
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function formatIso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatLocalDate(value) {
  return new Date(new Date(value).getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 10);
}

function formatLocalHour(value) {
  return new Date(new Date(value).getTime() + CHINA_OFFSET_MS)
    .toISOString()
    .slice(0, 13)
    .replace('T', ' ') + ':00';
}

function formatLocalDateTime(value) {
  return new Date(value.getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
