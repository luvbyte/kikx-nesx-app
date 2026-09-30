let game = null;
let currentGame = null;
let emulatorPaused = false;

const controls = {
  up: jsnes.Controller.BUTTON_UP,
  down: jsnes.Controller.BUTTON_DOWN,
  left: jsnes.Controller.BUTTON_LEFT,
  right: jsnes.Controller.BUTTON_RIGHT,
  a: jsnes.Controller.BUTTON_A,
  b: jsnes.Controller.BUTTON_B,
  select: jsnes.Controller.BUTTON_SELECT,
  start: jsnes.Controller.BUTTON_START
};

const diagonalControls = {
  "up-left": ["up", "left"],
  "up-right": ["up", "right"],
  "down-left": ["down", "left"],
  "down-right": ["down", "right"]
};

const controllerState = {
  up: false,
  down: false,
  left: false,
  right: false,
  a: false,
  b: false,
  select: false,
  start: false
};

const romsPath = "home://etc/nesx/games";

/*
 * ---------------------------------------------------------
 * KIKX
 * ---------------------------------------------------------
 */

const kikxApp = new kikxSdk.createApp();
const fs = new kikxSdk.FileSystemService(kikxApp);

/*
 * ---------------------------------------------------------
 * ROM FILESYSTEM
 * ---------------------------------------------------------
 */

const romsLibrary = [];

let romsLoaded = false;
let romsLoading = false;

async function listRoms({ force = false } = {}) {
  // Return cached ROMs
  if (romsLoaded && !force) {
    return romsLibrary;
  }

  // Prevent multiple simultaneous requests
  if (romsLoading) {
    while (romsLoading) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return romsLibrary;
  }

  romsLoading = true;

  try {
    const isFallbackVersion = kikxApp.kikx.version < "0.4.3";

    const { data, error } = isFallbackVersion
      ? await fs.listFiles(romsPath)
      : await fs.quickListFiles(romsPath, {
          filter: "files",
          extensions: ".nes,.nsf"
        });

    if (error) {
      console.error("Failed to list ROMs:", error);

      return romsLibrary;
    }

    const files = !isFallbackVersion
      ? data.files
      : data.files.filter(file => {
          const name = file.name.toLowerCase();

          return (
            file.is_file && (name.endsWith(".nes") || name.endsWith(".nsf"))
          );
        });

    // Update cache
    romsLibrary.length = 0;
    romsLibrary.push(...files);

    romsLoaded = true;

    return romsLibrary;
  } finally {
    romsLoading = false;
  }
}

async function fetchRomData(name) {
  const { data, error } = await fs.readFile(`${romsPath}/${name}`);

  if (error) {
    throw new Error(error.detail || "Failed to read ROM");
  }

  return data;
}

/*
 * ---------------------------------------------------------
 * ROM DATA
 * ---------------------------------------------------------
 */

async function normalizeRomData(data) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Blob) {
    return blobToBinaryString(data);
  }

  if (data instanceof ArrayBuffer) {
    return arrayBufferToBinaryString(data);
  }

  if (data instanceof Uint8Array) {
    return uint8ArrayToBinaryString(data);
  }

  if (data && typeof data.arrayBuffer === "function") {
    const buffer = await data.arrayBuffer();

    return arrayBufferToBinaryString(buffer);
  }

  throw new Error("Unsupported ROM data format");
}

function blobToBinaryString(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(arrayBufferToBinaryString(reader.result));
    };

    reader.onerror = () => {
      reject(reader.error || new Error("Failed to read ROM"));
    };

    reader.readAsArrayBuffer(blob);
  });
}

function arrayBufferToBinaryString(buffer) {
  return uint8ArrayToBinaryString(new Uint8Array(buffer));
}

function uint8ArrayToBinaryString(bytes) {
  const chunkSize = 0x8000;

  let result = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));

    result += String.fromCharCode(...chunk);
  }

  return result;
}

/*
 * ---------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------
 */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatFileSize(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];

  const index = Math.floor(Math.log(bytes) / Math.log(1024));

  const size = bytes / Math.pow(1024, index);

  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/*
 * ---------------------------------------------------------
 * LOADING
 * ---------------------------------------------------------
 */

function setLoading(visible, text = "Loading NesX...") {
  const loading = document.getElementById("loading-screen");

  const loadingText = document.getElementById("loading-text");

  if (!loading) {
    return;
  }

  loading.style.display = visible ? "flex" : "none";

  if (loadingText) {
    loadingText.textContent = text;
  }
}

/*
 * ---------------------------------------------------------
 * LIBRARY
 * ---------------------------------------------------------
 */

let romSearchQuery = "";

async function showLibrary() {
  romSearchQuery = "";

  destroyGame();

  setLoading(true, "Loading games...");

  const roms = await listRoms();

  setLoading(false);

  renderLibrary(roms);
}

