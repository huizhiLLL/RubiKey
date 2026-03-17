export type GanProtocolVersion = "v1" | "v2" | "v3" | "v4" | "unknown";

export const GAN_NAME_PREFIXES = ["GAN", "MG", "AiCube"] as const;

const UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";

export const GAN_UUIDS = {
  metaService: `0000180a${UUID_SUFFIX}`,
  dataService: `0000fff0${UUID_SUFFIX}`,
  v2Service: "6e400001-b5a3-f393-e0a9-e50e24dc4179",
  v2Read: "28be4cb6-cd67-11e9-a32f-2a2ae2dbcce4",
  v2Write: "28be4a4a-cd67-11e9-a32f-2a2ae2dbcce4",
  v3Service: "8653000a-43e6-47b7-9cb0-5fc21d4ae340",
  v3Read: "8653000b-43e6-47b7-9cb0-5fc21d4ae340",
  v3Write: "8653000c-43e6-47b7-9cb0-5fc21d4ae340",
  v4Service: "00000010-0000-fff7-fff6-fff5fff4fff0",
  v4Read: `0000fff6${UUID_SUFFIX}`,
  v4Write: `0000fff5${UUID_SUFFIX}`
} as const;

export const GAN_OPTIONAL_SERVICES = [
  GAN_UUIDS.metaService,
  GAN_UUIDS.dataService,
  GAN_UUIDS.v2Service,
  GAN_UUIDS.v3Service,
  GAN_UUIDS.v4Service
] as const;

export interface GanDebugEntry {
  kind: "info" | "tx" | "rx" | "warn" | "error";
  message: string;
  hex?: string;
  protocol?: GanProtocolVersion;
  timestamp: number;
}

export function bytesToHex(bytes: number[]) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

export function normalizeUuid(uuid: string) {
  return uuid.toLowerCase();
}