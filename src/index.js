import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/app';
import './app.scss';

const root = ReactDOM.createRoot(document.getElementById('app'));

root.render(<App />);

// React 18 的 render 是异步批处理，下一帧才真正提交到 DOM
// 用 requestAnimationFrame 确保 DOM 已经更新好再显示页面
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.documentElement.classList.add('loaded');
  });
});

// 兜底：最多 3 秒后强制显示，防止 JS 执行异常导致永远白屏
setTimeout(() => {
  document.documentElement.classList.add('loaded');
}, 3000);
