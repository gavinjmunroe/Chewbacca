"use client";

import { useEffect } from "react";

/**
 * Attaches a `beforeunload` browser warning when `isDirty` is true.
 * This prompts the user before they close the tab or navigate away with
 * unsaved form changes.
 */
export function useBeforeUnload(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      // Modern browsers require preventDefault() to show the dialog.
      e.preventDefault();
      // Legacy support: returnValue must be set (value is ignored by browsers).
      e.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
