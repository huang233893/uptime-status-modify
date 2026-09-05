// Vercel Edge Function — UptimeRobot API 代理
// 1. 实例级 1 分钟去重（避免多 POP 同时 fetch 耗尽配额）
// 2. CDN 5 分钟缓存（s-maxage=300）
// 3. 429 智能重试（等 retry-after 时间）

const CACHE_TTL_OK = 300;
const CACHE_TTL_ERR = 60;
const DEDUP_TTL = 60; // 1 分钟去重

// 进程内缓存（同一 Vercel Edge 实例共享）
// 不同 Edge POP 各自独立，但 CDN 缓存会兜底
const memCache = new Map(); // key -> { data, expireAt }

function dedupKey(days) {
  return `ur-${days}`;
}

function getMem(key) {
  const item = memCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expireAt) {
    memCache.delete(key);
    return null;
  }
  return item.data;
}

function setMem(key, data, ttlSec) {
  memCache.set(key, { data, expireAt: Date.now() + ttlSec * 1000 });
}

async function fetchFromUR(apiKey, days) {
  // 计算日期范围
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ranges = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(today.getTime() - i * 86400000);
    const nextDay = new Date(day.getTime() + 86400000);
    const start = Math.floor(day.getTime() / 1000);
    const end = Math.floor(nextDay.getTime() / 1000);
    ranges.push(`${start}_${end}`);
  }
  const firstStart = ranges[ranges.length - 1].split('_')[0];
  const lastEnd = ranges[0].split('_')[1];
  ranges.push(`${firstStart}_${lastEnd}`);

  const params = new URLSearchParams();
  params.set('api_key', apiKey);
  params.set('format', 'json');
  params.set('logs', '1');
  params.set('log_types', '1-2');
  params.set('logs_start_date', firstStart);
  params.set('logs_end_date', lastEnd);
  params.set('custom_uptime_ranges', ranges.join('-'));

  // 最多重试 2 次（3 次总尝试）
  let lastStatus = 0;
  let lastText = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'UptimeStatusProxy/2.1',
      },
      body: params.toString(),
    });

    const text = await resp.text();
    lastStatus = resp.status;
    lastText = text;

    // 成功
    if (resp.ok) {
      return { ok: true, status: resp.status, body: text };
    }

    // 429 限流 —— 等 retry-after 时间
    if (resp.status === 429) {
      let retryAfter = 10;
      try {
        const json = JSON.parse(text);
        if (json.error?.message) {
          const m = json.error.message.match(/retry in (\d+) seconds/i);
          if (m) retryAfter = parseInt(m[1], 10);
        }
      } catch { /* ignore */ }
      const waitMs = Math.min(retryAfter + 1, 15) * 1000; // 最多等 15s
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      // 最后一次还是 429
      return { ok: false, status: 429, body: text, retryAfter };
    }

    // 其他错误（4xx/5xx）不再重试
    return { ok: false, status: resp.status, body: text };
  }

  return { ok: false, status: lastStatus, body: lastText };
}

export default async function handler(request) {
  const origin = request.headers.get('origin') || '*';

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin === '*' ? '*' : origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = process.env.UPTIMEROBOT_API_KEY || env?.UPTIMEROBOT_API_KEY;
  if (!apiKey) {
    return jsonResp({ stat: 'fail', error: 'Server 未配置 UPTIMEROBOT_API_KEY' }, 500, origin, false);
  }

  // 解析 days（忽略 _t 参数，只看 days）
  const url = new URL(request.url);
  let days = 90;
  if (request.method === 'GET') {
    days = parseInt(url.searchParams.get('days'), 10) || 90;
  }
  days = Math.max(1, Math.min(days, 180));

  const cacheKey = dedupKey(days);

  // 1. 内存去重缓存（同一 Edge 实例 1 分钟内只 fetch 一次）
  const memResult = getMem(cacheKey);
  if (memResult) {
    return jsonResp(memResult.data, memResult.status, origin, true, memResult.source || 'mem');
  }

  // 2. fetch UptimeRobot（带 429 重试）
  const result = await fetchFromUR(apiKey, days);

  // 3. 内存缓存（不管成功失败，都缓存避免重复 fetch）
  setMem(cacheKey, { data: result.ok ? JSON.parse(result.body) : { stat: 'fail', ...safeParse(result.body) }, status: result.status, source: 'ur' }, result.ok ? CACHE_TTL_OK : CACHE_TTL_ERR);

  if (result.ok) {
    return new Response(result.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `s-maxage=${CACHE_TTL_OK}`,
        'X-Proxy-Cache': 'MISS',
        'X-Proxy-Status': 'ok',
        'Access-Control-Allow-Origin': origin === '*' ? '*' : origin,
      },
    });
  } else {
    // 失败时短缓存（1 分钟），避免频繁重试消耗配额
    const errData = safeParse(result.body);
    return jsonResp(
      { stat: 'fail', error: errData?.error?.message || `UptimeRobot API 错误 ${result.status}` },
      result.status === 429 ? 429 : 502,
      origin,
      false
    );
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

function jsonResp(data, status, origin, cacheable, cacheSource) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': cacheable ? `s-maxage=${CACHE_TTL_OK}` : `s-maxage=${CACHE_TTL_ERR}`,
    'Access-Control-Allow-Origin': origin === '*' ? '*' : origin,
    'X-Proxy-Status': cacheable ? 'ok' : 'err',
    'X-Proxy-Source': cacheSource || 'ur',
  };
  return new Response(JSON.stringify(data), { status, headers });
}

export const config = {
  runtime: 'experimental-edge',
};
