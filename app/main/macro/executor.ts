import { Button, Key, keyboard, mouse } from "@nut-tree/nut-js";
import type {
  KeyboardTarget,
  MacroActionConfig,
  MacroExecutionResult,
  MacroStepConfig,
  MouseButton
} from "../../shared/macro.js";

keyboard.config.autoDelayMs = 5;
mouse.config.autoDelayMs = 5;
mouse.config.mouseSpeed = 1800;

const KEYBOARD_TARGET_TO_KEY: Record<KeyboardTarget, Key> = {
  a: Key.A,
  b: Key.B,
  c: Key.C,
  d: Key.D,
  e: Key.E,
  f: Key.F,
  g: Key.G,
  h: Key.H,
  i: Key.I,
  j: Key.J,
  k: Key.K,
  l: Key.L,
  m: Key.M,
  n: Key.N,
  o: Key.O,
  p: Key.P,
  q: Key.Q,
  r: Key.R,
  s: Key.S,
  t: Key.T,
  u: Key.U,
  v: Key.V,
  w: Key.W,
  x: Key.X,
  y: Key.Y,
  z: Key.Z,
  "0": Key.Num0,
  "1": Key.Num1,
  "2": Key.Num2,
  "3": Key.Num3,
  "4": Key.Num4,
  "5": Key.Num5,
  "6": Key.Num6,
  "7": Key.Num7,
  "8": Key.Num8,
  "9": Key.Num9,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  space: Key.Space,
  enter: Key.Enter,
  tab: Key.Tab,
  esc: Key.Escape,
  backspace: Key.Backspace,
  shift: Key.LeftShift,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt
};

function toButton(target: MouseButton) {
  return target === "left" ? Button.LEFT : Button.RIGHT;
}

function toKey(target: KeyboardTarget) {
  return KEYBOARD_TARGET_TO_KEY[target];
}

function formatStepLabel(step: MacroStepConfig) {
  const subject = step.kind === "keyboard"
    ? `Keyboard ${step.targets.map((target) => String(target).toUpperCase()).join(step.mode === "chord" ? "+" : "->")}`
    : step.targets.map((target) => target === "left" ? "Mouse Left" : "Mouse Right").join(step.mode === "chord" ? "+" : "->");

  return step.behavior === "hold"
    ? `${subject} Hold ${step.durationMs}ms`
    : `${subject} ${step.mode === "chord" ? "Chord" : "Tap"}`;
}

export class MacroExecutor {
  private queue: Promise<MacroExecutionResult> = Promise.resolve({
    ok: true,
    label: "init",
    detail: "Macro executor ready",
    timestamp: Date.now()
  });
  private stopToken = 0;
  private pressedKeys = new Set<Key>();
  private pressedButtons = new Set<Button>();

  private async abortableDelay(ms: number, token: number) {
    const chunk = 20;
    let elapsed = 0;
    while (elapsed < ms) {
      if (token !== this.stopToken) {
        throw new Error("Macro interrupted by emergency stop");
      }
      const wait = Math.min(chunk, ms - elapsed);
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
      elapsed += wait;
    }
  }

  private async releaseAllInputs() {
    for (const key of Array.from(this.pressedKeys)) {
      try {
        await keyboard.releaseKey(key);
      } catch {
        // ignore release failures during emergency cleanup
      }
    }
    this.pressedKeys.clear();

    for (const button of Array.from(this.pressedButtons)) {
      try {
        await mouse.releaseButton(button);
      } catch {
        // ignore release failures during emergency cleanup
      }
    }
    this.pressedButtons.clear();
  }

  private getActionLabel(action: MacroActionConfig) {
    if (action.steps.length === 1) {
      return formatStepLabel(action.steps[0]);
    }
    return `Macro ${action.steps.length} Steps`;
  }

  private async runKeyboardStep(target: KeyboardTarget, behavior: MacroStepConfig["behavior"], durationMs: number, token: number) {
    const key = toKey(target);
    if (behavior === "hold") {
      await keyboard.pressKey(key);
      this.pressedKeys.add(key);
      await this.abortableDelay(durationMs, token);
      await keyboard.releaseKey(key);
      this.pressedKeys.delete(key);
      return `Held key ${String(target).toUpperCase()} for ${durationMs}ms`;
    }

    await keyboard.type(key);
    return `Pressed key ${String(target).toUpperCase()}`;
  }

