import { useState, useEffect, useRef, FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bot,
  MessageSquare,
  Terminal,
  BarChart3,
  ScrollText,
  Settings,
  Zap,
  RefreshCw,
  Sparkles,
  Save,
  Trash2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Globe,
  Check,
  Play,
  Mic,
  Search,
  X,
  BookOpen,
  HelpCircle,
  Copy,
  KeyRound,
  Send,
  Code2,
  QrCode,
  Activity,
  Wifi,
  WifiOff,
  FileDown,
  Cpu,
  Smartphone,
  ArrowRight,
  ExternalLink,
  RotateCcw,
  Shield,
  ShieldAlert,
  Users,
  Package,
  Volume2,
  Radio,
} from "lucide-react";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend
} from "recharts";

import { BotConfig, BotCommand, ChatMessage, ConnectionStatus, CheckupReport } from "./lib/types";
import { formatMessageLine, parseUsageAndParams } from "./lib/format";
import Sidebar, { NavTab } from "./components/Sidebar";
import Topbar from "./components/Topbar";
import ChatBubble from "./components/ChatBubble";
import GetStartedSection from "./components/GetStartedSection";
import CheckupModal from "./components/CheckupModal";
import MobileDock from "./components/MobileDock";
import MobileDrawer from "./components/MobileDrawer";
import SpeedLoader from "./components/SpeedLoader";
import MinecraftTorch from "./components/MinecraftTorch";
import AnimatedFace from "./components/AnimatedFace";
import Tooltip from "./components/Tooltip";
import Loader from "./components/Loader";
import Switch from "./components/Switch";
import { BrowserIdentitySelector } from "./components/BrowserIdentitySelector";
import { BatchDownloadStatus } from "./components/BatchDownloadStatus";
import AccessControlPanel from "./components/AccessControlPanel";
import SecurityExtras from "./components/SecurityExtras";
import SpotlightCard from "./components/SpotlightCard";
import ShinyText from "./components/ShinyText";
import HeroChip from "./components/HeroChip";
import HeroKbd from "./components/HeroKbd";
import HeroSnippet from "./components/HeroSnippet";
import HeroUser from "./components/HeroUser";
import SystemDiagnostics from "./components/SystemDiagnostics";

type TabId = NavTab;

const PIE_COLORS = ["#f59e0b", "#38bdf8", "#10b981", "#a855f7", "#ec4899", "#6366f1", "#64748b"];

const CATEGORY_LIST = ["All", "Core", "Media", "Moderation", "AI", "Entertainment", "Utility", "Owner"] as const;

const COUNTRY_PRESETS = [
  { code: "+1", label: "🇺🇸 USA / Canada (+1)" },
  { code: "+44", label: "🇬🇧 United Kingdom (+44)" },
  { code: "+62", label: "🇮🇩 Indonesia (+62)" },
  { code: "+234", label: "🇳🇬 Nigeria (+234)" },
  { code: "+91", label: "🇮🇳 India (+91)" },
  { code: "+92", label: "🇵🇰 Pakistan (+92)" },
  { code: "+55", label: "🇧🇷 Brazil (+55)" },
  { code: "+254", label: "🇰🇪 Kenya (+254)" },
  { code: "+27", label: "🇿🇦 South Africa (+27)" },
  { code: "+63", label: "🇵🇭 Philippines (+63)" },
  { code: "+233", label: "🇬🇭 Ghana (+233)" },
  { code: "+33", label: "🇫🇷 France (+33)" },
  { code: "+49", label: "🇩🇪 Germany (+49)" },
  { code: "+34", label: "🇪🇸 Spain (+34)" },
  { code: "+966", label: "🇸🇦 Saudi Arabia (+966)" },
  { code: "+971", label: "🇦🇪 UAE (+971)" },
  { code: "+880", label: "🇧🇩 Bangladesh (+880)" },
  { code: "+20", label: "🇪🇬 Egypt (+20)" },
  { code: "+212", label: "🇲🇦 Morocco (+212)" },
  { code: "", label: "🌐 Direct International (+)" },
];

const VALID_STATUSES: ConnectionStatus[] = ["disconnected", "connecting", "qr_ready", "pairing_code_ready", "connected", "error"];

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <SpotlightCard spotlightColor="rgba(245, 158, 11, 0.15)" className="h-full">
      <div className="p-5 flex flex-col justify-between h-full">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/10 shrink-0">
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-4">
          <p className="text-2xl font-black text-white tracking-tight">{value}</p>
          {sub && <p className="text-[11px] text-zinc-500 mt-1 truncate">{sub}</p>}
        </div>
      </div>
    </SpotlightCard>
  );
}

