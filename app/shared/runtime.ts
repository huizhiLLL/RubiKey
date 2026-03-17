export interface RuntimeState {
  enabled: boolean;
  trayReady: boolean;
  mainWindowVisible: boolean;
  emergencyStopCount: number;
  shortcuts: {
    toggleEnabled: string;
    emergencyStop: string;
  };
}
