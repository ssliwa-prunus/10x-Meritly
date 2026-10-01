import { useRef, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useFormPending } from "@/components/hooks/useFormPending";
import { cn } from "@/lib/utils";

interface SubmitButtonProps {
  pendingText: string;
  icon?: ReactNode;
  children: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
  /** Forces the pending state (kitchen sink only). */
  pending?: boolean;
}

export function SubmitButton({ pendingText, icon, children, variant, className, pending }: SubmitButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const formPending = useFormPending(ref);
  const isPending = pending ?? formPending;

  return (
    <Button ref={ref} type="submit" variant={variant} disabled={isPending} className={cn(className)}>
      {isPending ? (
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
          />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
