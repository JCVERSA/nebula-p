/**
 * Quick / One-Shot Anime Download Parser & Matcher
 * Parses fast commands like:
 *   .a jjk s3 all r2
 *   .a jjk s3 ep6 r2
 *   .a jjk s3 e1,2,3,5,7,8,9 r2
 *   .a jjk s3 2-9 r2
 *   .a solo leveling s1 all
 *   .a demon slayer s2 ep4 720p
 */

export interface QuickDownloadParams {
  rawInput: string;
  animeQuery: string;
  canonicalQuery: string;
  seasonNumber?: number;
  episodesSpec?: string;
  episodesMode?: "all" | "single" | "list" | "range";
  parsedEpisodeNumbers?: number[]; // 1-indexed numbers
  resolutionChoice?: string; // "r1", "r2", "r3", "r4", "1080P", "720P", "480P", "360P"
  language?: "VF" | "VOSTFR";
  isQuickCommand: boolean;
}

export const ANIME_ACRONYMS: Record<string, string> = {
  "jjk": "Jujutsu Kaisen",
  "jujutsu kaisen": "Jujutsu Kaisen",
  "snk": "Shingeki no Kyojin",
  "aot": "Attack on Titan",
  "attack on titan": "Attack on Titan",
  "shingeki no kyojin": "Shingeki no Kyojin",
  "ds": "Demon Slayer",
  "kny": "Kimetsu no Yaiba",
  "demon slayer": "Demon Slayer",
  "kimetsu no yaiba": "Kimetsu no Yaiba",
  "mha": "My Hero Academia",
  "bnha": "Boku no Hero Academia",
  "my hero academia": "My Hero Academia",
  "boku no hero academia": "Boku no Hero Academia",
  "op": "One Piece",
  "one piece": "One Piece",
  "hxh": "Hunter x Hunter",
  "hunter x hunter": "Hunter x Hunter",
  "csm": "Chainsaw Man",
  "chainsaw man": "Chainsaw Man",
  "sao": "Sword Art Online",
  "sword art online": "Sword Art Online",
  "opm": "One Punch Man",
  "one punch man": "One Punch Man",
  "sl": "Solo Leveling",
  "solo leveling": "Solo Leveling",
  "fma": "Fullmetal Alchemist",
  "fmab": "Fullmetal Alchemist: Brotherhood",
  "fullmetal alchemist": "Fullmetal Alchemist",
  "tg": "Tokyo Ghoul",
  "tokyo ghoul": "Tokyo Ghoul",
  "bc": "Black Clover",
  "black clover": "Black Clover",
  "dn": "Death Note",
  "death note": "Death Note",
  "dbz": "Dragon Ball Z",
  "dragon ball z": "Dragon Ball Z",
  "dbs": "Dragon Ball Super",
  "dragon ball super": "Dragon Ball Super",
  "dragon ball": "Dragon Ball",
  "bleach": "Bleach",
  "naruto": "Naruto",
  "boruto": "Boruto",
  "cg": "Code Geass",
  "code geass": "Code Geass",
  "eva": "Neon Genesis Evangelion",
  "dr stone": "Dr. Stone",
  "drstone": "Dr. Stone",
  "jojo": "JoJo's Bizarre Adventure",
  "jjba": "JoJo's Bizarre Adventure",
  "slime": "Tensei shitara Slime Datta Ken",
  "tensura": "Tensei shitara Slime Datta Ken",
  "cote": "Classroom of the Elite",
  "classroom of the elite": "Classroom of the Elite",
  "oshi no ko": "Oshi no Ko",
  "onk": "Oshi no Ko",
  "vinland": "Vinland Saga",
  "vinland saga": "Vinland Saga",
  "blue lock": "Blue Lock",
  "frieren": "Sousou no Frieren",
  "apothecary": "Kusuriya no Hitorigoto",
  "apothecary diaries": "Kusuriya no Hitorigoto",
  "kaiju no 8": "Kaiju No. 8",
  "kaiju 8": "Kaiju No. 8",
  "dandadan": "Dandadan",
  "wind breaker": "Wind Breaker"
};

/**
 * Normalizes text for comparison (lowercased, stripped of punctuation, accents & extra spaces)
 */
