export interface BotConfig {
  botName: string;
  prefix: string;
  botImage: string;
  ownerNumber: string;
  newsletterUrl: string;
  newsletterName: string;
  sessionString?: string;
  browserPlatform?: string;
  browserName?: string;
  browserVersion?: string;
}

export interface BotCommand {
  name: string;
  category: string;
  parentCategory?: string;
  description: string;
  usage: string;
  aliases?: string[];
}


export interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  senderName: string;
  text: string;
  imageUrl?: string;
  emoji?: string;
  timestamp: string;
  isAudio?: boolean;
  audioDuration?: string;
}

export type ConnectionStatus = "disconnected" | "connecting" | "qr_ready" | "pairing_code_ready" | "connected" | "error";

export interface CheckupTestResult {
  name: string;
  category: "registry" | "simulation" | "storage" | "dependencies" | "security" | "ai";
  status: "pass" | "fail" | "warn";
  latencyMs: number;
  message: string;
  details?: any;
}

export interface CheckupReport {
  timestamp: string;
  overallStatus: "healthy" | "warning" | "degraded";
  healthScore: number;
  durationMs: number;
  system: {
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    memory: {
      heapUsedMB: number;
      heapTotalMB: number;
      rssMB: number;
    };
    pid: number;
  };
  commands: {
    totalRegistered: number;
    byCategory: Record<string, number>;
    uniqueNamesCount: number;
    aliasesCount: number;
  };
  tests: CheckupTestResult[];
  dependencies: {
    name: string;
    available: boolean;
    version?: string;
  }[];
}
