export const LETTER_KEYS = [
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"
] as const;

export const NUMBER_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const ARROW_KEYS = ["up", "down", "left", "right"] as const;
export const BASIC_KEYS = [
  "space",
  "enter",
  "tab",
  "esc",
  "backspace",
  "shift",
  "ctrl",
  "alt"
] as const;
export const MOUSE_BUTTONS = ["left", "right"] as const;
export const ACTION_BEHAVIORS = ["tap", "hold"] as const;
export const STEP_EXECUTION_MODES = ["sequence", "chord"] as const;

export type LetterKey = (typeof LETTER_KEYS)[number];
export type NumberKey = (typeof NUMBER_KEYS)[number];
export type ArrowKey = (typeof ARROW_KEYS)[number];
export type BasicKey = (typeof BASIC_KEYS)[number];
export type KeyboardTarget = LetterKey | NumberKey | ArrowKey | BasicKey;
export type MouseButton = (typeof MOUSE_BUTTONS)[number];
export type ActionBehavior = (typeof ACTION_BEHAVIORS)[number];
export type StepExecutionMode = (typeof STEP_EXECUTION_MODES)[number];
export type ActionKind = "keyboard" | "mouse";
export type MacroTarget = KeyboardTarget | MouseButton;

export interface MacroStepConfig {
  kind: ActionKind;
  targets: MacroTarget[];
  behavior: ActionBehavior;
  mode: StepExecutionMode;
  durationMs: number;
}

export interface MacroActionConfig {
  steps: MacroStepConfig[];
}

export interface RawMacroStepConfig {
  kind?: ActionKind;
  target?: MacroTarget;
  targets?: MacroTarget[];
  behavior?: ActionBehavior;
  mode?: StepExecutionMode;
  durationMs?: number;
}

export interface RawMacroActionObject {
  steps?: RawMacroStepConfig[];
}

export type LegacyMacroActionConfig = RawMacroStepConfig;
export type RawMacroActionConfig = RawMacroActionObject | LegacyMacroActionConfig | null;

function isRawMacroActionObject(input: RawMacroActionConfig): input is RawMacroActionObject {
  return input != null && typeof input === "object" && "steps" in input;
}

export interface MacroExecutionResult {
  ok: boolean;
  label: string;
  detail: string;
  timestamp: number;
}

export interface ActionOption {
  value: MacroTarget;
  label: string;
  description: string;
}

const ARROW_LABELS: Record<ArrowKey, string> = {
  up: "方向键 ↑",
  down: "方向键 ↓",
  left: "方向键 ←",
  right: "方向键 →"
};

const ARROW_SHORT_LABELS: Record<ArrowKey, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→"
};

const BASIC_KEY_LABELS: Record<BasicKey, string> = {
  space: "空格",
  enter: "回车",
  tab: "Tab",
  esc: "Esc",
  backspace: "Backspace",
  shift: "Shift",
  ctrl: "Ctrl",
  alt: "Alt"
};

export const KEYBOARD_OPTIONS: ActionOption[] = [
  ...LETTER_KEYS.map((letter) => ({
    value: letter,
    label: `键盘 ${letter.toUpperCase()} / Key ${letter.toUpperCase()}`,
    description: `按下字母键 ${letter.toUpperCase()}`
  })),
  ...NUMBER_KEYS.map((digit) => ({
    value: digit,
    label: `数字 ${digit} / Key ${digit}`,
    description: `按下数字键 ${digit}`
  })),
  ...ARROW_KEYS.map((direction) => ({
    value: direction,
    label: `${ARROW_LABELS[direction]} / Arrow`,
    description: `按下${ARROW_LABELS[direction]}`
  })),
  ...BASIC_KEYS.map((key) => ({
    value: key,
    label: `基础键 ${BASIC_KEY_LABELS[key]} / ${BASIC_KEY_LABELS[key]}`,
    description: `按下${BASIC_KEY_LABELS[key]}`
  }))
];

export const MOUSE_OPTIONS: ActionOption[] = [
  {
    value: "left",
    label: "鼠标左键 / Left Mouse",
    description: "鼠标左键点击或按住"
  },
  {
    value: "right",
    label: "鼠标右键 / Right Mouse",
    description: "鼠标右键点击或按住"
  }
];

export function isKeyboardTarget(target: string): target is KeyboardTarget {
  return [...LETTER_KEYS, ...NUMBER_KEYS, ...ARROW_KEYS, ...BASIC_KEYS].includes(target as KeyboardTarget);
}

