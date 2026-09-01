import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import type { Express } from "express";

let app: Express;
let commandsDir: string;
let dataDir: string;

beforeAll(async () => {
  commandsDir = process.env.NEBULA_COMMANDS_DIR!;
  dataDir = process.env.NEBULA_DATA_DIR!;

  const { createApp } = await import("../app.js");
  const { initRegistry } = await import("../src/bot/commandRegistry.js");
  await initRegistry();
  app = createApp();
});

afterAll(() => {
  // Cleanup the temp commands/data directories
  try {
    fs.rmSync(commandsDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

const auth = { Authorization: "Bearer test-panel-token" };

describe("Panel authentication", () => {
  it("rejects API requests without a token", async () => {
    const res = await request(app).get("/api/bot/status");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("PANEL_TOKEN");
  });

  it("rejects API requests with a wrong token", async () => {
    const res = await request(app).get("/api/bot/status").set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("accepts API requests with a valid bearer token", async () => {
    const res = await request(app).get("/api/bot/status").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

});

describe("Panel session authentication", () => {
  it("never exposes the access key via an unauthenticated endpoint", async () => {
    // The old /auth/token hole must stay closed.
    const res = await request(app).get("/auth/token");
    expect(res.status).toBe(404);
    const res2 = await request(app).get("/api/auth/me");
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ authenticated: false });
  });

  it("logs in with the access key and issues an HttpOnly session cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ token: "test-panel-token" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const raw = res.headers["set-cookie"];
    const cookies = Array.isArray(raw) ? raw : [raw];
    const cookie = cookies.find((c) => typeof c === "string" && c.startsWith("panel_session="));
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=None");

    // The session cookie must be enough to reach a protected endpoint.
    const sessionCookie = cookie!.split(";")[0];
    const me = await request(app).get("/api/auth/me").set("Cookie", sessionCookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ authenticated: true });

    const status = await request(app).get("/api/bot/status").set("Cookie", sessionCookie);
    expect(status.status).toBe(200);
  });

  it("rejects invalid access keys without issuing a session", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ token: "wrong-key" });
    expect(res.status).toBe(401);
  });

  it("rejects cross-site writes that use a session cookie (CSRF)", async () => {
    const login = await request(app).post("/api/auth/login").send({ token: "test-panel-token" });
    const cookie = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"][0] : login.headers["set-cookie"]).split(";")[0];

    // Same-origin write is allowed.
    const sameOrigin = await request(app)
      .post("/api/bot/clear-logs")
      .set("Cookie", cookie)
      .set("Origin", "http://127.0.0.1");
    expect(sameOrigin.status).toBe(200);

    // Cross-site write is rejected.
    const evil = await request(app)
      .post("/api/bot/clear-logs")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example");
    expect(evil.status).toBe(403);
  });

  it("still authenticates tooling via bearer token", async () => {
    const res = await request(app).get("/api/bot/status").set(auth);
    expect(res.status).toBe(200);
  });
});

describe("Simulation playground", () => {
  it("runs .ping successfully", async () => {
    const res = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".ping" });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("Nebula Bot - Status");
  });

  it("runs .roast me without crashing (mock sock)", async () => {
    const res = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".roast me" });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("Nebula Roast");
  });

  it("runs .menu with the command directory", async () => {
    const res = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".menu" });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("SERVICES");
    expect(res.body.text).toContain("Powered by Nebula Engine");
  });

  it("reports unknown commands gracefully", async () => {
    const res = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".doesnotexist" });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("not found");
  });

  it("rejects messages without text and oversized text", async () => {
    const missing = await request(app).post("/api/bot/simulate").set(auth).send({ senderName: "T" });
    expect(missing.status).toBe(400);

    const oversized = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "T", text: "x".repeat(2001) });
    expect(oversized.status).toBe(400);
  });
});

