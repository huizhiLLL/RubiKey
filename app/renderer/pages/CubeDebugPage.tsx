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
import { createBlankProfile, createDefaultProfileConfig, type ProfileConfig } from "@shared/profiles";
import type { RuntimeState } from "@shared/runtime";
import { ALL_MOVES, type CubeMoveEvent } from "@shared/move";
import { useEffect, useMemo, useRef, useState } from "react";
import { GanCubeDriver } from "../../cube/gan/driver";
import type { GanDebugEntry } from "../../cube/gan/protocol";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
type ViewKey = "home" | "profiles" | "moves" | "actions" | "diagnostics";

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

function cloneProfilesConfig(config: ProfileConfig): ProfileConfig {
  return {
    ...config,
    profiles: config.profiles.map((profile) => ({
      ...profile,
      rules: { ...profile.rules }
    }))
  };
}

const NAV_ITEMS: Array<{ key: ViewKey; label: string; hint: string }> = [
  { key: "home", label: "首页", hint: "Overview" },
  { key: "profiles", label: "方案映射", hint: "Profiles" },
  { key: "moves", label: "最近转动", hint: "Moves" },
  { key: "actions", label: "执行回响", hint: "Actions" },
  { key: "diagnostics", label: "连接诊断", hint: "Diagnostics" }
];

