import { useEffect, useState } from "react";
import type { CanvasStats } from "./SharedCanvas";

/** Developer tools: the shared 3D canvas's frame rate, view renders, draw calls and CPU time, once a second. */
export function PerfReadout() {
  const [stats, setStats] = useState<CanvasStats | null>(null);
  useEffect(() => {
    let alive = true;
    const id = window.setInterval(() => {
      void import("./SharedCanvas").then((m) => alive && setStats({ ...m.canvasStats }));
    }, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  if (!stats) return null;
  const canvases = document.querySelectorAll("canvas").length;
  return (
    <p className="font-mono text-[12.5px] text-ink-3" aria-live="off">
      {stats.frames} canvas fps · {stats.renders} view renders/s · {stats.calls} draw calls · {Math.round(stats.triangles / 1000)}k tris · {stats.cpuMs.toFixed(1)} ms CPU · quality {stats.quality} · {canvases}{" "}
      {canvases === 1 ? "canvas" : "canvases"}
    </p>
  );
}