describe("Command registry", () => {
  it("lists unique commands (no alias duplicates)", async () => {
    const res = await request(app).get("/api/bot/commands").set(auth);
    expect(res.status).toBe(200);
    const names = res.body.map((c: { name: string }) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("ping");
    expect(names).toContain("help");
  });

  it("saves a panel command as data and executes it in the sandbox", async () => {
    const code = `const cmd = {
  name: "hellocmd",
  category: "Test",
  description: "Test command saved via API",
  usage: "hellocmd",
  execute: async (_sock, _msg, context) => {
    await context.reply("Hello from sandbox!");
  }
};

export default cmd;
`;
    const save = await request(app)
      .post("/api/bot/commands/save")
      .set(auth)
      .send({ name: "hello_cmd", code });
    expect(save.status).toBe(200);
    expect(save.body.loaded).toBe(true);

    // C4: nothing executable may be written into the source tree.
    const filePath = path.join(commandsDir, "hellocmd.ts");
    const compiledPath = path.join(commandsDir, ".compiled", "hellocmd.mjs");
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(compiledPath)).toBe(false);

    const list = await request(app).get("/api/bot/commands").set(auth);
    expect(list.body.some((c: { name: string }) => c.name === "hellocmd")).toBe(true);

    const sim = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".hellocmd" });
    expect(sim.status).toBe(200);
    expect(sim.body.text).toContain("Hello from sandbox!");
  });

  it("rejects empty or invalid command names", async () => {
    const res = await request(app)
      .post("/api/bot/commands/save")
      .set(auth)
      .send({ name: "!!!", code: "export default {};" });
    expect(res.status).toBe(400);
  });
});

describe("Config persistence", () => {
  it("persists config updates to disk", async () => {
    const res = await request(app)
      .post("/api/bot/config")
      .set(auth)
      .send({ botName: "TestBot", prefix: "!" });
    expect(res.status).toBe(200);
    expect(res.body.botName).toBe("TestBot");

    const configFile = path.join(dataDir, "config.json");
    expect(fs.existsSync(configFile)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(onDisk.botName).toBe("TestBot");

    const get = await request(app).get("/api/bot/config").set(auth);
    expect(get.body.prefix).toBe("!");
  });

  it("rejects invalid config values", async () => {
    const res = await request(app)
      .post("/api/bot/config")
      .set(auth)
      .send({ prefix: "toolong" });
    expect(res.status).toBe(400);
  });
});

describe("ZIP export", () => {
  it("packages a runnable bot without leaking the API key", async () => {
    // A command that imports a shared runtime module (like ai.ts does)
    const aiLike = `import { generateTextWithFallback } from "../geminiClient.js";
import { BotCommand } from "../types.js";

const zipai: BotCommand = {
  name: "zipai",
  category: "Test",
  description: "ZIP test command",
  execute: async (_sock, _msg, context) => {
    await generateTextWithFallback("hello").catch(() => {});
    await context.reply("ok");
  }
};

export default zipai;
`;
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, "zipai.ts"), aiLike, "utf-8");

    const res = await request(app).get("/api/bot/download-zip").set(auth).responseType("arraybuffer");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");

    const zip = new AdmZip(res.body as Buffer);
    const names = zip.getEntries().map((e) => e.entryName);

    // Core files
    expect(names).toContain("index.js");
    expect(names).toContain("package.json");
    expect(names).toContain("config.json");
    expect(names).toContain("commands/zipai.js");

    // Shared runtime modules must be packaged so AI/admin commands work
    expect(names).toContain("geminiClient.js");
    expect(names).toContain("database.js");

    // The .env must contain a placeholder, never the live key
    const envContent = zip.readAsText(".env");
    expect(envContent).toContain("MY_GEMINI_API_KEY");
    expect(envContent).not.toContain("test-gemini-key");

    // Transpiled commands must reference the packaged modules, not missing types
    const zipaiJs = zip.readAsText("commands/zipai.js");
    expect(zipaiJs).toContain("geminiClient");
    expect(zipaiJs).not.toContain("types.js");
  });
});