function renderLibrary(roms) {
  const main = $("#main");

  main.html(`
    <section class="library">

      <header class="library-header">

        <div>
          <div class="library-title">
            NesX
          </div>

          <div class="library-subtitle">
            NES Emulator
          </div>
        </div>

        <div class="game-count">
          ${roms.length}
        </div>

      </header>

      <div class="library-search">
        <div class="rom-search-wrap">
          <input
            id="rom-search"
            type="search"
            class="rom-search"
            placeholder="Search games"
            autocomplete="off"
            spellcheck="false"
          />
      
          <button
            type="button"
            id="rom-search-clear"
            class="rom-search-clear"
            aria-label="Clear search"
          >
            ×
          </button>
        </div>
      </div>

      <div
        id="rom-list"
        class="rom-list"
      ></div>

    </section>
  `);

  const searchInput = $("#rom-search");
  const clearButton = $("#rom-search-clear");

  searchInput.val(romSearchQuery);

  function updateSearchUI() {
    clearButton.css("display", searchInput.val().length ? "block" : "none");
  }

  searchInput.on("input", function () {
    romSearchQuery = this.value.trim().toLowerCase();

    updateSearchUI();
    renderRomList(roms);
  });

  clearButton.on("click", function () {
    searchInput.val("");
    romSearchQuery = "";

    updateSearchUI();
    renderRomList(roms);

    searchInput.trigger("focus");
  });

  updateSearchUI();

  renderRomList(roms);
}

function renderRomList(roms) {
  const list = document.getElementById("rom-list");
  const count = document.querySelector(".game-count");

  if (!list) {
    return;
  }

  const query = romSearchQuery;

  const filteredRoms = query
    ? roms.filter(rom => {
        const name = String(rom.stem || rom.name || "").toLowerCase();

        return name.includes(query);
      })
    : roms;

  if (count) {
    count.textContent = filteredRoms.length;
  }

  if (!filteredRoms.length) {
    list.innerHTML = `
      <div class="empty-state">

        <div class="empty-icon">
          😿
        </div>

        <div class="empty-title">
          No games found
        </div>

        <div class="empty-description">
          Put ".nes, .nsf" games in "etc/nesx/games".
        </div>

      </div>
    `;

    return;
  }

  list.innerHTML = filteredRoms
    .map(
      (rom, index) => `
        <button
          type="button"
          class="rom-item"
          data-rom-name="${escapeHtml(rom.name)}"
        >

          <div class="rom-icon">
            🎮
          </div>

          <div class="rom-info">

            <div class="rom-name">
              ${escapeHtml(rom.stem || rom.name)}
            </div>

            <div class="rom-meta">

              <span>
                ${rom.name.toLowerCase().endsWith(".nsf") ? "NSF" : "NES"}
              </span>
            </div>

          </div>

          <div class="rom-arrow">
            ›
          </div>

        </button>
      `
    )
    .join("");

  $(list)
    .find(".rom-item")
    .on("click", function () {
      const name = $(this).data("rom-name");

      const rom = roms.find(item => item.name === name);

      if (rom) {
        loadGame(rom);
      }
    });
}

/*
 * ---------------------------------------------------------
 * LOAD GAME
 * ---------------------------------------------------------
 */

async function loadGame(rom) {
  try {
    setLoading(true, `Loading ${rom.stem || rom.name}...`);

    const data = await fetchRomData(rom.name);

    const romData = await normalizeRomData(data);

    currentGame = rom;

    renderEmulator(rom.stem || rom.name);

    const nesContainer = document.getElementById("nes");

    game = new NesXGame(nesContainer);

    game.loadROM(romData);

    emulatorPaused = false;

    setupControls();

    setLoading(false);
  } catch (error) {
    console.error("Failed to load game:", error);

    setLoading(false);

    $(".game-title").css({ color: "red" });
    console.error(error.message || "Failed to load game.");

    // showLibrary();
  }
}

/*
 * ---------------------------------------------------------
 * EMULATOR UI
 * ---------------------------------------------------------
 */

