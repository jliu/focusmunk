const noConfig = document.getElementById('no-config');
const main = document.getElementById('main');
const badge = document.getElementById('badge');
const badgeText = document.getElementById('badge-text');
const statusDetail = document.getElementById('status-detail');
const freeTimeInfo = document.getElementById('free-time-info');
const setupBtn = document.getElementById('setup-btn');
const startFreeTimeBtn = document.getElementById('start-free-time-btn');
const endFreeTimeBtn = document.getElementById('end-free-time-btn');
const disableBtn = document.getElementById('disable-btn');
const cancelDisableBtn = document.getElementById('cancel-disable-btn');
const settingsBtn = document.getElementById('settings-btn');
const modal = document.getElementById('modal');
const modalError = document.getElementById('modal-error');
const modalPwd = document.getElementById('modal-pwd');
const modalHours = document.getElementById('modal-hours');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

let state = null;

document.addEventListener('DOMContentLoaded', load);

async function load() {
  state = await chrome.runtime.sendMessage({ type: 'getState' });
  render();
}

function formatMinutes(seconds) {
  return Math.ceil(seconds / 60);
}

function render() {
  if (!state || !state.hasConfig) {
    noConfig.classList.remove('hidden');
    main.classList.add('hidden');
    return;
  }
  noConfig.classList.add('hidden');
  main.classList.remove('hidden');

  const cfg = state.config;
  const isDisabled = state.isTemporarilyDisabled;
  const inFreeTimeSession = cfg.freeTimeStartedAt !== null && cfg.freeTimeStartedAt !== undefined;
  const remaining = state.localRemainingSeconds || 0;  // Use local calculation
  const todaysAllowance = cfg.todaysAllowance || 0;
  
  // Hide all action buttons first
  startFreeTimeBtn.classList.add('hidden');
  endFreeTimeBtn.classList.add('hidden');
  disableBtn.classList.add('hidden');
  cancelDisableBtn.classList.add('hidden');
  freeTimeInfo.classList.add('hidden');
  
  if (isDisabled) {
    // Temporarily disabled
    badge.className = 'badge disabled';
    badgeText.textContent = 'Disabled';
    statusDetail.textContent = 'Until ' + new Date(cfg.disabledUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    cancelDisableBtn.classList.remove('hidden');
  } else if (inFreeTimeSession && remaining > 0) {
    // In active free time session with time remaining
    badge.className = 'badge inactive';
    badgeText.textContent = 'Free Time';
    statusDetail.textContent = 'Browsing freely';
    freeTimeInfo.textContent = `${formatMinutes(remaining)} min remaining of ${formatMinutes(todaysAllowance)} min`;
    freeTimeInfo.classList.remove('hidden');
    endFreeTimeBtn.classList.remove('hidden');
  } else if (todaysAllowance === 0) {
    // No free time allowed today
    badge.className = 'badge active';
    badgeText.textContent = 'Blocking';
    statusDetail.textContent = 'No free time allowed today';
    startFreeTimeBtn.classList.remove('hidden');
    startFreeTimeBtn.disabled = true;
    disableBtn.classList.remove('hidden');
  } else if (remaining <= 0) {
    // Budget exhausted
    badge.className = 'badge active';
    badgeText.textContent = 'Blocking';
    statusDetail.textContent = 'Blocking distractions';
    freeTimeInfo.textContent = `0 min remaining of ${formatMinutes(todaysAllowance)} min`;
    freeTimeInfo.classList.remove('hidden');
    startFreeTimeBtn.classList.remove('hidden');
    startFreeTimeBtn.disabled = true;
    disableBtn.classList.remove('hidden');
  } else {
    // Has free time remaining, not in session
    badge.className = 'badge active';
    badgeText.textContent = 'Blocking';
    statusDetail.textContent = 'Blocking distractions';
    freeTimeInfo.textContent = `${formatMinutes(remaining)} min remaining of ${formatMinutes(todaysAllowance)} min`;
    freeTimeInfo.classList.remove('hidden');
    startFreeTimeBtn.classList.remove('hidden');
    startFreeTimeBtn.disabled = false;
    disableBtn.classList.remove('hidden');
  }
}

setupBtn.onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('pages/setup.html') }); window.close(); };
settingsBtn.onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('pages/settings.html') }); window.close(); };

startFreeTimeBtn.onclick = async () => {
  if (!state.apiUrl) return;
  
  startFreeTimeBtn.disabled = true;
  try {
    const res = await fetch(`${state.apiUrl}/config/${state.configId}/start-free-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      await chrome.runtime.sendMessage({ type: 'refreshConfig' });
      load();
    } else {
      const d = await res.json();
      alert(d.error || 'Failed to start free time');
    }
  } catch { alert('Connection failed'); }
  startFreeTimeBtn.disabled = false;
};

endFreeTimeBtn.onclick = async () => {
  if (!state.apiUrl) return;
  
  endFreeTimeBtn.disabled = true;
  try {
    const res = await fetch(`${state.apiUrl}/config/${state.configId}/end-free-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      await chrome.runtime.sendMessage({ type: 'refreshConfig' });
      load();
    }
  } catch { }
  endFreeTimeBtn.disabled = false;
};

disableBtn.onclick = () => { 
  modal.classList.remove('hidden'); 
  modalPwd.value = '';
  modalPwd.focus(); 
};

cancelDisableBtn.onclick = async () => {
  if (!state.apiUrl) return;
  
  cancelDisableBtn.disabled = true;
  try {
    const res = await fetch(`${state.apiUrl}/config/${state.configId}/cancel-disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.ok) {
      await chrome.runtime.sendMessage({ type: 'refreshConfig' });
      load();
    }
  } catch { }
  cancelDisableBtn.disabled = false;
};

modalCancel.onclick = () => { modal.classList.add('hidden'); modalError.classList.add('hidden'); };

modalConfirm.onclick = async () => {
  const pwd = modalPwd.value;
  if (!pwd) { showErr('Enter password'); return; }
  
  if (!state.apiUrl) { showErr('Server not configured'); return; }
  
  const hours = parseFloat(modalHours.value);
  if (!hours || hours <= 0) { showErr('Enter valid hours'); return; }
  
  modalConfirm.disabled = true;
  try {
    const res = await fetch(`${state.apiUrl}/config/${state.configId}/temporary-disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd, hours })
    });
    if (res.ok) {
      await chrome.runtime.sendMessage({ type: 'refreshConfig' });
      modal.classList.add('hidden');
      load();
    } else {
      const d = await res.json();
      showErr(d.error || 'Failed');
    }
  } catch { showErr('Connection failed'); }
  modalConfirm.disabled = false;
};

function showErr(msg) { modalError.textContent = msg; modalError.classList.remove('hidden'); }
