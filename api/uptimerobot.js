// Vercel Edge Function: UptimeRobot API 代理
// 缓存机制：前端发 GET 请求 → Vercel CDN 根据 Cache-Control 头全局缓存（跨所有 region 共享）

export const config = {
  runtime: 'edge',
};

const CACHE_TTL_OK = 300;        // 成功缓存 5 分钟
const CACHE_TTL_ERR_SHORT = 60;  // 错误缓存 60 秒

export default async function handler(request) {
  try {
    return await main(request);
  } catch (err) {
    return new Response(
      JSON.stringify({ stat: 'fail', error: { type: 'fatal', message: '[Proxy Error] ' + (err?.message || String(err)) } }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }
}

async function main(request) {
  const origin = request.headers.get('origin') || '*';

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin), status: 204 });
  }

  // 支持 GET（推荐，CDN 可缓存）和 POST（降级）
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, origin);
  }

  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  if (!apiKey) {
    return jsonResponse({ stat: 'fail', error: { type: 'config', message: 'Server 未配置 UPTIMEROBOT_API_KEY' } }, 500, origin);
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
    return new Response(upstreamText, {
      status: upstreamStatus,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
      },
    });
  }

  // 决定缓存时长
  const cacheTtl = urBody.stat === 'ok' ? CACHE_TTL_OK : CACHE_TTL_ERR_SHORT;

  return new Response(upstreamText, {
    status: upstreamStatus === 200 ? 200 : upstreamStatus,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      // Vercel CDN 会根据这个头全局缓存 GET 响应
      // 加上 proxy-revalidate 确保 CDN 缓存过期后重新验证
      'Cache-Control': `s-maxage=${cacheTtl}, proxy-revalidate`,
      'X-UR-Stat': urBody.stat || 'unknown',
      'X-Proxy-Cache-TTL': String(cacheTtl),
    },
  });
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
