import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * A text label that always faces the camera, drawn onto a canvas texture:
 * no DOM overlay, so nothing to mount or unmount while the scene renders.
 */
export function Label({
  text,
  position,
  color,
  background,
  height = 7,
}: {
  text: string;
  position: [number, number, number];
  color: string;
  background: string;
  /** Label height in metres; the width follows the text. */
  height?: number;
}) {
  const { texture, aspect } = useMemo(() => {
    const scale = 4;
    const fontPx = 13 * scale;
    const pad = 6 * scale;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = `600 ${fontPx}px "Source Sans 3 Variable", "Source Sans 3", "Noto Sans Devanagari", sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = fontPx + pad * 1.4;
    canvas.width = w;
    canvas.height = h;
    ctx.font = font;
    ctx.fillStyle = background;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 3 * scale);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, pad, h / 2 + scale);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { texture: t, aspect: w / h };
  }, [text, color, background]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={10}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}
