# Security Policy — Nebula Bot

## Threat model

- **Trusted:** the bot owner and the panel operator (same person in the default
  deployment). They hold `PANEL_TOKEN` and can perform any panel action.
- **Untrusted:** every WhatsApp contact (group members, DMs), anyone who can
  reach the panel over HTTP, and any content returned by third-party services
  (scrapers, image generators, media CDNs).

The design goal is: no untrusted actor can execute code, read or delete state,
spend budget, or make the bot perform admin/owner actions; third-party content
can never reach `eval`, `child_process`, or an internal network address.

## What is protected (implemented)

| Surface | Control |
|---|---|
| Panel access | `POST /api/auth/login` exchanges `PANEL_TOKEN` for an HttpOnly 12h session cookie; key never stored client-side; `/auth/token` removed; bearer tokens for tooling |
| CSRF | Cookie-auth state-changing requests require matching Origin/Referer host |
| Imported commands | Central bridge ACL: metadata enforcement + hard owner-only deny-list, fail-closed |
| Panel-created commands | Data store + `node:vm` sandbox; `fs`/`child_process`/`process`/network imports rejected statically; `NEBULA_PANEL_COMMANDS=off` disables |
| SSRF | All user URLs validated per redirect hop with DNS pinning (private/loopback/link-local rejected); novabox/ffmpeg/update hosts allowlisted |
| Resource abuse | Stream downloads w/ byte caps; temp storage quota (200 records / 4 GiB); novabox batch caps; AI daily budget + concurrency cap; media buffer cap |
| Host poisoning | Foreign `Host` headers rejected when `APP_URL` is set |
| Logging | Message content hidden by default (`NEBULA_LOG_CONTENT=1` to opt in); numbers masked to last 4 digits |
| Secrets | Newline-injection rejected; allowlisted env names only; masked status display |
| Integrity | Atomic writes (temp+rename) for config/stats/policies/audit; audit trail for auth/RoleGuard/command events |

## Reporting

For the private fork this repository lives in, report issues directly to the
repository maintainer. Do **not** run exploit payloads against production
instances. A minimal repro (test case) is greatly appreciated.

## Deployment checklist

- Set `PANEL_TOKEN` explicitly (never run on the auto-generated key in prod).
- Set `APP_URL` to the public https URL.
- Run as a non-root user; write state only under `NEBULA_DATA_DIR` (volume).
- Keep `NEBULA_ALLOW_SELF_UPDATE=0` (default) unless you really need `.update`.
- Preview/embedding hosts: the panel intentionally ships no `X-Frame-Options`;
  add `frame-ancestors` to the CSP yourself if you deploy behind a strict origin.

## Known limits

- The panel-command `vm` sandbox is **not a cryptographic containment
  boundary** for truly hostile code (host callbacks are reachable via
  constructor-chain tricks). It is safe for panel-authored commands and stops
  casual/accidental abuse; do not run untrusted third-party code through it.
- Group admin detection depends on cached group metadata; role checks are
  fail-closed on lookup errors.
