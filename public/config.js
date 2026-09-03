window.Config = {
  // 显示标题
  SiteName: '酥米的网页检测小站',

  // ==== API Key 已移至 Vercel 环境变量 ====
  // 在 Vercel 项目 Settings → Environment Variables 中添加：
  //   Key:   UPTIMEROBOT_API_KEY
  //   Value: 你的 UptimeRobot API Key
  // 前端会通过 /api/uptimerobot 代理自动获取数据，不再直接持有 Key

  // 日志天数
  CountDays: 90,

  // 是否显示检测站点的链接
  ShowLink: true,

  // 导航栏菜单
  Navi: [
    {
      text: '主页',
      url: 'https://up.sumi233.top',
      icon: 'home'
    },
    {
      text: 'GitHub',
      url: 'https://github.com/huang233893/uptime-status-modify',
      icon: 'code'
    },
    {
      text: '博客',
      url: 'https://www.sumi233.top',
      icon: 'article'
    },
  ],
};
