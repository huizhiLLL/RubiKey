import type { CubeMoveEvent } from "@shared/move";
import type { CubeGyroEvent } from "@shared/gyro";

export type CubeBrand = "gan" | "moyu32";

export interface CubeConnectionOptions {
  preferredMac?: string | null;
  gyroEnabled?: boolean;
}

export interface CubeDeviceInfo {
  brand: CubeBrand | "unknown";
  protocol: string;
  deviceName: string | null;
  macAddress: string | null;
  gyroSupported: boolean;
  gyroEnabled: boolean;
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
export type GyroListener = (event: CubeGyroEvent) => void;
export type DebugListener = (entry: CubeDebugEntry) => void;

export interface SmartCubeDriver {
  connect(device: BluetoothDevice, options?: CubeConnectionOptions): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  setMoveListener(listener: MoveListener): void;
  setGyroListener(listener: GyroListener): void;
  setDebugListener(listener: DebugListener): void;
  setGyroEnabled?(enabled: boolean): Promise<void> | void;
  getDeviceInfo(): CubeDeviceInfo;
}

export interface CubeModelRegistration {
  brand: CubeBrand;
  prefixes: readonly string[];
  optionalServices: readonly string[];
  optionalManufacturerData?: readonly number[];
  createDriver(): SmartCubeDriver;
}
