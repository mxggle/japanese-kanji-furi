const shared = window.FuriganaShared;
const els = {
  style: document.getElementById("optStyle"),
  romaji: document.getElementById("optRomajiSystem"),
  hover: document.getElementById("optHoverOnly"),
  unselectable: document.getElementById("optUnselectable"),
  useColor: document.getElementById("optUseColor"),
  colorMode: document.getElementById("optColorMode"),
  colorTheme: document.getElementById("optColorTheme"),
  status: document.getElementById("status"),
  themePreview: document.getElementById("themePreview"),
  reset: document.getElementById("resetBtn"),
  apply: document.getElementById("applyBtn")
};

let currentSettings = { ...shared.DEFAULT_SETTINGS };

initOptions();

async function initOptions() {
  populateThemeOptions();
  currentSettings = await shared.loadSettings();
  applySettings(currentSettings);
  bindHandlers();
}

function populateThemeOptions() {
  els.colorTheme.innerHTML = "";
  Object.entries(shared.COLOR_THEMES).forEach(([key, theme]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = theme.label || key;
    els.colorTheme.appendChild(option);
  });
}

function applySettings(settings) {
  els.style.value = settings.furiganaStyle;
  els.romaji.value = settings.romajiSystem || "hepburn";
  els.hover.checked = Boolean(settings.hoverOnly);
  els.unselectable.checked = Boolean(settings.unselectable);
  els.useColor.checked = Boolean(settings.useColorTags);
  els.colorMode.value = settings.colorMode || "grade";
  els.colorTheme.value = settings.colorTheme || "sakura";
  toggleColorSection(settings.useColorTags);
  renderThemePreview(settings.colorTheme);
  setStatus("Saved", false);
}

function bindHandlers() {
  els.style.addEventListener("change", () => persist({ furiganaStyle: els.style.value }));
  els.romaji.addEventListener("change", () => persist({ romajiSystem: els.romaji.value }));
  els.hover.addEventListener("change", () => persist({ hoverOnly: els.hover.checked }));
  els.unselectable.addEventListener("change", () => persist({ unselectable: els.unselectable.checked }));
  els.useColor.addEventListener("change", () => {
    toggleColorSection(els.useColor.checked);
    persist({ useColorTags: els.useColor.checked }, true);
  });
  els.colorMode.addEventListener("change", () => {
    persist({ colorMode: els.colorMode.value }, true);
  });
  els.colorTheme.addEventListener("change", () => {
    renderThemePreview(els.colorTheme.value);
    persist({ colorTheme: els.colorTheme.value }, true);
  });
  els.reset.addEventListener("click", handleReset);
  els.apply.addEventListener("click", () => {
    notifyActiveTab({ type: "furigana:refresh" });
  });
}

function toggleColorSection(enabled) {
  els.colorMode.disabled = !enabled;
  els.colorTheme.disabled = !enabled;
  els.themePreview.classList.toggle("theme-preview--disabled", !enabled);
}

async function persist(partial, pingTab = false) {
  try {
    await shared.saveSettings(partial);
    currentSettings = { ...currentSettings, ...partial };
    setStatus("Saved");
    if (pingTab) {
      notifyActiveTab({ type: "furigana:update-theme" });
    }
  } catch (err) {
    console.error("Furigana Companion: failed to save options", err);
    setStatus("Save failed");
  }
}

async function handleReset() {
  try {
    currentSettings = await shared.resetSettings();
    applySettings(currentSettings);
    notifyActiveTab({ type: "furigana:refresh" });
  } catch (err) {
    setStatus("Reset failed");
  }
}

function renderThemePreview(themeKey) {
  const theme = shared.COLOR_THEMES[themeKey] || shared.COLOR_THEMES.sakura;
  if (!theme) {
    els.themePreview.textContent = "Theme preview unavailable.";
    return;
  }
  els.themePreview.innerHTML = "";
  const gradeRow = createSwatchRow("Grade", theme.grade, ["grade-1", "grade-2", "grade-3", "grade-4", "grade-5", "grade-6"]);
  const jlptRow = createSwatchRow("JLPT", theme.jlpt, ["jlpt-n5", "jlpt-n4", "jlpt-n3", "jlpt-n2", "jlpt-n1"]);
  els.themePreview.appendChild(gradeRow);
  els.themePreview.appendChild(jlptRow);
}

function createSwatchRow(label, values, order) {
  const row = document.createElement("div");
  row.className = "preview-row";
  const title = document.createElement("span");
  title.textContent = label;
  const swatchGroup = document.createElement("div");
  swatchGroup.className = "swatch-group";
  order.forEach((key) => {
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = values?.[key] || "#e2e8f0";
    swatch.title = key;
    swatchGroup.appendChild(swatch);
  });
  row.appendChild(title);
  row.appendChild(swatchGroup);
  return row;
}

function notifyActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) {
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, message, () => void chrome.runtime.lastError);
  });
}

let statusTimer = null;
function setStatus(text, transient = true) {
  els.status.textContent = text;
  if (!transient) {
    return;
  }
  if (statusTimer) {
    clearTimeout(statusTimer);
  }
  statusTimer = setTimeout(() => {
    els.status.textContent = "Idle";
  }, 2000);
}
