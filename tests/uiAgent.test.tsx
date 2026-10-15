// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import App from "../src/App";

/**
 * 9.18y (P3) — page « Agent IA » du panneau : santé 24 h + timeline 48 h +
 * moteurs + garde-fous. Compteurs uniquement (aucun contenu de message).
 * Chaîne complète : nav « Agent IA » → GET /api/bot/agent-metrics → rendu.
 */

function makeResponses(): Record<string, unknown> {
  return {
    "/api/auth/me": { authenticated: true },
    "/api/bots": {
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
      ],
      config: { source: "file", total: 1, enabled: 1 },
    },
    "/api/bot/status": { status: "disconnected", qrCode: "", logs: ["🤖 ready"] },
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
    "/api/bot/agent-metrics": {
      health: {
        windowHours: 24,
        turns: 42,
        executes: 20,
        asks: 7,
        replies: 10,
        degraded: 3,
        denied: 1,
        errors: 1,
        parseOkRate: 0.93,
        avgLatencyMs: 2100,
        argsSanitized: 2,
        lastDegradedAt: 1700000000000,
      },
      timeline: {
        windowHours: 48,
        buckets: [
          { tsHour: 1700000000000, turns: 5, execute: 3, ask: 1, reply: 1, degraded: 0, denied: 0, error: 0, parseOk: 5, avgLatencyMs: 1800 },
          { tsHour: 1700003600000, turns: 3, execute: 1, ask: 0, reply: 2, degraded: 0, denied: 0, error: 0, parseOk: 3, avgLatencyMs: 2400 },
        ],
        engines: { gemini: 6, nim: 2 },
      },
    },
  };
}

let calls: string[] = [];

function stubFetch(responses: Record<string, unknown>, failUrls: string[] = []) {
  const handler = (url: string) => {
    calls.push(url);
    if (failUrls.includes(url)) {
      return Promise.resolve({ ok: false, status: 502, json: async () => ({}) });
    }
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
  const elements = await screen.findAllByText(label, {}, { timeout: 5000 });
  const button = elements.find((el) => el.closest("button"));
  if (!button) throw new Error(`Nav item "${label}" not clickable`);
  fireEvent.click(button);
}

vi.setConfig({ testTimeout: 30_000, hookTimeout: 15_000 });

describe("9.18y (P3) — page Agent IA du panneau", () => {
  beforeEach(() => {
    localStorage.clear();
    calls = [];
    stubFetch(makeResponses());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("la nav expose l'onglet et la page charge ses métriques", async () => {
    render(<App />);
    await clickNav("Agent IA");
    await waitFor(() => expect(screen.getByTestId("agent-metrics-page")).toBeTruthy(), { timeout: 10_000 });
    expect(calls).toContain("/api/bot/agent-metrics");
  });

  it("KPIs 24 h rendus depuis /api/bot/agent-metrics", async () => {
    render(<App />);
    await clickNav("Agent IA");
    await waitFor(() => expect(screen.getByTestId("agent-parse-badge")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.getByTestId("agent-parse-badge").textContent).toContain("93%");
    expect(screen.getByTestId("agent-kpi-tours").textContent).toContain("42");
    expect(screen.getByTestId("agent-kpi-exécutées").textContent).toContain("20");
    expect(screen.getByTestId("agent-kpi-dégradé").textContent).toContain("3");
    expect(screen.getByTestId("agent-kpi-latence moy.").textContent).toContain("2.1");
  });

  it("timeline 48 h : barres rendues + répartition moteurs", async () => {
    render(<App />);
    await clickNav("Agent IA");
    await waitFor(() => expect(screen.getByTestId("agent-timeline-bars")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.getByTestId("agent-timeline-bars").children.length).toBe(2);
    expect(screen.getByTestId("agent-engine-gemini").textContent).toContain("6");
    expect(screen.getByTestId("agent-engine-nim").textContent).toContain("2");
  });

  it("note vie privée présente (aucun contenu stocké)", async () => {
    render(<App />);
    await clickNav("Agent IA");
    await waitFor(() => expect(screen.getByTestId("agent-privacy-note")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.getByTestId("agent-privacy-note").textContent).toContain("compteurs uniquement");
  });

  it("moteur injoignable → état indisponible honnête, pas de crash", async () => {
    stubFetch(makeResponses(), ["/api/bot/agent-metrics"]);
    render(<App />);
    await clickNav("Agent IA");
    await waitFor(() => expect(screen.getByTestId("agent-metrics-unavailable")).toBeTruthy(), { timeout: 10_000 });
  });
});
