import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from './link';

function Header({ onRefresh }) {
  const [darkMode, setDarkMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const closingTimer = useRef(null);

  const handleRefresh = () => {
    if (refreshing || !onRefresh) return;
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 800);
  };

  // 初始化深色模式
  useEffect(() => {
    const isDark = localStorage.getItem('darkMode') === 'true' ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setDarkMode(isDark);
    if (isDark) document.body.classList.add('dark-mode');
  }, []);

  // 切换深色模式
  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('darkMode', newMode);
    document.body.classList.toggle('dark-mode', newMode);
  };

  // 打开浮窗
  const openMenu = () => {
    if (closingTimer.current) {
      clearTimeout(closingTimer.current);
      closingTimer.current = null;
    }
    setClosing(false);
    setMenuOpen(true);
    document.body.style.overflow = 'hidden';
  };

  // 关闭浮窗（带退出动画）
  const closeMenu = () => {
    if (closing) return;
    setClosing(true);
    // 等 CSS 退出动画（0.22s）播完再真正卸载
    closingTimer.current = setTimeout(() => {
      setMenuOpen(false);
      setClosing(false);
      document.body.style.overflow = '';
      closingTimer.current = null;
    }, 220);
  };

  // 刷新后关闭：先让旋转动画播一会再退出
  const refreshAndClose = () => {
    handleRefresh();
    setTimeout(closeMenu, 400);
  };

  // ESC 关闭
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && menuOpen) closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, closing]);

  useEffect(() => {
    document.title = window.Config.SiteName;
  }, []);

  useEffect(() => () => {
    if (closingTimer.current) clearTimeout(closingTimer.current);
  }, []);

  // 只有 menuOpen 时才渲染 portal；closing 状态用 className 控制退出动画
  const popup = menuOpen && createPortal(
    <div className={`nav-popup-wrap${closing ? ' closing' : ''}`} onClick={closeMenu}>
      <div className={`nav-popup${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        {/* 关闭按钮 */}
        <button className='nav-popup-close' onClick={closeMenu} aria-label='关闭菜单'>
          <span className='material-symbols-outlined'>close</span>
        </button>

        {/* 导航链接 */}
        <div className='nav-popup-links'>
          {window.Config.Navi.map((item, index) => (
            <Link
              key={index}
              to={item.url}
              text={item.text}
              icon={item.icon || null}
              onClick={closeMenu}
            />
          ))}
        </div>

        {/* 底部工具按钮 */}
        <div className='nav-popup-tools'>
          <button
            className={`nav-btn nav-refresh ${refreshing ? 'spinning' : ''}`}
            onClick={refreshAndClose}
            title='忽略缓存，重新从 API 拉取'
          >
            <span className='material-symbols-outlined'>refresh</span>
          </button>
          <button className='nav-btn' onClick={toggleDarkMode} title='切换主题'>
            <span className='material-symbols-outlined'>
              {darkMode ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      <div id='header'>
        <div className='container'>
          <h1 className='logo'>{window.Config.SiteName}</h1>

          {/* 桌面端：居中的导航链接 */}
          <div className='nav-links'>
            {window.Config.Navi.map((item, index) => (
              <Link key={index} to={item.url} text={item.text} icon={item.icon || null} />
            ))}
          </div>

          {/* 桌面端：右侧按钮组 */}
          <div className='nav-actions'>
            <button
              className={`nav-btn nav-refresh ${refreshing ? 'spinning' : ''}`}
              onClick={handleRefresh}
              title='忽略缓存，重新从 API 拉取'
              aria-label='强制刷新'
            >
              <span className='material-symbols-outlined'>refresh</span>
            </button>
            <button
              className='nav-btn theme-toggle'
              onClick={toggleDarkMode}
              aria-label={darkMode ? '切换到亮色模式' : '切换到暗色模式'}
            >
              <span className='material-symbols-outlined'>
                {darkMode ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
          </div>

          {/* 汉堡菜单按钮（移动端显示） */}
          <button
            className='nav-btn menu-toggle'
            onClick={openMenu}
            aria-label='打开菜单'
          >
            <span className='material-symbols-outlined'>menu</span>
          </button>
        </div>
      </div>

      {/* Portal 到 document.body — 脱离 #header 的层叠上下文 */}
      {popup}
    </>
  );
}

export default Header;
