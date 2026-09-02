/**
 * Offline single-file download page (audit 8.39, hardened by audit 8.41).
 *
 * Owner idea: instead of N tap-able links inside WhatsApp (whatsapp→chrome→
 * whatsapp ping-pong), the bot sends ONE .html document. Opened once in
 * Chrome, it lists every episode with a direct-download button plus a
 * "download all" action that walks the list automatically.
 *
 * Constraints honored here:
 * - The temp-link route already serves `Content-Disposition: attachment`
 *   (+CORS `*`, +Range, +HEAD) — hidden-iframe sequential fetches trigger
 *   real downloads without navigation, and a HEAD probe lets the page tell
 *   an expired link (410) from a live one WITHOUT losing itself (audit 8.41:
 *   a plain <a href> click on an expired link used to navigate the whole
 *   page to the server's 410 card).
 * - Single self-contained file: inline CSS only, no external asset, works
 *   from file:// (WhatsApp download folder) with no network beyond the
 *   download links themselves.
 * - Project palette (panel identity): zinc-950/#09090b background,
 *   zinc-900/#18181b cards, amber-500/#f59e0b primary, emerald success,
 *   rose danger.
 * - Everything user-derived is HTML-escaped; URLs are attribute-escaped AND
 *   the JSON url list embedded in the script block escapes `<`/`>` so a
 *   hostile `</script>` inside a URL can never break out of the script.
 */

export interface DownloadPageEntry {
  label: string;
  url: string;
  sizeMB?: number;
}

export const DOWNLOAD_PAGE_PALETTE = {
  bg: "#09090b",
  card: "#18181b",
  border: "rgba(255,255,255,0.1)",
  primary: "#f59e0b",
  primaryHover: "#fbbf24",
  text: "#fafafa",
  muted: "#a1a1aa",
  success: "#34d399",
  danger: "#f43f5e"
} as const;

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function formatSize(sizeMB?: number): string {
  if (!sizeMB || sizeMB <= 0) return "";
  return `${sizeMB >= 1024 ? (sizeMB / 1024).toFixed(2) + " GB" : Math.round(sizeMB) + " MB"}`;
}

