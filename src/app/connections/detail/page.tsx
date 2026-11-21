import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { DetailView } from "./detail-view";

export default function ConnectionDetailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <DetailView />
    </Suspense>
  );
}
