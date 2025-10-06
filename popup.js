// popup.js
document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("status");
  const toggleBtn = document.getElementById("toggle");
  const unlockBtn = document.getElementById("unlock");
  const opts = document.getElementById("opts");
  opts.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  function updateStatus(enabled) {
    statusEl.textContent = enabled ? "Focus mode: ON (password required to change)" : "Focus mode: OFF";
  }

  const settings = await new Promise(resolve => chrome.storage.local.get({
    enabled: true
  }, data => resolve(data)));
  updateStatus(settings.enabled);

  toggleBtn.addEventListener("click", async () => {
    const pw = prompt("Enter password to toggle focus mode:");
    if (!pw) return;
    // verify
    chrome.runtime.sendMessage({ action: "checkPassword", password: pw }, (res) => {
      if (res && res.ok) {
        // toggle
        chrome.runtime.sendMessage({ action: "toggleEnabled" }, (r) => {
          if (r && typeof r.enabled !== "undefined") {
            updateStatus(r.enabled);
            alert("Toggled. Focus mode is now " + (r.enabled ? "ON" : "OFF"));
          } else {
            alert("Toggle failed.");
          }
        });
      } else {
        alert("Wrong password.");
      }
    });
  });

  // Unlock (disable enforcement until user-specified time)
  unlockBtn.addEventListener("click", async () => {
    const pw = prompt("Enter password to disable blocking (will ask for duration):");
    if (!pw) return;
    chrome.runtime.sendMessage({ action: "checkPassword", password: pw }, async (res) => {
      if (!(res && res.ok)) return alert("Wrong password.");
      const minutesStr = prompt("Disable blocking for how many minutes? (e.g., 30). Leave blank to disable until manually toggled off.");
      if (minutesStr === null) return;
      if (minutesStr.trim() === "") {
        // set manualDisabledUntil to a large timestamp (effectively indefinite)
        await chrome.runtime.sendMessage({ action: "disableUntil", until: 0 }, () => {
          alert("Blocking will remain disabled until re-enabled in Options (password required).");
          window.close();
        });
        return;
      }
      const mins = parseInt(minutesStr, 10);
      if (isNaN(mins) || mins <= 0) return alert("Invalid number.");
      const until = Date.now() + mins * 60 * 1000;
      chrome.runtime.sendMessage({ action: "disableUntil", until }, () => {
        alert("Blocking disabled for " + mins + " minutes.");
        window.close();
      });
    });
  });
});
