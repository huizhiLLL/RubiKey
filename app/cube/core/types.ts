import type { CubeMoveEvent } from "@shared/move";

export type CubeBrand = "gan" | "moyu32";

export interface CubeConnectionOptions {
  preferredMac?: string | null;
}

export interface CubeDeviceInfo {
  brand: CubeBrand | "unknown";
  protocol: string;
  deviceName: string | null;
  macAddress: string | null;
}

export interface CubeDebugEntry {
  kind: "info" | "tx" | "rx" | "warn" | "error";
  message: string;
  hex?: string;
  protocol?: string;
  brand?: CubeBrand;
  timestamp: number;
}

export type MoveListener = (event: CubeMoveEvent) => void;
export type DebugListener = (entry: CubeDebugEntry) => void;

export interface SmartCubeDriver {
  connect(device: BluetoothDevice, options?: CubeConnectionOptions): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  setMoveListener(listener: MoveListener): void;
  setDebugListener(listener: DebugListener): void;
  getDeviceInfo(): CubeDeviceInfo;
}

export interface CubeModelRegistration {
  brand: CubeBrand;
  prefixes: readonly string[];
  optionalServices: readonly string[];
  optionalManufacturerData?: readonly number[];
  createDriver(): SmartCubeDriver;
}
