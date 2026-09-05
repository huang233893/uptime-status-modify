// Vercel Edge Function: UptimeRobot API 代理
// 缓存机制：前端发 GET ?days=90 → URL 极短 → Vercel CDN + Cloudflare 全局缓存
// 所有用户在同一天内共享同一份缓存 → 90 天参数每天只生成 1 个缓存 key

export const config = {
  runtime: 'edge',
};

const CACHE_TTL_OK = 300;        // 成功缓存 5 分钟
const CACHE_TTL_ERR_SHORT = 60;  // 错误缓存 60 秒

/**
 * 根据天数计算 custom_uptime_ranges 和 logs_start_date/end_date
 * 返回 { ranges: ['start_end', ...], start, end }
 */
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

  // 总体范围（用于获取 logs）
  const firstStart = ranges[ranges.length - 1].split('_')[0];
  const lastEnd = ranges[0].split('_')[1];
  // 附加一个全部的平均 range
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

  // ========== 1. 解析请求，只保留 days 参数 ==========
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

  days = Math.max(1, Math.min(days, 180)); // 限制 1-180 天

  // ========== 2. 在服务端计算日期范围 ==========
  const dateParams = buildDateParams(days);

  // ========== 3. 构造 UptimeRobot 请求 ==========
  const upstreamData = new URLSearchParams();
  upstreamData.set('api_key', apiKey);
  upstreamData.set('format', 'json');
  upstreamData.set('logs', '1');
  upstreamData.set('log_types', '1-2');
  upstreamData.set('logs_start_date', dateParams.start);
  upstreamData.set('logs_end_date', dateParams.end);
  upstreamData.set('custom_uptime_ranges', dateParams.ranges);

  // ========== 4. 请求 UptimeRobot ==========
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

  // ========== 5. 解析并决定缓存时长 ==========
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

  const cacheTtl = urBody.stat === 'ok' ? CACHE_TTL_OK : CACHE_TTL_ERR_SHORT;

  return new Response(upstreamText, {
    status: upstreamStatus === 200 ? 200 : upstreamStatus,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': `s-maxage=${cacheTtl}`,
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
