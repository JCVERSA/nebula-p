import { FC, useState } from "react";
import { ShieldCheck, X } from "lucide-react";

interface CookieNoticeProps {
  onAccept?: () => void;
  onManage?: () => void;
}

export const CookieNotice: FC<CookieNoticeProps> = ({ onAccept, onManage }) => {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    return localStorage.getItem("nebula_cookie_consent") === "true";
  });

  if (dismissed) return null;

  const handleAccept = () => {
    localStorage.setItem("nebula_cookie_consent", "true");
    setDismissed(true);
    if (onAccept) onAccept();
  };

  const handleManage = () => {
    if (onManage) onManage();
    else {
      localStorage.setItem("nebula_cookie_consent", "true");
      setDismissed(true);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-50 max-w-sm w-[calc(100vw-3rem)] rounded-2xl border border-white/10 bg-[#0b0b0c]/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🍪</span>
          <span className="text-xs font-bold text-white tracking-wide">Session & Cookie Notice</span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-zinc-500 hover:text-zinc-300 p-1 rounded-xl hover:bg-white/5 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        We store encrypted local auth tokens to maintain persistent Baileys session handshakes and WhatsApp API proxy telemetry.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 pt-1 border-t border-white/5">
        <button
          onClick={handleManage}
          className="text-xs font-medium text-zinc-400 hover:text-white underline underline-offset-2 transition"
        >
          Preferences
        </button>
        <button
          onClick={handleAccept}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-black hover:bg-amber-400 transition cursor-pointer shadow-md shadow-amber-500/20"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Accept & Save
        </button>
      </div>
    </div>
  );
};

export default CookieNotice;
