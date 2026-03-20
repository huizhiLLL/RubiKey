import { contextBridge, ipcRenderer } from "electron";
import type { MacroExecutionResult } from "../shared/macro.js";
import type { ProfileConfig } from "../shared/profiles.js";
import type { RuntimeState } from "../shared/runtime.js";
import type { MoveToken } from "../shared/move.js";

contextBridge.exposeInMainWorld("rubikey", {
  version: "0.1.1",
  executeActionForMove(move: MoveToken) {
    return ipcRenderer.invoke("macro:execute-for-move", move) as Promise<MacroExecutionResult | null>;
  },
  loadProfileConfig() {
    return ipcRenderer.invoke("profiles:load") as Promise<ProfileConfig>;
  },
  saveProfileConfig(config: ProfileConfig) {
    return ipcRenderer.invoke("profiles:save", config) as Promise<ProfileConfig>;
  },
  getRuntimeState() {
    return ipcRenderer.invoke("runtime:get-state") as Promise<RuntimeState>;
  },
  toggleEnabled() {
    return ipcRenderer.invoke("runtime:toggle-enabled") as Promise<RuntimeState>;
  },
  emergencyStop() {
    return ipcRenderer.invoke("runtime:emergency-stop") as Promise<MacroExecutionResult>;
  }
});
