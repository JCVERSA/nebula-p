/**
 * Offline single-file download page (audit 8.39, hardened by audit 8.41,
 * restyled 9.14 with the file-share visual language — owner decision).
 *
 * Owner idea: instead of N tap-able links inside WhatsApp (whatsapp→chrome→
 * whatsapp ping-pong), the bot sends ONE .html document. Opened once in
 * Chrome, it lists every episode with a direct-download button plus a
 * "download all" action that walks the list automatically.
 *
 * 9.14 — style ported from JCVERSA/file-share (same owner, MIT): dark
 * mint/teal palette, shell + topbar with a live status pill, per-file tiles,
 * restrained hovers, and its animations — skeleton shimmer while the initial
 * HEAD sweep probes each link, spinner in the download-all button, animated
 * check on completed rows, prefers-reduced-motion respected. The sweep is a
 * real feature wearing the new clothes: expired links now show BEFORE any
 * click (410/404 → honest "expiré" state, audit 8.41 logic unchanged).
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
 *   download links themselves. CI keeps it under 16 KB.
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
  bg: "#0b1011",
  card: "#142022",
  border: "#263737",
  primary: "#a2e3cb",
  primaryHover: "#b8efd9",
  text: "#f4f7f4",
  muted: "#b0bcb8",
  success: "#8fe0bb",
  danger: "#f28b82"
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

/**
 * 9.15b : garantit un schéma — un lien nu (« dash2.exemple.com/... ») résolu
 * depuis une page enregistrée localement (dossier transfers de WhatsApp
 * Desktop) devient file:///C:/.../transfers/dash2.exemple.com/... et ne
 * télécharge rien. Pur — testé via le HTML généré.
 */
function absoluteMediaUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return u;
  return /^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(u) ? u : `https://${u}`;
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

