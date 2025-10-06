// options.js
const DEFAULT_SETTINGS = {
  enabled: true,
  whitelist: ["^https?://(www\\.)?google\\.com"],
  password: "password",
  schedules: [[], [], [], [], [], [], []],
  manualDisabledUntil: 0
};

const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function el(id) { return document.getElementById(id); }

async function loadSettings() {
  return new Promise(resolve => chrome.storage.local.get(DEFAULT_SETTINGS, data => resolve(data)));
}

function renderSchedules(schedules) {
  const container = el("schedules");
  container.innerHTML = "";
  schedules = schedules || [[],[],[],[],[],[],[]];
  dayNames.forEach((d, idx) => {
    const dayDiv = document.createElement("div");
    dayDiv.style.marginTop = "8px";
    dayDiv.innerHTML = `<strong>${d}</strong>`;
    const list = document.createElement("div");
    list.id = `day-${idx}`;
    list.style.marginTop = "6px";

    // render each range with an "x"
    schedules[idx].forEach((range, rangeIdx) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.paddingRight = "6px";

      const label = document.createElement("span");
      label.textContent = `${range.start} — ${range.end}`;
      const del = document.createElement("button");
      del.textContent = "×";
      del.style.background = "none";
      del.style.border = "none";
      del.style.color = "#c00";
      del.style.cursor = "pointer";
      del.style.fontSize = "16px";
      del.title = "Delete this range";
      del.addEventListener("click", () => {
        schedules[idx].splice(rangeIdx, 1);
        renderSchedules(schedules);
      });
      row.appendChild(label);
      row.appendChild(del);
      list.appendChild(row);
    });

    dayDiv.appendChild(list);

    // controls to add a range
    const rowControls = document.createElement("div");
    rowControls.className = "row";
    const start = document.createElement("input");
    start.placeholder = "HH:MM";
    const end = document.createElement("input");
    end.placeholder = "HH:MM";
    const addBtn = document.createElement("button");
    addBtn.textContent = "Add range";
    addBtn.addEventListener("click", () => {
      const s = start.value.trim();
      const e = end.value.trim();
      if (!/^\d\d:\d\d$/.test(s) || !/^\d\d:\d\d$/.test(e)) return alert("Times must be in HH:MM format.");
      schedules[idx].push({ start: s, end: e });
      renderSchedules(schedules);
    });
    rowControls.appendChild(start);
    rowControls.appendChild(end);
    rowControls.appendChild(addBtn);

    dayDiv.appendChild(rowControls);

    // clear day
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear day";
    clearBtn.style.marginTop = "6px";
    clearBtn.addEventListener("click", () => {
      schedules[idx] = [];
      renderSchedules(schedules);
    });
    dayDiv.appendChild(clearBtn);

    container.appendChild(dayDiv);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const locked = el("lockedMessage");
  const settingsArea = el("settingsArea");
  const pwInput = el("pwInput");
  const unlockBtn = el("unlockBtn");

  const settings = await loadSettings();
  locked.style.display = "block";
  settingsArea.style.display = "none";

  unlockBtn.addEventListener("click", () => {
    const attempt = pwInput.value || "";
    if (attempt === settings.password) {
      locked.style.display = "none";
      settingsArea.style.display = "block";
      populateForm(settings);
    } else {
      alert("Wrong password.");
    }
  });
  pwInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      unlockBtn.click();
    }
  });
});

function populateForm(settings) {
  el("whitelist").value = (settings.whitelist || []).join("\n");
  el("password").value = settings.password || "";
  renderSchedules(settings.schedules || [[],[],[],[],[],[],[]]);

  el("saveBtn").addEventListener("click", async () => {
    const wl = el("whitelist").value.split("\n").map(s => s.trim()).filter(Boolean);
    const pw = el("password").value;

    // reconstruct from UI
    const schedules = [];
    for (let i = 0; i < 7; i++) {
      const rows = document.querySelectorAll(`#day-${i} > div`);
      const ranges = [];
      rows.forEach(row => {
        const text = row.querySelector("span")?.textContent?.trim();
        const m = text?.match(/^(\d\d:\d\d)\s*—\s*(\d\d:\d\d)$/);
        if (m) ranges.push({ start: m[1], end: m[2] });
      });
      schedules.push(ranges);
    }

    chrome.storage.local.set({ whitelist: wl, password: pw, schedules }, () => {
      alert("Saved.");
    });
  });

  el("cancelBtn").addEventListener("click", () => window.location.reload());
}