function Card({ title, icon: Icon, action, children, className = "" }: { title?: string; icon?: any; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#0e0e11] rounded-2xl border border-white/5 shadow-xl hover:shadow-2xl/10 transition-all duration-300 ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon className="w-4 h-4 text-amber-400" />}
            <h3 className="font-bold text-white text-sm tracking-wide uppercase">{title}</h3>
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}


export default function App() {
  // ------------------------------------------------------------------ state
  const bgContainerRef = useRef<HTMLDivElement>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickTerminalOpen, setQuickTerminalOpen] = useState(false);
  const [isStartingBot, setIsStartingBot] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [cmdSubView, setCmdSubView] = useState<"editor" | "reference">("editor");

  // Global dark mode (defaults to true for reference dark aesthetic)
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [apiLocked, setApiLocked] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeLogFilters, setActiveLogFilters] = useState<string[]>(["Errors", "System", "Cognitive", "Sandbox"]);
  const [qrReceivedAt, setQrReceivedAt] = useState<number | null>(null);
  const [qrTimeLeft, setQrTimeLeft] = useState<number>(50);
  const [commands, setCommands] = useState<BotCommand[]>([]);
  const [cmdCategoryFilter, setCmdCategoryFilter] = useState<string>("All");
  const [cmdSearchQuery, setCmdSearchQuery] = useState<string>("");
  const [config, setConfig] = useState<BotConfig>({
    botName: "Nebula Bot",
    prefix: ".",
    botImage: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80",
    ownerNumber: "",
    newsletterUrl: "https://whatsapp.com/channel/0029VaNebulaChannel",
    newsletterName: "Nebula Bot Official News",
    browserPlatform: "Ubuntu",
    browserName: "Chrome",
    browserVersion: "22.04.4",
  });

  const [analyticsStats, setAnalyticsStats] = useState<Record<string, number>>({});

  // Safety & Autonomous Engine Switches
  const [autoRead, setAutoRead] = useState(true);
  const [simulateTyping, setSimulateTyping] = useState(true);
  const [antiLink, setAntiLink] = useState(true);
  const [autonomousAi, setAutonomousAi] = useState(true);
  const [publicMode, setPublicMode] = useState(true);

  // Liquid glass visual state controls
  const [adaptiveMorphing, setAdaptiveMorphing] = useState(() => {
    const saved = localStorage.getItem("adaptive-morphing");
    return saved !== "false";
  });
  const [blurIntensity, setBlurIntensity] = useState(() => {
    const saved = localStorage.getItem("backdrop-blur-intensity");
    return saved ? parseFloat(saved) : 1.0;
  });
  const [animationDuration, setAnimationDuration] = useState(() => {
    const saved = localStorage.getItem("blob-animation-duration");
    return saved ? parseFloat(saved) : 16;
  });
  const [motionSensitivity, setMotionSensitivity] = useState(() => {
    const saved = localStorage.getItem("motion-sensitivity");
    return saved !== "false";
  });

  const [blobStyles, setBlobStyles] = useState([
    { borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%", transform: "translate(0px, 0px) scale(1)" },
    { borderRadius: "50% 50% 30% 70% / 50% 60% 40% 60%", transform: "translate(0px, 0px) scale(1)" },
    { borderRadius: "60% 40% 50% 50% / 40% 40% 60% 60%", transform: "translate(0px, 0px) scale(1)" },
  ]);

  useEffect(() => {
    document.documentElement.style.setProperty("--backdrop-blur-intensity", blurIntensity.toString());
    localStorage.setItem("backdrop-blur-intensity", blurIntensity.toString());
  }, [blurIntensity]);

  useEffect(() => {
    document.documentElement.style.setProperty("--blob-animation-duration", `${animationDuration}s`);
    localStorage.setItem("blob-animation-duration", animationDuration.toString());
  }, [animationDuration]);

  useEffect(() => {
    localStorage.setItem("motion-sensitivity", motionSensitivity.toString());
  }, [motionSensitivity]);

  // Mouse & Scroll velocity based organic scale feedback loop
  useEffect(() => {
    if (!motionSensitivity) {
      if (bgContainerRef.current) {
        bgContainerRef.current.style.transform = "scale(1)";
      }
      return;
    }

    let lastX = 0;
    let lastY = 0;
    let lastTime = Date.now();
    let targetScale = 1;
    let currentScale = 1;
    let animationFrameId: number;

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const speed = distance / dt;
        // Map mouse movement speed smoothly into scale up to 1.15
        targetScale = 1 + Math.min(speed * 0.04, 0.15);
      }
      lastX = e.clientX;
      lastY = e.clientY;
      lastTime = now;
    };

    let lastScrollTop = window.scrollY || document.documentElement.scrollTop;
    const handleScroll = () => {
      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) {
        const currentScroll = window.scrollY || document.documentElement.scrollTop;
        const dy = Math.abs(currentScroll - lastScrollTop);
        const speed = dy / dt;
        // Map scrolling speed smoothly up to 1.2
        targetScale = 1 + Math.min(speed * 0.06, 0.2);
        lastScrollTop = currentScroll;
      }
      lastTime = now;
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });

    const updatePhysics = () => {
      // Natural fluid deceleration (spring pull back to rest scale of 1.0)
      targetScale += (1 - targetScale) * 0.04;
      // Exponential dynamic lerping for absolute silk smoothness
      currentScale += (targetScale - currentScale) * 0.08;
      if (bgContainerRef.current) {
        bgContainerRef.current.style.transform = `scale(${currentScale.toFixed(4)})`;
      }
      animationFrameId = requestAnimationFrame(updatePhysics);
    };

    animationFrameId = requestAnimationFrame(updatePhysics);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(animationFrameId);
    };
  }, [motionSensitivity]);

  useEffect(() => {
    if (!adaptiveMorphing) return;

    const generateRandomBlobStyle = () => {
      const rand = (min = 25, max = 75) => Math.floor(Math.random() * (max - min)) + min;
      const radius = `${rand()}% ${rand()}% ${rand()}% ${rand()}% / ${rand()}% ${rand()}% ${rand()}% ${rand()}%`;
      const tx = rand(-60, 60);
      const ty = rand(-60, 60);
      const scale = (rand(85, 125) / 100).toFixed(2);
      return {
        borderRadius: radius,
        transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      };
    };

    setBlobStyles([
      generateRandomBlobStyle(),
      generateRandomBlobStyle(),
      generateRandomBlobStyle(),
    ]);

    const interval = setInterval(() => {
      setBlobStyles([
        generateRandomBlobStyle(),
        generateRandomBlobStyle(),
        generateRandomBlobStyle(),
      ]);
    }, 15000);

    return () => clearInterval(interval);
  }, [adaptiveMorphing]);

  useEffect(() => {
    localStorage.setItem("adaptive-morphing", adaptiveMorphing.toString());
  }, [adaptiveMorphing]);

  // Audio transcription
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptionText, setTranscriptionText] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Voice conversation
  const [voiceInput, setVoiceInput] = useState("");
  const [voiceReplyText, setVoiceReplyText] = useState("");
  const [isVoiceResponding, setIsVoiceResponding] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const audioTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Command editor
  const [selectedCommand, setSelectedCommand] = useState<BotCommand | null>(null);
  const [commandCode, setCommandCode] = useState<string>("");
  const [isSavingCode, setIsSavingCode] = useState(false);
  const [editorMessage, setEditorMessage] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // AI builder
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiCmdName, setAiCmdName] = useState("");
  const [aiCmdCategory, setAiCmdCategory] = useState("Utility");
  const [aiCmdDesc, setAiCmdDesc] = useState("");
  const [isGeneratingCommand, setIsGeneratingCommand] = useState(false);
  const [aiGenMessage, setAiGenMessage] = useState("");

  // Simulator
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "bot",
      senderName: "Nebula Bot",
      text: "👋 Welcome to the *Nebula Bot* Control Simulator!\n\nI am fully active. Try typing `.menu` or `.ping` below to test my command routing live in your browser!",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Connection Method & Pairing Code State
  const [connMethod, setConnMethod] = useState<"pair_code" | "qr">("pair_code");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCountryPrefix, setPairingCountryPrefix] = useState("+1");
  const [pairingCode, setPairingCode] = useState<string>("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null);
  const [pairingTimeLeft, setPairingTimeLeft] = useState<number>(120);
  const [isGeneratingPairCode, setIsGeneratingPairCode] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingCopied, setPairingCopied] = useState(false);

  // Settings
  const [formConfig, setFormConfig] = useState<BotConfig>({ ...config });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);
  const [isClearingAuth, setIsClearingAuth] = useState(false);
  const [resetStage, setResetStage] = useState<"idle" | "stopping" | "purging" | "starting" | "done" | "error">("idle");
  const [resetFeedback, setResetFeedback] = useState<{
    type: "success" | "error" | "info";
    title: string;
    message: string;
    filesRemoved?: number;
    timestamp: string;
  } | null>(null);

  // Secrets
  const [secretStatus, setSecretStatus] = useState<{ configured: boolean; masked: string | null } | null>(null);
  const [secretValue, setSecretValue] = useState("");
  const [isSavingSecret, setIsSavingSecret] = useState(false);
  const [secretMessage, setSecretMessage] = useState("");

  const [ownerSecretStatus, setOwnerSecretStatus] = useState<{ configured: boolean; masked: string | null } | null>(null);
  const [nimSecretStatus, setNimSecretStatus] = useState<{ configured: boolean; masked: string | null } | null>(null);
  const [nimSecretValue, setNimSecretValue] = useState("");
  const [isSavingNimSecret, setIsSavingNimSecret] = useState(false);
  const [nimSecretMessage, setNimSecretMessage] = useState("");
  const [ownerSecretValue, setOwnerSecretValue] = useState("");
  const [isSavingOwnerSecret, setIsSavingOwnerSecret] = useState(false);
  const [ownerSecretMessage, setOwnerSecretMessage] = useState("");

  // System & Commands Checkup
  const [isCheckupOpen, setIsCheckupOpen] = useState(false);
  const [checkupReport, setCheckupReport] = useState<CheckupReport | null>(null);
  const [isCheckupLoading, setIsCheckupLoading] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  const runCheckup = async () => {
    setIsCheckupLoading(true);
    setIsCheckupOpen(true);
    try {
      const res = await apiFetch("/api/bot/checkup");
      if (res && res.ok) {
        const data = await res.json();
        setCheckupReport(data);
      }
    } catch (e) {
      console.error("Checkup failed:", e);
    } finally {
      setIsCheckupLoading(false);
    }
  };

  // Docs
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [docSelectedCategory, setDocSelectedCategory] = useState("All");
  const [copiedCommandName, setCopiedCommandName] = useState<string | null>(null);

  // Gemini AI Playground & Models
  const [geminiModel, setGeminiModel] = useState<string>("gemini-3.7-flash");
  const [geminiTemperature, setGeminiTemperature] = useState<number>(0.7);
  const [geminiSystemPrompt, setGeminiSystemPrompt] = useState<string>(
    "You are Nebula Bot, an ultra-fast, witty, and helpful AI assistant for WhatsApp. Keep answers concise, formatting nicely with markdown."
  );
  const [geminiPlaygroundPrompt, setGeminiPlaygroundPrompt] = useState<string>("Write a quick WhatsApp status update about coding late at night.");
  const [geminiPlaygroundOutput, setGeminiPlaygroundOutput] = useState<string>("");
  const [isTestingGemini, setIsTestingGemini] = useState<boolean>(false);

  // Plugins Matrix
  const [pluginFilter, setPluginFilter] = useState<string>("All");
  const [pluginStates, setPluginStates] = useState<Record<string, boolean>>({
    "baileys-core": true,
    "gemini-ai": true,
    "media-downloader": true,
    "sticker-maker": true,
    "group-guard": true,
    "voice-synthesis": true,
    "anti-spam": true,
    "crypto-ticker": true,
  });

  // Group Tools
  const [welcomeEnabled, setWelcomeEnabled] = useState<boolean>(true);
  const [welcomeMessage, setWelcomeMessage] = useState<string>("👋 Welcome @user to our community! Make sure to read group guidelines.");
  const [farewellEnabled, setFarewellEnabled] = useState<boolean>(true);
  const [farewellMessage, setFarewellMessage] = useState<string>("👋 Goodbye @user, thanks for being part of the group!");
  const [broadcastText, setBroadcastText] = useState<string>("");
  const [isBroadcasting, setIsBroadcasting] = useState<boolean>(false);
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [adminOnlyCmds, setAdminOnlyCmds] = useState<boolean>(false);

  // Security & Antilink
  const [rateLimitMax, setRateLimitMax] = useState<number>(12);
  const [blockLinkInvites, setBlockLinkInvites] = useState<boolean>(true);
  const [autoKickSpammers, setAutoKickSpammers] = useState<boolean>(false);
  const [blacklistInput, setBlacklistInput] = useState<string>("");
  const [blacklistedNumbers, setBlacklistedNumbers] = useState<string[]>([
    "+15550192834",
    "+2348012345678",
  ]);

  // Project ZIP as text (for environments where file downloads are blocked)
  const [zipB64, setZipB64] = useState<string>("");
  const [zipB64Loading, setZipB64Loading] = useState(false);
  const [zipB64Copied, setZipB64Copied] = useState(false);
  const zipB64Ref = useRef<HTMLTextAreaElement | null>(null);

  const loadZipAsBase64 = async () => {
    setZipB64Loading(true);
    try {
      const res = await fetch("/nebula-bot-latest.zip");
      if (!res.ok) throw new Error("Archive not available");
      const buf = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      setZipB64(btoa(binary));
    } catch (e: any) {
      setZipB64(`ERROR: ${e.message || e}`);
    } finally {
      setZipB64Loading(false);
    }
  };

  const copyZipB64 = async () => {
    const text = zipB64Ref.current?.value ?? zipB64;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setZipB64Copied(true);
    } catch {
      zipB64Ref.current?.select();
      document.execCommand("copy");
      setZipB64Copied(true);
    }
    setTimeout(() => setZipB64Copied(false), 2000);
  };

  // ------------------------------------------------------------- data fetch
  const [isSyncingSession, setIsSyncingSession] = useState(false);

  /** Checks whether an active panel session exists and unlocks the UI. */
  const checkAuth = async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        const ok = !!data?.authenticated;
        setIsAuthenticated(ok);
        setApiLocked(!ok);
        return ok;
      }
    } catch (err) {
      console.error("Failed to check panel session:", err);
    }
    setIsAuthenticated(false);
    setApiLocked(true);
    return false;
  };

  const login = async (token: string) => {
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setIsAuthenticated(true);
        setApiLocked(false);
        return true;
      }
      const data = await res.json().catch(() => null);
      setLoginError(data?.error || "Login failed. Check the access key and try again.");
    } catch (err) {
      setLoginError("Network error during login. Please retry.");
    } finally {
      setIsLoggingIn(false);
    }
    return false;
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {}
    setIsAuthenticated(false);
    setApiLocked(true);
  };

  const reSyncSession = async () => {
    setIsSyncingSession(true);
    const ok = await checkAuth();
    if (ok) {
      // Re-trigger global diagnostic updates
      fetchConfig();
      fetchCommands();
      fetchStatus();
      fetchAnalytics();
      fetchSecretStatus();
    }
    setTimeout(() => setIsSyncingSession(false), 800);
  };

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only query protected endpoints once a real session exists.
    if (!isAuthenticated) return;
    fetchConfig();
    fetchCommands();
    fetchStatus();
    fetchAnalytics();
    fetchSecretStatus();

    const interval = setInterval(() => {
      fetchStatus();
      fetchAnalytics();
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (!qrReceivedAt || status !== "qr_ready") {
      setQrTimeLeft(50);
      return;
    }

    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - qrReceivedAt) / 1000);
      const remaining = 50 - elapsed;
      if (remaining <= -5) {
        clearInterval(timer);
        retryConnection();
      } else {
        setQrTimeLeft(remaining);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [qrReceivedAt, status]);

  // Pairing code expiration countdown timer
  useEffect(() => {
    if (!pairingExpiresAt || !pairingCode) {
      setPairingTimeLeft(120);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((pairingExpiresAt - Date.now()) / 1000));
      setPairingTimeLeft(remaining);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [pairingExpiresAt, pairingCode]);

  /** Central fetch wrapper: uses the HttpOnly session cookie; 401 → locked UI. */
  const apiFetch = async (url: string, init?: RequestInit): Promise<Response | null> => {
    try {
      let res = await fetch(url, {
        ...init,
        credentials: "same-origin",
      });

      // Session expired or missing: flip the whole UI to the login screen.
      if (res.status === 401) {
        setApiLocked(true);
        setIsAuthenticated(false);
        return res;
      }
      if (res.ok) {
        setApiLocked(false);
      }
      return res;
    } catch (err) {
      console.error(`[API Access] Network failure requesting ${url}:`, err);
      return null;
    }
  };

  const fetchAnalytics = async () => {
    const res = await apiFetch("/api/bot/analytics");
    if (!res || !res.ok) return;
    try {
      const data = await res.json();
      if (data && typeof data.stats === "object" && data.stats !== null) {
        setAnalyticsStats(data.stats);
      }
    } catch (e) {}
  };

  const fetchConfig = async () => {
    const res = await apiFetch("/api/bot/config");
    if (!res || !res.ok) return;
    try {
      const data = await res.json();
      if (data && typeof data === "object" && typeof data.botName === "string") {
        setConfig(data);
        setFormConfig(data);
      }
    } catch (e) {}
  };

  const fetchCommands = async () => {
    const res = await apiFetch("/api/bot/commands");
    if (!res || !res.ok) return;
    try {
      const data = await res.json();
      if (Array.isArray(data)) setCommands(data);
    } catch (e) {}
  };

  const fetchStatus = async () => {
    const res = await apiFetch("/api/bot/status");
    if (!res || !res.ok) return;
    try {
      const data = await res.json();
      // Defensive: never let an unexpected payload poison the UI state
      if (data && VALID_STATUSES.includes(data.status)) setStatus(data.status);
      if (data && Array.isArray(data.logs)) setLogs(data.logs);

      if (data?.pairingCode) {
        setPairingCode(data.pairingCode);
        if (data.pairingExpiresAt) {
          setPairingExpiresAt(data.pairingExpiresAt);
        }
      }

      if (data?.status === "connected") {
        setPairingCode("");
        setPairingExpiresAt(null);
        setIsGeneratingPairCode(false);
      }

      if (data?.status === "qr_ready") {
        const qrRes = await fetch("/api/bot/qr");
        if (qrRes.ok) {
          const qrData = await qrRes.json();
          if (qrData && qrData.qrUrl) {
            setQrUrl(qrData.qrUrl);
            setQrReceivedAt((prev) => prev || Date.now());
          }
        }
      } else {
        setQrUrl(null);
        setQrReceivedAt(null);
      }
    } catch (e) {}
  };

  const fetchSecretStatus = async () => {
    try {
      const res = await fetch("/api/bot/secrets");
      if (!res.ok) return;
      const data = await res.json();
      const gemini = Array.isArray(data?.secrets)
        ? data.secrets.find((s: { name: string }) => s.name === "GEMINI_API_KEY")
        : null;
      setSecretStatus(gemini || null);

      const ownerSecret = Array.isArray(data?.secrets)
        ? data.secrets.find((s: { name: string }) => s.name === "OWNER_NUMBER")
        : null;
      setOwnerSecretStatus(ownerSecret || null);

      const nimSecret = Array.isArray(data?.secrets)
        ? data.secrets.find((s: { name: string }) => s.name === "NVIDIA_NIM_API_KEY")
        : null;
      setNimSecretStatus(nimSecret || null);
    } catch (e) {}
  };

  // ------------------------------------------------------------- bot actions
  const startBot = async () => {
    setIsStartingBot(true);
    try {
      await fetch("/api/bot/start", { method: "POST" });
      await fetchStatus();
    } catch (e) {
    } finally {
      setIsStartingBot(false);
    }
  };

  const stopBot = async () => {
    try {
      await fetch("/api/bot/stop", { method: "POST" });
      setPairingCode("");
      setPairingExpiresAt(null);
      fetchStatus();
    } catch (e) {}
  };

  const normalizePhoneNumber = (rawInput: string, countryPrefix: string): string => {
    let cleaned = rawInput.trim().replace(/[\s\-\(\)\.]/g, "");
    if (cleaned.startsWith("+")) return cleaned.slice(1);
    if (cleaned.startsWith("00")) return cleaned.slice(2);
    const cleanPrefix = countryPrefix.replace(/[^0-9]/g, "");
    if (cleanPrefix) {
      if (cleaned.startsWith(cleanPrefix)) return cleaned;
      if (cleaned.startsWith("0")) cleaned = cleaned.replace(/^0+/, "");
      return `${cleanPrefix}${cleaned}`;
    }
    return cleaned.replace(/^0+/, "");
  };

  const generatePairCode = async () => {
    const rawNumber = pairingPhone.trim();
    if (!rawNumber) {
      setPairingError("Please enter your WhatsApp phone number.");
      return;
    }
    const cleanDigits = normalizePhoneNumber(rawNumber, pairingCountryPrefix);
    if (cleanDigits.length < 8 || cleanDigits.length > 16) {
      setPairingError("Please enter a valid international WhatsApp number (8–16 digits including country code).");
      return;
    }

    setPairingError(null);
    setIsGeneratingPairCode(true);
    setPairingCode("");
    addSystemLog(`📱 Requesting 8-digit Pairing Code for +${cleanDigits}...`);

    try {
      const res = await fetch("/api/bot/pair-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: cleanDigits }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate pairing code.");
      }

      if (data.code) {
        setPairingCode(data.code);
        setPairingExpiresAt(data.expiresAt || (Date.now() + 120000));
        addSystemLog(`✨ Pairing Code received: ${data.code}`);
      }
      await fetchStatus();
    } catch (err: any) {
      console.error(err);
      setPairingError(err.message || "Failed to generate pairing code. Please check your phone number and try again.");
      addSystemLog(`❌ Pairing code error: ${err.message || err}`);
    } finally {
      setIsGeneratingPairCode(false);
    }
  };

  const copyPairingCode = () => {
    if (!pairingCode) return;
    const cleanCode = pairingCode.replace(/[^a-zA-Z0-9]/g, "");
    navigator.clipboard.writeText(cleanCode).then(() => {
      setPairingCopied(true);
      setTimeout(() => setPairingCopied(false), 2200);
    }).catch(() => {
      setPairingCopied(true);
      setTimeout(() => setPairingCopied(false), 2200);
    });
  };

  const clearBotLogs = async () => {
    try {
      await fetch("/api/bot/clear-logs", { method: "POST" });
      fetchStatus();
    } catch (e) {}
  };

  const retryConnection = async () => {
    setIsRetrying(true);
    addSystemLog("🔌 Retrying QR Code Connection...");
    setQrReceivedAt(Date.now());
    setQrTimeLeft(50);
    try {
      await fetch("/api/bot/stop", { method: "POST" });
      await new Promise((resolve) => setTimeout(resolve, 800));
      await fetch("/api/bot/start", { method: "POST" });
      await fetchStatus();
    } catch (e) {
      console.error(e);
    } finally {
      setIsRetrying(false);
    }
  };

  const clearAuthAndRetryConnection = async () => {
    setIsClearingAuth(true);
    setResetStage("stopping");
    setResetFeedback({
      type: "info",
      title: "Stopping Active Socket...",
      message: "Terminating Baileys socket connection and releasing session file handles on 'nebula_auth_info'.",
      timestamp: new Date().toLocaleTimeString(),
    });
    addSystemLog("🔌 Stopping live bot socket & releasing file locks on 'nebula_auth_info'...");
    setQrReceivedAt(Date.now());
    setQrTimeLeft(50);
    setPairingCode("");
    setPairingExpiresAt(null);

    try {
      setResetStage("purging");
      setResetFeedback({
        type: "info",
        title: "Purging Session Cache...",
        message: "Clearing directory 'nebula_auth_info' to eliminate corrupted or expired key files.",
        timestamp: new Date().toLocaleTimeString(),
      });

      const res = await fetch("/api/bot/retry", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        const count = typeof data.filesRemoved === "number" ? data.filesRemoved : 0;
        setResetStage("done");
        setReconnectCount((c) => c + 1);
        setResetFeedback({
          type: "success",
          title: "Session Reset Successful",
          message: `Purged ${count} key file${count === 1 ? "" : "s"} from 'nebula_auth_info'. Fresh Baileys handshake initiated.`,
          filesRemoved: count,
          timestamp: new Date().toLocaleTimeString(),
        });
        addSystemLog(`✨ Session cache cleared (${count} auth files removed). Fresh Baileys handshake initialized.`);
      } else {
        const errorText = data.error || (res.status !== 200 ? `HTTP ${res.status}: Failed to reset session` : "Unknown error");
        setResetStage("error");
        setResetFeedback({
          type: "error",
          title: "Failed to Reset Session",
          message: errorText,
          timestamp: new Date().toLocaleTimeString(),
        });
        addSystemLog(`❌ Session Reset Error: ${errorText}`);
      }
      await fetchStatus();
    } catch (e: any) {
      console.error("Session reset failed:", e);
      const errorMsg = e?.message || String(e);
      setResetStage("error");
      setResetFeedback({
        type: "error",
        title: "Session Reset Network Error",
        message: errorMsg,
        timestamp: new Date().toLocaleTimeString(),
      });
      addSystemLog(`❌ Network error while resetting session: ${errorMsg}`);
    } finally {
      setIsClearingAuth(false);
    }
  };


  const addSystemLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${msg}`, ...prev]);
  };

  const testGeminiPlayground = async () => {
    if (!geminiPlaygroundPrompt.trim()) return;
    setIsTestingGemini(true);
    setGeminiPlaygroundOutput("");
    addSystemLog(`🤖 Asking Gemini (${geminiModel}): "${geminiPlaygroundPrompt.slice(0, 40)}..."`);
    try {
      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `.ai ${geminiPlaygroundPrompt.trim()}`,
          sender: "Playground-Tester",
        }),
      });
      const data = await res.json();
      setGeminiPlaygroundOutput(data.reply || data.error || "No response received");
      addSystemLog("🤖 Gemini generated response successfully.");
    } catch (err: any) {
      setGeminiPlaygroundOutput(`Error: ${err.message || "Failed to reach Gemini"}`);
      addSystemLog(`❌ Gemini error: ${err.message || err}`);
    } finally {
      setIsTestingGemini(false);
    }
  };

  const sendGroupBroadcast = async () => {
    if (!broadcastText.trim()) return;
    setIsBroadcasting(true);
    setBroadcastStatus(null);
    addSystemLog(`📢 Dispatching broadcast message: "${broadcastText.slice(0, 30)}..."`);
    try {
      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `.broadcast ${broadcastText.trim()}`,
          sender: "Admin-Broadcaster",
        }),
      });
      const data = await res.json();
      setBroadcastStatus(data.reply || "✅ Broadcast successfully queued and dispatched to active group chats!");
      setBroadcastText("");
      addSystemLog("✅ Broadcast sent to all groups.");
    } catch (err: any) {
      setBroadcastStatus(`❌ Broadcast failed: ${err.message || "Network error"}`);
    } finally {
      setIsBroadcasting(false);
    }
  };

  const addBlacklistNumber = () => {
    const trimmed = blacklistInput.trim();
    if (!trimmed) return;
    if (!blacklistedNumbers.includes(trimmed)) {
      setBlacklistedNumbers([...blacklistedNumbers, trimmed]);
      addSystemLog(`🛡️ Added ${trimmed} to the security blacklist.`);
    }
    setBlacklistInput("");
  };

  const removeBlacklistNumber = (num: string) => {
    setBlacklistedNumbers(blacklistedNumbers.filter((n) => n !== num));
    addSystemLog(`🛡️ Removed ${num} from the security blacklist.`);
  };

  // ------------------------------------------------------------- settings
  const saveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigMessage("");
    try {
      const res = await fetch("/api/bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formConfig),
      });
      const data = await res.json();
      if (!res.ok) {
        setConfigMessage(`❌ ${data.error || `Failed (${res.status})`}`);
        return;
      }
      setConfig(data);
      setFormConfig(data);
      setConfigMessage("✅ Configuration saved and persisted.");
      addSystemLog("SYSTEM: Config updated successfully.");
    } catch (e) {
      setConfigMessage("❌ Could not reach the server.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const saveSecret = async () => {
    if (!secretValue.trim()) return;
    setIsSavingSecret(true);
    setSecretMessage("");
    try {
      const res = await fetch("/api/bot/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "GEMINI_API_KEY", value: secretValue }),
      });
      const data = await res.json();
      if (res.ok) {
        setSecretValue("");
        setSecretMessage(
          data.fileSaved
            ? "✅ Secret saved to the .env file and applied to the running bot."
            : "✅ Secret applied to the running bot (this deployment does not allow writing .env)."
        );
        addSystemLog("🔑 GEMINI_API_KEY updated from panel.");
        fetchSecretStatus();
      } else {
        setSecretMessage(`❌ ${data.error || "Failed to save secret."}`);
      }
    } catch (e) {
      setSecretMessage("❌ Could not reach the server to save the secret.");
    } finally {
      setIsSavingSecret(false);
    }
  };

  const clearSecret = async () => {
    setIsSavingSecret(true);
    setSecretMessage("");
    try {
      const res = await fetch("/api/bot/secrets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "GEMINI_API_KEY" }),
      });
      const data = await res.json();
      if (res.ok) {
        setSecretValue("");
        setSecretMessage("✅ Secret removed. AI features are now disabled until a new key is added.");
        addSystemLog("🔑 GEMINI_API_KEY removed from panel.");
        fetchSecretStatus();
      } else {
        setSecretMessage(`❌ ${data.error || "Failed to remove secret."}`);
      }
    } catch (e) {
      setSecretMessage("❌ Could not reach the server to remove the secret.");
    } finally {
      setIsSavingSecret(false);
    }
  };

  const saveNimSecret = async () => {
    if (!nimSecretValue.trim()) return;
    setIsSavingNimSecret(true);
    setNimSecretMessage("");
    try {
      const res = await fetch("/api/bot/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "NVIDIA_NIM_API_KEY", value: nimSecretValue }),
      });
      const data = await res.json();
      if (res.ok) {
        setNimSecretValue("");
        setNimSecretMessage(
          data.fileSaved
            ? "✅ NVIDIA key saved to the .env file and applied to the running bot."
            : "✅ NVIDIA key applied to the running bot (this deployment does not allow writing .env)."
        );
        addSystemLog("🔑 NVIDIA_NIM_API_KEY updated from panel.");
        fetchSecretStatus();
      } else {
        setNimSecretMessage(`❌ ${data.error || "Failed to save secret."}`);
      }
    } catch (e) {
      setNimSecretMessage("❌ Could not reach the server to save the secret.");
    } finally {
      setIsSavingNimSecret(false);
    }
  };

  const clearNimSecret = async () => {
    setIsSavingNimSecret(true);
    setNimSecretMessage("");
    try {
      const res = await fetch("/api/bot/secrets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "NVIDIA_NIM_API_KEY" }),
      });
      const data = await res.json();
      if (res.ok) {
        setNimSecretValue("");
        setNimSecretMessage("✅ NVIDIA key removed. The AI fallback is disabled; Gemini keeps working.");
        addSystemLog("🔑 NVIDIA_NIM_API_KEY removed from panel.");
        fetchSecretStatus();
      } else {
        setNimSecretMessage(`❌ ${data.error || "Failed to remove secret."}`);
      }
    } catch (e) {
      setNimSecretMessage("❌ Could not reach the server to remove the secret.");
    } finally {
      setIsSavingNimSecret(false);
    }
  };

  const saveOwnerSecret = async () => {
    if (!ownerSecretValue.trim()) return;
    setIsSavingOwnerSecret(true);
    setOwnerSecretMessage("");
    try {
      const res = await fetch("/api/bot/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "OWNER_NUMBER", value: ownerSecretValue }),
      });
      const data = await res.json();
      if (res.ok) {
        setOwnerSecretValue("");
        setOwnerSecretMessage(
          data.fileSaved
            ? "✅ Owner number saved to the .env file and applied immediately."
            : "✅ Owner number applied immediately (this deployment does not allow writing .env)."
        );
        addSystemLog("🔑 OWNER_NUMBER updated from panel.");
        fetchSecretStatus();
      } else {
        setOwnerSecretMessage(`❌ ${data.error || "Failed to save secret."}`);
      }
    } catch (e) {
      setOwnerSecretMessage("❌ Could not reach the server to save the secret.");
    } finally {
      setIsSavingOwnerSecret(false);
    }
  };

  const clearOwnerSecret = async () => {
    setIsSavingOwnerSecret(true);
    setOwnerSecretMessage("");
    try {
      const res = await fetch("/api/bot/secrets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "OWNER_NUMBER" }),
      });
      const data = await res.json();
      if (res.ok) {
        setOwnerSecretValue("");
        setOwnerSecretMessage("✅ Owner number removed.");
        addSystemLog("🔑 OWNER_NUMBER removed from panel.");
        fetchSecretStatus();
      } else {
        setOwnerSecretMessage(`❌ ${data.error || "Failed to remove secret."}`);
      }
    } catch (e) {
      setOwnerSecretMessage("❌ Could not reach the server to remove the secret.");
    } finally {
      setIsSavingOwnerSecret(false);
    }
  };

  // ------------------------------------------------------------- commands
  const loadCommandCode = async (cmd: BotCommand) => {
    try {
      setSelectedCommand(cmd);
      setCommandCode("// Loading command code...");
      setEditorMessage("");
      setValidationError(null);
      const res = await fetch(`/api/bot/commands/${cmd.name}`);
      const data = await res.json();
      setCommandCode(data.code || "");
    } catch (e) {}
  };

  const validateCommandCode = (code: string): string | null => {
    // 1. Check for basic syntax: matching braces, brackets, and parentheses
    const stack: string[] = [];
    const pairs: Record<string, string> = { '}': '{', ']': '[', ')': '(' };
    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      if (['{', '[', '('].includes(char)) {
        stack.push(char);
      } else if (['}', ']', ')'].includes(char)) {
        if (stack.length === 0 || stack[stack.length - 1] !== pairs[char]) {
          return `Syntax Error: Unmatched closing character '${char}' at index ${i}. Check your brackets/braces structure.`;
        }
        stack.pop();
      }
    }
    if (stack.length > 0) {
      return `Syntax Error: Unclosed opening character '${stack[stack.length - 1]}'. Ensure all brackets are balanced.`;
    }

    // 2. Check for the required 'execute' function
    const hasExecute = code.includes("execute") && 
      (code.includes("function") || code.includes("=>") || code.includes("execute(") || code.includes("execute:"));
    if (!hasExecute) {
      return "Validation Error: The command code must contain the required 'execute' function/method (e.g., 'async execute' or 'execute: async').";
    }

    // 3. Check for correct imports
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("import ") && !line.includes("from ")) {
        return `Syntax Error: Invalid import statement at line ${i + 1}. Import statements must contain 'from'.`;
      }
    }

    return null; // Passed
  };

  const saveCommandCode = async () => {
    if (!selectedCommand) return;
    
    // Pre-save validation
    const valError = validateCommandCode(commandCode);
    if (valError) {
      setValidationError(valError);
      setEditorMessage("");
      addSystemLog(`VALIDATION FAILED: ${selectedCommand.name} contains syntax or logical errors: ${valError}`);
      return;
    }

    setValidationError(null);
    setIsSavingCode(true);
    setEditorMessage("");
    try {
      const res = await fetch("/api/bot/commands/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: selectedCommand.name, code: commandCode }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditorMessage(`✅ ${data.message || "Command saved."}`);
        addSystemLog(`SUCCESS: ${data.message || `Command ${selectedCommand.name} saved.`}`);
        fetchCommands();
      } else {
        setEditorMessage(`❌ ${data.error || "Failed to save command."}`);
        addSystemLog(`ERROR: ${data.error || "Failed to save command."}`);
      }
    } catch (e) {
      setEditorMessage("❌ Could not reach the server to save the command.");
    } finally {
      setIsSavingCode(false);
    }
  };

  const generateAICommand = async (e: FormEvent) => {
    e.preventDefault();
    if (!aiPrompt || !aiCmdName) return;
    setIsGeneratingCommand(true);
    setAiGenMessage("🧬 Nebula AI is synthesizing the code...");
    try {
      const res = await fetch("/api/bot/commands/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: aiPrompt,
          commandName: aiCmdName,
          category: aiCmdCategory,
          description: aiCmdDesc,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiGenMessage(`✅ ${data.message || `Command ${aiCmdName} created and hot-loaded!`}`);
        setAiPrompt("");
        setAiCmdName("");
        setAiCmdDesc("");
        fetchCommands();
      } else {
        setAiGenMessage(`❌ ${data.error || "Generation failed"}`);
      }
    } catch (e: any) {
      setAiGenMessage(`❌ ${e.message}`);
    } finally {
      setIsGeneratingCommand(false);
    }
  };

  // ------------------------------------------------------------- simulator
  const simulateCommandFromDoc = async (cmdText: string) => {
    if (isSimulating) return;
    setActiveTab("simulator");
    const userMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: "user",
      senderName: "Owner",
      text: cmdText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsSimulating(true);

    try {
      const res = await fetch("/api/bot/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderName: "Owner", text: cmdText }),
      });
      const data = await res.json();
      // Introduce an artificial typing simulation delay to show typing indicator
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const botReply: ChatMessage = {
        id: Math.random().toString(),
        sender: "bot",
        senderName: config.botName,
        text: data.text || `🤖 Commands start with prefix \`${config.prefix}\`. Type \`${config.prefix}menu\` for services!`,
        imageUrl: data.imageUrl,
        emoji: data.emoji,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, botReply]);
    } catch (e) {
      setChatMessages((prev) => [...prev, {
        id: Math.random().toString(),
        sender: "bot",
        senderName: config.botName,
        text: "❌ *Error contacting bot simulator engine.* Is the server running?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setIsSimulating(false);
    }
  };

  const sendQuickMessage = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: "user",
      senderName: "Owner",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsSimulating(true);

    try {
      const res = await fetch("/api/bot/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderName: "Owner", text }),
      });
      const data = await res.json();
      await new Promise((resolve) => setTimeout(resolve, 800));
      const botReply: ChatMessage = {
        id: Math.random().toString(),
        sender: "bot",
        senderName: config.botName,
        text: data.text || `🤖 Commands start with prefix \`${config.prefix}\`. Type \`${config.prefix}menu\` for services!`,
        imageUrl: data.imageUrl,
        emoji: data.emoji,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, botReply]);
    } catch (e) {
      setChatMessages((prev) => [...prev, {
        id: Math.random().toString(),
        sender: "bot",
        senderName: config.botName,
        text: "❌ *Error contacting bot simulator engine.* Is the server running?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    const userMsgText = inputValue;
    const userMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: "user",
      senderName: "Owner",
      text: userMsgText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsSimulating(true);

    try {
      const res = await fetch("/api/bot/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderName: "Owner", text: userMsgText }),
      });
      const data = await res.json();
      // Introduce an artificial typing simulation delay to show typing indicator
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const botReply: ChatMessage = {
        id: Math.random().toString(),
        sender: "bot",
        senderName: config.botName,
        text: data.text || `🤖 Commands start with prefix \`${config.prefix}\`. Type \`${config.prefix}menu\` for services!`,
        imageUrl: data.imageUrl,
        emoji: data.emoji,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, botReply]);
    } catch (e) {
      setChatMessages((prev) => [...prev, {
        id: Math.random().toString(),
        sender: "bot",
        senderName: config.botName,
        text: "❌ *Error contacting bot simulator engine.* Is the server running?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleSendVoiceNote = async () => {
    if (isSimulating) return;
    const voiceMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: "user",
      senderName: "Owner",
      text: "🎙️ Voice note (0:07)",
      isAudio: true,
      audioDuration: "0:07",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, voiceMsg]);
    setIsSimulating(true);

    try {
      const res = await fetch("/api/bot/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderName: "Owner", text: "🎙️ [Voice Note]" }),
      });
      const data = await res.json();
      // Introduce an artificial typing simulation delay to show typing indicator
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const botReply: ChatMessage = {
        id: Math.random().toString(),
        sender: "bot",
        senderName: config.botName,
        text: data.text || "🤖 Thank you for the voice note!",
        imageUrl: data.imageUrl,
        emoji: data.emoji,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, botReply]);
    } catch (e) {
      setChatMessages((prev) => [...prev, {
        id: Math.random().toString(),
        sender: "bot",
        senderName: config.botName,
        text: "❌ *Error contacting bot simulator engine.* Is the server running?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setIsSimulating(false);
    }
  };

  // ------------------------------------------------------------- audio
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const startRecording = async () => {
    setTranscriptionText("");
    setRecordingSeconds(0);
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setIsTranscribing(true);
        try {
          const base64Audio = await blobToBase64(audioBlob);
          const response = await fetch("/api/gemini/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64Audio, mimeType: "audio/webm" }),
          });
          const result = await response.json();
          if (result.transcript) setTranscriptionText(result.transcript);
          else if (result.error) setTranscriptionText(`⚠️ Error: ${result.error}`);
          else setTranscriptionText("⚠️ Failed to transcribe audio content.");
        } catch (err: any) {
          setTranscriptionText(`❌ Network/Server Error: ${err.message || err}`);
        } finally {
          setIsTranscribing(false);
        }
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      audioTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (audioTimerRef.current) {
        clearInterval(audioTimerRef.current);
        audioTimerRef.current = null;
      }
    }
  };

  const handleVoiceCallConvo = async (textPrompt: string) => {
    if (!textPrompt.trim()) return;
    setIsVoiceResponding(true);
    setVoiceReplyText("");
    setIsPlayingVoice(false);

    try {
      const res = await fetch("/api/gemini/voice-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: textPrompt }),
      });
      const data = await res.json();
      if (data.text) {
        setVoiceReplyText(data.text);
        if (data.audioBase64) {
          const rawAudioUrl = `data:audio/mp3;base64,${data.audioBase64}`;
          setTimeout(() => {
            if (audioPlayerRef.current) {
              audioPlayerRef.current.src = rawAudioUrl;
              audioPlayerRef.current.play()
                .then(() => setIsPlayingVoice(true))
                .catch(() => {});
            }
          }, 200);
        }
      } else if (data.error) {
        setVoiceReplyText(`⚠️ Voice engine error: ${data.error}`);
      }
    } catch (err: any) {
      setVoiceReplyText(`❌ Failed to connect to Voice Engine: ${err.message || err}`);
    } finally {
      setIsVoiceResponding(false);
    }
  };

  const startVoiceRecording = async () => {
    setVoiceInput("");
    setRecordingSeconds(0);
    voiceChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      voiceRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(voiceChunksRef.current, { type: "audio/webm" });
        setIsTranscribing(true);
        try {
          const base64Audio = await blobToBase64(audioBlob);
          const response = await fetch("/api/gemini/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64Audio, mimeType: "audio/webm" }),
          });
          const result = await response.json();
          if (result.transcript) {
            setVoiceInput(result.transcript);
            handleVoiceCallConvo(result.transcript);
          }
        } catch (err: any) {
          console.error("Transcribing voice input failed:", err);
        } finally {
          setIsTranscribing(false);
        }
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsVoiceRecording(true);
      audioTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error(err);
    }
  };

  const stopVoiceRecording = () => {
    if (voiceRecorderRef.current && isVoiceRecording) {
      voiceRecorderRef.current.stop();
      setIsVoiceRecording(false);
      if (audioTimerRef.current) {
        clearInterval(audioTimerRef.current);
        audioTimerRef.current = null;
      }
    }
  };

  // ------------------------------------------------------------- derived
  const filteredMessages = chatMessages.filter((msg) => {
    if (!chatSearchQuery.trim()) return true;
    const query = chatSearchQuery.toLowerCase();
    return (
      msg.text.toLowerCase().includes(query) ||
      (msg.senderName && msg.senderName.toLowerCase().includes(query))
    );
  });

  const totalSimulated = chatMessages.length - 1;

  // ------------------------------------------------------------------ render
  // Session bootstrap / login gate: the panel never touches the API without a
  // server-issued session. The access key is entered only here and is never
  // stored in the browser (sessionStorage/localStorage are not used).
  if (isAuthenticated === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-zinc-100 font-sans">
        <div className="flex flex-col items-center gap-4">
          <SpeedLoader color="#f59e0b" text="Verifying panel session..." />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-zinc-100 font-sans p-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1420] p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h1 className="text-lg font-bold text-white">Nebula Controller — Panel Access</h1>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              Enter the panel access key. It is printed in the server console on startup
              (or set via the <code className="bg-white/10 px-1 rounded font-mono text-amber-300">PANEL_TOKEN</code> environment variable).
              The key is never stored in your browser.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem("accessKey") as HTMLInputElement);
              if (input?.value) login(input.value);
            }}
            className="space-y-3"
          >
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                name="accessKey"
                type="password"
                autoFocus
                placeholder="Panel access key"
                className="w-full rounded-xl bg-white/5 border border-white/10 pl-10 pr-3 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20 transition"
              />
            </div>
            {loginError && (
              <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/40 rounded-lg px-3 py-2">
                {loginError}
              </p>
            )}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-black text-sm font-bold py-3 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoggingIn ? <Loader scale={0.28} className="!gap-0" /> : "Unlock Panel"}
            </button>
          </form>

          <p className="text-[10px] text-zinc-600 text-center mt-6">
            Session cookie is HttpOnly and expires automatically after 12 hours of activity.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#070709] text-zinc-100 font-sans relative" id="app_root">
      {/* Liquid Glass Background Ambient Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-50">
        <div 
          ref={bgContainerRef}
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            pointerEvents: "none",
            zIndex: -50,
            willChange: "transform"
          }}
        >
          <div 
            className={`liquid-blob w-[450px] h-[450px] top-[-10%] left-[-5%] bg-[var(--color-blob-1,#d97706)] ${adaptiveMorphing ? 'liquid-blob-adaptive' : ''}`}
            style={adaptiveMorphing ? {
              borderRadius: blobStyles[0].borderRadius,
              transform: blobStyles[0].transform
            } : undefined}
          />
          <div 
            className={`liquid-blob w-[600px] h-[600px] bottom-[-20%] right-[-10%] bg-[var(--color-blob-2,#ea580c)] ${adaptiveMorphing ? 'liquid-blob-adaptive' : ''}`}
            style={adaptiveMorphing ? {
              borderRadius: blobStyles[1].borderRadius,
              transform: blobStyles[1].transform
            } : undefined}
          />
          <div 
            className={`liquid-blob w-[350px] h-[350px] top-[40%] left-[50%] bg-[var(--color-blob-1,#d97706)] ${adaptiveMorphing ? 'liquid-blob-adaptive' : ''}`}
            style={adaptiveMorphing ? {
              borderRadius: blobStyles[2].borderRadius,
              transform: blobStyles[2].transform
            } : { animationDelay: "-4s", animationDuration: "24s" }}
          />
        </div>
      </div>

      {/* Reference Template Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        botStatus={status}
        reconnectCount={reconnectCount}
      />

      {/* Main Column */}
      <div 
        className="flex min-w-0 flex-1 flex-col bg-black/45 relative z-10 border-l border-white/5"
        style={{ backdropFilter: "blur(calc(var(--backdrop-blur-intensity, 1) * 24px))" }}
      >
        {/* Reference Template Topbar */}
        <Topbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          botStatus={status}
          onResetSession={clearAuthAndRetryConnection}
          isResetting={isClearingAuth}
          onToggleBot={status === "connected" ? stopBot : startBot}
          isStarting={isStartingBot}
          onOpenCheckup={runCheckup}
        />

        {/* API locked banner */}
        {apiLocked && (
          <div className="px-4 py-2.5 bg-rose-950/80 border-b border-rose-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs font-semibold text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 animate-bounce" />
              <span>Panel API access is locked (401). Cookies may have timed out in the iFrame container.</span>
            </p>
            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
              <button
                onClick={reSyncSession}
                disabled={isSyncingSession}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSession ? "animate-spin" : ""}`} />
                {isSyncingSession ? "Re-syncing..." : "Re-sync Session"}
              </button>
              <button
                onClick={logout}
                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded-md text-xs font-bold transition cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}

        {/* Main scrollable body */}
        <main className="flex-1 overflow-y-auto bg-black p-3 sm:p-6 md:p-8 pb-28 md:pb-8 dark-scroll">
          <div className="max-w-6xl mx-auto space-y-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 15, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -15, scale: 0.995 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
              >
                {/* ============================================================ OVERVIEW */}
                {activeTab === "overview" && (
                  <div className="space-y-6 animate-fade-in">
                    {/* Confused / Documentation Guide Banner */}
                    <div className="w-full text-sm leading-relaxed flex flex-col gap-4">
                      <div className="bg-blue-950/20 border-l-4 border-blue-500 rounded-r-xl p-4 backdrop-blur-sm shadow-sm">
                        <div className="flex">
                          <div className="flex-shrink-0">
                            <svg className="h-5 w-5 opacity-90 text-blue-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <div className="ml-3 text-blue-300 font-medium">
                            <p>
                              Confused? So are we, yet you can{" "}
                              <a 
                                className="font-semibold text-blue-400 underline hover:text-blue-300 transition-colors" 
                                href="#docs" 
                                onClick={(e) => { e.preventDefault(); setActiveTab("docs"); }}
                              >
                                click here to pretend you know what you're doing →
                              </a>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Get Started Section from reference template */}
                    <GetStartedSection
                      onGoToConnect={() => setActiveTab("connect")}
                      onGoToSimulator={() => setActiveTab("simulator")}
                      botStatus={status}
                      prefix={config.prefix}
                      botName={config.botName}
                    />

                    {/* Stat cards in high contrast dark grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                      <StatCard
                        icon={status === "connected" ? Wifi : WifiOff}
                        label="Connection"
                        value={status === "connected" ? "Online" : status === "qr_ready" ? "QR Ready" : status === "connecting" ? "Connecting" : "Offline"}
                        sub={status === "connected" ? "WhatsApp session active" : "Session not connected"}
                      />
                      <StatCard
                        icon={Terminal}
                        label="Commands"
                        value={String(commands.length)}
                        sub="Registered & ready"
                      />
                      <StatCard
                        icon={Activity}
                        label="Simulated Messages"
                        value={String(totalSimulated)}
                        sub="In this session"
                      />
                      <StatCard
                        icon={KeyRound}
                        label="Gemini API Key"
                        value={secretStatus?.configured ? "Configured" : "Missing"}
                        sub={secretStatus?.configured && secretStatus.masked ? secretStatus.masked : "Configure in Settings"}
                      />
                    </div>

                    {/* Full System & Commands Checkup Banner */}
                    <div className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
                          <Activity className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white">Full System & Commands Checkup</span>
                            {checkupReport ? (
                              <span
                                className={`rounded-full px-2 py-0.2 text-[10px] font-bold border ${
                                  checkupReport.overallStatus === "healthy"
                                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                    : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                }`}
                              >
                                Score: {checkupReport.healthScore}% ({checkupReport.overallStatus})
                              </span>
                            ) : (
                              <span className="rounded-full bg-white/10 px-2 py-0.2 text-[10px] font-medium text-zinc-300">
                                Ready for Diagnostics
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">
                            Run automated end-to-end verification across {commands.length} registered commands, memory allocation, native codecs, and security sandbox.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={runCheckup}
                        disabled={isCheckupLoading}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-black hover:bg-amber-400 transition cursor-pointer shrink-0 shadow-sm"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isCheckupLoading ? "animate-spin" : ""}`} />
                        <span>{isCheckupLoading ? "Running Checkup..." : "Run Full Checkup"}</span>
                      </button>
                    </div>

                  <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                    {/* Connection panel with QR Code & Pair Code dual methods */}
                    {/* Connection panel with QR Code & Pair Code dual methods */}
                    <Card
                      title="WhatsApp Connection"
                      icon={Activity}
                      action={
                        <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl">
                          <button
                            onClick={() => setConnMethod("pair_code")}
                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                              connMethod === "pair_code"
                                ? "bg-amber-500 text-black font-bold shadow-sm"
                                : "text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            Pairing Code
                          </button>
                          <button
                            onClick={() => setConnMethod("qr")}
                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                              connMethod === "qr"
                                ? "bg-amber-500 text-black font-bold shadow-sm"
                                : "text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            QR Scanner
                          </button>
                        </div>
                      }
                      className="xl:col-span-3"
                    >
                      {/* Reset Feedback Notification Banner */}
                      <AnimatePresence>
                        {(resetFeedback || isClearingAuth) && (
                          <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.98 }}
                            className={`p-3.5 mb-4 rounded-xl border flex items-start justify-between gap-3 text-xs transition-all shadow-sm ${
                              isClearingAuth
                                ? "bg-amber-950/30 border-amber-500/30 text-amber-200"
                                : resetFeedback?.type === "success"
                                ? "bg-emerald-950/40 border-emerald-800/80 text-emerald-200"
                                : resetFeedback?.type === "error"
                                ? "bg-rose-950/40 border-rose-800/80 text-rose-200"
                                : "bg-white/5 border-white/10 text-zinc-200"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 shrink-0">
                                {isClearingAuth ? (
                                  <RotateCcw className="w-4 h-4 animate-spin text-amber-400" />
                                ) : resetFeedback?.type === "success" ? (
                                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 text-rose-400" />
                                )}
                              </div>
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-xs">
                                    {isClearingAuth
                                      ? resetStage === "stopping"
                                        ? "Stopping active WhatsApp socket..."
                                        : resetStage === "purging"
                                        ? "Purging session cache directory ('nebula_auth_info')..."
                                        : "Initializing clean handshake..."
                                      : resetFeedback?.title}
                                  </span>
                                  {resetFeedback?.filesRemoved !== undefined && resetFeedback.filesRemoved > 0 && (
                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-900/80 text-emerald-300">
                                      {resetFeedback.filesRemoved} files purged
                                    </span>
                                  )}
                                  {resetFeedback?.timestamp && (
                                    <span className="text-[10px] text-zinc-500 font-mono">
                                      {resetFeedback.timestamp}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] opacity-90 leading-relaxed text-zinc-300">
                                  {isClearingAuth
                                    ? "Releasing file locks and clearing previous credentials so WhatsApp can issue fresh tokens without conflict."
                                    : resetFeedback?.message}
                                </p>
                              </div>
                            </div>
                            {!isClearingAuth && (
                              <button
                                onClick={() => setResetFeedback(null)}
                                className="p-1 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-zinc-200 transition cursor-pointer shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* CONNECTED STATE (shared between modes) */}
                      {status === "connected" ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between flex-wrap gap-4 p-4 bg-emerald-950/30 border border-emerald-800/60 rounded-xl">
                            <div className="flex items-center gap-4">
                              <div className="p-3 bg-emerald-500 text-black font-bold rounded-xl shadow-sm">
                                <CheckCircle className="w-6 h-6 text-black" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="font-bold text-white text-sm">Nebula Bot is Online & Linked</h4>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-900/80 text-emerald-300 border border-emerald-700/50">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
                                  </span>
                                </div>
                                <p className="text-xs text-zinc-300 mt-1">
                                  Your WhatsApp session is active and listening for incoming messages and commands (Prefix: <code className="font-mono font-bold bg-black/60 text-amber-400 px-1.5 py-0.5 rounded border border-white/10">{config.prefix}</code>).
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={stopBot}
                                className="px-3.5 py-2 bg-rose-500/20 border border-rose-500/40 text-rose-300 hover:bg-rose-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                              >
                                <XCircle className="w-3.5 h-3.5" /> Disconnect
                              </button>
                              <button
                                onClick={clearAuthAndRetryConnection}
                                disabled={isClearingAuth}
                                title="Purges nebula_auth_info directory and reconnects with clean credentials"
                                className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <RotateCcw className={`w-3.5 h-3.5 ${isClearingAuth ? "animate-spin text-amber-400" : ""}`} />
                                {isClearingAuth ? "Resetting Session..." : "Reset Session"}
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                              <span className="text-zinc-500 font-semibold block text-[10px] uppercase">Bot Identity</span>
                              <span className="font-bold text-white mt-0.5 block truncate">{config.botName}</span>
                            </div>
                            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                              <span className="text-zinc-500 font-semibold block text-[10px] uppercase">Direct AI Chat</span>
                              <span className="font-bold text-amber-400 mt-0.5 block">Enabled in 1-on-1</span>
                            </div>
                            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                              <span className="text-zinc-500 font-semibold block text-[10px] uppercase">Owner Number</span>
                              <span className="font-bold text-white mt-0.5 block truncate">{config.ownerNumber || "Not configured"}</span>
                            </div>
                          </div>
                        </div>
                      ) : connMethod === "pair_code" ? (
                        /* ================== PAIRING CODE METHOD ================== */
                        <div className="space-y-5">
                          {pairingCode ? (
                            /* Pairing Code Ready View */
                            <div className="space-y-5">
                              <div className="p-5 bg-white/5 rounded-xl border border-white/10 shadow-sm">
                                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                                      <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                                      WhatsApp 8-Digit Pairing Code
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-lg px-2.5 py-1">
                                      <span className={`w-2 h-2 rounded-full ${pairingTimeLeft > 20 ? "bg-emerald-500 animate-pulse" : "bg-rose-500 animate-ping"}`} />
                                      <span>Expires in <strong className="text-white font-mono">{pairingTimeLeft}s</strong></span>
                                    </div>
                                  </div>
                                </div>

                                {/* Hero Monospace Display */}
                                <div className="my-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                                  <div
                                    onClick={copyPairingCode}
                                    title="Click to copy pairing code"
                                    className="px-6 py-4 bg-black text-amber-400 rounded-xl shadow-inner border border-white/10 flex items-center justify-center gap-4 cursor-pointer hover:border-amber-400/50 transition group select-all"
                                  >
                                    <span className="font-mono text-3xl sm:text-4xl font-extrabold tracking-widest text-amber-400 group-hover:text-amber-300 transition">
                                      {pairingCode}
                                    </span>
                                  </div>
                                  <button
                                    onClick={copyPairingCode}
                                    className={`px-5 py-4 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-sm shrink-0 ${
                                      pairingCopied
                                        ? "bg-emerald-600 text-white"
                                        : "bg-amber-500 hover:bg-amber-400 text-black"
                                    }`}
                                  >
                                    {pairingCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    {pairingCopied ? "Copied!" : "Copy Code"}
                                  </button>
                                </div>

                                <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-white/10">
                                  <button
                                    onClick={generatePairCode}
                                    disabled={isGeneratingPairCode}
                                    className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingPairCode ? "animate-spin text-amber-400" : ""}`} />
                                    {isGeneratingPairCode ? "Regenerating..." : "Regenerate Code"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setPairingCode("");
                                      setPairingExpiresAt(null);
                                    }}
                                    className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 border border-white/10 rounded-xl text-xs font-medium transition cursor-pointer"
                                  >
                                    Change Number
                                  </button>
                                </div>
                              </div>

                              {/* Step-by-Step Instructions */}
                              <div className="p-4 bg-black/40 rounded-xl border border-white/10">
                                <h5 className="font-bold text-zinc-300 text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                  <Smartphone className="w-3.5 h-3.5 text-amber-400" />
                                  How to link on your phone (Quick Steps)
                                </h5>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-lg border border-white/5">
                                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                                    <span className="text-zinc-300 leading-snug">Open <b>WhatsApp</b> on your phone.</span>
                                  </div>
                                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-lg border border-white/5">
                                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                                    <span className="text-zinc-300 leading-snug">Go to <b>Settings</b> or <b>Linked Devices</b>.</span>
                                  </div>
                                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-lg border border-white/5">
                                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                                    <span className="text-zinc-300 leading-snug">Tap <b>Link a Device</b>.</span>
                                  </div>
                                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-lg border border-white/5">
                                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center shrink-0 text-[11px]">4</span>
                                    <span className="text-zinc-300 leading-snug">Tap <b>"Link with phone number instead"</b>.</span>
                                  </div>
                                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-lg border border-white/5 sm:col-span-2">
                                    <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-bold flex items-center justify-center shrink-0 text-[11px]">5</span>
                                    <span className="text-zinc-300 leading-snug">
                                      Enter code: <strong className="font-mono text-amber-400 text-sm bg-black/60 px-2 py-0.5 rounded ml-1 border border-white/10">{pairingCode}</strong>
                                    </span>
                                  </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2 text-[11px] text-zinc-400">
                                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                                  <span>Waiting for confirmation from your phone. Connection will activate automatically!</span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* Pairing Code Input Form */
                            <div className="space-y-4">
                              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                                <div className="flex items-start gap-3">
                                  <div className="p-2.5 bg-amber-500 text-black rounded-lg shadow-sm shrink-0">
                                    <Smartphone className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <h4 className="font-bold text-white text-sm">Connect with WhatsApp Pairing Code</h4>
                                    <p className="text-xs text-zinc-400 mt-1">
                                      No camera needed! Enter your WhatsApp phone number to receive an 8-character pairing code you can enter directly in your WhatsApp app.
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  generatePairCode();
                                }}
                                className="space-y-4"
                              >
                                <div>
                                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                                    WhatsApp Phone Number
                                  </label>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <div className="sm:col-span-1">
                                      <select
                                        value={pairingCountryPrefix}
                                        onChange={(e) => setPairingCountryPrefix(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-black border border-white/10 rounded-xl text-xs font-medium text-white focus:outline-none focus:border-amber-500"
                                      >
                                        {COUNTRY_PRESETS.map((country) => (
                                          <option key={country.label} value={country.code} className="bg-zinc-900 text-white">
                                            {country.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="sm:col-span-2 relative">
                                      <input
                                        type="tel"
                                        value={pairingPhone}
                                        onChange={(e) => setPairingPhone(e.target.value)}
                                        placeholder="e.g. 555 123 4567 or 812 3456 7890"
                                        className="w-full px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-medium"
                                        required
                                      />
                                    </div>
                                  </div>
                                  {pairingPhone.trim() && (
                                    <div className="mt-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center justify-between text-[11px] text-amber-300 font-mono">
                                      <span>Target WhatsApp Number:</span>
                                      <span className="font-bold">+{normalizePhoneNumber(pairingPhone, pairingCountryPrefix)}</span>
                                    </div>
                                  )}
                                  <p className="text-[11px] text-zinc-500 mt-1">
                                    Tip: Country code &amp; leading zeros (e.g. 08... or 07...) are automatically formatted.
                                  </p>
                                </div>

                                {pairingError && (
                                  <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-xl flex items-start gap-2 text-xs text-rose-300">
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                                    <span>{pairingError}</span>
                                  </div>
                                )}

                                {isGeneratingPairCode && (
                                  <div className="p-4 bg-black/60 border border-amber-500/20 rounded-xl flex flex-col items-center justify-center">
                                    <SpeedLoader color="#f59e0b" size="sm" text="Connecting to WhatsApp Baileys Handshake..." />
                                  </div>
                                )}

                                <div className="flex items-center gap-3">
                                  <button
                                    type="submit"
                                    disabled={isGeneratingPairCode}
                                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black font-bold text-xs rounded-xl flex items-center gap-2 transition cursor-pointer shadow-sm"
                                  >
                                    {isGeneratingPairCode ? (
                                      <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Requesting Code...
                                      </>
                                    ) : (
                                      <>
                                        <KeyRound className="w-4 h-4" />
                                        Generate 8-Digit Pairing Code
                                      </>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={clearAuthAndRetryConnection}
                                    disabled={isClearingAuth}
                                    className="px-3.5 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 font-medium text-xs rounded-xl border border-white/10 flex items-center gap-1.5 transition cursor-pointer"
                                  >
                                    <RotateCcw className={`w-3.5 h-3.5 ${isClearingAuth ? "animate-spin text-amber-400" : ""}`} />
                                    Reset Auth
                                  </button>
                                </div>
                              </form>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* ================== QR SCANNER METHOD ================== */
                        <div>
                          {status === "qr_ready" && qrUrl ? (
                            <div className="flex flex-col md:flex-row items-center gap-6 relative">
                              <div className="relative p-4 bg-white rounded-xl border border-white/20 shadow-lg overflow-hidden shrink-0">
                                 <img src={qrUrl} alt="WhatsApp QR Code" className={`w-48 h-48 transition-all duration-300 ${qrTimeLeft <= 0 || isRetrying ? "filter blur-sm opacity-20 scale-95" : ""}`} />
                                {qrTimeLeft <= 0 && !isRetrying && (
                                  <div className="absolute inset-0 bg-black/85 backdrop-blur-[2px] flex flex-col items-center justify-center text-center p-3">
                                    <Loader scale={0.42} text="QR EXPIRED · REFRESHING" />
                                  </div>
                                )}
                                {isRetrying && (
                                  <div className="absolute inset-0 bg-black/85 backdrop-blur-[2px] flex flex-col items-center justify-center text-center p-3">
                                    <Loader scale={0.42} text="REGENERATING QR..." />
                                  </div>
                                )}
                              </div>
                              <div className="space-y-2 text-center md:text-left flex-1">
                                <h4 className="font-bold text-white">Scan QR with your Phone Camera</h4>
                                <p className="text-xs text-zinc-400 max-w-sm">
                                  Open WhatsApp on your phone → <b>Linked Devices</b> → <b>Link a Device</b>, then point camera at this QR code.
                                </p>
                                <div className="mt-2.5 flex flex-col sm:flex-row items-center gap-3">
                                  <button
                                    onClick={retryConnection}
                                    disabled={isRetrying}
                                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer w-full sm:w-auto justify-center"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`} />
                                    {isRetrying ? "Regenerating..." : "Regenerate QR"}
                                  </button>
                                  <button
                                    id="btn_connection_retry_auth"
                                    onClick={clearAuthAndRetryConnection}
                                    disabled={isClearingAuth}
                                    title="Clears the session auth cache before attempting to restart the bot"
                                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer w-full sm:w-auto justify-center"
                                  >
                                    <RotateCcw className={`w-3.5 h-3.5 ${isClearingAuth ? "animate-spin text-amber-400" : ""}`} />
                                    {isClearingAuth ? "Clearing Auth..." : "Retry Connection"}
                                  </button>
                                  {qrTimeLeft > 0 && (
                                    <div className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1.5 bg-black/60 border border-white/10 rounded-lg px-2.5 py-1.5 w-full sm:w-auto justify-center">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                      <span>Expires in <strong className="text-white">{qrTimeLeft}s</strong></span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : status === "connecting" ? (
                            <div className="flex items-center justify-between flex-wrap gap-4 p-2">
                              <div className="flex items-center gap-4">
                                <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                                  <Loader scale={0.38} />
                                </div>
                                <div>
                                  <h4 className="font-bold text-white text-sm">Establishing connection...</h4>
                                  <p className="text-xs text-zinc-400 mt-1">Handshaking with WhatsApp Web. A QR code will appear shortly.</p>
                                </div>
                              </div>
                              <button
                                onClick={clearAuthAndRetryConnection}
                                disabled={isClearingAuth}
                                className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <RotateCcw className={`w-3.5 h-3.5 ${isClearingAuth ? "animate-spin text-amber-400" : ""}`} />
                                Retry Connection
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between flex-wrap gap-4">
                              <div className="flex items-center gap-4">
                                <div className="p-3 bg-white/5 border border-white/10 text-zinc-400 rounded-xl">
                                  <QrCode className="w-8 h-8" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-white text-sm">Bot is offline (QR Mode)</h4>
                                  <p className="text-xs text-zinc-400 mt-1">
                                    Click Start Live Bot to generate a QR code, or switch to the <b>Pairing Code</b> tab to connect with your phone number.
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={startBot}
                                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                                >
                                  <Zap className="w-3.5 h-3.5 fill-black" /> Start Live Bot (QR)
                                </button>
                                <button
                                  id="btn_retry_connection_offline"
                                  onClick={clearAuthAndRetryConnection}
                                  disabled={isClearingAuth}
                                  title="Clears session auth cache before attempting to restart the bot"
                                  className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                                >
                                  <RotateCcw className={`w-3.5 h-3.5 ${isClearingAuth ? "animate-spin text-amber-400" : ""}`} />
                                  Retry Connection
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Quick actions */}
                      <div className="mt-6 pt-5 border-t border-white/10">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">Quick Actions</p>
                        <div className="flex flex-wrap gap-2">
                          {status === "disconnected" || status === "error" ? (
                            <button onClick={startBot} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer">
                              <Zap className="w-3.5 h-3.5 fill-black" /> Start Live Bot
                            </button>
                          ) : (
                            <button onClick={stopBot} className="px-4 py-2 bg-rose-500/20 border border-rose-500/40 text-rose-300 hover:bg-rose-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer">
                              <XCircle className="w-3.5 h-3.5" /> Disconnect Bot
                            </button>
                          )}
                          <button
                            onClick={clearAuthAndRetryConnection}
                            disabled={isClearingAuth}
                            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${isClearingAuth ? "animate-spin text-amber-400" : ""}`} /> Retry Connection
                          </button>
                          <button onClick={() => setActiveTab("simulator")} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer">
                            <MessageSquare className="w-3.5 h-3.5" /> Open Simulator
                          </button>
                          <a href="/api/bot/download-zip" className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer">
                            <FileDown className="w-3.5 h-3.5" /> Project ZIP
                          </a>
                        </div>
                      </div>
                    </Card>


                    {/* Recent activity */}
                    <Card title="Recent Activity" icon={ScrollText} className="xl:col-span-2">
                      <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                        {logs.length === 0 && <p className="text-xs text-zinc-500 italic">No activity yet.</p>}
                        {logs.slice(-8).reverse().map((log, i) => (
                          <div key={i} className="flex items-start gap-2 text-[11px] leading-snug">
                            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                              log.includes("❌") || log.includes("Error") ? "bg-rose-400" :
                              log.includes("✅") || log.includes("connected") ? "bg-emerald-400" :
                              log.includes("⚠️") ? "bg-amber-400" : "bg-zinc-600"
                            }`} />
                            <span className="text-zinc-300 break-words">{log}</span>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setActiveTab("logs")} className="mt-4 w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[11px] font-medium text-zinc-300 flex items-center justify-center gap-1.5 transition cursor-pointer">
                        Open full console <ArrowRight className="w-3 h-3" />
                      </button>
                    </Card>
                  </div>

                    {/* System summary */}
                    <div className="flex flex-col md:flex-row gap-4 md:h-52 select-none" id="system_summary_container">
                      {/* 3D Minecraft Engine Ignition Torch */}
                      <div className="bg-[#0e0e11] border border-white/5 rounded-2xl p-5 shadow-xl flex flex-col items-center justify-between text-center relative overflow-hidden group hover:border-amber-500/30 hover:scale-[1.015] transition-all duration-300 w-full md:flex-1 h-48 md:h-full">
                        <div className="flex items-center justify-between w-full">
                          <span className="text-[10px] font-bold font-mono uppercase tracking-wider text-amber-400/80">Engine Power</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status === "connected" ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-zinc-900 text-zinc-400 border border-zinc-700"}`}>
                            {status === "connected" ? "LIT & ONLINE" : "OFFLINE"}
                          </span>
                        </div>
                        <div className="my-2 py-1">
                          <MinecraftTorch
                            checked={status === "connected" || isStartingBot}
                            disabled={isStartingBot}
                            onChange={(checked) => {
                              if (checked) {
                                startBot();
                              } else {
                                stopBot();
                              }
                            }}
                            label="IGNITION TORCH"
                            subLabel={status === "connected" ? "Click to extinguish / stop" : "Click to light up / start"}
                            size="sm"
                          />
                        </div>
                        <p className="text-[10px] text-zinc-500 leading-tight">
                          Interactive 3D Minecraft Torch directly governs live Baileys process
                        </p>
                      </div>

                      {/* Engine status card - accordion */}
                      <div className="bg-[#0e0e11] border border-white/5 rounded-2xl p-5 shadow-xl flex flex-col justify-between hover:border-amber-500/30 hover:scale-[1.015] transition-all duration-300 ease-in-out w-full md:w-14 md:flex-none md:hover:w-80 md:hover:flex-1 cursor-pointer overflow-hidden group min-h-[140px] md:h-full">
                        {/* Collapsed State (Vertical layout on desktop) */}
                        <div className="hidden md:flex group-hover:md:hidden flex-col items-center justify-between h-full py-2">
                          <Cpu className="w-5 h-5 text-amber-400 animate-pulse" />
                          <span className="font-extrabold text-[10px] text-zinc-400 uppercase tracking-widest rotate-180 [writing-mode:vertical-lr] transition-all duration-500">
                            ENGINE
                          </span>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        </div>

                        {/* Expanded State (Full horizontal details) */}
                        <div className="flex flex-col justify-between h-full w-full md:hidden group-hover:md:flex transition-all duration-500">
                          <div>
                            <div className="flex items-center gap-2 text-amber-400 text-[11px] font-semibold uppercase tracking-wider">
                              <Cpu className="w-4 h-4" /> Engine
                            </div>
                            <p className="text-xl font-bold text-white mt-2 tracking-tight">Baileys Multi-Device</p>
                          </div>
                          <p className="text-xs text-zinc-400 mt-2">Auto-reconnect · session recovery · moderation engine</p>
                        </div>
                      </div>

                      {/* Intelligence status card - accordion */}
                      <div className="bg-[#0e0e11] border border-white/5 rounded-2xl p-5 shadow-xl flex flex-col justify-between hover:border-amber-500/30 hover:scale-[1.015] transition-all duration-300 ease-in-out w-full md:w-14 md:flex-none md:hover:w-80 md:hover:flex-1 cursor-pointer overflow-hidden group min-h-[140px] md:h-full">
                        {/* Collapsed State (Vertical layout on desktop) */}
                        <div className="hidden md:flex group-hover:md:hidden flex-col items-center justify-between h-full py-2">
                          <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
                          <span className="font-extrabold text-[10px] text-zinc-400 uppercase tracking-widest rotate-180 [writing-mode:vertical-lr] transition-all duration-500">
                            INTELLIGENCE
                          </span>
                          <span className={`w-1.5 h-1.5 rounded-full ${secretStatus?.configured ? "bg-emerald-400" : "bg-rose-400"}`} />
                        </div>

                        {/* Expanded State (Full horizontal details) */}
                        <div className="flex flex-col justify-between h-full w-full md:hidden group-hover:md:flex transition-all duration-500">
                          <div>
                            <div className="flex items-center gap-2 text-amber-400 text-[11px] font-semibold uppercase tracking-wider">
                              <Sparkles className="w-4 h-4" /> Intelligence
                            </div>
                            <p className="text-xl font-bold text-white mt-2 tracking-tight">
                              {secretStatus?.configured ? "Gemini Active" : "Gemini Idle"}
                            </p>
                          </div>
                          <p className="text-xs text-zinc-400 mt-2">Text, images, transcription & voice — with fallback chains</p>
                        </div>
                      </div>

                      {/* Prefix status card - accordion */}
                      <div className="bg-[#0e0e11] border border-white/5 rounded-2xl p-5 shadow-xl flex flex-col justify-between hover:border-amber-500/30 hover:scale-[1.015] transition-all duration-300 ease-in-out w-full md:w-14 md:flex-none md:hover:w-80 md:hover:flex-1 cursor-pointer overflow-hidden group min-h-[140px] md:h-full">
                        {/* Collapsed State (Vertical layout on desktop) */}
                        <div className="hidden md:flex group-hover:md:hidden flex-col items-center justify-between h-full py-2">
                          <Smartphone className="w-5 h-5 text-amber-400 animate-pulse" />
                          <span className="font-extrabold text-[10px] text-zinc-400 uppercase tracking-widest rotate-180 [writing-mode:vertical-lr] transition-all duration-500">
                            PREFIX
                          </span>
                          <span className="font-mono text-[10px] font-bold text-amber-400">{config.prefix}</span>
                        </div>

                        {/* Expanded State (Full horizontal details) */}
                        <div className="flex flex-col justify-between h-full w-full md:hidden group-hover:md:flex transition-all duration-500">
                          <div>
                            <div className="flex items-center gap-2 text-amber-400 text-[11px] font-semibold uppercase tracking-wider">
                              <Smartphone className="w-4 h-4" /> Prefix
                            </div>
                            <p className="text-xl font-bold text-white mt-2 tracking-tight">
                              <code className="bg-white/10 border border-white/10 px-2 py-0.5 rounded font-mono text-amber-400">{config.prefix}command</code>
                            </p>
                          </div>
                          <p className="text-xs text-zinc-400 mt-2">{commands.length} commands · {config.botName}</p>
                        </div>
                      </div>
                    </div>

                    {/* Interactive Architecture Tooltip & Quick Diagnostics */}
                    <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5">
                        <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                          <Zap className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white">Production Engine Specifications</h4>
                          <p className="text-xs text-zinc-400">Continuous multi-device socket polling with Gemini cognitive fallbacks</p>
                        </div>
                      </div>
                      <Tooltip
                        label="Engine Diagnostics"
                        title="Nebula WhatsApp Core Architecture"
                        description="Multi-Device WebSocket connection with automatic session failover, rate-limit protection, and sub-100ms command dispatch."
                        badge="Production Ready"
                      />
                    </div>

                    {/* Side-by-Side: Custom Node Clusters & Git Commits Timeline */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                      {/* Left: Box Accordion Column (Cyber Node Status) */}
                      <div className="lg:col-span-2 flex flex-col gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Node Cluster Status</span>
                        <div className="bg-[#0e0e11] border border-white/5 rounded-2xl p-5 h-64 flex flex-col justify-between shadow-xl hover:border-amber-500/10 hover:scale-[1.01] transition-all duration-300">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-zinc-300">Live Active Clusters</span>
                            <span className="w-2 h-2 rounded-full bg-[#00ffeb] animate-pulse" />
                          </div>
                          
                          <div className="flex flex-col gap-2 rounded-xl bg-gradient-to-br from-[#121214] to-black p-2 h-44 overflow-hidden shadow-inner border border-white/5">
                            {/* Box 1 */}
                            <div className="flex-1 overflow-hidden cursor-pointer rounded-lg bg-gradient-to-r from-zinc-800 to-black flex items-center justify-center transition-all duration-500 ease-in-out hover:flex-[4] group/box relative border border-white/5 hover:border-[#00ffeb]/30">
                              <div className="absolute inset-0 bg-white/5 opacity-0 group-hover/box:opacity-100 transition-opacity duration-500 pointer-events-none" />
                              <span className="p-1 text-center font-bold text-[10px] uppercase tracking-widest text-[#00ffeb] transition-transform duration-500 relative z-10 font-mono">
                                Box-1: SOCKET_CORE
                              </span>
                            </div>
                            
                            {/* Box 2 */}
                            <div className="flex-1 overflow-hidden cursor-pointer rounded-lg bg-gradient-to-r from-zinc-800 to-black flex items-center justify-center transition-all duration-500 ease-in-out hover:flex-[4] group/box relative border border-white/5 hover:border-[#00ffeb]/30">
                              <div className="absolute inset-0 bg-white/5 opacity-0 group-hover/box:opacity-100 transition-opacity duration-500 pointer-events-none" />
                              <span className="p-1 text-center font-bold text-[10px] uppercase tracking-widest text-[#00ffeb] transition-transform duration-500 relative z-10 font-mono">
                                Box-2: GEMINI_BRAIN
                              </span>
                            </div>
                            
                            {/* Box 3 */}
                            <div className="flex-1 overflow-hidden cursor-pointer rounded-lg bg-gradient-to-r from-zinc-800 to-black flex items-center justify-center transition-all duration-500 ease-in-out hover:flex-[4] group/box relative border border-white/5 hover:border-[#00ffeb]/30">
                              <div className="absolute inset-0 bg-white/5 opacity-0 group-hover/box:opacity-100 transition-opacity duration-500 pointer-events-none" />
                              <span className="p-1 text-center font-bold text-[10px] uppercase tracking-widest text-[#00ffeb] transition-transform duration-500 relative z-10 font-mono">
                                Box-3: CODEC_DECODER
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: Git Commits / Engine Core Updates Timeline (3 Columns) */}
                      <div className="lg:col-span-3 flex flex-col gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Engine Repository Commits</span>
                        <div className="bg-[#0e0e11] border border-white/5 rounded-2xl p-5 h-64 overflow-y-auto scrollbar shadow-xl hover:border-amber-500/10 hover:scale-[1.01] transition-all duration-300">
                          <div className="relative pl-6 before:absolute before:top-2 before:bottom-2 before:left-3 before:w-[2px] before:border-l-2 before:border-dashed before:border-zinc-800">
                            
                            {/* Commit 1 */}
                            <div className="relative mb-6">
                              <div className="absolute -left-[20px] top-1.5 w-[14px] h-[14px] rounded-full bg-black border-2 border-amber-500 flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-xs text-sky-400 font-mono">Commits</span>
                                  <span className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-1.5 py-0.2 rounded font-mono">origin/main</span>
                                </div>
                                <div className="text-[10px] text-zinc-400 font-mono flex items-center gap-2">
                                  <span>john doe</span>
                                  <span>·</span>
                                  <span>Aug 24, 2023</span>
                                </div>
                                <p className="text-xs text-zinc-300 font-mono leading-relaxed bg-white/5 p-2 rounded-lg border border-white/5">
                                  remove docs as they get moved to primer/design.
                                </p>
                              </div>
                            </div>

                            {/* Commit 2 */}
                            <div className="relative">
                              <div className="absolute -left-[20px] top-1.5 w-[14px] h-[14px] rounded-full bg-black border-2 border-zinc-700 flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-xs text-zinc-400 font-mono">Branch</span>
                                  <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.2 rounded font-mono">feat/baileys</span>
                                </div>
                                <div className="text-[10px] text-zinc-400 font-mono flex items-center gap-2">
                                  <span>jane doe</span>
                                  <span>·</span>
                                  <span>Feb 4, 2023</span>
                                </div>
                                <p className="text-xs text-zinc-300 font-mono leading-relaxed bg-white/5 p-2 rounded-lg border border-white/5">
                                  handcrafted with love &lt;3
                                </p>
                              </div>
                            </div>

                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              {/* ============================================================ CONNECT */}
              {activeTab === "connect" && (
                <div className="space-y-6">
                  {/* Status Banner */}
                  <div className="bg-gradient-to-r from-[#141416] via-[#0e0e10] to-black border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                      <div className={`p-3.5 rounded-2xl border ${
                        status === "connected"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : status === "qr_ready" || status === "pairing_code_ready"
                          ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                          : "bg-white/5 border-white/10 text-zinc-400"
                      }`}>
                        {status === "connected" ? <Wifi className="w-7 h-7" /> : <WifiOff className="w-7 h-7" />}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${
                            status === "connected"
                              ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                              : status === "qr_ready"
                              ? "bg-amber-950 text-amber-300 border-amber-800"
                              : "bg-zinc-900 text-zinc-400 border-zinc-700"
                          }`}>
                            {status === "connected" ? "Connected & Online" : status === "qr_ready" ? "QR Ready" : status === "pairing_code_ready" ? "Pairing Code Ready" : "Disconnected"}
                          </span>
                          <span className="text-xs text-zinc-500 font-mono">Baileys WebSocket Multi-Device v6.7.x</span>
                        </div>
                        <h2 className="text-xl font-bold text-white tracking-tight">
                          <ShinyText text="WhatsApp Connection Command Center" speed={4} />
                        </h2>
                        <p className="text-xs text-zinc-400 max-w-xl">
                          Pair your WhatsApp account directly to the bot engine via 8-digit Pairing Code (no second phone needed) or QR Code Scanner.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {status === "connected" ? (
                        <button
                          onClick={stopBot}
                          className="px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold rounded-xl transition cursor-pointer"
                        >
                          Disconnect Bot
                        </button>
                      ) : (
                        <button
                          onClick={startBot}
                          disabled={isStartingBot}
                          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 text-black text-xs font-bold rounded-xl transition shadow-md cursor-pointer flex items-center gap-2"
                        >
                          {isStartingBot ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                          Start Engine
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                    {/* Method Selector & Live Connection Interactive Box */}
                    <div className="xl:col-span-3 space-y-6">
                      <Card
                        title="Link WhatsApp Device"
                        icon={Smartphone}
                        action={
                          <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl">
                            <button
                              onClick={() => setConnMethod("pair_code")}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                                connMethod === "pair_code"
                                  ? "bg-amber-500 text-black font-bold shadow-sm"
                                  : "text-zinc-400 hover:text-zinc-200"
                              }`}
                            >
                              <Smartphone className="w-3.5 h-3.5" />
                              Pairing Code (Recommended)
                            </button>
                            <button
                              onClick={() => setConnMethod("qr")}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                                connMethod === "qr"
                                  ? "bg-amber-500 text-black font-bold shadow-sm"
                                  : "text-zinc-400 hover:text-zinc-200"
                              }`}
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              QR Scanner
                            </button>
                          </div>
                        }
                      >
                        {connMethod === "pair_code" ? (
                          <div className="space-y-5">
                            <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-2">
                              <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                                <Sparkles className="w-4 h-4" />
                                <span>No Camera or Second Device Needed</span>
                              </div>
                              <p className="text-xs text-zinc-300 leading-relaxed">
                                Enter your full WhatsApp phone number to generate a secure 8-character pairing code, then enter it on your phone under <b>Linked Devices &gt; Link with phone number instead</b>.
                              </p>
                            </div>

                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                generatePairCode();
                              }}
                              className="space-y-4"
                            >
                              <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-300">Country / Region</label>
                                <select
                                  value={pairingCountryPrefix}
                                  onChange={(e) => setPairingCountryPrefix(e.target.value)}
                                  className="w-full px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 transition"
                                >
                                  {COUNTRY_PRESETS.map((country) => (
                                    <option key={country.code} value={country.code}>
                                      {country.label}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-300">WhatsApp Phone Number</label>
                                <div className="flex gap-2">
                                  <span className="px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-mono text-zinc-400 flex items-center">
                                    {pairingCountryPrefix || "+"}
                                  </span>
                                  <input
                                    type="tel"
                                    value={pairingPhone}
                                    onChange={(e) => setPairingPhone(e.target.value.replace(/[^0-9]/g, ""))}
                                    placeholder="e.g. 5550192834 or 81234567890"
                                    className="flex-1 px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 font-mono"
                                    required
                                  />
                                </div>
                                {pairingPhone.trim() && (
                                  <div className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center justify-between text-[11px] text-amber-300 font-mono">
                                    <span>Target WhatsApp Number:</span>
                                    <span className="font-bold">+{normalizePhoneNumber(pairingPhone, pairingCountryPrefix)}</span>
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center justify-between px-3.5 py-2 bg-black/40 border border-white/5 rounded-xl text-xs">
                                <span className="text-zinc-400 flex items-center gap-1.5">
                                  <Globe className="w-3.5 h-3.5 text-amber-400" />
                                  <span>Browser Identity:</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setActiveTab("settings")}
                                  className="text-amber-300 hover:underline font-mono text-[11px] flex items-center gap-1 cursor-pointer font-bold"
                                  title="Change browser signature in Settings"
                                >
                                  <span>{config.browserPlatform || "Ubuntu"} · {config.browserName || "Chrome"}</span>
                                  <span className="text-zinc-500 font-sans text-[10px] font-normal">(Edit in Settings)</span>
                                </button>
                              </div>

                              {pairingError && (
                                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 font-medium flex items-center gap-2">
                                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                                  <span>{pairingError}</span>
                                </div>
                              )}

                              <button
                                type="submit"
                                disabled={isGeneratingPairCode}
                                className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
                              >
                                {isGeneratingPairCode ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                                {isGeneratingPairCode ? "Requesting WhatsApp Code..." : "Generate 8-Digit Pairing Code"}
                              </button>
                            </form>

                            {pairingCode && (
                              <div className="mt-4 p-5 bg-[#18181b]/90 border border-white/10 rounded-2xl space-y-3.5 text-center">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block select-none">Your Secure Pairing Code</span>
                                <div className="flex justify-center">
                                  <HeroSnippet symbol="" size="lg" color="warning">
                                    {pairingCode}
                                  </HeroSnippet>
                                </div>
                                <div className="flex items-center justify-center gap-3">
                                  <span className="text-xs text-zinc-400 font-mono">Expires in {pairingTimeLeft}s</span>
                                </div>

                                <div className="text-left mt-3 p-3 bg-white/5 rounded-xl border border-white/5 space-y-1.5 text-[11px] text-zinc-300">
                                  <p className="font-bold text-amber-400">📲 Steps on your phone:</p>
                                  <p>1. Open WhatsApp &gt; <b>Linked Devices</b> &gt; <b>Link a Device</b>.</p>
                                  <p>2. Tap <b>"Link with phone number instead"</b> at bottom.</p>
                                  <p>3. Enter the 8-character code: <strong className="font-mono text-white">{pairingCode}</strong></p>
                                  <p className="text-[10px] text-zinc-400">⚠️ Must be done from your primary phone (not a companion device).</p>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4 flex flex-col items-center justify-center py-6 text-center">
                            {qrUrl ? (
                              <div className="p-4 bg-white rounded-2xl shadow-xl border border-white/20">
                                <img src={qrUrl} alt="WhatsApp QR Code" className="w-64 h-64 object-contain" />
                              </div>
                            ) : (
                              <div className="w-64 h-64 bg-black border border-white/10 rounded-2xl flex flex-col items-center justify-center space-y-3 p-6">
                                <QrCode className="w-12 h-12 text-zinc-600 animate-pulse" />
                                <p className="text-xs text-zinc-400">Click Start Engine or Refresh to generate QR</p>
                                <button
                                  onClick={startBot}
                                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl transition cursor-pointer"
                                >
                                  Generate QR Code
                                </button>
                              </div>
                            )}
                            <p className="text-xs text-zinc-400 max-w-sm">
                              Open WhatsApp on your phone &gt; Settings &gt; Linked Devices &gt; Link a Device, and point your camera at the QR code.
                            </p>
                          </div>
                        )}
                      </Card>
                    </div>

                    {/* Baileys Diagnostics & Session Purger */}
                    <div className="xl:col-span-2 space-y-6">
                      <Card title="Baileys Live Telemetry" icon={Activity}>
                        <div className="space-y-3 divide-y divide-white/5 text-xs">
                          <div className="flex items-center justify-between pb-2">
                            <span className="text-zinc-400">Socket Status:</span>
                            <span className="font-mono font-bold text-white capitalize">{status}</span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-zinc-400">Auth Store:</span>
                            <span className="font-mono text-zinc-300">useMultiFileAuthState</span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-zinc-400">Auto-Reconnect:</span>
                            <span className="text-emerald-400 font-semibold">Enabled (Exponential Backoff)</span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-zinc-400">Browser Identity:</span>
                            <button
                              type="button"
                              onClick={() => setActiveTab("settings")}
                              className="font-mono text-amber-300 hover:underline flex items-center gap-1 text-right cursor-pointer"
                              title="Click to customize browser identity in Settings"
                            >
                              <span>{config.browserPlatform || "Ubuntu"} · {config.browserName || "Chrome"} ({config.browserVersion || "22.04.4"})</span>
                              <ExternalLink className="w-3 h-3 text-zinc-500" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-zinc-400">Keepalive Ping:</span>
                            <span className="text-amber-400 font-mono">15,000ms</span>
                          </div>
                        </div>
                      </Card>

                      <Card title="Session Maintenance" icon={RotateCcw}>
                        <div className="space-y-3">
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            Encountering "Stream Errored", 401 Unauthorized, or stuck pairing state? Purging the temporary auth folder resets the handshake cleanly.
                          </p>
                          <button
                            onClick={clearAuthAndRetryConnection}
                            disabled={isClearingAuth}
                            className="w-full py-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
                          >
                            {isClearingAuth ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Purge Auth & Reset Session
                          </button>
                        </div>
                      </Card>
                    </div>
                  </div>

                  {/* 4 Step Visual Linking Guide */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { n: "1", title: "Open WhatsApp", desc: "Launch WhatsApp on your primary phone or tablet." },
                      { n: "2", title: "Linked Devices", desc: "Tap Menu (⋮ on Android, Settings on iPhone) &gt; Linked Devices." },
                      { n: "3", title: "Select Link Mode", desc: "Tap 'Link a Device' or 'Link with phone number instead'." },
                      { n: "4", title: "Enter Code / Scan", desc: "Type the 8-digit pairing code or scan the QR code to connect instantly." },
                    ].map((step) => (
                      <div key={step.n} className="bg-[#0b0b0c] border border-white/10 rounded-xl p-5 shadow-sm space-y-2 hover:border-white/20 transition-all">
                        <span className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 font-mono font-bold text-xs flex items-center justify-center">
                          {step.n}
                        </span>
                        <h4 className="font-bold text-white text-sm">{step.title}</h4>
                        <p className="text-xs text-zinc-400 leading-relaxed">{step.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ============================================================ SIMULATOR */}
              {activeTab === "simulator" && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2 bg-[#0b0b0c] rounded-2xl border border-white/10 shadow-xl overflow-hidden flex flex-col h-[calc(100vh-180px)] min-h-[480px]">
                    {/* WhatsApp header mockup */}
                    <div className="bg-[#1f2c34] text-white px-5 py-3.5 flex items-center justify-between border-b border-white/10 shadow-md">
                      <div className="flex items-center gap-3">
                        <HeroUser
                          name={config.botName}
                          description={isSimulating ? "typing..." : "online · controller simulator"}
                          avatarUrl={config.botImage}
                        />
                        <HeroChip variant="flat" color="warning" size="sm">
                          Sandbox
                        </HeroChip>
                      </div>
                      <HeroChip variant="bordered" color="primary" size="md">
                        Prefix: <span className="font-mono font-bold text-white ml-1">{config.prefix}</span>
                      </HeroChip>
                    </div>

                    {/* Search */}
                    <div className="bg-[#111b21] border-b border-white/10 px-4 py-2.5 flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          placeholder="Search messages..."
                          value={chatSearchQuery}
                          onChange={(e) => setChatSearchQuery(e.target.value)}
                          className="w-full bg-[#202c33] text-zinc-100 text-xs pl-8 pr-8 py-2 rounded-lg border border-white/10 focus:outline-none focus:border-amber-400 transition placeholder-zinc-500"
                        />
                        {chatSearchQuery && (
                          <button onClick={() => setChatSearchQuery("")} className="absolute right-2.5 top-2 text-zinc-400 hover:text-white cursor-pointer">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {chatSearchQuery && (
                        <span className="text-[10px] text-zinc-300 bg-white/10 px-2 py-1 rounded-full font-medium shrink-0">
                          {filteredMessages.length} found
                        </span>
                      )}
                    </div>

                    {/* Messages */}
                    <div className="flex-1 p-5 overflow-y-auto space-y-3 bg-[#0c1317] dark-scroll">
                      {filteredMessages.length === 0 && chatSearchQuery.trim() !== "" ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-400 space-y-2 bg-[#1f2c34] p-6 rounded-2xl max-w-[280px] mx-auto shadow-md border border-white/10">
                          <Search className="w-8 h-8 text-zinc-500 stroke-[1.5]" />
                          <p className="font-semibold text-xs text-zinc-200">No matching messages</p>
                          <button onClick={() => setChatSearchQuery("")} className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-[10px] font-bold transition cursor-pointer">
                            Clear Search
                          </button>
                        </div>
                      ) : filteredMessages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-center space-y-3 bg-[#111b21]/90 p-6 rounded-2xl max-w-[320px] mx-auto shadow-lg border border-white/10">
                          <AnimatedFace size="sm" isThinking={isSimulating} />
                          <div className="space-y-1">
                            <h4 className="font-bold text-xs text-white">Simulator is Idle & Ready</h4>
                            <p className="text-[11px] text-zinc-400 leading-relaxed">
                              Send a prompt or command like <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-amber-400 font-bold">{config.prefix}help</code> or <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-amber-300 font-bold">{config.prefix}ai who are you?</code> below!
                            </p>
                          </div>
                        </div>
                      ) : (
                        <AnimatePresence initial={false}>
                          {filteredMessages.map((msg) => (
                            <motion.div
                              key={msg.id}
                              initial={{ opacity: 0, y: 12, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.97 }}
                              transition={{ duration: 0.22, ease: "easeOut" }}
                              className={`flex flex-col max-w-[85%] ${msg.sender === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}
                            >
                              <span className="text-[10px] text-zinc-400 mb-0.5 px-1">{msg.senderName}</span>
                              <div className={`p-3 rounded-2xl text-xs leading-relaxed shadow-md relative ${msg.sender === "user" ? "bg-[#005c4b] text-white rounded-tr-none border border-emerald-600/30" : "bg-[#202c33] text-zinc-100 rounded-tl-none border border-white/10"}`}>
                                {msg.imageUrl && (
                                  <div className="mb-2 rounded-xl overflow-hidden max-w-[200px] border border-white/10">
                                    <img src={msg.imageUrl} alt="AI output" className="w-full h-auto object-cover" />
                                  </div>
                                )}
                                {msg.isAudio ? (
                                  <div className="flex items-center gap-3 py-1.5 min-w-[210px]">
                                    <div className="w-8 h-8 rounded-full bg-amber-500 hover:bg-amber-400 flex items-center justify-center text-black shrink-0 shadow-sm cursor-pointer">
                                      <Play className="w-3 h-3 fill-black ml-0.5" />
                                    </div>
                                    <div className="flex-1 space-y-1">
                                      <div className="flex items-end gap-0.5 h-6">
                                        {[2, 4, 5, 3, 6, 4, 2, 5, 3, 4, 2, 3].map((h, i) => (
                                          <span key={i} className="w-0.5 bg-amber-400 rounded-full" style={{ height: `${h * 4}px` }} />
                                        ))}
                                      </div>
                                      <div className="flex items-center justify-between text-[10px] text-zinc-400 leading-none">
                                        <span>{msg.audioDuration || "0:07"}</span>
                                        <Mic className="w-3.5 h-3.5 text-amber-400" />
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="whitespace-pre-wrap select-text break-words">
                                    {msg.text.split("\n").map((line, i) => (
                                      <p key={i} dangerouslySetInnerHTML={{ __html: formatMessageLine(line) }} className={i > 0 ? "mt-1" : ""} />
                                    ))}
                                  </div>
                                )}
                                {msg.emoji && (
                                  <span className="absolute -bottom-2 -right-1 bg-[#111b21] border border-white/10 text-xs p-0.5 px-1.5 rounded-full shadow-sm text-zinc-100">
                                    {msg.emoji}
                                  </span>
                                )}
                                <div className="text-[9px] text-zinc-400 text-right mt-1.5 leading-none">{msg.timestamp}</div>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      )}
                      {isSimulating && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="mr-auto flex flex-col items-start max-w-[85%]"
                        >
                          <span className="text-[10px] text-zinc-400 mb-1 px-1 font-medium">{config.botName}</span>
                          <div className="bg-[#202c33] border border-white/10 p-3 rounded-2xl rounded-tl-none text-xs text-zinc-300 shadow-lg flex items-center gap-3">
                            <SpeedLoader size="sm" color="#f59e0b" text="Computing response..." className="!p-0" />
                          </div>
                        </motion.div>
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Input */}
                    <form onSubmit={handleSendMessage} className="bg-[#1f2c34] p-3.5 flex items-center gap-2 border-t border-white/10">
                      <input
                        type="text"
                        placeholder={`Send message (start with prefix: '${config.prefix}')`}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        disabled={isSimulating}
                        className="flex-1 bg-[#2a3942] border border-white/10 rounded-full px-4 py-2.5 text-xs text-zinc-100 focus:outline-none focus:border-amber-400 placeholder-zinc-500 transition shadow-inner"
                      />
                      <button
                        type="button"
                        onClick={handleSendVoiceNote}
                        disabled={isSimulating}
                        title="Simulate a voice note"
                        className="p-2.5 bg-white/10 hover:bg-white/20 disabled:bg-zinc-800 text-zinc-200 rounded-full transition shadow-md cursor-pointer flex items-center justify-center shrink-0 border border-white/10"
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                      <button
                        type="submit"
                        disabled={!inputValue.trim() || isSimulating}
                        className="p-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold rounded-full transition shadow-md cursor-pointer flex items-center justify-center"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </form>
                  </div>

                  {/* Side panel */}
                  <div className="space-y-4">
                    {/* Real-time Concurrent Batch Download Status Component */}
                    <BatchDownloadStatus onSimulateCommand={simulateCommandFromDoc} />

                    <Card title="Playground Info" icon={HelpCircle}>
                      <ul className="space-y-3.5 text-xs text-zinc-400">
                        <li className="flex items-start gap-2.5">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          <div>
                            <span>Commands run against the live engine using prefix: </span>
                            <HeroChip variant="flat" color="warning" size="sm" className="ml-1 font-mono">{config.prefix}</HeroChip>
                          </div>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          <span>You are simulated as the system Owner, enabling all high-privilege operations.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          <span>Real-time attachments, voice notes, and downloads render directly.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          <div className="flex items-center flex-wrap gap-1">
                            <span>Press </span>
                            <HeroKbd keys={["enter"]}>Send</HeroKbd>
                            <span> or </span>
                            <HeroKbd keys={["ctrl", "enter"]}>Submit</HeroKbd>
                          </div>
                        </li>
                      </ul>
                    </Card>

                    <Card title="Quick Send" icon={Zap}>
                      <div className="flex flex-wrap gap-2">
                        {[".ping", ".menu", ".joke", ".quote", ".truth", ".dare", ".roast me", ".rps rock", ".weather Bafoussam"].map((cmd) => (
                          <button
                            key={cmd}
                            onClick={() => simulateCommandFromDoc(cmd)}
                            disabled={isSimulating}
                            className="px-3 py-1.5 bg-white/5 hover:bg-amber-500/15 hover:border-amber-500/40 disabled:bg-zinc-900 text-amber-300 disabled:text-zinc-600 rounded-lg text-[11px] font-mono font-semibold transition cursor-pointer border border-white/10"
                          >
                            {cmd}
                          </button>
                        ))}
                      </div>
                    </Card>

                    <Card title="Command Stats" icon={BarChart3}>
                      <div className="space-y-2">
                        {Object.entries(analyticsStats).slice(0, 6).map(([name, count]) => (
                          <div key={name} className="flex items-center gap-3">
                            <span className="text-[11px] font-mono font-semibold text-zinc-300 w-24 truncate">{config.prefix}{name}</span>
                            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                              <div
                                className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full"
                                style={{ width: `${Math.min(100, (count / Math.max(1, Math.max(...Object.values(analyticsStats)))) * 100)}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-bold text-amber-400 w-6 text-right font-mono">{count}</span>
                          </div>
                        ))}
                        {Object.keys(analyticsStats).length === 0 && (
                          <p className="text-xs text-zinc-500 italic">No usage yet — run commands to populate stats.</p>
                        )}
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {/* ============================================================ COMMANDS */}
              {activeTab === "commands" && (
                <div className="space-y-5">
                  {/* Segmented control */}
                  <div className="inline-flex bg-black/60 border border-white/10 rounded-xl p-1">
                    {(["editor", "reference"] as const).map((view) => (
                      <button
                        key={view}
                        onClick={() => setCmdSubView(view)}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                          cmdSubView === view
                            ? "bg-white/10 text-white border border-white/10 shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {view === "editor" ? (
                          <span className="flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5 text-amber-400" /> Code Editor</span>
                        ) : (
                          <span className="flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5 text-amber-400" /> Reference Directory</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {cmdSubView === "editor" ? (
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                      {/* Command list + AI generator */}
                      <div className="xl:col-span-5 space-y-4">
                        <Card
                          title="Command Registry"
                          icon={Terminal}
                          action={
                            <span className="text-[10px] bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded-full font-bold border border-amber-500/20 font-mono">
                              {commands.length} Total
                            </span>
                          }
                        >
                          {/* Search and Multi-level Category Filter Bar */}
                          <div className="space-y-3 mb-3">
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
                              <input
                                type="text"
                                placeholder="Search commands or descriptions..."
                                value={cmdSearchQuery}
                                onChange={(e) => setCmdSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 border border-white/10 rounded-xl text-xs bg-black text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition shadow-inner font-medium"
                              />
                              {cmdSearchQuery && (
                                <button onClick={() => setCmdSearchQuery("")} className="absolute right-2.5 top-2 text-zinc-400 hover:text-white p-1 cursor-pointer">
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {/* Multi-level Category Filter Pills */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {CATEGORY_LIST.map((cat) => {
                                const count = cat === "All"
                                  ? commands.length
                                  : commands.filter(c => {
                                      const pCat = (c.parentCategory || c.category).toLowerCase();
                                      return pCat === cat.toLowerCase() || c.category.toLowerCase() === cat.toLowerCase();
                                    }).length;
                                return (
                                  <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setCmdCategoryFilter(cat)}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 select-none border ${
                                      cmdCategoryFilter === cat
                                        ? "bg-amber-500 text-black border-amber-500 font-bold shadow-sm"
                                        : "bg-white/5 hover:bg-white/10 text-zinc-400 border-white/5"
                                    }`}
                                  >
                                    <span>{cat}</span>
                                    <span className={`text-[9px] px-1 py-0.2 rounded-full ${
                                      cmdCategoryFilter === cat
                                        ? "bg-black/20 text-black font-mono font-bold"
                                        : "bg-black/40 text-zinc-400 font-mono"
                                    }`}>
                                      {count}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Filtered list of commands */}
                          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                            {commands
                              .filter((cmd) => {
                                const matchesSearch = !cmdSearchQuery ||
                                  cmd.name.toLowerCase().includes(cmdSearchQuery.toLowerCase()) ||
                                  cmd.description.toLowerCase().includes(cmdSearchQuery.toLowerCase()) ||
                                  cmd.category.toLowerCase().includes(cmdSearchQuery.toLowerCase());
                                const pCat = (cmd.parentCategory || cmd.category).toLowerCase();
                                const matchesCat = cmdCategoryFilter === "All" ||
                                  pCat === cmdCategoryFilter.toLowerCase() ||
                                  cmd.category.toLowerCase() === cmdCategoryFilter.toLowerCase();
                                return matchesSearch && matchesCat;
                              })
                              .map((cmd) => {
                                const isSelected = selectedCommand?.name === cmd.name;
                                const parent = cmd.parentCategory || "Core";
                                return (
                                  <button
                                    key={cmd.name}
                                    onClick={() => loadCommandCode(cmd)}
                                    className={`w-full text-left p-3 rounded-xl flex items-center justify-between transition cursor-pointer border ${
                                      isSelected
                                        ? "bg-amber-500/15 border-amber-500/40 text-white shadow-md shadow-amber-500/5 ring-1 ring-amber-500/20"
                                        : "bg-white/5 hover:bg-white/10 border-white/5 text-zinc-200"
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`font-bold text-xs font-mono ${isSelected ? "text-amber-400" : "text-white"}`}>{config.prefix}{cmd.name}</span>
                                        <span className={`text-[8px] uppercase tracking-wider px-1.5 py-0.2 rounded font-bold ${
                                          isSelected ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-zinc-400"
                                        }`}>
                                          {parent}
                                        </span>
                                      </div>
                                      <div className={`text-[10px] mt-0.5 truncate ${isSelected ? "text-zinc-300" : "text-zinc-400"}`}>
                                        {cmd.description.slice(0, 48)}{cmd.description.length > 48 ? "..." : ""}
                                      </div>
                                    </div>
                                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold shrink-0 ml-2 border ${
                                      isSelected ? "bg-amber-500/20 text-amber-300 border-amber-500/30 font-bold" : "bg-white/5 text-zinc-400 border-white/5"
                                    }`}>
                                      {cmd.category}
                                    </span>
                                  </button>
                                );
                              })}
                            {commands.filter((cmd) => {
                              const matchesSearch = !cmdSearchQuery ||
                                cmd.name.toLowerCase().includes(cmdSearchQuery.toLowerCase()) ||
                                cmd.description.toLowerCase().includes(cmdSearchQuery.toLowerCase()) ||
                                cmd.category.toLowerCase().includes(cmdSearchQuery.toLowerCase());
                              const pCat = (cmd.parentCategory || cmd.category).toLowerCase();
                              const matchesCat = cmdCategoryFilter === "All" ||
                                pCat === cmdCategoryFilter.toLowerCase() ||
                                cmd.category.toLowerCase() === cmdCategoryFilter.toLowerCase();
                              return matchesSearch && matchesCat;
                            }).length === 0 && (
                              <div className="p-4 text-center text-xs text-zinc-500 italic">
                                No commands match this filter.
                              </div>
                            )}
                          </div>
                        </Card>

                        <Card title="AI Smart Command Creator" icon={Sparkles}>
                          <form onSubmit={generateAICommand} className="space-y-3">
                            <p className="text-[11px] text-zinc-400 leading-relaxed">
                              Describe your command in plain English. Gemini will write the code and hot-load it instantly.
                            </p>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-zinc-300">Command Trigger</label>
                              <input
                                type="text"
                                placeholder="e.g. quote"
                                value={aiCmdName}
                                onChange={(e) => setAiCmdName(e.target.value)}
                                className="w-full px-3 py-2 border border-white/10 bg-black text-zinc-100 rounded-lg text-xs focus:outline-none focus:border-amber-400 placeholder-zinc-600 font-mono"
                                required
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-300">Category</label>
                                <input
                                  type="text"
                                  value={aiCmdCategory}
                                  onChange={(e) => setAiCmdCategory(e.target.value)}
                                  className="w-full px-3 py-2 border border-white/10 bg-black text-zinc-100 rounded-lg text-xs focus:outline-none focus:border-amber-400 placeholder-zinc-600"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-300">Description</label>
                                <input
                                  type="text"
                                  value={aiCmdDesc}
                                  placeholder="Describe it"
                                  onChange={(e) => setAiCmdDesc(e.target.value)}
                                  className="w-full px-3 py-2 border border-white/10 bg-black text-zinc-100 rounded-lg text-xs focus:outline-none focus:border-amber-400 placeholder-zinc-600"
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-zinc-300">AI Prompt Instruction</label>
                              <textarea
                                placeholder="e.g. Fetches a funny quote and responds in WhatsApp"
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                rows={2}
                                className="w-full px-3 py-2 border border-white/10 bg-black text-zinc-100 rounded-lg text-xs focus:outline-none focus:border-amber-400 resize-none placeholder-zinc-600"
                                required
                              />
                            </div>
                            <button
                              type="submit"
                              disabled={isGeneratingCommand}
                              className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition"
                            >
                              {isGeneratingCommand ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                              Generate Code with Gemini
                            </button>
                            {aiGenMessage && (
                              <div className="p-2.5 bg-black/60 border border-white/10 rounded-lg text-[10px] text-zinc-300 font-medium">{aiGenMessage}</div>
                            )}
                          </form>
                        </Card>
                      </div>

                      {/* Editor */}
                      <div className="xl:col-span-7">
                        <Card title={selectedCommand ? `Editing: ${config.prefix}${selectedCommand.name}.ts` : "Code Editor"} icon={Code2} action={
                          selectedCommand && (
                            <button
                              onClick={saveCommandCode}
                              disabled={isSavingCode}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition"
                            >
                              {isSavingCode ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Save Code
                            </button>
                          )
                        } className="flex flex-col h-full">
                          {selectedCommand ? (
                            <div className="flex flex-col gap-3 h-full min-h-[500px]">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <p className="text-[11px] text-zinc-400">{selectedCommand.description}</p>
                                <span className="text-[10px] bg-white/5 text-zinc-300 px-2 py-0.5 rounded font-mono border border-white/5">
                                  Category: {selectedCommand.parentCategory || "Core"} / {selectedCommand.category}
                                </span>
                              </div>
                              <textarea
                                value={commandCode}
                                onChange={(e) => {
                                  setCommandCode(e.target.value);
                                  setValidationError(null);
                                }}
                                className="w-full flex-1 min-h-[400px] p-4 font-mono text-xs bg-black text-zinc-100 rounded-xl focus:outline-none focus:border-amber-400 resize-y border border-white/10 shadow-md leading-relaxed"
                                style={{ whiteSpace: "pre" }}
                              />
                              {validationError && (
                                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-[10px] text-rose-300 font-medium flex items-start gap-2">
                                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                                  <div className="flex-1">
                                    <strong className="block font-bold text-rose-200">Pre-Save Code Validation Failed:</strong>
                                    <span className="mt-0.5 block opacity-95">{validationError}</span>
                                  </div>
                                </div>
                              )}
                              {editorMessage && (
                                <div className="p-2.5 bg-white/5 border border-white/10 rounded-lg text-[10px] text-zinc-300 font-medium">{editorMessage}</div>
                              )}
                            </div>
                          ) : (
                            <div className="h-full min-h-[400px] border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center text-center p-6 space-y-2">
                              <Code2 className="w-10 h-10 text-zinc-600" />
                              <h4 className="font-bold text-zinc-300 text-sm">No Command Selected</h4>
                              <p className="text-[11px] text-zinc-500 max-w-sm">
                                Select a command on the left to edit its TypeScript, or use the AI Creator to generate a brand new command.
                              </p>
                            </div>
                          )}
                        </Card>
                      </div>
                    </div>
                  ) : (
                    /* Reference / docs */
                    <div className="space-y-4">
                      <Card title="Interactive Command Directory" icon={BookOpen} action={
                        <div className="relative w-full md:w-64">
                          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
                          <input
                            type="text"
                            placeholder="Search commands or aliases..."
                            value={docSearchQuery}
                            onChange={(e) => setDocSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-8 py-2 border border-white/10 rounded-xl text-xs bg-black text-zinc-100 focus:outline-none focus:border-amber-400 placeholder-zinc-500 transition shadow-inner font-medium"
                          />
                          {docSearchQuery && (
                            <button onClick={() => setDocSearchQuery("")} className="absolute right-2.5 top-2 text-zinc-400 hover:text-white p-1 cursor-pointer">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      }>
                        {/* Categories with multi-level filter tabs */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-4">
                          {CATEGORY_LIST.map((cat) => {
                            const count = cat === "All"
                              ? commands.length
                              : commands.filter(c => {
                                  const pCat = (c.parentCategory || c.category).toLowerCase();
                                  return pCat === cat.toLowerCase() || c.category.toLowerCase() === cat.toLowerCase();
                                }).length;
                            return (
                              <button
                                key={cat}
                                onClick={() => setDocSelectedCategory(cat)}
                                className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition cursor-pointer select-none flex items-center gap-1.5 border ${
                                  docSelectedCategory === cat
                                    ? "bg-amber-500 text-black border-amber-500 font-bold shadow-sm"
                                    : "bg-white/5 hover:bg-white/10 text-zinc-400 border-white/5"
                                }`}
                              >
                                <span>{cat}</span>
                                <span className={`text-[9px] px-1 py-0.2 rounded-full ${
                                  docSelectedCategory === cat ? "bg-black/20 text-black font-bold font-mono" : "bg-black/40 text-zinc-400 font-mono"
                                }`}>
                                  {count}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/40">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-white/5 border-b border-white/10 text-zinc-400 text-[10px] uppercase font-bold tracking-wider select-none">
                                <th className="p-4 w-[25%]">Command & Category</th>
                                <th className="p-4 w-[35%]">Syntax & Params</th>
                                <th className="p-4 w-[25%]">Description</th>
                                <th className="p-4 w-[15%] text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-xs">
                              {commands
                                .filter((cmd) => {
                                  const pCat = (cmd.parentCategory || cmd.category).toLowerCase();
                                  const matchesCategory = docSelectedCategory === "All" ||
                                    pCat === docSelectedCategory.toLowerCase() ||
                                    cmd.category.toLowerCase() === docSelectedCategory.toLowerCase();
                                  const matchesSearch =
                                    cmd.name.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
                                    cmd.description.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
                                    (cmd.aliases && cmd.aliases.some((alias) => alias.toLowerCase().includes(docSearchQuery.toLowerCase()))) ||
                                    cmd.usage.toLowerCase().includes(docSearchQuery.toLowerCase());
                                  return matchesCategory && matchesSearch;
                                })
                                .map((cmd) => {
                                  const { cleanUsage, parameters, example } = parseUsageAndParams(cmd.usage, cmd.name, config.prefix);
                                  const parent = cmd.parentCategory || "Core";
                                  return (
                                    <tr key={cmd.name} className="hover:bg-white/[0.02] transition duration-150">
                                      <td className="p-4 align-top space-y-1.5">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-mono font-bold text-amber-400 bg-white/5 px-2 py-0.5 rounded text-xs border border-white/10">
                                            {config.prefix}{cmd.name}
                                          </span>
                                          <span className="text-[9px] bg-white/10 text-zinc-300 font-bold px-1.5 py-0.5 rounded uppercase border border-white/10">
                                            {parent}
                                          </span>
                                          <span className="text-[9px] bg-white/5 text-zinc-400 font-medium px-1.5 py-0.5 rounded border border-white/5">
                                            {cmd.category}
                                          </span>
                                        </div>
                                        {cmd.aliases && cmd.aliases.length > 0 && (
                                          <div className="flex items-center gap-1 flex-wrap">
                                            <span className="text-[9px] text-zinc-500 select-none">Alt:</span>
                                            {cmd.aliases.map((alias) => (
                                              <span key={alias} className="text-[9px] bg-white/5 text-zinc-400 font-mono px-1 py-0.5 border border-white/5 rounded">
                                                {config.prefix}{alias}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                      <td className="p-4 align-top space-y-2">
                                        <div className="font-mono text-[11px] text-zinc-300 bg-black/60 p-2 border border-white/10 rounded-lg select-all max-w-full overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                          {cleanUsage}
                                        </div>
                                        {parameters.length > 0 ? (
                                          <div className="flex flex-wrap gap-1.5">
                                            {parameters.map((param, idx) => (
                                              <span key={idx} className={`text-[9px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                                param.required ? "bg-rose-500/10 text-rose-300 border border-rose-500/20" : "bg-sky-500/10 text-sky-300 border border-sky-500/20"
                                              }`}>
                                                <span className={`w-1 h-1 rounded-full ${param.required ? "bg-rose-400" : "bg-sky-400"}`} />
                                                {param.name}: {param.required ? "required" : "optional"}
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-[9px] text-zinc-500 italic block select-none">No arguments required.</span>
                                        )}
                                      </td>
                                      <td className="p-4 align-top text-zinc-300 text-xs leading-relaxed">{cmd.description}</td>
                                      <td className="p-4 align-top text-right space-y-2">
                                        <button
                                          onClick={() => {
                                            navigator.clipboard.writeText(example);
                                            setCopiedCommandName(cmd.name);
                                            setTimeout(() => setCopiedCommandName(null), 1800);
                                          }}
                                          className="w-full px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition cursor-pointer select-none border border-white/10"
                                        >
                                          {copiedCommandName === cmd.name ? (
                                            <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Copied!</span></>
                                          ) : (
                                            <><Copy className="w-3.5 h-3.5" /><span>Copy Sample</span></>
                                          )}
                                        </button>
                                        <button
                                          onClick={() => simulateCommandFromDoc(example)}
                                          disabled={isSimulating}
                                          className="w-full px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 disabled:bg-zinc-900 text-amber-400 disabled:text-zinc-600 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition cursor-pointer select-none border border-amber-500/30"
                                        >
                                          <Play className="w-3 h-3 fill-current" />
                                          <span>Run Live</span>
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                          {commands.filter((cmd) => {
                            const matchesCategory = docSelectedCategory === "All" || cmd.category === docSelectedCategory;
                            const matchesSearch =
                              cmd.name.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
                              cmd.description.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
                              (cmd.aliases && cmd.aliases.some((alias) => alias.toLowerCase().includes(docSearchQuery.toLowerCase()))) ||
                              cmd.usage.toLowerCase().includes(docSearchQuery.toLowerCase());
                            return matchesCategory && matchesSearch;
                          }).length === 0 && (
                            <div className="text-center py-12 bg-black/40 space-y-2">
                              <HelpCircle className="w-8 h-8 text-zinc-600 mx-auto" />
                              <h4 className="font-bold text-zinc-300 text-xs">No Commands Found</h4>
                              <p className="text-[10px] text-zinc-500">Try a different search or category.</p>
                            </div>
                          )}
                        </div>
                      </Card>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================ ANALYTICS */}
              {activeTab === "analytics" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <Card title="Command Frequencies" icon={BarChart3} action={
                      <span className="px-2.5 py-1 bg-emerald-950/40 border border-emerald-800/80 rounded-lg text-[10px] font-bold text-emerald-400 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" /> Live tracking
                      </span>
                    }>
                      <div className="h-[280px] flex items-center justify-center">
                        {Object.keys(analyticsStats).length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={Object.entries(analyticsStats).map(([name, value]) => ({ name: `${config.prefix}${name}`, value }))}
                                cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={4} dataKey="value"
                              >
                                {Object.entries(analyticsStats).map((_, index) => (
                                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <RechartsTooltip contentStyle={{ background: "#0b0b0c", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)", fontSize: "11px", fontWeight: "600", color: "#ffffff" }} />
                              <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "10px", fontWeight: "600", color: "#a1a1aa" }} />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <p className="text-xs text-zinc-500 italic">No usage data yet — commands you run will appear here.</p>
                        )}
                      </div>
                    </Card>

                    {/* Transcribe */}
                    <Card title="Transcribe Audio" icon={Mic}>
                      <div className="bg-black/40 border border-white/10 rounded-xl p-4 min-h-[110px] flex flex-col justify-center items-center text-center">
                        {isTranscribing ? (
                          <div className="space-y-2">
                            <RefreshCw className="w-5 h-5 text-amber-400 animate-spin mx-auto" />
                            <p className="text-[10px] text-amber-400 font-semibold">Gemini is transcribing...</p>
                          </div>
                        ) : transcriptionText ? (
                          <p className="text-xs text-white font-medium italic leading-relaxed">"{transcriptionText}"</p>
                        ) : isRecording ? (
                          <div className="space-y-1.5 animate-pulse">
                            <div className="flex items-center justify-center gap-1">
                              <span className="w-2.5 h-2.5 bg-rose-500 rounded-full" />
                              <span className="text-xs font-bold text-rose-400">RECORDING</span>
                            </div>
                            <p className="text-[10px] text-zinc-400">{recordingSeconds}s elapsed</p>
                          </div>
                        ) : (
                          <p className="text-[10px] text-zinc-500">Speak into your microphone — your transcription will appear here</p>
                        )}
                      </div>
                      <div className="mt-4">
                        {isRecording ? (
                          <button onClick={stopRecording} className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition shadow-sm cursor-pointer">
                            Stop & Transcribe
                          </button>
                        ) : (
                          <button
                            onClick={startRecording}
                            disabled={isTranscribing}
                            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black text-xs font-bold rounded-xl transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Mic className="w-3.5 h-3.5" /> Record Microphone
                          </button>
                        )}
                      </div>
                    </Card>
                  </div>

                  {/* Voice conversation */}
                  <Card title="Voice Conversation (Live API)" icon={Sparkles}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-black/40 border border-white/10 rounded-xl p-4 min-h-[110px] flex flex-col justify-center items-center text-center">
                        <audio ref={audioPlayerRef} className="hidden" onEnded={() => setIsPlayingVoice(false)} />
                        {isVoiceResponding ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-center gap-1">
                              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" />
                              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:150ms]" />
                              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:300ms]" />
                            </div>
                            <p className="text-[10px] text-amber-400 font-semibold">Gemini is thinking...</p>
                          </div>
                        ) : isVoiceRecording ? (
                          <div className="space-y-1 animate-pulse">
                            <span className="text-xs font-bold text-rose-400">LISTENING...</span>
                            <p className="text-[10px] text-zinc-400">Say what you want to ask Gemini</p>
                          </div>
                        ) : voiceReplyText ? (
                          <div className="space-y-2 max-w-full">
                            <p className="text-xs font-semibold text-amber-400">Gemini Speaks:</p>
                            <p className="text-xs text-zinc-200 leading-relaxed italic">"{voiceReplyText}"</p>
                            {isPlayingVoice && (
                              <div className="flex items-center justify-center gap-0.5 pt-1.5">
                                {[...Array(8)].map((_, i) => (
                                  <div key={i} className="w-1 bg-amber-400 rounded-full animate-pulse" style={{ height: `${Math.random() * 16 + 6}px`, animationDuration: `${0.4 + Math.random() * 0.4}s` }} />
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-[10px] text-zinc-500">Start a conversation using mic or text</p>
                        )}
                      </div>

                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={voiceInput}
                            onChange={(e) => setVoiceInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleVoiceCallConvo(voiceInput)}
                            placeholder="Type to converse..."
                            className="flex-1 px-3.5 py-2 bg-black border border-white/10 rounded-xl text-xs font-medium text-white placeholder-zinc-500 focus:border-amber-400 outline-none transition"
                          />
                          <button
                            onClick={() => handleVoiceCallConvo(voiceInput)}
                            disabled={isVoiceResponding || !voiceInput.trim()}
                            className="px-4 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
                          >
                            Call
                          </button>
                        </div>
                        {isVoiceRecording ? (
                          <button onClick={stopVoiceRecording} className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-xl transition shadow-sm cursor-pointer">
                            Stop Speaking
                          </button>
                        ) : (
                          <button
                            onClick={startVoiceRecording}
                            disabled={isVoiceResponding}
                            className="w-full py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 text-[11px] font-bold rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Mic className="w-3 h-3 text-amber-400" /> Record Voice Response
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {/* ============================================================ SYSTEM DIAGNOSTICS */}
              {activeTab === "diagnostics" && (
                <SystemDiagnostics />
              )}

              {/* ============================================================ GEMINI COGNITIVE AI */}
              {activeTab === "gemini" && (
                <div className="space-y-6">
                  {/* Hero AI Header */}
                  <div className="bg-gradient-to-r from-[#141416] via-[#0e0e10] to-black border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                      <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                        <Sparkles className="w-7 h-7" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800">
                            Gemini 2.5 Flash
                          </span>
                          <span className="text-xs text-zinc-500 font-mono">@google/genai SDK v0.1.x</span>
                        </div>
                        <h2 className="text-xl font-bold text-white tracking-tight">Gemini Cognitive Intelligence Engine</h2>
                        <p className="text-xs text-zinc-400 max-w-xl">
                          Autonomous natural language answering, voice conversations, live speech transcription, and vision analysis for WhatsApp.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                        secretStatus?.configured
                          ? "bg-emerald-950/60 border-emerald-800/80 text-emerald-400"
                          : "bg-amber-950/60 border-amber-800/80 text-amber-400"
                      }`}>
                        <KeyRound className="w-3.5 h-3.5" />
                        {secretStatus?.configured ? "Key Configured" : "Default Key Active"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    {/* Model Configuration */}
                    <Card title="Model & Inference Parameters" icon={Cpu}>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-zinc-300">Active Model</label>
                          <select
                            value={geminiModel}
                            onChange={(e) => setGeminiModel(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 transition"
                          >
                            <option value="gemini-2.5-flash">gemini-2.5-flash (Fastest &amp; Multimodal)</option>
                            <option value="gemini-2.5-pro">gemini-2.5-pro (Deep Reasoning &amp; Complex Tasks)</option>
                            <option value="gemini-2.0-flash">gemini-2.0-flash (General Purpose)</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-zinc-300">Temperature</span>
                            <span className="font-mono text-amber-400">{geminiTemperature.toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={geminiTemperature}
                            onChange={(e) => setGeminiTemperature(parseFloat(e.target.value))}
                            className="w-full accent-amber-500 cursor-pointer bg-white/10 rounded-lg h-2"
                          />
                          <div className="flex justify-between text-[10px] text-zinc-500">
                            <span>0.0 (Precise)</span>
                            <span>1.0 (Creative)</span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-zinc-300">System Persona Instructions</label>
                          <textarea
                            value={geminiSystemPrompt}
                            onChange={(e) => setGeminiSystemPrompt(e.target.value)}
                            rows={4}
                            className="w-full px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 font-mono resize-none"
                            placeholder="Set instructions for how the AI responds in WhatsApp chats..."
                          />
                        </div>

                        <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-1.5 text-xs">
                          <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                            <Sparkles className="w-3.5 h-3.5" /> Multimodal Features Enabled
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            Supports <code>.ai</code> text prompt, <code>.transcribe</code> voice note audio recognition, and <code>.ask</code> vision questions on photos.
                          </p>
                        </div>
                      </div>
                    </Card>

                    {/* Interactive Prompt Playground */}
                    <div className="xl:col-span-2 space-y-6">
                      <Card
                        title="Interactive AI Prompt Playground"
                        icon={Sparkles}
                        action={
                          <button
                            onClick={testGeminiPlayground}
                            disabled={isTestingGemini || !geminiPlaygroundPrompt.trim()}
                            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                          >
                            {isTestingGemini ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                            Execute Prompt
                          </button>
                        }
                      >
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-zinc-300">Test Prompt</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={geminiPlaygroundPrompt}
                                onChange={(e) => setGeminiPlaygroundPrompt(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && testGeminiPlayground()}
                                placeholder="e.g. Write a quick haiku about WhatsApp automation bots..."
                                className="flex-1 px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-medium"
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-zinc-300">Model Output Stream</label>
                            <div className="p-4 bg-black border border-white/10 rounded-xl min-h-[180px] max-h-[300px] overflow-y-auto font-mono text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap select-text">
                              {isTestingGemini ? (
                                <div className="flex items-center gap-2 text-amber-400 py-6 justify-center">
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  <span>Generating response from {geminiModel}...</span>
                                </div>
                              ) : geminiPlaygroundOutput ? (
                                geminiPlaygroundOutput
                              ) : (
                                <span className="text-zinc-600 italic">Output from Gemini inference will stream here in real-time.</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>

                      {/* Live Audio Transcription & Voice conversation mini-hub */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card title="Speech Recognition" icon={Mic}>
                          <div className="space-y-3">
                            <div className="p-3 bg-black/40 border border-white/10 rounded-xl min-h-[70px] flex items-center justify-center text-center">
                              {isTranscribing ? (
                                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Transcribing...
                                </div>
                              ) : transcriptionText ? (
                                <p className="text-xs text-white font-medium italic">"{transcriptionText}"</p>
                              ) : (
                                <p className="text-[11px] text-zinc-500">Record speech to transcribe with Gemini</p>
                              )}
                            </div>
                            {isRecording ? (
                              <button onClick={stopRecording} className="w-full py-2 bg-rose-600 text-white text-xs font-bold rounded-xl cursor-pointer">
                                Stop &amp; Transcribe ({recordingSeconds}s)
                              </button>
                            ) : (
                              <button onClick={startRecording} className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer">
                                <Mic className="w-3.5 h-3.5 text-amber-400" /> Record Microphone
                              </button>
                            )}
                          </div>
                        </Card>

                        <Card title="Voice Conversation" icon={Volume2}>
                          <div className="space-y-3">
                            <div className="p-3 bg-black/40 border border-white/10 rounded-xl min-h-[70px] flex items-center justify-center text-center">
                              {isVoiceResponding ? (
                                <span className="text-amber-400 text-xs font-semibold animate-pulse">Thinking...</span>
                              ) : voiceReplyText ? (
                                <p className="text-xs text-white italic">"{voiceReplyText.slice(0, 70)}..."</p>
                              ) : (
                                <p className="text-[11px] text-zinc-500">Live Voice synthesis simulator</p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={voiceInput}
                                onChange={(e) => setVoiceInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleVoiceCallConvo(voiceInput)}
                                placeholder="Type to speak..."
                                className="flex-1 px-3 py-1.5 bg-black border border-white/10 rounded-xl text-xs text-white outline-none focus:border-amber-400"
                              />
                              <button
                                onClick={() => handleVoiceCallConvo(voiceInput)}
                                disabled={isVoiceResponding || !voiceInput.trim()}
                                className="px-3 bg-amber-500 text-black font-bold rounded-xl text-xs cursor-pointer"
                              >
                                Call
                              </button>
                            </div>
                          </div>
                        </Card>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================ PLUGINS MATRIX */}
              {activeTab === "plugins" && (
                <div className="space-y-6">
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#0b0b0c] border border-white/10 p-5 rounded-2xl">
                    <div className="space-y-1">
                      <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Package className="w-5 h-5 text-amber-400" />
                        Plugins &amp; Capabilities Matrix
                      </h2>
                      <p className="text-xs text-zinc-400">
                        Manage modular functional extensions, media handlers, and AI middleware for your WhatsApp bot.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {["All", "Core", "AI", "Utility", "Security"].map((category) => (
                        <button
                          key={category}
                          onClick={() => setPluginFilter(category)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                            pluginFilter === category
                              ? "bg-amber-500 text-black font-bold"
                              : "bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Plugin Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <AnimatePresence mode="popLayout">
                      {[
                        { id: "baileys-core", name: "Baileys Multi-Device Core", category: "Core", desc: "WebSocket transport layer with auto-reconnect and auth state persistence.", latency: "12ms", author: "Nebula" },
                        { id: "gemini-ai", name: "Gemini 2.5 Cognitive AI", category: "AI", desc: "Natural language conversations, image reasoning, and speech transcription.", latency: "420ms", author: "Google DeepMind" },
                        { id: "media-downloader", name: "Media & Sticker Converter", category: "Utility", desc: "Convert images, videos, and GIFs into WhatsApp WebP animated stickers.", latency: "180ms", author: "FFmpeg" },
                        { id: "group-guard", name: "Group Guard & Admin Suite", category: "Security", desc: "Welcome cards, farewell notifications, anti-link invites, and group broadcast.", latency: "15ms", author: "Nebula" },
                        { id: "sticker-maker", name: "Universal Media Scraper", category: "Utility", desc: "Download high quality videos from YouTube, TikTok, Instagram, and Twitter.", latency: "650ms", author: "MediaAPI" },
                        { id: "anti-spam", name: "Anti-Spam & Rate Limiter", category: "Security", desc: "Per-user token bucket rate limiter and blacklist phone number enforcement.", latency: "2ms", author: "SentryGuard" },
                        { id: "voice-synthesis", name: "ElevenLabs / Gemini TTS", category: "AI", desc: "Transform responses into realistic voice audio notes sent directly to chats.", latency: "520ms", author: "ElevenLabs" },
                        { id: "crypto-ticker", name: "Live Market & Crypto Ticker", category: "Utility", desc: "Real-time BTC, ETH, SOL, and Forex exchange rates with price alerts.", latency: "95ms", author: "CoinGecko" },
                      ]
                        .filter((p) => pluginFilter === "All" || p.category === pluginFilter)
                        .map((plugin) => {
                          const isEnabled = pluginStates[plugin.id] !== false;
                          return (
                            <motion.div
                              key={plugin.id}
                              layout
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.9 }}
                              transition={{ duration: 0.25, ease: "easeInOut" }}
                              className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 shadow-sm space-y-4 hover:border-white/20 transition flex flex-col justify-between"
                            >
                              <div className="space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-2.5">
                                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                      <Package className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <h4 className="font-bold text-white text-sm tracking-tight">{plugin.name}</h4>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[10px] font-bold px-2 py-0.2 rounded bg-white/5 border border-white/10 text-zinc-400">
                                          {plugin.category}
                                        </span>
                                        <span className="text-[10px] text-zinc-500 font-mono">{plugin.latency}</span>
                                      </div>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPluginStates((prev: Record<string, boolean>) => ({
                                        ...prev,
                                        [plugin.id]: !isEnabled,
                                      }))
                                    }
                                    className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 cursor-pointer ${
                                      isEnabled ? "bg-amber-500 justify-end" : "bg-zinc-800 justify-start"
                                    }`}
                                  >
                                    <span className={`w-4 h-4 rounded-full shadow-md ${isEnabled ? "bg-black" : "bg-zinc-400"}`} />
                                  </button>
                                </div>

                                <p className="text-xs text-zinc-400 leading-relaxed">{plugin.desc}</p>
                              </div>

                              <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-zinc-500">
                                <span>Author: {plugin.author}</span>
                                <span className={`font-semibold ${isEnabled ? "text-emerald-400" : "text-zinc-600"}`}>
                                  {isEnabled ? "Active" : "Disabled"}
                                </span>
                              </div>
                            </motion.div>
                          );
                        })}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* ============================================================ GROUPS TOOL */}
              {activeTab === "groups" && (
                <div className="space-y-6">
                  {/* Group Broadcast Card */}
                  <Card title="Instant Group Broadcast System" icon={Radio}>
                    <div className="space-y-4">
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Send an urgent announcement or newsletter update to all active WhatsApp groups where the bot is a member.
                      </p>

                      <div className="space-y-2">
                        <textarea
                          value={broadcastText}
                          onChange={(e) => setBroadcastText(e.target.value)}
                          rows={3}
                          className="w-full px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 resize-none font-sans"
                          placeholder="Type announcement message to broadcast to all group chats..."
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-zinc-500">
                            {broadcastText.length} characters
                          </span>
                          <button
                            onClick={sendGroupBroadcast}
                            disabled={isBroadcasting || !broadcastText.trim()}
                            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl transition shadow-md flex items-center gap-2 cursor-pointer"
                          >
                            {isBroadcasting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            Dispatch Broadcast
                          </button>
                        </div>
                      </div>

                      {broadcastStatus && (
                        <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-amber-300 font-medium">
                          {broadcastStatus}
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Group Automation Greetings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card
                      title="Welcome Greetings"
                      icon={Users}
                      action={
                        <button
                          type="button"
                          onClick={() => setWelcomeEnabled(!welcomeEnabled)}
                          className={`w-9 h-5 flex items-center rounded-full p-0.5 transition cursor-pointer ${
                            welcomeEnabled ? "bg-amber-500 justify-end" : "bg-zinc-800 justify-start"
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded-full ${welcomeEnabled ? "bg-black" : "bg-zinc-400"}`} />
                        </button>
                      }
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-zinc-300">Auto Welcome Message</label>
                          <span className="text-[10px] text-zinc-500 font-mono">Variables: @user, @group</span>
                        </div>
                        <textarea
                          value={welcomeMessage}
                          onChange={(e) => setWelcomeMessage(e.target.value)}
                          rows={3}
                          className="w-full px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 font-sans resize-none"
                        />
                        <p className="text-[10px] text-zinc-500">Sent automatically when a new member joins any group.</p>
                      </div>
                    </Card>

                    <Card
                      title="Farewell Goodbyes"
                      icon={Users}
                      action={
                        <button
                          type="button"
                          onClick={() => setFarewellEnabled(!farewellEnabled)}
                          className={`w-9 h-5 flex items-center rounded-full p-0.5 transition cursor-pointer ${
                            farewellEnabled ? "bg-amber-500 justify-end" : "bg-zinc-800 justify-start"
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded-full ${farewellEnabled ? "bg-black" : "bg-zinc-400"}`} />
                        </button>
                      }
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-zinc-300">Auto Farewell Message</label>
                          <span className="text-[10px] text-zinc-500 font-mono">Variables: @user</span>
                        </div>
                        <textarea
                          value={farewellMessage}
                          onChange={(e) => setFarewellMessage(e.target.value)}
                          rows={3}
                          className="w-full px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 font-sans resize-none"
                        />
                        <p className="text-[10px] text-zinc-500">Sent automatically when a member leaves or is removed.</p>
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {/* ============================================================ SECURITY */}
              {activeTab === "security" && (
                <div className="space-y-6">
                  {/* RoleGuard */}
                  <AccessControlPanel />

                  {/* Audit trail + backup/restore + AI budget */}
                  <SecurityExtras />

                  {/* Security Guardrails Header */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {/* Rate Limiting & Policies */}
                    <Card title="Rate Limiter &amp; Abuse Prevention" icon={Shield}>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-zinc-300">Max Commands Per Minute (Per User)</span>
                            <span className="font-mono text-amber-400">{rateLimitMax} req/min</span>
                          </div>
                          <input
                            type="range"
                            min="5"
                            max="60"
                            step="5"
                            value={rateLimitMax}
                            onChange={(e) => setRateLimitMax(parseInt(e.target.value))}
                            className="w-full accent-amber-500 cursor-pointer bg-white/10 rounded-lg h-2"
                          />
                        </div>

                        <div className="p-3.5 bg-black/40 border border-white/10 rounded-xl flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-white">Block Link Invites</p>
                            <p className="text-[10px] text-zinc-400">Auto-delete unauthorized WhatsApp group links</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setBlockLinkInvites(!blockLinkInvites)}
                            className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 cursor-pointer ${
                              blockLinkInvites ? "bg-amber-500 justify-end" : "bg-zinc-800 justify-start"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded-full shadow-md ${blockLinkInvites ? "bg-black" : "bg-zinc-400"}`} />
                          </button>
                        </div>

                        <div className="p-3.5 bg-black/40 border border-white/10 rounded-xl flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-white">Auto-Kick Spammers</p>
                            <p className="text-[10px] text-zinc-400">Remove members who exceed rate limits repeatedly</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAutoKickSpammers(!autoKickSpammers)}
                            className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 cursor-pointer ${
                              autoKickSpammers ? "bg-amber-500 justify-end" : "bg-zinc-800 justify-start"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded-full shadow-md ${autoKickSpammers ? "bg-black" : "bg-zinc-400"}`} />
                          </button>
                        </div>

                        <div className="p-3.5 bg-black/40 border border-white/10 rounded-xl flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-white">Admin-Only Commands</p>
                            <p className="text-[10px] text-zinc-400">Restrict moderation and broadcast tools to group admins</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAdminOnlyCmds(!adminOnlyCmds)}
                            className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 cursor-pointer ${
                              adminOnlyCmds ? "bg-amber-500 justify-end" : "bg-zinc-800 justify-start"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded-full shadow-md ${adminOnlyCmds ? "bg-black" : "bg-zinc-400"}`} />
                          </button>
                        </div>

                        <div className="p-3.5 bg-black/40 border border-white/10 rounded-xl flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-white">Public Mode (All Users)</p>
                            <p className="text-[10px] text-zinc-400">When disabled, only bot owners can execute commands</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPublicMode(!publicMode)}
                            className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 cursor-pointer ${
                              publicMode ? "bg-amber-500 justify-end" : "bg-zinc-800 justify-start"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded-full shadow-md ${publicMode ? "bg-black" : "bg-zinc-400"}`} />
                          </button>
                        </div>
                      </div>
                    </Card>

                    {/* Blacklisted Numbers Manager */}
                    <Card title="Blacklisted WhatsApp Numbers" icon={ShieldAlert}>
                      <div className="space-y-4">
                        <p className="text-xs text-zinc-400">
                          Banned phone numbers are blocked immediately from running commands and interacting with the bot.
                        </p>

                        <div className="flex gap-2">
                          <input
                            type="tel"
                            value={blacklistInput}
                            onChange={(e) => setBlacklistInput(e.target.value)}
                            placeholder="e.g. +18005550199"
                            className="flex-1 px-3.5 py-2 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono"
                          />
                          <button
                            onClick={addBlacklistNumber}
                            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl transition cursor-pointer"
                          >
                            Ban Number
                          </button>
                        </div>

                        <div className="space-y-2 max-h-[160px] overflow-y-auto">
                          {blacklistedNumbers.length > 0 ? (
                            blacklistedNumbers.map((num) => (
                              <div
                                key={num}
                                className="flex items-center justify-between p-2.5 bg-black/40 border border-white/10 rounded-xl text-xs font-mono text-zinc-300"
                              >
                                <span>{num}</span>
                                <button
                                  onClick={() => removeBlacklistNumber(num)}
                                  className="text-rose-400 hover:text-rose-300 text-xs font-bold transition cursor-pointer"
                                >
                                  Unban
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-zinc-600 italic text-center py-4">No numbers blacklisted yet.</p>
                          )}
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {/* ============================================================ SECRETS VAULT */}
              {activeTab === "secrets" && (
                <div className="space-y-6">
                  <Card title="API Secrets &amp; Environment Variables" icon={KeyRound}>
                    <div className="space-y-6 max-w-2xl">
                      <p className="text-xs text-zinc-300 leading-relaxed">
                        Manage your bot's primary environment secrets. These are persisted securely on the backend server in the <code>.env</code> file.
                      </p>

                      {/* GEMINI_API_KEY */}
                      <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-white block">GEMINI_API_KEY</span>
                            <span className="text-[10px] text-zinc-400">Required for AI commands, transcriptions, and reasoning</span>
                          </div>
                          {secretStatus?.configured ? (
                            <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Configured ({secretStatus.masked})
                            </span>
                          ) : (
                            <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-700 font-bold px-2.5 py-1 rounded-full">
                              Not Configured
                            </span>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={secretValue}
                            onChange={(e) => setSecretValue(e.target.value)}
                            placeholder="AIzaSy..."
                            className="flex-1 px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono"
                          />
                          <button
                            onClick={saveSecret}
                            disabled={isSavingSecret || !secretValue.trim()}
                            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5"
                          >
                            {isSavingSecret ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save Secret
                          </button>
                        </div>
                        {secretMessage && (
                          <div className="p-2 bg-white/5 border border-white/5 rounded-lg text-xs text-amber-300 font-medium">
                            {secretMessage}
                          </div>
                        )}
                      </div>

                                            {/* NVIDIA_NIM_API_KEY (AI fallback) */}
                      <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-white block">NVIDIA_NIM_API_KEY</span>
                            <span className="text-[10px] text-zinc-400">Optional — AI fallback when Gemini is unavailable (free key: build.nvidia.com)</span>
                          </div>
                          {nimSecretStatus?.configured ? (
                            <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Configured ({nimSecretStatus.masked})
                            </span>
                          ) : (
                            <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-700 font-bold px-2.5 py-1 rounded-full">
                              Not Configured
                            </span>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={nimSecretValue}
                            onChange={(e) => setNimSecretValue(e.target.value)}
                            placeholder="nvapi-..."
                            className="flex-1 px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono"
                          />
                          <button
                            onClick={saveNimSecret}
                            disabled={isSavingNimSecret || !nimSecretValue.trim()}
                            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5"
                          >
                            {isSavingNimSecret ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save Secret
                          </button>
                        </div>
                        {nimSecretMessage && (
                          <div className="p-2 bg-white/5 border border-white/5 rounded-lg text-xs text-amber-300 font-medium">
                            {nimSecretMessage}
                          </div>
                        )}
                      </div>

                      {/* OWNER_NUMBER */}
                      <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-white block">OWNER_NUMBER</span>
                            <span className="text-[10px] text-zinc-400">The ONLY number authorized to execute administrative owner commands</span>
                          </div>
                          {ownerSecretStatus?.configured ? (
                            <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Configured ({ownerSecretStatus.masked})
                            </span>
                          ) : (
                            <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-700 font-bold px-2.5 py-1 rounded-full">
                              Not Configured
                            </span>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={ownerSecretValue}
                            onChange={(e) => setOwnerSecretValue(e.target.value)}
                            placeholder="country code + number, e.g. 2250700000000"
                            className="flex-1 px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono"
                          />
                          <button
                            onClick={saveOwnerSecret}
                            disabled={isSavingOwnerSecret || !ownerSecretValue.trim()}
                            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5"
                          >
                            {isSavingOwnerSecret ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save Owner Number
                          </button>
                        </div>
                        {ownerSecretMessage && (
                          <div className="p-2 bg-white/5 border border-white/5 rounded-lg text-xs text-amber-300 font-medium">
                            {ownerSecretMessage}
                          </div>
                        )}
                      </div>

                    </div>
                  </Card>
                </div>
              )}

              {/* ============================================================ DOCS */}
              {activeTab === "docs" && (
                <div className="space-y-6">
                  <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-amber-400" />
                      Baileys Multi-Device REST &amp; Socket API Reference
                    </h2>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Complete endpoint specifications and architectural instructions for interacting with the Nebula WhatsApp Bot server.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      {[
                        { method: "GET", path: "/api/bot/status", desc: "Retrieve active connection state, QR code status, and system logs." },
                        { method: "POST", path: "/api/bot/pair-code", desc: "Request an 8-digit Baileys multi-device pairing code for a phone number." },
                        { method: "POST", path: "/api/bot/chat", desc: "Dispatch simulated message or trigger automated command pipelines." },
                        { method: "POST", path: "/api/bot/clear-auth", desc: "Purge session directory to resolve authentication and socket conflicts." },
                        { method: "GET", path: "/api/bot/commands", desc: "Enumerate all active command definitions and usage metadata." },
                        { method: "POST", path: "/api/bot/config", desc: "Update bot prefix, owner number, bot name, and newsletter preferences." },
                      ].map((ep) => (
                        <div key={ep.path} className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-1.5">
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              ep.method === "POST" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            }`}>
                              {ep.method}
                            </span>
                            <span className="text-white font-semibold">{ep.path}</span>
                          </div>
                          <p className="text-xs text-zinc-400">{ep.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================ LOGS */}
              {activeTab === "logs" && (() => {
                const getLogCategory = (log: string): string => {
                  if (log.includes("❌") || log.includes("Error") || log.includes("failed") || log.includes("Blocked") || log.includes("🛡️") || log.includes("Guardrail") || log.includes("⚠️") || log.includes("WARNING")) {
                    return "Errors";
                  } else if (log.includes("🤖") || log.includes("Gemini") || log.includes("Asking")) {
                    return "Cognitive";
                  } else if (log.includes("Simulator") || log.includes("Playground") || log.includes("Message from")) {
                    return "Sandbox";
                  }
                  return "System";
                };

                const filteredLogs = logs.filter(log => activeLogFilters.includes(getLogCategory(log)));

                return (
                  <Card title="Engine Console Output" icon={Terminal} action={
                    <button
                      onClick={clearBotLogs}
                      className="px-3 py-1.5 border border-white/10 hover:bg-white/10 text-zinc-300 hover:text-white bg-white/5 rounded-xl text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Clear
                    </button>
                  }>
                    <div className="flex flex-col gap-3">
                      {/* Category Filter Chips */}
                      <div className="flex items-center gap-2 flex-wrap bg-[#0b0b0c] px-4 py-2.5 rounded-xl border border-white/10">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mr-1.5 select-none">Filter Logs:</span>
                        {["Errors", "System", "Cognitive", "Sandbox"].map((category) => {
                          const isActive = activeLogFilters.includes(category);
                          const count = logs.filter(log => getLogCategory(log) === category).length;
                          return (
                            <button
                              key={category}
                              onClick={() => {
                                if (isActive) {
                                  if (activeLogFilters.length > 1) {
                                    setActiveLogFilters(activeLogFilters.filter(c => c !== category));
                                  }
                                } else {
                                  setActiveLogFilters([...activeLogFilters, category]);
                                }
                              }}
                              className={`px-2.5 py-1.5 rounded-xl text-[10px] font-bold tracking-wide transition cursor-pointer select-none flex items-center gap-1.5 border ${
                                isActive
                                  ? category === "Errors"
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/30 shadow-sm"
                                    : category === "Cognitive"
                                    ? "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30 shadow-sm"
                                    : category === "Sandbox"
                                    ? "bg-amber-500/10 text-amber-300 border-amber-500/30 shadow-sm"
                                    : "bg-white/10 text-zinc-200 border-white/20 shadow-sm"
                                  : "bg-black/40 text-zinc-500 border-white/5 hover:text-zinc-300 hover:border-white/10"
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                category === "Errors" ? "bg-rose-500" :
                                category === "Cognitive" ? "bg-fuchsia-500" :
                                category === "Sandbox" ? "bg-amber-400" : "bg-zinc-400"
                              } ${isActive ? "animate-pulse" : "opacity-40"}`} />
                              <span>{category}</span>
                              <span className="text-[9px] bg-black/50 px-1.5 py-0.2 rounded font-medium select-none text-zinc-400">{count}</span>
                            </button>
                          );
                        })}
                        {activeLogFilters.length < 4 && (
                          <button
                            onClick={() => setActiveLogFilters(["Errors", "System", "Cognitive", "Sandbox"])}
                            className="ml-auto text-[10px] font-extrabold text-amber-400 hover:text-amber-300 transition cursor-pointer select-none"
                          >
                            Show All
                          </button>
                        )}
                      </div>

                      <div className="bg-black rounded-2xl p-4 border border-white/10 shadow-lg min-h-[420px] max-h-[560px] overflow-y-auto flex flex-col font-mono text-[11px] leading-relaxed select-text text-zinc-200">
                        {filteredLogs.length === 0 ? (
                          <span className="text-zinc-500 text-center py-12 italic">_no activity matching the selected filters_</span>
                        ) : (
                          filteredLogs.map((log, index) => {
                            let colorClass = "text-zinc-300";
                            let badgeText = "SYSTEM";
                            let badgeColor = "bg-white/5 text-zinc-400 border border-white/10";

                            if (log.includes("❌") || log.includes("Error") || log.includes("failed") || log.includes("Blocked")) {
                              colorClass = "text-rose-400";
                              badgeText = "ERROR";
                              badgeColor = "bg-rose-500/10 text-rose-400 border border-rose-500/20";
                            } else if (log.includes("🛡️") || log.includes("Guardrail")) {
                              colorClass = "text-amber-400";
                              badgeText = "GUARD";
                              badgeColor = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
                            } else if (log.includes("⚠️") || log.includes("WARNING")) {
                              colorClass = "text-amber-400";
                              badgeText = "WARN";
                              badgeColor = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
                            } else if (log.includes("✅") || log.includes("connected") || log.includes("SUCCESS")) {
                              colorClass = "text-emerald-400";
                              badgeText = "SUCCESS";
                              badgeColor = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                            } else if (log.includes("🤖") || log.includes("Gemini") || log.includes("Asking")) {
                              colorClass = "text-fuchsia-400";
                              badgeText = "COGNITIVE";
                              badgeColor = "bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20";
                            } else if (log.includes("Simulator") || log.includes("Playground") || log.includes("Message from")) {
                              colorClass = "text-amber-300";
                              badgeText = "SANDBOX";
                              badgeColor = "bg-amber-500/10 text-amber-300 border border-amber-500/20";
                            }

                            return (
                              <div key={index} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0 hover:bg-white/5 px-1 transition-colors">
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider uppercase select-none ${badgeColor} shrink-0`}>
                                  {badgeText}
                                </span>
                                <span className={`${colorClass} break-words`}>{log}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })()}

              {/* ============================================================ EXPORT */}
              {activeTab === "export" && (
                <div className="space-y-6">
                  <div className="bg-gradient-to-r from-zinc-900 via-[#141416] to-black border border-amber-500/30 rounded-2xl p-8 text-white shadow-xl shadow-amber-500/5 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="space-y-2 text-center md:text-left max-w-lg">
                      <div className="flex items-center gap-2 justify-center md:justify-start">
                        <span className="px-2.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-[10px] font-bold text-amber-400 uppercase tracking-wider">Production Standalone</span>
                      </div>
                      <h3 className="font-extrabold text-xl text-white">Run Nebula Bot Locally</h3>
                      <p className="text-xs text-zinc-300 leading-relaxed">
                        Export your current configuration, commands and runtime into a self-contained Node package — with automatic QR output, session handling, and all dependencies listed.
                      </p>
                    </div>
                    <a
                      href="/api/bot/download-zip"
                      className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-sm rounded-xl flex items-center gap-2 transition shadow-lg shadow-amber-500/10 whitespace-nowrap cursor-pointer"
                    >
                      <FileDown className="w-4 h-4" />
                      Download Complete ZIP
                    </a>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { n: "01", t: "Extract & Install", d: "Unzip the package, run npm install in the folder." },
                      { n: "02", t: "Set API Keys", d: "Edit the generated .env with your GEMINI_API_KEY (never shared automatically)." },
                      { n: "03", t: "Launch & Link", d: "npm start prints a QR code — scan it with Linked Devices on your phone." },
                    ].map((step) => (
                      <div key={step.n} className="bg-[#0b0b0c] border border-white/10 rounded-xl p-5 shadow-sm space-y-2 hover:border-white/20 transition-all">
                        <div className="text-2xl font-extrabold text-amber-400 font-mono">{step.n}</div>
                        <h5 className="font-bold text-white text-sm">{step.t}</h5>
                        <p className="text-xs text-zinc-400 leading-relaxed">{step.d}</p>
                      </div>
                    ))}
                  </div>

                  <Card title="Download Full Project Source" icon={FileDown}>
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <p className="text-xs text-zinc-400 leading-relaxed max-w-xl">
                        Grab the complete Nebula Bot project as a ZIP — full source code, tests, configs, CI workflow and
                        README, ready to run with <code className="bg-black text-amber-300 px-1.5 py-0.5 rounded border border-white/10 font-mono">npm install</code>. Ideal
                        for backups or moving the project to another machine.
                      </p>
                      <a
                        href="/nebula-bot-latest.zip"
                        className="shrink-0 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl flex items-center gap-2 transition shadow-md cursor-pointer"
                      >
                        <FileDown className="w-4 h-4" />
                        Download Project ZIP
                      </a>
                    </div>
                  </Card>

                  <Card title="Downloads blocked? Copy the project as text" icon={Copy}>
                    <div className="space-y-3">
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        If your browser blocks the file download (some preview environments do), encode the ZIP as
                        base64 text, copy it, then decode it locally:
                      </p>
                      <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-1.5">
                        <li>Click <b>Encode as Base64</b> below</li>
                        <li>Click <b>Copy</b>, then paste into a new file named <code className="bg-black text-amber-300 px-1.5 py-0.5 rounded border border-white/10 font-mono">nebula.txt</code></li>
                        <li>Run <code className="bg-black text-amber-300 px-1.5 py-0.5 rounded border border-white/10 font-mono text-[11px]">python3 -c "import base64;open('nebula-bot-latest.zip','wb').write(base64.b64decode(open('nebula.txt').read()))"</code></li>
                      </ol>
                      <div className="flex gap-2 flex-wrap pt-1">
                        <button
                          onClick={loadZipAsBase64}
                          disabled={zipB64Loading}
                          className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                        >
                          {zipB64Loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Code2 className="w-3.5 h-3.5 text-amber-400" />}
                          {zipB64 ? "Re-encode" : "Encode as Base64"}
                        </button>
                        {zipB64 && !zipB64.startsWith("ERROR") && (
                          <button
                            onClick={copyZipB64}
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                          >
                            {zipB64Copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            {zipB64Copied ? "Copied!" : "Copy"}
                          </button>
                        )}
                      </div>
                      {zipB64 && (
                        <textarea
                          ref={zipB64Ref}
                          readOnly
                          value={zipB64}
                          rows={7}
                          onFocus={(e) => e.currentTarget.select()}
                          className="w-full p-3 font-mono text-[10px] bg-black text-zinc-200 rounded-xl border border-white/10 leading-relaxed resize-y focus:outline-none focus:border-amber-400"
                        />
                      )}
                      {zipB64.startsWith("ERROR") && (
                        <p className="text-xs font-semibold text-rose-400">{zipB64}</p>
                      )}
                    </div>
                  </Card>

                  <Card title="What's included" icon={CheckCircle}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        "All 21 built-in commands (transpiled to CommonJS)",
                        "Shared runtime modules (AI client, group database)",
                        "config.json with your current settings",
                        "Auto-reconnect & session management",
                        "Environment template with placeholders only",
                        "README with quick-start instructions",
                      ].map((item, i) => (
                        <div key={i} className="flex items-start gap-2.5 text-xs text-zinc-300">
                          <Check className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" /> {item}
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}

              {/* ============================================================ SETTINGS */}
              {activeTab === "settings" && (
                <div className="space-y-6">
                  <Card title="Bot Parameters" icon={Settings}>
                    <form onSubmit={saveConfig} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-300">Bot Name</label>
                        <input
                          type="text"
                          value={formConfig.botName || ""}
                          onChange={(e) => setFormConfig({ ...formConfig, botName: e.target.value })}
                          className="w-full px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 transition shadow-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-300">Prefix</label>
                        <input
                          type="text"
                          value={formConfig.prefix || ""}
                          onChange={(e) => setFormConfig({ ...formConfig, prefix: e.target.value })}
                          maxLength={2}
                          className="w-full px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 transition shadow-sm font-mono"
                        />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-semibold text-zinc-300">Bot Image URL (Avatar)</label>
                        <input
                          type="url"
                          value={formConfig.botImage || ""}
                          onChange={(e) => setFormConfig({ ...formConfig, botImage: e.target.value })}
                          className="w-full px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 transition shadow-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-300">Owner Number (With Country Code)</label>
                        <input
                          type="text"
                          value={formConfig.ownerNumber || ""}
                          placeholder="country code + number, e.g. 2250700000000"
                          onChange={(e) => setFormConfig({ ...formConfig, ownerNumber: e.target.value })}
                          className="w-full px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 transition shadow-sm font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-300">Newsletter Channel Name</label>
                        <input
                          type="text"
                          value={formConfig.newsletterName || ""}
                          onChange={(e) => setFormConfig({ ...formConfig, newsletterName: e.target.value })}
                          className="w-full px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 transition shadow-sm"
                        />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-semibold text-zinc-300">Newsletter Channel URL</label>
                        <input
                          type="url"
                          value={formConfig.newsletterUrl || ""}
                          onChange={(e) => setFormConfig({ ...formConfig, newsletterUrl: e.target.value })}
                          className="w-full px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 placeholder-zinc-600 transition shadow-sm font-mono"
                        />
                      </div>
                      <div className="md:col-span-2 flex items-center justify-end gap-3 pt-2">
                        {configMessage && <span className="text-xs text-amber-400 font-medium">{configMessage}</span>}
                        <button
                          type="submit"
                          disabled={isSavingConfig}
                          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                        >
                          {isSavingConfig ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Save Config Settings
                        </button>
                      </div>
                    </form>
                  </Card>

                  {/* WhatsApp Browser Identity & Signature Selection */}
                  <Card
                    title="WhatsApp Browser Identity"
                    icon={Globe}
                    action={
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 font-bold px-2.5 py-1 rounded-full font-mono">
                          {formConfig.browserName || "Chrome"} ({formConfig.browserPlatform || "Ubuntu"})
                        </span>
                        <button
                          type="button"
                          onClick={saveConfig}
                          disabled={isSavingConfig}
                          className="px-3 py-1 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 text-black font-bold text-xs rounded-lg flex items-center gap-1 transition cursor-pointer"
                        >
                          <Save className="w-3 h-3" /> Save
                        </button>
                      </div>
                    }
                  >
                    <BrowserIdentitySelector
                      platform={formConfig.browserPlatform || "Ubuntu"}
                      browserName={formConfig.browserName || "Chrome"}
                      version={formConfig.browserVersion || "22.04.4"}
                      onChange={(updates) => setFormConfig((prev) => ({ ...prev, ...updates }))}
                      disabled={isSavingConfig}
                    />
                  </Card>

                  {/* Safety & Autonomous Engine Switches */}
                  <Card title="Automation & Guardrail Policies" icon={Zap}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-white">Auto-Read Messages</p>
                          <p className="text-[10px] text-zinc-400">Mark incoming chats as read automatically</p>
                        </div>
                        <Switch
                          checked={autoRead}
                          onChange={(checked) => setAutoRead(checked)}
                          id="switch-auto-read"
                          name="autoRead"
                        />
                      </div>

                      <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-white">Simulate Typing</p>
                          <p className="text-[10px] text-zinc-400">Show typing presence before dispatching</p>
                        </div>
                        <Switch
                          checked={simulateTyping}
                          onChange={(checked) => setSimulateTyping(checked)}
                          id="switch-simulate-typing"
                          name="simulateTyping"
                        />
                      </div>

                      <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-white">Anti-Link Guardrail</p>
                          <p className="text-[10px] text-zinc-400">Auto-delete unauthorized invite links</p>
                        </div>
                        <Switch
                          checked={antiLink}
                          onChange={(checked) => setAntiLink(checked)}
                          id="switch-anti-link"
                          name="antiLink"
                        />
                      </div>

                      <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-white">Autonomous Gemini AI</p>
                          <p className="text-[10px] text-zinc-400">Respond to conversational AI queries</p>
                        </div>
                        <Switch
                          checked={autonomousAi}
                          onChange={(checked) => setAutonomousAi(checked)}
                          id="switch-autonomous-ai"
                          name="autonomousAi"
                        />
                      </div>

                      <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-white">Public Mode</p>
                          <p className="text-[10px] text-zinc-400">Allow group members to execute commands</p>
                        </div>
                        <Switch
                          checked={publicMode}
                          onChange={(checked) => setPublicMode(checked)}
                          id="switch-public-mode"
                          name="publicMode"
                        />
                      </div>
                    </div>
                  </Card>

                  {/* Liquid Glass Aesthetic Customization */}
                  <Card title="Liquid Glass Aesthetic" icon={Sparkles}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="p-5 bg-black/40 rounded-xl border border-white/10 flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-white">Adaptive Morphing</p>
                          <p className="text-[10px] text-zinc-400">
                            Uses JavaScript to randomize blob transition coordinates every 15s for organic liquidity
                          </p>
                        </div>
                        <Switch
                          checked={adaptiveMorphing}
                          onChange={(checked) => setAdaptiveMorphing(checked)}
                          id="switch-adaptive-morphing"
                          name="adaptiveMorphing"
                        />
                      </div>

                      <div className="p-5 bg-black/40 rounded-xl border border-white/10 flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-white">Motion Sensitivity</p>
                          <p className="text-[10px] text-zinc-400">
                            Orgasmic scale adjustments on background orbs based on mouse movement and scroll speed
                          </p>
                        </div>
                        <Switch
                          checked={motionSensitivity}
                          onChange={(checked) => setMotionSensitivity(checked)}
                          id="switch-motion-sensitivity"
                          name="motionSensitivity"
                        />
                      </div>

                      <div className="p-5 bg-black/40 rounded-xl border border-white/10 space-y-3 flex flex-col justify-center">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-white">Backdrop Blur Strength</p>
                            <p className="text-[10px] text-zinc-400">
                              Globally scale the depth-of-field glass blurring strength
                            </p>
                          </div>
                          <span className="text-xs font-bold bg-white/5 border border-white/10 text-zinc-200 px-2.5 py-1 rounded-lg font-mono">
                            {Math.round(blurIntensity * 100)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-zinc-500 font-bold font-mono">0%</span>
                          <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={blurIntensity}
                            onChange={(e) => setBlurIntensity(parseFloat(e.target.value))}
                            className="flex-1 accent-[var(--theme-primary,#f59e0b)] bg-zinc-800 rounded-lg appearance-none h-1.5 cursor-pointer"
                          />
                          <span className="text-[10px] text-zinc-500 font-bold font-mono">200%</span>
                        </div>
                      </div>

                      <div className="p-5 bg-black/40 rounded-xl border border-white/10 space-y-3 flex flex-col justify-center">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-white">Blob Animation Speed</p>
                            <p className="text-[10px] text-zinc-400">
                              Adjust morphing speed of background elements in real-time
                            </p>
                          </div>
                          <span className="text-xs font-bold bg-white/5 border border-white/10 text-zinc-200 px-2.5 py-1 rounded-lg font-mono">
                            {animationDuration}s
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-zinc-500 font-bold font-mono">4s (Fast)</span>
                          <input
                            type="range"
                            min="4"
                            max="40"
                            step="1"
                            value={animationDuration}
                            onChange={(e) => setAnimationDuration(parseFloat(e.target.value))}
                            className="flex-1 accent-[var(--theme-primary,#f59e0b)] bg-zinc-800 rounded-lg appearance-none h-1.5 cursor-pointer"
                          />
                          <span className="text-[10px] text-zinc-500 font-bold font-mono">40s (Chill)</span>
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Secrets */}
                  <Card title="API Secrets" icon={KeyRound}>
                    <div className="space-y-4">
                      {/* GEMINI_API_KEY */}
                      <div className="space-y-2 border-b border-white/5 pb-4">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-white">GEMINI_API_KEY</span>
                          {secretStatus?.configured ? (
                            <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 font-bold px-2 py-1 rounded-full flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Configured ({secretStatus.masked})
                            </span>
                          ) : (
                            <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-700 font-bold px-2 py-1 rounded-full">Not configured</span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <input
                            type="password"
                            value={secretValue}
                            onChange={(e) => setSecretValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && saveSecret()}
                            placeholder="Paste your Gemini API key..."
                            autoComplete="off"
                            className="flex-1 min-w-[220px] px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 transition shadow-sm font-mono"
                          />
                          <button
                            onClick={saveSecret}
                            disabled={isSavingSecret || !secretValue.trim()}
                            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                          >
                            {isSavingSecret ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save
                          </button>
                          {secretStatus?.configured && (
                            <button
                              onClick={clearSecret}
                              disabled={isSavingSecret}
                              title="Remove the key"
                              className="p-2.5 border border-white/10 hover:bg-rose-500/20 hover:border-rose-500/40 text-zinc-400 hover:text-rose-400 rounded-xl transition shadow-sm cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        {secretMessage && (
                          <div className="p-2 bg-white/5 border border-white/5 rounded-lg text-xs text-amber-300 font-medium">{secretMessage}</div>
                        )}
                      </div>

                                            {/* NVIDIA_NIM_API_KEY (AI fallback) */}
                      <div className="space-y-2 border-b border-white/5 pb-4">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-white">NVIDIA_NIM_API_KEY</span>
                          {nimSecretStatus?.configured ? (
                            <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 font-bold px-2 py-1 rounded-full flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Configured ({nimSecretStatus.masked})
                            </span>
                          ) : (
                            <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-700 font-bold px-2 py-1 rounded-full">Not configured</span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <input
                            type="password"
                            value={nimSecretValue}
                            onChange={(e) => setNimSecretValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && saveNimSecret()}
                            placeholder="Paste your NVIDIA NIM key (nvapi-...)..."
                            autoComplete="off"
                            className="flex-1 min-w-[220px] px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 transition shadow-sm font-mono"
                          />
                          <button
                            onClick={saveNimSecret}
                            disabled={isSavingNimSecret || !nimSecretValue.trim()}
                            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                          >
                            {isSavingNimSecret ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save
                          </button>
                          {nimSecretStatus?.configured && (
                            <button
                              onClick={clearNimSecret}
                              disabled={isSavingNimSecret}
                              title="Remove the NVIDIA key"
                              className="p-2.5 border border-white/10 hover:bg-rose-500/20 hover:border-rose-500/40 text-zinc-400 hover:text-rose-400 rounded-xl transition shadow-sm cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        {nimSecretMessage && (
                          <div className="p-2 bg-white/5 border border-white/5 rounded-lg text-xs text-amber-300 font-medium">{nimSecretMessage}</div>
                        )}
                      </div>

                      {/* OWNER_NUMBER */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-white">OWNER_NUMBER</span>
                          {ownerSecretStatus?.configured ? (
                            <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 font-bold px-2 py-1 rounded-full flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Configured ({ownerSecretStatus.masked})
                            </span>
                          ) : (
                            <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-700 font-bold px-2.5 py-1 rounded-full">Not configured</span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <input
                            type="text"
                            value={ownerSecretValue}
                            onChange={(e) => setOwnerSecretValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && saveOwnerSecret()}
                            placeholder="country code + number, e.g. 2250700000000"
                            autoComplete="off"
                            className="flex-1 min-w-[220px] px-3.5 py-2.5 border border-white/10 rounded-xl text-xs bg-black text-white focus:outline-none focus:border-amber-400 transition shadow-sm font-mono"
                          />
                          <button
                            onClick={saveOwnerSecret}
                            disabled={isSavingOwnerSecret || !ownerSecretValue.trim()}
                            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                          >
                            {isSavingOwnerSecret ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save
                          </button>
                          {ownerSecretStatus?.configured && (
                            <button
                              onClick={clearOwnerSecret}
                              disabled={isSavingOwnerSecret}
                              title="Remove the owner number"
                              className="p-2.5 border border-white/10 hover:bg-rose-500/20 hover:border-rose-500/40 text-zinc-400 hover:text-rose-400 rounded-xl transition shadow-sm cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        {ownerSecretMessage && (
                          <div className="p-2 bg-white/5 border border-white/5 rounded-lg text-xs text-amber-300 font-medium">{ownerSecretMessage}</div>
                        )}
                      </div>

                      <p className="text-[10px] text-zinc-500 leading-relaxed pt-2">
                        Stored in the server's <code className="bg-black text-amber-300 px-1.5 py-0.5 rounded border border-white/10 font-mono">.env</code> file and applied immediately — no restart needed. Values are masked and never leave the server.
                      </p>
                    </div>
                  </Card>

                  {/* Session & Authentication Cache Maintenance */}
                  <Card title="Session & Authentication Cache" icon={RotateCcw}>
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 p-4 bg-black/40 rounded-xl border border-white/10">
                        <div className="p-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg shrink-0">
                          <RotateCcw className={`w-4 h-4 ${isClearingAuth ? "animate-spin" : ""}`} />
                        </div>
                        <div className="space-y-1 flex-1">
                          <h5 className="font-bold text-xs text-white">
                            Authentication Directory: <code className="font-mono text-amber-400 bg-black px-1.5 py-0.5 rounded border border-white/10">nebula_auth_info</code>
                          </h5>
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            Clearing this directory purges stale multi-device credentials, encryption keys, and session metadata. Use this whenever you encounter stream conflicts, status 515 sync loops, or want to link a new WhatsApp number.
                          </p>
                        </div>
                      </div>

                      {resetFeedback && (
                        <div
                          className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 text-xs ${
                            resetFeedback.type === "success"
                              ? "bg-emerald-950/40 border-emerald-800/80 text-emerald-200"
                              : resetFeedback.type === "error"
                              ? "bg-rose-950/40 border-rose-800/80 text-rose-200"
                              : "bg-white/5 border-white/10 text-zinc-200"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {resetFeedback.type === "success" ? (
                              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <strong className="block font-bold">{resetFeedback.title}</strong>
                              <span className="text-[11px] opacity-90">{resetFeedback.message}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => setResetFeedback(null)}
                            className="p-1 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-zinc-200 transition cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <div className="flex items-center gap-3 flex-wrap pt-1">
                        <button
                          type="button"
                          onClick={clearAuthAndRetryConnection}
                          disabled={isClearingAuth}
                          className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl flex items-center gap-2 transition shadow-sm cursor-pointer"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${isClearingAuth ? "animate-spin" : ""}`} />
                          {isClearingAuth ? "Purging & Reconnecting..." : "Reset Session (Full Purge & Handshake)"}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setIsClearingAuth(true);
                            addSystemLog("🧹 Clearing session auth directory without reconnecting...");
                            try {
                              const res = await fetch("/api/bot/clear-auth", { method: "POST" });
                              const data = await res.json().catch(() => ({}));
                              if (res.ok && data.success) {
                                const count = data.filesRemoved || 0;
                                setResetFeedback({
                                  type: "success",
                                  title: "Session Cache Cleared",
                                  message: `Removed ${count} files from 'nebula_auth_info'. Bot is disconnected in a clean state.`,
                                  filesRemoved: count,
                                  timestamp: new Date().toLocaleTimeString(),
                                });
                                addSystemLog(`✨ Purged ${count} session files from 'nebula_auth_info'.`);
                              } else {
                                setResetFeedback({
                                  type: "error",
                                  title: "Failed to Clear Auth Cache",
                                  message: data.error || "Unknown server error.",
                                  timestamp: new Date().toLocaleTimeString(),
                                });
                              }
                              await fetchStatus();
                            } catch (e: any) {
                              setResetFeedback({
                                type: "error",
                                title: "Network Error",
                                message: e.message || String(e),
                                timestamp: new Date().toLocaleTimeString(),
                              });
                            } finally {
                              setIsClearingAuth(false);
                            }
                          }}
                          disabled={isClearingAuth}
                          className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
                          Purge Session Files Only
                        </button>
                      </div>
                    </div>
                  </Card>

                  {/* Channel link */}
                  <Card title="Community" icon={Globe}>
                    <a
                      href={config.newsletterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-3.5 rounded-xl border border-white/10 hover:border-amber-500/30 hover:bg-white/5 transition group cursor-pointer bg-black/40"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg">
                          <ExternalLink className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white">{config.newsletterName}</p>
                          <p className="text-[10px] text-zinc-400">Official updates & announcements</p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-amber-400 transition" />
                    </a>
                  </Card>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

        {/* Footer */}
        <footer className="px-6 py-4 text-center text-zinc-500 text-xs border-t border-white/10 bg-black">
          <div className="flex flex-col md:flex-row items-center justify-between gap-2 max-w-6xl mx-auto">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <Bot className="w-4 h-4 text-amber-400" /> Nebula Engine Control Center
            </span>
            <span>© 2026 Nebula Bot Engine · Reference Template Standard</span>
          </div>
        </footer>
      </div>

      {/* Floating Action Chat Bubble */}
      <ChatBubble onClick={() => setQuickTerminalOpen((prev) => !prev)} isOpen={quickTerminalOpen} />

      {/* Quick Terminal Overlay */}
      {quickTerminalOpen && (
        <div className="fixed bottom-36 right-4 left-4 sm:left-auto sm:right-6 sm:bottom-24 z-50 sm:w-96 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#0b0b0c]/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h4 className="text-[11px] font-semibold text-white uppercase tracking-wider">Quick Bot Sandbox</h4>
            </div>
            <button
              onClick={() => setQuickTerminalOpen(false)}
              className="text-zinc-400 hover:text-white p-1 rounded-xl hover:bg-white/5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-zinc-400 mb-3">
            Send an instant test prompt to the bot engine:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={`${config.prefix}ping`}
              className="flex-1 bg-black border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-amber-400 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.target as HTMLInputElement).value) {
                  const val = (e.target as HTMLInputElement).value;
                  (e.target as HTMLInputElement).value = "";
                  sendQuickMessage(val);
                  setActiveTab("simulator");
                  setQuickTerminalOpen(false);
                }
              }}
            />
            <button
              onClick={() => {
                setActiveTab("simulator");
                setQuickTerminalOpen(false);
              }}
              className="rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-black hover:bg-amber-400 transition cursor-pointer"
            >
              Open
            </button>
          </div>
        </div>
      )}

      {/* Full System & Commands Checkup Diagnostic Modal */}
      <CheckupModal
        isOpen={isCheckupOpen}
        onClose={() => setIsCheckupOpen(false)}
        report={checkupReport}
        isLoading={isCheckupLoading}
        onRunCheckup={runCheckup}
      />

      {/* Floating Glassmorphic Mobile Dock */}
      <MobileDock
        activeTab={activeTab}
        setActiveTab={(t) => {
          setActiveTab(t);
          setIsMobileDrawerOpen(false);
        }}
        botStatus={status}
        onOpenDrawer={() => setIsMobileDrawerOpen((prev) => !prev)}
        isDrawerOpen={isMobileDrawerOpen}
      />

      {/* Mobile Action & Navigation Drawer */}
      <MobileDrawer
        isOpen={isMobileDrawerOpen}
        onClose={() => setIsMobileDrawerOpen(false)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        botStatus={status}
        onRunCheckup={runCheckup}
        onResetSession={clearAuthAndRetryConnection}
        isResetting={isClearingAuth}
        onToggleBot={status === "connected" ? stopBot : startBot}
        isStarting={isStartingBot}
      />
    </div>
  );
}
