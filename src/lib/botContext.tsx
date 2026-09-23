import { createContext, useCallback, useContext } from "react";
import type { ReactNode } from "react";
import { withBotParam } from "./botSelection";

/**
 * Multi-bots (8.77) — contexte du bot sélectionné dans le panneau.
 *
 * App.tsx enveloppe le corps du tableau de bord dans le provider ; les
 * composants enfuis qui font leurs propres requêtes par-bot (batchs, groupes,
 * sécurité…) récupèrent l'URL routée via useBotUrl() au lieu de prop-driller
 * l'identifiant dans toute l'arborescence.
 */

const ActiveBotContext = createContext<string | null>(null);

export function ActiveBotProvider({ botId, children }: { botId: string | null; children: ReactNode }) {
  return <ActiveBotContext.Provider value={botId}>{children}</ActiveBotContext.Provider>;
}

/** Identifiant du bot actuellement sélectionné (null = bot par défaut). */
export function useActiveBotId(): string | null {
  return useContext(ActiveBotContext);
}

/** Fabrique d'URL : ajoute ?bot=<id> aux routes par-bot quand un bot est sélectionné. */
export function useBotUrl(): (url: string) => string {
  const botId = useContext(ActiveBotContext);
  return useCallback((url: string) => withBotParam(url, botId), [botId]);
}
