window.Config = {
  // 显示标题
  SiteName: '酥米网页监测站',

  // ==== API Key 配置 ====
  // 在 Vercel 项目 Settings → Environment Variables 中添加：
  //   Key:   UPTIMEROBOT_API_KEY
  //   Value: 你的 UptimeRobot Read-Only API Key
  // 前端会通过 /api/uptimerobot 代理自动获取数据，不再直接持有 Key

  // 日志天数（建议 60-90）
  CountDays: 90,

  // 是否显示检测站点的链接
  ShowLink: true,

  // 导航栏菜单
  Navi: [
    { text: '主页',   url: 'https://example.com', icon: 'home' },
    { text: 'GitHub', url: 'https://github.com',  icon: 'code' },
    { text: '博客',   url: 'https://example.com', icon: 'article' },
  ],
};
