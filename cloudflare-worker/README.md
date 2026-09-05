# Cloudflare Worker 部署指南

## 为什么要用 Cloudflare Worker 而不是 Vercel Edge Function？

| | Vercel Edge Function | Cloudflare Worker |
|---|---|---|
| **fetch UptimeRobot 速度** | 10-20s（跨区 + 双重 Cloudflare） | **<1s**（同 Cloudflare 内网） |
| **成功率** | ~10% | **99%+** |
| **免费额度** | 10万次/天 | 10万次/天（够用） |
| **你的域** | 需要额外绑定 | 已经在 Cloudflare 上 ✅ |

## 部署步骤（5 分钟）

### 1. 打开 Cloudflare Dashboard

👉 https://dash.cloudflare.com → 选择 `sumi233.top` 这个域

### 2. 创建 Worker

左侧菜单 → **Workers & Pages** → **Create application** → **Create Worker**

- **Name**: `uptime-proxy`
- 点击 **Deploy**

### 3. 粘贴代码

点击新 Worker → **Quick Edit** → 删除默认代码 → 粘贴 `cloudflare-worker/index.js` 的内容 → **Save and Deploy**

### 4. 绑定路径

Worker 页面 → **Triggers** → **Routes** → **Add route**

- **Route**: `up.sumi233.top/api/uptimerobot*`
- **Worker**: 选刚才创建的 `uptime-proxy`
- 保存

### 5. 设置 API Key

Worker 页面 → **Settings** → **Variables and Secrets** → **Add**

- **Type**: Secret
- **Name**: `UPTIMEROBOT_API_KEY`
- **Value**: `ur3131603-4cee34ff0f5df874b0f6d246`
- 保存

### 6. 设置 Cron（可选但推荐）

Worker 页面 → **Triggers** → **Cron Triggers** → **Add**

- **Cron Expression**: `*/4 * * * *`（每 4 分钟）
- **Endpoint**: 自动生成
- 保存

然后在 Worker 代码里加 Cron Handler（或者手动在 Cloudflare 里直接触发）。

### 7. 验证

```bash
curl -w "\nHTTP %{http_code} TTFB=%{time_starttransfer}s\n" \
  "https://up.sumi233.top/api/uptimerobot?days=90"
```

应该看到 **TTFB < 2 秒** 且 **HTTP 200**。多次请求应该**全部 HIT**。

## 前端代码零改动！

Cloudflare Worker 直接绑定到 `/api/uptimerobot`，前端请求路径不变。如果 Cloudflare Worker 正常工作，它会拦截这个请求；如果挂了，Vercel Edge Function 还有兜底（虽然慢但能返回数据）。
