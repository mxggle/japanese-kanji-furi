const shared = window.FuriganaShared;
const elements = {
  style: document.getElementById("furiganaStyle"),
  hoverOnly: document.getElementById("hoverOnly"),
  unselectable: document.getElementById("unselectable"),
  useColorTags: document.getElementById("useColorTags"),
  colorMode: document.getElementById("colorMode"),
  colorTheme: document.getElementById("colorTheme"),
  refreshBtn: document.getElementById("refreshBtn"),
  optionsBtn: document.getElementById("optionsBtn"),
  status: document.getElementById("status")
};

initPopup();

async function initPopup() {
  populateThemes();
  const defaults = await shared.loadSettings();
  applySettings(defaults);
  bindEvents();
}

function populateThemes() {
  const themes = shared.COLOR_THEMES;
  elements.colorTheme.innerHTML = "";
  Object.entries(themes).forEach(([value, config]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = config.label || value;
    elements.colorTheme.appendChild(option);
  });
}

function applySettings(settings) {
  elements.style.value = settings.furiganaStyle;
  elements.hoverOnly.checked = Boolean(settings.hoverOnly);
  elements.unselectable.checked = Boolean(settings.unselectable);
  elements.useColorTags.checked = Boolean(settings.useColorTags);
  elements.colorMode.value = settings.colorMode || "grade";
  elements.colorTheme.value = settings.colorTheme || "sakura";
  toggleColorControls(settings.useColorTags);
}

function bindEvents() {
  elements.style.addEventListener("change", (event) => {
    updateSetting("furiganaStyle", event.target.value);
  });
  elements.hoverOnly.addEventListener("change", (event) => {
    updateSetting("hoverOnly", event.target.checked);
  });
  elements.unselectable.addEventListener("change", (event) => {
    updateSetting("unselectable", event.target.checked);
  });
  elements.useColorTags.addEventListener("change", (event) => {
    const enabled = event.target.checked;
    toggleColorControls(enabled);
    updateSetting("useColorTags", enabled, true);
  });
  elements.colorMode.addEventListener("change", (event) => {
    updateSetting("colorMode", event.target.value, true);
  });
  elements.colorTheme.addEventListener("change", (event) => {
    updateSetting("colorTheme", event.target.value, true);
  });
  elements.refreshBtn.addEventListener("click", () => {
    triggerRefresh();
  });
  elements.optionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function toggleColorControls(enabled) {
  elements.colorMode.disabled = !enabled;
  elements.colorTheme.disabled = !enabled;
}

async function updateSetting(key, value, notify = false) {
  try {
    await shared.saveSettings({ [key]: value });
    setStatus("Saved");
    if (notify) {
      notifyActiveTab({ type: "furigana:update-theme" });
    }
  } catch (err) {
    console.error("Furigana Companion: unable to save setting", err);
    setStatus("Error saving");
  }
}

function triggerRefresh() {
  setStatus("Refreshing...");
  notifyActiveTab({ type: "furigana:refresh" })
    .then((ok) => {
      setStatus(ok ? "Done" : "Not available");
    })
    .catch(() => setStatus("Not available"));
}

function notifyActiveTab(message) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs.length) {
        resolve(false);
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(response?.ok));
      });
    });
  });
}

let statusTimeout = null;
function setStatus(text) {
  elements.status.textContent = text;
  if (statusTimeout) {
    clearTimeout(statusTimeout);
  }
  statusTimeout = setTimeout(() => {
    elements.status.textContent = "Ready";
  }, 1800);
}
