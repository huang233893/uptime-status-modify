// Vercel Edge Function: UptimeRobot API 代理
// 核心优化：直接流式转发上游响应，不做任何缓冲/解析
// - 去掉 resp.text() + JSON.parse() 的三重内存开销
// - 用 HTTP 状态码决定缓存（200 = 5min, 非200 = no-store）
// - 10s AbortController 超时快速失败，让前端 stale-while-revalidate 接管

export const config = {
  runtime: 'edge',
};

const CACHE_TTL_OK = 300;
const FETCH_TIMEOUT_MS = 20000;  // 放宽到 20s，配合 Cron 预热

function buildDateParams(days) {
  const d = parseInt(days, 10) || 90;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const ranges = [];
  for (let i = 0; i < d; i++) {
    const day = new Date(today.getTime() - i * 86400000);
    const nextDay = new Date(day.getTime() + 86400000);
    const start = Math.floor(day.getTime() / 1000);
    const end = Math.floor(nextDay.getTime() / 1000);
    ranges.push(`${start}_${end}`);
  }

  const firstStart = ranges[ranges.length - 1].split('_')[0];
  const lastEnd = ranges[0].split('_')[1];
  ranges.push(`${firstStart}_${lastEnd}`);

  return {
    ranges: ranges.join('-'),
    start: firstStart,
    end: lastEnd,
  };
}

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

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin), status: 204 });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, origin);
  }

  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  if (!apiKey) {
    return jsonResponse({ stat: 'fail', error: { type: 'config', message: 'Server 未配置 UPTIMEROBOT_API_KEY' } }, 500, origin);
  }

  // ========== 1. 解析 days ==========
  const url = new URL(request.url);
  let days = 90;

  if (request.method === 'POST') {
    try {
      const bodyText = await request.text();
      const params = new URLSearchParams(bodyText);
      days = parseInt(params.get('days'), 10) || 90;
    } catch { /* ignore */ }
  } else {
    days = parseInt(url.searchParams.get('days'), 10) || 90;
  }
  days = Math.max(1, Math.min(days, 180));

  // ========== 2. 构造上游请求参数 ==========
  const dateParams = buildDateParams(days);
  const upstreamData = new URLSearchParams();
  upstreamData.set('api_key', apiKey);
  upstreamData.set('format', 'json');
  upstreamData.set('logs', '1');
  upstreamData.set('log_types', '1-2');
  upstreamData.set('logs_start_date', dateParams.start);
  upstreamData.set('logs_end_date', dateParams.end);
  upstreamData.set('custom_uptime_ranges', dateParams.ranges);

  // ========== 3. 带超时的 fetch ==========
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: upstreamData.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    return jsonResponse(
      { stat: 'fail', error: { type: 'network', message: '无法连接 UptimeRobot API: ' + (err?.message || '') } },
      502, origin
    );
  } finally {
    clearTimeout(timeout);
  }

  // ========== 4. 直接流式转发 ==========
  // 200 OK → 缓存 5 分钟；非 200 → 不缓存
  const isOk = resp.status === 200;
  const cacheControl = isOk ? `s-maxage=${CACHE_TTL_OK}` : 'no-store';

  const headers = new Headers(resp.headers);
  headers.delete('connection');
  headers.delete('cf-cache-status');
  headers.delete('server');
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Proxy-Status', isOk ? 'ok' : 'err');
  headers.set('X-Proxy-Cache-TTL', String(CACHE_TTL_OK));
  // 添加 CORS
  headers.set('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');

  // 关键：直接把 ReadableStream body 传给 Response，零缓冲零解析
  return new Response(resp.body, {
    status: resp.status,
    headers,
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
