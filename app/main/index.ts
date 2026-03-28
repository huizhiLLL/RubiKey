import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Tray, nativeImage } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CubeGyroEvent } from "../shared/gyro.js";
import type { BluetoothChooserDevice, BluetoothChooserState } from "../shared/bluetooth-picker.js";
import { MacroExecutor } from "./macro/executor.js";
import { GyroMouseController } from "./gyro/controller.js";
import { ProfileStore } from "./profiles/store.js";
import {
  createDefaultProfileConfig,
  createProfileExchangeFile,
  normalizeMappingProfile,
  type ExportProfileResult,
  type ImportProfileResult,
  type MappingProfile,
  type ProfileConfig
} from "../shared/profiles.js";
import type { RuntimeState } from "../shared/runtime.js";
import type { MoveToken } from "../shared/move.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOGGLE_SHORTCUT = "CommandOrControl+Shift+F11";
const EMERGENCY_STOP_SHORTCUT = "CommandOrControl+Shift+F12";

interface PendingBluetoothChooser {
  requestId: number;
  callback: (deviceId: string) => void;
  devices: BluetoothChooserDevice[];
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pendingBluetoothChooser: PendingBluetoothChooser | null = null;
let bluetoothChooserRequestId = 0;
let profileConfig: ProfileConfig = createDefaultProfileConfig();
let emergencyStopCount = 0;
let isQuitting = false;
const macroExecutor = new MacroExecutor();
const gyroMouseController = new GyroMouseController();
const PROFILE_FILE_SUFFIX = ".rubikey-profile.json";

function configurePortableUserDataPath() {
  const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged || !portableExecutableDir) {
    return;
  }

  app.setPath("userData", path.join(portableExecutableDir, "data"));
}

function getProfileStore() {
  return new ProfileStore(path.join(app.getPath("userData"), "profiles.json"));
}

function resolvePreloadPath() {
  if (!app.isPackaged) {
    return path.join(process.cwd(), "app", "main", "preload.cjs");
  }

  return path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "main", "preload.cjs");
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

function sanitizeProfileFilename(value: string) {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .replace(/\s+/g, "-");

  return sanitized.length > 0 ? sanitized : "rubikey-profile";
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function parseImportedProfile(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed) || parsed.schemaVersion !== 1 || !("profile" in parsed)) {
      return null;
    }

    const profile = parsed.profile;
    if (!isPlainObject(profile) || !isPlainObject(profile.rules)) {
      return null;
    }

    if (typeof profile.id !== "string" || typeof profile.name !== "string") {
      return null;
    }

    return normalizeMappingProfile(profile as Partial<MappingProfile>);
  } catch {
    return null;
  }
}

async function exportSingleProfile(profile: MappingProfile): Promise<ExportProfileResult> {
  try {
    const dialogOptions = {
      title: "导出当前方案",
      defaultPath: path.join(app.getPath("downloads"), `${sanitizeProfileFilename(profile.name)}${PROFILE_FILE_SUFFIX}`),
      filters: [
        { name: "RubiKey 方案文件", extensions: ["json"] }
      ]
    } satisfies Electron.SaveDialogOptions;
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (result.canceled || !result.filePath) {
      return {
        ok: false,
        canceled: true,
        message: "已取消导出"
      };
    }

    const payload = createProfileExchangeFile(profile);
    await writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf8");

    return {
      ok: true,
      canceled: false,
      message: "方案导出成功",
      filePath: result.filePath
    };
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? `导出失败：${error.message}` : "导出失败"
    };
  }
}

async function importSingleProfile(): Promise<ImportProfileResult> {
  try {
    const dialogOptions = {
      title: "导入方案",
      properties: ["openFile"],
      filters: [
        { name: "RubiKey 方案文件", extensions: ["json"] }
      ]
    } satisfies Electron.OpenDialogOptions;
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true,
        message: "已取消导入"
      };
    }

    const filePath = result.filePaths[0];
    const raw = await readFile(filePath, "utf8");
    const profile = parseImportedProfile(raw);

    if (!profile) {
      return {
        ok: false,
        canceled: false,
        message: "导入失败：文件不是有效的 RubiKey 单方案格式"
      };
    }

    return {
      ok: true,
      canceled: false,
      message: "方案导入成功",
      filePath,
      profile
    };
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? `导入失败：${error.message}` : "导入失败"
    };
  }
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

