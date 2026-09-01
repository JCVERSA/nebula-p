import fs from "fs";
import path from "path";

export interface BotConfig {
  botName: string;
  prefix: string;
  botImage: string;
  ownerNumber: string;
  newsletterUrl: string;
  newsletterName: string;
  browserPlatform?: string;
  browserName?: string;
  browserVersion?: string;
}

export const defaultConfig: BotConfig = {
  botName: "Nebula Bot",
  prefix: ".",
  botImage: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80",
  // Empty by default: the engine only notifies the owner when a valid number is configured.
  ownerNumber: "",
  newsletterUrl: "https://whatsapp.com/channel/0029VaNebulaChannel",
  newsletterName: "Nebula Bot Official News",
  browserPlatform: "Ubuntu",
  browserName: "Chrome",
  browserVersion: "22.04.4",
};

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function getConfigFile(): string {
  return path.join(getDataDir(), "config.json");
}

/** Load persisted config from disk, falling back to defaults. */
function loadConfig(): BotConfig {
  try {
    if (fs.existsSync(getConfigFile())) {
      const parsed = JSON.parse(fs.readFileSync(getConfigFile(), "utf-8"));
      const merged = { ...defaultConfig, ...parsed } as any;
      // M2: legacy secret/session fields must never survive into runtime config.
      delete merged.sessionString;
      return merged;
    }
  } catch (e: any) {
    console.error("[Config] Failed to load config file, using defaults:", e?.message || e);
  }
  return { ...defaultConfig };
}

let currentConfig: BotConfig = loadConfig();

export function getConfig(): BotConfig {
  return currentConfig;
}

export function updateConfig(newConfig: Partial<BotConfig>): BotConfig {
  currentConfig = { ...currentConfig, ...newConfig };
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    // Atomic write (temp + rename) so a crash mid-write cannot corrupt config.
    const tmp = `${getConfigFile()}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(currentConfig, null, 2), "utf-8");
    fs.renameSync(tmp, getConfigFile());
  } catch (e: any) {
    console.error("[Config] Failed to persist config:", e?.message || e);
  }
  return currentConfig;
}
