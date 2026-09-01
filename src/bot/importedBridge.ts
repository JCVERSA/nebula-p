import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { BotCommand } from "./types.js";
import { decideBridgeAcl } from "./bridgeAcl.js";

// Works in both ESM (tsx/dev) and the CJS production bundle: the bundled
// server is CJS where `import.meta.url` is empty, so fall back to __filename.
const require = createRequire(
  typeof __filename !== "undefined" ? __filename : import.meta.url
);

export interface BridgeLoadSummary {
  loaded: number;
  skipped: number;
  skippedFiles: string[];
}

let bridgeSummary: BridgeLoadSummary = { loaded: 0, skipped: 0, skippedFiles: [] };

/** M12: surface vendor breakage loudly instead of silently vanishing commands. */
export function getBridgeLoadSummary(): BridgeLoadSummary {
  return { ...bridgeSummary, skippedFiles: [...bridgeSummary.skippedFiles] };
}

export function loadImportedCommands(): BotCommand[] {
  if (process.env.NEBULA_ENABLE_LEGACY !== "true") {
    console.log("[Bridge] Legacy CJS commands are quarantined and disabled by default (NEBULA_ENABLE_LEGACY !== 'true').");
    return [];
  }

  const commandsList: BotCommand[] = [];
  const skippedFiles: string[] = [];
  const baseDir = path.join(process.cwd(), "src/bot/imported/commands");
  
  if (!fs.existsSync(baseDir)) {
    console.log("[Bridge] Imported commands directory not found.");
    return [];
  }

  // "owner" included and ACL-gated: every owner/* command declares
  // ownerOnly and the bridge (bridgeAcl) enforces it centrally, so any
  // contact running them gets a hard Access Denied.
  const subdirs = ["admin", "anime", "fun", "general", "media", "owner", "textmaker", "user", "utility"];
  
  for (const subdir of subdirs) {
    const dirPath = path.join(baseDir, subdir);
    if (!fs.existsSync(dirPath)) continue;
    
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith(".js")) continue;
      
      const filePath = path.join(dirPath, file);
      try {
        const rawCmd = require(filePath);
        if (rawCmd && typeof rawCmd === "object" && rawCmd.name) {
          // Wrap into our BotCommand structure
          const bridgedCommand: BotCommand = {
            name: rawCmd.name,
            aliases: rawCmd.aliases || [],
            category: rawCmd.category || subdir,
            description: rawCmd.description || "Imported Command",
            usage: rawCmd.usage || `.${rawCmd.name}`,
            execute: async (sock, msg, context) => {
              const from = msg.key.remoteJid || "";
              const isGroup = from.endsWith("@g.us");
              
              let groupMetadata = null;
              let isBotAdmin = false;
              
              if (isGroup && sock && typeof sock.groupMetadata === "function") {
                try {
                  groupMetadata = await sock.groupMetadata(from);
                  const botId = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
                  const participant = groupMetadata?.participants?.find((p: any) => p.id === botId);
                  isBotAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
                } catch (e) {
                  // silent
                }
              }

              // Create formatted reply wrapper that acts exactly like Baileys sendMessage
              const replyWrapper = async (text: string, mediaUrl?: string) => {
                if (mediaUrl) {
                  return await context.reply(text, mediaUrl);
                } else {
                  return await context.reply(text);
                }
              };

              const extra = {
                from,
                sender: context.sender,
                pushName: context.senderName || "User",
                isGroup,
                groupMetadata,
                isOwner: context.isOwner,
                isAdmin: context.isAdmin,
                isBotAdmin,
                isMod: context.isOwner,
                reply: replyWrapper,
                react: async (emoji: string) => {
                  return await context.react(emoji);
                },
                formatter: {
                  bold: (t: string) => `*${t}*`,
                  italic: (t: string) => `_${t}_`,
                  monospace: (t: string) => `\`\`\`${t}\`\`\``
                }
              };

              // Centralized access control: the vendored corpus declares its
              // privileges via metadata but never checks them — the bridge is
              // the single enforcement point (fail-closed, see bridgeAcl.ts).
              const acl = decideBridgeAcl(
                {
                  name: rawCmd.name,
                  ownerOnly: rawCmd.ownerOnly,
                  adminOnly: rawCmd.adminOnly,
                  groupOnly: rawCmd.groupOnly,
                  privateOnly: rawCmd.privateOnly,
                  botAdminNeeded: rawCmd.botAdminNeeded,
                },
                {
                  isOwner: context.isOwner,
                  isAdmin: context.isAdmin,
                  isGroup,
                  isBotAdmin,
                }
              );
              if (!acl.allowed) {
                return extra.reply(`❌ *Access Denied:* ${acl.reason}`);
              }

              // Execute original CJS handler with standard argument passing
              await rawCmd.execute(sock, msg, context.args, extra);
            }
          };
          commandsList.push(bridgedCommand);
        }
      } catch (err: any) {
        // Some commands might have unresolved compilation requirements at initialization,
        // we log them cleanly to prevent crashing the whole app.
        console.warn(`[Bridge] Gracefully skipped loading command '${file}' from '${subdir}':`, err.message);
        skippedFiles.push(`${subdir}/${file}`);
      }
    }
  }

  bridgeSummary = { loaded: commandsList.length, skipped: skippedFiles.length, skippedFiles };
  console.log(`[Bridge] Successfully adapted ${commandsList.length} imported commands.`);
  if (skippedFiles.length > 0) {
    console.warn(
      `[Bridge] ⚠️ ${skippedFiles.length} vendored commands could not be loaded (missing native deps, e.g. whatsapp-rust-bridge). ` +
      `Install the deps or remove those files; the menu deliberately omits them: ${skippedFiles.slice(0, 8).join(", ")}${skippedFiles.length > 8 ? "…" : ""}`
    );
  }
  return commandsList;
}
