# Uptime-status-modify 3.0

基于 UptimeRobot API 的在线状态面板，由 geekyouth 大佬的原项目修改而来

原项目地址：https://github.com/geekyouth/uptime-status

<img width="1152" alt="image" src="https://raw.githubusercontent.com/huang233893/uptime-status/refs/heads/master/image/2.JPG">

## 手机端截图
![](https://raw.githubusercontent.com/huang233893/uptime-status/refs/heads/master/image/1.JPG)

## 页尾截图
![](https://raw.githubusercontent.com/huang233893/uptime-status/refs/heads/master/image/3.JPG)

# 优势
- 现代化的界面和动画
- 适应式布局
- 网格式览图
- 手机端适配
- 深亮色模式切换

# 3.0 更新内容
- 全新现代化的界面和动画
- 优化时间线显示
- 导航栏重制
- 手机端布局优化
- 底部页脚优化
- Api缓存优化，减少请求次数
- Api刷新优化，减少请求时间
- 修复加载问题，避免页面加载时显示空白屏

# 深亮色模式展示

![亮色模式](https://raw.githubusercontent.com/huang233893/uptime-status/refs/heads/master/image/2.JPG)

![深色模式](https://raw.githubusercontent.com/huang233893/uptime-status/refs/heads/master/image/4.JPG)


# 准备

- 您需要先到 [UptimeRobot](https://uptimerobot.com/ "UptimeRobot") 添加站点监控，并在 My Settings 页面获取 API Key，仅推荐使用ReadOnly API（没有安全问题）
- 推荐使用vercel、netlify进行托管

# 如何部署

- 克隆或者 fork 本仓库
- 修改 `config.js` 文件：
   - `SiteName`: 要显示的网站名称
   - `ApiKeys`: 从 UptimeRobot 获取的 Read-Only API Key
   - `CountDays`: 要显示的日志天数，建议 60 或 90，显示效果比较好
   - `ShowLink`: 是否显示站点链接
   - `Navi`: 导航栏的菜单列表
- 修改 'Index.html' 文件
   - 页脚信息
   - 页脚网站
- 傻瓜式部署到 vercel 或者 netlify

---

# ⚠️ API 限流问题与解决方案（Vercel Edge Function 代理）

## 问题现象

网站频繁显示 **"API 调用频率超限"**（即 `rate_limit_exceeded`）。

## 根本原因

UptimeRobot **FREE 计划**的 API 限制是：**每个 API Key 10 次请求 / 分钟**。

原架构是**浏览器直接调 API** + **localStorage 前端缓存**：
- 每个访客的浏览器有**独立的缓存**（互不共享）
- 一旦缓存过期（15 分钟），新访客或刷新都会再次消耗配额
- 10 个访客 = 配额瞬间打满，之后的人全部看到"数据加载失败"

## 解决方案：Vercel Edge Function 代理

通过在 Vercel 上部署一个 Edge Function，**所有用户共享同一份服务端缓存**：

```
访客 1 ──┐
访客 2 ──┤──→ /api/uptimerobot ──→ Edge Cache ──→ UptimeRobot API
访客 3 ──┘       (Edge Function)    (5分钟共享)     (仅 1 次请求)
```

- **5 分钟内**：无论多少访客，UptimeRobot 只收到 **1 次请求**
- **双重缓存**：服务端 Edge Cache（5 分钟）+ 前端 localStorage（15 分钟）
- **API Key 安全**：Key 不再暴露在前端代码中，仅存于 Vercel 环境变量

## 部署步骤

### 第一步：推送代码到 GitHub

确保以下文件都已提交到仓库：
- `api/uptimerobot.js` — Edge Function 代理代码
- `vercel.json` — Vercel 构建配置

### 第二步：在 Vercel 添加环境变量

1. 打开 Vercel 项目 → **Settings** → **Environment Variables**
2. 点击 **Add New**：
   - **Key**: `UPTIMEROBOT_API_KEY`
   - **Value**: 你的 UptimeRobot Read-Only API Key（例如 `ur3131603-xxxxx`）
   - **Environment**: 勾选 ✅ Production + ✅ Preview + ✅ Development
3. 点击 **Save**

> ⚠️ **注意**：现在 `public/config.js` 里已经不需要 `ApiKeys` 数组了，前端会自动通过代理获取数据。

### 第三步：重新部署

- 如果你用 Vercel Git 集成：push 代码后 Vercel 会自动重新部署
- 如果需要手动触发：Vercel 项目 → **Deployments** → 点击 **Redeploy** → 勾选 **Use existing Build Cache** 旁边的 ⚙️ 清除缓存（首次强制重建）

## 验证方法

部署成功后，打开浏览器 DevTools（F12）→ **Network**，刷新页面，找到 `/api/uptimerobot` 请求，观察响应头：

| 响应头 | 含义 |
|--------|------|
| `X-Proxy-Cache: MISS` | 缓存未命中，Edge Function 实际请求了 UptimeRobot |
| `X-Proxy-Cache: HIT` | 缓存命中，直接返回，**不消耗 UptimeRobot 配额** ✅ |
| `X-Proxy-Cache-TTL` | 当前缓存时长（秒） |
| `X-UR-Stat: ok` | UptimeRobot 返回成功 |

- 第一次刷新：应该是 `MISS`
- **连续快速刷新 10+ 次**：后续全部应该是 `HIT`
- 让多个设备同时访问：都只会消耗 1 次 API 配额

## 代理行为说明

| UptimeRobot 返回 | 代理处理 |
|------------------|----------|
| `stat: ok` | 缓存 5 分钟 |
| `rate_limit_exceeded` | 按 UptimeRobot 说的 `"retry in 19 seconds"` 精确等待后再重试 |
| 其他错误（Key 无效、参数错误等） | 缓存 60 秒，避免刷屏 |

## 切换到其他平台

如果你不想用 Vercel，也可以用同样的思路在其他平台部署代理：

- **Cloudflare Workers**：把 `api/uptimerobot.js` 改写成 Worker 格式（同样用 `caches.default`）
- **自建服务器**：写一个简单的 Express/Koa 反向代理 + node-cache
