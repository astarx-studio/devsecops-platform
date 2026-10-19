import { Suspense } from "react";

import { ConsolePage } from "@/components/ConsolePage";

export default function Home() {
  return (
    <Suspense>
      <ConsolePage />
    </Suspense>
  );
}