  private async runMouseStep(target: MouseButton, behavior: MacroStepConfig["behavior"], durationMs: number, token: number) {
    const button = toButton(target);
    if (behavior === "hold") {
      await mouse.pressButton(button);
      this.pressedButtons.add(button);
      await this.abortableDelay(durationMs, token);
      await mouse.releaseButton(button);
      this.pressedButtons.delete(button);
      return `Held ${String(target)} mouse button for ${durationMs}ms`;
    }

    await mouse.click(button);
    return `Clicked ${String(target)} mouse button`;
  }

  private async runChordStep(step: MacroStepConfig, token: number) {
    if (step.kind === "keyboard") {
      const keys = step.targets.map((target) => toKey(target as KeyboardTarget));
      for (const key of keys) {
        await keyboard.pressKey(key);
        this.pressedKeys.add(key);
      }

      await this.abortableDelay(step.behavior === "hold" ? step.durationMs : 30, token);

      for (const key of [...keys].reverse()) {
        await keyboard.releaseKey(key);
        this.pressedKeys.delete(key);
      }

      return `${step.behavior === "hold" ? "Held" : "Pressed"} chord ${step.targets.map((target) => String(target).toUpperCase()).join("+")}`;
    }

    const buttons = step.targets.map((target) => toButton(target as MouseButton));
    for (const button of buttons) {
      await mouse.pressButton(button);
      this.pressedButtons.add(button);
    }

    await this.abortableDelay(step.behavior === "hold" ? step.durationMs : 30, token);

    for (const button of [...buttons].reverse()) {
      await mouse.releaseButton(button);
      this.pressedButtons.delete(button);
    }

    return `${step.behavior === "hold" ? "Held" : "Pressed"} mouse chord ${step.targets.join("+")}`;
  }

  private async runStep(step: MacroStepConfig, token: number) {
    if (step.mode === "chord" && step.targets.length > 1) {
      return this.runChordStep(step, token);
    }

    const details: string[] = [];
    for (const target of step.targets) {
      if (step.kind === "keyboard") {
        details.push(await this.runKeyboardStep(target as KeyboardTarget, step.behavior, step.durationMs, token));
      } else {
        details.push(await this.runMouseStep(target as MouseButton, step.behavior, step.durationMs, token));
      }
    }

    return details.join(" -> ");
  }

  private async runAction(action: MacroActionConfig, token: number) {
    const details: string[] = [];

    for (const step of action.steps) {
      if (token !== this.stopToken) {
        throw new Error("Macro interrupted by emergency stop");
      }
      details.push(await this.runStep(step, token));
    }

    return details.join(" -> ");
  }

  emergencyStop() {
    this.stopToken += 1;
    const timestamp = Date.now();
    this.queue = Promise.resolve({
      ok: true,
      label: "emergency-stop",
      detail: "Execution queue cleared",
      timestamp
    });
    return this.releaseAllInputs().then(() => ({
      ok: true,
      label: "Emergency Stop",
      detail: "Released pressed keys and buttons",
      timestamp
    } satisfies MacroExecutionResult));
  }

  executeAction(action: MacroActionConfig) {
    const label = this.getActionLabel(action);
    const token = this.stopToken;
    this.queue = this.queue
      .catch(() => ({ ok: false, label, detail: "Recovered from previous failure", timestamp: Date.now() }))
      .then(async () => {
        try {
          if (token !== this.stopToken) {
            return {
              ok: false,
              label,
              detail: "Skipped because execution was reset",
              timestamp: Date.now()
            } satisfies MacroExecutionResult;
          }
          const detail = await this.runAction(action, token);
          return {
            ok: true,
            label,
            detail,
            timestamp: Date.now()
          } satisfies MacroExecutionResult;
        } catch (error) {
          await this.releaseAllInputs();
          return {
            ok: false,
            label,
            detail: error instanceof Error ? error.message : "Unknown macro execution failure",
            timestamp: Date.now()
          } satisfies MacroExecutionResult;
        }
      });

    return this.queue;
  }
}
