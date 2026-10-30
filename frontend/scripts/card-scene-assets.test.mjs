import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { makeConfig, preserveSurfacePins, readSpzHeader } from "./prepare-card-scene.mjs";
import { fetchCardScene } from "./fetch-card-scene.mjs";

const config = JSON.parse(await readFile(new URL("../public/scenes/card-active.json", import.meta.url), "utf8"));
const anchor = (id) => config.anchors.find((item) => item.id === id).position;

function surfacePinFixture() {
  const base = structuredClone(config);
  delete base.metadata.surfacePins;
  base.metadata.anchorLimit = "기존 거리 기준 앵커는 가시 표면점이 아님";
  for (const preset of Object.values(base.presets)) delete preset.pinPositions;
  const pinned = structuredClone(base);
  pinned.presets.work.pinPositions = { "MCC-3": [4.1, 4.6, 2], "P-203": null };
  pinned.presets.nearby.pinPositions = { "PU-07": [3.1, 7.5, 1.2], "T-02": null };
  pinned.presets.nearby_mobile.pinPositions = { "MCC-3": null };
  pinned.metadata.surfacePins = {
    schema: "blender-camera-raycast-v1",
    sourceBlendSha256: "a".repeat(64),
    generatedAt: "2026-10-31T00:00:00.000Z",
  };
  pinned.metadata.anchorLimit = "anchors는 거리 기준점, pinPositions는 카메라별 표면점이며 null은 가려짐";
  return { base, pinned };
}

test("scene preparation keeps surface pins across the actual source cameras' negative-zero JSON boundary", () => {
  const { pinned } = surfacePinFixture();
  const sourcePresets = Object.entries(pinned.presets)
    .filter(([id]) => !["work", "nearby", "nearby_mobile", "admin"].includes(id))
    .map(([id, preset]) => ({ id, label: preset.label, frame: { matrix: structuredClone(preset.matrix) } }));
  // These two -0 values are present in the original viewer/data/v2d/presets.json.
  for (const id of ["upper_overview", "P-203"]) {
    sourcePresets.find((preset) => preset.id === id).frame.matrix[2][0] = -0;
    assert.ok(Object.is(pinned.presets[id].matrix[2][0], 0));
  }
  const inputs = {
    scene: {
      model: { count: pinned.model.count }, background: { sRGB: pinned.background },
      intrinsics: { w: 1280, fx: 853.3333333333334 },
    },
    anchors: { anchors: structuredClone(pinned.anchors) },
    presets: sourcePresets,
    modelUrl: pinned.model.url,
    format: pinned.model.format,
    sourceSha256: pinned.metadata.sourceSha256,
    previousConfig: pinned,
  };
  const prepared = makeConfig(inputs);
  assert.deepEqual(prepared.anchors, pinned.anchors, "real distance anchors must remain unchanged");
  assert.deepEqual(prepared.presets, pinned.presets, "all actual cameras and raycast points must survive regeneration");
  assert.deepEqual(prepared, pinned, "the actual cache comparison must accept the serialized configuration unchanged");
  const cameraChanged = structuredClone(inputs);
  cameraChanged.presets.find((preset) => preset.id === "upper_overview").frame.matrix[0][3] += 0.001;
  const invalidated = makeConfig(cameraChanged);
  assert.equal(invalidated.metadata.surfacePins, undefined, "a real camera move must still discard old raycasts");
  assert.ok(Object.values(invalidated.presets).every((preset) => preset.pinPositions === undefined));
});

test("surface pins preserve visible points, hidden nulls and provenance without changing distance anchors", () => {
  const { base, pinned } = surfacePinFixture();
  const originalBase = structuredClone(base);
  const originalPinned = structuredClone(pinned);
  const prepared = preserveSurfacePins(base, pinned);
  assert.deepEqual(prepared, pinned, "the prepared config must still match the existing config for the unchanged path");
  assert.deepEqual(preserveSurfacePins(base, prepared), pinned, "repeated preparation must preserve the same surface results");
  assert.deepEqual(prepared.anchors, base.anchors);
  assert.equal(prepared.presets.work.pinPositions["P-203"], null);
  assert.equal(prepared.presets.nearby.pinPositions["T-02"], null);
  assert.deepEqual(base, originalBase, "preparation must not mutate its generated base config");
  assert.deepEqual(pinned, originalPinned, "preparation must not mutate the existing config");
  prepared.presets.work.pinPositions["MCC-3"][0] = 0;
  prepared.metadata.surfacePins.generatedAt = "changed";
  assert.deepEqual(pinned, originalPinned, "preserved points and provenance must be independent copies");
});

