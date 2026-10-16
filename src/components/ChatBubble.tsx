import { MenuCloseMorph } from "./MorphIcon";

interface ChatBubbleProps {
  onClick: () => void;
  isOpen?: boolean;
}

/**
 * Bulle flottante du terminal rapide. 9.18rr : l'icône chat se MORPHE en
 * croix à l'ouverture (concept SwiftSlate de l'APK) — l'état ouvert/fermé
 * se lit d'un coup d'œil, plus de permutation sèche d'icônes.
 */
export default function ChatBubble({ onClick, isOpen }: ChatBubbleProps) {
  return (
    <button
      onClick={onClick}
      title={isOpen ? "Fermer le terminal rapide" : "Ouvrir le terminal & simulateur rapide"}
      aria-expanded={!!isOpen}
      className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-amber-500 text-black shadow-2xl hover:bg-amber-400 hover:scale-105 active:scale-95 transition-all cursor-pointer ring-4 ring-amber-500/20"
    >
      <MenuCloseMorph open={!!isOpen} size={22} stroke="currentColor" strokeWidth={2.2} />
    </button>
  );
}
