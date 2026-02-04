// Content script for monitoring YouTube SPA navigation
(function() {
  let lastUrl = location.href;
  let checkingInProgress = false;

  function isWatchPage(url) {
    try {
      const u = new URL(url);
      return u.pathname === '/watch';
    } catch {
      return false;
    }
  }

  function isAllowedPage(url) {
    try {
      const u = new URL(url);
      // Allow homepage and search results
      if (u.pathname === '/' || u.pathname === '' || u.pathname === '/results') return true;
      // Allow channel pages (@handle, /c/, /channel/, /user/)
      if (u.pathname.startsWith('/@') || u.pathname.startsWith('/c/') || 
          u.pathname.startsWith('/channel/') || u.pathname.startsWith('/user/')) return true;
      return false;
    } catch {
      return false;
    }
  }

  function isBlockedPage(url) {
    // If it's not an allowed page and not a watch page, it should be blocked
    return !isAllowedPage(url) && !isWatchPage(url);
  }

  async function checkUrl(url) {
    if (checkingInProgress) return;
    checkingInProgress = true;

    try {
      // First check if we're in focus time
      const state = await chrome.runtime.sendMessage({ type: 'getState' });
      if (!state || !state.hasConfig || state.isFreeTime) {
        // Not in focus time, allow everything
        return;
      }

      // If it's a blocked page (shorts, live, channels, playlists, feeds, etc.), block immediately
      if (isBlockedPage(url)) {
        console.log('focusmunk: Page blocked -', url);
        // Ask background to redirect us
        await chrome.runtime.sendMessage({ type: 'blockPage', url });
        return;
      }

      // If it's a watch page, check keywords
      if (isWatchPage(url)) {
        const response = await chrome.runtime.sendMessage({ type: 'checkYouTube', url });
        
        if (response && response.shouldCheck) {
          if (response.allowed) {
            console.log('focusmunk: Video allowed -', response.title);
          } else {
            console.log('focusmunk: Video blocked -', response.reason);
            // Ask background to redirect us
            await chrome.runtime.sendMessage({ type: 'blockPage', url });
          }
        }
      }
      // Allowed pages (homepage, search) just pass through
    } catch (err) {
      console.error('focusmunk: Error checking URL', err);
    } finally {
      checkingInProgress = false;
    }
  }

  function onUrlChange() {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    
    lastUrl = currentUrl;
    
    // Check all non-allowed pages
    if (!isAllowedPage(currentUrl)) {
      checkUrl(currentUrl);
    }
  }

  // Check on initial load if we're not on an allowed page
  if (!isAllowedPage(location.href)) {
    setTimeout(() => checkUrl(location.href), 100);
  }

  // Listen for YouTube's SPA navigation events
  document.addEventListener('yt-navigate-finish', onUrlChange);

  // Backup interval for URL changes
  let urlCheckInterval = null;
  
  function startUrlMonitoring() {
    if (urlCheckInterval) return;
    urlCheckInterval = setInterval(() => {
      if (location.href !== lastUrl) {
        onUrlChange();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUrlMonitoring);
  } else {
    startUrlMonitoring();
  }

  // Listen for popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    setTimeout(onUrlChange, 100);
  });
})();
