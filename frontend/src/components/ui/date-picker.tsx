import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateTimePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  className?: string;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick date & time",
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);

  function handleDaySelect(day: Date | undefined) {
    if (!day) return;
    const existing = value ?? new Date();
    day.setHours(existing.getHours(), existing.getMinutes(), 0, 0);
    onChange(day);
  }

  function handleTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const time = e.target.value;
    if (!time) return;
    const [h, m] = time.split(":").map(Number);
    const base = value ? new Date(value) : new Date();
    base.setHours(h, m, 0, 0);
    onChange(base);
  }

  return (
    <div className={cn("flex gap-2 items-center", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="flex-1 justify-start font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, "PPP") : <span className="text-muted-foreground">{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ?? undefined}
            onSelect={handleDaySelect}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={value ? `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}` : ""}
        onChange={handleTimeChange}
        className="w-[120px]"
      />
    </div>
  );
}
