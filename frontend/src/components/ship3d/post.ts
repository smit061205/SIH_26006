import { N8AOPostPass } from "n8ao";
import { BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { type Quality, TIER } from "./quality";

const GRADE_FRAG = /* glsl */ `
uniform float saturation;
uniform float contrast;
uniform float vignette;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.0 + saturation);
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  float d = length(uv - 0.5);
  c *= mix(1.0, smoothstep(0.85, 0.28, d), vignette);
  outputColor = vec4(max(c, vec3(0.0)), inputColor.a);
}`;

/**
 * AgX is deliberately muted: give back a little colour and contrast, and a
 * light vignette, in one small effect (merged into the tone-mapping pass).
 */
class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", GRADE_FRAG, {
      uniforms: new Map([
        ["saturation", new THREE.Uniform(0.16)],
        ["contrast", new THREE.Uniform(0.06)],
        ["vignette", new THREE.Uniform(0.4)],
      ]),
    });
  }
}

/**
 * One view's post-processing chain, rendering into its own half-float
 * buffers (never to the screen: the shared canvas composites the result):
 * - ambient occlusion (N8AO, half resolution) on high;
 * - bloom on anything brighter than white (navigation lights, sun glint),
 *   at half resolution;
 * - AgX tone mapping, the grade, SMAA.
 */
export class ViewComposer {
  private composer: EffectComposer;
  private size = new THREE.Vector2(0, 0);
  private ao: N8AOPostPass | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality) {
    const tier = TIER[quality];
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    // Keep every pass off the screen: the result stays in a buffer.
    this.composer.autoRenderToScreen = false;
    this.composer.addPass(new RenderPass(scene, camera));
    if (tier.ao) {
      const ao = new N8AOPostPass(scene, camera, 512, 512);
      ao.configuration.aoRadius = 6;
      ao.configuration.distanceFalloff = 1.4;
      ao.configuration.intensity = 2.4;
      ao.configuration.halfRes = true;
      ao.setQualityMode("Performance");
      this.composer.addPass(ao);
      this.ao = ao;
    }
    const effects: Effect[] = [];
    if (tier.bloom) {
      effects.push(new BloomEffect({ mipmapBlur: true, intensity: 0.6, luminanceThreshold: 1.0, luminanceSmoothing: 0.3, radius: 0.72, resolutionScale: 0.5 }));
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }), new GradeEffect(), new SMAAEffect());
    this.composer.addPass(new EffectPass(camera, ...effects));
  }

  /** Resizes the buffers and passes (never the renderer: the canvas is shared). */
  setSize(width: number, height: number) {
    if (this.size.x === width && this.size.y === height) return;
    this.size.set(width, height);
    const c = this.composer as unknown as {
      inputBuffer: THREE.WebGLRenderTarget;
      outputBuffer: THREE.WebGLRenderTarget;
      depthRenderTarget: THREE.WebGLRenderTarget | null;
      passes: { setSize: (w: number, h: number) => void }[];
    };
    c.inputBuffer.setSize(width, height);
    c.outputBuffer.setSize(width, height);
    c.depthRenderTarget?.setSize(width, height);
    for (const pass of c.passes) pass.setSize(width, height);
  }

  /** Occlusion only above the water: under it the haze does that job, and N8AO misreads the solid water background. */
  setUnderwater(below: boolean) {
    if (this.ao) this.ao.enabled = !below;
  }

  /** Renders the chain and returns the texture holding the final image. */
  render(delta: number): THREE.Texture {
    this.composer.render(delta);
    // Each swapping pass leaves the result in the other buffer; follow them.
    let inInput = true;
    for (const pass of this.composer.passes) if (pass.enabled && pass.needsSwap) inInput = !inInput;
    return (inInput ? this.composer.inputBuffer : this.composer.outputBuffer).texture;
  }

  dispose() {
    this.composer.dispose();
  }
}
