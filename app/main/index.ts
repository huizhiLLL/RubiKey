import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MacroExecutor } from "./macro/executor.js";
import { ProfileStore } from "./profiles/store.js";
import { createDefaultProfileConfig, type ProfileConfig } from "../shared/profiles.js";
import type { RuntimeState } from "../shared/runtime.js";
import type { MoveToken } from "../shared/move.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GAN_NAME_HINTS = ["GAN", "MG", "AICUBE"];
const TOGGLE_SHORTCUT = "CommandOrControl+Shift+F11";
const EMERGENCY_STOP_SHORTCUT = "CommandOrControl+Shift+F12";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bluetoothSelectionTimeout: NodeJS.Timeout | null = null;
let lastSeenBluetoothDeviceId: string | null = null;
let profileConfig: ProfileConfig = createDefaultProfileConfig();
let emergencyStopCount = 0;
let isQuitting = false;
const macroExecutor = new MacroExecutor();

function getProfileStore() {
  return new ProfileStore(path.join(app.getPath("userData"), "profiles.json"));
}

function resolveAppIconPath() {
  const candidates = [
    path.join(process.cwd(), "assets", "favicon.ico"),
    path.join(process.cwd(), "assets", "favicon.svg"),
    path.join(__dirname, "../../assets/favicon.ico"),
    path.join(__dirname, "../../assets/favicon.svg"),
    path.join(process.resourcesPath, "assets", "favicon.ico"),
    path.join(process.resourcesPath, "assets", "favicon.svg")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function getActiveProfile() {
  return profileConfig.profiles.find((profile) => profile.id === profileConfig.activeProfileId) ?? profileConfig.profiles[0] ?? null;
}

function isGanLikeDeviceName(name?: string) {
  const normalized = (name ?? "").trim().toUpperCase();
  return GAN_NAME_HINTS.some((hint) => normalized.startsWith(hint) || normalized.includes(hint));
}

function getRuntimeState(): RuntimeState {
  return {
    enabled: profileConfig.enabled,
    trayReady: tray !== null,
    mainWindowVisible: mainWindow?.isVisible() ?? false,
    emergencyStopCount,
    shortcuts: {
      toggleEnabled: TOGGLE_SHORTCUT,
      emergencyStop: EMERGENCY_STOP_SHORTCUT
    }
  };
}

function createTrayImage() {
  return nativeImage.createFromPath(resolveAppIconPath());
}

function updateTrayMenu() {
  if (!tray) return;
  const state = getRuntimeState();
  const menu = Menu.buildFromTemplate([
    { label: state.enabled ? "暂停系统" : "启动系统", click: () => void toggleEnabled() },
    { label: "紧急停止", click: () => void emergencyStop() },
    { type: "separator" },
    { label: state.mainWindowVisible ? "隐藏主窗口" : "显示主窗口", click: () => toggleWindowVisibility() },
    { type: "separator" },
    { label: "退出 RubiKey", click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip(state.enabled ? "RubiKey 系统运行中" : "RubiKey 系统已暂停");
  tray.setContextMenu(menu);
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
  updateTrayMenu();
}

async function toggleEnabled() {
  profileConfig.enabled = !profileConfig.enabled;
  profileConfig.updatedAt = Date.now();
  profileConfig = await getProfileStore().save(profileConfig);
  updateTrayMenu();
  return getRuntimeState();
}

async function emergencyStop() {
  const result = await macroExecutor.emergencyStop();
  emergencyStopCount += 1;
  updateTrayMenu();
  return result;
}

function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();
  globalShortcut.register(TOGGLE_SHORTCUT, () => {
    void toggleEnabled();
  });
  globalShortcut.register(EMERGENCY_STOP_SHORTCUT, () => {
    void emergencyStop();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "RubiKey",
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: app.isPackaged ? path.join(__dirname, "preload.js") : path.join(process.cwd(), "app", "main", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  const indexPath = path.join(__dirname, "../../dist/index.html");

  mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();

    if (bluetoothSelectionTimeout) {
      clearTimeout(bluetoothSelectionTimeout);
      bluetoothSelectionTimeout = null;
    }

    const matchedDevice = deviceList.find((device) => isGanLikeDeviceName(device.deviceName));
    if (matchedDevice) {
      lastSeenBluetoothDeviceId = matchedDevice.deviceId;
      callback(matchedDevice.deviceId);
      return;
    }

    if (deviceList.length > 0) {
      lastSeenBluetoothDeviceId = deviceList[0].deviceId;
    }

    bluetoothSelectionTimeout = setTimeout(() => {
      callback(lastSeenBluetoothDeviceId ?? "");
      bluetoothSelectionTimeout = null;
      lastSeenBluetoothDeviceId = null;
    }, 15000);
  });

  mainWindow.webContents.session.setBluetoothPairingHandler((details, callback) => {
    if (details.pairingKind === "confirm" || details.pairingKind === "confirmPin") {
      callback({ confirmed: true });
      return;
    }
    callback({ confirmed: false });
  });

  if (!app.isPackaged) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(indexPath);
  }

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      updateTrayMenu();
    }
  });

  mainWindow.on("show", () => updateTrayMenu());
  mainWindow.on("hide", () => updateTrayMenu());
  mainWindow.on("closed", () => {
    if (bluetoothSelectionTimeout) {
      clearTimeout(bluetoothSelectionTimeout);
      bluetoothSelectionTimeout = null;
    }
    lastSeenBluetoothDeviceId = null;
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.on("double-click", () => toggleWindowVisibility());
  updateTrayMenu();
}

ipcMain.handle("profiles:load", async () => profileConfig);
ipcMain.handle("profiles:save", async (_event, nextConfig: ProfileConfig) => {
  profileConfig = await getProfileStore().save(nextConfig);
  updateTrayMenu();
  return profileConfig;
});
ipcMain.handle("runtime:get-state", async () => getRuntimeState());
ipcMain.handle("runtime:toggle-enabled", async () => toggleEnabled());
ipcMain.handle("runtime:emergency-stop", async () => emergencyStop());

ipcMain.handle("macro:execute-for-move", async (_event, move: MoveToken) => {
  if (!profileConfig.enabled) {
    return null;
  }
  const activeProfile = getActiveProfile();
  const action = activeProfile?.rules[move] ?? null;
  if (!action) {
    return null;
  }
  return macroExecutor.executeAction(action);
});

app.whenReady().then(async () => {
  profileConfig = await getProfileStore().load();
  createMainWindow();
  createTray();
  registerGlobalShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep the app alive in tray mode.
});
