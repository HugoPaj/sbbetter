import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { OffersView } from "./offers-view";

export default function OffersPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OffersView />
    </Suspense>
  );
}
