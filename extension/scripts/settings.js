let apiUrl = null;
let configId = null;
let password = null;
let config = null;

const loginScreen = document.getElementById('s-login');
const settingsScreen = document.getElementById('s-settings');

document.addEventListener('DOMContentLoaded', async () => {
  bind();
  await load();
});

async function load() {
  const s = await chrome.runtime.sendMessage({ type: 'getState' });
  if (!s || !s.hasConfig) { window.location.href = 'setup.html'; return; }
  apiUrl = s.apiUrl;
  configId = s.configId;
  config = JSON.parse(JSON.stringify(s.config));
  document.getElementById('cfg-id').textContent = configId;
}

function bind() {
  document.getElementById('login-btn').onclick = login;
  document.getElementById('login-pwd').onkeypress = e => { if (e.key === 'Enter') login(); };
  
  document.getElementById('copy-id').onclick = () => {
    navigator.clipboard.writeText(configId);
    const btn = document.getElementById('copy-id');
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  };
  
  document.getElementById('change-pwd').onclick = changePassword;
  
  document.getElementById('save-btn').onclick = save;
  document.getElementById('cancel-btn').onclick = cancel;
}

async function login() {
  const pwd = document.getElementById('login-pwd').value;
  const err = document.getElementById('login-err');
  err.classList.add('hidden');
  
  if (!pwd) { err.textContent = 'Enter password'; err.classList.remove('hidden'); return; }
  
  try {
    const res = await fetch(`${apiUrl}/config/${configId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const d = await res.json();
    if (d.valid) {
      password = pwd;
      loginScreen.classList.add('hidden');
      settingsScreen.classList.remove('hidden');
      render();
    } else {
      err.textContent = 'Invalid password'; err.classList.remove('hidden');
    }
  } catch { err.textContent = 'Connection failed'; err.classList.remove('hidden'); }
}

function render() {
  const badge = document.getElementById('badge');
  const badgeText = document.getElementById('badge-text');
  
  const isDisabled = config.disabledUntil && new Date() < new Date(config.disabledUntil);
  const inFreeTimeSession = config.freeTimeStartedAt !== null && config.freeTimeStartedAt !== undefined;
  const isFreeTime = isDisabled || inFreeTimeSession;
  
  badge.className = 'badge ' + (isDisabled ? 'disabled' : isFreeTime ? 'inactive' : 'active');
  badgeText.textContent = isDisabled ? 'Disabled' : isFreeTime ? 'Free Time' : 'Blocking';
  
  // Populate daily free time inputs (convert seconds to minutes)
  const dailyFreeSeconds = config.dailyFreeSeconds || {};
  document.getElementById('free-mon').value = Math.floor((dailyFreeSeconds.mon || 0) / 60);
  document.getElementById('free-tue').value = Math.floor((dailyFreeSeconds.tue || 0) / 60);
  document.getElementById('free-wed').value = Math.floor((dailyFreeSeconds.wed || 0) / 60);
  document.getElementById('free-thu').value = Math.floor((dailyFreeSeconds.thu || 0) / 60);
  document.getElementById('free-fri').value = Math.floor((dailyFreeSeconds.fri || 0) / 60);
  document.getElementById('free-sat').value = Math.floor((dailyFreeSeconds.sat || 0) / 60);
  document.getElementById('free-sun').value = Math.floor((dailyFreeSeconds.sun || 0) / 60);
  
  // Populate textareas with current values
  document.getElementById('wl-input').value = (config.whitelist || []).join('\n');
  document.getElementById('creator-input').value = (config.youtubeCreators || []).join('\n');
  document.getElementById('kw-input').value = (config.youtubeKeywords || []).join('\n');
}

function getDailyFreeMinutes() {
  return {
    mon: parseInt(document.getElementById('free-mon').value) || 0,
    tue: parseInt(document.getElementById('free-tue').value) || 0,
    wed: parseInt(document.getElementById('free-wed').value) || 0,
    thu: parseInt(document.getElementById('free-thu').value) || 0,
    fri: parseInt(document.getElementById('free-fri').value) || 0,
    sat: parseInt(document.getElementById('free-sat').value) || 0,
    sun: parseInt(document.getElementById('free-sun').value) || 0
  };
}

async function changePassword() {
  const cur = document.getElementById('cur-pwd').value;
  const newPwd = document.getElementById('new-pwd').value;
  const newPwd2 = document.getElementById('new-pwd2').value;
  const err = document.getElementById('pwd-err');
  const ok = document.getElementById('pwd-ok');
  err.classList.add('hidden');
  ok.classList.add('hidden');
  
  if (!cur) { err.textContent = 'Enter current password'; err.classList.remove('hidden'); return; }
  if (!newPwd || newPwd.length < 4) { err.textContent = 'New password must be 4+ characters'; err.classList.remove('hidden'); return; }
  if (newPwd !== newPwd2) { err.textContent = 'Passwords do not match'; err.classList.remove('hidden'); return; }
  
  try {
    const res = await fetch(`${apiUrl}/config/${configId}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: cur, newPassword: newPwd })
    });
    if (res.ok) {
      password = newPwd;
      ok.textContent = 'Password changed'; ok.classList.remove('hidden');
      document.getElementById('cur-pwd').value = '';
      document.getElementById('new-pwd').value = '';
      document.getElementById('new-pwd2').value = '';
    } else {
      const d = await res.json();
      err.textContent = d.error || 'Failed'; err.classList.remove('hidden');
    }
  } catch { err.textContent = 'Connection failed'; err.classList.remove('hidden'); }
}

async function save() {
  // Get values from inputs
  const whitelist = document.getElementById('wl-input').value.split('\n').map(l => l.trim()).filter(Boolean);
  const youtubeCreators = document.getElementById('creator-input').value.split('\n').map(l => l.trim()).filter(Boolean);
  const youtubeKeywords = document.getElementById('kw-input').value.split('\n').map(l => l.trim()).filter(Boolean);
  const dailyFreeMinutes = getDailyFreeMinutes();
  
  try {
    const res = await fetch(`${apiUrl}/config/${configId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password,
        whitelist,
        dailyFreeMinutes,
        youtubeKeywords,
        youtubeCreators
      })
    });
    if (res.ok) {
      await chrome.runtime.sendMessage({ type: 'refreshConfig' });
      window.close();
    } else {
      const d = await res.json();
      alert(d.error || 'Failed to save');
    }
  } catch { alert('Connection failed'); }
}

function cancel() {
  window.close();
}
