# Uptime-Status

基于 [UptimeRobot](https://uptimerobot.com/) API 的在线状态监控面板 —— 现代化界面、响应式布局、深浅色切换，通过 Vercel Edge Function 代理彻底解决 FREE 计划 10 次/分钟的限流问题。

## ✨ 特性

- 🎨 **现代化 UI**：圆角卡片、时间线状态条、流畅动画
- 📱 **响应式**：桌面端 + 移动端完整适配，浮动菜单 + Portal 弹层
- 🌓 **深浅色模式**：跟随系统偏好，一键切换
- ⚡ **Edge 代理**：Vercel Edge Function 缓存 UptimeRobot API，5 分钟共享缓存，多人同时访问只消耗 1 次配额
- 🔒 **API Key 安全**：Key 仅存于 Vercel 环境变量，前端不暴露
- ⏱️ **防 FOUC**：CSS/React 渲染完成前隐藏 HTML，避免白屏闪烁
- 🎯 **智能重试**：429 限流时按 UptimeRobot 返回的 `retry in N seconds` 精确等待

## 🖼️ 截图

| 亮色模式 | 深色模式 |
|---|---|
| <img width="400" alt="亮色" src="https://raw.githubusercontent.com/huang233893/uptime-status/refs/heads/master/image/2.JPG"> | <img width="400" alt="深色" src="https://raw.githubusercontent.com/huang233893/uptime-status/refs/heads/master/image/4.JPG"> |

## 🚀 快速部署

### 1. Fork / Clone

```bash
git clone https://github.com/your-name/uptime-status.git
cd uptime-status
```

### 2. 修改配置

编辑 `public/config.js`：

```js
window.Config = {
  SiteName: '你的站点名',
  CountDays: 90,        // 日志天数（建议 60-90）
  ShowLink: true,       // 是否显示站点链接
  Navi: [               // 导航栏
    { text: '主页', url: 'https://your-site.com', icon: 'home' },
    { text: 'GitHub', url: 'https://github.com/your-name', icon: 'code' },
  ],
};
```

### 3. 部署到 Vercel

项目根目录已有 `vercel.json`（含 Cron 预热缓存），直接 Vercel 导入即可：

1. **Vercel Dashboard → Import → 选择你的 GitHub 仓库**
2. **Settings → Environment Variables → Add New**：
   - Key: `UPTIMEROBOT_API_KEY`
   - Value: 你的 [UptimeRobot](https://uptimerobot.com/dashboard?#mySettings) **Read-Only API Key**
3. 保存后 Redeploy

> 💡 可选：Vercel Cron 已配置为每 4 分钟自动触发 `/api/uptimerobot?days=90&_cron=1` 预热缓存，确保 CDN 始终有数据。

### 4. 验证

浏览器访问你的 Vercel 域名，打开 DevTools → Network → 看 `/api/uptimerobot` 请求的响应头：

- `X-Proxy-Cache: MISS` — 首次请求，实际调了 UptimeRobot
- `X-Proxy-Source: mem` — 命中 Edge 实例内存缓存
- `X-Proxy-Source: ur` — 刚从 UptimeRobot 拉到的新数据

## 🏗️ 架构

```
访客 ──→ /api/uptimerobot ──┬──→ Edge 内存缓存 (60s)
                            ├──→ Vercel CDN 缓存 (300s)
                            └──→ UptimeRobot API (仅 CDN MISS 时)
```

- **前端**：React + SCSS，`axios` 请求 `/api/uptimerobot?days=90`
- **代理**：`api/uptimerobot.js` — Vercel Edge Runtime，AbortController 8s 超时 + 2 次重试
- **缓存**：成功 5 分钟、失败 60 秒，429 按服务端指示精确等待
- **兜底**：前端 localStorage 存最近 15 分钟缓存，离线也能看

## 🛠️ 本地开发

```bash
npm install
npm start       # http://localhost:3000
npm run build   # 输出到 build/
```

> 本地开发时 Edge Function 无法运行，`/api/uptimerobot` 路径会 404。如需本地调 API，可在 `public/config.js` 临时加上 `ApiKeys: ['ur-你的key']` 并改 `src/common/uptimerobot.js` 直接调 UptimeRobot。

## 📁 目录结构

```
.
├── api/uptimerobot.js     # Vercel Edge Function 代理
├── public/
│   ├── index.html         # HTML 入口 + FOUC 预防
│   ├── config.js          # ⚙️ 你的站点配置
│   └── favicon.ico
├── src/
│   ├── index.js           # React 入口
│   ├── app.scss           # 全局样式
│   ├── common/
│   │   ├── helper.js      # 时间/数字格式化
│   │   └── uptimerobot.js # API 调用 + 响应解析
│   └── components/
│       ├── app.js         # 主组件（加载/错误/渲染）
│       ├── header.js      # 顶部导航 + 移动端浮窗
│       ├── link.js        # 导航链接组件
│       └── uptimerobot.js # 状态卡片
├── vercel.json            # 构建配置 + Cron
└── package.json
```

## ⚠️ 注意事项

- **FREE 计划限流**：UptimeRobot FREE 版 10 次/分钟。本项目通过 Edge Cache 已大幅降低消耗，但 `CountDays` 越大单次请求越重，建议 60-90 天。
- **API Key 安全**：**绝对不要**把 Key 硬编码到前端 JS 里。通过 Vercel 环境变量配置。
- **刷新按钮**：右上角刷新图标会加 `_t=时间戳` 绕过 CDN 缓存强制拉新，正常浏览走 CDN。

## 📝 致谢

- 原版项目：[geekyouth/uptime-status](https://github.com/geekyouth/uptime-status)
- API 服务：[UptimeRobot](https://uptimerobot.com/)
