interface Navigator {
  bluetooth: {
    requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  };
}

interface RequestDeviceOptions {
  filters?: Array<{ name?: string; namePrefix?: string; services?: BluetoothServiceUUID[] }>;
  optionalServices?: BluetoothServiceUUID[];
  acceptAllDevices?: boolean;
}

type BluetoothServiceUUID = string | number;

interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
  watchAdvertisements?: () => Promise<void>;
  addEventListener(type: "gattserverdisconnected", listener: EventListenerOrEventListenerObject | null): void;
  addEventListener(type: "advertisementreceived", listener: EventListenerOrEventListenerObject | null): void;
  removeEventListener(type: "gattserverdisconnected", listener: EventListenerOrEventListenerObject | null): void;
  removeEventListener(type: "advertisementreceived", listener: EventListenerOrEventListenerObject | null): void;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTService {
  uuid: string;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  value?: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", listener: EventListenerOrEventListenerObject | null): void;
  removeEventListener(type: "characteristicvaluechanged", listener: EventListenerOrEventListenerObject | null): void;
}

interface BluetoothAdvertisingEvent extends Event {
  manufacturerData: Map<number, DataView>;
}