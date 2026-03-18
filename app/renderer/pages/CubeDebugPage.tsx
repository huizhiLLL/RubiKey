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
import type { RuntimeState } from "@shared/runtime";
import { ALL_MOVES, type CubeMoveEvent, type MoveToken } from "@shared/move";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, BookOpenText, Compass, House, PanelLeftClose, PanelLeftOpen, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { GanCubeDriver } from "../../cube/gan/driver";
import type { GanDebugEntry } from "../../cube/gan/protocol";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
type ViewKey = "home" | "profiles" | "moves" | "actions" | "diagnostics";

const NAV_ITEMS: Array<{ key: ViewKey; label: string; hint: string; icon: ReactNode }> = [
  { key: "home", label: "首页", hint: "", icon: <House size={18} strokeWidth={1.9} /> },
  { key: "profiles", label: "方案映射", hint: "", icon: <BookOpenText size={18} strokeWidth={1.9} /> },
  { key: "moves", label: "最近转动", hint: "", icon: <Compass size={18} strokeWidth={1.9} /> },
  { key: "actions", label: "执行回响", hint: "", icon: <Sparkles size={18} strokeWidth={1.9} /> },
  { key: "diagnostics", label: "连接诊断", hint: "", icon: <Activity size={18} strokeWidth={1.9} /> }
];

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
    ? `${subject}，单击一次`
    : `${subject}，按住 ${action.durationMs}ms`;
}

