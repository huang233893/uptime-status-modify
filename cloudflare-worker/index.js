// Cloudflare Worker: UptimeRobot API 代理
// 同 Cloudflare 内网，fetch UptimeRobot 极快（通常 <1s）
//
// 部署：
// 1. Cloudflare Dashboard → Workers & Pages → Create → Upload Worker
// 2. 绑定域名：up.sumi233.top/api/uptimerobot
// 3. 设置 Secret Variable：UPTIMEROBOT_API_KEY

const CACHE_TTL_OK = 300;

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

export default {
  async fetch(request, env) {
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
      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders(origin),
      });
    }

    const apiKey = env.UPTIMEROBOT_API_KEY;
    if (!apiKey) {
      return json({ stat: 'fail', error: 'Server 未配置 UPTIMEROBOT_API_KEY' }, 500, origin, false);
    }

    // 解析 days
    const url = new URL(request.url);
    let days = 90;
    if (request.method === 'GET') {
      days = parseInt(url.searchParams.get('days'), 10) || 90;
    } else {
      try {
        const bodyText = await request.text();
        const params = new URLSearchParams(bodyText);
        days = parseInt(params.get('days'), 10) || 90;
      } catch { /* ignore */ }
    }
    days = Math.max(1, Math.min(days, 180));

    // 构造参数
    const dateParams = buildDateParams(days);
    const body = new URLSearchParams();
    body.set('api_key', apiKey);
    body.set('format', 'json');
    body.set('logs', '1');
    body.set('log_types', '1-2');
    body.set('logs_start_date', dateParams.start);
    body.set('logs_end_date', dateParams.end);
    body.set('custom_uptime_ranges', dateParams.ranges);

    // 直接 fetch，让 Cloudflare 自己处理重试/超时
    let resp;
    try {
      resp = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'UptimeStatusProxy/1.0 (Cloudflare Worker)',
        },
        body: body.toString(),
      });
    } catch (err) {
      return json({ stat: 'fail', error: '无法连接 UptimeRobot API: ' + err.message }, 502, origin, false);
    }

    // 流式转发
    const isOk = resp.ok;
    const cacheTtl = isOk ? CACHE_TTL_OK : 60;

    const headers = new Headers();
    headers.set('Content-Type', resp.headers.get('content-type') || 'application/json');
    headers.set('Cache-Control', `s-maxage=${cacheTtl}`);
    headers.set('X-Proxy', 'cloudflare-worker');
    headers.set('X-Proxy-Status', isOk ? 'ok' : 'err');
    headers.set('X-Proxy-Cache-TTL', String(cacheTtl));
    headers.set('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');

    // Cloudflare Worker 直接返回 stream
    return new Response(resp.body, { status: resp.status, headers });
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin === '*' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, origin, cacheable) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheable ? `s-maxage=${CACHE_TTL_OK}` : 'no-store',
      ...corsHeaders(origin),
    },
  });
}
