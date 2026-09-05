// Vercel Serverless Function (Node.js runtime)
// 跑在 AWS Lambda 上，不在 Cloudflare 网络 → UptimeRobot 不限速
// 比 Edge Function 慢一些（冷启动 1-2s）但稳定

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }

  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  if (!apiKey) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ stat: 'fail', error: 'Server 未配置 UPTIMEROBOT_API_KEY' });
    return;
  }

  // 解析 days
  let days = 90;
  if (req.method === 'GET') {
    days = parseInt(req.query.days, 10) || 90;
  } else {
    try {
      days = parseInt(req.body?.days, 10) || 90;
    } catch { /* ignore */ }
  }
  days = Math.max(1, Math.min(days, 180));

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

  // 构造请求体
  const params = new URLSearchParams();
  params.set('api_key', apiKey);
  params.set('format', 'json');
  params.set('logs', '1');
  params.set('log_types', '1-2');
  params.set('logs_start_date', firstStart);
  params.set('logs_end_date', lastEnd);
  params.set('custom_uptime_ranges', ranges.join('-'));

  // 请求 UptimeRobot（用 Node.js https 模块直接请求，不受 CF 限制）
  const https = require('https');
  const urBody = params.toString();

  const urReq = https.request({
    hostname: 'api.uptimerobot.com',
    path: '/v2/getMonitors',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(urBody),
      'User-Agent': 'UptimeStatusProxy/2.0',
    },
  }, (urRes) => {
    let data = '';
    urRes.on('data', (chunk) => { data += chunk; });
    urRes.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', urRes.statusCode === 200 ? 's-maxage=300' : 'no-store');
      res.setHeader('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
      res.status(urRes.statusCode || 200).send(data);
    });
  });

  urReq.on('error', (err) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(502).json({ stat: 'fail', error: '无法连接 UptimeRobot API: ' + err.message });
  });

  urReq.setTimeout(15000, () => {
    urReq.destroy();
    res.setHeader('Content-Type', 'application/json');
    res.status(502).json({ stat: 'fail', error: '请求超时' });
  });

  urReq.write(urBody);
  urReq.end();
}