export function createDefaultMacroStep(target: KeyboardTarget = "a"): MacroStepConfig {
  return {
    kind: "keyboard",
    targets: [target],
    behavior: "tap",
    mode: "sequence",
    durationMs: 100
  };
}

export function createDefaultKeyboardAction(target: KeyboardTarget = "a"): MacroActionConfig {
  return {
    steps: [createDefaultMacroStep(target)]
  };
}

export function createDefaultMouseStep(target: MouseButton = "left"): MacroStepConfig {
  return {
    kind: "mouse",
    targets: [target],
    behavior: "tap",
    mode: "sequence",
    durationMs: 100
  };
}

export function normalizeMacroStep(input?: RawMacroStepConfig | null): MacroStepConfig {
  const kind = input?.kind === "mouse" ? "mouse" : "keyboard";
  const behavior = input?.behavior === "hold" ? "hold" : "tap";
  const mode = input?.mode === "chord" ? "chord" : "sequence";
  const durationMs = Math.max(10, Number.parseInt(String(input?.durationMs ?? 100), 10) || 100);

  const rawTargets = Array.isArray(input?.targets)
    ? input?.targets
    : input && "target" in input && input.target != null
      ? [input.target]
      : [];

  if (kind === "mouse") {
    const targets = rawTargets
      .map((target) => String(target))
      .filter((target): target is MouseButton => target === "left" || target === "right");

    return {
      kind,
      targets: targets.length > 0 ? Array.from(new Set(targets)) : ["left"],
      behavior,
      mode,
      durationMs
    };
  }

  const targets = rawTargets
    .map((target) => String(target))
    .filter((target): target is KeyboardTarget => isKeyboardTarget(target));

  return {
    kind,
    targets: targets.length > 0 ? Array.from(new Set(targets)) : ["a"],
    behavior,
    mode,
    durationMs
  };
}

export function normalizeMacroAction(input?: RawMacroActionConfig): MacroActionConfig | null {
  if (!input) {
    return null;
  }

  if (isRawMacroActionObject(input)) {
    const steps = Array.isArray(input.steps)
      ? input.steps.map((step) => normalizeMacroStep(step))
      : [];

    return steps.length > 0 ? { steps } : null;
  }

  const singleStep = normalizeMacroStep(input);
  return {
    steps: [singleStep]
  };
}

export function formatKeyboardTargetLabel(target: KeyboardTarget, compact = false) {
  if ((ARROW_KEYS as readonly string[]).includes(target)) {
    return compact ? ARROW_SHORT_LABELS[target as ArrowKey] : ARROW_LABELS[target as ArrowKey];
  }

  if ((BASIC_KEYS as readonly string[]).includes(target)) {
    return BASIC_KEY_LABELS[target as BasicKey];
  }

  if ((NUMBER_KEYS as readonly string[]).includes(target)) {
    return target;
  }

  return target.toUpperCase();
}

export function describeMacroStep(step: MacroStepConfig) {
  const subject = step.kind === "keyboard"
    ? `键盘 ${step.targets.map((target) => formatKeyboardTargetLabel(target as KeyboardTarget)).join(step.mode === "chord" ? " + " : " -> ")}`
    : step.targets.map((target) => target === "left" ? "鼠标左键" : "鼠标右键").join(step.mode === "chord" ? " + " : " -> ");

  if (step.behavior === "tap") {
    return `${subject} · ${step.mode === "chord" ? "同时触发" : "单击/轻触"}`;
  }

  return `${subject} · ${step.mode === "chord" ? "同时按住" : "按住"} ${step.durationMs}ms`;
}

export function describeAction(action: MacroActionConfig | null) {
  if (!action || action.steps.length === 0) {
    return "未设置动作";
  }

  if (action.steps.length === 1) {
    return describeMacroStep(action.steps[0]);
  }

  const preview = action.steps
    .slice(0, 2)
    .map((step) => {
      const target = step.kind === "keyboard"
        ? step.targets.map((item) => formatKeyboardTargetLabel(item as KeyboardTarget, true)).join(step.mode === "chord" ? "+" : "->")
        : step.targets.map((item) => item === "left" ? "左键" : "右键").join(step.mode === "chord" ? "+" : "->");
      return `${target}${step.behavior === "hold" ? `按住${step.durationMs}ms` : step.mode === "chord" ? "同时触发" : "单击"}`;
    })
    .join(" -> ");

  const suffix = action.steps.length > 2 ? " -> ..." : "";
  return `${action.steps.length} 步宏 · ${preview}${suffix}`;
}
