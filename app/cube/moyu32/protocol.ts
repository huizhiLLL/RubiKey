import type { CubeDebugEntry } from "../core/types";
import { bytesToHex, normalizeUuid } from "../core/utils";

export type Moyu32ProtocolVersion = "moyu32" | "moyu32-v10ai" | "unknown";

export const MOYU32_NAME_PREFIXES = ["WCU_MY3"] as const;

export const MOYU32_UUIDS = {
  service: "0783b03e-7735-b5a0-1760-a305d2795cb0",
  read: "0783b03e-7735-b5a0-1760-a305d2795cb1",
  write: "0783b03e-7735-b5a0-1760-a305d2795cb2"
} as const;

export const MOYU32_OPTIONAL_SERVICES = [
  MOYU32_UUIDS.service
] as const;

export const MOYU32_CIC_LIST = Array.from({ length: 255 }, (_, index) => (index + 1) << 8);

export type Moyu32DebugEntry = CubeDebugEntry;

export { bytesToHex, normalizeUuid };