test("surface pins are discarded for a different scene, model, source, distance anchors or coordinate frame", () => {
  const changes = [
    ["scene", (scene) => { scene.id = "fullsite-v3r"; }],
    ["model URL", (scene) => { scene.model.url = "/scenes/replaced.spz"; }],
    ["model count", (scene) => { scene.model.count += 1; }],
    ["model SH", (scene) => { scene.model.shDegree = 2; }],
    ["source SHA", (scene) => { scene.metadata.sourceSha256 = "b".repeat(64); }],
    ["anchor", (scene) => { scene.anchors[0].position[2] += 0.1; }],
    ["coordinate system", (scene) => { scene.coordinateSystem = "Y-up meters"; }],
    ["coordinate transform", (scene) => { scene.metadata.coordinateTransform = "rotated"; }],
    ["FOV", (scene) => { scene.horizontalFovDegrees += 1; }],
  ];
  for (const [name, change] of changes) {
    const { base, pinned } = surfacePinFixture();
    change(base);
    assert.deepEqual(preserveSurfacePins(base, pinned), base, `${name} must invalidate previous raycast results`);
  }
});

test("surface pins are not reused after any preset camera is changed, added or removed", () => {
  const changes = [
    ["work camera", (scene) => { scene.presets.work.matrix[0][3] += 0.01; }],
    ["mobile camera", (scene) => { scene.presets.nearby_mobile.matrix[1][3] += 0.01; }],
    ["added camera", (scene) => { scene.presets.newCamera = structuredClone(scene.presets.work); }],
    ["removed camera", (scene) => { delete scene.presets.nearby; }],
  ];
  for (const [name, change] of changes) {
    const { base, pinned } = surfacePinFixture();
    change(base);
    assert.deepEqual(preserveSurfacePins(base, pinned), base, `${name} must invalidate the old camera-specific results`);
  }
});

test("surface pins reject legacy or malformed provenance and invalid per-equipment positions", () => {
  const changes = [
    ["no provenance", (scene) => { delete scene.metadata.surfacePins; }],
    ["wrong schema", (scene) => { scene.metadata.surfacePins.schema = "unverified-v0"; }],
    ["missing blend SHA", (scene) => { delete scene.metadata.surfacePins.sourceBlendSha256; }],
    ["invalid blend SHA", (scene) => { scene.metadata.surfacePins.sourceBlendSha256 = "unknown"; }],
    ["missing anchor explanation", (scene) => { delete scene.metadata.anchorLimit; }],
    ["unknown equipment", (scene) => { scene.presets.work.pinPositions.unknown = [1, 2, 3]; }],
    ["non-finite point", (scene) => { scene.presets.work.pinPositions["MCC-3"][0] = NaN; }],
    ["truncated point", (scene) => { scene.presets.work.pinPositions["MCC-3"] = [1, 2]; }],
    ["null record", (scene) => { scene.presets.work.pinPositions = null; }],
    ["array record", (scene) => { scene.presets.work.pinPositions = []; }],
  ];
  for (const [name, change] of changes) {
    const { base, pinned } = surfacePinFixture();
    change(pinned);
    assert.deepEqual(preserveSurfacePins(base, pinned), base, `${name} must not be copied into a new preparation`);
  }
  const { base } = surfacePinFixture();
  assert.deepEqual(preserveSurfacePins(base, undefined), base);
  assert.deepEqual(preserveSurfacePins(base, base), base, "legacy anchor-only configs must retain the normal preparation path");
});

