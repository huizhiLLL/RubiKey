import { Button, Key, keyboard, mouse } from "@nut-tree/nut-js";
import type { MacroActionConfig, MacroExecutionResult } from "../../shared/macro.js";

keyboard.config.autoDelayMs = 5;
mouse.config.autoDelayMs = 5;
mouse.config.mouseSpeed = 1800;

function toButton(target: MacroActionConfig["target"]) {
  return target === "left" ? Button.LEFT : Button.RIGHT;
}

function toKey(target: MacroActionConfig["target"]) {
  return Key[String(target).toUpperCase() as keyof typeof Key];
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
    const subject = action.kind === "keyboard"
      ? `Keyboard ${String(action.target).toUpperCase()}`
      : action.target === "left"
        ? "Mouse Left"
        : "Mouse Right";

    return action.behavior === "hold"
      ? `${subject} Hold ${action.durationMs}ms`
      : `${subject} Tap`;
  }

  private async runAction(action: MacroActionConfig, token: number) {
    if (action.kind === "keyboard") {
      const key = toKey(action.target);
      if (action.behavior === "hold") {
        await keyboard.pressKey(key);
        this.pressedKeys.add(key);
        await this.abortableDelay(action.durationMs, token);
        await keyboard.releaseKey(key);
        this.pressedKeys.delete(key);
        return `Held key ${String(action.target).toUpperCase()} for ${action.durationMs}ms`;
      }

      await keyboard.type(key);
      return `Typed key ${String(action.target).toUpperCase()}`;
    }

    const button = toButton(action.target);
    if (action.behavior === "hold") {
      await mouse.pressButton(button);
      this.pressedButtons.add(button);
      await this.abortableDelay(action.durationMs, token);
      await mouse.releaseButton(button);
      this.pressedButtons.delete(button);
      return `Held ${String(action.target)} mouse button for ${action.durationMs}ms`;
    }

    await mouse.click(button);
    return `Clicked ${String(action.target)} mouse button`;
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
