"use client";

import { useEffect } from "react";
import { OutlineButton, PrimaryButton } from "@/components/ui";
import { actions } from "@/lib/store";

/**
 * Anything that throws while a page renders lands here instead of a blank screen. Saved data
 * the app can't read is the likeliest cause it can't retry its way out of, hence the reset.
 */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-(--app-h) flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[20px] font-bold tracking-tight">Something went wrong</h1>
      <p className="mt-2 max-w-[320px] text-[15px] leading-snug font-light text-fg/80">
        This page couldn&apos;t be shown. Try again; if it keeps happening, resetting the demo data usually fixes it.
      </p>
      <div className="mt-6 w-full max-w-[320px] space-y-2.5">
        <PrimaryButton onClick={retry}>Try again</PrimaryButton>
        <OutlineButton
          onClick={() => {
            actions.reset();
            retry();
          }}
        >
          Reset demo data
        </OutlineButton>
      </div>
    </div>
  );
}
