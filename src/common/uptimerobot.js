import axios from 'axios';
import dayjs from 'dayjs';
import { formatNumber } from './helper';

// ===== UptimeRobot FREE 限流保护 =====
// FREE plan: 10 requests / minute (每 6 秒 1 次)
// 做两件事：
//   1. 发送之间强制间隔 620ms（多 key 串行时不触发 10/min 限制）
//   2. 遇到 429 / stat != ok 带 rate limit 语义 → 指数退避 + 自动重试
const MIN_REQUEST_INTERVAL = 620;   // ms，两次请求之间的最小间隔
const MAX_RETRIES = 2;              // 最多自动重试几次
const BASE_BACKOFF = 4000;          // 指数退避起始：第 1 次等 4s，第 2 次等 8s

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttledRequest(config) {
  // 节流：保证两次请求至少 MIN_REQUEST_INTERVAL
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
      const isRateLimited =
        status === 429 ||
        status === 403 ||
        (err.message || '').toLowerCase().includes('rate limit') ||
        (err.message || '').toLowerCase().includes('too many');

      if (isRateLimited && attempt < MAX_RETRIES) {
        const backoff = BASE_BACKOFF * Math.pow(2, attempt);
        await sleep(backoff);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

async function singleApiKeyFetch(apikey, postdata) {
  const response = await throttledRequest({
    method: 'post',
    url: 'https://api.uptimerobot.com/v2/getMonitors',
    data: new URLSearchParams(postdata).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });

  // API 返回非 ok → 视为失败（可能是限流、key 无效等）
  if (response.data.stat !== 'ok') {
    const err = new Error(response.data.error?.message || response.data.error || 'API 返回异常');
    err.upError = response.data.error;
    throw err;
  }

  return response.data;
}

export async function GetMonitors(apikey, days) {
  const dates = [];
  const today = dayjs(new Date().setHours(0, 0, 0, 0));
  for (let d = 0; d < days; d++) {
    dates.push(today.subtract(d, 'day'));
  }

  const ranges = dates.map((date) => `${date.unix()}_${date.add(1, 'day').unix()}`);
  const start = dates[dates.length - 1].unix();
  const end = dates[0].add(1, 'day').unix();
  ranges.push(`${start}_${end}`);

  const postdata = {
    api_key: apikey,
    format: 'json',
    logs: 1,
    log_types: '1-2',
    logs_start_date: start,
    logs_end_date: end,
    custom_uptime_ranges: ranges.join('-'),
  };

  const data = await singleApiKeyFetch(apikey, postdata);

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
