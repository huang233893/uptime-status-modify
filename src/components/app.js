import { useState, useEffect, useCallback } from 'react';
import Header from './header';
import SiteCards from './uptimerobot';
import { GetMonitors } from '../common/uptimerobot';
import dayjs from 'dayjs';

// ===== 缓存策略 =====
const CACHE_KEY = 'uptime_monitors_cache_v2';
const CACHE_TTL = 15 * 60 * 1000; // 15 分钟
const ERROR_LOG_KEY = 'uptime_error_log';

function serializeMonitors(monitors) {
  return monitors.map((m) => ({
    ...m,
    daily: m.daily.map((d) => ({
      ...d,
      date: typeof d.date?.unix === 'function' ? d.date.unix() : d.date,
    })),
  }));
}

function deserializeMonitors(data) {
  return data.map((m) => ({
    ...m,
    daily: m.daily.map((d) => ({
      ...d,
      date: dayjs.unix(d.date),
    })),
  }));
}

function readCache() {
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

// 错误日志（存最后 5 条）
function logError(err) {
  try {
    const prev = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]');
    prev.unshift({
      time: new Date().toISOString(),
      message: err?.message || String(err),
      upError: err?.upError || null,
      status: err?.response?.status || null,
    });
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(prev.slice(0, 5)));
  } catch { /* ignore */ }
}

function formatError(err) {
  if (!err) return '未知错误';
  if (typeof err === 'string') return err;

  const code = err.code || '';
  const msg = (err.message || '').toLowerCase();
  const upMsg = (err.upError?.message || '').toLowerCase();
  const status = err.response?.status;

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

  if (code === 'ERR_NETWORK' || msg.includes('network error')) {
    return '网络连接失败，请检查网络后重试';
  }
  if (code === 'ECONNABORTED' || msg.includes('timeout')) {
    return '请求超时，请稍后重试';
  }

  if (status === 401 || status === 403) {
    return 'API Key 无效或权限不足，请检查配置';
  }
  if (status === 404) {
    return '请求的接口不存在 (404)';
  }
  if (status >= 500) {
    return `服务端错误 (${status})，请稍后重试`;
  }

  if (err.upError?.message) return err.upError.message;
  if (err.message) return err.message;
  return '未知错误，请稍后重试';
}

function App() {
  const { CountDays } = window.Config;

  const [monitors, setMonitors] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // 错误 banner 15 秒后自动消失（全屏错误弹窗不会自动消失）
  useEffect(() => {
    if (error && monitors && monitors.length > 0) {
      const t = setTimeout(() => setError(null), 15000);
      return () => clearTimeout(t);
    }
  }, [error, monitors]);

  /**
   * 核心数据获取逻辑 —— stale-while-revalidate 模式
   * 1. 有任何缓存（哪怕过期）→ 立即显示 → 后台静默刷新
   * 2. 完全没缓存 → 显示 loading → 请求 API
   */
  const fetchAll = useCallback(async ({ force = false } = {}) => {
    const cached = readCache();
    const hasCache = !!cached;
    const cacheExpired = hasCache && (Date.now() - cached.ts > CACHE_TTL);

    if (force) {
      // 强制刷新：清空缓存判断，请求时加 _t= 绕过 CDN 缓存
      setLoading(true);
      setError(null);
      await doFetch(CountDays, { force: true });
      return;
    }

    if (hasCache) {
      // 有缓存 → 立即显示（不管是否过期）
      setMonitors(cached.data);
      setError(null);
      setLoading(false);

      // 缓存还新鲜 → 直接返回，不请求 API
      if (!cacheExpired) return;

      // 缓存过期但有值 → 后台静默刷新（不显示 loading）
      try {
        await doFetch(CountDays, { silent: true });
      } catch {
        // 静默刷新失败没关系，用户还能看到缓存数据
      }
      return;
    }

    // 完全没缓存 → 正常请求流程
    setLoading(true);
    setError(null);
    await doFetch(CountDays);
  }, []);

  /**
   * 实际请求 API 的内部函数
   */
  async function doFetch(days, { silent = false, force = false } = {}) {
    try {
      const results = await Promise.allSettled([GetMonitors(days, { force })]);

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
        writeCache(successful);
        if (!silent) {
          setError(null);
        }
      } else {
        // API 失败
        logError(firstError);
        if (!silent) {
          const cached = readCache();
          if (cached) {
            // 有过期缓存 → 显示缓存 + 轻微错误提示
            setMonitors(cached.data);
            const ageMin = Math.round((Date.now() - cached.ts) / 60000);
            setError(formatError(firstError) + `（已显示 ${ageMin} 分钟前的缓存数据）`);
          } else {
            // 完全没缓存 → 显示完整错误
            setError(formatError(firstError));
          }
        }
      }
    } catch (e) {
      logError(e);
      if (!silent) {
        setError(formatError(e));
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <>
      <Header onRefresh={() => fetchAll({ force: true })} />

      <div className='container'>
        {/* 加载遮罩（只在完全没缓存时出现） */}
        {loading && (
          <div className='page-loading'>
            <div className='spinner' />
            <div className='page-loading-text'>正在获取状态数据...</div>
          </div>
        )}

        {/* 错误遮罩（只在完全没数据时出现） */}
        {!loading && error && monitors && monitors.length > 0 && (
          <div className='page-error-banner'>{error}</div>
        )}
        {!loading && error && (!monitors || monitors.length === 0) && (
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
        {!loading && monitors && monitors.length > 0 && (
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
