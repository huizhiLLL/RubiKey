import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createBlankProfile,
  createDefaultProfileConfig,
  normalizeProfileRules,
  type MappingProfile,
  type ProfileConfig
} from "../../shared/profiles.js";

export class ProfileStore {
  constructor(private readonly filePath: string) {}

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ProfileConfig>;
      return this.normalize(parsed);
    } catch {
      const defaults = createDefaultProfileConfig();
      await this.save(defaults);
      return defaults;
    }
  }

  async save(config: ProfileConfig) {
    const normalized = this.normalize(config);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(normalized, null, 2), "utf8");
    return normalized;
  }

  private normalize(input: Partial<ProfileConfig>) {
    const profiles = (input.profiles ?? []).map((profile) => this.normalizeProfile(profile));
    const safeProfiles = profiles.length > 0 ? profiles : createDefaultProfileConfig().profiles;
    const activeProfileId = safeProfiles.some((profile) => profile.id === input.activeProfileId)
      ? input.activeProfileId!
      : safeProfiles[0].id;

    return {
      enabled: input.enabled ?? true,
      activeProfileId,
      profiles: safeProfiles,
      updatedAt: input.updatedAt ?? Date.now()
    } satisfies ProfileConfig;
  }

  private normalizeProfile(input: Partial<MappingProfile>) {
    const fallback = createBlankProfile();
    return {
      id: input.id ?? fallback.id,
      name: input.name ?? fallback.name,
      description: input.description ?? fallback.description,
      rules: normalizeProfileRules(input.rules),
      updatedAt: input.updatedAt ?? Date.now()
    } satisfies MappingProfile;
  }
}