test("the checked-in scene is a local model with a complete Z-up camera and anchor contract", () => {
  assert.equal(config.version, 1);
  assert.equal(config.coordinateSystem, "Blender Z-up meters");
  assert.match(config.model.url, /^\/scenes\/[^/]+\.(spz|ply)$/);
  assert.equal(config.model.count, 998276);
  assert.equal(config.model.shDegree, 3);
  assert.equal(config.defaultWorkEquipment, "MCC-3");
  assert.equal(new Set(config.anchors.map((item) => item.id)).size, 6);
  for (const item of config.anchors) {
    assert.equal(item.position.length, 3);
    assert.ok(item.position.every(Number.isFinite));
    assert.ok(config.presets[item.id]);
  }
  for (const preset of Object.values(config.presets)) {
    assert.equal(preset.matrix.length, 4);
    assert.ok(preset.matrix.every((row) => row.length === 4 && row.every(Number.isFinite)));
    assert.deepEqual(preset.matrix[3], [0, 0, 0, 1]);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(Math.hypot(...preset.matrix.slice(0, 3).map((row) => row[axis])) - 1) < 1e-8);
    }
  }
  assert.deepEqual(config.presets.work.matrix, config.presets["MCC-3"].matrix);
});

test("nearby chemical process anchors use actual metre distances and the configured display range", () => {
  const origin = anchor("MCC-3");
  const distances = Object.fromEntries(config.contextEquipment.map((id) => [id,
    Math.hypot(...anchor(id).map((value, axis) => value - origin[axis]))]));
  assert.ok(Math.abs(distances["PU-07"] - 3.2268543) < 1e-6);
  assert.ok(Math.abs(distances["P-203"] - 6.0688054) < 1e-6);
  assert.ok(Math.abs(distances["T-02"] - 7.1590851) < 1e-6);
  assert.ok(Object.values(distances).every((distance) => distance > 0 && distance <= config.nearbyRadiusMeters));
});

test("the context camera places the work and all three hazards in front and inside its source frame", () => {
  const tanHalfHorizontal = Math.tan(config.horizontalFovDegrees * Math.PI / 360);
  for (const [preset, aspect] of [["nearby", 16 / 9], ["nearby_mobile", 311 / 306], ["nearby_mobile", 326 / 306]]) {
    const matrix = config.presets[preset].matrix;
    for (const id of [config.defaultWorkEquipment, ...config.contextEquipment]) {
      const delta = anchor(id).map((value, axis) => value - matrix[axis][3]);
      const local = [0, 1, 2].map((axis) => delta.reduce((sum, value, row) => sum + value * matrix[row][axis], 0));
      assert.ok(local[2] < 0, `${id} must be in front of the camera`);
      assert.ok(Math.abs(local[0] / -local[2]) < tanHalfHorizontal, `${id} must fit horizontally`);
      assert.ok(Math.abs(local[1] / -local[2]) < tanHalfHorizontal / aspect, `${id} must fit vertically in ${preset}`);
    }
  }
});

test("the admin overview keeps all six real surface pins inside its tall panel", () => {
  const preset = config.presets.admin;
  const tanHalfHorizontal = Math.tan(preset.horizontalFovDegrees * Math.PI / 360);
  for (const item of config.anchors) {
    const position = preset.pinPositions[item.id];
    assert.ok(position, `${item.id} must have a visible mesh surface in the admin view`);
    const delta = position.map((value, axis) => value - preset.matrix[axis][3]);
    const local = [0, 1, 2].map((axis) => delta.reduce((sum, value, row) => sum + value * preset.matrix[row][axis], 0));
    assert.ok(local[2] < 0);
    assert.ok(Math.abs(local[0] / -local[2]) < tanHalfHorizontal, `${item.id} must fit horizontally`);
    assert.ok(Math.abs(local[1] / -local[2]) < tanHalfHorizontal / (668 / 670), `${item.id} must fit vertically`);
  }
});