export function normalizeTitle(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse one-shot quick command arguments into structured download parameters.
 */
export function parseQuickDownloadParams(input: string[] | string): QuickDownloadParams {
  const tokens: string[] = Array.isArray(input)
    ? [...input]
    : input.trim().split(/\s+/).filter(Boolean);

  const rawInput = Array.isArray(input) ? input.join(" ") : input;

  let language: "VF" | "VOSTFR" | undefined;
  let resolutionChoice: string | undefined;
  let seasonNumber: number | undefined;
  let episodesSpec: string | undefined;
  let episodesMode: "all" | "single" | "list" | "range" | undefined;
  let parsedEpisodeNumbers: number[] | undefined;

  // Working copy of tokens to mutate
  const remainingTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();

    // 1. Language detection
    if (lower === "vf" || lower === "vostfr") {
      language = lower === "vf" ? "VF" : "VOSTFR";
      continue;
    }

    // 2. Resolution detection (e.g. r1, r2, r3, 1080p, 720p, 480p, 360p or 'r 1')
    const rSingleMatch = lower.match(/^r(\d+)$/i) || lower.match(/^res(\d+)$/i);
    if (rSingleMatch) {
      resolutionChoice = `r${rSingleMatch[1]}`;
      continue;
    }

    if (/^(1080p|720p|480p|360p)$/i.test(lower)) {
      resolutionChoice = lower.toUpperCase();
      continue;
    }

    if ((lower === "r" || lower === "res" || lower === "resolution") && i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) {
      resolutionChoice = `r${tokens[i + 1]}`;
      i++; // skip next token
      continue;
    }

    // 3. Season detection (e.g. s1, s2, s03, saison1, season2 or 's 1')
    const sMatch = lower.match(/^(?:s|saison|season)(\d+)$/i);
    if (sMatch) {
      seasonNumber = parseInt(sMatch[1], 10);
      continue;
    }

    if ((lower === "s" || lower === "saison" || lower === "season") && i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) {
      seasonNumber = parseInt(tokens[i + 1], 10);
      i++; // skip next token
      continue;
    }

    // 4. Episode mode detection
    // A. "all" or "tout"
    if (lower === "all" || lower === "tout" || lower === "all-episodes" || lower === "full") {
      episodesSpec = "all";
      episodesMode = "all";
      continue;
    }

    // B. Range (e.g. 2-9, e2-e9, ep1-ep5, 1-12)
    const rangeMatch = lower.match(/^(?:ep|e)?(\d+)\s*-\s*(?:ep|e)?(\d+)$/i);
    if (rangeMatch) {
      episodesSpec = token;
      episodesMode = "range";
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      parsedEpisodeNumbers = [];
      for (let n = min; n <= max; n++) {
        parsedEpisodeNumbers.push(n);
      }
      continue;
    }

    // C. List of episodes (e.g. e1,2,3,5,7,8,9 or 1,2,3,5,7 or ep1,ep2,ep3)
    if (lower.includes(",") && /^(?:ep|e)?\d+(?:,\s*(?:ep|e)?\d+)+$/i.test(lower)) {
      episodesSpec = token;
      episodesMode = "list";
      const parts = lower.split(",").map(p => p.trim());
      const nums: number[] = [];
      for (const p of parts) {
        const m = p.match(/^(?:ep|e)?(\d+)$/i);
        if (m) {
          nums.push(parseInt(m[1], 10));
        }
      }
      parsedEpisodeNumbers = nums;
      continue;
    }

    // D. Single episode with 'ep' or 'e' prefix (e.g. ep6, e6, ep01)
    const epPrefixMatch = lower.match(/^(?:ep|e)(\d+)$/i);
    if (epPrefixMatch) {
      episodesSpec = token;
      episodesMode = "single";
      parsedEpisodeNumbers = [parseInt(epPrefixMatch[1], 10)];
      continue;
    }

    // Otherwise, this token is likely part of the anime title
    remainingTokens.push(token);
  }

  // If seasonNumber was detected, check if the last remaining token is a standalone number representing episode
  if (seasonNumber !== undefined && episodesSpec === undefined && remainingTokens.length > 0) {
    const lastToken = remainingTokens[remainingTokens.length - 1];
    if (/^\d+$/.test(lastToken) && remainingTokens.length > 1) {
      episodesSpec = lastToken;
      episodesMode = "single";
      parsedEpisodeNumbers = [parseInt(lastToken, 10)];
      remainingTokens.pop();
    }
  }

  const animeQuery = remainingTokens.join(" ").trim();
  const lowerQuery = animeQuery.toLowerCase();
  const canonicalQuery = ANIME_ACRONYMS[lowerQuery] || animeQuery;

  const isQuickCommand = seasonNumber !== undefined || episodesSpec !== undefined;

  return {
    rawInput,
    animeQuery,
    canonicalQuery,
    seasonNumber,
    episodesSpec,
    episodesMode,
    parsedEpisodeNumbers,
    resolutionChoice,
    language,
    isQuickCommand
  };
}

/**
 * Checks if search results contain a high-confidence exact match vs ambiguous results
 */
