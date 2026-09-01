import { useState } from "react";
import { QrCode, Terminal, Copy, Check, Smartphone } from "lucide-react";
import DotGridPanel from "./DotGridPanel";
import CodeLine, { Token } from "./CodeLine";

interface GetStartedSectionProps {
  onGoToConnect: () => void;
  onGoToSimulator: () => void;
  botStatus: string;
  prefix: string;
  botName: string;
}

const jsExampleTokens: Token[][] = [
  [
    { text: "import", className: "text-fuchsia-400" },
    { text: " { makeWASocket } ", className: "text-zinc-200" },
    { text: "from", className: "text-fuchsia-400" },
    { text: ' "@whiskeysockets/baileys"', className: "text-emerald-400" },
    { text: ";", className: "text-zinc-200" },
  ],
  [],
  [
    { text: "const", className: "text-fuchsia-400" },
    { text: " sock = ", className: "text-zinc-200" },
    { text: "makeWASocket", className: "text-sky-400" },
    { text: "({", className: "text-zinc-200" },
  ],
  [
    { text: "  auth", className: "text-zinc-200" },
    { text: ": ", className: "text-zinc-200" },
    { text: "state", className: "text-amber-400" },
    { text: ",", className: "text-zinc-200" },
  ],
  [
    { text: "  printQRInTerminal", className: "text-zinc-200" },
    { text: ": ", className: "text-zinc-200" },
    { text: "false", className: "text-amber-400" },
    { text: ",", className: "text-zinc-200" },
  ],
  [
    { text: "  browser", className: "text-zinc-200" },
    { text: ": [", className: "text-zinc-200" },
    { text: '"Ubuntu"', className: "text-emerald-400" },
    { text: ", ", className: "text-zinc-200" },
    { text: '"Chrome"', className: "text-emerald-400" },
    { text: ", ", className: "text-zinc-200" },
    { text: '"20.0.04"', className: "text-emerald-400" },
    { text: "],", className: "text-zinc-200" },
  ],
  [{ text: "});", className: "text-zinc-200" }],
  [],
  [
    { text: "// Request 8-Digit Pairing Code", className: "text-zinc-500 italic" },
  ],
  [
    { text: "const", className: "text-fuchsia-400" },
    { text: " code = ", className: "text-zinc-200" },
    { text: "await", className: "text-fuchsia-400" },
    { text: " sock.", className: "text-zinc-200" },
    { text: "requestPairingCode", className: "text-sky-400" },
    { text: "(", className: "text-zinc-200" },
    { text: '"1234567890"', className: "text-emerald-400" },
    { text: ");", className: "text-zinc-200" },
  ],
  [
    { text: "console", className: "text-zinc-200" },
    { text: ".log(", className: "text-zinc-200" },
    { text: '`Pairing Code: ${code}`', className: "text-emerald-400" },
    { text: ");", className: "text-zinc-200" },
  ],
];

const botCommandTokens: Token[][] = [
  [
    { text: "// WhatsApp Message Handler", className: "text-zinc-500 italic" },
  ],
  [
    { text: "sock", className: "text-zinc-200" },
    { text: ".ev.on(", className: "text-zinc-200" },
    { text: '"messages.upsert"', className: "text-emerald-400" },
    { text: ", ", className: "text-zinc-200" },
    { text: "async", className: "text-fuchsia-400" },
    { text: " ({ messages }) => {", className: "text-zinc-200" },
  ],
  [
    { text: "  const", className: "text-fuchsia-400" },
    { text: " msg = messages[0];", className: "text-zinc-200" },
  ],
  [
    { text: "  if", className: "text-fuchsia-400" },
    { text: " (msg.text ===", className: "text-zinc-200" },
    { text: ' ".ai Explain Quantum Computing"', className: "text-emerald-400" },
    { text: ") {", className: "text-zinc-200" },
  ],
  [
    { text: "    const", className: "text-fuchsia-400" },
    { text: " reply = ", className: "text-zinc-200" },
    { text: "await", className: "text-fuchsia-400" },
    { text: " gemini.", className: "text-zinc-200" },
    { text: "generateContent", className: "text-sky-400" },
    { text: "(msg.text);", className: "text-zinc-200" },
  ],
  [
    { text: "    await", className: "text-fuchsia-400" },
    { text: " sock.", className: "text-zinc-200" },
    { text: "sendMessage", className: "text-sky-400" },
    { text: "(msg.key.remoteJid, { text: reply });", className: "text-zinc-200" },
  ],
  [
    { text: "  }", className: "text-zinc-200" },
  ],
  [{ text: "});", className: "text-zinc-200" }],
];

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-xs font-bold text-amber-400">
      {n}
    </span>
  );
}

