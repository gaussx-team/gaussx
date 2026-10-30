import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { readSpzHeader } from "./prepare-card-scene.mjs";
import { fetchCardScene } from "./fetch-card-scene.mjs";

const config = JSON.parse(await readFile(new URL("../public/scenes/card-active.json", import.meta.url), "utf8"));
const anchor = (id) => config.anchors.find((item) => item.id === id).position;

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
