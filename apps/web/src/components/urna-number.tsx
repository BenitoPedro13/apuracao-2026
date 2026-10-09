import { partyColor } from "@/lib/party";
import { cn } from "@/lib/utils";

// The page's signature (TASK-urna-number.md §2.1): the candidate's number as the urna's
// screen shows it, one box per digit, the box in the party's colour. Decorative: the number
// is always written in text next to it, so the boxes are hidden from screen readers.

const SIZE = {
  lg: "h-11 w-8 text-2xl",
  md: "h-7 w-5 text-base",
  sm: "h-[1.15rem] w-[0.85rem] text-[11px]",
} as const;

export function UrnaNumber({ n, party, size = "sm", className }: { n: string; party: string; size?: keyof typeof SIZE; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0", size === "lg" ? "gap-1" : "gap-0.5", className)}>
      {[...n].map((d, i) => (
        <span
          key={i}
          className={cn(
            "inline-flex items-center justify-center rounded-[2px] bg-panel font-mono leading-none font-semibold text-ink",
            size === "sm" ? "border" : "border-2",
            SIZE[size],
          )}
          style={{ borderColor: partyColor(party) }}
        >
          {d}
        </span>
      ))}
    </span>
  );
}
