/**
 * Update Command - Fetch latest code via ZIP (Owner Only)
 * Preserves runtime/state dirs: node_modules, session, tmp, temp, database, config.js
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../../config');

const MAX_REDIRECTS = 5;

// ---------------------------------------------------------------------------
// Supply-chain hardening (H2/C2): the owner-only self-update path can rewrite
// the entire codebase, so it must ALSO be SSRF-safe. Downloads are restricted
// to public code-hosting hosts, private/literal IPs and local hosts are
// rejected, and every redirect hop is re-validated. A kill switch disables the
// feature entirely unless NEBULA_ALLOW_SELF_UPDATE=1.
// ---------------------------------------------------------------------------
const SELF_UPDATE_ENABLED = process.env.NEBULA_ALLOW_SELF_UPDATE === '1';

const CODE_HOST_SUFFIXES = [
  'github.com', 'raw.githubusercontent.com', 'codeload.github.com',
  'objects.githubusercontent.com', 'githubusercontent.com', 'gitlab.com',
  'bitbucket.org', 'codeberg.org'
];

function isUpdaterHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) return false; // literal IPv4
  if (h.includes(':')) return false;                     // literal IPv6
  return CODE_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith('.' + suffix));
}

function assertUpdaterUrl(rawUrl) {
  if (!SELF_UPDATE_ENABLED) {
    throw new Error('Self-update is disabled. Set NEBULA_ALLOW_SELF_UPDATE=1 on the server to enable it.');
  }
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('Invalid update URL.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Update URL must be http(s).');
  if (!isUpdaterHost(url.hostname)) throw new Error('Update URL host is not on the allowed code-hosting allowlist.');
  return url.toString();
}

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message || '').toString()));
      resolve((stdout || '').toString());
    });
  });
}

async function extractZip(zipPath, outDir) {
  if (process.platform === 'win32') {
    const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir.replace(/\\\\/g, '/')}' -Force"`;
    await run(cmd);
    return;
  }
  // Try unzip, then 7z, then busybox unzip
  try {
    await run('command -v unzip');
    await run(`unzip -o '${zipPath}' -d '${outDir}'`);
    return;
  } catch {}
  try {
    await run('command -v 7z');
    await run(`7z x -y '${zipPath}' -o'${outDir}'`);
    return;
  } catch {}
  try {
    await run('busybox unzip -h');
    await run(`busybox unzip -o '${zipPath}' -d '${outDir}'`);
    return;
  } catch {}
  throw new Error('No unzip tool found (unzip/7z/busybox). Please install one or use a panel with unzip support.');
}

function downloadFile(url, dest, visited = new Set()) {
  return new Promise((resolve, reject) => {
    try {
      if (visited.has(url) || visited.size > MAX_REDIRECTS) {
        return reject(new Error('Too many redirects'));
      }
      visited.add(url);
      assertUpdaterUrl(url);

      const client = url.startsWith('https://') ? https : http;
      const req = client.get(url, {
        headers: {
          'User-Agent': 'KnightBot-Updater/1.0',
          'Accept': '*/*'
        }
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) return reject(new Error(`HTTP ${res.statusCode} without Location`));
          const nextUrl = new URL(location, url).toString();
          assertUpdaterUrl(nextUrl); // re-validate every redirect hop
          res.resume();
          return downloadFile(nextUrl, dest, visited).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', err => {
          try { file.close(() => {}); } catch {}
          fs.unlink(dest, () => reject(err));
        });
      });
      req.on('error', err => {
        fs.unlink(dest, () => reject(err));
      });
    } catch (e) {
      reject(e);
    }
  });
}

function copyRecursive(src, dest, ignore = [], relative = '', outList = []) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (ignore.includes(entry)) continue;
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    const stat = fs.lstatSync(s);
    if (stat.isDirectory()) {
      copyRecursive(s, d, ignore, path.join(relative, entry), outList);
    } else {
      fs.copyFileSync(s, d);
      if (outList) outList.push(path.join(relative, entry).replace(/\\\\/g, '/'));
    }
  }
}

async function updateViaZip(zipUrl) {
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, 'update.zip');
  const extractTo = path.join(tmpDir, 'update_extract');

  await downloadFile(zipUrl, zipPath);

  if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true, force: true });
  await extractZip(zipPath, extractTo);

  const entries = fs.readdirSync(extractTo);
  const rootCandidate = entries.length === 1 ? path.join(extractTo, entries[0]) : extractTo;
  const srcRoot = fs.existsSync(rootCandidate) && fs.lstatSync(rootCandidate).isDirectory() ? rootCandidate : extractTo;

  const ignore = [
    'node_modules',
    '.git',
    'session',
    'tmp',
    'temp',
    'database',
    'config.js'
  ];
  const copied = [];
  copyRecursive(srcRoot, process.cwd(), ignore, '', copied);

  try { fs.rmSync(extractTo, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(zipPath, { force: true }); } catch {}

  return { copiedFiles: copied };
}

module.exports = {
  name: 'update',
  aliases: ['upgrade'],
  category: 'owner',
  description: 'Update bot from configured ZIP URL (Owner Only)',
  usage: '.update [optional_zip_url]',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const chatId = msg.key.remoteJid;
    const zipUrl = (args[0] || config.updateZipUrl || process.env.UPDATE_ZIP_URL || '').trim();

    if (!zipUrl) {
      return extra.reply('❌ No update URL configured. Set updateZipUrl in config.js or pass a URL: `.update <zip_url>`');
    }

    if (!SELF_UPDATE_ENABLED) {
      return extra.reply('🛡️ Self-update is disabled on this server. Set `NEBULA_ALLOW_SELF_UPDATE=1` to enable it.');
    }

    try {
      assertUpdaterUrl(zipUrl); // fail on private/local/LAN/odd hosts before touching disk
      await extra.reply('🔄 Updating the bot, please wait…');

      const { copiedFiles } = await updateViaZip(zipUrl);

      const summary = copiedFiles.length
        ? `✅ Update complete. Files updated: ${copiedFiles.length}`
        : '✅ Update complete. No files needed updating.';

      await sock.sendMessage(chatId, { text: `${summary}\nRestarting…` }, { quoted: msg });

      // Attempt restart via pm2 if available, else exit to allow panel auto-restart
      try {
        await run('pm2 restart all');
        return;
      } catch {}

      setTimeout(() => process.exit(0), 500);
    } catch (error) {
      console.error('Update failed:', error);
      await sock.sendMessage(chatId, { text: `❌ Update failed:\n${String(error.message || error)}` }, { quoted: msg });
    }
  }
};