function getDiagnosticsSummary(status: ConnectionStatus, errorText: string, debugCount: number) {
  if (status === "connected") {
    return {
      tone: "healthy" as const,
      title: "连接状态正常",
      detail: "GAN 设备已连接，当前可以接收转动并触发激活方案。",
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
    detail: "当前没有活跃的 GAN 连接。",
    action: "点击“连接 GAN”开始连接；如果设备曾经连接过，可以结合下方日志回看最近一次连接过程。"
  };
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

export function CubeDebugPage() {
  const driverRef = useRef<GanCubeDriver | null>(null);
  const mappingEnabledRef = useRef(false);
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("rubikey.sidebar.collapsed") === "1");
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
  const [pendingMove, setPendingMove] = useState<MoveToken | "">("");

  const canUseBluetooth = useMemo(
    () => typeof navigator !== "undefined" && "bluetooth" in navigator,
    []
  );

  const activeProfile = useMemo(
    () => profileConfig.profiles.find((profile) => profile.id === profileConfig.activeProfileId) ?? profileConfig.profiles[0] ?? null,
    [profileConfig]
  );

  const boundMoves = useMemo(() => (activeProfile ? getBoundMoves(activeProfile) : []), [activeProfile]);
  const availableMoves = useMemo(() => (activeProfile ? getUnboundMoves(activeProfile) : []), [activeProfile]);

  useEffect(() => {
    mappingEnabledRef.current = runtimeState?.enabled ?? true;
  }, [runtimeState?.enabled]);

  useEffect(() => {
    window.localStorage.setItem("rubikey.sidebar.collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!pendingMove && availableMoves.length > 0) {
      setPendingMove(availableMoves[0]);
    }
    if (pendingMove && !availableMoves.includes(pendingMove)) {
      setPendingMove(availableMoves[0] ?? "");
    }
  }, [availableMoves, pendingMove]);

  useEffect(() => {
    void (async () => {
      const [loadedProfiles, loadedRuntime] = await Promise.all([
        window.rubikey.loadProfileConfig(),
        window.rubikey.getRuntimeState()
      ]);
      setProfileConfig(loadedProfiles);
      setRuntimeState(loadedRuntime);
      setSaveState(`已加载 ${formatTime(loadedProfiles.updatedAt)}`);
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
    setSaveState("待保存");
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
    setSaveState(`已保存 ${formatTime(saved.updatedAt)}`);
    const runtime = await window.rubikey.getRuntimeState();
    setRuntimeState(runtime);
  }

  function renderHome() {
    return (
      <section className="workspace-grid">
        <section className="hero-summary">
          <div className="panel-head">
            <div>
              <h2>当前状态</h2>
            </div>
          </div>
          <div className="summary-grid">
            <div className="summary-card"><span>设备</span><strong>{deviceName}</strong></div>
            <div className="summary-card"><span>连接</span><strong>{getStatusLabel(status)}</strong></div>
            <div className="summary-card"><span>当前激活方案</span><strong>{activeProfile?.name ?? "未选择"}</strong></div>
            <div className="summary-card"><span>系统状态</span><strong>{runtimeState?.enabled ? "运行中" : "已暂停"}</strong></div>
          </div>
          <div className="button-row wrap">
            <button onClick={handleConnect} disabled={status === "connecting" || !canUseBluetooth}>{status === "connecting" ? "连接中..." : "连接 GAN"}</button>
            <button className="ghost" onClick={handleDisconnect} disabled={status !== "connected"}>断开连接</button>
            <button className="ghost" onClick={toggleRuntimeEnabled}>{runtimeState?.enabled ? "暂停系统" : "启动系统"}</button>
            <button className="danger" onClick={triggerEmergencyStop}>紧急停止</button>
          </div>
        </section>

        <article className="home-profile-preview">
          <div className="panel-head">
            <div>
              <h2>方案映射预览</h2>
            </div>
            <button className="ghost" onClick={() => setActiveView("profiles")}>前往编辑</button>
          </div>
          <div className="profile-preview-meta">
            <div className="mini-key-value"><span>当前激活方案</span><strong>{activeProfile?.name ?? "未选择"}</strong></div>
            <div className="mini-key-value"><span>已绑定转动</span><strong>{boundMoves.length} 项</strong></div>
          </div>
          <div className="profile-preview-list">
            {boundMoves.length === 0 ? (
              <p className="empty-state">当前方案还没有映射规则，前往“方案映射”页添加。</p>
            ) : boundMoves.slice(0, 6).map((move) => (
              <div className="profile-preview-rule" key={move}>
                <strong>{move} {"->"} {describeActionSummary(activeProfile?.rules[move] ?? null)}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>
    );
  }

  function renderProfiles() {
    return (
      <section className="rules-panel">
        <div className="panel-head">
          <div>
            <h2>方案与映射</h2>
          </div>
          <div className="panel-head-actions">
            <span>{saveState}</span>
            <button
              className="ghost icon-button"
              title="保存全部方案"
              aria-label="保存全部方案"
              onClick={saveProfiles}
            >
              <Save size={16} strokeWidth={1.9} />
            </button>
          </div>
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
          <button
            className="ghost profile-chip icon-button"
            title="新建方案"
            aria-label="新建方案"
            onClick={addProfile}
          >
            <Plus size={16} strokeWidth={1.9} />
          </button>
        </div>

        {activeProfile ? (
          <div className="profile-editor">
            <label className="field-block">
              <span>方案名称</span>
              <input value={activeProfile.name} onChange={(event) => updateProfileMeta("name", event.target.value)} />
            </label>
            <div className="button-row wrap">
              <button
                className="ghost icon-button"
                title="删除当前方案"
                aria-label="删除当前方案"
                onClick={removeCurrentProfile}
                disabled={profileConfig.profiles.length <= 1}
              >
                <Trash2 size={16} strokeWidth={1.9} />
              </button>
            </div>

            <section className="panel-subsection add-binding-box">
              <div className="panel-head compact-head">
                <div>
                  <h3>新增映射</h3>
                </div>
              </div>
              <div className="add-binding-row">
                <select value={pendingMove} onChange={(event) => setPendingMove(event.target.value as MoveToken | "")}>
                  {availableMoves.length === 0 ? <option value="">没有可添加的转动</option> : availableMoves.map((move) => (
                    <option key={move} value={move}>{move}</option>
                  ))}
                </select>
                <button onClick={addBinding} disabled={!pendingMove}>添加映射</button>
              </div>
            </section>

            <div className="rules-grid">
              {boundMoves.length === 0 ? (
                <p className="empty-state">当前方案还没有绑定任何转动，先从上方添加。</p>
              ) : boundMoves.map((move) => {
                const action = activeProfile.rules[move];
                const targetOptions = action?.kind === "mouse" ? MOUSE_OPTIONS : KEYBOARD_OPTIONS;
                return (
                  <div className="rule-row" key={move}>
                    <div className="rule-head">
                      <div className="rule-summary">
                        <strong>{move} {"->"} {describeActionSummary(action)}</strong>
                      </div>
                      <button
                        className="ghost rule-remove-button icon-button"
                        title={`删除 ${move} 映射`}
                        aria-label={`删除 ${move} 映射`}
                        onClick={() => removeBinding(move)}
                      >
                        <Trash2 size={16} strokeWidth={1.9} />
                      </button>
                    </div>
                    <div className="rule-editor-grid">
                      <label className="rule-control">
                        <span>动作类型</span>
                        <select value={action?.kind ?? ""} onChange={(event) => updateRuleKind(move, event.target.value)}>
                          <option value="keyboard">键盘</option>
                          <option value="mouse">鼠标</option>
                        </select>
                      </label>
                      <label className="rule-control">
                        <span>目标</span>
                        <select value={action?.target ?? ""} onChange={(event) => updateRuleTarget(move, event.target.value)} disabled={!action}>
                          {action ? targetOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          )) : null}
                        </select>
                      </label>
                      <label className="rule-control">
                        <span>行为</span>
                        <select value={action?.behavior ?? "tap"} onChange={(event) => updateRuleBehavior(move, event.target.value)} disabled={!action}>
                          {ACTION_BEHAVIORS.map((behavior) => (
                            <option key={behavior} value={behavior}>{behavior === "tap" ? "单击" : "按住"}</option>
                          ))}
                        </select>
                      </label>
                      <label className="rule-control">
                        <span>持续时间</span>
                        <input
                          type="number"
                          min={10}
                          step={10}
                          value={action?.durationMs ?? 100}
                          onChange={(event) => updateRuleDuration(move, event.target.value)}
                          disabled={!action || action.behavior !== "hold"}
                          placeholder="时长 ms"
                        />
                      </label>
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
      <section className="compact-panel">
        <div className="panel-head"><div><h2>最近转动</h2></div><span>{moveLogs.length} 条</span></div>
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
      <section className="compact-panel">
        <div className="panel-head"><div><h2>执行回响</h2></div><span>{executionHints.length} 条</span></div>
        <div className="log-list">
          {executionHints.length === 0 ? <p className="empty-state">动作执行后会显示在这里</p> : executionHints.map((line, index) => (
            <div className="hint-row" key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      </section>
    );
  }

  function renderDiagnostics() {
    const summary = getDiagnosticsSummary(status, errorText, debugLogs.length);

    return (
      <section className="compact-panel">
        <div className="panel-head"><div><h2>连接诊断</h2></div><span>{debugLogs.length} 条</span></div>
        <div className="diagnostic-layout">
          <section className={`diagnostic-summary ${summary.tone}`}>
            <div className="diagnostic-summary-head">
              <span className="diagnostic-badge">
                {summary.tone === "healthy" ? "正常" : summary.tone === "warning" ? "注意" : summary.tone === "pending" ? "进行中" : "未开始"}
              </span>
              <strong>{summary.title}</strong>
            </div>
            <p>{summary.detail}</p>
            <div className="diagnostic-next">
              <span>建议动作</span>
              <strong>{summary.action}</strong>
            </div>
          </section>

          <section className="diagnostic-log-panel">
            <div className="panel-head compact-head">
              <div>
                <h3>详细日志</h3>
              </div>
            </div>
            <div className="log-list diagnostic-list">
              {debugLogs.length === 0 ? <p className="empty-state">暂无诊断日志</p> : debugLogs.map((log, index) => (
                <div className="debug-row" key={`${log.timestamp}-${index}`}>
                  <div className="debug-meta"><span>{formatTime(log.timestamp)}</span><strong>{log.kind}</strong><span>{log.protocol ?? "-"}</span></div>
                  <div className="debug-message">{log.message}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    );
  }

  function renderContent() {
    switch (activeView) {
      case "profiles": return renderProfiles();
      case "moves": return renderMoves();
      case "actions": return renderActions();
      case "diagnostics": return renderDiagnostics();
      default: return renderHome();
    }
  }

  return (
    <main className={sidebarCollapsed ? "app-shell collapsed" : "app-shell"}>
      <div className="page-backdrop" />
      <aside className={sidebarCollapsed ? "floating-sidebar collapsed" : "floating-sidebar"}>
        <div className="sidebar-brand">
          <div className="sidebar-head">
            <button
              className="ghost sidebar-toggle"
              title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              onClick={() => setSidebarCollapsed((prev) => !prev)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} strokeWidth={1.9} /> : <PanelLeftClose size={16} strokeWidth={1.9} />}
            </button>
          </div>
          {sidebarCollapsed ? null : <h1>RubiKey</h1>}
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              title={item.label}
              className={item.key === activeView ? "nav-item active" : "nav-item"}
              onClick={() => setActiveView(item.key)}
            >
              <span className="nav-glyph">{item.icon}</span>
              {sidebarCollapsed ? null : <strong>{item.label}</strong>}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace-panel">{renderContent()}</section>
    </main>
  );
}
