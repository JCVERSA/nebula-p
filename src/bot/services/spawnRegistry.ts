import type { ChildProcess } from "child_process";

/**
 * 9.18ggg — registre des sous-processus média (ffmpeg/ffprobe/yt-dlp).
 *
 * Audit 17/10 (§6) : à l'arrêt d'un moteur, le balayage de manage.sh ne
 * tue que les process engine.cjs — leurs PETITS-FILS ffmpeg/yt-dlp
 * survivent comme orphelins et continuent de consommer le cœur unique du
 * VPS pendant que le moteur redémarre. Chaque site de spawn média
 * enregistre son enfant via trackSpawn() ; l'arrêt du moteur (engine.ts,
 * SIGTERM du superviseur) termine tout le registre avant de sortir.
 *
 * Le registre n'OBSERVE que (exit/error → retrait) : les timeouts et
 * kills propres à chaque site restent maîtres de leur enfant.
 */

const tracked = new Set<ChildProcess>();

/** Enregistre un spawn ; le retire automatiquement à sa mort. */
export function trackSpawn<T extends ChildProcess>(child: T): T {
  try {
    tracked.add(child);
    child.once("exit", () => tracked.delete(child));
    child.once("error", () => tracked.delete(child)); // spawn raté (ENOENT) : jamais d'exit
  } catch {
    // Enfant non standard (mocks de tests, demi-ChildProcess) : le suivi est
    // best-effort, il ne doit JAMAIS faire échouer l'appelant (leçon
    // ffmpegKitSignal : un trackSpawn qui jette tuait runFfmpegKit).
    try {
      tracked.delete(child);
    } catch {}
  }
  return child;
}

/** Enfants média vivants à l'instant T (observabilité/tests). */
export function trackedSpawnCount(): number {
  return tracked.size;
}

/**
 * Termine tous les enfants enregistrés : SIGTERM, grâce, puis SIGKILL sur
 * les survivants. Ne jette jamais — appelé depuis le shutdown du moteur.
 */
export async function terminateTrackedSpawns(graceMs = 2000): Promise<void> {
  if (tracked.size === 0) return;
  for (const child of [...tracked]) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  const deadline = Date.now() + Math.max(0, graceMs);
  while (tracked.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const child of [...tracked]) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  tracked.clear();
}
