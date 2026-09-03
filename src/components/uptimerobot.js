import ReactTooltip from 'react-tooltip';
import { formatDuration, formatNumber } from '../common/helper';
import Link from './link';

function SiteCards({ monitors }) {
  const statusMap = {
    ok: '正常',
    down: '无法访问',
    unknow: '未知'
  };

  const { CountDays, ShowLink } = window.Config;

  return monitors.map((site, idx) => (
    <div
      key={site.id}
      className={'site site-' + site.status}
      style={{ animationDelay: `${0.06 + idx * 0.06}s` }}
    >
      {/* 左侧状态色条 */}
      <div className='site-accent' />

      {/* 顶部：名称 + 状态徽章 */}
      <div className='site-header'>
        <span className='site-name' dangerouslySetInnerHTML={{ __html: site.name }} />
        <span className={'site-status ' + site.status}>{statusMap[site.status]}</span>
      </div>

      {/* 状态条 */}
      <div className='timeline'>
        {site.daily.map((data, index) => {
          let cls = '';
          let tip = data.date.format('YYYY-MM-DD ');
          if (data.uptime >= 100) {
            cls = 'ok';
            tip += `可用率 ${formatNumber(data.uptime)}%`;
          } else if (data.uptime <= 0 && data.down.times === 0) {
            cls = 'none';
            tip += '无数据';
          } else {
            cls = 'down';
            tip += `故障 ${data.down.times} 次，累计 ${formatDuration(data.down.duration)}，可用率 ${formatNumber(data.uptime)}%`;
          }
          return <i key={index} className={cls} data-tip={tip} />;
        })}
      </div>

      {/* 底部统计 */}
      <div className='site-summary'>
        <span className='site-uptime'>
          📊 {site.total.times
            ? `${CountDays} 天可用率 ${site.average}%`
            : `${CountDays} 天可用率 ${site.average}%`}
        </span>
        {site.total.times > 0 && (
          <span className='site-down-info'>
            ⚠️ 故障 {site.total.times} 次 · {formatDuration(site.total.duration)}
          </span>
        )}
      </div>

      {/* 跳转链接覆盖层 */}
      {ShowLink && <Link className='site-link' to={site.url} text={site.name} />}

      <ReactTooltip className='tooltip' place='top' type='dark' effect='solid' />
    </div>
  ));
}

export default SiteCards;
