import {
  ACTION_BEHAVIORS,
  KEYBOARD_OPTIONS,
  MOUSE_OPTIONS,
  describeAction,
  type ActionBehavior,
  type ActionKind,
  type MacroActionConfig,
  type MouseButton,
  type LetterKey
} from "@shared/macro";
import {
  createBlankProfile,
  createDefaultProfileConfig,
  getBoundMoves,
  getUnboundMoves,
  type ProfileConfig
} from "@shared/profiles";
import {
  createGyroBasis,
  createIdleGyroPreviewState,
  evaluateGyroMouse,
  type CubeGyroEvent
} from "@shared/gyro";
import type { RuntimeState } from "@shared/runtime";
import { ALL_MOVES, type CubeMoveEvent, type MoveToken } from "@shared/move";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, BookOpenText, Compass, House, Info, Palette, PanelLeftClose, PanelLeftOpen, Plus, Save, Sparkles, Trash2, Bluetooth, Play, Square, AlertOctagon, RefreshCw, MousePointer2, Settings2, Inbox, Ghost } from "lucide-react";
import { createSmartCubeConnector, type CubeDebugEntry } from "../../cube";
import { getRememberedMac, saveMacInputValue } from "../../cube/core/mac";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
type ViewKey = "home" | "profiles" | "moves" | "actions" | "diagnostics" | "about";
type ThemeKey = "blossom" | "mist";

const NAV_ITEMS: Array<{ key: ViewKey; label: string; hint: string; icon: ReactNode }> =[
  { key: "home", label: "仪表盘", hint: "", icon: <House size={18} strokeWidth={1.9} /> },
  { key: "profiles", label: "方案映射", hint: "", icon: <BookOpenText size={18} strokeWidth={1.9} /> },
  { key: "moves", label: "最近转动", hint: "", icon: <Compass size={18} strokeWidth={1.9} /> },
  { key: "actions", label: "执行回响", hint: "", icon: <Sparkles size={18} strokeWidth={1.9} /> },
  { key: "diagnostics", label: "连接诊断", hint: "", icon: <Activity size={18} strokeWidth={1.9} /> },
  { key: "about", label: "关于", hint: "", icon: <Info size={18} strokeWidth={1.9} /> }
];

const REPOSITORY_URL = "https://github.com/huizhiLLL/RubiKey";
const THEME_STORAGE_KEY = "rubikey.theme";

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3
  });
}

function getStatusLabel(status: ConnectionStatus) {
  if (status === "connected") return "已连接";
  if (status === "connecting") return "连接中";
  if (status === "error") return "错误";
  return "未连接";
}

function describeActionSummary(action: MacroActionConfig | null) {
  if (!action) {
    return "未设置动作";
  }

  const subject = action.kind === "keyboard"
    ? `键盘 ${String(action.target).toUpperCase()}`
    : action.target === "left"
      ? "鼠标左键"
      : "鼠标右键";

  return action.behavior === "tap"
    ? `${subject} 单击`
    : `${subject} 按住 ${action.durationMs}ms`;
}

function formatRuleShort(move: string, action: MacroActionConfig | null) {
  if (!action) return `${move}->未绑定`;
  const isKb = action.kind === "keyboard";
  const targetStr = isKb ? `“${String(action.target).toUpperCase()}”` : (action.target === "left" ? "左键" : "右键");
  
  if (action.behavior === "tap") {
     return `${move}->${isKb ? `单击${targetStr}` : `${targetStr}单击`}`;
  } else {
     return `${move}->${isKb ? `长按${targetStr}` : `${targetStr}长按`} ${action.durationMs}ms`;
  }
}

function getDiagnosticsSummary(status: ConnectionStatus, errorText: string, debugCount: number) {
  if (status === "connected") {
    return {
      tone: "healthy" as const,
      title: "连接状态正常",
      detail: "智能魔方设备已连接，当前可以接收转动并触发激活方案。",
      action: "如果动作没有按预期执行，先检查当前方案是否已经绑定对应转动。"
    };
  }

  if (status === "connecting") {
    return {
      tone: "pending" as const,
      title: "正在建立连接",
      detail: "应用正在等待蓝牙设备完成连接和协议初始化。",
      action: "请保持魔方处于可连接状态，并等待连接结果返回。"
    };
  }

  if (status === "error") {
    return {
      tone: "warning" as const,
      title: "连接出现问题",
      detail: errorText || "最近一次连接过程没有成功完成。",
      action: "请重新尝试连接；如果连续失败，再查看下方详细日志定位是哪一步出错。"
    };
  }

  return {
    tone: debugCount > 0 ? "pending" as const : "idle" as const,
    title: "设备尚未连接",
    detail: "当前没有活跃的智能魔方连接。",
    action: "点击“连接设备”开始连接；如果设备曾经连接过，可以结合下方日志回看最近一次连接过程。"
  };
}

