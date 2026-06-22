interface TimelineEvent {
  label: string;
  description: string;
  timestamp: string;
  icon: string;
  /** Tailwind classes for the dot background, e.g. "bg-primary" or "bg-status-pending". */
  tone: string;
}

export function ApprovalTimeline({ events, title = "Activity Timeline" }: { events: TimelineEvent[]; title?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h4>
      <div className="relative space-y-6">
        <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border" />
        {events.map((ev, i) => (
          <div key={i} className="relative pl-10">
            <div
              className={`absolute left-0 z-10 flex size-6 items-center justify-center rounded-full border-4 border-card text-primary-foreground ${ev.tone}`}
            >
              <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                {ev.icon}
              </span>
            </div>
            <p className="text-sm font-bold">{ev.label}</p>
            {ev.description && <p className="text-sm text-muted-foreground">{ev.description}</p>}
            {ev.timestamp && <p className="mt-1 text-xs text-muted-foreground/80">{ev.timestamp}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export type { TimelineEvent };
