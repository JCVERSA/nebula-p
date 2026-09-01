# Phase 3 — Prioritized Next-Batch Proposal

**Status:** proposal (not started)
**Companion docs:** `AUDIT_REPORT.md` (Phase 1), `PHASE2_STATUS.md` (Phase 2 done),
`RELEASE_NOTES_v1.1.0.md` (v1.1.0)
**Baseline:** `main` at `7cd5390` (v1.1.0)

This is the prioritized follow-up batch derived from the Phase 1 audit residuals and
the "Known residuals / Suggested next steps" recorded at the end of `PHASE2_STATUS.md`.
Items are grouped by priority (P1 = highest, do first) and sized S/M/L
(S = ~0.5–1 day, M = ~1–3 days, L = ~3–7 days for a single developer).

---

## Priority P1 — Security hardening (do these before anything else)

These close the remaining attack-surface and reliability gaps that Phase 2 deliberately
deferred. Each is independent, low-risk to land, and high-leverage.

| # | Item | Rationale | Size |
|---|---|---|---|
| 1 | **Quarantine `src/bot/imported/`** | The 145-file vendored corpus doubles the attack surface (its own `config.js`/`database.js`/`utils/*`, API-key fallbacks, unlicensed artifacts). Phase 2 added a fail-closed bridge, but the tree still weakens the "single enforcement point" story. Move behind a feature flag (default off) or delete; keep the bridge + ACL as the only path. | S |
| 2 | **Worker-isolated panel-command sandbox** | The current `node:vm` sandbox is *not* a cryptographic boundary (documented residual #1). Move execution into a worker thread with an isolated `vm` context, no host callbacks, tight resource limits, and an explicit capability allowlist — or drop the feature by default. | L |
| 3 | **Remove `.update` code-overwrite** | Even with `NEBULA_ALLOW_SELF_UPDATE=1` (default off), shipping a code-overwrite path is unnecessary risk. Replace with a documented `git pull` + restart flow and delete the ZIP-overwrite code. | S |
| 4 | **Global job governor** | No per-user concurrency cap on novabox global jobs (residual #4). Add a global semaphore (max 1–2 concurrent batches) + per-user concurrency, replacing the ad-hoc per-episode caps. | M |
| 5 | **Live antibot validation** | The message-ID heuristic was removed, but the correct behaviour has never been validated against a live WhatsApp session. Verify `isPotentialBot` on real traffic (or make antibot opt-in) before it can be re-enabled safely. | S |

---

## Priority P2 — Ops, packaging & hardening

Needed before the panel is comfortable to run unattended in production.

| # | Item | Rationale | Size |
|---|---|---|---|
| 6 | **Observability** | Structured pino logs, health/`/metrics`-lite, request-scoped error reporting, and a constant-time log sink. Today it's console + a 200-line in-memory buffer. | M |
| 7 | **Docker / non-root packaging** | Ship a Dockerfile + non-root user, read-only app dir, and write state only under a mounted `NEBULA_DATA_DIR` volume; ephemeral `/tmp` for media. Also resolves the `ffmpeg-static`/`esbuild` production-image concerns. | M |
| 8 | **Boot-time env validation** | Single source of truth for env vars (`PORT`, `NEBULA_*`, `APP_URL`) with runtime validation at boot; `/api/health` surfaces missing required config. Eliminates silent misconfiguration. | S |
| 9 | **Gemini jittered backoff** | Replace fixed 1s retry backoff with jittered exponential backoff to smooth worst-path latency under bursts. | S |
| 10 | **Multi-user panel roles** | Extend the single-operator login to multiple panel users with roles (owner/admin/viewer), separate from WhatsApp ACL. Enables delegating the panel without handing out `PANEL_TOKEN`. | L |

---

## Priority P3 — Quality, ergonomics & process

Improves maintainability, developer experience, and the release loop.

| # | Item | Rationale | Size |
|---|---|---|---|
| 11 | **ESLint + Prettier + Vitest coverage gate** | Add typescript-eslint + Prettier and a `@vitest/coverage-v8` admission threshold in CI. No linter exists today despite ~12k+ lines; the coverage floor prevents security regressions. | M |
| 12 | **Monolith refactors** | Break up `app.ts` (1,493), `botEngine.ts` (1,209), `novabox.ts` (1,579), `App.tsx` (4,944) into focused modules to make incremental testing and review tractable. | L |
| 13 | **Group-settings panel UI** | Expose welcome/antilink/abuse policies per group from the panel (not only via chat commands). Reuses the existing JSON store; natural for admins. | M |
| 14 | **Simulator expansion** | Stateful simulation for multi-step flows (novabox, backups, auth) so the browser playground can exercise flows beyond single commands. | M |
| 15 | **Release process** | Automate version bump, changelog/`RELEASE_NOTES_*` generation, tag + `gh release create`, and a smoke test — removing manual steps from the v1.1.0 flow. | S |
| 16 | **Error hygiene** | Stop interpolating raw `error.message` into WhatsApp replies (info leak); return safe, generic messages to users and log details server-side. Standardize error handling across engine/panel. | M |

---

## Suggested execution order

Sequence so each phase is independently shippable and the tree stays green.

1. **Quality gate (P3 #11)** — land ESLint + Prettier + coverage threshold first so every
   subsequent change is held to the new bar. *Async: can run in parallel with the next step.*
2. **Imported-tree quarantine (P1 #1)** — ship behind a flag/default-off.
3. **`.update` removal (P1 #3) + global job governor (P1 #4)** — remove the code-overwrite
   path and cap concurrent work.
4. **Packaging (P2 #7, #8)** — Docker/non-root + boot-time env validation.
5. **Observability (P2 #6, #9)** — structured logs/metrics + Gemini jittered backoff.
6. **Worker-isolated sandbox (P1 #2)** — the heavier piece; do after the foundation is solid.
7. **Features (P2 #10, P3 #12–#16)** — multi-user roles, refactors, group-settings UI,
   simulator expansion, release process, error hygiene.

**Each step is a separate PR; keep `npm run lint` + `npm test` + `npm run build` green.**

---

## Out of scope (explicitly NOT proposed)

- **Multi-instance / horizontal scaling / external DB.** The audit (§2.4) concluded the
  current design doesn't need it; a single-owner bot with JSON persistence is appropriate.
  Revisit only if a concrete requirement appears.
- **Introducing new dependencies to replace the core stack** (Express 5, replacing
  `ytdl-core`, swapping the vendored corpus). Any dependency change is judged on necessity
  and license risk; none are required for the items above.
- **Microservices or a message queue.** Not warranted at this scale.
- **Rewriting or removing the vendored corpus en masse.** Quarantine/flagging (#1) is
  safe; a wholesale re-write is out of scope and high-risk.
- **Live WhatsApp protocol reverse-engineering, multi-device pairing changes, or anything**
  **that touches the Baileys session layer for a feature rather than for a bug.**
- **The `.update` feature restored as-is** — it is being removed, not re-enabled.
- **Guaranteeing the panel-command sandbox as a hard security boundary** — it remains a
  defense-in-depth layer for trusted panel operators, not a place to run untrusted code.
- **Obtaining/verifying redistribution licenses for the vendored corpus** — a legal
  question, not an engineering task for this batch.
