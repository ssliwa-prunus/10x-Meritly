import { cn } from "@/lib/utils";

/** Shared input styling for the admin settings forms. */
export const inputClass = cn(
  "w-full min-w-0 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white",
  "focus:border-purple-300 focus:ring-2 focus:ring-purple-300/40 focus:outline-none",
);

/** Shared submit-button styling for the admin settings forms. */
export const buttonClass =
  "rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm whitespace-nowrap transition-colors hover:bg-white/20";