test("SPZ headers reject corrupt data rather than accepting a misleading Gaussian count", () => {
  const header = Buffer.alloc(16 + 2 * 65);
  header.writeUInt32LE(0x5053474e, 0);
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(2, 8);
  header[12] = 3;
  header[13] = 12;
  assert.deepEqual(readSpzHeader(gzipSync(header)), { version: 3, count: 2, shDegree: 3, fractionalBits: 12 });
  assert.throws(() => readSpzHeader(gzipSync(Buffer.alloc(15))), /Invalid SPZ/);
  assert.throws(() => readSpzHeader(gzipSync(header.subarray(0, -1))), /payload length/);
  header.writeUInt32LE(0, 8);
  assert.throws(() => readSpzHeader(gzipSync(header)), /Gaussian count/);
  header.writeUInt32LE(2, 8);
  header[12] = 4;
  assert.throws(() => readSpzHeader(gzipSync(header)), /SH degree/);
});

test("scene downloads follow redirects and replace files only after SPZ/count/SHA validation", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gaussx-scene-fetch-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const publicDirectory = path.join(temporary, "public");
  const scenesDirectory = path.join(publicDirectory, "scenes");
  const sourceFile = path.join(temporary, "scene-source.json");
  const configFile = path.join(temporary, "card-active.json");
  const destination = path.join(scenesDirectory, "test.spz");
  await mkdir(scenesDirectory, { recursive: true });
  await writeFile(sourceFile, JSON.stringify({ url: "", sha256: "" }));
  await writeFile(configFile, JSON.stringify({ model: { format: "spz", url: "/scenes/test.spz", count: 2, shDegree: 3 } }));
  const raw = Buffer.alloc(16 + 2 * 65);
  raw.writeUInt32LE(0x5053474e, 0);
  raw.writeUInt32LE(3, 4);
  raw.writeUInt32LE(2, 8);
  raw[12] = 3;
  raw[13] = 12;
  const valid = gzipSync(raw);
  const wrongCount = Buffer.from(raw);
  wrongCount.writeUInt32LE(1, 8);
  const truncated = gzipSync(raw.subarray(0, -1));
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/valid" }).end();
    } else if (request.url === "/valid") {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.write(valid.subarray(0, 10));
      response.end(valid.subarray(10));
    } else if (request.url === "/html" || request.url === "/html-disguised") {
      response.writeHead(200, { "content-type": request.url === "/html" ? "text/html" : "application/octet-stream" });
      response.end("<!DOCTYPE html><html>Sign in to download</html>");
    } else if (request.url === "/wrong-count") {
      response.end(gzipSync(wrongCount.subarray(0, 16 + 65)));
    } else if (request.url === "/truncated") {
      response.end(truncated);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const options = { sourceFile, configFile, publicDirectory };
  const checksum = createHash("sha256").update(valid).digest("hex");
  const result = await fetchCardScene({ ...options, url: `${base}/redirect`, sha256: checksum });
  assert.equal(result.count, 2);
  assert.equal(result.status, "downloaded");
  assert.equal(result.sha256, checksum);
  assert.deepEqual(await readFile(destination), valid);
  assert.equal((await fetchCardScene({ ...options, url: `${base}/valid`, sha256: checksum })).status, "unchanged");
  for (const [route, expected] of [["html", /HTML/], ["html-disguised", /HTML/],
    ["wrong-count", /count or SH degree/], ["truncated", /payload length/], ["missing", /HTTP 404/]]) {
    await assert.rejects(fetchCardScene({ ...options, url: `${base}/${route}` }), expected);
    assert.deepEqual(await readFile(destination), valid, `${route} must preserve the existing good file`);
    assert.deepEqual(await readdir(scenesDirectory), ["test.spz"], `${route} must remove failed temporary files`);
  }
  await assert.rejects(fetchCardScene({ ...options, url: `${base}/valid`, sha256: "0".repeat(64) }), /SHA256 mismatch/);
  assert.deepEqual(await readFile(destination), valid);
  await assert.rejects(fetchCardScene(options), /No scene download URL is configured/);
  await assert.rejects(fetchCardScene({ ...options, url: "file:///unrelated.spz" }), /HTTP\(S\)/);
  await writeFile(sourceFile, JSON.stringify({ url: `${base}/valid`, sha256: checksum }));
  assert.equal((await fetchCardScene(options)).sha256, checksum);
});
