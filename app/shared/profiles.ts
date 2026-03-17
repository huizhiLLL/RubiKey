import { createDefaultKeyboardAction, type MacroActionConfig } from "./macro.js";
import { ALL_MOVES, type MoveToken } from "./move.js";

export type ProfileRuleMap = Record<MoveToken, MacroActionConfig | null>;

export interface MappingProfile {
  id: string;
  name: string;
  description: string;
  rules: ProfileRuleMap;
  updatedAt: number;
}

export interface ProfileConfig {
  enabled: boolean;
  activeProfileId: string;
  profiles: MappingProfile[];
  updatedAt: number;
}

export function createEmptyRules(): ProfileRuleMap {
  return Object.fromEntries(ALL_MOVES.map((move) => [move, null])) as ProfileRuleMap;
}

export function createMinecraftProfile(): MappingProfile {
  const rules = createEmptyRules();
  rules.U = { kind: "keyboard", target: "a", behavior: "hold", durationMs: 1000 };
  rules["U'"] = { kind: "keyboard", target: "d", behavior: "hold", durationMs: 1000 };
  rules.R = { kind: "keyboard", target: "w", behavior: "hold", durationMs: 1000 };
  rules["R'"] = { kind: "keyboard", target: "s", behavior: "hold", durationMs: 1000 };
  rules.D = { kind: "keyboard", target: "e", behavior: "tap", durationMs: 100 };
  rules.F = { kind: "mouse", target: "left", behavior: "tap", durationMs: 100 };

  return {
    id: "minecraft-simple",
    name: "Minecraft 简单游玩",
    description: "基于 WASD + E + 左键的基础游玩映射",
    rules,
    updatedAt: Date.now()
  };
}

export function createBlankProfile(name = "新方案"): MappingProfile {
  return {
    id: `profile-${Date.now()}`,
    name,
    description: "自定义映射方案",
    rules: createEmptyRules(),
    updatedAt: Date.now()
  };
}

export function createDefaultProfileConfig(): ProfileConfig {
  const minecraft = createMinecraftProfile();
  return {
    enabled: true,
    activeProfileId: minecraft.id,
    profiles: [minecraft],
    updatedAt: Date.now()
  };
}

export function normalizeProfileRules(input?: Partial<Record<MoveToken, MacroActionConfig | null>>) {
  const rules = createEmptyRules();
  for (const move of ALL_MOVES) {
    const value = input?.[move];
    rules[move] = value ? { ...value } : null;
  }
  return rules;
}

export function createFallbackAction(): MacroActionConfig {
  return createDefaultKeyboardAction("a");
}
