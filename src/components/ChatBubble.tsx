import { MessageSquareCode, Sparkles } from "lucide-react";

interface ChatBubbleProps {
  onClick: () => void;
  isOpen?: boolean;
}

export default function ChatBubble({ onClick, isOpen }: ChatBubbleProps) {
  return (
    <button
      onClick={onClick}
      title="Open Quick Bot Terminal & Simulator"
      className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-amber-500 text-black shadow-2xl hover:bg-amber-400 hover:scale-105 active:scale-95 transition-all cursor-pointer ring-4 ring-amber-500/20"
    >
      {isOpen ? <Sparkles size={18} className="fill-black" /> : <MessageSquareCode size={20} />}
    </button>
  );
}
