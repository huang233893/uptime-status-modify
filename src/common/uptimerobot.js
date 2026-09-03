import axios from 'axios';
import dayjs from 'dayjs';
import { formatNumber } from './helper';

// ===== UptimeRobot API 代理调用 =====
// 通过 Vercel Edge Function 代理 → /api/uptimerobot
// 代理端做了服务端缓存（5 分钟），所有用户共享一份缓存，彻底解决多用户触发限流问题
// 前端仍保留节流和重试逻辑作为第二道防线

const API_PROXY_URL = '/api/uptimerobot';

// 节流：两次请求之间至少间隔（针对同页面内多次刷新）
const MIN_REQUEST_INTERVAL = 300;
const MAX_RETRIES = 2;

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 从错误消息里解析 retry in X seconds，算出该等多久
function parseRetryAfter(err) {
  const msg = (err.message || '') + ' ' + (err.upError?.message || '');
  const match = msg.match(/retry in (\d+)\s*seconds/);
  if (match) return parseInt(match[1], 10) * 1000;
  // 退而求其次：HTTP Retry-After 头
  const retryAfter = err.response?.headers?.['retry-after'];
  if (retryAfter) {
    const sec = parseInt(retryAfter, 10);
    if (!isNaN(sec)) return sec * 1000;
  }
  return 0;
}

async function throttledRequest(config) {
  // 节流
  const now = Date.now();
  const waitMs = MIN_REQUEST_INTERVAL - (now - lastRequestAt);
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  let attempt = 0;
  while (true) {
    lastRequestAt = Date.now();
    try {
      return await axios(config);
    } catch (err) {
      const status = err.response?.status;
      const msg = (err.message || '').toLowerCase();
      const upMsg = (err.upError?.message || '').toLowerCase();

      // 限流判定：429 + 含 rate limit / too many / exceeded 关键词
      // 注意：403 不再视为限流（403 更可能是权限/Key 问题，重试没用）
      const isRateLimited =
        status === 429 ||
        msg.includes('rate limit') ||
        msg.includes('too many') ||
        msg.includes('exceeded') ||
        upMsg.includes('rate_limit_exceeded');

      if (isRateLimited && attempt < MAX_RETRIES) {
        // 优先用 UptimeRobot 告诉我们的重试时间
        const serverWait = parseRetryAfter(err);
        const backoff = serverWait > 0 ? serverWait : 4000 * Math.pow(2, attempt);
        await sleep(backoff);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

async function fetchFromProxy(postdata) {
  // 用 GET 方法 + query params → Vercel CDN 会根据 Cache-Control 自动做全局缓存
  const query = new URLSearchParams(postdata).toString();
  const url = query ? `${API_PROXY_URL}?${query}` : API_PROXY_URL;

  const response = await throttledRequest({
    method: 'get',
    url,
    timeout: 15000,
  });

  if (response.data.stat !== 'ok') {
    const err = new Error(response.data.error?.message || response.data.error || 'API 返回异常');
    err.upError = response.data.error;
    throw err;
  }

  return response.data;
}

export async function GetMonitors(days) {
  const dates = [];
  const today = dayjs(new Date().setHours(0, 0, 0, 0));
  for (let d = 0; d < days; d++) {
    dates.push(today.subtract(d, 'day'));
  }

  const ranges = dates.map((date) => `${date.unix()}_${date.add(1, 'day').unix()}`);
  const start = dates[dates.length - 1].unix();
  const end = dates[0].add(1, 'day').unix();
  ranges.push(`${start}_${end}`);

  // api_key 由 Vercel Edge Function 代理从服务端环境变量注入，前端不再传递
  const postdata = {
    format: 'json',
    logs: 1,
    log_types: '1-2',
    logs_start_date: start,
    logs_end_date: end,
    custom_uptime_ranges: ranges.join('-'),
  };

  const data = await fetchFromProxy(postdata);

  return data.monitors.map((monitor) => {
    const ranges = monitor.custom_uptime_ranges.split('-');
    const average = formatNumber(ranges.pop());
    const daily = [];
    const map = [];
    dates.forEach((date, index) => {
      map[date.format('YYYYMMDD')] = index;
      daily[index] = {
        date: date,
        uptime: formatNumber(ranges[index]),
        down: { times: 0, duration: 0 },
      }
    });

    const total = monitor.logs.reduce((total, log) => {
      if (log.type === 1) {
        const date = dayjs.unix(log.datetime).format('YYYYMMDD');
        total.duration += log.duration;
        total.times += 1;
        daily[map[date]].down.duration += log.duration;
        daily[map[date]].down.times += 1;
      }
      return total;
    }, { times: 0, duration: 0 });

    const result = {
      id: monitor.id,
      name: monitor.friendly_name,
      url: monitor.url,
      average: average,
      daily: daily,
      total: total,
      status: 'unknow',
    };

    if (monitor.status === 2) result.status = 'ok';
    if (monitor.status === 9) result.status = 'down';
    return result;
  });
}
