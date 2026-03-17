export const LETTER_KEYS = [
  "a","b","c","d","e","f","g","h","i","j","k","l","m",
  "n","o","p","q","r","s","t","u","v","w","x","y","z"
] as const;

export const MOUSE_BUTTONS = ["left", "right"] as const;
export const ACTION_BEHAVIORS = ["tap", "hold"] as const;

export type LetterKey = (typeof LETTER_KEYS)[number];
export type MouseButton = (typeof MOUSE_BUTTONS)[number];
export type ActionBehavior = (typeof ACTION_BEHAVIORS)[number];
export type ActionKind = "keyboard" | "mouse";

export interface MacroActionConfig {
  kind: ActionKind;
  target: LetterKey | MouseButton;
  behavior: ActionBehavior;
  durationMs: number;
}

export interface MacroExecutionResult {
  ok: boolean;
  label: string;
  detail: string;
  timestamp: number;
}

export interface ActionOption {
  value: LetterKey | MouseButton;
  label: string;
  description: string;
}

export const KEYBOARD_OPTIONS: ActionOption[] = LETTER_KEYS.map((letter) => ({
  value: letter,
  label: `键盘 ${letter.toUpperCase()} / Key ${letter.toUpperCase()}`,
  description: `按下字母键 ${letter.toUpperCase()}`
}));

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

export function createDefaultKeyboardAction(target: LetterKey = "a"): MacroActionConfig {
  return {
    kind: "keyboard",
    target,
    behavior: "tap",
    durationMs: 100
  };
}

export function describeAction(action: MacroActionConfig | null) {
  if (!action) {
    return "未设置动作";
  }

  const subject = action.kind === "keyboard"
    ? `键盘 ${String(action.target).toUpperCase()}`
    : action.target === "left"
      ? "鼠标左键"
      : "鼠标右键";

  if (action.behavior === "tap") {
    return `${subject} · 单击/轻触`;
  }

  return `${subject} · 按住 ${action.durationMs}ms`;
}
