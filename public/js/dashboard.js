(function() {
  'use strict';

  // State
  let authenticated = false;
  let refreshInterval = null;

  // DOM refs
  const loginScreen = document.getElementById('login-screen');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');
  const auditFilter = document.getElementById('audit-filter');

  // --- Auth ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        authenticated = true;
        showDashboard();
      } else {
        loginError.textContent = data.message || 'Login failed';
        loginError.style.display = 'block';
      }
    } catch {
      loginError.textContent = 'Connection error';
      loginError.style.display = 'block';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    authenticated = false;
    clearInterval(refreshInterval);
    dashboard.style.display = 'none';
    loginScreen.style.display = 'flex';
  });

  // Check existing session
  async function checkSession() {
    try {
      const res = await fetch('/auth/check');
      if (res.ok) {
        authenticated = true;
        showDashboard();
      }
    } catch { /* not logged in */ }
  }

  function showDashboard() {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'flex';
    refreshData();
    refreshInterval = setInterval(refreshData, 3000);
  }

  // --- Navigation ---
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      const view = item.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${view}`).classList.add('active');
      document.getElementById('view-title').textContent = item.querySelector('span').textContent;
    });
  });

  // --- Data Refresh ---
  async function refreshData() {
    try {
      const res = await fetch('/api/v1/monitoring/metrics');
      if (res.status === 401) {
        authenticated = false;
        clearInterval(refreshInterval);
        dashboard.style.display = 'none';
        loginScreen.style.display = 'flex';
        return;
      }
      const data = await res.json();
      updateOverview(data);
      updateRequests(data);
      updateConnectors(data);
      updateStatusIndicator(true);
    } catch {
      updateStatusIndicator(false);
    }

    // Audit (separate call with filter)
    try {
      const filter = auditFilter.value;
      const url = filter
        ? `/api/v1/monitoring/audit?event_type=${filter}&limit=100`
        : '/api/v1/monitoring/audit?limit=100';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        updateAudit(data);
      }
    } catch { /* ignore */ }
  }

  auditFilter.addEventListener('change', refreshData);

  // --- Update Functions ---
  function updateStatusIndicator(connected) {
    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    if (connected) {
      dot.style.background = 'var(--green)';
      dot.style.boxShadow = '0 0 8px var(--green)';
      text.textContent = 'Connected';
    } else {
      dot.style.background = 'var(--red)';
      dot.style.boxShadow = '0 0 8px var(--red)';
      text.textContent = 'Disconnected';
    }
  }

  function updateOverview(data) {
    // Stats
    document.getElementById('stat-total').textContent = fmtNum(data.requests.total);
    document.getElementById('stat-verified').textContent = fmtNum(data.results.verified);
    document.getElementById('stat-notfound').textContent = fmtNum(data.results.not_found + data.results.inconclusive);
    document.getElementById('stat-errors').textContent = fmtNum(
      data.results.registry_unavailable + data.results.error + data.results.invalid + data.results.format_error
    );

    // Uptime
    const h = Math.floor(data.uptime_seconds / 3600);
    const m = Math.floor((data.uptime_seconds % 3600) / 60);
    document.getElementById('uptime').textContent = `Uptime: ${h}h ${m}m`;

    // Performance
    document.getElementById('perf-avg').textContent = `${data.response_time.avg_ms} ms`;
    document.getElementById('perf-p95').textContent = `${data.response_time.p95_ms} ms`;
    document.getElementById('perf-verify').textContent = fmtNum(data.requests.verify);
    document.getElementById('perf-protect').textContent = fmtNum(data.requests.protect);

    // Type bars
    const typeBars = document.getElementById('type-bars');
    const types = data.identifier_types;
    const maxType = Math.max(...Object.values(types), 1);
    if (Object.keys(types).length === 0) {
      typeBars.innerHTML = '<div class="empty-state">No data yet</div>';
    } else {
      typeBars.innerHTML = Object.entries(types).map(([type, count]) => `
        <div class="type-bar-item">
          <span class="type-bar-label">${escHtml(type)}</span>
          <div class="type-bar-track">
            <div class="type-bar-fill" style="width: ${(count / maxType * 100).toFixed(1)}%"></div>
          </div>
          <span class="type-bar-count">${fmtNum(count)}</span>
        </div>
      `).join('');
    }

    // Countries
    const countryList = document.getElementById('country-list');
    const countries = data.countries;
    if (Object.keys(countries).length === 0) {
      countryList.innerHTML = '<div class="empty-state">No data yet</div>';
    } else {
      countryList.innerHTML = Object.entries(countries)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => `
          <div class="country-item">
            <span class="country-code">${escHtml(code)}</span>
            <span class="country-count">${fmtNum(count)}</span>
          </div>
        `).join('');
    }

    // Donut center
    const donutCenter = document.getElementById('donut-center');
    donutCenter.querySelector('.donut-value').textContent = fmtNum(data.requests.total);

    // Charts
    drawTimeline(data.time_series);
    drawDonut(data.results);
  }

  function updateRequests(data) {
    const tbody = document.getElementById('requests-table-body');
    const recent = data.recent_requests || [];
    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No requests yet</td></tr>';
      return;
    }
    tbody.innerHTML = recent.map(r => `
      <tr>
        <td>${fmtTime(r.timestamp)}</td>
        <td style="font-family:monospace;font-size:12px">${escHtml(r.correlation_id || '--')}</td>
        <td><strong>${escHtml(r.identifier_type || '--')}</strong></td>
        <td>${escHtml(r.issuer_country || '--')}</td>
        <td><span class="badge badge-${r.status}">${escHtml(r.status || '--')}</span></td>
        <td style="font-family:monospace">${escHtml(r.masked_value || '--')}</td>
        <td>${r.response_time_ms != null ? r.response_time_ms + ' ms' : '--'}</td>
        <td>${escHtml(r.gateway_id || '--')}</td>
      </tr>
    `).join('');
  }

  function updateConnectors(data) {
    const grid = document.getElementById('connectors-grid');
    const connectors = data.connectors || {};
    if (Object.keys(connectors).length === 0) {
      grid.innerHTML = '<div class="empty-state">No connectors configured</div>';
      return;
    }
    grid.innerHTML = Object.entries(connectors).map(([name, stats]) => `
      <div class="connector-card">
        <div class="connector-header">
          <span class="connector-name">${escHtml(name)}</span>
          <span class="connector-status ${stats.healthy ? 'healthy' : 'unhealthy'}">
            <span class="status-dot" style="width:8px;height:8px;border-radius:50%;background:${stats.healthy ? 'var(--green)' : 'var(--red)'}"></span>
            ${stats.healthy ? 'Healthy' : 'Unhealthy'}
          </span>
        </div>
        <div class="connector-stats">
          <div class="connector-stat">
            <span class="connector-stat-value">${fmtNum(stats.total)}</span>
            <span class="connector-stat-label">Total Calls</span>
          </div>
          <div class="connector-stat">
            <span class="connector-stat-value" style="color:var(--green)">${fmtNum(stats.verified)}</span>
            <span class="connector-stat-label">Verified</span>
          </div>
          <div class="connector-stat">
            <span class="connector-stat-value" style="color:var(--orange)">${fmtNum(stats.not_found)}</span>
            <span class="connector-stat-label">Not Found</span>
          </div>
          <div class="connector-stat">
            <span class="connector-stat-value" style="color:var(--red)">${fmtNum(stats.registry_unavailable + stats.errors)}</span>
            <span class="connector-stat-label">Errors</span>
          </div>
        </div>
        ${stats.lastCheck ? `<div style="margin-top:12px;font-size:12px;color:var(--text-muted)">Last check: ${fmtTime(stats.lastCheck)}</div>` : ''}
      </div>
    `).join('');
  }

  function updateAudit(data) {
    const tbody = document.getElementById('audit-table-body');
    if (!data.events || data.events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No audit events</td></tr>';
      return;
    }
    tbody.innerHTML = data.events.map(e => {
      const badgeClass = e.event_type.includes('SUCCEEDED') || e.event_type.includes('VERIFIED')
        ? 'badge-verified'
        : e.event_type.includes('FAILED') || e.event_type.includes('REJECTED') || e.event_type.includes('INVALID')
          ? 'badge-invalid'
          : e.event_type.includes('NOT_FOUND') || e.event_type.includes('INCONCLUSIVE')
            ? 'badge-not_found'
            : 'badge-protected_only';

      return `
        <tr>
          <td>${fmtTime(e.timestamp)}</td>
          <td><span class="badge ${badgeClass}" style="font-size:11px">${escHtml(e.event_type)}</span></td>
          <td style="font-family:monospace;font-size:12px">${escHtml(e.correlation_id || '--')}</td>
          <td>${escHtml(e.identifier_type || '--')}</td>
          <td>${escHtml(e.status || e.verification_status || '--')}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${escHtml(e.message || e.error || e.claim_id || '--')}</td>
        </tr>
      `;
    }).join('');
  }

  // --- Canvas Charts ---
  function drawTimeline(series) {
    const canvas = document.getElementById('chart-timeline');
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    // Skip drawing when canvas is hidden (zero dimensions)
    if (rect.width < 1 || rect.height < 1) return;
    const ctx = canvas.getContext('2d');
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(2, 2);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 20, right: 20, bottom: 30, left: 40 };

    ctx.clearRect(0, 0, w, h);

    if (!series || series.length === 0) {
      ctx.fillStyle = '#6b6b8a';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for data...', w / 2, h / 2);
      return;
    }

    const maxVal = Math.max(...series.map(s => s.count), 1);
    const barW = Math.max(4, (w - pad.left - pad.right) / Math.max(series.length, 1) - 2);

    // Grid lines
    ctx.strokeStyle = '#2a2a45';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (h - pad.top - pad.bottom) * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#6b6b8a';
      ctx.font = '10px Inter';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * i / 4).toString(), pad.left - 6, y + 3);
    }

    // Bars
    const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
    gradient.addColorStop(0, '#818cf8');
    gradient.addColorStop(1, '#6366f1');

    series.forEach((point, i) => {
      const x = pad.left + i * ((w - pad.left - pad.right) / series.length) + 1;
      const barH = (point.count / maxVal) * (h - pad.top - pad.bottom);
      const y = h - pad.bottom - barH;

      ctx.fillStyle = gradient;
      roundRect(ctx, x, y, barW, barH, 3);
      ctx.fill();

      // Time label (every 5th)
      if (i % 5 === 0 && point.minute) {
        ctx.fillStyle = '#6b6b8a';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        const label = point.minute.split('T')[1] || '';
        ctx.fillText(label, x + barW / 2, h - pad.bottom + 15);
      }
    });
  }

  function drawDonut(results) {
    const canvas = document.getElementById('chart-status');
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    // Skip drawing when canvas is hidden (zero dimensions cause negative radius → RangeError)
    if (rect.width < 1 || rect.height < 1) return;
    const ctx = canvas.getContext('2d');
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(2, 2);

    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 15;
    const lineWidth = 20;

    ctx.clearRect(0, 0, w, h);

    const segments = [
      { key: 'verified', color: '#22c55e', value: results.verified || 0 },
      { key: 'not_found', color: '#f59e0b', value: results.not_found || 0 },
      { key: 'invalid', color: '#ef4444', value: results.invalid || 0 },
      { key: 'registry_unavailable', color: '#dc2626', value: results.registry_unavailable || 0 },
      { key: 'inconclusive', color: '#fb923c', value: results.inconclusive || 0 },
      { key: 'protected_only', color: '#a855f7', value: results.protected_only || 0 },
      { key: 'format_error', color: '#f43f5e', value: results.format_error || 0 },
      { key: 'error', color: '#991b1b', value: results.error || 0 },
    ];

    const total = segments.reduce((sum, s) => sum + s.value, 0);

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#2a2a45';
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      return;
    }

    let startAngle = -Math.PI / 2;
    segments.forEach(seg => {
      if (seg.value === 0) return;
      const slice = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
      startAngle += slice;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h < 1) return;
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // --- Helpers ---
  function fmtNum(n) {
    return (n || 0).toLocaleString();
  }

  function fmtTime(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function escHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // Init
  checkSession();
})();
