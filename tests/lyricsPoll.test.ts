/**
 * 9.18nnnn (P2) — tests paroles LRCLIB + sondages natifs.
 *
 * Le sandbox n'atteint pas lrclib.net : le service est testé via fetch
 * mocké (URL, User-Agent, 429, timeout, cache). Les commandes sont testées
 * via contexte mocké (même harnais que groupAdmin.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLiveSocket } from "../src/bot/liveSocket.js";
import {
  __resetLrclibCacheForTests,
  cleanTrackTitle,
  findLyrics,
  parseArtistTrack,
  stripLrcTimestamps,
} from "../src/bot/services/lrclib.js";
import {
  __resetLastTrackForTests,
  getLastTrack,
  rememberLastTrack,
} from "../src/bot/services/lastTrackStore.js";
import lyricsCommand from "../src/bot/commands/lyrics.js";
import pollCommand from "../src/bot/commands/poll.js";

// ── Harnais ──────────────────────────────────────────────────────────────────

const CHAT = "237600000000@s.whatsapp.net";

function fakeSock() {
  return {
    user: { id: "1112223333:5@s.whatsapp.net" },
    sendMessage: vi.fn(async (_jid: string, _content: any, _options?: any) => ({})),
    sendPresenceUpdate: vi.fn(async (_status: string, _jid: string) => {}),
  };
}

function makeContext(overrides: Record<string, any> = {}) {
  return {
    reply: vi.fn(async (_text: string, _mediaUrl?: string) => {}),
    react: vi.fn(async (_emoji: string) => {}),
    args: [] as string[],
    prefix: ".",
    isAdmin: false,
    isOwner: false,
    sender: "237600000000@s.whatsapp.net",
    senderName: "Testeur",
    commandName: "lyrics",
    fullMessage: ".lyrics",
    ...overrides,
  };
}

function msg(text = ".lyrics") {
  return { key: { remoteJid: CHAT, fromMe: false }, message: { conversation: text } };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

let sock: ReturnType<typeof fakeSock>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sock = fakeSock();
  setLiveSocket(sock);
  __resetLrclibCacheForTests();
  __resetLastTrackForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setLiveSocket(null);
  vi.unstubAllGlobals();
});

// ── Helpers purs LRCLIB ──────────────────────────────────────────────────────

describe("9.18nnnn — lrclib : helpers purs", () => {
  it("stripLrcTimestamps retire les horodatages et métadonnées LRC", () => {
    const lrc = "[ar:Queen]\n[ti:Song]\n[00:01.00]First line\n[00:05.50][01:10.00]Repeated\n\n\n\nTail";
    expect(stripLrcTimestamps(lrc)).toBe("First line\nRepeated\n\nTail");
  });

  it("cleanTrackTitle retire le bruit YouTube", () => {
    expect(cleanTrackTitle("Song (Official Video)")).toBe("Song");
    expect(cleanTrackTitle("Song [HD]")).toBe("Song");
    expect(cleanTrackTitle("Song (Official Music Video)")).toBe("Song");
    expect(cleanTrackTitle("Song")).toBe("Song");
  });

  it("parseArtistTrack sépare « Artist - Track » (tirets variés)", () => {
    expect(parseArtistTrack("Queen - Bohemian Rhapsody")).toEqual({ artist: "Queen", track: "Bohemian Rhapsody" });
    expect(parseArtistTrack("Queen – Bohemian")).toEqual({ artist: "Queen", track: "Bohemian" });
    expect(parseArtistTrack("Just a title")).toEqual({ track: "Just a title" });
    expect(parseArtistTrack("Artist - Track (Official Video)")).toEqual({ artist: "Artist", track: "Track" });
  });
});

// ── Service réseau (fetch mocké) ─────────────────────────────────────────────

describe("9.18nnnn — lrclib : service", () => {
  it("recherche floue : URL, User-Agent et sélection du premier lisible", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, [
        { trackName: "Song", artistName: "Artist", plainLyrics: null, syncedLyrics: null },
        { trackName: "Song", artistName: "Artist", plainLyrics: "Line one\nLine two" },
      ]),
    );
    const out = await findLyrics({ query: "song artist" });
    expect(out.kind).toBe("found");
    if (out.kind === "found") {
      expect(out.hit.lyrics).toBe("Line one\nLine two");
      expect(out.hit.artist).toBe("Artist");
    }
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://lrclib.net/api/search?q=");
    expect(init.headers["User-Agent"]).toContain("NebulaBot");
  });

  it("correspondance exacte : /api/get avec track_name + artist_name + duration", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { trackName: "T", artistName: "A", plainLyrics: "ok" }));
    const out = await findLyrics({ track: "T", artist: "A", durationSec: 212.4 });
    expect(out.kind).toBe("found");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/get?");
    expect(url).toContain("track_name=T");
    expect(url).toContain("artist_name=A");
    expect(url).toContain("duration=212");
  });

  it("exact 404 → repli automatique sur la recherche", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(200, [{ trackName: "T", artistName: "A", plainLyrics: "found via search" }]));
    const out = await findLyrics({ track: "T", artist: "A" });
    expect(out.kind).toBe("found");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/search?q=");
  });

  it("syncedLyrics seul → horodatages retirés", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, [{ trackName: "T", artistName: "A", plainLyrics: null, syncedLyrics: "[00:01.00]Hello\n[00:02.00]World" }]),
    );
    const out = await findLyrics({ query: "q" });
    expect(out.kind).toBe("found");
    if (out.kind === "found") expect(out.hit.lyrics).toBe("Hello\nWorld");
  });

  it("429 → rate_limited, avec cache COURTE 30 s (on ne martèle pas un service saturé)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, null));
    expect((await findLyrics({ query: "q" })).kind).toBe("rate_limited");
    expect((await findLyrics({ query: "q" })).kind).toBe("rate_limited"); // servi par la cache courte
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("timeout réseau → error, jamais d'exception", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(findLyrics({ query: "q" })).resolves.toEqual({ kind: "error" });
  });

  it("aucun résultat → not_found", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    expect((await findLyrics({ query: "zzz" })).kind).toBe("not_found");
  });

  it("cache 10 min : la même requête ne refrappe pas l'API", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ trackName: "T", artistName: "A", plainLyrics: "x" }]));
    await findLyrics({ query: "q" });
    await findLyrics({ query: "q" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── Store dernière piste ─────────────────────────────────────────────────────

describe("9.18nnnn — lastTrackStore (couplage .ytm ↔ .lyrics)", () => {
  it("mémorise puis relit la dernière piste du chat", () => {
    rememberLastTrack(CHAT, "Queen - Bohemian Rhapsody");
    expect(getLastTrack(CHAT)).toBe("Queen - Bohemian Rhapsody");
  });

  it("TTL 30 min : expiré → null et entrée purgée", () => {
    rememberLastTrack(CHAT, "Old song");
    const now = Date.now() + 31 * 60 * 1000;
    expect(getLastTrack(CHAT, now)).toBeNull();
    expect(getLastTrack(CHAT, now)).toBeNull();
  });

  it("chats isolés les uns des autres", () => {
    rememberLastTrack(CHAT, "Song A");
    rememberLastTrack("other@g.us", "Song B");
    expect(getLastTrack(CHAT)).toBe("Song A");
    expect(getLastTrack("other@g.us")).toBe("Song B");
  });

  it("titre vide ou chat vide → ignoré (jamais de poison dans le store)", () => {
    rememberLastTrack(CHAT, "  ");
    rememberLastTrack("", "Song");
    expect(getLastTrack(CHAT)).toBeNull();
  });
});

// ── Commande .lyrics ─────────────────────────────────────────────────────────

describe("9.18nnnn — commande .lyrics", () => {
  it("sans argument ni dernière piste → usage honnête (mentionne .ytm)", async () => {
    const context = makeContext();
    await lyricsCommand.execute(sock, msg(), context);
    const text = context.reply.mock.calls[0][0];
    expect(text).toContain(".lyrics <titre>");
    expect(text).toContain("ytm");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("avec requête → recherche et paroles affichées", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ trackName: "Bohemian Rhapsody", artistName: "Queen", plainLyrics: "Is this the real life?" }]));
    const context = makeContext({ args: ["Bohemian", "Rhapsody", "Queen"] });
    await lyricsCommand.execute(sock, msg(), context);
    const text = context.reply.mock.calls[0][0];
    expect(text).toContain("Bohemian Rhapsody");
    expect(text).toContain("Queen");
    expect(text).toContain("Is this the real life?");
    expect(sock.sendPresenceUpdate).toHaveBeenCalled();
  });

  it("sans argument MAIS dernière piste → correspondance exacte artiste/titre", async () => {
    rememberLastTrack(CHAT, "Queen - Bohemian Rhapsody");
    fetchMock.mockResolvedValue(jsonResponse(200, { trackName: "Bohemian Rhapsody", artistName: "Queen", plainLyrics: "Caught in a landslide" }));
    const context = makeContext();
    await lyricsCommand.execute(sock, msg(), context);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/get?");
    expect(url).toContain("track_name=Bohemian+Rhapsody");
    expect(url).toContain("artist_name=Queen");
    expect(context.reply.mock.calls[0][0]).toContain("Caught in a landslide");
  });

  it("titre sans tiret en dernière piste → recherche floue (pas d'exact sans artiste)", async () => {
    rememberLastTrack(CHAT, "JustASongTitle");
    fetchMock.mockResolvedValue(jsonResponse(200, [{ trackName: "JustASongTitle", artistName: "X", plainLyrics: "ok" }]));
    const context = makeContext();
    await lyricsCommand.execute(sock, msg(), context);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/search?q=");
  });

  it("introuvable → réponse honnête avec conseil", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    const context = makeContext({ args: ["zzzz"] });
    await lyricsCommand.execute(sock, msg(), context);
    const text = context.reply.mock.calls[0][0];
    expect(text).toContain("Aucune paroles");
    expect(text).toContain(".lyrics <titre> <artiste>");
  });

  it("429 → message « réessaie », pas d'erreur brute", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, null));
    const context = makeContext({ args: ["x"] });
    await lyricsCommand.execute(sock, msg(), context);
    expect(context.reply.mock.calls[0][0]).toContain("saturé");
  });

  it("paroles très longues → tronquées avec note", async () => {
    const long = "la\n".repeat(3000);
    fetchMock.mockResolvedValue(jsonResponse(200, [{ trackName: "T", artistName: "A", plainLyrics: long }]));
    const context = makeContext({ args: ["t"] });
    await lyricsCommand.execute(sock, msg(), context);
    const text = context.reply.mock.calls[0][0] as string;
    expect(text.length).toBeLessThan(4000);
    expect(text).toContain("tronquées");
  });
});

// ── Commande .poll ───────────────────────────────────────────────────────────

describe("9.18nnnn — commande .poll (sondage natif)", () => {
  it("question + choix → message poll WhatsApp exact (choix unique)", async () => {
    const context = makeContext({ args: ["Épisode", "ce", "soir", "?", "|", "Oui", "|", "Non"] });
    await pollCommand.execute(sock, msg(".poll Épisode ce soir ? | Oui | Non"), context);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [to, payload] = sock.sendMessage.mock.calls[0];
    expect(to).toBe(CHAT);
    expect(payload.poll).toEqual({
      name: "Épisode ce soir ?",
      values: ["Oui", "Non"],
      selectableCount: 1,
    });
    expect(context.react).toHaveBeenCalledWith("📊");
    expect(sock.sendPresenceUpdate).toHaveBeenCalled();
  });

  it("flag -m → choix multiples (selectableCount = nombre d'options)", async () => {
    const context = makeContext({ args: ["-m", "Tes", "animes", "?", "|", "Naruto", "|", "One", "Piece", "|", "Bleach"] });
    await pollCommand.execute(sock, msg(".poll -m Tes animes ? | Naruto | One Piece | Bleach"), context);
    const [, payload] = sock.sendMessage.mock.calls[0];
    expect(payload.poll.selectableCount).toBe(3);
    expect(payload.poll.values).toEqual(["Naruto", "One Piece", "Bleach"]);
  });

  it("moins de 2 choix → usage, aucun envoi", async () => {
    const context = makeContext({ args: ["Question", "|", "Seul"] });
    await pollCommand.execute(sock, msg(".poll Question | Seul"), context);
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("2 choix");
  });

  it("plus de 12 choix → refus poli (limite WhatsApp)", async () => {
    const args = ["Q"].concat(...Array.from({ length: 13 }, (_, i) => ["|", `choix${i}`]));
    const context = makeContext({ args });
    await pollCommand.execute(sock, msg(".poll Q | ..."), context);
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("12");
  });

  it("échec d'envoi → message d'aide, pas de crash", async () => {
    const broken = { ...sock, sendMessage: (_jid: string, _c: any) => { throw new Error("boom"); } };
    setLiveSocket(broken);
    const context = makeContext({ args: ["Q", "|", "a", "|", "b"] });
    await pollCommand.execute(sock, msg(".poll Q | a | b"), context);
    expect(context.reply.mock.calls[0][0]).toContain("réessaie");
  });
});

// ── Couplage song.ts (pin source, pattern maison) ────────────────────────────

describe("9.18nnnn — couplage .ytm ↔ .lyrics (song.ts)", () => {
  it("song.ts mémorise la piste livrée (3 chemins d'envoi)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/bot/commands/song.ts", "utf-8");
    expect(src).toContain('import { rememberLastTrack } from "../services/lastTrackStore.js"');
    // 3 crochets : cache 5 h, envoi AAC converti, envoi brut.
    expect(src.split("rememberLastTrack(String(chatId), videoTitle)").length - 1).toBe(3);
  });
});
