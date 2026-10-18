// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import App from "../src/App";

const NORMAL_RESPONSES: Record<string, unknown> = {
  "/api/bot/config": {
    botName: "Nebula Bot",
    prefix: ".",
    botImage: "https://example.com/avatar.png",
    ownerNumber: "",
    newsletterUrl: "https://whatsapp.com/channel/x",
    newsletterName: "Nebula News",
  },
  "/api/bot/status": {
    status: "disconnected",
    qrCode: "",
    logs: ["🤖 Nebula Bot Engine initialized."],
  },
  "/api/bot/commands": [
    { name: "ping", category: "General", description: "Check latency", usage: "ping", aliases: [] },
    { name: "menu", category: "General", description: "Show menu", usage: "menu", aliases: [] },
    { name: "help", category: "General", description: "Help", usage: "help <cmd>", aliases: ["h"] },
  ],
  "/api/bot/analytics": { stats: { menu: 5, ping: 3 } },
  "/api/bot/users": {
    users: [
      { jid: "1555600000001@s.whatsapp.net", name: "Test User", firstSeen: Date.now() - 86400000, lastSeen: Date.now(), messageCount: 12, commandCount: 3, lastCommand: "menu", banned: false, quota: { ai: { used: 12, limit: 40 }, web: { used: 3, limit: 20 }, asr: { used: 2, limit: 10 } } },
      { jid: "120363161513685998@lid", name: "Owner LID", firstSeen: Date.now() - 86400000, lastSeen: Date.now(), messageCount: 40, commandCount: 9, lastCommand: "menu", banned: false, isOwner: true },
    ],
    groups: [
      { jid: "120363000000000000@g.us", name: "Groupe Test", firstSeen: Date.now() - 86400000, lastSeen: Date.now(), messageCount: 40 },
    ],
    total: 2,
    counts: { all: 2, active7d: 2, new30d: 0, banned: 0 },
    limit: 200,
    offset: 0,
  },
  "/api/bot/announce/status": { job: null, history: [] },
  "/api/bot/secrets": { secrets: [{ name: "GEMINI_API_KEY", configured: false, masked: null }] },
  "/api/auth/me": { authenticated: true },

  // 9.18c — commit (checkout) ≠ buildCommit (rev réellement construit) :
  // le panneau Système doit crier, pas laisser croire que tout est à jour.
  "/api/system/info": {
    version: "9.18.3",
    commit: "9c18c01",
    branch: "main",
    buildCommit: "a320964",
    uptimeSeconds: 120,
    updating: false,
  },
  "/api/bot/access": {
    policies: {},
    defaults: { defaultTo: "allow", adminAllow: [], memberDeny: [], memberAllow: [] },
    commandIndex: [
      { name: "ping", category: "General" },
      { name: "menu", category: "General" },
    ],
  },
};

