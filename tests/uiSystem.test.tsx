// @vitest-environment jsdom
/**
 * 9.2 — UI de la section « Système » : cartes version/actions, modale de
 * confirmation, appel POST /api/system/update, bannière de cycle de vie.
 * Même harness que uiBots (fetch global stubbé).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import App from "../src/App";

let calls: string[] = [];

function stubFetch(responses: Record<string, unknown>) {
  const handler = (url: string, init?: any) => {
    const method = init?.method || "GET";
    calls.push(method === "GET" ? url : `${method} ${url}`);
    if (method !== "GET") {
      const body = url.endsWith("/api/system/env")
        ? { ok: true, restartRequired: true }
        : url.endsWith("/api/system/yt-cookies")
          ? { ok: true, restartRequired: true, cookieCount: 42, domains: ["youtube.com", "google.com"], maxExpiry: "2027-01-12T00:00:00.000Z" }
          : { started: true };
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }
    const body = responses[url] ?? {};
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: any) => {
      const url: string = typeof input === "string" ? input : input.url;
      return handler(url, init);
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

function makeResponses(): Record<string, unknown> {
  return {
    "/api/auth/me": { authenticated: true },
    "/api/bots": { bots: [], config: { source: "default", total: 1, enabled: 1 } },
    "/api/bot/status": { status: "connected", qrCode: "", logs: [] },
    "/api/bot/config": { botName: "Nebula Bot", prefix: ".", ownerNumber: "" },
    "/api/bot/commands": [],
    "/api/bot/analytics": { stats: {} },
    "/api/bot/secrets": { secrets: [] },
    "/api/system/info": {
      version: "9.2.0",
      commit: "abc1234",
      branch: "main",
      uptimeSeconds: 3725,
      updating: false,
    },
    "/api/system/update-status": { updating: true, logTail: "" },
    "/api/system/logs?lines=100": { lines: "[bot:nebula] moteur prêt\n[WATCH] planifié" },
    "/api/system/logs?lines=300": { lines: "[bot:nebula] moteur prêt\n[WATCH] planifié\n[MEM] ok" },
    "/api/system/yt-cookies": {
      configured: false,
      envSet: false,
      fileExists: false,
      cookieCount: 0,
      domains: [],
      maxExpiry: null,
      updatedAt: null,
      valid: false,
    },
    "/api/system/env": {
      vars: [
        { key: "NEBULA_AI_DAILY_LIMIT", label: "Quota IA / jour / utilisateur", description: "Budget de requêtes IA par utilisateur et par jour.", type: "number", group: "quotas", default: "40", set: true, value: "40", restartRequired: true },
        { key: "NEBULA_DIGEST_HOUR", label: "Heure du digest", description: "Heure d'envoi du digest, 0-23.", type: "number", group: "digest", default: "8", set: false, value: "", restartRequired: true },
        { key: "TAVILY_API_KEY", label: "Clé Tavily", description: "Améliore .search — gratuite sur app.tavily.com.", type: "secret", group: "keys", set: true, value: "tvly…i789", restartRequired: false },
      ],
    },
  };
}

describe("Section Système (9.2)", () => {
  beforeEach(() => {
    localStorage.clear();
    calls = [];
    stubFetch(makeResponses());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("affiche version/commit/branche depuis /api/system/info", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("system-panel")).toBeTruthy());
    // La carte s'affiche immédiatement (placeholder « … »), l'info arrive async.
    await waitFor(() => expect(screen.getByTestId("system-version").textContent).toBe("9.2.0"));
    expect(screen.getByText("abc1234")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("1h 2m")).toBeTruthy(); // 3725 s
    expect(calls).toContain("/api/system/info");
  });

  it("mettre à jour : modale de confirmation → POST /api/system/update → bannière", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("btn-system-update")).toBeTruthy());

    fireEvent.click(screen.getByTestId("btn-system-update"));
    // Modale : avertissement downtime + bouton de confirmation
    expect(screen.getByTestId("system-modal")).toBeTruthy();
    expect(screen.getByText(/redémarrer pendant la mise à jour/)).toBeTruthy();
    expect(screen.getByText("Annuler")).toBeTruthy();

    fireEvent.click(screen.getByTestId("system-modal-confirm"));
    await waitFor(() => expect(calls).toContain("POST /api/system/update"));
    // Bannière de cycle de vie (update-status répond updating:true)
    await waitFor(() => expect(screen.getByTestId("system-lifecycle")).toBeTruthy());
    expect(screen.getByText(/Mise à jour en cours/)).toBeTruthy();
  });

  it("arrêter : la modale prévient que seule une relance SSH est possible", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("btn-system-stop")).toBeTruthy());
    fireEvent.click(screen.getByTestId("btn-system-stop"));
    expect(screen.getByText(/nebula start/)).toBeTruthy();
    // Pas de POST sans confirmation explicite
    expect(calls).not.toContain("/api/system/stop");
  });

  it("9.3 — éditeur .env : variables affichées, clé secrète masquée, édition + feedback redémarrage", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("env-editor")).toBeTruthy());
    // Les variables du serveur sont affichées, secret MASQUÉ (jamais en clair)
    await waitFor(() => expect(screen.getByTestId("env-var-TAVILY_API_KEY")).toBeTruthy());
    expect(screen.getByTestId("env-var-TAVILY_API_KEY").textContent).toContain("tvly…i789");
    expect(screen.getByTestId("env-var-NEBULA_AI_DAILY_LIMIT").textContent).toContain("40");
    expect(screen.getByTestId("env-var-NEBULA_DIGEST_HOUR").textContent).toContain("défaut");
    expect(calls).toContain("/api/system/env");

    // Édition d'une clé : Modifier → colle → OK → POST + feedback
    fireEvent.click(within(screen.getByTestId("env-var-TAVILY_API_KEY")).getByText("Modifier"));
    fireEvent.change(screen.getByTestId("env-input-TAVILY_API_KEY"), {
      target: { value: "tvly-nouvelle-cle" },
    });
    fireEvent.click(screen.getByTestId("env-save-TAVILY_API_KEY"));
    await waitFor(() => expect(calls).toContain("POST /api/system/env"));
    await waitFor(() =>
      expect(screen.getByTestId("env-feedback").textContent).toContain("redémarrage requis")
    );
  });

  it("9.4 — cookies YouTube : collage → POST + diagnostic + feedback redémarrage", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("yt-cookies-card")).toBeTruthy());

    // Statut initial : non configuré → pas de badge, pas de bouton supprimer
    expect(screen.queryByTestId("yt-cookies-delete")).toBeNull();

    // Colle le contenu exporté puis enregistre
    fireEvent.change(screen.getByTestId("yt-cookies-input"), {
      target: { value: "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tK\tv" },
    });
    fireEvent.click(screen.getByTestId("yt-cookies-save"));
    await waitFor(() => expect(calls).toContain("POST /api/system/yt-cookies"));
    await waitFor(() =>
      expect(screen.getByTestId("yt-cookies-feedback").textContent).toContain("42 cookies")
    );
    expect(screen.getByTestId("yt-cookies-feedback").textContent).toContain("redémarrage requis");
  });

  it("9.4b — Copier : les lignes affichées partent dans le presse-papiers + feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("system-log").textContent).toContain("moteur prêt"));
    fireEvent.click(screen.getByTestId("btn-copy-logs"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toContain("moteur prêt");
    await waitFor(() => expect(screen.getByTestId("btn-copy-logs").textContent).toContain("Copié ✓"));
  });

  it("9.4b — Exporter : télécharge un .txt des 300 dernières lignes (fetch dédié)", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("btn-export-logs")).toBeTruthy());
    fireEvent.click(screen.getByTestId("btn-export-logs"));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(calls).toContain("/api/system/logs?lines=300"); // export = plus large que l'affichage
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock"));
  });

  it("journal en direct : les lignes de bot.log sont affichées", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("system-log").textContent).toContain("moteur prêt"));
    expect(calls).toContain("/api/system/logs?lines=100");
  });
});
