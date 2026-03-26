export interface BluetoothChooserDevice {
  deviceId: string;
  deviceName: string;
}

export interface BluetoothChooserState {
  visible: boolean;
  requestId: number;
  devices: BluetoothChooserDevice[];
}
