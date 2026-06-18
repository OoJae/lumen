export function DailyPrompt({ prompt, dateLabel }: { prompt: string; dateLabel: string }) {
  return (
    <div className="mb-5">
      <p className="mb-1 text-xs uppercase tracking-[0.18em] text-muted">{dateLabel}</p>
      <h1 className="font-serif text-2xl leading-snug text-ink sm:text-[1.7rem]">{prompt}</h1>
    </div>
  );
}