export function CubeDebugPage() {
  const driverRef = useRef<GanCubeDriver | null>(null);
  const mappingEnabledRef = useRef(false);
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string>("未连接");
  const [protocol, setProtocol] = useState<string>("unknown");
  const [manualMac, setManualMac] = useState<string>(() => window.localStorage.getItem("rubikey.gan.mac") ?? "");
  const [resolvedMac, setResolvedMac] = useState<string>("-");
  const [errorText, setErrorText] = useState<string>("");
  const [profileConfig, setProfileConfig] = useState<ProfileConfig>(createDefaultProfileConfig());
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [saveState, setSaveState] = useState<string>("正在读取配置");
  const [moveLogs, setMoveLogs] = useState<CubeMoveEvent[]>([]);
  const [debugLogs, setDebugLogs] = useState<GanDebugEntry[]>([]);
  const [executionHints, setExecutionHints] = useState<string[]>([]);

  const canUseBluetooth = useMemo(
    () => typeof navigator !== "undefined" && "bluetooth" in navigator,
    []
  );

  const activeProfile = useMemo(
    () => profileConfig.profiles.find((profile) => profile.id === profileConfig.activeProfileId) ?? profileConfig.profiles[0] ?? null,
    [profileConfig]
  );

  useEffect(() => {
    mappingEnabledRef.current = profileConfig.enabled && (runtimeState?.enabled ?? true);
  }, [profileConfig.enabled, runtimeState?.enabled]);

  useEffect(() => {
    void (async () => {
      const [loadedProfiles, loadedRuntime] = await Promise.all([
        window.rubikey.loadProfileConfig(),
        window.rubikey.getRuntimeState()
      ]);
      setProfileConfig(loadedProfiles);
      setRuntimeState(loadedRuntime);
      setSaveState(`已加载 / Loaded ${formatTime(loadedProfiles.updatedAt)}`);
    })();
  }, []);

  useEffect(() => {
    const driver = new GanCubeDriver();
    driver.setMoveListener((event) => {
      setMoveLogs((prev) => [event, ...prev].slice(0, 24));
      if (mappingEnabledRef.current) {
        void window.rubikey.executeActionForMove(event.move).then((result) => {
          if (result) {
            setExecutionHints((prev) => [
              `${formatTime(result.timestamp)} · ${event.move} -> ${result.detail}`,
              ...prev
            ].slice(0, 18));
          }
        });
      }
    });
    driver.setDebugListener((entry) => {
      setDebugLogs((prev) => [entry, ...prev].slice(0, 36));
      setProtocol(driver.getProtocol());
      setDeviceName(driver.getDeviceName() ?? "未连接");
      setResolvedMac(driver.getMacAddress() ?? "-");
    });
    driverRef.current = driver;

    return () => {
      void driver.disconnect();
      driverRef.current = null;
    };
  }, []);

  async function handleConnect() {
    const driver = driverRef.current;
    if (!driver) return;

    setErrorText("");
    setStatus("connecting");
    try {
      await driver.connect({ preferredMac: manualMac || null });
      setProtocol(driver.getProtocol());
      setDeviceName(driver.getDeviceName() ?? "未知 GAN 设备");
      setResolvedMac(driver.getMacAddress() ?? "-");
      setStatus("connected");
    } catch (error) {
      console.error(error);
      setStatus("error");
      setErrorText(error instanceof Error ? error.message : "连接 GAN 设备失败");
    }
  }

  async function handleDisconnect() {
    const driver = driverRef.current;
    if (!driver) return;
    await driver.disconnect();
    setStatus("disconnected");
    setProtocol("unknown");
    setDeviceName("未连接");
    setResolvedMac("-");
  }

  function handleMacChange(value: string) {
    setManualMac(value);
    window.localStorage.setItem("rubikey.gan.mac", value.trim().toUpperCase());
  }

  function patchConfig(mutator: (draft: ProfileConfig) => void) {
    setProfileConfig((prev) => {
      const draft = cloneProfilesConfig(prev);
      mutator(draft);
      return draft;
    });
    setSaveState("待保存 / Unsaved changes");
  }

  async function toggleRuntimeEnabled() {
    const next = await window.rubikey.toggleEnabled();
    setRuntimeState(next);
  }

  async function triggerEmergencyStop() {
    const result = await window.rubikey.emergencyStop();
    setExecutionHints((prev) => [
      `${formatTime(result.timestamp)} · 急停 -> ${result.detail}`,
      ...prev
    ].slice(0, 18));
    const runtime = await window.rubikey.getRuntimeState();
    setRuntimeState(runtime);
  }

  function updateEnabled(enabled: boolean) {
    patchConfig((draft) => {
      draft.enabled = enabled;
    });
  }

  function selectProfile(profileId: string) {
    patchConfig((draft) => {
      draft.activeProfileId = profileId;
    });
  }

  function addProfile() {
    patchConfig((draft) => {
      const profile = createBlankProfile(`方案 ${draft.profiles.length + 1}`);
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

  function updateProfileMeta(field: "name" | "description", value: string) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      if (!profile) return;
      profile[field] = value;
      profile.updatedAt = Date.now();
    });
  }

  function updateRuleKind(move: (typeof ALL_MOVES)[number], kindValue: string) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      if (!profile) return;
      if (!kindValue) {
        profile.rules[move] = null;
        return;
      }
      const kind = kindValue as ActionKind;
      profile.rules[move] = kind === "keyboard"
        ? { kind: "keyboard", target: "a", behavior: "tap", durationMs: 100 }
        : { kind: "mouse", target: "left", behavior: "tap", durationMs: 100 };
      profile.updatedAt = Date.now();
    });
  }

  function updateRuleTarget(move: (typeof ALL_MOVES)[number], target: string) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      const action = profile?.rules[move];
      if (!profile || !action) return;
      action.target = target as LetterKey | MouseButton;
      profile.updatedAt = Date.now();
    });
  }

  function updateRuleBehavior(move: (typeof ALL_MOVES)[number], behavior: string) {
    if (!activeProfile) return;
    patchConfig((draft) => {
      const profile = draft.profiles.find((item) => item.id === draft.activeProfileId);
      const action = profile?.rules[move];
      if (!profile || !action) return;
      action.behavior = behavior as ActionBehavior;
      profile.updatedAt = Date.now();
    });
  }

  function updateRuleDuration(move: (typeof ALL_MOVES)[number], durationValue: string) {
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

  async function saveProfiles() {
    const saved = await window.rubikey.saveProfileConfig({
      ...profileConfig,
      updatedAt: Date.now(),
      profiles: profileConfig.profiles.map((profile) => ({
        ...profile,
        updatedAt: profile.id === profileConfig.activeProfileId ? Date.now() : profile.updatedAt
      }))
    });
    setProfileConfig(saved);
    setSaveState(`已保存 / Saved ${formatTime(saved.updatedAt)}`);
    const runtime = await window.rubikey.getRuntimeState();
    setRuntimeState(runtime);
  }

  function renderHome() {
    return (
      <section className="workspace-grid">
        <section className="panel-card hero-summary">
          <div className="panel-head">
            <div>
              <h2>当前状态</h2>
              <p>Overview</p>
            </div>
          </div>
          <div className="summary-grid">
            <div className="summary-card"><span>设备</span><strong>{deviceName}</strong></div>
            <div className="summary-card"><span>连接</span><strong>{getStatusLabel(status)}</strong></div>
            <div className="summary-card"><span>当前方案</span><strong>{activeProfile?.name ?? "未选择"}</strong></div>
            <div className="summary-card"><span>映射系统</span><strong>{runtimeState?.enabled ? "启用中" : "已暂停"}</strong></div>
          </div>
          <div className="button-row wrap">
            <button onClick={handleConnect} disabled={status === "connecting" || !canUseBluetooth}>{status === "connecting" ? "连接中..." : "连接 GAN"}</button>
            <button className="ghost" onClick={handleDisconnect} disabled={status !== "connected"}>断开连接</button>
            <button className="ghost" onClick={toggleRuntimeEnabled}>{runtimeState?.enabled ? "暂停映射" : "启用映射"}</button>
            <button className="danger" onClick={triggerEmergencyStop}>紧急停止</button>
          </div>
        </section>

        <section className="home-mini-grid">
          <article className="panel-card mini-panel">
            <div className="panel-head"><div><h2>方案映射</h2><p>Live snapshot</p></div><button className="ghost tiny" onClick={() => setActiveView("profiles")}>进入</button></div>
            <div className="mini-scroll">
              <div className="mini-key-value"><span>当前方案</span><strong>{activeProfile?.name ?? "未选择"}</strong></div>
              <div className="mini-key-value"><span>说明</span><strong>{activeProfile?.description ?? "-"}</strong></div>
              {ALL_MOVES.slice(0, 6).map((move) => (
                <div className="mini-key-value" key={move}><span>{move}</span><strong>{describeAction(activeProfile?.rules[move] ?? null)}</strong></div>
              ))}
            </div>
          </article>

          <article className="panel-card mini-panel">
            <div className="panel-head"><div><h2>最近转动</h2><p>Recent moves</p></div><button className="ghost tiny" onClick={() => setActiveView("moves")}>进入</button></div>
            <div className="mini-scroll log-list">
              {moveLogs.length === 0 ? <p className="empty-state">等待魔方输入</p> : moveLogs.slice(0, 6).map((log, index) => (
                <div className="log-row" key={`${log.move}-${log.localTimestamp}-${index}`}><span>{formatTime(log.localTimestamp)}</span><strong>{log.move}</strong></div>
              ))}
            </div>
          </article>

          <article className="panel-card mini-panel">
            <div className="panel-head"><div><h2>执行回响</h2><p>Action echo</p></div><button className="ghost tiny" onClick={() => setActiveView("actions")}>进入</button></div>
            <div className="mini-scroll log-list">
              {executionHints.length === 0 ? <p className="empty-state">动作执行后会显示在这里</p> : executionHints.slice(0, 6).map((line, index) => (
                <div className="hint-row" key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          </article>

          <article className="panel-card mini-panel">
            <div className="panel-head"><div><h2>连接诊断</h2><p>Diagnostics</p></div><button className="ghost tiny" onClick={() => setActiveView("diagnostics")}>进入</button></div>
            <div className="mini-scroll log-list">
              {debugLogs.length === 0 ? <p className="empty-state">暂无诊断日志</p> : debugLogs.slice(0, 6).map((log, index) => (
                <div className="debug-row" key={`${log.timestamp}-${index}`}>
                  <div className="debug-meta"><span>{formatTime(log.timestamp)}</span><strong>{log.kind}</strong></div>
                  <div className="debug-message">{log.message}</div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    );
  }

  function renderProfiles() {
    return (
      <section className="panel-card rules-panel">
        <div className="panel-head">
          <div>
            <h2>方案与映射</h2>
            <p>Profiles and bindings</p>
          </div>
          <span>{saveState}</span>
        </div>

        <div className="mapping-toolbar">
          <label className="switch-row">
            <input type="checkbox" checked={profileConfig.enabled} onChange={(event) => updateEnabled(event.target.checked)} />
            <span>启用当前方案映射</span>
          </label>
          <button onClick={saveProfiles}>保存全部方案</button>
        </div>

        <div className="profile-strip">
          {profileConfig.profiles.map((profile) => (
            <button
              key={profile.id}
              className={profile.id === profileConfig.activeProfileId ? "profile-chip active" : "profile-chip"}
              onClick={() => selectProfile(profile.id)}
            >
              {profile.name}
            </button>
          ))}
          <button className="ghost profile-chip" onClick={addProfile}>+ 新建方案</button>
        </div>

        {activeProfile ? (
          <div className="profile-editor">
            <label className="field-block">
              <span>方案名称 / Profile Name</span>
              <input value={activeProfile.name} onChange={(event) => updateProfileMeta("name", event.target.value)} />
            </label>
            <label className="field-block">
              <span>方案说明 / Description</span>
              <input value={activeProfile.description} onChange={(event) => updateProfileMeta("description", event.target.value)} />
            </label>
            <div className="button-row wrap">
              <button className="ghost" onClick={removeCurrentProfile} disabled={profileConfig.profiles.length <= 1}>删除当前方案</button>
            </div>

            <div className="rules-grid">
              {ALL_MOVES.map((move) => {
                const action = activeProfile.rules[move];
                const targetOptions = action?.kind === "mouse" ? MOUSE_OPTIONS : KEYBOARD_OPTIONS;
                return (
                  <div className="rule-row" key={move}>
                    <div className="rule-head">
                      <strong>{move}</strong>
                      <span>{describeAction(action)}</span>
                    </div>
                    <div className="rule-grid">
                      <select value={action?.kind ?? ""} onChange={(event) => updateRuleKind(move, event.target.value)}>
                        <option value="">未绑定 / None</option>
                        <option value="keyboard">键盘 / Keyboard</option>
                        <option value="mouse">鼠标 / Mouse</option>
                      </select>
                      <select value={action?.target ?? ""} onChange={(event) => updateRuleTarget(move, event.target.value)} disabled={!action}>
                        {action ? targetOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        )) : <option value="">先选择动作类型</option>}
                      </select>
                      <select value={action?.behavior ?? "tap"} onChange={(event) => updateRuleBehavior(move, event.target.value)} disabled={!action}>
                        {ACTION_BEHAVIORS.map((behavior) => (
                          <option key={behavior} value={behavior}>{behavior === "tap" ? "单击 / Tap" : "按住 / Hold"}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={10}
                        step={10}
                        value={action?.durationMs ?? 100}
                        onChange={(event) => updateRuleDuration(move, event.target.value)}
                        disabled={!action || action.behavior !== "hold"}
                        placeholder="时长 ms"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderMoves() {
    return (
      <section className="panel-card compact-panel">
        <div className="panel-head"><div><h2>最近转动</h2><p>Recent moves</p></div><span>{moveLogs.length} 条</span></div>
        <div className="log-list">
          {moveLogs.length === 0 ? <p className="empty-state">等待魔方转动输入</p> : moveLogs.map((log, index) => (
            <div className="log-row" key={`${log.move}-${log.localTimestamp}-${index}`}><span>{formatTime(log.localTimestamp)}</span><strong>{log.move}</strong></div>
          ))}
        </div>
      </section>
    );
  }

  function renderActions() {
    return (
      <section className="panel-card compact-panel">
        <div className="panel-head"><div><h2>执行回响</h2><p>Action echo</p></div><span>{executionHints.length} 条</span></div>
        <div className="log-list">
          {executionHints.length === 0 ? <p className="empty-state">动作执行后会显示在这里</p> : executionHints.map((line, index) => (
            <div className="hint-row" key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      </section>
    );
  }

  function renderDiagnostics() {
    return (
      <section className="panel-card compact-panel">
        <div className="panel-head"><div><h2>连接诊断</h2><p>Connection diagnostics</p></div><span>{debugLogs.length} 条</span></div>
        <div className="log-list diagnostic-list">
          {debugLogs.length === 0 ? <p className="empty-state">暂无诊断日志</p> : debugLogs.map((log, index) => (
            <div className="debug-row" key={`${log.timestamp}-${index}`}>
              <div className="debug-meta"><span>{formatTime(log.timestamp)}</span><strong>{log.kind}</strong><span>{log.protocol ?? "-"}</span></div>
              <div className="debug-message">{log.message}</div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderContent() {
    switch (activeView) {
      case "profiles":
        return renderProfiles();
      case "moves":
        return renderMoves();
      case "actions":
        return renderActions();
      case "diagnostics":
        return renderDiagnostics();
      default:
        return renderHome();
    }
  }

  return (
    <main className="app-shell">
      <div className="page-backdrop" />
      <aside className="floating-sidebar">
        <div className="sidebar-brand">
          <p className="eyebrow">RubiKey</p>
          <h1>映射书房</h1>
          <p>Elegant cube control</p>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={item.key === activeView ? "nav-item active" : "nav-item"}
              onClick={() => setActiveView(item.key)}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="mini-status"><span>连接</span><strong>{getStatusLabel(status)}</strong></div>
          <div className="mini-status"><span>方案</span><strong>{activeProfile?.name ?? "未选择"}</strong></div>
          <div className="mini-status"><span>映射</span><strong>{runtimeState?.enabled ? "启用中" : "已暂停"}</strong></div>
        </div>
      </aside>

      <section className="workspace-panel">{renderContent()}</section>
    </main>
  );
}

