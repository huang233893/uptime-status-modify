import axios from 'axios';
import dayjs from 'dayjs';
import { formatNumber } from './helper';

// ===== UptimeRobot API 代理调用 =====
// 通过 Vercel Edge Function 代理 → /api/uptimerobot?days=N
// 代理端自行计算 custom_uptime_ranges 并缓存（5 分钟），URL 极短且稳定

const API_PROXY_URL = '/api/uptimerobot';

const MIN_REQUEST_INTERVAL = 300;
const MAX_RETRIES = 2;
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(err) {
  const msg = (err.message || '') + ' ' + (err.upError?.message || '');
  const match = msg.match(/retry in (\d+)\s*seconds/);
  if (match) return parseInt(match[1], 10) * 1000;
  const retryAfter = err.response?.headers?.['retry-after'];
  if (retryAfter) {
    const sec = parseInt(retryAfter, 10);
    if (!isNaN(sec)) return sec * 1000;
  }
  return 0;
}

async function throttledRequest(config) {
  const now = Date.now();
  const waitMs = MIN_REQUEST_INTERVAL - (now - lastRequestAt);
  if (waitMs > 0) await sleep(waitMs);

  let attempt = 0;
  while (true) {
    lastRequestAt = Date.now();
    try {
      return await axios(config);
    } catch (err) {
      const status = err.response?.status;
      const msg = (err.message || '').toLowerCase();
      const upMsg = (err.upError?.message || '').toLowerCase();

      const isRateLimited =
        status === 429 ||
        msg.includes('rate limit') ||
        msg.includes('too many') ||
        msg.includes('exceeded') ||
        upMsg.includes('rate_limit_exceeded');

      if (isRateLimited && attempt < MAX_RETRIES) {
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

async function fetchFromProxy(days) {
  const url = `${API_PROXY_URL}?days=${days}`;
  const response = await throttledRequest({
    method: 'get',
    url,
    timeout: 20000,
  });

  if (response.data.stat !== 'ok') {
    const err = new Error(response.data.error?.message || response.data.error || 'API 返回异常');
    err.upError = response.data.error;
    throw err;
  }

  return response.data;
}

/**
 * 获取监控数据
 * @param {number} days - 天数
 * @returns {Array} 处理后的监控数据数组
 */
export async function GetMonitors(days) {
  // 前端仍然需要计算 dates 数组，用于后续解析响应时的 daily 映射
  const dates = [];
  const today = dayjs(new Date().setHours(0, 0, 0, 0));
  for (let d = 0; d < days; d++) {
    dates.push(today.subtract(d, 'day'));
  }

  const data = await fetchFromProxy(days);

  return data.monitors.map((monitor) => {
    // UptimeRobot 返回的 custom_uptime_ranges：天数个每日range + 1个总体平均range
    const ranges = monitor.custom_uptime_ranges.split('-');
    const average = formatNumber(ranges.pop()); // 最后一个是总体平均
    const daily = [];
    const map = [];

    dates.forEach((date, index) => {
      map[date.format('YYYYMMDD')] = index;
      daily[index] = {
        date: date,
        uptime: formatNumber(ranges[index]),
        down: { times: 0, duration: 0 },
      };
    });

    const total = monitor.logs.reduce((total, log) => {
      if (log.type === 1) {
        const date = dayjs.unix(log.datetime).format('YYYYMMDD');
        total.duration += log.duration;
        total.times += 1;
        if (map[date] !== undefined) {
          daily[map[date]].down.duration += log.duration;
          daily[map[date]].down.times += 1;
        }
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
