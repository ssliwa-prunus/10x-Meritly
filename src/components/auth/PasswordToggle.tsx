import { Eye, EyeOff } from "lucide-react";

interface PasswordToggleProps {
  visible: boolean;
  onToggle: () => void;
  /** aria-label while the password is hidden (from the parent form's labels). */
  showLabel: string;
  /** aria-label while the password is shown. */
  hideLabel: string;
}

export function PasswordToggle({ visible, onToggle, showLabel, hideLabel }: PasswordToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute top-1/2 right-3 -translate-y-1/2 text-white/40 transition-colors hover:text-white/70"
      aria-label={visible ? hideLabel : showLabel}
    >
      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}
