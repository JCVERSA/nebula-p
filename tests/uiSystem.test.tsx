// @vitest-environment jsdom
/**
 * 9.2 — UI de la section « Système » : cartes version/actions, modale de
 * confirmation, appel POST /api/system/update, bannière de cycle de vie.
 * Même harness que uiBots (fetch global stubbé).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../src/App";

let calls: string[] = [];

function stubFetch(responses: Record<string, unknown>) {
  const handler = (url: string, init?: any) => {
    calls.push(url);
    if (init?.method === "POST") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ started: true }) });
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
    await waitFor(() => expect(calls).toContain("/api/system/update"));
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

  it("journal en direct : les lignes de bot.log sont affichées", async () => {
    render(<App />);
    await screen.findAllByText("Overview", {}, { timeout: 5000 });
    await clickNav("Système");
    await waitFor(() => expect(screen.getByTestId("system-log").textContent).toContain("moteur prêt"));
    expect(calls).toContain("/api/system/logs?lines=100");
  });
});
