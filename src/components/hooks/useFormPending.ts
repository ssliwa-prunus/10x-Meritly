import { useEffect, useState, type RefObject } from "react";

/**
 * Reports whether the native form containing `ref` has been submitted.
 *
 * Listens for `submit` on `document` (bubble phase), so it runs after React's
 * root-delegated `onSubmit` handlers; a submit cancelled by client validation
 * (`defaultPrevented`) does not count. The state flips on the next tick so the
 * native submission is not affected by the button becoming disabled.
 * A page restored from the back/forward cache resets to not pending.
 */
export function useFormPending(ref: RefObject<HTMLElement | null>): boolean {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onSubmit(event: SubmitEvent) {
      if (event.defaultPrevented) return;
      const form = ref.current?.closest("form");
      if (!form || event.target !== form) return;
      timer = setTimeout(() => {
        setPending(true);
      }, 0);
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setPending(false);
    }

    document.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [ref]);

  return pending;
}
