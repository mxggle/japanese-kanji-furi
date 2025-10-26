(function attachFuriganaShared(globalScope) {
  const DEFAULT_SETTINGS = {
    furiganaStyle: "hiragana",
    romajiSystem: "hepburn",
    hoverOnly: false,
    unselectable: false,
    useColorTags: true,
    colorMode: "grade",
    colorTheme: "sakura"
  };

  const COLOR_THEMES = {
    sakura: {
      label: "Sakura Bloom",
      grade: {
        "grade-1": "#f472b6",
        "grade-2": "#ec4899",
        "grade-3": "#db2777",
        "grade-4": "#be185d",
        "grade-5": "#9d174d",
        "grade-6": "#831843",
        "grade-7": "#701a75",
        "grade-8": "#6b0f4a",
        "grade-9": "#581c87",
        "grade-10": "#4c1d95"
      },
      jlpt: {
        "jlpt-n5": "#14b8a6",
        "jlpt-n4": "#0ea5e9",
        "jlpt-n3": "#6366f1",
        "jlpt-n2": "#a855f7",
        "jlpt-n1": "#f43f5e"
      }
    },
    midnight: {
      label: "Midnight Neon",
      grade: {
        "grade-1": "#5eead4",
        "grade-2": "#34d399",
        "grade-3": "#22d3ee",
        "grade-4": "#0ea5e9",
        "grade-5": "#3b82f6",
        "grade-6": "#8b5cf6",
        "grade-7": "#a855f7",
        "grade-8": "#c084fc",
        "grade-9": "#f5d0fe",
        "grade-10": "#f472b6"
      },
      jlpt: {
        "jlpt-n5": "#f97316",
        "jlpt-n4": "#fb7185",
        "jlpt-n3": "#f472b6",
        "jlpt-n2": "#ec4899",
        "jlpt-n1": "#e11d48"
      }
    },
    matcha: {
      label: "Matcha Notes",
      grade: {
        "grade-1": "#a3e635",
        "grade-2": "#84cc16",
        "grade-3": "#65a30d",
        "grade-4": "#4d7c0f",
        "grade-5": "#3f6212",
        "grade-6": "#365314",
        "grade-7": "#2f4f18",
        "grade-8": "#15803d",
        "grade-9": "#166534",
        "grade-10": "#14532d"
      },
      jlpt: {
        "jlpt-n5": "#22c55e",
        "jlpt-n4": "#10b981",
        "jlpt-n3": "#14b8a6",
        "jlpt-n2": "#0d9488",
        "jlpt-n1": "#0f766e"
      }
    },
    ember: {
      label: "Ember Fade",
      grade: {
        "grade-1": "#facc15",
        "grade-2": "#f97316",
        "grade-3": "#fb923c",
        "grade-4": "#f97316",
        "grade-5": "#ef4444",
        "grade-6": "#dc2626",
        "grade-7": "#b91c1c",
        "grade-8": "#b91c1c",
        "grade-9": "#7f1d1d",
        "grade-10": "#450a0a"
      },
      jlpt: {
        "jlpt-n5": "#fde047",
        "jlpt-n4": "#facc15",
        "jlpt-n3": "#f97316",
        "jlpt-n2": "#ea580c",
        "jlpt-n1": "#dc2626"
      }
    }
  };

  const COLOR_MODES = [
    { value: "grade", label: "School grade" },
    { value: "jlpt", label: "JLPT level" }
  ];

  function withChrome(callback, fallback) {
    try {
      if (typeof chrome !== "undefined" && chrome?.storage?.sync) {
        return callback(chrome);
      }
    } catch (err) {
      console.warn("FuriganaShared chrome access failed", err);
    }
    return typeof fallback === "function" ? fallback() : fallback;
  }

  function loadSettings() {
    return new Promise((resolve) => {
      withChrome((api) => {
        api.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
          resolve({ ...DEFAULT_SETTINGS, ...stored });
        });
      }, () => resolve({ ...DEFAULT_SETTINGS }));
    });
  }

  function saveSettings(partial) {
    return new Promise((resolve, reject) => {
      withChrome((api) => {
        api.storage.sync.set(partial, () => {
          if (api.runtime?.lastError) {
            reject(api.runtime.lastError);
          } else {
            resolve();
          }
        });
      }, () => reject(new Error("Chrome storage API unavailable")));
    });
  }

  function resetSettings() {
    return new Promise((resolve, reject) => {
      withChrome((api) => {
        api.storage.sync.set({ ...DEFAULT_SETTINGS }, () => {
          if (api.runtime?.lastError) {
            reject(api.runtime.lastError);
          } else {
            resolve({ ...DEFAULT_SETTINGS });
          }
        });
      }, () => reject(new Error("Chrome storage API unavailable")));
    });
  }

  const sharedApi = {
    DEFAULT_SETTINGS,
    COLOR_THEMES,
    COLOR_MODES,
    loadSettings,
    saveSettings,
    resetSettings
  };

  globalScope.FuriganaShared = sharedApi;
})(typeof self !== "undefined" ? self : this);
