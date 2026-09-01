import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * `.w` dedicated watch command (audit 8.31): search → numbered pick →
 * immediate subscription; list/remove; honest VF-only error. The voiranime
 * client is mocked — no network.
 */

vi.mock("../src/bot/services/voiranimeClient.js", () => ({
  voiranimeSearch: vi.fn(),
  voiranimeEpisodes: vi.fn()
}));

import watchCommand from "../src/bot/commands/watch.js";
import { voiranimeSearch, voiranimeEpisodes } from "../src/bot/services/voiranimeClient.js";
import { listSubscriptions } from "../src/bot/services/episodeWatchService.js";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "w-cmd-"));
process.env.NEBULA_DATA_DIR = DATA_DIR;

const CHAT = "10000000003@s.whatsapp.net";

function ctx(args: string[]) {
  const replies: string[] = [];
  return {
    replies,
    c: {
      sender: CHAT,
      senderName: "T",
      args,
      reply: async (t: string) => void replies.push(t),
      react: async () => {}
    } as any
  };
}

function msg(jid = CHAT) {
  return { key: { remoteJid: jid } } as any;
}

afterEach(() => {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(path.join(DATA_DIR, "watch_subscriptions.json"), { force: true });
});

describe(".w — dedicated watch command", () => {
  it("empty list -> hint", async () => {
    const { c, replies } = ctx([]);
    await watchCommand.execute({} as any, msg(), c);
    expect(replies[0]).toContain("Aucune veille active");
    expect(replies[0]).toContain(".w");
  });

  it("search with several VF entries -> numbered pick list, no subscription yet", async () => {
    (voiranimeSearch as any).mockResolvedValue([
      { title: "Solo Leveling S1", url: "https://voir-anime.to/anime/solo-leveling-s1-vf/", slug: "solo-leveling-s1-vf", isVf: true },
      { title: "Solo Leveling S2", url: "https://voir-anime.to/anime/solo-leveling-s2-vf/", slug: "solo-leveling-s2-vf", isVf: true },
      { title: "Solo Leveling VOSTFR", url: "https://voir-anime.to/anime/solo-leveling/", slug: "solo-leveling", isVf: false }
    ]);
    const { c, replies } = ctx(["solo", "leveling"]);
    await watchCommand.execute({} as any, msg(), c);
    expect(replies[0]).toContain("1. *Solo Leveling S1*");
    expect(replies[0]).toContain("2. *Solo Leveling S2*");
    expect(replies[0]).not.toContain("VOSTFR"); // filtered out of the pick list
    expect(listSubscriptions(CHAT)).toHaveLength(0);
  });

  it("pick .w 2 -> subscribes THAT entry with the current episode count", async () => {
    (voiranimeSearch as any).mockResolvedValue([
      { title: "Solo Leveling S1", url: "https://voir-anime.to/anime/s1-vf/", slug: "s1-vf", isVf: true },
      { title: "Solo Leveling S2", url: "https://voir-anime.to/anime/s2-vf/", slug: "s2-vf", isVf: true }
    ]);
    (voiranimeEpisodes as any).mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({ n: i + 1, url: "u", label: "Épisode " + (i + 1) }))
    );
    await watchCommand.execute({} as any, msg(), ctx(["solo"]).c); // build pending list
    const { c, replies } = ctx(["2"]);
    await watchCommand.execute({} as any, msg(), c);
    expect(replies[0]).toContain("Solo Leveling S2");
    expect(replies[0]).toContain("Dernier épisode connu : 9");
    const subs = listSubscriptions(CHAT);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.seasonUrl).toBe("https://voir-anime.to/anime/s2-vf/");
    expect(subs[0]!.lastSeenEp).toBe(9);
  });

  it("multiple anime can be watched at once", async () => {
    (voiranimeSearch as any).mockImplementation(async (q: string) => [
      { title: q, url: "https://voir-anime.to/anime/" + q.replace(/\s+/g, "-") + "-vf/", slug: q, isVf: true }
    ]);
    (voiranimeEpisodes as any).mockResolvedValue([{ n: 3, url: "u", label: "Épisode 3" }]);
    await watchCommand.execute({} as any, msg(), ctx(["naruto"]).c);
    await watchCommand.execute({} as any, msg(), ctx(["bleach"]).c);
    const subs = listSubscriptions(CHAT);
    expect(subs).toHaveLength(2);
    const { c, replies } = ctx([]);
    await watchCommand.execute({} as any, msg(), c);
    expect(replies[0]).toContain("naruto");
    expect(replies[0]).toContain("bleach");
  });

  it("single VF result -> direct subscribe without a pick list", async () => {
    (voiranimeSearch as any).mockResolvedValue([
      { title: "Frieren", url: "https://voir-anime.to/anime/frieren-vf/", slug: "frieren-vf", isVf: true }
    ]);
    (voiranimeEpisodes as any).mockResolvedValue([]);
    const { c, replies } = ctx(["frieren"]);
    await watchCommand.execute({} as any, msg(), c);
    expect(replies[0]).toContain("Frieren");
    expect(listSubscriptions(CHAT)).toHaveLength(1);
    expect(listSubscriptions(CHAT)[0]!.lastSeenEp).toBe(0);
  });

  it("no VF entries -> honest VF-only error, nothing subscribed", async () => {
    (voiranimeSearch as any).mockResolvedValue([
      { title: "X VOSTFR", url: "https://voir-anime.to/anime/x/", slug: "x", isVf: false }
    ]);
    const { c, replies } = ctx(["x"]);
    await watchCommand.execute({} as any, msg(), c);
    expect(replies[0]).toContain("VF");
    expect(listSubscriptions(CHAT)).toHaveLength(0);
  });

  it("numeric pick with nothing pending -> friendly re-search hint", async () => {
    const { c, replies } = ctx(["3"]);
    await watchCommand.execute({} as any, msg(), c);
    expect(replies[0]).toContain("sélection en attente");
  });

  it(".w rm stops a watch", async () => {
    (voiranimeSearch as any).mockResolvedValue([
      { title: "One Piece", url: "https://voir-anime.to/anime/op-vf/", slug: "op-vf", isVf: true }
    ]);
    (voiranimeEpisodes as any).mockResolvedValue([]);
    await watchCommand.execute({} as any, msg(), ctx(["one", "piece"]).c);
    expect(listSubscriptions(CHAT)).toHaveLength(1);
    const { c, replies } = ctx(["rm", "one", "piece"]);
    await watchCommand.execute({} as any, msg(), c);
    expect(replies[0]).toContain("arrêtée");
    expect(listSubscriptions(CHAT)).toHaveLength(0);
  });
});