/** JSON literal safe to inline in a <script> block (no `</script>` breakout). */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function buildDownloadPage(options: {
  title: string;
  subtitle?: string;
  entries: DownloadPageEntry[];
  expiresAt?: number;
  validityMinutes?: number;
}): string {
  const { title, subtitle, entries } = options;
  const expiresAt = options.expiresAt && options.expiresAt > 0 ? options.expiresAt : 0;
  const totalMB = entries.reduce((acc, e) => acc + (e.sizeMB || 0), 0);
  const totalSize = formatSize(totalMB);
  const listItems = entries
    .map((e, i) => {
      const size = formatSize(e.sizeMB);
      return `<li class="item" id="item-${i}">
        <div class="meta">
          <span class="label">${escapeHtml(e.label)}</span>
          ${size ? `<span class="size">${escapeHtml(size)}</span>` : ""}
          <span class="state" data-state></span>
        </div>
        <a class="btn small" href="${escapeAttr(e.url)}" target="_blank" download rel="noopener" data-dl="${i}">⬇ Télécharger</a>
      </li>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nebula — Téléchargements</title>
<style>
  :root { --bg:${DOWNLOAD_PAGE_PALETTE.bg}; --card:${DOWNLOAD_PAGE_PALETTE.card}; --border:${DOWNLOAD_PAGE_PALETTE.border};
          --primary:${DOWNLOAD_PAGE_PALETTE.primary}; --primary-hover:${DOWNLOAD_PAGE_PALETTE.primaryHover};
          --text:${DOWNLOAD_PAGE_PALETTE.text}; --muted:${DOWNLOAD_PAGE_PALETTE.muted};
          --success:${DOWNLOAD_PAGE_PALETTE.success}; --danger:${DOWNLOAD_PAGE_PALETTE.danger}; }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--text);
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:640px; margin:0 auto; }
  header { padding:20px 4px 12px; }
  .brand { font-size:12px; letter-spacing:2px; text-transform:uppercase; color:var(--primary); font-weight:700; }
  h1 { margin:6px 0 4px; font-size:20px; line-height:1.3; }
  .sub { color:var(--muted); font-size:13px; margin:0; }
  .bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:14px 0; }
  .stats { flex:1; min-width:180px; color:var(--muted); font-size:12px; }
  .stats b { color:var(--text); }
  .all { appearance:none; border:0; cursor:pointer; font-weight:800; font-size:14px;
         background:var(--primary); color:#000; padding:14px 22px; border-radius:14px; }
  .all:hover:not(:disabled) { background:var(--primary-hover); }
  .all:disabled { opacity:.45; cursor:not-allowed; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
  .item { display:flex; align-items:center; justify-content:space-between; gap:12px;
          background:var(--card); border:1px solid var(--border); border-radius:14px; padding:12px 14px; }
  .meta { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .label { font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .size { font-size:11px; color:var(--muted); }
  .state { font-size:11px; color:var(--success); min-height:14px; }
  .btn { text-decoration:none; }
  .btn.small { background:var(--primary); color:#000; font-size:12px; font-weight:700;
               padding:9px 14px; border-radius:10px; white-space:nowrap; }
  .btn.small:hover { background:var(--primary-hover); }
  .item.done { border-color:rgba(52,211,153,.45); }
  .item.failed { border-color:rgba(244,63,94,.5); }
  .item.failed .state { color:var(--danger); }
  .hint { margin:12px 2px 0; font-size:11.5px; color:var(--muted); line-height:1.6; }
  .expired { display:none; margin:12px 0; padding:12px 14px; border:1px solid rgba(244,63,94,.5);
             color:var(--danger); background:rgba(244,63,94,.08); border-radius:12px; font-size:13px; }
  body.expired .all, body.expired .btn.small { pointer-events:none; opacity:.35; }
  body.expired #expired { display:block; }
  footer { margin-top:18px; color:var(--muted); font-size:11px; text-align:center; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">🌌 Nebula</div>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ""}
  </header>

  <div id="expired" class="expired">⏳ Liens expirés — demande un nouveau téléchargement au bot (validité dépassée).</div>

  <div class="bar">
    <div class="stats" id="stats">
      <b>${entries.length}</b> épisode(s)${totalSize ? ` · <b>${escapeHtml(totalSize)}</b>` : ""}${expiresAt ? ` · expire dans <b id="countdown">…</b>` : ""}
    </div>
    <button class="all" id="all" type="button">⬇ Tout télécharger</button>
  </div>

  <ul id="list">
${listItems}
  </ul>

  <p class="hint">Astuce : au premier « Tout télécharger », Chrome demande <b>une seule fois</b> l'autorisation
  de télécharger plusieurs fichiers — appuie sur <b>Autoriser</b>. Les fichiers arrivent dans le dossier
  Téléchargements, un par un, automatiquement.</p>

  <footer>Nebula Bot — liens temporaires sécurisés · ne partage pas cette page</footer>
</div>

<script>
(function () {
  "use strict";
  var urls = ${jsonForScript(entries.map(e => e.url))};
  var expiresAt = ${expiresAt || 0};
  var cd = document.getElementById("countdown");
  var allBtn = document.getElementById("all");
  var EXPIRED_MSG = "⏳ expiré — redemande au bot";

  function fmt(ms) {
    if (ms <= 0) return "0 min";
    var m = Math.floor(ms / 60000);
    var h = Math.floor(m / 60);
    m = m % 60;
    return h > 0 ? h + " h " + String(m).padStart(2, "0") + " min" : m + " min";
  }
  function tick() {
    if (!cd || !expiresAt) return;
    var left = expiresAt - Date.now();
    if (left <= 0) { document.body.classList.add("expired"); cd.textContent = "expiré"; return; }
    cd.textContent = fmt(left);
  }
  tick(); setInterval(tick, 30000);

  function setState(i, text, failed) {
    var li = document.getElementById("item-" + i);
    if (!li) return;
    var s = li.querySelector("[data-state]");
    if (s) s.textContent = text;
    li.classList.add(failed ? "failed" : "done");
  }

  function fetchOne(url) {
    return new Promise(function (resolve) {
      var f = document.createElement("iframe");
      f.style.display = "none";
      f.src = url;
      document.body.appendChild(f);
      setTimeout(function () { f.remove(); resolve(); }, 1200);
    });
  }

  // HEAD probe (route serves CORS * + HEAD): tells an expired link (410/404)
  // from a live one so we never lie with "✓ lancé" on a dead link. Probe
  // errors fall back to a best-effort download attempt.
  function probe(url) {
    return fetch(url, { method: "HEAD" })
      .then(function (r) { return r.status; })
      .catch(function () { return 0; });
  }

  function downloadOne(i) {
    return probe(urls[i]).then(function (status) {
      if (status === 410 || status === 404) { setState(i, EXPIRED_MSG, true); return "expired"; }
      setState(i, "✓ lancé", false);
      return fetchOne(urls[i]).then(function () { return "ok"; });
    });
  }

  var running = false;
  allBtn.addEventListener("click", function () {
    if (running) return;
    running = true;
    allBtn.disabled = true;
    var text = allBtn.textContent;
    allBtn.textContent = "⏳ Téléchargements en cours…";
    var expired = 0;
    var chain = Promise.resolve();
    urls.forEach(function (url, i) {
      chain = chain.then(function () {
        return downloadOne(i).then(function (r) { if (r === "expired") expired++; });
      });
    });
    chain.then(function () {
      allBtn.textContent = expired > 0
        ? "⚠️ " + expired + " lien(s) expiré(s) — relance le bot"
        : "✅ Tout est lancé";
      setTimeout(function () { allBtn.textContent = text; allBtn.disabled = false; running = false; }, 6000);
    });
  });

  // Per-episode clicks stay ON this page: an expired link would otherwise
  // navigate the whole page to the server's 410 card. href/target are kept
  // as the no-JS and middle-click fallbacks.
  Array.prototype.forEach.call(document.querySelectorAll("[data-dl]"), function (a) {
    a.addEventListener("click", function (ev) {
      ev.preventDefault();
      var i = parseInt(a.getAttribute("data-dl"), 10);
      var li = document.getElementById("item-" + i);
      if (li && li.classList.contains("failed")) return;
      downloadOne(i);
    });
  });
})();
</script>
</body>
</html>`;
}
