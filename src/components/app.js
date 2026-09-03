import { useMemo, useState, useEffect, useCallback } from 'react';
import Header from './header';
import SiteCards from './uptimerobot';
import { GetMonitors } from '../common/uptimerobot';
import dayjs from 'dayjs';

// ===== 缓存策略 =====
// v2: 修复 dayjs 序列化后 .format() 丢失导致白屏
const CACHE_KEY = 'uptime_monitors_cache_v2';
const CACHE_TTL = 15 * 60 * 1000; // 15 分钟

// 把 dayjs 对象转成纯 JSON 可存（daily[].date → 时间戳秒）
function serializeMonitors(monitors) {
  return monitors.map((m) => ({
    ...m,
    daily: m.daily.map((d) => ({
      ...d,
      date: typeof d.date?.unix === 'function' ? d.date.unix() : d.date,
    })),
  }));
}

// 从 JSON 还原（daily[].date → dayjs 对象）
function deserializeMonitors(data) {
  return data.map((m) => ({
    ...m,
    daily: m.daily.map((d) => ({
      ...d,
      date: dayjs.unix(d.date),
    })),
  }));
}

// 正常读取：有 TTL 检查，过期视为无缓存
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (!data || !Array.isArray(data)) return null;
    if (Date.now() - ts > CACHE_TTL) return null;
    return deserializeMonitors(data);
  } catch {
    return null;
  }
}

// 兜底读取：不做 TTL 检查，只要有数据就返回（用于 API 失败时）
function readCacheStale() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (!data || !Array.isArray(data)) return null;
    return { data: deserializeMonitors(data), ts };
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: serializeMonitors(data), ts: Date.now() })
    );
  } catch { /* ignore */ }
}

// 将原始错误转为用户友好的中文描述
function formatError(err) {
  if (!err) return '未知错误';
  if (typeof err === 'string') return err;

  const code = err.code || '';
  const msg = (err.message || '').toLowerCase();
  const upMsg = (err.upError?.message || '').toLowerCase();
  const status = err.response?.status;

  // ===== 限流类（优先级最高）=====
  if (
    status === 429 ||
    upMsg.includes('rate limit') ||
    upMsg.includes('too many') ||
    msg.includes('rate limit') ||
    msg.includes('too many') ||
    msg.includes('exceeded') ||
    msg.includes('quota')
  ) {
    return 'API 调用频率超限（UptimeRobot FREE 计划 10 次/分钟），请稍后重试';
  }

  // axios 网络层错误
  if (code === 'ERR_NETWORK' || msg.includes('network error')) {
    return '网络连接失败，请检查网络后重试';
  }
  if (code === 'ECONNABORTED' || msg.includes('timeout')) {
    return '请求超时，请稍后重试';
  }

  // HTTP 状态码
  if (status === 401 || status === 403) {
    return 'API Key 无效或权限不足，请检查配置';
  }
  if (status === 404) {
    return '请求的接口不存在 (404)';
  }
  if (status >= 500) {
    return `服务端错误 (${status})，请稍后重试`;
  }

  // UptimeRobot API 业务错误
  if (err.upError?.message) return err.upError.message;
  if (err.message) return err.message;
  if (err.msg) return err.msg;

  return '未知错误，请稍后重试';
}

function App() {
  const apikeys = useMemo(() => {
    const { ApiKeys } = window.Config;
    if (Array.isArray(ApiKeys)) return ApiKeys;
    if (typeof ApiKeys === 'string') return [ApiKeys];
    return [];
  }, []);

  const [monitors, setMonitors] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async ({ force = false } = {}) => {
    // 1. 非强制刷新 → 尝试读缓存（无感、无 loading）
    if (!force) {
      const cached = readCache();
      if (cached) {
        setMonitors(cached);
        setError(null);
        setLoading(false);
        return;
      }
    }

    // 2. 没缓存 / 强制刷新 → 请求 API
    setLoading(true);
    setError(null);
    try {
      const { CountDays } = window.Config;
      const results = await Promise.allSettled(
        apikeys.map((key) => GetMonitors(key, CountDays))
      );

      const successful = [];
      let firstError = null;
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value) {
          successful.push(...r.value);
        } else if (!firstError) {
          firstError = r.reason;
        }
      });

      if (successful.length > 0) {
        setMonitors(successful);
        writeCache(successful); // 成功才写缓存
      } else {
        // API 失败 → 无条件尝试旧缓存（哪怕过期很久）
        const old = readCacheStale();
        if (old) {
          setMonitors(old.data);
          const ageMin = Math.round((Date.now() - old.ts) / 60000);
          setError(formatError(firstError) + `（已显示 ${ageMin} 分钟前的缓存数据）`);
        } else {
          setError(formatError(firstError));
        }
      }
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, [apikeys]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <>
      <Header onRefresh={() => fetchAll({ force: true })} />

      <div className='container'>
        {/* 加载遮罩 */}
        {loading && (
          <div className='page-loading'>
            <div className='spinner' />
            <div className='page-loading-text'>正在获取状态数据...</div>
          </div>
        )}

        {/* 错误遮罩 */}
        {!loading && error && (
          <div className='page-error'>
            <div className='page-error-icon'>⚠️</div>
            <div className='page-error-title'>数据加载失败</div>
            <div className='page-error-msg'>{error}</div>
            <button className='page-error-retry' onClick={() => fetchAll({ force: true })}>
              🔄 点击重试
            </button>
          </div>
        )}

        {/* 成功才渲染卡片网格 */}
        {!loading && !error && monitors && monitors.length > 0 && (
          <div id='uptime'>
            <SiteCards monitors={monitors} />
          </div>
        )}

        {/* 无数据 */}
        {!loading && !error && monitors && monitors.length === 0 && (
          <div className='page-error'>
            <div className='page-error-icon'>📭</div>
            <div className='page-error-title'>暂无监控数据</div>
            <div className='page-error-msg'>请检查 UptimeRobot 账户是否已添加监控站点</div>
          </div>
        )}
      </div>
    </>
  );
}

export default App;
