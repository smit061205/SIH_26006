import { Suspense, lazy, useState } from "react";
import { useSlots } from "./slots";

// three.js loads only once a page shows its first 3D view.
const SharedCanvas = lazy(() => import("./SharedCanvas"));

/** Mounts the one shared 3D canvas once the page has a 3D view, and keeps it for later pages. */
export function SharedCanvasHost() {
  const slots = useSlots();
  const [needed, setNeeded] = useState(false);
  if (slots.length > 0 && !needed) setNeeded(true);
  if (!needed) return null;
  return (
    <Suspense fallback={null}>
      <SharedCanvas />
    </Suspense>
  );
}
