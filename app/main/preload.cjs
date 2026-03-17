const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rubikey", {
  version: "0.1.0",
  executeActionForMove(move) {
    return ipcRenderer.invoke("macro:execute-for-move", move);
  },
  loadProfileConfig() {
    return ipcRenderer.invoke("profiles:load");
  },
  saveProfileConfig(config) {
    return ipcRenderer.invoke("profiles:save", config);
  },
  getRuntimeState() {
    return ipcRenderer.invoke("runtime:get-state");
  },
  toggleEnabled() {
    return ipcRenderer.invoke("runtime:toggle-enabled");
  },
  emergencyStop() {
    return ipcRenderer.invoke("runtime:emergency-stop");
  }
});
