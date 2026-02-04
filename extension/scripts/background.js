// State
let apiUrl = null;
let configId = null;
let config = null;
let storageLoaded = false;
let lastSyncTime = null;  // Track when we last synced with server

// Load from storage on startup (no server fetch)
async function loadFromStorage() {
  const data = await chrome.storage.local.get(['apiUrl', 'configId', 'config', 'lastSyncTime']);
  apiUrl = data.apiUrl || null;
  configId = data.configId || null;
  config = data.config || null;
  lastSyncTime = data.lastSyncTime || null;
  storageLoaded = true;
  updateIcon();
  updateBadge();
}

// Promise that resolves when storage is loaded
const storageReady = loadFromStorage();

// Fetch config from server and save locally
async function syncConfig() {
  if (!configId || !apiUrl) return;
  try {
    const res = await fetch(`${apiUrl}/config/${configId}`);
    if (res.ok) {
      config = await res.json();
      lastSyncTime = Date.now();
      await chrome.storage.local.set({ config, lastSyncTime });
      updateIcon();
      updateBadge();
    } else if (res.status === 404) {
      // Config was deleted on server
      configId = null;
      config = null;
      lastSyncTime = null;
      await chrome.storage.local.remove(['configId', 'config', 'lastSyncTime']);
      updateIcon();
      updateBadge();
    }
  } catch (e) {
    // Server unreachable, keep using current config
    console.error('syncConfig failed:', e);
  }
}

function isFreeTime() {
  if (!config) return false;
  
  // If temporarily disabled, treat as free time
  if (config.disabledUntil && new Date() < new Date(config.disabledUntil)) {
    return true;
  }
  
  // Budget mode: free time only if session is active AND time remaining
  if (config.freeTimeStartedAt !== null && config.freeTimeStartedAt !== undefined) {
    // Calculate actual remaining time accounting for time since last sync
    const serverRemaining = config.freeTimeRemaining || 0;
    if (lastSyncTime) {
      const secondsSinceSync = (Date.now() - lastSyncTime) / 1000;
      const localRemaining = serverRemaining - secondsSinceSync;
      return localRemaining > 0;
    }
    return serverRemaining > 0;
  }
  
  return false;
}

function getLocalRemainingSeconds() {
  if (!config) return 0;
  const serverRemaining = config.freeTimeRemaining || 0;
  if (lastSyncTime && config.freeTimeStartedAt) {
    const secondsSinceSync = (Date.now() - lastSyncTime) / 1000;
    return Math.max(0, serverRemaining - secondsSinceSync);
  }
  return serverRemaining;
}

function matchesWhitelist(url) {
  if (!config || !config.whitelist) return false;
  return config.whitelist.some(pattern => {
    try {
      return new RegExp(pattern, 'i').test(url);
    } catch {
      return url.toLowerCase().includes(pattern.toLowerCase());
    }
  });
}

function isYouTubeVideo(url) {
  try {
    const u = new URL(url);
    return (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && u.pathname === '/watch';
  } catch { return false; }
}

function isYouTubeAllowedPage(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'www.youtube.com' && u.hostname !== 'youtube.com') return false;
    if (u.pathname === '/' || u.pathname === '' || u.pathname === '/results') return true;
    if (u.pathname.startsWith('/@') || u.pathname.startsWith('/c/') || 
        u.pathname.startsWith('/channel/') || u.pathname.startsWith('/user/')) return true;
    return false;
  } catch { return false; }
}

function shouldBlock(url) {
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return false;
  if (!configId) return true;
  if (isFreeTime()) return false;
  if (matchesWhitelist(url)) return false;
  if (isYouTubeAllowedPage(url)) return false;
  if (isYouTubeVideo(url)) return false;  // Handled separately by content script
  return true;
}

async function fetchYouTubeInfo(url) {
  try {
    const infoUrl = `${apiUrl}/youtube-info?url=${encodeURIComponent(url)}&configId=${encodeURIComponent(configId)}`;
    const res = await fetch(infoUrl);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title,
        authorName: data.authorName,
        authorUrl: data.authorUrl
      };
    }
  } catch (e) {
    console.error('fetchYouTubeInfo failed:', e);
  }
  return null;
}

