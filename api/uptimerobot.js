// Vercel Edge Function: UptimeRobot API 代理
// 核心：用 caches.default 显式缓存（POST 请求不会被 Vercel CDN 自动缓存）
// 所有用户共享同一份缓存 → 彻底解决多用户触发 UptimeRobot FREE 限流问题

export const config = {
  runtime: 'edge',
};

const CACHE_TTL_OK = 300;           // 成功响应缓存 5 分钟
const CACHE_TTL_ERR_SHORT = 60;     // 普通错误缓存 60 秒
const CACHE_TTL_ERR_LONG = 900;     // 限流错误最长缓存 15 分钟

export default async function handler(request) {
  const origin = request.headers.get('origin') || '*';

  // ========== CORS 预检 ==========
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders(origin),
      status: 204,
    });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, origin);
  }

  // ========== 环境变量校验 ==========
  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      { stat: 'fail', error: { type: 'config', message: 'Server 未配置 UPTIMEROBOT_API_KEY 环境变量' } },
      500,
      origin
    );
  }

  // ========== 解析请求参数 ==========
  const url = new URL(request.url);
  const upstreamData = new URLSearchParams();
  upstreamData.set('api_key', apiKey);
  upstreamData.set('format', 'json');

  if (request.method === 'POST') {
    try {
      const bodyText = await request.text();
      const params = new URLSearchParams(bodyText);
      for (const [key, value] of params) {
        if (key !== 'api_key') upstreamData.set(key, value);
      }
    } catch { /* ignore */ }
  } else {
    for (const [key, value] of url.searchParams) {
      if (key !== 'api_key') upstreamData.set(key, value);
    }
  }

  // ========== 构造缓存 Key ==========
  // 用虚拟 URL + 参数串做 key，确保不同参数组合各自缓存
  const paramsString = upstreamData.toString();
  const cacheKey = new Request('https://uptimerobot-proxy.local/?' + paramsString, { method: 'GET' });

  // ========== 查缓存 ==========
  const cache = caches.default;
  let cachedResponse = null;

  try {
    cachedResponse = await cache.match(cacheKey);
  } catch { /* 缓存不可用时降级 */ }

  if (cachedResponse) {
    // 命中！加上 HIT 标记
    const headers = new Headers(cachedResponse.headers);
    headers.set('X-Proxy-Cache', 'HIT');
    headers.set('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
    return new Response(cachedResponse.body, { status: cachedResponse.status, headers });
  }

  // ========== 缓存未命中 → 请求 UptimeRobot ==========
  let upstreamResponse;
  try {
    upstreamResponse = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: upstreamData.toString(),
    });
  } catch (fetchErr) {
    return jsonResponse(
      { stat: 'fail', error: { type: 'network', message: '无法连接 UptimeRobot API' } },
      502,
      origin
    );
  }

  const text = await upstreamResponse.text();

  // ========== 解析响应，决定缓存时长 ==========
  let cacheTtl = CACHE_TTL_OK;
  let urBody;

  try {
    urBody = JSON.parse(text);
  } catch {
    // 非 JSON —— 不缓存，直接透传
    return new Response(text, {
      status: upstreamResponse.status,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': upstreamResponse.headers.get('content-type') || 'text/plain',
        'Cache-Control': 'no-store',
        'X-Proxy-Cache': 'MISS',
      },
    });
  }

  if (urBody.stat === 'ok') {
    cacheTtl = CACHE_TTL_OK;
  } else if (urBody.error?.type === 'rate_limit_exceeded') {
    // 限流 —— 用 UptimeRobot 说的重试时间
    const match = (urBody.error.message || '').match(/retry in (\d+)\s*seconds/);
    if (match) {
      const retrySec = parseInt(match[1], 10);
      cacheTtl = Math.min(retrySec + 30, CACHE_TTL_ERR_LONG);
    } else {
      cacheTtl = CACHE_TTL_ERR_SHORT;
    }
  } else {
    cacheTtl = CACHE_TTL_ERR_SHORT;
  }

  // ========== 构造最终响应（用于返回 + 存缓存）==========
  const response = new Response(text, {
    status: upstreamResponse.status === 200 ? 200 : upstreamResponse.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `s-maxage=${cacheTtl}`,
      'X-Proxy-Cache': 'MISS',
      'X-Proxy-Cache-TTL': String(cacheTtl),
      'X-UR-Stat': urBody.stat || 'unknown',
      ...corsHeaders(origin),
    },
  });

  // ========== 存入 Edge Cache ==========
  try {
    // 克隆一份存缓存（因为 Response body 是流式的，不能读两次）
    await cache.put(cacheKey, response.clone());
  } catch { /* 缓存存失败不影响返回 */ }

  return response;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin === '*' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
