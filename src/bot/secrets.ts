import fs from "fs";
import path from "path";

/**
 * Secrets management for the control panel.
 *
 * - Only allowlisted variable names can be set (never free-form env writes).
 * - Values are applied to the running process immediately AND persisted to the
 *   .env file (atomic temp-file + rename, preserving all other lines).
 * - Values are never returned to the client; only masked status is exposed.
 */

export const ALLOWED_SECRET_NAMES = ["GEMINI_API_KEY", "NVIDIA_NIM_API_KEY", "OWNER_NUMBER"] as const;
export type SecretName = (typeof ALLOWED_SECRET_NAMES)[number];

const PLACEHOLDER_VALUES = new Set(["MY_GEMINI_API_KEY", "MY_NVIDIA_API_KEY", "YOUR_API_KEY_HERE"]);

export function isAllowedSecretName(name: string): name is SecretName {
  return (ALLOWED_SECRET_NAMES as readonly string[]).includes(name);
}

function getEnvFilePath(): string {
  // Overridable for tests and deployments that keep env files elsewhere.
  return process.env.NEBULA_ENV_FILE || path.join(process.cwd(), ".env");
}

export function maskSecret(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  const bullets = Math.min(12, Math.max(1, trimmed.length - 4));
  return "•".repeat(bullets) + trimmed.slice(-4);
}

function parseEnvLine(line: string): { name: string; value: string } | null {
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) return null;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { name: match[1], value };
}

function readEnvLines(): string[] {
  try {
    if (fs.existsSync(getEnvFilePath())) {
      return fs.readFileSync(getEnvFilePath(), "utf-8").split(/\r?\n/);
    }
  } catch (e: any) {
    console.warn("[Secrets] Failed to read .env:", e?.message || e);
  }
  return [];
}

export function readEnvValue(name: string): string | null {
  for (const line of readEnvLines()) {
    const parsed = parseEnvLine(line);
    if (parsed && parsed.name === name) return parsed.value;
  }
  return null;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9._+\-/]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function writeEnvFile(lines: string[]): boolean {
  try {
    const content = lines.join("\n").replace(/\n+$/, "") + "\n";
    const tmpPath = `${getEnvFilePath()}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, getEnvFilePath());
    return true;
  } catch (e: any) {
    console.warn("[Secrets] Failed to write .env:", e?.message || e);
    try {
      fs.rmSync(`${getEnvFilePath()}.tmp-${process.pid}`, { force: true });
    } catch {}
    return false;
  }
}

/** Sets a secret: applies it to the running process and persists it to .env. */
export function setSecret(name: SecretName, value: string): { applied: boolean; fileSaved: boolean } {
  // A newline in the value would let a caller write extra env assignments.
  if (/[\r\n]/.test(value)) {
    console.warn("[Secrets] Rejected value containing newline characters.");
    return { applied: false, fileSaved: false };
  }
  process.env[name] = value;

  const lines = readEnvLines();
  const lineRe = new RegExp(`^(?:export\\s+)?${name}\\s*=.*$`);
  let replaced = false;
  const updated = lines.map((line) => {
    if (lineRe.test(line)) {
      replaced = true;
      return `${name}=${formatEnvValue(value)}`;
    }
    return line;
  });
  if (!replaced) updated.push(`${name}=${formatEnvValue(value)}`);

  return { applied: true, fileSaved: writeEnvFile(updated) };
}

/** Removes a secret from the running process and from .env. */
export function deleteSecret(name: SecretName): { applied: boolean; fileSaved: boolean } {
  delete process.env[name];

  const lines = readEnvLines();
  const lineRe = new RegExp(`^(?:export\\s+)?${name}\\s*=.*$`);
  const updated = lines.filter((line) => !lineRe.test(line));

  return { applied: true, fileSaved: writeEnvFile(updated) };
}

export interface SecretStatus {
  name: string;
  configured: boolean;
  masked: string | null;
}

/** Returns masked status for a secret — never the raw value. */
export function getSecretStatus(name: SecretName): SecretStatus {
  const envValue = process.env[name];
  const fileValue = readEnvValue(name);

  const isUsable = (v: string | null | undefined): v is string =>
    !!v && v.trim() !== "" && !PLACEHOLDER_VALUES.has(v.trim());

  const active = isUsable(envValue) ? envValue : isUsable(fileValue) ? fileValue : "";

  return {
    name,
    configured: active.length > 0,
    masked: active ? maskSecret(active) : null,
  };
}