function normalizeCreator(input) {
  if (!input) return '';
  let s = input.toLowerCase().trim();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/^youtube\.com\//, '');
  s = s.replace(/^@/, '');
  s = s.replace(/^\/(c|channel|user)\//, '');
  s = s.replace(/^(c|channel|user)\//, '');
  s = s.split('/')[0];
  return s;
}

function youtubeCreatorAllowed(authorName, authorUrl) {
  if (!config || !config.youtubeCreators || !config.youtubeCreators.length) return false;
  const normalizedAuthorName = normalizeCreator(authorName);
  const normalizedAuthorUrl = normalizeCreator(authorUrl);
  return config.youtubeCreators.some(creator => {
    const normalizedCreator = normalizeCreator(creator);
    return normalizedAuthorName === normalizedCreator || 
           normalizedAuthorUrl === normalizedCreator ||
           normalizedAuthorName.includes(normalizedCreator) ||
           normalizedAuthorUrl.includes(normalizedCreator);
  });
}

function youtubeVideoAllowed(title) {
  if (!config || !config.youtubeKeywords || !config.youtubeKeywords.length) return false;
  const t = title.toLowerCase();
  return config.youtubeKeywords.some(k => t.includes(k.toLowerCase()));
}

function blockedUrl(url) {
  return chrome.runtime.getURL(`pages/blocked.html?url=${encodeURIComponent(url)}`);
}

function formatBadgeTime(seconds) {
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 60) {
    return Math.ceil(minutes / 60) + 'h';
  }
  return minutes + 'm';
}

function updateBadge() {
  // Only show badge when in active free time session (not temporarily disabled)
  if (config && config.freeTimeStartedAt && !isTemporarilyDisabled()) {
    const serverRemaining = config.freeTimeRemaining || 0;
    let localRemaining = serverRemaining;
    if (lastSyncTime) {
      const secondsSinceSync = (Date.now() - lastSyncTime) / 1000;
      localRemaining = Math.max(0, serverRemaining - secondsSinceSync);
    }
    chrome.action.setBadgeText({ text: formatBadgeTime(localRemaining) });
    chrome.action.setBadgeBackgroundColor({ color: '#2aa198' });  // Solarized cyan
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function isTemporarilyDisabled() {
  return config && config.disabledUntil && new Date() < new Date(config.disabledUntil);
}

function updateIcon() {
  let iconState;
  if (!configId) {
    iconState = '';  // Not configured - white background
  } else if (isFreeTime()) {
    iconState = '-inactive';  // Free time - green background
  } else {
    iconState = '-active';  // Blocking active - red background
  }
  
  chrome.action.setIcon({
    path: {
      '16': `/icons/icon16${iconState}.png`,
      '48': `/icons/icon48${iconState}.png`,
      '128': `/icons/icon128${iconState}.png`
    }
  });
}

// Navigation blocking - wait for storage to load first
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await storageReady;
  if (shouldBlock(details.url)) {
    chrome.tabs.update(details.tabId, { url: blockedUrl(details.url) });
  }
});

// Message handling
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'getState') {
    storageReady.then(() => {
      reply({ 
        apiUrl, 
        configId, 
        config, 
        isFreeTime: isFreeTime(), 
        hasConfig: !!configId,
        isTemporarilyDisabled: isTemporarilyDisabled(),
        localRemainingSeconds: getLocalRemainingSeconds()
      });
    });
    return true;
  }
  
  if (msg.type === 'blockPage') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.update(sender.tab.id, { url: blockedUrl(msg.url) });
    }
    reply({ success: true });
    return;
  }
  
  if (msg.type === 'setApiUrl') {
    apiUrl = msg.apiUrl;
    chrome.storage.local.set({ apiUrl });
    reply({ success: true });
    return;
  }
  
  if (msg.type === 'setConfigId') {
    configId = msg.configId;
    chrome.storage.local.set({ configId });
    syncConfig().then(() => reply({ success: true }));
    return true;
  }
  
  if (msg.type === 'refreshConfig') {
    syncConfig().then(() => reply({ success: true, config }));
    return true;
  }
  
  if (msg.type === 'checkYouTube') {
    // If no config, block (extension not set up)
    if (!configId) {
      reply({ 
        shouldCheck: true, 
        allowed: false, 
        reason: 'Extension not configured',
        blockedUrl: blockedUrl(msg.url)
      });
      return;
    }
    
    // If in free time (budget session active or temporarily disabled), allow
    if (isFreeTime()) {
      reply({ shouldCheck: false });
      return;
    }
    
    // If URL matches whitelist, allow
    if (matchesWhitelist(msg.url)) {
      reply({ shouldCheck: false });
      return;
    }
    
    // Fetch video info and check against keywords/creators
    fetchYouTubeInfo(msg.url).then(info => {
      if (!info) {
        reply({ 
          shouldCheck: true, 
          allowed: false, 
          reason: 'Could not verify video',
          blockedUrl: blockedUrl(msg.url)
        });
      } else if (youtubeCreatorAllowed(info.authorName, info.authorUrl)) {
        reply({ shouldCheck: true, allowed: true, title: info.title, author: info.authorName });
      } else if (youtubeVideoAllowed(info.title)) {
        reply({ shouldCheck: true, allowed: true, title: info.title });
      } else {
        reply({ 
          shouldCheck: true, 
          allowed: false, 
          title: info.title,
          author: info.authorName,
          reason: 'Video not from allowed creator or matching keywords',
          blockedUrl: blockedUrl(msg.url)
        });
      }
    });
    return true;
  }
  
  if (msg.type === 'clearConfig') {
    configId = null;
    config = null;
    chrome.storage.local.remove(['configId', 'config']);
    updateIcon();
    updateBadge();
    reply({ success: true });
    return;
  }
  
  return true;
});

// Sync with server every minute
chrome.alarms.create('sync', { periodInMinutes: 1 });

// Check open tabs every minute for blocking
chrome.alarms.create('checkTabs', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sync') {
    await syncConfig();
    // After sync, check if any tabs need to be blocked
    await checkOpenTabs();
  } else if (alarm.name === 'checkTabs') {
    await checkOpenTabs();
  }
});

// Check all open tabs and block any that shouldn't be allowed
async function checkOpenTabs() {
  if (!configId || isFreeTime()) return;
  
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url) continue;
      
      // Skip chrome:// and extension pages
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
      
      // Check if this URL should be blocked
      if (shouldBlock(tab.url)) {
        chrome.tabs.update(tab.id, { url: blockedUrl(tab.url) });
      } else if (isYouTubeVideo(tab.url)) {
        // For YouTube videos, need to check via the API
        const info = await fetchYouTubeInfo(tab.url);
        if (!info) {
          chrome.tabs.update(tab.id, { url: blockedUrl(tab.url) });
        } else if (!youtubeCreatorAllowed(info.authorName, info.authorUrl) && !youtubeVideoAllowed(info.title)) {
          chrome.tabs.update(tab.id, { url: blockedUrl(tab.url) });
        }
      }
    }
  } catch (e) {
    console.error('checkOpenTabs failed:', e);
  }
}
