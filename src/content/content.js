(function runFuriganaContentScript() {
  if (window.__furiganaCompanionLoaded) {
    return;
  }
  window.__furiganaCompanionLoaded = true;

  const JAPANESE_REGEX = /[\u3400-\u4dbf\u4e00-\u9faf\u3040-\u30ff\uff66-\uff9f]/;
  const IGNORED_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "KBD", "SAMP", "PRE", "NOSCRIPT"]);
  const SOURCE_ATTR = "data-furigana-source";
  const WRAPPER_SELECTOR = `[${SOURCE_ATTR}]`;
  const RUBY_ATTR_VALUE = "injected";
  const MAX_BATCH = 35;
  const MAX_INITIAL_NODES = 600;
  const MAX_NODE_CHARS = 800;

  const shared = window.FuriganaShared;
  const KuroshiroCtor = window.Kuroshiro?.default || window.Kuroshiro;
  const KuromojiAnalyzerCtor = window.KuromojiAnalyzer?.default || window.KuromojiAnalyzer;
  if (!shared) {
    console.warn("Furigana Companion: shared settings script missing.");
    return;
  }

  if (typeof KuroshiroCtor !== "function" || typeof KuromojiAnalyzerCtor !== "function") {
    console.warn("Furigana Companion: conversion libraries missing.");
    return;
  }

  let settings = { ...shared.DEFAULT_SETTINGS };
  let kuroshiroReady = null;
  let kanjiMapPromise = null;
  let kanjiMap = null;
  let mutationObserver = null;
  let queueHandle = null;
  let idleCallbackId = null;
  const nodeQueue = new Set();

  init();

  async function init() {
    await waitForBody();
    settings = await shared.loadSettings();
    applyDocumentFlags();
    try {
      await ensureKuroshiro();
    } catch (err) {
      console.error("Furigana Companion: failed to init Kuroshiro", err);
      return;
    }
    if (settings.useColorTags) {
      await ensureKanjiMap();
    }
    queueInitialScan();
    setupObservers();
    bindRuntimeEvents();
  }

  function waitForBody() {
    if (document.body) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      window.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
  }

  function applyDocumentFlags() {
    const root = document.documentElement;
    root.setAttribute("data-furigana-hover", settings.hoverOnly ? "true" : "false");
    root.setAttribute("data-furigana-unselectable", settings.unselectable ? "true" : "false");
    root.setAttribute("data-furigana-color", settings.useColorTags ? "on" : "off");
    root.setAttribute("data-furigana-theme", settings.colorTheme || "sakura");
    root.setAttribute("data-furigana-color-mode", settings.colorMode || "grade");
    applyThemeVariables(root);
  }

  function applyThemeVariables(root) {
    const theme = shared.COLOR_THEMES[settings.colorTheme] || shared.COLOR_THEMES.sakura;
    if (!theme) {
      return;
    }
    const entries = [
      ...Object.entries(theme.grade || {}),
      ...Object.entries(theme.jlpt || {})
    ];
    entries.forEach(([token, color]) => {
      root.style.setProperty(`--furigana-${token}`, color);
    });
  }

  function queueInitialScan() {
    const body = document.body;
    if (!body) {
      return;
    }
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isProcessableText(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const initialNodes = [];
    while (walker.nextNode() && initialNodes.length < MAX_INITIAL_NODES) {
      initialNodes.push(walker.currentNode);
    }
    initialNodes.forEach((node) => queueTextNode(node));
  }

  function setupObservers() {
    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
          queueTextNode(mutation.target);
          continue;
        }
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            queueTextNode(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            collectTextNodes(node).forEach((textNode) => queueTextNode(textNode));
          }
        });
      }
    });
    mutationObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isProcessableText(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
      if (nodes.length >= MAX_INITIAL_NODES) {
        break;
      }
    }
    return nodes;
  }

  function isProcessableText(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return false;
    }
    if (!node.parentElement) {
      return false;
    }
    if (node.parentElement.closest(WRAPPER_SELECTOR)) {
      return false;
    }
    if (node.parentElement.closest("ruby")) {
      return false;
    }
    if (ignoredAncestor(node.parentElement)) {
      return false;
    }
    const value = node.nodeValue;
    if (!value || !value.trim()) {
      return false;
    }
    if (value.length > MAX_NODE_CHARS) {
      return false;
    }
    if (!JAPANESE_REGEX.test(value)) {
      return false;
    }
    return true;
  }

  function ignoredAncestor(el) {
    if (!el) {
      return false;
    }
    if (IGNORED_TAGS.has(el.tagName)) {
      return true;
    }
    if (el.closest("textarea,input,pre,[contenteditable]")) {
      return true;
    }
    return false;
  }

  function queueTextNode(node) {
    if (!isProcessableText(node)) {
      return;
    }
    nodeQueue.add(node);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (queueHandle) {
      return;
    }
    const flush = () => {
      queueHandle = null;
      if (idleCallbackId !== null) {
        window.cancelIdleCallback?.(idleCallbackId);
        idleCallbackId = null;
      }
      void flushQueue();
    };
    if (typeof window.requestIdleCallback === "function") {
      queueHandle = true;
      idleCallbackId = window.requestIdleCallback(flush);
    } else {
      queueHandle = window.setTimeout(flush, 80);
    }
  }

  async function flushQueue() {
    if (nodeQueue.size === 0) {
      return;
    }
    const nodes = Array.from(nodeQueue);
    nodeQueue.clear();
    await ensureKuroshiro();
    if (settings.useColorTags) {
      await ensureKanjiMap();
    }
    let processed = 0;
    for (const node of nodes) {
      if (!isProcessableText(node)) {
        continue;
      }
      try {
        await convertTextNode(node);
      } catch (err) {
        console.warn("Furigana Companion: conversion failed", err);
      }
      processed += 1;
      if (processed % MAX_BATCH === 0) {
        await delay(0);
      }
    }
  }

  async function convertTextNode(node) {
    const parent = node.parentNode;
    if (!parent) {
      return;
    }
    const original = node.nodeValue || "";
    const html = await convertText(original);
    if (!html || html.trim() === original.trim()) {
      return;
    }
    const wrapper = document.createElement("span");
    wrapper.className = "furigana-wrapper";
    wrapper.setAttribute(SOURCE_ATTR, original);
    wrapper.innerHTML = html;
    decorateRubies(wrapper);
    parent.replaceChild(wrapper, node);
  }

  async function convertText(text) {
    if (!text || !JAPANESE_REGEX.test(text)) {
      return null;
    }
    const instance = await ensureKuroshiro();
    return instance.convert(text, {
      mode: "furigana",
      to: settings.furiganaStyle,
      romajiSystem: settings.romajiSystem ?? "hepburn"
    });
  }

  function decorateRubies(scope) {
    scope.querySelectorAll("ruby").forEach((ruby) => {
      ruby.setAttribute("data-furigana", RUBY_ATTR_VALUE);
      if (settings.useColorTags && kanjiMap) {
        const code = computeLevelCode(ruby);
        if (code) {
          ruby.setAttribute("data-furigana-level-code", code);
        } else {
          ruby.removeAttribute("data-furigana-level-code");
        }
      } else {
        ruby.removeAttribute("data-furigana-level-code");
      }
      const tone = detectTone(ruby);
      if (tone) {
        ruby.setAttribute("data-furigana-tone", tone);
      } else {
        ruby.removeAttribute("data-furigana-tone");
      }
    });
  }

  function computeLevelCode(ruby) {
    if (!kanjiMap) {
      return null;
    }
    const mode = settings.colorMode || "grade";
    const baseText = extractBaseText(ruby);
    if (!baseText) {
      return null;
    }
    if (mode === "grade") {
      return pickGradeCode(baseText);
    }
    return pickJlptCode(baseText);
  }

  function pickGradeCode(text) {
    let highest = null;
    for (const char of text) {
      const entry = kanjiMap[char];
      if (!entry || typeof entry.grade !== "number") {
        continue;
      }
      if (!highest || entry.grade > highest) {
        highest = entry.grade;
      }
    }
    if (!highest) {
      return null;
    }
    const normalized = normalizeGrade(highest);
    return normalized ? `grade-${normalized}` : null;
  }

  function pickJlptCode(text) {
    let hardest = null;
    for (const char of text) {
      const entry = kanjiMap[char];
      if (!entry || !entry.jlpt_new) {
        continue;
      }
      if (!hardest || entry.jlpt_new < hardest) {
        hardest = entry.jlpt_new;
      }
    }
    return hardest ? `jlpt-n${hardest}` : null;
  }

  function extractBaseText(ruby) {
    const parts = [];
    ruby.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName;
        if (tag === "RT" || tag === "RP") {
          return;
        }
        parts.push(node.textContent || "");
      }
    });
    return parts.join("").trim();
  }

  function normalizeGrade(value) {
    if (value >= 1 && value <= 10) {
      return value;
    }
    return null;
  }

  function detectTone(ruby) {
    const rgb = getEffectiveBackground(ruby);
    if (!rgb) {
      return null;
    }
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return luminance < 0.45 ? "dark" : "light";
  }

  function getEffectiveBackground(element) {
    let current = element;
    while (current && current !== document.documentElement) {
      const color = parseColor(window.getComputedStyle(current).backgroundColor);
      if (color && color[3] > 0) {
        return color;
      }
      if (current.parentElement) {
        current = current.parentElement;
      } else {
        const host = current.getRootNode()?.host;
        current = host || null;
      }
    }
    return [255, 255, 255, 1];
  }

  function parseColor(value) {
    if (!value || value === "transparent" || value === "inherit") {
      return null;
    }
    const rgb = value.match(/rgba?\(([^)]+)\)/i);
    if (rgb) {
      const parts = rgb[1].split(",").map((part) => part.trim());
      if (parts.length >= 3) {
        const r = Number.parseFloat(parts[0]);
        const g = Number.parseFloat(parts[1]);
        const b = Number.parseFloat(parts[2]);
        const a = parts[3] !== undefined ? Number.parseFloat(parts[3]) : 1;
        if ([r, g, b].every((n) => Number.isFinite(n))) {
          return [clampColor(r), clampColor(g), clampColor(b), clampAlpha(a)];
        }
      }
      return null;
    }
    if (value.startsWith("#")) {
      const hex = value.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
        return [r, g, b, a];
      }
      if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return [r, g, b, a];
      }
    }
    return null;
  }

  function clampColor(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function clampAlpha(value) {
    if (!Number.isFinite(value)) {
      return 1;
    }
    return Math.max(0, Math.min(1, value));
  }

  function bindRuntimeEvents() {
    chrome.storage.onChanged.addListener(handleSettingsChange);
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message) {
        return;
      }
      if (message.type === "furigana:refresh") {
        refreshAll().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
      }
      if (message.type === "furigana:update-theme") {
        applyDocumentFlags();
        sendResponse({ ok: true });
        return false;
      }
      return undefined;
    });
  }

  async function refreshAll() {
    const wrappers = document.querySelectorAll(WRAPPER_SELECTOR);
    await ensureKuroshiro();
    if (settings.useColorTags) {
      await ensureKanjiMap();
    }
    for (const wrapper of wrappers) {
      await updateWrapper(wrapper);
    }
    queueInitialScan();
  }

  async function updateWrapper(wrapper) {
    if (!(wrapper instanceof HTMLElement)) {
      return;
    }
    const source = wrapper.getAttribute(SOURCE_ATTR);
    if (!source) {
      return;
    }
    const html = await convertText(source);
    if (!html) {
      return;
    }
    wrapper.innerHTML = html;
    decorateRubies(wrapper);
  }

  function handleSettingsChange(changes, area) {
    if (area !== "sync") {
      return;
    }
    let relevant = false;
    Object.entries(changes).forEach(([key, payload]) => {
      if (!(key in shared.DEFAULT_SETTINGS)) {
        return;
      }
      settings[key] = payload.newValue;
      relevant = true;
    });
    if (!relevant) {
      return;
    }
    applyDocumentFlags();
    const needsRepaint = ["furiganaStyle", "romajiSystem", "useColorTags", "colorMode"].some((key) => key in changes);
    if (needsRepaint) {
      void refreshAll();
    }
  }

  function ensureKuroshiro() {
    if (kuroshiroReady) {
      return kuroshiroReady;
    }
    kuroshiroReady = (async () => {
      const instance = new KuroshiroCtor();
      await instance.init(
        new KuromojiAnalyzerCtor({
          dictPath: chrome.runtime.getURL("vendor/kuromoji-dict/")
        })
      );
      return instance;
    })();
    return kuroshiroReady;
  }

  function ensureKanjiMap() {
    if (kanjiMapPromise) {
      return kanjiMapPromise;
    }
    kanjiMapPromise = fetch(chrome.runtime.getURL("vendor/kanji-data.json"))
      .then((response) => response.json())
      .then((data) => {
        kanjiMap = data;
        return kanjiMap;
      })
      .catch((err) => {
        console.warn("Furigana Companion: failed to load kanji metadata", err);
        kanjiMap = null;
        return null;
      });
    return kanjiMapPromise;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
