import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { ConnectionsView } from "./connections-view";

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ConnectionsView />
    </Suspense>
  );
}
