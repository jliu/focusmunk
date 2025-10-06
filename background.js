// background.js
// Service worker monitors tabs and enforces whitelist + schedule.

const DEFAULT_SETTINGS = {
  enabled: true, // main enforcement toggle (still requires password to change)
  whitelist: ["^https?://(www\\.)?google\\.com"], // example default
  password: "password", // plaintext as requested
  // schedules: array of 7 days (0=Sunday..6=Saturday), each day is array of {start:"HH:MM", end:"HH:MM"}
  schedules: [[], [], [], [], [], [], []],
  manualDisabledUntil: 0 // timestamp until which enforcement is disabled (set when unlocked)
};

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(DEFAULT_SETTINGS, data => resolve(data));
  });
}

function timeInRangeNow(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return false;
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");
  const cur = hh + ":" + mm;
  for (const r of ranges) {
    if (!r || !r.start || !r.end) continue;
    if (r.start <= cur && cur < r.end) return true;
    // handle ranges that cross midnight (e.g., 22:00-02:00)
    if (r.start > r.end) {
      if (cur >= r.start || cur <= r.end) return true;
    }
  }
  return false;
}

function isSpecialUrl(url) {
  // allow chrome-extension, chrome:, about, file:
  return url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("file://") || url.startsWith("about:");
}

function compileRegexes(list) {
  const out = [];
  for (const s of list || []) {
    try {
      out.push(new RegExp(s));
    } catch (e) {
      console.warn("Invalid regex ignored:", s, e);
    }
  }
  return out;
}

async function shouldBlockUrl(url) {
  try {
    const settings = await getSettings();
    // if global enabled flag is false => not enforcing
    if (!settings.enabled) return false;
    // manual disable window
    if (settings.manualDisabledUntil && Date.now() < settings.manualDisabledUntil) return false;

    // allow special urls
    if (isSpecialUrl(url)) return false;

    // check schedule for today
    const day = new Date().getDay();
    const dayRanges = (settings.schedules && settings.schedules[day]) || [];
    const inSchedule = timeInRangeNow(dayRanges);

    if (!inSchedule) {
      // outside scheduled focus time => do not block
      return false;
    }

    // check whitelist regexes
    const regexes = compileRegexes(settings.whitelist || []);
    for (const re of regexes) {
      try {
        if (re.test(url)) return false; // matched -> allowed
      } catch (e) {
        console.warn("Regex test error:", e);
      }
    }

    // not matched -> block
    return true;
  } catch (e) {
    console.error("shouldBlockUrl err", e);
    return false;
  }
}

async function handleTab(tabId, changeInfo, tab) {
  // We will check tab.url if available, or fetch tab info
  const url = (tab && tab.url) || (changeInfo && changeInfo.url);
  if (!url) return;

  // ignore our own block.html when rendering
  if (url.includes("block.html")) return;

  if (await shouldBlockUrl(url)) {
    // redirect to block page and pass original url (encoded) as query param
    const extUrl = chrome.runtime.getURL("block.html") + "?blocked=" + encodeURIComponent(url);
    try {
      await chrome.tabs.update(tabId, { url: extUrl });
    } catch (e) {
      console.warn("Failed to redirect tab", e);
    }
  }
}

// Listen for newly updated tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // wait until URL is present
  if (changeInfo.status === "loading" || changeInfo.url) {
    handleTab(tabId, changeInfo, tab);
  }
});

// Also check when tab is activated
chrome.tabs.onActivated.addListener(async activeInfo => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    handleTab(activeInfo.tabId, {}, tab);
  } catch (e) {
    // ignore
  }
});

// Expose some commands via messages (popup/options/block pages will message the worker)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "checkPassword") {
    chrome.storage.local.get(DEFAULT_SETTINGS, data => {
      const ok = msg.password === data.password;
      sendResponse({ ok });
    });
    return true; // will respond asynchronously
  }

  if (msg && msg.action === "disableUntil") {
    // requires password checked by sender; we still set manualDisabledUntil to timestamp
    const until = msg.until || 0;
    chrome.storage.local.set({ manualDisabledUntil: until }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg && msg.action === "toggleEnabled") {
    // toggling enabled (should only be called after password verified)
    chrome.storage.local.get(DEFAULT_SETTINGS, data => {
      const newVal = !data.enabled;
      chrome.storage.local.set({ enabled: newVal }, () => sendResponse({ ok: true, enabled: newVal }));
    });
    return true;
  }
});
