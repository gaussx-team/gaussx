import type { CardSceneConfig, MarkerBox, SceneMarker } from "./scene";

export interface SceneFrame {
  boxes: MarkerBox[];
  width: number;
  height: number;
  camera: number[];
  preset: string;
}
export interface CardSceneRuntime {
  setPreset(preset: string): void;
  setMarkers(markers: SceneMarker[]): void;
  dispose(): void;
}
export function createCardScene(canvas: HTMLCanvasElement, options: {
  config: CardSceneConfig;
  modelUrl: string;
  markers: SceneMarker[];
  preset: string;
  onFrame(frame: SceneFrame): void;
  onProgress(progress: number | null): void;
  onLoaded(info: { count: number; shDegree?: number }): void;
  onError(error: { kind: "missing" | "webgl" | "load"; message: string }): void;
}): CardSceneRuntime;
