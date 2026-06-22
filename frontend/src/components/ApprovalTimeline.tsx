interface TimelineEvent {
  label: string;
  description: string;
  timestamp: string;
  icon: string;
  color: string;
}

export function ApprovalTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="bg-white p-lg rounded-xl border border-[#e5e7eb] shadow-sm">
      <h4 className="text-label-md font-bold text-[#4a4455] uppercase tracking-widest mb-md" style={{ fontSize: "0.7rem" }}>Activity Timeline</h4>
      <div className="space-y-6 relative">
        <div className="absolute left-[11px] top-2 bottom-2 w-[2px] bg-[#e5e7eb]" />
        {events.map((ev, i) => (
          <div key={i} className="relative pl-10">
            <div
              className={`absolute left-0 w-6 h-6 rounded-full flex items-center justify-center z-10 border-4 border-white`}
              style={{ backgroundColor: ev.color }}
            >
              <span className="material-symbols-outlined text-[12px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>{ev.icon}</span>
            </div>
            <p className="font-bold text-body-md" style={{ fontSize: "0.85rem" }}>{ev.label}</p>
            <p className="text-body-md text-[#4a4455]" style={{ fontSize: "0.8rem" }}>{ev.description}</p>
            <p className="text-label-sm text-[#7b7486] mt-1" style={{ fontSize: "0.7rem" }}>{ev.timestamp}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
