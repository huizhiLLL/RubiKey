const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rubikey", {
  executeActionForMove(move) {
    return ipcRenderer.invoke("macro:execute-for-move", move);
  },
  getVersion() {
    return ipcRenderer.invoke("app:get-version");
  },
  loadProfileConfig() {
    return ipcRenderer.invoke("profiles:load");
  },
  saveProfileConfig(config) {
    return ipcRenderer.invoke("profiles:save", config);
  },
  exportSingleProfile(profile) {
    return ipcRenderer.invoke("profiles:export-one", profile);
  },
  importSingleProfile() {
    return ipcRenderer.invoke("profiles:import-one");
  },
  getRuntimeState() {
    return ipcRenderer.invoke("runtime:get-state");
  },
  onBluetoothChooserStateChange(listener) {
    const wrappedListener = (_event, state) => listener(state);
    ipcRenderer.on("bluetooth:chooser-state", wrappedListener);
    return () => {
      ipcRenderer.removeListener("bluetooth:chooser-state", wrappedListener);
    };
  },
  chooseBluetoothDevice(requestId, deviceId) {
    return ipcRenderer.invoke("bluetooth:select-device", { requestId, deviceId });
  },
  cancelBluetoothChooser(requestId) {
    return ipcRenderer.invoke("bluetooth:cancel-chooser", requestId);
  },
  toggleEnabled() {
    return ipcRenderer.invoke("runtime:toggle-enabled");
  },
  emergencyStop() {
    return ipcRenderer.invoke("runtime:emergency-stop");
  },
  pushGyroEvent(event) {
    ipcRenderer.send("gyro:event", event);
  },
  setGyroSupported(supported) {
    ipcRenderer.send("gyro:support", supported);
  },
  clearGyroDevice() {
    ipcRenderer.send("gyro:clear");
  },
  resetGyroNeutral() {
    return ipcRenderer.invoke("gyro:reset-neutral");
  }
});
