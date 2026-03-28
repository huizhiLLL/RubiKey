import { contextBridge, ipcRenderer } from "electron";
import type { MacroExecutionResult } from "../shared/macro.js";
import type { ExportProfileResult, ImportProfileResult, MappingProfile, ProfileConfig } from "../shared/profiles.js";
import type { RuntimeState } from "../shared/runtime.js";
import type { MoveToken } from "../shared/move.js";
import type { CubeGyroEvent } from "../shared/gyro.js";

contextBridge.exposeInMainWorld("rubikey", {
  executeActionForMove(move: MoveToken) {
    return ipcRenderer.invoke("macro:execute-for-move", move) as Promise<MacroExecutionResult | null>;
  },
  getVersion() {
    return ipcRenderer.invoke("app:get-version") as Promise<string>;
  },
  loadProfileConfig() {
    return ipcRenderer.invoke("profiles:load") as Promise<ProfileConfig>;
  },
  saveProfileConfig(config: ProfileConfig) {
    return ipcRenderer.invoke("profiles:save", config) as Promise<ProfileConfig>;
  },
  exportSingleProfile(profile: MappingProfile) {
    return ipcRenderer.invoke("profiles:export-one", profile) as Promise<ExportProfileResult>;
  },
  importSingleProfile() {
    return ipcRenderer.invoke("profiles:import-one") as Promise<ImportProfileResult>;
  },
  getRuntimeState() {
    return ipcRenderer.invoke("runtime:get-state") as Promise<RuntimeState>;
  },
  toggleEnabled() {
    return ipcRenderer.invoke("runtime:toggle-enabled") as Promise<RuntimeState>;
  },
  emergencyStop() {
    return ipcRenderer.invoke("runtime:emergency-stop") as Promise<MacroExecutionResult>;
  },
  pushGyroEvent(event: CubeGyroEvent) {
    ipcRenderer.send("gyro:event", event);
  },
  setGyroSupported(supported: boolean) {
    ipcRenderer.send("gyro:support", supported);
  },
  clearGyroDevice() {
    ipcRenderer.send("gyro:clear");
  },
  resetGyroNeutral() {
    return ipcRenderer.invoke("gyro:reset-neutral") as Promise<boolean>;
  }
});
