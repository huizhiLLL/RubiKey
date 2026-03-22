import { SmartCubeConnector } from "./core/factory";
import { GAN_CUBE_MODEL } from "./gan/driver";
import { MOYU32_CUBE_MODEL } from "./moyu32/driver";

export function createSmartCubeConnector() {
  return new SmartCubeConnector([
    GAN_CUBE_MODEL,
    MOYU32_CUBE_MODEL
  ]);
}

export type { CubeDebugEntry, CubeDeviceInfo, SmartCubeDriver } from "./core/types";
