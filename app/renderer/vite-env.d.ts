/// <reference types="vite/client" />

import type { MacroExecutionResult } from "@shared/macro";
import type { CubeGyroEvent } from "@shared/gyro";
import type { ProfileConfig } from "@shared/profiles";
import type { RuntimeState } from "@shared/runtime";
import type { MoveToken } from "@shared/move";

declare global {
  interface Window {
    rubikey: {
      version: string;
      executeActionForMove(move: MoveToken): Promise<MacroExecutionResult | null>;
      loadProfileConfig(): Promise<ProfileConfig>;
      saveProfileConfig(config: ProfileConfig): Promise<ProfileConfig>;
      getRuntimeState(): Promise<RuntimeState>;
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
