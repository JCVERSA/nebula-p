export interface Token {
  text: string;
  className?: string;
}

interface CodeLineProps {
  number: number;
  tokens: Token[];
}

export default function CodeLine({ number, tokens }: CodeLineProps) {
  return (
    <div className="flex px-4 leading-6 font-mono text-xs sm:text-sm">
      <span className="mr-4 w-5 shrink-0 select-none text-right text-zinc-600">
        {number}
      </span>
      <span className="whitespace-pre">
        {tokens.map((t, i) => (
          <span key={i} className={t.className ?? "text-zinc-200"}>
            {t.text}
          </span>
        ))}
      </span>
    </div>
  );
}
