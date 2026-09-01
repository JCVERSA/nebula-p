export interface HeroUserProps {
  name: string;
  description?: string;
  avatarUrl?: string;
  avatarFallback?: string;
  avatarColor?: "default" | "primary" | "secondary" | "success" | "warning" | "danger";
  className?: string;
}

export default function HeroUser({
  name,
  description,
  avatarUrl,
  avatarFallback,
  avatarColor = "default",
  className = "",
}: HeroUserProps) {
  const colorStyles = {
    default: "bg-zinc-800 text-zinc-300 ring-zinc-700",
    primary: "bg-blue-600 text-white ring-blue-500",
    secondary: "bg-purple-600 text-white ring-purple-500",
    success: "bg-emerald-600 text-white ring-emerald-500",
    warning: "bg-amber-600 text-white ring-amber-500",
    danger: "bg-rose-600 text-white ring-rose-500",
  };

  const initial = avatarFallback || name.slice(0, 2).toUpperCase();

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="relative shrink-0 select-none">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-full object-cover ring-2 ring-white/10"
          />
        ) : (
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ring-2 ${colorStyles[avatarColor]}`}
          >
            {initial}
          </div>
        )}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-bold text-white truncate leading-tight tracking-tight">{name}</span>
        {description && (
          <span className="text-xs text-zinc-400 truncate leading-normal mt-0.5">{description}</span>
        )}
      </div>
    </div>
  );
}
