import {
  createDefaultKeyboardAction,
  normalizeMacroAction,
  type MacroActionConfig,
  type RawMacroActionConfig
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
  rules?: Partial<Record<MoveToken, RawMacroActionConfig>>;
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

export function normalizeProfileRules(input?: Partial<Record<MoveToken, RawMacroActionConfig>>) {
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
    updatedAt: Date.now()
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