function emitBluetoothChooserState(state: BluetoothChooserState) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("bluetooth:chooser-state", state);
}

function closeBluetoothChooser(requestId: number) {
  emitBluetoothChooserState({
    visible: false,
    requestId,
    devices: []
  });
}

function finishBluetoothChooser(deviceId: string) {
  if (!pendingBluetoothChooser) {
    return false;
  }

  const { callback, requestId } = pendingBluetoothChooser;
  pendingBluetoothChooser = null;
  callback(deviceId);
  closeBluetoothChooser(requestId);
  return true;
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
  gyroMouseController.setSystemEnabled(profileConfig.enabled);
  updateTrayMenu();
  return getRuntimeState();
}

async function emergencyStop() {
  const result = await macroExecutor.emergencyStop();
  gyroMouseController.emergencyStop();
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
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  const indexPath = path.join(__dirname, "../../dist/index.html");

  mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();

    const devices = deviceList.map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName || "未命名蓝牙设备"
    }));

    if (!pendingBluetoothChooser) {
      pendingBluetoothChooser = {
        requestId: ++bluetoothChooserRequestId,
        callback,
        devices
      };
    } else {
      pendingBluetoothChooser = {
        ...pendingBluetoothChooser,
        callback,
        devices
      };
    }

    emitBluetoothChooserState({
      visible: true,
      requestId: pendingBluetoothChooser.requestId,
      devices: pendingBluetoothChooser.devices
    });
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
    finishBluetoothChooser("");
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
  gyroMouseController.setConfig(profileConfig.gyroMouse);
  gyroMouseController.setSystemEnabled(profileConfig.enabled);
  updateTrayMenu();
  return profileConfig;
});
ipcMain.handle("profiles:export-one", async (_event, profile: MappingProfile) => exportSingleProfile(profile));
ipcMain.handle("profiles:import-one", async () => importSingleProfile());
ipcMain.handle("runtime:get-state", async () => getRuntimeState());
ipcMain.handle("runtime:toggle-enabled", async () => toggleEnabled());
ipcMain.handle("runtime:emergency-stop", async () => emergencyStop());
ipcMain.handle("app:get-version", async () => app.getVersion());
ipcMain.handle("bluetooth:select-device", async (_event, payload: { requestId: number; deviceId: string }) => {
  if (!pendingBluetoothChooser || pendingBluetoothChooser.requestId !== payload.requestId) {
    return false;
  }

  const matchedDevice = pendingBluetoothChooser.devices.find((device) => device.deviceId === payload.deviceId);
  if (!matchedDevice) {
    return false;
  }

  return finishBluetoothChooser(matchedDevice.deviceId);
});
ipcMain.handle("bluetooth:cancel-chooser", async (_event, requestId: number) => {
  if (!pendingBluetoothChooser || pendingBluetoothChooser.requestId !== requestId) {
    return false;
  }

  return finishBluetoothChooser("");
});
ipcMain.on("gyro:event", (_event, nextEvent: CubeGyroEvent) => {
  gyroMouseController.handleGyroEvent(nextEvent);
});
ipcMain.on("gyro:support", (_event, supported: boolean) => {
  gyroMouseController.setDeviceSupported(supported);
});
ipcMain.on("gyro:clear", () => {
  gyroMouseController.clearDevice();
});
ipcMain.handle("gyro:reset-neutral", async () => {
  gyroMouseController.resetNeutral();
  return true;
});

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

configurePortableUserDataPath();

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  profileConfig = await getProfileStore().load();
  gyroMouseController.setConfig(profileConfig.gyroMouse);
  gyroMouseController.setSystemEnabled(profileConfig.enabled);
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
