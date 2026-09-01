/**
 * Escapes HTML so user/AI content can never inject markup into the simulator.
 * Must run BEFORE applying WhatsApp-style formatting markers.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formats a single line of WhatsApp-style markup (*bold*, _italic_, `code`)
 * into safe HTML. Input is escaped first, so any raw HTML in the message is
 * rendered as plain text.
 */
export function formatMessageLine(line: string): string {
  let formatted = escapeHtml(line);
  // Bold replacements
  formatted = formatted.replace(/\*(.*?)\*/g, "<strong>$1</strong>");
  // Italic replacements
  formatted = formatted.replace(/_(.*?)_/g, "<em>$1</em>");
  // Monospace replacements
  formatted = formatted.replace(/`(.*?)`/g, "<code class='bg-black/40 text-amber-300 border border-white/10 px-1 py-0.5 rounded text-[10px] font-mono'>$1</code>");
  return formatted;
}

export interface UsageParam {
  name: string;
  required: boolean;
}

export function parseUsageAndParams(usage: string, cmdName: string, prefix: string): {
  cleanUsage: string;
  parameters: UsageParam[];
  example: string;
} {
  let cleanUsage = usage;
  if (!usage.startsWith(prefix) && !usage.startsWith(".")) {
    cleanUsage = `${prefix}${usage}`;
  } else if (usage.startsWith(".")) {
    cleanUsage = `${prefix}${usage.slice(1)}`;
  }

  const paramRegex = /([<\\[])([^>\\]]+)([>\\]])/g;
  const parameters: UsageParam[] = [];
  let match;
  while ((match = paramRegex.exec(usage)) !== null) {
    parameters.push({
      name: match[2],
      required: match[1] === "<",
    });
  }

  let example = cleanUsage;
  if (cmdName === "download") {
    example = `${prefix}download https://www.instagram.com/p/C_m68D7xv6Y/`;
  } else if (cmdName === "ai") {
    example = `${prefix}ai what is the speed of light?`;
  } else if (cmdName === "image") {
    example = `${prefix}image a futuristic city on Mars`;
  } else if (cmdName === "weather") {
    example = `${prefix}weather Paris`;
  } else if (cmdName === "calc") {
    example = `${prefix}calc 25 * 4 + 10`;
  } else if (cmdName === "define") {
    example = `${prefix}define serendipity`;
  } else if (cmdName === "joke") {
    example = `${prefix}joke`;
  } else if (cmdName === "ping") {
    example = `${prefix}ping`;
  } else if (cmdName === "menu") {
    example = `${prefix}menu`;
  } else if (cmdName === "owner") {
    example = `${prefix}owner`;
  } else if (cmdName === "quote") {
    example = `${prefix}quote`;
  } else if (cmdName === "roast") {
    example = `${prefix}roast @user`;
  } else if (cmdName === "rps") {
    example = `${prefix}rps rock`;
  } else if (cmdName === "trivia") {
    example = `${prefix}trivia`;
  } else if (cmdName === "truth") {
    example = `${prefix}truth`;
  } else if (cmdName === "dare") {
    example = `${prefix}dare`;
  } else if (cmdName === "waifu") {
    example = `${prefix}waifu`;
  } else if (cmdName === "hidetag") {
    example = `${prefix}hidetag Hello everyone!`;
  } else if (cmdName === "antilink") {
    example = `${prefix}antilink on`;
  } else if (cmdName === "antitag") {
    example = `${prefix}antitag on`;
  } else if (cmdName === "help") {
    example = `${prefix}help download`;
  } else {
    let genericEx = cleanUsage;
    parameters.forEach((param) => {
      const placeholder = param.required ? `<${param.name}>` : `[${param.name}]`;
      const sample = param.name.toLowerCase().includes("url")
        ? "https://example.com"
        : param.name.toLowerCase().includes("name") || param.name.toLowerCase().includes("user")
        ? "Alice"
        : "test";
      genericEx = genericEx.replace(placeholder, sample);
    });
    example = genericEx;
  }

  return { cleanUsage, parameters, example };
}
