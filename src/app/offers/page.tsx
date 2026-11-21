import { Suspense } from "react";
import { Header } from "@/components/ui";
import { OffersView } from "./offers-view";

export default function OffersPage() {
  return (
    // The fallback is what the prerendered page shows until the search params are read in the
    // browser: the same header the view renders, so the screen never opens on a spinner.
    <Suspense fallback={<Header title="Offers" back extend />}>
      <OffersView />
    </Suspense>
  );
}