describe("Gemini endpoints", () => {
  it("rejects unsupported audio mime types before calling the API", async () => {
    const res = await request(app)
      .post("/api/gemini/transcribe")
      .set(auth)
      .send({ audioBase64: "AAAA", mimeType: "video/mp4" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("mime");
  });

  it("rejects oversized audio payloads (413)", async () => {
    // 31 MiB of base64: under the 32 MiB JSON body limit, but over the
    // route's 30M-char audio cap -> the explicit friendly 413 must fire.
    const huge = "A".repeat(31 * 1024 * 1024);
    const res = await request(app)
      .post("/api/gemini/transcribe")
      .set(auth)
      .send({ audioBase64: huge, mimeType: "audio/webm" });
    expect(res.status).toBe(413);
  });

  it("rejects missing prompts for voice conversation", async () => {
    const res = await request(app).post("/api/gemini/voice-conversation").set(auth).send({});
    expect(res.status).toBe(400);
  });
});

describe("Project archive download", () => {
  it("serves the project zip when present, else a clean 404", async () => {
    const res = await request(app).get("/nebula-bot-latest.zip").set(auth);
    if (res.status === 200) {
      expect(res.headers["content-type"]).toContain("application/zip");
    } else {
      expect(res.status).toBe(404);
    }
  });
});

describe("Rate limiting", () => {
  it("limits rapid simulate calls with 429", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await request(app)
        .post("/api/bot/simulate")
        .set(auth)
        .send({ senderName: "Spammer", text: ".ping" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("Secrets management", () => {
  it("lists secret status without exposing the raw value", async () => {
    const res = await request(app).get("/api/bot/secrets").set(auth);
    expect(res.status).toBe(200);
    const gemini = res.body.secrets.find((s: { name: string }) => s.name === "GEMINI_API_KEY");
    expect(gemini).toBeDefined();
    expect(gemini.configured).toBe(true); // test env sets a key
    expect(gemini.masked).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain("test-gemini-key");
  });

  it("rejects placeholder values", async () => {
    const res = await request(app)
      .post("/api/bot/secrets")
      .set(auth)
      .send({ name: "GEMINI_API_KEY", value: "MY_GEMINI_API_KEY" });
    expect(res.status).toBe(400);
  });

  it("rejects unsupported secret names (allowlist enforced)", async () => {
    const res = await request(app)
      .post("/api/bot/secrets")
      .set(auth)
      .send({ name: "AWS_SECRET_ACCESS_KEY", value: "x" });
    expect(res.status).toBe(400);
  });

  it("saves a secret to the .env file and applies it immediately", async () => {
    const envFile = path.join(dataDir, ".env");
    const value = "sk-test-12345-secretvalue";

    const res = await request(app)
      .post("/api/bot/secrets")
      .set(auth)
      .send({ name: "GEMINI_API_KEY", value });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fileSaved).toBe(true);
    expect(res.body.masked).toContain(value.slice(-4));

    // Persisted to the .env file
    expect(fs.existsSync(envFile)).toBe(true);
    const content = fs.readFileSync(envFile, "utf-8");
    expect(content).toContain(`GEMINI_API_KEY=${value}`);

    // Applied to the running process — no restart needed
    expect(process.env.GEMINI_API_KEY).toBe(value);

    // Status endpoint reflects it, still masked
    const status = await request(app).get("/api/bot/secrets").set(auth);
    const gemini = status.body.secrets.find((s: { name: string }) => s.name === "GEMINI_API_KEY");
    expect(gemini.configured).toBe(true);
    expect(JSON.stringify(status.body)).not.toContain(value);
  });

  it("preserves unrelated lines in the .env file", async () => {
    const envFile = path.join(dataDir, ".env");
    fs.writeFileSync(envFile, "APP_URL=\"https://example.com\"\n# a comment\n", "utf-8");

    await request(app)
      .post("/api/bot/secrets")
      .set(auth)
      .send({ name: "GEMINI_API_KEY", value: "another-key-99" });

    const content = fs.readFileSync(envFile, "utf-8");
    expect(content).toContain('APP_URL="https://example.com"');
    expect(content).toContain("# a comment");
    expect(content).toContain("GEMINI_API_KEY=another-key-99");
  });

  it("removes a secret and cleans the .env file", async () => {
    const res = await request(app)
      .delete("/api/bot/secrets")
      .set(auth)
      .send({ name: "GEMINI_API_KEY" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const envFile = path.join(dataDir, ".env");
    const content = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf-8") : "";
    expect(content).not.toContain("GEMINI_API_KEY=");
    expect(process.env.GEMINI_API_KEY).toBeUndefined();

    const status = await request(app).get("/api/bot/secrets").set(auth);
    const gemini = status.body.secrets.find((s: { name: string }) => s.name === "GEMINI_API_KEY");
    expect(gemini.configured).toBe(false);
  });
});

describe("System and commands checkup diagnostics", () => {
  it("executes the full checkup diagnostic suite successfully", async () => {
    const res = await request(app).get("/api/bot/checkup").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.overallStatus).toBeDefined();
    expect(res.body.healthScore).toBeGreaterThanOrEqual(0);
    expect(res.body.system).toBeDefined();
    expect(res.body.system.nodeVersion).toBeDefined();
    expect(res.body.commands.totalRegistered).toBeGreaterThan(0);
    expect(Array.isArray(res.body.tests)).toBe(true);
    expect(res.body.tests.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.dependencies)).toBe(true);

    // M9: network probes are opt-in — the default suite must be offline-safe.
    const names = res.body.tests.map((t: any) => t.name);
    expect(names).not.toContain("Weather API Integration");

    // M12: vendor breakage must be visible, not silent.
    const bridge = res.body.tests.find((t: any) => t.name === "Vendored Command Bridge");
    expect(bridge).toBeDefined();
    expect(typeof bridge.details.skipped).toBe("number");
  });
});


describe("RoleGuard access control API", () => {
  it("requires auth and returns policy index", async () => {
    const unauth = await request(app).get("/api/bot/access");
    expect(unauth.status).toBe(401);

    const res = await request(app).get("/api/bot/access").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.policies).toBeDefined();
    expect(res.body.defaults).toBeDefined();
    expect(res.body.commandIndex.length).toBeGreaterThan(0);
  });

  it("persists and returns a sanitized group policy", async () => {
    const groupJid = "120363012345678901@g.us";
    const save = await request(app)
      .post(`/api/bot/access/${groupJid}`)
      .set(auth)
      .send({
        defaultTo: "deny",
        memberDeny: ["kick", "promote", 42, null],
        memberAllow: ["menu", "help"],
        adminAllow: ["download"],
      });
    expect(save.status).toBe(200);
    expect(save.body.policy.defaultTo).toBe("deny");
    expect(save.body.policy.memberDeny).toEqual(["kick", "promote"]);
    expect(save.body.policy.memberAllow).toEqual(["menu", "help"]);
    expect(save.body.policy.adminAllow).toEqual(["download"]);

    // The group list endpoint reflects the new policy.
    const list = await request(app).get("/api/bot/access").set(auth);
    expect(list.body.policies[groupJid]).toBeDefined();
    expect(list.body.policies[groupJid].defaultTo).toBe("deny");

    // And the single-group GET returns it too.
    const one = await request(app).get(`/api/bot/access/${groupJid}`).set(auth);
    expect(one.status).toBe(200);
    expect(one.body.policy.memberDeny).toContain("kick");
  });

  it("rejects invalid mode and overly long input gracefully", async () => {
    const groupJid = "120363099999999999@g.us";
    const bad = await request(app)
      .post(`/api/bot/access/${groupJid}`)
      .set(auth)
      .send({ defaultTo: "maybe", memberDeny: [Array(10000).fill("x").join("")] });
    expect(bad.status).toBe(200); // sanitize falls back to allow mode
    expect(bad.body.policy.defaultTo).toBe("allow");
    expect(bad.body.policy.memberDeny.length).toBeLessThanOrEqual(200);
  });
});

describe("Panel command execution safety (C4)", () => {
  const BENIGN = `
import { BotCommand } from "../types.js";
const cmd: BotCommand = {
  name: "safesay",
  category: "Utility",
  description: "Safe test command",
  execute: async (_s, _m, context) => {
    await context.reply("safe!");
  },
};
export default cmd;
`;

  it("rejects panel command source that imports node built-ins", async () => {
    const res = await request(app)
      .post("/api/bot/commands/save")
      .set(auth)
      .send({ name: "evilcmd", code: 'import fs from "fs"; export default {};' });
    expect(res.status).toBe(400);
    expect(res.body.ok ?? res.body.success).toBeFalsy();
    expect(res.body.error).toMatch(/not allowed|Forbidden/i);
  });

  it("rejects panel command source that references process", async () => {
    const res = await request(app)
      .post("/api/bot/commands/save")
      .set(auth)
      .send({ name: "evilcmd2", code: "export default {}; console.log(process.env);" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Forbidden/i);
  });

  it("stores and loads a benign panel command as data (no disk module)", async () => {
    const name = "safesay";
    const save = await request(app)
      .post("/api/bot/commands/save")
      .set(auth)
      .send({ name, code: BENIGN });
    expect(save.status).toBe(200);
    expect(save.body.success).toBe(true);
    expect(save.body.loaded).toBe(true);

    // Source round-trips via the API.
    const detail = await request(app).get(`/api/bot/commands/${name}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.code).toContain("safe!");

    // Downstream effects must NOT include an executable module on disk.
    const fsMod = await import("fs");
    const pathMod = await import("path");
    const legacyTs = pathMod.join(commandsDir, `${name}.ts`);
    const legacyMjs = pathMod.join(commandsDir, ".compiled", `${name}.mjs`);
    expect(fsMod.existsSync(legacyTs)).toBe(false);
    expect(fsMod.existsSync(legacyMjs)).toBe(false);
  });
});

describe("Host header validation (M3)", () => {
  it("rejects foreign Host headers when APP_URL is configured", async () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = "https://panel.example.com";
    try {
      const { createApp: createAppWithHost } = await import("../app.js");
      const appWithHost = createAppWithHost();

      const bad = await request(appWithHost).get("/api/bot/status").set("Host", "evil.example").set(auth);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("Invalid Host header.");

      const good = await request(appWithHost).get("/api/bot/status").set("Host", "panel.example.com").set(auth);
      expect(good.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });
});

describe("Health, audit trail and backup (M13/§8)", () => {
  it("serves a public health probe without auth", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.commands).toBe("number");
    expect(res.body.aiUsage).toBeDefined();
  });

  it("returns and clears the audit trail only when authenticated", async () => {
    const unauth = await request(app).get("/api/bot/audit");
    expect(unauth.status).toBe(401);

    // Login writes audit events; the API should show at least one.
    await request(app).post("/api/auth/login").send({ token: "test-panel-token" });
    const res = await request(app).get("/api/bot/audit").set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.events[0].action).toMatch(/auth\./);
  });

  it("export backup is sanitized (no sessionString) and restore validates format", async () => {
    const backup = await request(app).get("/api/bot/backup").set(auth);
    expect(backup.status).toBe(200);
    expect(backup.body.format).toBe("nebula-backup@1");
    expect(backup.body.config).toBeDefined();
    expect(JSON.stringify(backup.body)).not.toContain("sessionString");

    // Restore accepts our own bundle.
    const restore = await request(app)
      .post("/api/bot/backup/restore")
      .set(auth)
      .send(backup.body);
    expect(restore.status).toBe(200);
    expect(restore.body.success).toBe(true);
    expect(restore.body.applied).toContain("config");

    // Foreign format is rejected.
    const bad = await request(app)
      .post("/api/bot/backup/restore")
      .set(auth)
      .send({ format: "something-else", config: {} });
    expect(bad.status).toBe(400);
  });
});