function mockFetch(handler: (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>) {
  return vi.fn(async (input: any, init?: any) => {
    const url: string = typeof input === "string" ? input : input.url;
    return handler(url, init);
  }) as unknown as typeof fetch;
}

function normalHandler(rawUrl: string): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  // 9.17 : /api/bot/users?segment=…&limit=… — lookup sur le chemin seul
  const url = rawUrl.split("?")[0];
  const body = NORMAL_RESPONSES[url] ?? {};
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

/** Click a nav item by label, tolerating the label appearing more than once. */
async function clickNav(label: string) {
  const elements = await screen.findAllByText(label, {}, { timeout: 5000 });
  const button = elements.find((el) => el.closest("button"));
  if (!button) throw new Error(`Nav item "${label}" not clickable`);
  fireEvent.click(button);
}

// 8.92b : runners CI plus lents que la sandbox — marge sur les timeouts UI
vi.setConfig({ testTimeout: 30_000, hookTimeout: 15_000 });

describe("Nebula dashboard UI", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(normalHandler));
  });

  afterEach(() => {
    // 9.18d — cleanup() AVANT tout : unmount React propre, sinon le
    // scheduler peut tirer après la fermeture jsdom (« window is not
    // defined », erreur non capturée qui fait flaker la suite entière).
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders the dashboard shell without crashing", async () => {
    render(<App />);
    const titles = await screen.findAllByText("Overview", {}, { timeout: 5000 });
    expect(titles.length).toBeGreaterThan(0);
    // Stat cards appear after data loads
    await waitFor(() => expect(screen.getAllByText("Commands").length).toBeGreaterThan(0));
    expect(screen.getAllByText("3").length).toBeGreaterThan(0); // command count
  });

  it("navigates through every tab without crashing", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });

    await clickNav("Simulator");
    await waitFor(() => expect(screen.getByPlaceholderText(/Send message/)).toBeTruthy());

    await clickNav("Commands");
    await waitFor(() => expect(screen.getByText("Command Registry")).toBeTruthy());

    await clickNav("Analytics & AI");
    await waitFor(() => expect(screen.getByText("Command Frequencies")).toBeTruthy());

    await clickNav("Console Logs");
    await waitFor(() => expect(screen.getByText("Engine Console Output")).toBeTruthy());

    await clickNav("Utilisateurs");
    await waitFor(() => expect(screen.getByText("Utilisateurs connus")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Test User")).toBeTruthy());
    expect(screen.getByText("👑 OWNER")).toBeTruthy(); // 9.16b — badge owner, ban impossible
    expect(screen.getByText("IA 12/40")).toBeTruthy(); // 9.18 (B) — quotas visibles
    expect(screen.getAllByText(/1555600000001/).length).toBeGreaterThan(0);

    await clickNav("Annonces");
    await waitFor(() => expect(screen.getByText("Rédiger l'annonce")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Groupe Test")).toBeTruthy());

    await clickNav("Settings");
    await waitFor(() => expect(screen.getByText("Bot Parameters")).toBeTruthy());
    expect(screen.getAllByText("API Secrets").length).toBeGreaterThan(0);
  });

  it("Système : avertissement ambre quand le build ne correspond pas au code (9.18c)", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    // La cellule Build affiche le rev du marqueur une fois l'info chargée
    // Marge 5 s : sur un runner CI chargé, le 1 s par défaut de waitFor a
    // fait flaker le run push (le run PR du même SHA était vert).
    await waitFor(
      () => expect(screen.getByTestId("system-build").textContent).toBe("a320964"),
      { timeout: 5000 },
    );
    const warn = screen.getByTestId("system-build-warning");
    expect(warn.textContent).toContain("9c18c01");
    expect(warn.textContent).toContain("a320964");
  });

  it("Système : avertissement « process antérieur au build » indépendant du build (9.18f)", async () => {
    // commit == buildCommit (pas d'avertissement build) MAIS processStale :
    // seul l'avertissement process doit apparaître.
    vi.stubGlobal(
      "fetch",
      mockFetch((rawUrl: string) => {
        const url = rawUrl.split("?")[0];
        const body =
          url === "/api/system/info"
            ? {
                version: "9.18.6",
                commit: "d0c01f1",
                branch: "main",
                buildCommit: "d0c01f1",
                uptimeSeconds: 60,
                updating: false,
                processStale: true,
              }
            : NORMAL_RESPONSES[url] ?? {};
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }),
    );
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(
      () =>
        expect(screen.getByTestId("system-process-warning").textContent).toContain(
          "ancien code",
        ),
      { timeout: 5000 },
    );
    expect(screen.queryByTestId("system-build-warning")).toBeNull();
  });

  it("shows the login gate when every API call is rejected", async () => {
    // Simulate an auth failure: every API call returns 401
    vi.stubGlobal(
      "fetch",
      mockFetch(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      }))
    );

    render(<App />);
    // The login gate must render and the panel must NOT leak the dashboard.
    const gate = await screen.findByText("Nebula Controller — Panel Access", {}, { timeout: 5000 });
    expect(gate).toBeTruthy();
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.getByText(/The key is never stored in your browser/)).toBeTruthy();
  });
});
