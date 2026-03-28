import {
  createDefaultKeyboardAction,
  normalizeMacroAction,
  type MacroActionConfig
} from "./macro.js";
import { createDefaultGyroMouseConfig, normalizeGyroMouseConfig, type GyroMouseConfig } from "./gyro.js";
import { ALL_MOVES, type MoveToken } from "./move.js";
import defaultProfiles from "./default-profiles.json" with { type: "json" };

export type ProfileRuleMap = Record<MoveToken, MacroActionConfig | null>;

export interface MappingProfile {
  id: string;
  name: string;
  rules: ProfileRuleMap;
  updatedAt: number;
}

export interface ProfileExchangeFile {
  schemaVersion: 1;
  exportedAt: number;
  profile: MappingProfile;
}

interface ProfileOperationFailure {
  ok: false;
  canceled: boolean;
  message: string;
}

export interface ExportProfileSuccess {
  ok: true;
  canceled: false;
  message: string;
  filePath: string;
}

export interface ImportProfileSuccess {
  ok: true;
  canceled: false;
  message: string;
  filePath: string;
  profile: MappingProfile;
}

export type ExportProfileResult = ExportProfileSuccess | ProfileOperationFailure;
export type ImportProfileResult = ImportProfileSuccess | ProfileOperationFailure;

export interface ProfileConfig {
  enabled: boolean;
  gyroMouse: GyroMouseConfig;
  activeProfileId: string;
  profiles: MappingProfile[];
  updatedAt: number;
}

type DefaultProfileSeed = {
  id: string;
  name: string;
  rules?: Partial<Record<MoveToken, MacroActionConfig | null>>;
  updatedAt?: number;
};

export function createEmptyRules(): ProfileRuleMap {
  return Object.fromEntries(ALL_MOVES.map((move) => [move, null])) as ProfileRuleMap;
}

export function getBoundMoves(profile: MappingProfile) {
  return ALL_MOVES.filter((move) => profile.rules[move] != null);
}

export function getUnboundMoves(profile: MappingProfile) {
  return ALL_MOVES.filter((move) => profile.rules[move] == null);
}

export function normalizeProfileRules(input?: Partial<Record<MoveToken, MacroActionConfig | null>>) {
  const rules = createEmptyRules();
  for (const move of ALL_MOVES) {
    rules[move] = normalizeMacroAction(input?.[move]);
  }
  return rules;
}

export function createDefaultProfiles() {
  return (defaultProfiles as DefaultProfileSeed[]).map((profile) => ({
    id: profile.id,
    name: profile.name,
    rules: normalizeProfileRules(profile.rules),
    updatedAt: profile.updatedAt ?? Date.now()
  })) satisfies MappingProfile[];
}

export function createBlankProfile(name = "新方案"): MappingProfile {
  return {
    id: `profile-${Date.now()}`,
    name,
    rules: createEmptyRules(),
    updatedAt: Date.now()
  };
}

export function normalizeMappingProfile(input?: Partial<MappingProfile> | null): MappingProfile {
  const fallback = createBlankProfile();
  return {
    id: input?.id ?? fallback.id,
    name: input?.name ?? fallback.name,
    rules: normalizeProfileRules(input?.rules),
    updatedAt: input?.updatedAt ?? Date.now()
  };
}

export function createProfileExchangeFile(profile: MappingProfile): ProfileExchangeFile {
  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    profile: normalizeMappingProfile(profile)
  };
}

export function createDefaultProfileConfig(): ProfileConfig {
  const [firstProfile, ...restProfiles] = createDefaultProfiles();
  const safeFirstProfile = firstProfile ?? createBlankProfile("默认方案");

  return {
    enabled: true,
    gyroMouse: createDefaultGyroMouseConfig(),
    activeProfileId: safeFirstProfile.id,
    profiles: [safeFirstProfile, ...restProfiles],
    updatedAt: Date.now()
  };
}

export function normalizeGyroMouseSettings(input?: Partial<GyroMouseConfig> | null) {
  return normalizeGyroMouseConfig(input);
}

export function createFallbackAction(): MacroActionConfig {
  return createDefaultKeyboardAction("a");
}