function cloneProfilesConfig(config: ProfileConfig): ProfileConfig {
  return {
    ...config,
    gyroMouse: { ...config.gyroMouse },
    profiles: config.profiles.map((profile) => ({
      ...profile,
      rules: { ...profile.rules }
    }))
  };
}

function getRubikeyApi() {
  if (!window.rubikey) {
    throw new Error("RubiKey preload API 未注入，请彻底退出后重新打开应用，或重新打包 portable 版本。");
  }

  return {
    ...window.rubikey,
    pushGyroEvent: window.rubikey.pushGyroEvent ?? (() => undefined),
    setGyroSupported: window.rubikey.setGyroSupported ?? (() => undefined),
    clearGyroDevice: window.rubikey.clearGyroDevice ?? (() => undefined),
    resetGyroNeutral: window.rubikey.resetGyroNeutral ?? (() => Promise.resolve(true))
  };
}

export function CubeDebugPage() {
  const driverRef = useRef<ReturnType<typeof createSmartCubeConnector> | null>(null);
  const mappingEnabledRef = useRef(false);
  const hasLoadedProfilesRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const gyroConfigRef = useRef(createDefaultProfileConfig().gyroMouse);
  const gyroBasisRef = useRef<ReturnType<typeof createGyroBasis> | null>(null);
  const gyroPreviewRef = useRef(createIdleGyroPreviewState());
  const[activeView, setActiveView] = useState<ViewKey>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("rubikey.sidebar.collapsed") === "1");
  const [theme, setTheme] = useState<ThemeKey>(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme === "blossom" ? "blossom" : "mist";
  });
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [brand, setBrand] = useState<string>("unknown");
  const[deviceName, setDeviceName] = useState<string>("等待连接...");
  const [protocol, setProtocol] = useState<string>("unknown");
  const [manualMac, setManualMac] = useState<string>(() => getRememberedMac());
  const [resolvedMac, setResolvedMac] = useState<string>("-");
  const [gyroSupported, setGyroSupported] = useState(false);
  const[gyroDeviceEnabled, setGyroDeviceEnabled] = useState(false);
  const [gyroPreview, setGyroPreview] = useState(createIdleGyroPreviewState());
  const [errorText, setErrorText] = useState<string>("");
  const[profileConfig, setProfileConfig] = useState<ProfileConfig>(createDefaultProfileConfig());
  const[runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const[saveState, setSaveState] = useState<string>("正在读取配置");
  const [moveLogs, setMoveLogs] = useState<CubeMoveEvent[]>([]);
  const [debugLogs, setDebugLogs] = useState<CubeDebugEntry[]>([]);
  const [executionHints, setExecutionHints] = useState<string[]>([]);
  const[pendingMove, setPendingMove] = useState<MoveToken | "">("");

  const canUseBluetooth = useMemo(
    () => typeof navigator !== "undefined" && "bluetooth" in navigator,[]
  );
  const appVersion = useMemo(() => window.rubikey?.version ?? "unknown",[]);

  const activeProfile = useMemo(
    () => profileConfig.profiles.find((profile) => profile.id === profileConfig.activeProfileId) ?? profileConfig.profiles[0] ?? null,[profileConfig]
  );

  const boundMoves = useMemo(() => (activeProfile ? getBoundMoves(activeProfile) : []), [activeProfile]);
  const availableMoves = useMemo(() => (activeProfile ? getUnboundMoves(activeProfile) : []), [activeProfile]);

  useEffect(() => {
    mappingEnabledRef.current = runtimeState?.enabled ?? true;
  }, [runtimeState?.enabled]);

  useEffect(() => {
    gyroConfigRef.current = profileConfig.gyroMouse;
  }, [profileConfig.gyroMouse]);

  useEffect(() => {
    window.localStorage.setItem("rubikey.sidebar.collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!pendingMove && availableMoves.length > 0) {
      setPendingMove(availableMoves[0]);
    }
    if (pendingMove && !availableMoves.includes(pendingMove)) {
      setPendingMove(availableMoves[0] ?? "");
    }
  },[availableMoves, pendingMove]);

  useEffect(() => {
    void (async () => {
      const[loadedProfiles, loadedRuntime] = await Promise.all([
        getRubikeyApi().loadProfileConfig(),
        getRubikeyApi().getRuntimeState()
      ]);
      setProfileConfig(loadedProfiles);
      setRuntimeState(loadedRuntime);
      setSaveState(`配置已同步`);
      hasLoadedProfilesRef.current = true;
    })().catch((error) => {
      console.error(error);
      setSaveState(error instanceof Error ? error.message : "读取配置失败");
    });
  },[]);

  useEffect(() => {
    if (!hasLoadedProfilesRef.current || saveState !== "待保存") {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void saveProfiles();
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [profileConfig, saveState]);

  useEffect(() => {
    const driver = createSmartCubeConnector();
    driver.setMoveListener((event) => {
      setMoveLogs((prev) => [event, ...prev].slice(0, 24));
      if (mappingEnabledRef.current) {
        void getRubikeyApi().executeActionForMove(event.move).then((result) => {
          if (result) {
            setExecutionHints((prev) =>[
              `${formatTime(result.timestamp)} · ${event.move} -> ${result.detail}`,
              ...prev
            ].slice(0, 18));
          }
        });
      }
    });
    driver.setGyroListener((event: CubeGyroEvent) => {
      getRubikeyApi().pushGyroEvent(event);

      if (!gyroBasisRef.current) {
        gyroBasisRef.current = createGyroBasis(event.quaternion);
        const nextPreview = {
          ...createIdleGyroPreviewState(),
          basisReady: true
        };
        gyroPreviewRef.current = nextPreview;
        setGyroPreview(nextPreview);
        return;
      }

      const nextPreview = evaluateGyroMouse(
        gyroBasisRef.current,
        event.quaternion,
        gyroConfigRef.current,
        gyroPreviewRef.current
      );
      gyroPreviewRef.current = nextPreview;
      setGyroPreview(nextPreview);
    });
    driver.setDebugListener((entry) => {
      setDebugLogs((prev) => [entry, ...prev].slice(0, 36));
      const deviceInfo = driver.getDeviceInfo();
      setBrand(deviceInfo.brand);
      setProtocol(deviceInfo.protocol);
      setDeviceName(deviceInfo.deviceName ?? "等待连接...");
      setResolvedMac(deviceInfo.macAddress ?? "-");
      setGyroSupported(deviceInfo.gyroSupported);
      setGyroDeviceEnabled(deviceInfo.gyroEnabled);
      getRubikeyApi().setGyroSupported(deviceInfo.gyroSupported);
    });
    driverRef.current = driver;

    return () => {
      getRubikeyApi().clearGyroDevice();
      void driver.disconnect();
      driverRef.current = null;
    };
  },[]);

  useEffect(() => {
    const driver = driverRef.current;
    if (!driver || status !== "connected") {
      return;
    }

    void driver.setGyroEnabled(profileConfig.gyroMouse.enabled);
    if (profileConfig.gyroMouse.enabled) {
      void resetGyroNeutral();
    } else {
      gyroBasisRef.current = null;
      gyroPreviewRef.current = createIdleGyroPreviewState();
      setGyroPreview(createIdleGyroPreviewState());
    }
  }, [profileConfig.gyroMouse.enabled, status]);

  async function handleConnect() {
    const driver = driverRef.current;
    if (!driver) return;
    setErrorText("");
    setStatus("connecting");
    gyroBasisRef.current = null;
    gyroPreviewRef.current = createIdleGyroPreviewState();
    setGyroPreview(createIdleGyroPreviewState());
    try {
      await driver.connect({
        preferredMac: manualMac || null,
        gyroEnabled: profileConfig.gyroMouse.enabled
      });
      const deviceInfo = driver.getDeviceInfo();
      setBrand(deviceInfo.brand);
      setProtocol(deviceInfo.protocol);
      setDeviceName(deviceInfo.deviceName ?? "未知设备");
      setResolvedMac(deviceInfo.macAddress ?? "-");
      setGyroSupported(deviceInfo.gyroSupported);
      setGyroDeviceEnabled(deviceInfo.gyroEnabled);
      getRubikeyApi().setGyroSupported(deviceInfo.gyroSupported);
      setStatus("connected");
    } catch (error) {
      console.error(error);
      setStatus("error");
      setErrorText(error instanceof Error ? error.message : "连接智能魔方设备失败");
    }
  }

  async function handleDisconnect() {
    const driver = driverRef.current;
    if (!driver) return;
    await driver.disconnect();
    getRubikeyApi().clearGyroDevice();
    setStatus("disconnected");
    setBrand("unknown");
    setProtocol("unknown");
    setDeviceName("未连接");
    setResolvedMac("-");
    setGyroSupported(false);
    setGyroDeviceEnabled(false);
    gyroBasisRef.current = null;
    gyroPreviewRef.current = createIdleGyroPreviewState();
    setGyroPreview(createIdleGyroPreviewState());
  }

  function handleMacChange(value: string) {
    setManualMac(value);
    saveMacInputValue(value);
  }

  function patchConfig(mutator: (draft: ProfileConfig) => void) {
    setProfileConfig((prev) => {
      const draft = cloneProfilesConfig(prev);
      mutator(draft);
      return draft;
    });
    setSaveState("待保存");
  }

  async function toggleRuntimeEnabled() {
    const next = await getRubikeyApi().toggleEnabled();
    setRuntimeState(next);
  }

  async function triggerEmergencyStop() {
    const result = await getRubikeyApi().emergencyStop();
    setExecutionHints((prev) =>[
      `${formatTime(result.timestamp)} · 急停 -> ${result.detail}`,
      ...prev
    ].slice(0, 18));
    const runtime = await getRubikeyApi().getRuntimeState();
    setRuntimeState(runtime);
  }

  async function resetGyroNeutral() {
    gyroBasisRef.current = null;
    const nextPreview = createIdleGyroPreviewState();
    gyroPreviewRef.current = nextPreview;
    setGyroPreview(nextPreview);
    await getRubikeyApi().resetGyroNeutral();
  }

  function selectProfile(profileId: string) {
    patchConfig((draft) => {
      draft.activeProfileId = profileId;
    });
  }

  function addProfile() {
    patchConfig((draft) => {
      const profile = createBlankProfile(`新方案 ${draft.profiles.length + 1}`);
      draft.profiles.push(profile);
      draft.activeProfileId = profile.id;
    });
  }

  function removeCurrentProfile() {
    if (!activeProfile || profileConfig.profiles.length <= 1) return;
    patchConfig((draft) => {
      draft.profiles = draft.profiles.filter((profile) => profile.id !== draft.activeProfileId);
      draft.activeProfileId = draft.profiles[0].id;
    });
  }

  function updateProfileMeta(value: string) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      if (!profile) return;
      profile.name = value;
      profile.updatedAt = Date.now();
    });
  }

  function addBinding() {
    if (!activeProfile || !pendingMove) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      if (!profile || profile.rules[pendingMove]) return;
      profile.rules[pendingMove] = { kind: "keyboard", target: "a", behavior: "tap", durationMs: 100 };
      profile.updatedAt = Date.now();
    });
  }

  function removeBinding(move: MoveToken) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      if (!profile) return;
      profile.rules[move] = null;
      profile.updatedAt = Date.now();
    });
  }

  function updateRuleKind(move: MoveToken, kindValue: string) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      if (!profile) return;
      const action = profile.rules[move];
      if (!action) return;
      const kind = kindValue as ActionKind;
      profile.rules[move] = kind === "keyboard"
        ? { kind: "keyboard", target: "a", behavior: action.behavior, durationMs: action.durationMs }
        : { kind: "mouse", target: "left", behavior: action.behavior, durationMs: action.durationMs };
      profile.updatedAt = Date.now();
    });
  }

  function updateRuleTarget(move: MoveToken, target: string) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      const action = profile?.rules[move];
      if (!profile || !action) return;
      action.target = target as LetterKey | MouseButton;
      profile.updatedAt = Date.now();
    });
  }

  function updateRuleBehavior(move: MoveToken, behavior: string) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      const action = profile?.rules[move];
      if (!profile || !action) return;
      action.behavior = behavior as ActionBehavior;
      profile.updatedAt = Date.now();
    });
  }

  function updateRuleDuration(move: MoveToken, durationValue: string) {
    if (!activeProfile) return;
    const duration = Math.max(10, Number.parseInt(durationValue || "0", 10) || 100);
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      const action = profile?.rules[move];
      if (!profile || !action) return;
      action.durationMs = duration;
      profile.updatedAt = Date.now();
    });
  }

  function updateGyroNumber<K extends "deadzonePitchDeg" | "deadzoneRollDeg" | "fastPitchDeg" | "fastRollDeg" | "slowStepPx" | "fastStepPx" | "intervalMs">(
    key: K,
    value: string
  ) {
    const next = Number.parseInt(value || "0", 10) || 0;
    patchConfig((draft) => {
      draft.gyroMouse[key] = next as ProfileConfig["gyroMouse"][K];
    });
  }

  function updateGyroBoolean<K extends "enabled" | "swapAxes" | "invertHorizontal" | "invertVertical">(key: K, value: boolean) {
    patchConfig((draft) => {
      draft.gyroMouse[key] = value as ProfileConfig["gyroMouse"][K];
    });
  }

  async function saveProfiles() {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    try {
      const saved = await getRubikeyApi().saveProfileConfig({
        ...profileConfig,
        updatedAt: Date.now(),
        profiles: profileConfig.profiles.map((profile) => ({
          ...profile,
          updatedAt: profile.id === profileConfig.activeProfileId ? Date.now() : profile.updatedAt
        }))
      });
      setProfileConfig(saved);
      setSaveState(`配置已同步`);
      const runtime = await getRubikeyApi().getRuntimeState();
      setRuntimeState(runtime);
    } catch (error) {
      console.error(error);
      setSaveState(error instanceof Error ? `同步失败：${error.message}` : "同步失败");
    }
  }

  function renderHome() {
    return (
      <div className="workspace-container">
        <div className="page-header">
          <h2>仪表盘</h2>
          <p>总览设备状态与快速控制</p>
        </div>

        <div className="dashboard-grid">
          {/* Card 1: 设备连接 */}
          <section className="dashboard-card">
            <div className="card-header">
              <div className="card-title">
                <Bluetooth size={18} />
                <h3>设备连接</h3>
              </div>
              <span className={`status-dot ${status}`} title={getStatusLabel(status)}></span>
            </div>
            
            <div className="device-info-main">
              <span className="device-name">{deviceName}</span>
              <span className="device-meta">{brand !== "unknown" ? brand : "未知品牌"} • {getStatusLabel(status)}</span>
            </div>

            <details className="mac-input-group">
              <summary className="mac-label" style={{ cursor: "pointer", userSelect: "none" }}>
                高级设置：手动指定 MAC 地址
              </summary>
              <input
                id="manual-mac"
                className="input-field mt-sm"
                value={manualMac}
                onChange={(event) => handleMacChange(event.target.value)}
                placeholder="例如: AA:BB:CC:DD:EE:FF"
                autoComplete="off"
                spellCheck={false}
              />
            </details>

            <div className="button-group wrap">
              <button 
                className="btn-primary" 
                onClick={handleConnect} 
                disabled={status === "connecting" || status === "connected" || !canUseBluetooth}
              >
                {status === "connecting" ? "正在连接..." : "连接设备"}
              </button>
              <button 
                className="btn-ghost" 
                onClick={handleDisconnect} 
                disabled={status !== "connected"}
              >
                断开连接
              </button>
            </div>
            {errorText && <p className="error-text mt-sm">{errorText}</p>}
          </section>

          {/* Card 2: 方案与系统状态 */}
          <section className="dashboard-card">
            <div className="card-header">
              <div className="card-title">
                <Play size={18} />
                <h3>映射控制</h3>
              </div>
              <span className={`status-badge ${runtimeState?.enabled ? 'active' : 'paused'}`}>
                {runtimeState?.enabled ? "运行中" : "已暂停"}
              </span>
            </div>

            <div className="profile-info-main">
              <span className="info-label">当前激活方案</span>
              <span className="info-value">{activeProfile?.name ?? "未选择"}</span>
              <span className="info-sub">{boundMoves.length} 项规则已绑定</span>
            </div>

            {boundMoves.length > 0 && (
              <div className="profile-rules-summary">
                {boundMoves.map((move) => (
                  <span key={move} className="rule-summary-badge">
                    {formatRuleShort(move, activeProfile!.rules[move])}
                  </span>
                ))}
              </div>
            )}

            <div className="button-group wrap mt-auto">
              <button 
                className={`btn-ghost ${runtimeState?.enabled ? '' : 'highlight'}`} 
                onClick={toggleRuntimeEnabled}
              >
                {runtimeState?.enabled ? <><Square size={16}/> 暂停映射</> : <><Play size={16}/> 启动映射</>}
              </button>
              <button className="btn-danger" onClick={triggerEmergencyStop}>
                <AlertOctagon size={16}/> 急停
              </button>
            </div>
          </section>
        </div>

        {/* Card 3: 陀螺仪高级设置 */}
        <section className="dashboard-card mt-md">
          <div className="card-header">
            <div className="card-title">
              <MousePointer2 size={18} />
              <h3>陀螺仪鼠标</h3>
            </div>
            <div className="header-actions">
              <button className="btn-icon" onClick={resetGyroNeutral} disabled={status !== "connected" || !profileConfig.gyroMouse.enabled} title="重置中立姿态">
                <RefreshCw size={16} />
              </button>
              <label className="toggle-switch">
                <input 
                  type="checkbox" 
                  checked={profileConfig.gyroMouse.enabled} 
                  onChange={(event) => updateGyroBoolean("enabled", event.target.checked)} 
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          {profileConfig.gyroMouse.enabled && (
            <div className="gyro-settings-container">
              <div className="gyro-preview-bar">
                <div className="preview-item"><span>支持状态:</span> <strong>{gyroSupported ? "支持" : "未检测到"}</strong></div>
                <div className="preview-item"><span>设备 Gyro:</span> <strong>{gyroDeviceEnabled ? "开启" : "关闭"}</strong></div>
                <div className="preview-item"><span>Pitch (上下):</span> <strong>{gyroPreview.pitchDeg.toFixed(1)}°</strong></div>
                <div className="preview-item"><span>Roll (左右):</span> <strong>{gyroPreview.rollDeg.toFixed(1)}°</strong></div>
              </div>

              <div className="settings-grid">
                <div className="setting-group">
                  <h4>死区阈值 (°)</h4>
                  <div className="input-row">
                    <label>上下<input type="number" min={4} max={75} value={profileConfig.gyroMouse.deadzonePitchDeg} onChange={(e) => updateGyroNumber("deadzonePitchDeg", e.target.value)} /></label>
                    <label>左右<input type="number" min={4} max={75} value={profileConfig.gyroMouse.deadzoneRollDeg} onChange={(e) => updateGyroNumber("deadzoneRollDeg", e.target.value)} /></label>
                  </div>
                </div>

                <div className="setting-group">
                  <h4>高速阈值 (°)</h4>
                  <div className="input-row">
                    <label>上下<input type="number" min={6} max={89} value={profileConfig.gyroMouse.fastPitchDeg} onChange={(e) => updateGyroNumber("fastPitchDeg", e.target.value)} /></label>
                    <label>左右<input type="number" min={6} max={89} value={profileConfig.gyroMouse.fastRollDeg} onChange={(e) => updateGyroNumber("fastRollDeg", e.target.value)} /></label>
                  </div>
                </div>

                <div className="setting-group">
                  <h4>鼠标步长 (px)</h4>
                  <div className="input-row">
                    <label>低速<input type="number" min={1} max={80} value={profileConfig.gyroMouse.slowStepPx} onChange={(e) => updateGyroNumber("slowStepPx", e.target.value)} /></label>
                    <label>高速<input type="number" min={1} max={120} value={profileConfig.gyroMouse.fastStepPx} onChange={(e) => updateGyroNumber("fastStepPx", e.target.value)} /></label>
                  </div>
                </div>
                
                <div className="setting-group">
                  <h4>其他与反转</h4>
                  <div className="toggle-list">
                     <label className="toggle-row">
                        <span>刷新率 (ms)</span>
                        <input className="small-input" type="number" min={10} max={80} value={profileConfig.gyroMouse.intervalMs} onChange={(e) => updateGyroNumber("intervalMs", e.target.value)} />
                     </label>
                     <label className="toggle-row">
                        <span>交换上下左右</span>
                        <div className="toggle-switch small"><input type="checkbox" checked={profileConfig.gyroMouse.swapAxes} onChange={(e) => updateGyroBoolean("swapAxes", e.target.checked)} /><span className="slider"></span></div>
                     </label>
                     <label className="toggle-row">
                        <span>反转水平方向</span>
                        <div className="toggle-switch small"><input type="checkbox" checked={profileConfig.gyroMouse.invertHorizontal} onChange={(e) => updateGyroBoolean("invertHorizontal", e.target.checked)} /><span className="slider"></span></div>
                     </label>
                     <label className="toggle-row">
                        <span>反转垂直方向</span>
                        <div className="toggle-switch small"><input type="checkbox" checked={profileConfig.gyroMouse.invertVertical} onChange={(e) => updateGyroBoolean("invertVertical", e.target.checked)} /><span className="slider"></span></div>
                     </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderProfiles() {
    return (
      <div className="workspace-container full-height">
        <div className="page-header">
          <div>
            <h2>方案与映射</h2>
            <p>管理不同场景的魔方转动到键鼠的映射规则</p>
          </div>
          <div className="header-actions">
            <span className="save-status">{saveState}</span>
            <button className="btn-primary icon-only" title="强制保存" onClick={saveProfiles}>
              <Save size={16} />
            </button>
          </div>
        </div>

        <div className="profile-strip">
          {profileConfig.profiles.map((profile) => (
            <button
              key={profile.id}
              className={`profile-tab ${profile.id === profileConfig.activeProfileId ? "active" : ""}`}
              onClick={() => selectProfile(profile.id)}
            >
              {profile.name}
            </button>
          ))}
          <button className="profile-tab add-btn" title="新建方案" onClick={addProfile}>
            <Plus size={16} />
          </button>
        </div>

        {activeProfile ? (
          <div className="profile-editor-area">
            <div className="profile-toolbar">
              <div className="input-group-inline">
                <label>方案名称</label>
                <input 
                  className="input-field max-w-sm" 
                  value={activeProfile.name} 
                  onChange={(event) => updateProfileMeta(event.target.value)} 
                />
              </div>
              <button 
                className="btn-danger icon-only" 
                title="删除当前方案" 
                onClick={removeCurrentProfile} 
                disabled={profileConfig.profiles.length <= 1}
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="add-rule-bar">
              <span className="add-label">新增映射：</span>
              <select className="select-field" value={pendingMove} onChange={(event) => setPendingMove(event.target.value as MoveToken | "")}>
                {availableMoves.length === 0 ? <option value="">无剩余可用转动</option> : availableMoves.map((move) => (
                  <option key={move} value={move}>{move} (如 U, R')</option>
                ))}
              </select>
              <button className="btn-primary" onClick={addBinding} disabled={!pendingMove}>
                <Plus size={16} /> 添加
              </button>
            </div>

            <div className="rules-list">
              {boundMoves.length === 0 ? (
                <div className="empty-state-box">
                  <Ghost strokeWidth={1.5} />
                  <span>当前方案没有任何规则，请从上方添加。</span>
                </div>
              ) : boundMoves.map((move) => {
                const action = activeProfile.rules[move];
                const targetOptions = action?.kind === "mouse" ? MOUSE_OPTIONS : KEYBOARD_OPTIONS;
                return (
                  <div className="rule-card" key={move}>
                    <div className="rule-trigger">
                      <div className="move-badge">{move}</div>
                      <span className="arrow">➔</span>
                    </div>
                    
                    <div className="rule-config-row">
                      <select className="select-field small" value={action?.kind ?? ""} onChange={(event) => updateRuleKind(move, event.target.value)}>
                        <option value="keyboard">键盘</option>
                        <option value="mouse">鼠标</option>
                      </select>
                      
                      <select className="select-field small" value={action?.target ?? ""} onChange={(event) => updateRuleTarget(move, event.target.value)} disabled={!action}>
                        {action ? targetOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        )) : null}
                      </select>
                      
                      <select className="select-field small" value={action?.behavior ?? "tap"} onChange={(event) => updateRuleBehavior(move, event.target.value)} disabled={!action}>
                        {ACTION_BEHAVIORS.map((behavior) => (
                          <option key={behavior} value={behavior}>{behavior === "tap" ? "单击 (Tap)" : "按住 (Hold)"}</option>
                        ))}
                      </select>
                      
                      <div className={`duration-wrapper ${(!action || action.behavior !== "hold") ? "disabled" : ""}`}>
                        <input
                          className="input-field small duration-input"
                          type="number" min={10} step={10}
                          value={action?.durationMs ?? 100}
                          onChange={(event) => updateRuleDuration(move, event.target.value)}
                          disabled={!action || action.behavior !== "hold"}
                        />
                        <span className="unit">ms</span>
                      </div>
                    </div>

                    <button className="btn-ghost icon-only delete-btn" title="移除该映射" onClick={() => removeBinding(move)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderMoves() {
    return (
      <div className="workspace-container">
         <div className="page-header">
          <div>
            <h2>最近转动</h2>
            <p>魔方传回的原始转动数据，共记录 {moveLogs.length} 条</p>
          </div>
        </div>
        <div className="log-panel">
          {moveLogs.length === 0 ? (
            <div className="empty-state-box">
              <Compass strokeWidth={1.5} />
              <span>等待魔方转动输入...</span>
            </div>
          ) : moveLogs.map((log, index) => (
            <div className="log-item" key={`${log.move}-${log.localTimestamp}-${index}`}>
              <span className="time">{formatTime(log.localTimestamp)}</span>
              <span className="move">{log.move}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderActions() {
    return (
      <div className="workspace-container">
        <div className="page-header">
          <div>
            <h2>执行回响</h2>
            <p>应用实际触发的系统级操作日志</p>
          </div>
        </div>
        <div className="log-panel highlight">
          {executionHints.length === 0 ? (
            <div className="empty-state-box">
              <Sparkles strokeWidth={1.5} />
              <span>暂无执行动作...</span>
            </div>
          ) : executionHints.map((line, index) => (
            <div className="log-item" key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      </div>
    );
  }

  function renderDiagnostics() {
    const summary = getDiagnosticsSummary(status, errorText, debugLogs.length);

    return (
      <div className="workspace-container">
        <div className="page-header">
          <h2>连接诊断</h2>
        </div>
        <div className="diagnostic-grid">
          <section className={`diag-summary-card ${summary.tone}`}>
            <div className="diag-header">
              <span className="diag-badge">{summary.tone === "healthy" ? "正常" : summary.tone === "warning" ? "注意" : summary.tone === "pending" ? "进行中" : "未开始"}</span>
              <h3>{summary.title}</h3>
            </div>
            <p className="diag-detail">{summary.detail}</p>
            <div className="diag-action">
              <span className="action-label">建议动作：</span>
              <span>{summary.action}</span>
            </div>
          </section>

          <section className="diag-log-panel">
            <h3>详细设备通信日志</h3>
            <div className="log-panel small">
              {debugLogs.length === 0 ? (
                <div className="empty-state-box">
                  <Inbox strokeWidth={1.5} />
                  <span>暂无通信日志</span>
                </div>
              ) : debugLogs.map((log, index) => (
                <div className="log-item complex" key={`${log.timestamp}-${index}`}>
                  <div className="meta">
                    <span className="time">{formatTime(log.timestamp)}</span>
                    <span className="tag">{log.kind}</span>
                    <span className="brand">{log.brand ?? "-"}</span>
                  </div>
                  <div className="msg">{log.message}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderAbout() {
    return (
      <div className="workspace-container about-page">
        <section className="about-hero">
          <div className="logo-placeholder">
            <Sparkles size={48} />
          </div>
          <h2>RubiKey</h2>
          <p>基于 Electron 构建的 Windows 桌面工具，<br/>让智能魔方成为你的系统级控制器。</p>
        </section>

        <div className="about-cards">
          <div className="dashboard-card text-center">
            <span className="info-label">版本号</span>
            <span className="info-value">{appVersion}</span>
          </div>
          <div className="dashboard-card text-center">
            <span className="info-label">开源仓库</span>
            <a className="info-value link" href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub 主页</a>
          </div>
          <div className="dashboard-card">
            <span className="info-label">测试说明</span>
            <p className="text-sm mt-sm text-secondary">当前版本主要面向 Windows 11 环境，兼容部分 GAN 与 Moyu 新协议设备。如遇问题欢迎提交 Issue 或 PR。</p>
          </div>
        </div>
      </div>
    );
  }

  function renderContent() {
    switch (activeView) {
      case "profiles": return renderProfiles();
      case "moves": return renderMoves();
      case "actions": return renderActions();
      case "diagnostics": return renderDiagnostics();
      case "about": return renderAbout();
      default: return renderHome();
    }
  }

  return (
    <main className={`app-layout ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="bg-decorations">
        <div className="blob top-left"></div>
        <div className="blob bottom-right"></div>
      </div>
      
      <aside className="sidebar">
        <div className="sidebar-header">
          {!sidebarCollapsed && <h1>RubiKey</h1>}
          <button
            className="btn-ghost icon-only collapse-btn"
            title={sidebarCollapsed ? "展开" : "收起"}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="nav-menu">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              title={item.label}
              className={`nav-item ${item.key === activeView ? "active" : ""}`}
              onClick={() => setActiveView(item.key)}
            >
              <span className="icon-wrapper">{item.icon}</span>
              {!sidebarCollapsed && <span className="label">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="theme-toggle-btn"
            title="切换主题"
            onClick={() => setTheme(prev => prev === "blossom" ? "mist" : "blossom")}
          >
            <span className="icon-wrapper"><Palette size={16} /></span>
            {!sidebarCollapsed && <span className="label">{theme === "mist" ? "切至樱粉 (Blossom)" : "切至淡蓝 (Mist)"}</span>}
          </button>
        </div>
      </aside>

      <section className="main-content">
        {renderContent()}
      </section>
    </main>
  );
}