function renderEmulator(title) {
  $("#main").html(`
    <section class="emulator">

      <header class="emulator-header">

        <button
          id="back-games"
          type="button"
          class="back-button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
          	<path d="M0 0h24v24H0z" fill="none" />
          	<path fill="currentColor" d="M19 11H7.14l3.63-4.36a1 1 0 1 0-1.54-1.28l-5 6a1 1 0 0 0-.09.15c0 .05 0 .08-.07.13A1 1 0 0 0 4 12a1 1 0 0 0 .07.36c0 .05 0 .08.07.13a1 1 0 0 0 .09.15l5 6A1 1 0 0 0 10 19a1 1 0 0 0 .64-.23a1 1 0 0 0 .13-1.41L7.14 13H19a1 1 0 0 0 0-2" />
          </svg>
        </button>

        <div class="game-title">
          ${escapeHtml(title)}
        </div>

        <div class="header-spacer"></div>

      </header>


      <div class="nes-wrapper">

        <div id="nes"></div>

      </div>


      <div
        id="nes-controls"
        class="controls"
      >

        <div class="system-buttons">

          <button
            type="button"
            class="system-button"
            data-key="select"
          >
            SELECT
          </button>

          <button
            type="button"
            class="system-button"
            data-key="start"
          >
            START
          </button>

        </div>


        <div class="nes-controller">
        
          <div class="dpad">

            <button
              type="button"
              class="control-button"
              data-key="up"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024">
              	<path d="M0 0h1024v1024H0z" fill="none" />
              	<path fill="currentColor" d="M858.9 689L530.5 308.2c-9.4-10.9-27.5-10.9-37 0L165.1 689c-12.2 14.2-1.2 35 18.5 35h656.8c19.7 0 30.7-20.8 18.5-35" />
              </svg>
            </button>
          
            <button
              type="button"
              class="control-button"
              data-key="up-left"
            ></button>
          
            <button
              type="button"
              class="control-button"
              data-key="up-right"
            ></button>
          
            <button
              type="button"
              class="control-button"
              data-key="left"
            >
              <!-- LEFT SVG -->
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024">
              	<path d="M0 0h1024v1024H0z" fill="none" />
              	<path fill="currentColor" d="M689 165.1L308.2 493.5c-10.9 9.4-10.9 27.5 0 37L689 858.9c14.2 12.2 35 1.2 35-18.5V183.6c0-19.7-20.8-30.7-35-18.5" />
              </svg>
            </button>
          
            <button
              type="button"
              class="control-button"
              data-key="right"
            >
              <!-- RIGHT SVG -->
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024">
              	<path d="M0 0h1024v1024H0z" fill="none" />
              	<path fill="currentColor" d="M715.8 493.5L335 165.1c-14.2-12.2-35-1.2-35 18.5v656.8c0 19.7 20.8 30.7 35 18.5l380.8-328.4c10.9-9.4 10.9-27.6 0-37" />
              </svg>
            </button>
          
            <button
              type="button"
              class="control-button"
              data-key="down-left"
            ></button>
          
            <button
              type="button"
              class="control-button"
              data-key="down"
            >
              <!-- DOWN SVG -->
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024">
              	<path d="M0 0h1024v1024H0z" fill="none" />
              	<path fill="currentColor" d="M840.4 300H183.6c-19.7 0-30.7 20.8-18.5 35l328.4 380.8c9.4 10.9 27.5 10.9 37 0L858.9 335c12.2-14.2 1.2-35-18.5-35" />
              </svg>
            </button>
          
            <button
              type="button"
              class="control-button"
              data-key="down-right"
            ></button>
          
          </div>

          <div class="action-buttons">

            <button
              type="button"
              class="action-button"
              data-key="b"
            >
              B
            </button>

            <button
              type="button"
              class="action-button"
              data-key="a"
            >
              A
            </button>

          </div>

        </div>

      </div>

    </section>
  `);

  $("#back-games").on("click", showLibrary);
}

/*
 * ---------------------------------------------------------
 * CONTROLLER
 * ---------------------------------------------------------
 */

function setController(key, pressed) {
  if (diagonalControls[key]) {
    diagonalControls[key].forEach(direction => {
      setController(direction, pressed);
    });

    updateButtonUI(key, pressed);

    return;
  }

  if (!game || !Object.prototype.hasOwnProperty.call(controls, key)) {
    return;
  }

  if (controllerState[key] === pressed) {
    return;
  }

  controllerState[key] = pressed;

  if (pressed) {
    game.buttonDown(controls[key]);
  } else {
    game.buttonUp(controls[key]);
  }

  updateButtonUI(key, pressed);
}

function updateButtonUI(key, pressed) {
  const button = document.querySelector(`[data-key="${key}"]`);

  if (!button) {
    return;
  }

  button.classList.toggle("pressed", pressed);
}

function releaseEverything() {
  Object.keys(controllerState).forEach(key => {
    if (controllerState[key]) {
      setController(key, false);
    }
  });
}

/*
 * ---------------------------------------------------------
 * TOUCH CONTROLS
 * ---------------------------------------------------------
 */

const activeTouches = new Map();

