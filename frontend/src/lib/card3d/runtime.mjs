import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { layoutMarkerBoxes, markerPosition, sceneHorizontalFov, scenePresetForWidth } from "./scene.ts";

export function createCardScene(canvas, options) {
  const { config, onFrame, onProgress, onLoaded, onError } = options;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setRGB(...config.background, THREE.SRGBColorSpace);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.08, 100);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minDistance = 0.8;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI * 0.92;
  const spark = new SparkRenderer({ renderer, enableLod: false, sortRadial: false,
    preBlurAmount: 0.3, blurAmount: 0, accumExtSplats: true, minAlpha: 1 / 255, maxStdDev: 3 });
  scene.add(spark);
  let mesh;
  let disposed = false;
  let visible = true;
  let frame = 0;
  let markers = options.markers;
  let markerKey = JSON.stringify(markers);
  let currentPreset = options.preset;
  let cameraPreset;
  const loadAbort = new AbortController();

  function requestRender() {
    if (!disposed && visible && !document.hidden && !frame) frame = requestAnimationFrame(render);
  }
  function render() {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    try {
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const projected = markers.flatMap((marker) => {
        const position = markerPosition(config, marker, cameraPreset);
        if (!position) return [];
        const world = new THREE.Vector3(...position);
        if (world.clone().applyMatrix4(camera.matrixWorldInverse).z >= -camera.near) return [];
        const p = world.project(camera);
        if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1 || p.z < -1 || p.z > 1) return [];
        return [{ id: marker.id, kind: marker.kind, x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 }];
      });
      onFrame({ boxes: layoutMarkerBoxes(projected, width, height, {
        reserved: options.getReservedRects(), presentation: options.presentation,
      }), width, height, camera: [camera.position.x, camera.position.y, camera.position.z], preset: currentPreset, cameraPreset });
      if (spark.sorting) requestRender();
    } catch (error) { onError({ kind: "load", message: error.message }); }
  }
  function setPreset(preset) {
    if (disposed) return;
    currentPreset = preset;
    cameraPreset = scenePresetForWidth(config, preset, canvas.clientWidth);
    const p = config.presets[cameraPreset] ?? config.presets.work;
    const matrix = new THREE.Matrix4().fromArray(p.matrix[0].map((_, column) => p.matrix.map((row) => row[column])).flat());
    matrix.decompose(camera.position, camera.quaternion, camera.scale);
    updateProjection();
    camera.updateMatrixWorld(true);
    controls.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4));
    // Do not call controls.update here: it would alter the validated preset roll.
    requestRender();
  }
  function updateProjection() {
    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    const horizontalFov = sceneHorizontalFov(config, cameraPreset);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(horizontalFov / 2)) / aspect));
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height || disposed) return;
    renderer.setSize(width, height, false);
    // Retain the validated horizontal coverage on a portrait phone.
    updateProjection();
    if (scenePresetForWidth(config, currentPreset, width) !== cameraPreset) setPreset(currentPreset);
    requestRender();
  }
  function contextLost(event) {
    event.preventDefault();
    onError({ kind: "webgl", message: "3D 그래픽 연결이 끊겼어요. 다시 열어 주세요." });
  }
  controls.addEventListener("change", requestRender);
  spark.onDirty = requestRender;
  canvas.addEventListener("webglcontextlost", contextLost);
  document.addEventListener("visibilitychange", requestRender);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestRender();
  });
  intersectionObserver.observe(canvas);
  setPreset(currentPreset);
  resize();

  async function load() {
    try {
      const url = new URL(options.modelUrl, window.location.href);
      // Own the download so leaving the card also cancels a remote transfer.
      const response = await fetch(url, { signal: AbortSignal.any([loadAbort.signal, AbortSignal.timeout(60000)]) });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        if (response.status === 404) {
          if (!disposed) onError({ kind: "missing", message: "3D 장면 파일 없음" });
          return;
        }
        throw new Error(`장면 다운로드 실패 (HTTP ${response.status})`);
      }
      const reader = response.body.getReader();
      const total = Number(response.headers.get("content-length"));
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (!disposed) onProgress(total > 0 ? received / total : null);
      }
      reader.releaseLock();
      if (disposed) return;
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      chunks.length = 0;
      mesh = new SplatMesh({ fileBytes: bytes, fileName: url.pathname, extSplats: true, enableLod: false, lod: false,
        editable: false, raycastable: false });
      await mesh.initialized;
      if (disposed) { mesh.dispose(); return; }
      const count = mesh.splats?.getNumSplats();
      if (count !== config.model.count) throw new Error("장면 파일과 좌표 설정의 Gaussian 수가 달라요.");
      scene.add(mesh);
      onLoaded({ count, shDegree: mesh.splats?.getNumSh() });
      requestRender();
    } catch (error) {
      mesh?.dispose();
      if (!disposed) onError({ kind: /404|not found/i.test(error.message) ? "missing" : "load", message: error.message });
    }
  }
  load();
  return {
    setPreset,
    refreshLayout: requestRender,
    setMarkers(nextMarkers) {
      const nextKey = JSON.stringify(nextMarkers);
      if (nextKey === markerKey) return;
      markers = nextMarkers; markerKey = nextKey; requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loadAbort.abort();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      canvas.removeEventListener("webglcontextlost", contextLost);
      document.removeEventListener("visibilitychange", requestRender);
      if (mesh?.isInitialized) mesh.dispose();
      spark.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
