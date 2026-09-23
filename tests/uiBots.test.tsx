// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../src/App";

/**
 * Multi-bots (8.77) — intégration UI du panneau superviseur.
 *
 * Vérifie la chaîne complète : onglet Multi-Bots → cartes issues de
 * GET /api/bots → sélection d'un bot → le reste du panneau route ses
 * requêtes par-bot avec ?bot=<id> (polling rearmé, persistance, pill topbar)
 * → actions start/stop/restart vers POST /api/bots/:id/…
 */

function makeBotsPayload(overrides: Record<string, unknown> = {}) {
  return {
    bots: [
      {
        id: "nebula",
        name: "Nebula",
        enabled: true,
        process: "running",
        pid: 111,
        enginePort: 4001,
        uptimeSeconds: 42,
        restarts: 0,
        ready: true,
        whatsapp: { status: "connected" },
        isDefault: true,
      },
      {
        id: "bot2",
        name: "Bot Deux",
        enabled: true,
        process: "stopped",
        pid: null,
        enginePort: 4002,
        uptimeSeconds: 0,
        restarts: 2,
        ready: false,
        whatsapp: null,
        isDefault: false,
      },
    ],
    config: { source: "file", total: 2, enabled: 2 },
    ...overrides,
  };
}

const STATUS_PAYLOAD = { status: "disconnected", qrCode: "", logs: ["🤖 ready"] };

function makeResponses(botsPayload: unknown): Record<string, unknown> {
  return {
    "/api/auth/me": { authenticated: true },
    "/api/bots": botsPayload,
    "/api/bot/status": STATUS_PAYLOAD,
    "/api/bot/status?bot=bot2": STATUS_PAYLOAD,
    "/api/bot/config": {
      botName: "Nebula Bot",
      prefix: ".",
      botImage: "https://example.com/a.png",
      ownerNumber: "",
      newsletterUrl: "https://whatsapp.com/channel/x",
      newsletterName: "News",
    },
    "/api/bot/commands": [],
    "/api/bot/analytics": { stats: {} },
    "/api/bot/secrets": { secrets: [] },
  };
}

let calls: string[] = [];

function stubFetch(responses: Record<string, unknown>) {
  const handler = (url: string) => {
    calls.push(url);
    const body = responses[url] ?? {};
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url: string = typeof input === "string" ? input : input.url;
      return handler(url);
    }) as unknown as typeof fetch,
  );
}

async function clickNav(label: string) {
  const elements = await screen.findAllByText(label, {}, { timeout: 3000 });
  const button = elements.find((el) => el.closest("button"));
  if (!button) throw new Error(`Nav item "${label}" not clickable`);
  fireEvent.click(button);
}

describe("Multi-bots panel UI", () => {
  beforeEach(() => {
    localStorage.clear();
    calls = [];
    stubFetch(makeResponses(makeBotsPayload()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("shows the bots cards from /api/bots with process and WhatsApp state", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 3000 });

    await clickNav("Multi-Bots");
    await waitFor(() => expect(screen.getByText("Bot Deux")).toBeTruthy());
    expect(screen.getAllByText("Nebula").length).toBeGreaterThan(0);
    expect(screen.getByText(/WhatsApp connected/)).toBeTruthy(); // nebula
    expect(screen.getByText(/No session state/)).toBeTruthy(); // bot2 arrêté
    expect(screen.getByText(/2 restarts/)).toBeTruthy();
    expect(calls).toContain("/api/bots");
  });

  it("selecting a bot routes the panel requests to it (?bot=) and persists the choice", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 3000 });

    await clickNav("Multi-Bots");
    const controlButtons = await screen.findAllByText("Control", {}, { timeout: 3000 });
    fireEvent.click(controlButtons[0]); // carte bot2 (nebula affiche « In panel »)

    // Persistance + pill topbar + rafraîchissement routé vers bot2.
    await waitFor(() => expect(localStorage.getItem("nebula-active-bot")).toBe("bot2"));
    await waitFor(() => expect(screen.getAllByText("bot2").length).toBeGreaterThan(0));
    await waitFor(() => expect(calls).toContain("/api/bot/status?bot=bot2"));
    // La carte sélectionnée bascule en état actif — et uniquement elle
    // (le bot par défaut n'est la sélection que si AUCUN bot n'est choisi).
    await waitFor(() => expect(screen.getAllByText("In panel").length).toBe(1));
  });

  it("stop action on a running bot calls the supervisor API then refreshes", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 3000 });

    await clickNav("Multi-Bots");
    await screen.findByText("Bot Deux", {}, { timeout: 3000 });
    const stopButtons = screen.getAllByText("Stop");
    fireEvent.click(stopButtons[0]); // nebula (running)

    await waitFor(() => expect(calls).toContain("/api/bots/nebula/stop"));
    // L'action déclenche un rafraîchissement de la vue.
    await waitFor(() => expect(calls.filter((c) => c === "/api/bots").length).toBeGreaterThanOrEqual(2));
  });

  it("shows the pairing code of a bot waiting for linking", async () => {
    vi.unstubAllGlobals();
    const payload = makeBotsPayload({
      bots: [
        {
          id: "nebula",
          name: "Nebula",
          enabled: true,
          process: "running",
          pid: 111,
          enginePort: 4001,
          uptimeSeconds: 42,
          restarts: 0,
          ready: true,
          whatsapp: { status: "pairing_code_ready", pairingCode: "ABCD-EFGH" },
          isDefault: true,
        },
      ],
    });
    stubFetch(makeResponses(payload));

    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 3000 });
    await clickNav("Multi-Bots");
    expect(await screen.findByText("ABCD-EFGH", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/Pairing code ready/)).toBeTruthy();
  });

  it("surfaces an invalid bots.json instead of guessing", async () => {
    vi.unstubAllGlobals();
    const payload = makeBotsPayload({ bots: [], config: { source: "file", error: 'bots.json : la liste "bots" est vide' } });
    stubFetch(makeResponses(payload));

    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 3000 });
    await clickNav("Multi-Bots");
    expect(await screen.findByText(/bots.json is invalid/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/la liste/)).toBeTruthy();
  });

  it("a saved selection that no longer exists is reset to the default bot", async () => {
    localStorage.setItem("nebula-active-bot", "ghost-bot");
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 3000 });
    // L'effet de validation interroge /api/bots et remet la sélection à zéro.
    await waitFor(() => expect(calls).toContain("/api/bots"));
    await waitFor(() => expect(localStorage.getItem("nebula-active-bot")).toBeNull());
  });
});