function setupControls() {
  const buttons = document.querySelectorAll("[data-key]");

  buttons.forEach(button => {
    button.addEventListener(
      "touchstart",
      event => {
        event.preventDefault();

        if (game) {
          game.resumeAudio();
        }

        const key = button.dataset.key;

        for (const touch of event.changedTouches) {
          activeTouches.set(touch.identifier, key);
        }

        setController(key, true);
      },
      {
        passive: false
      }
    );

    button.addEventListener(
      "touchmove",
      event => {
        event.preventDefault();

        for (const touch of event.changedTouches) {
          const element = document.elementFromPoint(
            touch.clientX,
            touch.clientY
          );

          const target = element?.closest("[data-key]");

          if (!target) {
            continue;
          }

          const oldKey = activeTouches.get(touch.identifier);
          const newKey = target.dataset.key;

          if (oldKey === newKey) {
            continue;
          }

          activeTouches.set(touch.identifier, newKey);

          if (oldKey) {
            const oldKeyStillUsed = Array.from(activeTouches.entries()).some(
              ([id, key]) => id !== touch.identifier && key === oldKey
            );

            if (!oldKeyStillUsed) {
              setController(oldKey, false);
            }
          }

          setController(newKey, true);
        }
      },
      {
        passive: false
      }
    );

    button.addEventListener("mousedown", event => {
      event.preventDefault();

      setController(button.dataset.key, true);
    });
  });
}

document.addEventListener(
  "touchend",
  event => {
    for (const touch of event.changedTouches) {
      const key = activeTouches.get(touch.identifier);

      if (!key) {
        continue;
      }

      activeTouches.delete(touch.identifier);

      const stillPressed = Array.from(activeTouches.values()).includes(key);

      if (!stillPressed) {
        setController(key, false);
      }
    }
  },
  {
    passive: true
  }
);

document.addEventListener(
  "touchcancel",
  event => {
    for (const touch of event.changedTouches) {
      const key = activeTouches.get(touch.identifier);

      if (!key) {
        continue;
      }

      activeTouches.delete(touch.identifier);

      const stillPressed = Array.from(activeTouches.values()).includes(key);

      if (!stillPressed) {
        setController(key, false);
      }
    }
  },
  {
    passive: true
  }
);

document.addEventListener("mouseup", () => {
  releaseEverything();
});

document.addEventListener("keydown", event => {
  const key = keyboardMap[event.key];

  if (!key) {
    return;
  }

  event.preventDefault();

  if (game) {
    game.resumeAudio();
  }

  setController(key, true);
});

/*
 * ---------------------------------------------------------
 * KEYBOARD
 * ---------------------------------------------------------
 */

const keyboardMap = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",

  x: "a",
  X: "a",

  z: "b",
  Z: "b",

  Enter: "start",

  Shift: "select"
};

document.addEventListener("keydown", event => {
  const key = keyboardMap[event.key];

  if (!key) {
    return;
  }

  event.preventDefault();

  setController(key, true);
});

document.addEventListener("keyup", event => {
  const key = keyboardMap[event.key];

  if (!key) {
    return;
  }

  event.preventDefault();

  setController(key, false);
});

/*
 * ---------------------------------------------------------
 * PAUSE / RESUME
 * ---------------------------------------------------------
 */

function pauseEmulator() {
  if (!game || emulatorPaused) {
    return;
  }

  emulatorPaused = true;

  releaseEverything();

  game.pause();
}

function resumeEmulator() {
  if (!game || !emulatorPaused) {
    return;
  }

  if (document.hidden) {
    return;
  }

  emulatorPaused = false;

  game.resume();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseEmulator();
  } else {
    resumeEmulator();
  }
});

window.addEventListener("blur", () => {
  pauseEmulator();
});

window.addEventListener("focus", () => {
  resumeEmulator();
});

kikxApp.onBlur(() => {
  pauseEmulator();
});

kikxApp.onFocus(() => {
  resumeEmulator();
});

/*
 * ---------------------------------------------------------
 * CLEANUP
 * ---------------------------------------------------------
 */

function destroyGame() {
  releaseEverything();

  if (game) {
    game.stop();
    game = null;
  }

  currentGame = null;
  emulatorPaused = false;

  activeTouches.clear();
}

/*
 * ---------------------------------------------------------
 * START
 * ---------------------------------------------------------
 */

async function loadFromPath(path) {
  const { data, error } = await fs.info(path);
  if (error || ![".nes", ".nsf"].includes(data.suffix)) {
    return false;
  }

  await loadGame(data);

  return true;
}

async function init() {
  try {
    setLoading(true, "Loading NesX...");

    // If share
    const { query, share } = kikxApp.info.options;
    const isValidShare =
      share?.itemType === "file" && share.item.endsWith(".nes");

    const path = isValidShare ? share.item : query?.file;

    const success = await loadFromPath(path);

    if (!success) {
      await showLibrary();
    }
  } catch (error) {
    console.error("NesX initialization failed:", error);

    setLoading(false);
  }
}

$(document).ready(() => {
  kikxApp.run(init);
});