export function isExactAnimeMatch(
  searchQuery: string,
  results: Array<{ title: string; subtitle?: string; url: string }>
): { isExact: boolean; exactMatchIndex: number } {
  if (!results || results.length === 0) {
    return { isExact: false, exactMatchIndex: -1 };
  }

  const normQuery = normalizeTitle(searchQuery);
  const canonical = ANIME_ACRONYMS[searchQuery.toLowerCase().trim()];
  const normCanonical = canonical ? normalizeTitle(canonical) : "";

  // 1. If only 1 result returned, it is unambiguous
  if (results.length === 1) {
    return { isExact: true, exactMatchIndex: 0 };
  }

  // 2. Check for exact title match with canonical acronym or search query
  for (let i = 0; i < results.length; i++) {
    const normTitle = normalizeTitle(results[i].title);
    if (normCanonical && normTitle === normCanonical) {
      return { isExact: true, exactMatchIndex: i };
    }
    if (normTitle === normQuery) {
      return { isExact: true, exactMatchIndex: i };
    }
  }

  // 3. Check if the first result starts with the query as a standalone main franchise
  // (e.g. query "solo leveling", result 1 is "Solo Leveling", result 2 is "Solo Leveling: ReAwakening")
  const firstTitleNorm = normalizeTitle(results[0].title);
  if (
    (normCanonical && firstTitleNorm === normCanonical) ||
    firstTitleNorm === normQuery ||
    (normCanonical && firstTitleNorm.startsWith(normCanonical + " ")) ||
    (normQuery.length >= 6 && firstTitleNorm === normQuery)
  ) {
    return { isExact: true, exactMatchIndex: 0 };
  }

  // Otherwise, if the query was vague (e.g. "solo lev", "demon", "dragon", "fate"), it's ambiguous
  return { isExact: false, exactMatchIndex: -1 };
}

/**
 * Maps a quick-mode resolution choice to its CANONICAL quality label:
 * r1=480P, r2=360P, r3=720P, r4=1080P (the menu shown to users), plus the
 * explicit forms (480p/720p/…). Quick mode has no visible variant list, so
 * rN must NEVER be treated as an index into a mirror-specific track list
 * (audit §8.3: `.a rezero s5 ep2 r2` once resolved to 1080P because the
 * first extractable mirror only exposed [720P, 1080P]).
 */
export function canonicalResolutionForChoice(choice: string): string {
  const c = (choice || "").trim().toLowerCase();
  const m = c.match(/^r(\d+)$/);
  if (m) {
    const idx = parseInt(m[1], 10);
    const map = ["480P", "360P", "720P", "1080P"];
    return map[Math.min(Math.max(idx, 1), map.length) - 1];
  }
  if (/^(1080p|720p|480p|360p)$/.test(c)) return c.toUpperCase();
  return "480P";
}

/**
 * Resolves the requested season from an anime's parsed season list
 */
export function resolveRequestedSeason(
  seasons: Array<{ name: string; subPath: string; url: string }>,
  requestedSeasonNumber: number
): { season: { name: string; subPath: string; url: string } | null; index: number } {
  if (!seasons || seasons.length === 0) {
    return { season: null, index: -1 };
  }

  // 1. Try matching by season number in name or subPath (e.g. "Saison 3", "saison3", "s3")
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    const numMatch = s.name.match(/\d+/) || s.subPath.match(/saison(\d+)/i) || s.subPath.match(/season(\d+)/i);
    if (numMatch && parseInt(numMatch[1] || numMatch[0], 10) === requestedSeasonNumber) {
      return { season: s, index: i };
    }
  }

  // 2. Fallback to 1-based index ONLY when the entry at that position is
  // actually a season (not a film/OAV) — otherwise ".a <anime> s3" on a
  // 2-season + film catalog would silently download the film (audit R6).
  const idx = requestedSeasonNumber - 1;
  if (idx >= 0 && idx < seasons.length) {
    const candidate = seasons[idx];
    const looksLikeSeason = /saison|season/i.test(candidate.name) || /saison\d+|season\d+/i.test(candidate.subPath);
    if (looksLikeSeason) {
      return { season: candidate, index: idx };
    }
  }

  return { season: null, index: -1 };
}

/**
 * Computes 0-based episode indices from parsed quick download params and total available episodes.
 */
export function resolveRequestedEpisodes(
  totalEpisodes: number,
  quickParams: QuickDownloadParams
): number[] {
  if (totalEpisodes <= 0) return [];

  // Mode: All
  if (quickParams.episodesMode === "all") {
    return Array.from({ length: totalEpisodes }, (_, i) => i);
  }

  // Explicit parsed episode numbers (e.g. [1, 2, 3, 5, 7, 8, 9] or [6] or [2..9])
  if (quickParams.parsedEpisodeNumbers && quickParams.parsedEpisodeNumbers.length > 0) {
    const indices: number[] = [];
    for (const num of quickParams.parsedEpisodeNumbers) {
      if (num >= 1 && num <= totalEpisodes) {
        const idx = num - 1;
        if (!indices.includes(idx)) {
          indices.push(idx);
        }
      }
    }
    return indices;
  }

  // Default: Episode 1 (index 0)
  return [0];
}
