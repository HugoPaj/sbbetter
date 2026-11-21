import { Suspense } from "react";
import { Header } from "@/components/ui";
import { DetailView } from "./detail-view";

export default function ConnectionDetailPage() {
  return (
    // The fallback is what the prerendered page shows until the search params are read in the
    // browser: the same header the view renders, so the screen never opens on a spinner.
    <Suspense fallback={<Header title="Connection" back extend />}>
      <DetailView />
    </Suspense>
  );
}
