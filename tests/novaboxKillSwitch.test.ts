import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 9.19m — kill-switchs owner Novabox/Novafilm (serveur à stockage limité) :
 * NEBULA_NOVABOX_DISABLED=1 / NEBULA_NOVAFILM_DISABLED=1. La commande
 * répond un message honnête et court AVANT toute recherche/session/
 * téléchargement — zéro requête réseau, zéro fichier écrit. Le watcher
 * d'épisodes reste actif (il notifie, il ne télécharge jamais).
 */

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } })),
    isAxiosError: vi.fn(() => false),
  },
}));

import axios from "axios";
import { getCommand, initRegistry } from "../src/bot/commandRegistry.js";
import { isNovaboxDisabled } from "../src/bot/commands/novabox.js";
import { isNovafilmDisabled } from "../src/bot/commands/novafilm.js";

const mGet = vi.mocked(axios.get);
const mPost = vi.mocked(axios.post);

function makeContext(commandName: string, args: string[]) {
  return {
    sender: "10000000001@s.whatsapp.net",
    senderName: "Dark Neon",
    isOwner: true,
    isAdmin: false,
    prefix: ".",
    commandName,
    args,
    fullMessage: `.${commandName} ${args.join(" ")}`,
    reply: vi.fn(async () => {}),
    react: vi.fn(async () => {}),
  } as any;
}

beforeEach(async () => {
  mGet.mockClear();
  mPost.mockClear();
  await initRegistry();
});

afterEach(() => {
  delete process.env.NEBULA_NOVABOX_DISABLED;
  delete process.env.NEBULA_NOVAFILM_DISABLED;
});

describe("9.19m — NEBULA_NOVABOX_DISABLED=1 coupe Novabox proprement", () => {
  it("`.a <titre>` répond le message honnête, SANS aucune requête réseau", async () => {
    process.env.NEBULA_NOVABOX_DISABLED = "1";
    expect(isNovaboxDisabled()).toBe(true);

    const cmd = getCommand("anime");
    const ctx = makeContext("a", ["kill", "blue"]);
    await cmd!.execute(null, {} as any, ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const text = String(ctx.reply.mock.calls[0][0]);
    expect(text).toContain("Novabox est désactivé sur ce serveur");
    expect(text).toContain("L'administrateur a coupé les téléchargements d'animes");
    expect(mGet.mock.calls.length).toBe(0); // pas même une recherche
    expect(mPost.mock.calls.length).toBe(0);
  });

  it("l'interrupteur coupe AUSSI la reprise de session (`.a 1`) — même porte d'entrée", async () => {
    process.env.NEBULA_NOVABOX_DISABLED = "1";
    const cmd = getCommand("a");
    const ctx = makeContext("a", ["1"]);
    await cmd!.execute(null, {} as any, ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(String(ctx.reply.mock.calls[0][0])).toContain("désactivé");
  });

  it("par défaut (ligne absente) : activé", () => {
    expect(isNovaboxDisabled()).toBe(false);
  });

  it("seule la valeur exacte « 1 » coupe (pas « 0 », pas vide)", () => {
    process.env.NEBULA_NOVABOX_DISABLED = "0";
    expect(isNovaboxDisabled()).toBe(false);
    process.env.NEBULA_NOVABOX_DISABLED = "";
    expect(isNovaboxDisabled()).toBe(false);
  });
});

describe("9.19m — NEBULA_NOVAFILM_DISABLED=1 coupe Novafilm proprement", () => {
  it("`.f <titre>` répond le message honnête, SANS aucune requête réseau", async () => {
    process.env.NEBULA_NOVAFILM_DISABLED = "1";
    expect(isNovafilmDisabled()).toBe(true);

    const cmd = getCommand("novafilm");
    const ctx = makeContext("f", ["insidious"]);
    await cmd!.execute(null, {} as any, ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const text = String(ctx.reply.mock.calls[0][0]);
    expect(text).toContain("Novafilm est désactivé sur ce serveur");
    expect(mGet.mock.calls.length).toBe(0);
    expect(mPost.mock.calls.length).toBe(0);
  });

  it("par défaut (ligne absente) : activé", () => {
    expect(isNovafilmDisabled()).toBe(false);
  });
});

describe("9.19m — pins de câblage (leçon 8.49b : pinner le câblage, pas seulement les unités)", () => {
  const read = (p: string) => fs.readFileSync(p, "utf-8");

  it("la garde est la PREMIÈRE instruction des deux execute", () => {
    const nova = read("src/bot/commands/novabox.ts");
    expect(nova).toContain("if (isNovaboxDisabled()) {\n      return void (await context.reply(novaboxDisabledMessage()));\n    }");
    const film = read("src/bot/commands/novafilm.ts");
    expect(film).toContain("if (isNovafilmDisabled()) {\n      return void (await context.reply(novafilmDisabledMessage()));\n    }");
  });

  it(".env.example documente les deux interrupteurs", () => {
    const env = read(".env.example");
    expect(env).toContain('NEBULA_NOVABOX_DISABLED="0"');
    expect(env).toContain('NEBULA_NOVAFILM_DISABLED="0"');
    expect(env).toContain("The episode watcher keeps NOTIFYING");
  });

  it("le watcher d'épisodes n'est PAS gated (il notifie, ne télécharge jamais)", () => {
    const watch = read("src/bot/services/episodeWatchService.ts");
    expect(watch).not.toContain("NEBULA_NOVABOX_DISABLED");
  });
});
