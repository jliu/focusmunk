let apiUrl = null;
let setupCode = null;

const screens = {
  initial: document.getElementById('s-initial'),
  enterId: document.getElementById('s-enter-id'),
  code: document.getElementById('s-code'),
  config: document.getElementById('s-config'),
  confirm: document.getElementById('s-confirm')
};

document.addEventListener('DOMContentLoaded', () => {
  bind();
  checkExisting();
});

async function checkExisting() {
  const s = await chrome.runtime.sendMessage({ type: 'getState' });
  if (s && s.hasConfig) window.location.href = 'settings.html';
  if (s && s.apiUrl) {
    document.getElementById('input-server').value = s.apiUrl;
    document.getElementById('input-server-id').value = s.apiUrl;
  }
}

function show(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function bind() {
  document.getElementById('btn-enter-id').onclick = () => show('enterId');
  document.getElementById('btn-create').onclick = () => show('code');
  
  document.getElementById('id-back').onclick = () => show('initial');
  document.getElementById('id-submit').onclick = submitId;
  document.getElementById('input-id').onkeypress = e => { if (e.key === 'Enter') submitId(); };
  
  document.getElementById('code-back').onclick = () => show('initial');
  document.getElementById('code-continue').onclick = verifyCode;
  document.getElementById('input-code').onkeypress = e => { if (e.key === 'Enter') verifyCode(); };
  
  document.getElementById('cfg-back').onclick = () => show('code');
  document.getElementById('cfg-create').onclick = createConfig;
  
  document.getElementById('copy-id').onclick = copyId;
  document.getElementById('done-btn').onclick = () => window.close();
}

function normalizeUrl(url) {
  url = url.trim();
  if (url.endsWith('/')) url = url.slice(0, -1);
  return url;
}

async function submitId() {
  const serverUrl = normalizeUrl(document.getElementById('input-server-id').value);
  const id = document.getElementById('input-id').value.trim().toUpperCase();
  const err = document.getElementById('id-error');
  err.classList.add('hidden');
  
  if (!serverUrl) { err.textContent = 'Enter server URL'; err.classList.remove('hidden'); return; }
  if (!/^[A-Z]{4}-[0-9]{4}$/.test(id)) { err.textContent = 'Invalid format (ABCD-1234)'; err.classList.remove('hidden'); return; }
  
  try {
    const res = await fetch(`${serverUrl}/config/${id}`);
    if (res.ok) {
      await chrome.runtime.sendMessage({ type: 'setApiUrl', apiUrl: serverUrl });
      await chrome.runtime.sendMessage({ type: 'setConfigId', configId: id });
      window.location.href = 'settings.html';
    } else {
      err.textContent = 'Configuration not found'; err.classList.remove('hidden');
    }
  } catch { err.textContent = 'Connection failed'; err.classList.remove('hidden'); }
}

async function verifyCode() {
  const serverUrl = normalizeUrl(document.getElementById('input-server').value);
  const code = document.getElementById('input-code').value.trim();
  const err = document.getElementById('code-error');
  err.classList.add('hidden');
  
  if (!serverUrl) { err.textContent = 'Enter server URL'; err.classList.remove('hidden'); return; }
  if (!code) { err.textContent = 'Enter setup code'; err.classList.remove('hidden'); return; }
  
  try {
    const res = await fetch(`${serverUrl}/setup-code/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupCode: code })
    });
    const d = await res.json();
    if (d.valid) {
      apiUrl = serverUrl;
      setupCode = code;
      await chrome.runtime.sendMessage({ type: 'setApiUrl', apiUrl: serverUrl });
      show('config');
    } else {
      err.textContent = 'Invalid setup code'; err.classList.remove('hidden');
    }
  } catch { err.textContent = 'Connection failed'; err.classList.remove('hidden'); }
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

async function createConfig() {
  const pwd = document.getElementById('input-pwd').value;
  const pwd2 = document.getElementById('input-pwd2').value;
  const err = document.getElementById('cfg-error');
  err.classList.add('hidden');
  
  if (!pwd || pwd.length < 4) { err.textContent = 'Password must be 4+ characters'; err.classList.remove('hidden'); return; }
  if (pwd !== pwd2) { err.textContent = 'Passwords do not match'; err.classList.remove('hidden'); return; }
  
  const whitelist = document.getElementById('input-whitelist').value.split('\n').map(l => l.trim()).filter(Boolean);
  const keywords = document.getElementById('input-keywords').value.split('\n').map(l => l.trim()).filter(Boolean);
  const creators = document.getElementById('input-creators').value.split('\n').map(l => l.trim()).filter(Boolean);
  const dailyFreeMinutes = getDailyFreeMinutes();
  
  try {
    const res = await fetch(`${apiUrl}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        setupCode, 
        password: pwd, 
        whitelist, 
        dailyFreeMinutes,
        youtubeKeywords: keywords, 
        youtubeCreators: creators 
      })
    });
    if (res.ok) {
      const d = await res.json();
      await chrome.runtime.sendMessage({ type: 'setConfigId', configId: d.id });
      document.getElementById('final-id').textContent = d.id;
      show('confirm');
    } else {
      const d = await res.json();
      err.textContent = d.error || 'Failed'; err.classList.remove('hidden');
    }
  } catch { err.textContent = 'Connection failed'; err.classList.remove('hidden'); }
}

function copyId() {
  const id = document.getElementById('final-id').textContent;
  const btn = document.getElementById('copy-id');
  navigator.clipboard.writeText(id);
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
}