describe(".w — pending pick hygiene (audit 8.32)", () => {
  it("expires a pending pick after the 10-min TTL", async () => {
    vi.useFakeTimers();
    try {
      (voiranimeSearch as any).mockResolvedValue([
        { title: "A", url: "https://voir-anime.to/anime/a-vf/", slug: "a-vf", isVf: true },
        { title: "B", url: "https://voir-anime.to/anime/b-vf/", slug: "b-vf", isVf: true }
      ]);
      await watchCommand.execute({} as any, msg(), ctx(["x"]).c);
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      const { c, replies } = ctx(["1"]);
      await watchCommand.execute({} as any, msg(), c);
      expect(replies[0]).toContain("sélection en attente");
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps the pending-pick map (oldest chat evicted beyond the cap)", async () => {
    (voiranimeSearch as any).mockResolvedValue([
      { title: "A", url: "https://voir-anime.to/anime/a-vf/", slug: "a-vf", isVf: true },
      { title: "B", url: "https://voir-anime.to/anime/b-vf/", slug: "b-vf", isVf: true }
    ]);
    const firstChat = "1000@g.us";
    await watchCommand.execute({} as any, msg(firstChat), ctx(["x"]).c);
    for (let i = 1; i <= 210; i++) {
      await watchCommand.execute({} as any, msg(i + "@g.us"), ctx(["x"]).c);
    }
    const { c, replies } = ctx(["1"]);
    await watchCommand.execute({} as any, msg(firstChat), c); // oldest -> evicted
    expect(replies[0]).toContain("sélection en attente");
    // newest chat still has its pending list (subscribes entry 1)
    (voiranimeEpisodes as any).mockResolvedValue([]);
    const { c: c2, replies: r2 } = ctx(["1"]);
    await watchCommand.execute({} as any, msg("210@g.us"), c2);
    expect(r2[0]).toContain("Veille activée");
  });
});
