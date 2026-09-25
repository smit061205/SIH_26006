declare module "n8ao" {
  import type { Pass } from "postprocessing";
  import type { Camera, Scene } from "three";
  /** N8AO screen-space ambient occlusion as a postprocessing pass (the package ships no types). */
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: { aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean; [key: string]: unknown };
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void;
  }
}
