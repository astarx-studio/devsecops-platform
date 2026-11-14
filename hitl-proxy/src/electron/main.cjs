const {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  screen,
  Tray,
} = require("electron");
const path = require("node:path");

// Isolate from other unpackaged Electron apps (default userData is shared
// "Electron") so requestSingleInstanceLock / lockfile cannot collide and
// silently quit the tray at logon.
app.setName("HITL Proxy");
if (process.platform === "win32") {
  app.setAppUserModelId("com.hitl.proxy");
}
app.setPath("userData", path.join(app.getPath("appData"), "HITL Proxy"));

const PORT = Number(process.env.HITL_PORT ?? 3877);
const BASE_URL = (
  process.env.HITL_UI_URL ?? `http://127.0.0.1:${PORT}`
).replace(/\/$/, "");

const POPUP_WIDTH = 420;
const POPUP_HEIGHT = 560;
const POLL_MS = 2000;

/** White "?" on dark-red circle — tray, taskbar, and window chrome. */
function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, "icon.ico"),
    path.join(__dirname, "icon.png"),
    path.join(__dirname, "..", "..", "assets", "icon.ico"),
    path.join(__dirname, "..", "..", "assets", "icon.png"),
  ];
  for (const candidate of candidates) {
    const img = nativeImage.createFromPath(candidate);
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createEmpty();
}

/** @type {import('electron').NativeImage | null} */
let appIcon = null;
function getAppIcon() {
  if (!appIcon) appIcon = resolveAppIcon();
  return appIcon;
}

const argv = process.argv.slice(1);
/** Boot / autostart: stay in tray; never open the dashboard. */
const startInTray =
  argv.includes("--tray") ||
  argv.includes("--hidden") ||
  process.env.HITL_START_TRAY === "1" ||
  app.getLoginItemSettings?.().wasOpenedAsHidden === true;

/** @type {import('electron').Tray | null} */
let tray = null;
/** @type {import('electron').BrowserWindow | null} */
let dashboard = null;
/** @type {Map<string, import('electron').BrowserWindow>} */
const popups = new Map();
const seenPending = new Set();
/** @type {NodeJS.Timeout | null} */
let pollTimer = null;

function popupBounds() {
  const display = screen.getPrimaryDisplay();
  const { width, height, x, y } = display.workArea;
  const margin = 16;
  return {
    x: x + width - POPUP_WIDTH - margin,
    y: y + height - POPUP_HEIGHT - margin,
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
  };
}

function createDashboard() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: "HITL Proxy",
    icon: getAppIcon(),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on("close", (event) => {
    event.preventDefault();
    win.hide();
    win.setSkipTaskbar(true);
  });

  return win;
}

async function showDashboard() {
  if (!dashboard || dashboard.isDestroyed()) {
    dashboard = createDashboard();
  }
  // Always reload: a window opened while the service was down stays blank otherwise.
  try {
    await dashboard.loadURL(BASE_URL);
  } catch {
    // show anyway; next open retries
  }
  dashboard.setSkipTaskbar(false);
  dashboard.show();
  dashboard.focus();
}

async function showPopup(sessionId) {
  const url = `${BASE_URL}/s/${encodeURIComponent(sessionId)}?popup=1`;
  const existing = popups.get(sessionId);
  if (existing && !existing.isDestroyed()) {
    try {
      await existing.loadURL(url);
    } catch {
      /* retry next time */
    }
    existing.show();
    existing.focus();
    return;
  }

  const bounds = popupBounds();
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    title: "HITL Proxy - answer",
    icon: getAppIcon(),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.on("close", (event) => {
    event.preventDefault();
    win.hide();
  });

  win.on("closed", () => {
    popups.delete(sessionId);
  });

  popups.set(sessionId, win);
  try {
    await win.loadURL(url);
  } catch {
    /* still show shell */
  }
  win.setBounds(popupBounds());
  win.show();
  win.focus();
}

async function pollSessions() {
  try {
    const res = await fetch(`${BASE_URL}/api/sessions`);
    if (!res.ok) return;
    const data = await res.json();
    const pending = (data.sessions ?? []).filter(
      (s) => s.status === "pending" || (s.pendingCount ?? 0) > 0,
    );

    for (const session of pending) {
      if (!seenPending.has(session.id)) {
        seenPending.add(session.id);
        showPopup(session.id);
      }
    }

    const liveIds = new Set((data.sessions ?? []).map((s) => s.id));
    for (const id of [...seenPending]) {
      if (!liveIds.has(id)) seenPending.delete(id);
    }
    for (const id of [...seenPending]) {
      const row = (data.sessions ?? []).find((s) => s.id === id);
      if (row && row.status === "answered") {
        const win = popups.get(id);
        if (win && !win.isDestroyed()) win.hide();
      }
    }
  } catch {
    // Service offline — stay in tray.
  }
}

function trayIcon() {
  const icon = getAppIcon();
  if (icon.isEmpty()) return icon;
  // Windows tray prefers a small bitmap; keep a crisp 16px variant when present.
  const trayPath = path.join(__dirname, "icon-16.png");
  const small = nativeImage.createFromPath(trayPath);
  if (!small.isEmpty()) return small;
  return icon.resize({ width: 16, height: 16 });
}

function buildTray() {
  const t = new Tray(trayIcon());
  t.setToolTip("HITL Proxy");
  const menu = Menu.buildFromTemplate([
    { label: "Open dashboard", click: () => showDashboard() },
    {
      label: "Show pending questions",
      click: async () => {
        try {
          const res = await fetch(`${BASE_URL}/api/sessions`);
          const data = await res.json();
          const pending = (data.sessions ?? []).filter(
            (s) => s.status === "pending" || (s.pendingCount ?? 0) > 0,
          );
          if (pending.length === 0) {
            showDashboard();
            return;
          }
          for (const s of pending) showPopup(s.id);
        } catch {
          showDashboard();
        }
      },
    },
  ]);
  t.setContextMenu(menu);
  t.on("double-click", () => showDashboard());
  return t;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // A second launch at logon must NOT open the dashboard (that was flashing a window on boot).
  app.on("second-instance", (_event, argv2) => {
    const wantsOpen = argv2.includes("--open") || argv2.includes("--dashboard");
    if (wantsOpen) {
      showDashboard();
    }
  });

  app.whenReady().then(() => {
    // Autostart is owned by the "HITL Proxy UI" scheduled task (--tray).
    // Disable Electron's own Run-key entry so we do not double-start and flash a window.
    app.setLoginItemSettings({
      openAtLogin: false,
      openAsHidden: true,
      path: process.execPath,
      args: [path.join(__dirname, "main.cjs"), "--tray"],
    });

    if (process.platform === "darwin" && !getAppIcon().isEmpty()) {
      app.dock?.setIcon(getAppIcon());
    }

    // Do not create the dashboard window until the user asks — tray only at boot.
    tray = buildTray();
    void pollSessions();
    pollTimer = setInterval(() => void pollSessions(), POLL_MS);

    if (!startInTray && argv.includes("--open")) {
      showDashboard();
    }
  });

  app.on("before-quit", () => {
    if (pollTimer) clearInterval(pollTimer);
    for (const win of BrowserWindow.getAllWindows()) {
      win.removeAllListeners("close");
    }
  });

  app.on("window-all-closed", () => {
    // Stay in tray — do not quit.
  });
}
