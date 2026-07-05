import { RATIO_PRIORITY } from "../../ratios";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Order aspect ratios by the app-wide priority list (base ratio first). */
export function ratioRank(r: string): number {
  const i = RATIO_PRIORITY.indexOf(r);
  return i === -1 ? RATIO_PRIORITY.length : i;
}

const DEFAULT_MODEL = "__default__";

/** Model picker shared by the image and video slots (empty value = default). */
export function ModelSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { id: string; display_name: string }[] }) {
  return (
    <Select value={value || DEFAULT_MODEL} onValueChange={(v) => onChange(v === DEFAULT_MODEL ? "" : v)}>
      <SelectTrigger size="sm" className="w-[170px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
        {options.map((m) => <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Tiny status dot next to a ratio chip: pulsing amber = generating, green = ready. */
export function statusDot(item?: { status: string; base_object_key: string }) {
  if (!item) return null;
  if (item.status === "generating") return <span className="inline-block size-2 animate-pulse rounded-full bg-amber-600" />;
  if (item.status === "ready" && item.base_object_key) return <span className="inline-block size-2 rounded-full bg-emerald-600" />;
  return null;
}