/** Short tile label for a row (file-share's file-icon, episode flavor). */
function tileFor(url: string): string {
  if (/\.zip(\?|$)/i.test(url)) return "ZIP";
  if (/\.pdf(\?|$)/i.test(url)) return "PDF";
  if (/\.(mp4|mkv|webm|mov)(\?|$)/i.test(url)) return "MP4";
  if (/\.(mp3|m4a|opus)(\?|$)/i.test(url)) return "AUD";
  return "EP";
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
        <span class="tile" aria-hidden="true">${tileFor(e.url)}</span>
        <div class="meta">
          <strong class="label">${escapeHtml(e.label)}</strong>
          ${size ? `<span class="size">${escapeHtml(size)}</span>` : ""}
          <span class="state" data-state></span>
        </div>
        <a class="btn small" href="${escapeAttr(absoluteMediaUrl(e.url))}" target="_blank" download rel="noopener" data-dl="${i}">Télécharger</a>
      </li>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Nebula — Téléchargements</title>
<style>
  :root { color-scheme:dark; --bg:${DOWNLOAD_PAGE_PALETTE.bg}; --panel:#10191b; --card:${DOWNLOAD_PAGE_PALETTE.card}; --panel3:#0e1718;
          --border:${DOWNLOAD_PAGE_PALETTE.border}; --border-strong:#405554;
          --primary:${DOWNLOAD_PAGE_PALETTE.primary}; --primary-hover:${DOWNLOAD_PAGE_PALETTE.primaryHover};
          --text:${DOWNLOAD_PAGE_PALETTE.text}; --muted:${DOWNLOAD_PAGE_PALETTE.muted};
          --success:${DOWNLOAD_PAGE_PALETTE.success}; --danger:${DOWNLOAD_PAGE_PALETTE.danger};
          --shadow:0 18px 54px rgba(0,0,0,.24); }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 16px 40px; background:var(--bg); color:var(--text); line-height:1.5;
         font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  a { color:inherit; text-decoration:none; }
  button { font:inherit; cursor:pointer; touch-action:manipulation; }
  .page { max-width:680px; margin:0 auto; }
  .shell { background:var(--panel); border:1px solid var(--border); border-radius:16px; overflow:hidden; box-shadow:var(--shadow); }
  .topbar { min-height:52px; padding:10px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center;
            justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .brand { color:var(--text); font-weight:700; font-size:13px; letter-spacing:.01em; }
  .pill { display:inline-flex; align-items:center; gap:8px; min-height:28px; padding:4px 11px; border:1px solid rgba(143,224,187,.28);
          border-radius:999px; color:var(--success); font-size:11px; font-weight:700; }
  .pill b { font-variant-numeric:tabular-nums; }
  .dot { width:8px; height:8px; border-radius:999px; background:var(--success); flex:0 0 auto; }
  .content { padding:24px 22px 26px; }
  .eyebrow { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); font-weight:700; margin-bottom:6px; }
  h1 { margin:0 0 4px; font-size:clamp(24px,4.6vw,32px); line-height:1.12; letter-spacing:-.03em; text-wrap:balance; }
  .sub { color:var(--muted); font-size:13px; margin:0 0 18px; overflow-wrap:anywhere; }
  .bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between; margin:0 0 16px;
         padding-bottom:16px; border-bottom:1px solid var(--border); }
  .stats { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .stats b { color:var(--text); }
  .all { appearance:none; border:1px solid var(--primary); border-radius:8px; font-weight:700; font-size:13px;
         background:var(--primary); color:#0a1713; padding:11px 18px; min-height:42px;
         transition:background-color .15s ease,border-color .15s ease,transform .12s ease; }
  .all:hover:not(:disabled) { background:var(--primary-hover); border-color:var(--primary-hover); }
  .all:active:not(:disabled) { transform:translateY(1px); }
  .all:disabled { opacity:.55; cursor:wait; }
  ul { list-style:none; margin:0; padding:0; border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  .item { display:grid; grid-template-columns:40px minmax(0,1fr) auto; gap:13px; align-items:center; padding:13px 14px;
          background:var(--card); border-bottom:1px solid var(--border); transition:background-color .15s ease; }
  .item:last-child { border-bottom:0; }
  .item:hover { background:#192727; }
  .item.done { border-left:3px solid var(--success); }
  .item.failed { border-left:3px solid var(--danger); }
  .tile { width:36px; height:36px; border-radius:8px; border:1px solid var(--border); background:var(--panel3);
          display:grid; place-items:center; color:var(--muted); font-size:9px; font-weight:750; letter-spacing:.02em; }
  .meta { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .label { font-size:14px; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .size { font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .state { font-size:11px; color:var(--success); min-height:15px; display:flex; align-items:center; gap:6px; }
  .item.failed .state { color:var(--danger); }
  .btn.small { display:inline-flex; align-items:center; justify-content:center; min-width:104px; min-height:38px; padding:0 13px;
               border:1px solid rgba(162,227,203,.42); border-radius:8px; background:rgba(162,227,203,.08); color:var(--primary);
               font-size:12px; font-weight:700; white-space:nowrap;
               transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .12s ease; }
  .btn.small:hover { background:var(--primary); border-color:var(--primary); color:#0a1713; }
  .btn.small:active { transform:translateY(1px); }
  .hint { margin:14px 2px 0; font-size:11.5px; color:var(--muted); line-height:1.6; }
  .expired { display:none; margin:0 0 16px; padding:12px 14px; border:1px solid rgba(242,139,130,.5); border-left:3px solid var(--danger);
             color:var(--danger); background:rgba(242,139,130,.08); border-radius:10px; font-size:13px; }
  body.expired .all, body.expired .btn.small { pointer-events:none; opacity:.35; }
  body.expired #expired { display:block; }
  footer { margin-top:18px; color:var(--muted); font-size:11px; text-align:center; }
  a:focus-visible, button:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }
  .spin { display:inline-block; width:13px; height:13px; border:2px solid rgba(10,23,19,.35); border-top-color:#0a1713;
          border-radius:50%; animation:rot .8s linear infinite; vertical-align:-2px; margin-right:7px; }
  @keyframes rot { to { transform:rotate(360deg); } }
  .sk { display:inline-block; width:56px; height:8px; border-radius:999px; background:#263334; position:relative; overflow:hidden; }
  .sk::after { content:""; position:absolute; inset:0; transform:translateX(-100%);
               background:linear-gradient(90deg,transparent,rgba(244,247,244,.07),transparent); animation:sh 1.1s infinite; }
  @keyframes sh { to { transform:translateX(100%); } }
  .state .ck { width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:3; stroke-linecap:round; stroke-linejoin:round;
               animation:ck .25s ease; }
  @keyframes ck { from { stroke-dasharray:0 30; } to { stroke-dasharray:30 30; } }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
</style>
</head>
<body>
<div class="page">
<div class="shell">
  <div class="topbar">
    <span class="brand">🌌 Nebula</span>
    <span class="pill"><span class="dot" aria-hidden="true"></span>liens actifs${expiresAt ? ` · expire dans <b id="countdown">…</b>` : ""}</span>
  </div>
  <div class="content">
    <div class="eyebrow">Téléchargements</div>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ""}

    <div id="expired" class="expired">⏳ Liens expirés — demande un nouveau téléchargement au bot (validité dépassée).</div>

    <div class="bar">
      <div class="stats" id="stats">
        <b>${entries.length}</b> épisode(s)${totalSize ? ` · <b>${escapeHtml(totalSize)}</b>` : ""}
      </div>
      <button class="all" id="all" type="button">Tout télécharger</button>
    </div>

    <ul id="list">
${listItems}
    </ul>

    <p class="hint">Astuce : au premier « Tout télécharger », Chrome demande <b>une seule fois</b> l'autorisation
    de télécharger plusieurs fichiers — appuie sur <b>Autoriser</b>. Les fichiers arrivent dans le dossier
    Téléchargements, un par un, automatiquement.</p>

    <footer>Nebula Bot — liens temporaires sécurisés · ne partage pas cette page</footer>
  </div>
</div>
</div>

<script>
(function () {
  "use strict";
  var urls = ${jsonForScript(entries.map(e => absoluteMediaUrl(e.url)))};
  var expiresAt = ${expiresAt || 0};
  var cd = document.getElementById("countdown");
  var allBtn = document.getElementById("all");
  var EXPIRED_MSG = "⏳ expiré — redemande au bot";
  var CK = '<svg class="ck" viewBox="0 0 24 24" aria-hidden="true"><polyline points="8 12 11 15 16 9"/></svg>';

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

  function setState(i, text, kind) {
    var li = document.getElementById("item-" + i);
    if (!li) return;
    var s = li.querySelector("[data-state]");
    // 9.14b (retour owner) : seul un état VÉRIFIÉ a la coche verte. Un lien
    // que la sonde n'a pas pu joindre (statut 0) reste neutre — jamais de
    // « ✓ lancé » mensonger sur un téléchargement invérifiable.
    if (s) s.innerHTML = (kind === "ok" ? CK : "") + "<span>" + text + "</span>";
    if (kind === "ok") li.classList.add("done");
    else if (kind === "fail") li.classList.add("failed");
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
      if (status === 410 || status === 404) { setState(i, EXPIRED_MSG, "fail"); return "expired"; }
      if (status === 0) { setState(i, "▶ tentative — lien non vérifié", "neutral"); }
      else { setState(i, "✓ lancé", "ok"); }
      return fetchOne(urls[i]).then(function () { return "ok"; });
    });
  }

  // 9.14 (style file-share) : balayage initial — chaque ligne affiche un
  // skeleton le temps de sa sonde HEAD, puis l'état réel. Un lien expiré se
  // voit AVANT tout clic. Les lignes déjà traitées par l'utilisateur ne
  // sont jamais écrasées.
  function sweep() {
    var chain = Promise.resolve();
    urls.forEach(function (url, i) {
      var s = document.querySelector("#item-" + i + " [data-state]");
      if (s) s.innerHTML = '<span class="sk" aria-hidden="true"></span>';
      chain = chain.then(function () {
        var li = document.getElementById("item-" + i);
        if (li && (li.classList.contains("done") || li.classList.contains("failed"))) return;
        return probe(url).then(function (status) {
          var li2 = document.getElementById("item-" + i);
          if (li2 && (li2.classList.contains("done") || li2.classList.contains("failed"))) return;
          if (status === 410 || status === 404) { setState(i, EXPIRED_MSG, "fail"); }
          else if (status === 0) { setState(i, "— non vérifié", "neutral"); }
          else { setState(i, "✓ prêt", "ok"); }
        });
      });
    });
  }
  sweep();

  var running = false;
  allBtn.addEventListener("click", function () {
    if (running) return;
    running = true;
    allBtn.disabled = true;
    var text = allBtn.textContent;
    allBtn.innerHTML = '<span class="spin" aria-hidden="true"></span>Téléchargements en cours…';
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