export default function GetStartedSection({
  onGoToConnect,
  onGoToSimulator,
  botStatus,
  prefix,
  botName,
}: GetStartedSectionProps) {
  const [activeCodeSnippet, setActiveCodeSnippet] = useState<"pairing" | "handler">("pairing");
  const [copied, setCopied] = useState(false);

  const copySnippet = () => {
    const text =
      activeCodeSnippet === "pairing"
        ? `import { makeWASocket } from "@whiskeysockets/baileys";\nconst sock = makeWASocket({ auth: state, printQRInTerminal: false });\nconst code = await sock.requestPairingCode("1234567890");\nconsole.log(\`Pairing Code: \${code}\`);`
        : `sock.ev.on("messages.upsert", async ({ messages }) => {\n  const msg = messages[0];\n  if (msg.text === ".ai Explain Quantum Computing") {\n    const reply = await gemini.generateContent(msg.text);\n    await sock.sendMessage(msg.key.remoteJid, { text: reply });\n  }\n});`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tokens = activeCodeSnippet === "pairing" ? jsExampleTokens : botCommandTokens;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white tracking-tight">
            Let's get started with {botName}
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Connect your WhatsApp number, customize AI automation, and monitor live command streams.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={onGoToConnect}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs sm:text-sm font-bold text-black hover:bg-amber-400 transition cursor-pointer shadow-lg shadow-amber-500/10"
          >
            <Smartphone size={15} className="fill-black" />
            Link Device
          </button>
        </div>
      </div>

      {/* Main 2-Step DotGridPanel from reference template */}
      <DotGridPanel className="rounded-2xl">
        <div className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-2 md:divide-x md:divide-white/10">
          {/* Step 1 */}
          <div className="md:pr-8">
            <div className="mb-3 flex items-center gap-3">
              <StepBadge n={1} />
              <h2 className="text-base sm:text-lg font-semibold text-white">
                Authenticate WhatsApp Account
              </h2>
            </div>
            <p className="mb-4 text-xs sm:text-sm leading-relaxed text-zinc-400">
              Link your WhatsApp using the new <strong className="text-zinc-200">8-Digit Pairing Code</strong> or scan the high-resolution QR code directly from your phone.
            </p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
              <button
                onClick={onGoToConnect}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs sm:text-sm font-bold text-black hover:bg-amber-400 transition cursor-pointer"
              >
                <QrCode size={14} />
                {botStatus === "connected" ? "Manage WhatsApp Link" : "Open Pairing & QR"}
              </button>
              {botStatus === "connected" && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Authenticated & Online
                </span>
              )}
            </div>
          </div>

          {/* Step 2 */}
          <div className="md:pl-8">
            <div className="mb-3 flex items-center gap-3">
              <StepBadge n={2} />
              <h2 className="text-base sm:text-lg font-semibold text-white">
                Test in Live Simulator
              </h2>
            </div>
            <p className="mb-3 text-xs sm:text-sm leading-relaxed text-zinc-400">
              Send test commands like <code className="font-mono text-amber-400 bg-white/5 px-1.5 py-0.5 rounded">{prefix}ai</code>, <code className="font-mono text-amber-400 bg-white/5 px-1.5 py-0.5 rounded">{prefix}menu</code>, or <code className="font-mono text-amber-400 bg-white/5 px-1.5 py-0.5 rounded">{prefix}ping</code> in the simulated WhatsApp phone sandbox.
            </p>
            <div className="flex w-full sm:w-auto">
              <button
                onClick={onGoToSimulator}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs sm:text-sm font-semibold text-zinc-200 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <Terminal size={14} />
                Launch Bot Simulator
              </button>
            </div>
          </div>
        </div>
      </DotGridPanel>

      {/* Step 3: Interactive Code Line Sandbox Viewer from reference */}
      <div className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <StepBadge n={3} />
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">
                Under the Hood: Engine Architecture
              </h2>
              <p className="text-xs text-zinc-400">
                Inspect how Baileys Multi-Device socket connects and handles automated messages.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
            <div className="inline-flex rounded-xl bg-white/5 p-1 border border-white/5 flex-1 sm:flex-initial justify-center">
              <button
                onClick={() => setActiveCodeSnippet("pairing")}
                className={`flex-1 sm:flex-initial text-center rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeCodeSnippet === "pairing"
                    ? "bg-white text-black font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Pairing Handshake
              </button>
              <button
                onClick={() => setActiveCodeSnippet("handler")}
                className={`flex-1 sm:flex-initial text-center rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeCodeSnippet === "handler"
                    ? "bg-white text-black font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                AI Message Handler
              </button>
            </div>

            <button
              onClick={copySnippet}
              className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition cursor-pointer shrink-0"
              title="Copy code snippet"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Monospace CodeLine display */}
        <div className="overflow-x-auto rounded-xl bg-black border border-white/5 py-4 font-mono text-xs sm:text-sm">
          {tokens.map((line, idx) => (
            <CodeLine key={idx} number={idx + 1} tokens={line} />
          ))}
        </div>
      </div>
    </div>
  );
}
