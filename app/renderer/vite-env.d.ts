/// <reference types="vite/client" />

import type { MacroExecutionResult } from "@shared/macro";
import type { CubeGyroEvent } from "@shared/gyro";
import type { BluetoothChooserState } from "@shared/bluetooth-picker";
import type { ProfileConfig } from "@shared/profiles";
import type { RuntimeState } from "@shared/runtime";
import type { MoveToken } from "@shared/move";

declare global {
  interface Window {
    rubikey: {
      executeActionForMove(move: MoveToken): Promise<MacroExecutionResult | null>;
      getVersion(): Promise<string>;
      loadProfileConfig(): Promise<ProfileConfig>;
      saveProfileConfig(config: ProfileConfig): Promise<ProfileConfig>;
      getRuntimeState(): Promise<RuntimeState>;
      onBluetoothChooserStateChange(listener: (state: BluetoothChooserState) => void): () => void;
      chooseBluetoothDevice(requestId: number, deviceId: string): Promise<boolean>;
      cancelBluetoothChooser(requestId: number): Promise<boolean>;
      toggleEnabled(): Promise<RuntimeState>;
      emergencyStop(): Promise<MacroExecutionResult>;
      pushGyroEvent(event: CubeGyroEvent): void;
      setGyroSupported(supported: boolean): void;
      clearGyroDevice(): void;
      resetGyroNeutral(): Promise<boolean>;
    };
  }
}

export {};
