// Vercel Edge Function: UptimeRobot API 代理
// 所有用户共享同一份服务端缓存 → 彻底解决多用户触发 UptimeRobot FREE 限流问题

export const config = {
  runtime: 'edge',
};

const CACHE_TTL_OK = 300;        // 成功缓存 5 分钟
const CACHE_TTL_ERR_SHORT = 60;  // 错误缓存 60 秒

// 安全地获取 caches.default（Vercel Edge / Cloudflare Worker 缓存 API）
// 如果运行环境不支持，返回 null，后续逻辑自动降级为"不缓存但正常转发"
function getCache() {
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      return caches.default;
    }
  } catch { /* ignore */ }
  return null;
}

export default async function handler(request) {
  // ========== 全局兜底 try-catch（防止任何未捕获崩溃导致 500）==========
  try {
    return await main(request);
  } catch (err) {
    return new Response(
      JSON.stringify({
        stat: 'fail',
        error: {
          type: 'fatal',
          message: '[Proxy Internal Error] ' + (err?.message || String(err)),
        },
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}

async function main(request) {
  const origin = request.headers.get('origin') || '*';

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin), status: 204 });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, origin);
  }

  // 环境变量
  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      { stat: 'fail', error: { type: 'config', message: 'Server 未配置 UPTIMEROBOT_API_KEY' } },
      500, origin
    );
  }

  // 解析请求参数
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

  // 构造缓存 key（虚拟 URL，method 必须是 GET 才能被 Cache API 匹配）
  const cacheKey = new Request('https://proxy.local/?' + upstreamData.toString(), { method: 'GET' });
  const cache = getCache();

  // 查缓存
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const headers = new Headers(hit.headers);
        headers.set('X-Proxy-Cache', 'HIT');
        headers.set('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
        return new Response(hit.body, { status: hit.status, headers });
      }
    } catch { /* 缓存查失败 → 当作没命中 */ }
  }

  // 请求 UptimeRobot
  let upstreamText = '';
  let upstreamStatus = 200;
  let urBody;

  try {
    const resp = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: upstreamData.toString(),
    });
    upstreamStatus = resp.status;
    upstreamText = await resp.text();
  } catch (fetchErr) {
    return jsonResponse(
      { stat: 'fail', error: { type: 'network', message: '无法连接 UptimeRobot API: ' + (fetchErr?.message || '') } },
      502, origin
    );
  }

  // 解析
  try {
    urBody = JSON.parse(upstreamText);
  } catch {
    // 非 JSON → 直接透传不缓存
    return new Response(upstreamText, {
      status: upstreamStatus,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
        'X-Proxy-Cache': 'MISS',
      },
    });
  }

  // 决定缓存时长
  let cacheTtl = CACHE_TTL_OK;
  if (urBody.stat !== 'ok') {
    cacheTtl = CACHE_TTL_ERR_SHORT;
  }

  // 构造响应
  const response = new Response(upstreamText, {
    status: upstreamStatus === 200 ? 200 : upstreamStatus,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': `s-maxage=${cacheTtl}`,
      'X-Proxy-Cache': 'MISS',
      'X-Proxy-Cache-TTL': String(cacheTtl),
      'X-UR-Stat': urBody.stat || 'unknown',
    },
  });

  // 存缓存（如果可用）
  if (cache) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch { /* 存失败不影响返回 */ }
  }

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
