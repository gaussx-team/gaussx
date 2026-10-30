import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assignedEquipment, distance3d, equipmentIn, layoutMarkerBoxes, markerShortName, sceneMarkers, sceneModelUrl, scenePresetForWidth, validateSceneConfig } from "../src/lib/card3d/scene.ts";

const config = validateSceneConfig(JSON.parse(await readFile(new URL("../public/scenes/card-active.json", import.meta.url), "utf8")));
const tag = (title, changes = {}) => ({ id: 1, title, hazard: "누출 위험", substance: "황산", official: true, status: "active", version: 1, ...changes });
const workTags = [tag("MCC-3 배전반", { hazard: "감전 위험", substance: null })];
const currentTags = [tag("PU-07 황산 펌프"), tag("P-203 불산 배관", { substance: "불산", official: false }), tag("T-02 황산 탱크")];

test("a card maps only an identified equipment assignment, without guessing the default position", () => {
  assert.equal(assignedEquipment(config, "MCC-3 배전반 점검", []), "MCC-3");
  assert.equal(assignedEquipment(config, "전기 점검", workTags), "MCC-3");
  assert.equal(assignedEquipment(config, "새 설비 점검", []), null);
  assert.equal(assignedEquipment(config, "공동 작업", [...workTags, tag("PU-07 펌프")]), null);
  assert.equal(equipmentIn("MCC-30 배전반", ["MCC-3"]), null);
  assert.equal(equipmentIn("예비MCC-3A", ["MCC-3"]), null);
  assert.equal(equipmentIn("[mcc-3] 점검", ["MCC-3"]), "MCC-3");
});

test("nearby risk uses current active tag content and actual 3D metre distances", () => {
  const markers = sceneMarkers(config, "MCC-3", workTags, [
    tag("P-203 불산 배관 구버전", { status: "superseded", hazard: "과거 내용" }),
    ...currentTags,
  ]);
  assert.deepEqual(markers.map((m) => m.id), ["MCC-3", "PU-07", "P-203", "T-02"]);
  assert.deepEqual(markers.map((m) => m.distanceMeters.toFixed(1)), ["0.0", "3.2", "6.1", "7.2"]);
  assert.equal(markers[0].kind, "work");
  assert.equal(markers[0].hazard, "감전 위험");
  assert.equal(markers[2].title, "P-203 불산 배관");
  assert.equal(markers[2].substance, "불산");
  assert.equal(markers[2].official, false);
  assert.ok(markers.slice(1).every((m) => m.kind === "hazard"));
  assert.equal(distance3d([0, 0, 0], [0, 0, 3]), 3);
});

test("display radius, inactive tags and unknown equipment cannot introduce extra risk pins", () => {
  const pumpDistance = distance3d(config.anchors.find((a) => a.id === "MCC-3").position,
    config.anchors.find((a) => a.id === "PU-07").position);
  assert.deepEqual(sceneMarkers({ ...config, nearbyRadiusMeters: pumpDistance }, "MCC-3", workTags, currentTags).map((m) => m.id), ["MCC-3", "PU-07"]);
  assert.deepEqual(sceneMarkers({ ...config, nearbyRadiusMeters: pumpDistance - 0.001 }, "MCC-3", workTags, currentTags).map((m) => m.id), ["MCC-3"]);
  assert.deepEqual(sceneMarkers(config, "MCC-3", workTags, [tag("P-203", { status: "superseded" }), tag("P-2030"), tag("UNKNOWN")]).map((m) => m.id), ["MCC-3"]);
  assert.deepEqual(sceneMarkers(config, "UNKNOWN", workTags, currentTags), []);
});

test("one optional scene URL supports local default and HTTP(S), while rejecting executable and relative URLs", () => {
  assert.equal(sceneModelUrl(config), "/scenes/a-v2d.spz");
  assert.equal(sceneModelUrl(config, "  "), "/scenes/a-v2d.spz");
  assert.equal(sceneModelUrl(config, "https://assets.example.test/factory.spz?download=1"), "https://assets.example.test/factory.spz?download=1");
  assert.equal(sceneModelUrl(config, "http://localhost:8790/factory.spz"), "http://localhost:8790/factory.spz");
  for (const invalid of ["javascript:alert(1)", "file:///factory.spz", "//elsewhere/factory.spz", "../factory.spz"]) {
    assert.throws(() => sceneModelUrl(config, invalid), /HTTP/);
  }
});

test("bad scene metadata fails at the module boundary", () => {
  for (const mutate of [
    (c) => { c.model.count = 0; },
    (c) => { c.anchors[0].position[0] = NaN; },
    (c) => { c.anchors.push(c.anchors[0]); },
    (c) => { c.presets.work.matrix[0] = [1, 0]; },
    (c) => { delete c.presets.nearby; },
  ]) {
    const broken = structuredClone(config);
    mutate(broken);
    assert.throws(() => validateSceneConfig(broken));
  }
});

test("crowded phone labels fit without overlap and preserve their world projections", () => {
  const points = [
    { id: "P-203", x: 190, y: 155, kind: "hazard" },
    { id: "T-02", x: 192, y: 156, kind: "hazard" },
    { id: "MCC-3", x: 191, y: 154, kind: "work" },
    { id: "PU-07", x: 193, y: 157, kind: "hazard" },
  ];
  for (const [width, height] of [[311, 306], [326, 306], [343, 306], [800, 550]]) {
    const boxes = layoutMarkerBoxes(points, width, height);
    assert.equal(boxes.length, 4);
    assert.equal(boxes[0].id, "MCC-3");
    for (const b of boxes) {
      const original = points.find((p) => p.id === b.id);
      assert.equal(b.x, original.x);
      assert.equal(b.y, original.y);
      assert.ok(b.left >= 0 && b.left + b.width <= width);
      assert.ok(b.top >= 48 && b.top + b.height <= height - 42);
      for (const other of boxes.filter((x) => x !== b)) {
        assert.ok(b.left + b.width <= other.left || other.left + other.width <= b.left
          || b.top + b.height <= other.top || other.top + other.height <= b.top);
      }
    }
  }
  assert.deepEqual(layoutMarkerBoxes(points, 180, 120), []);
});

test("compact labels leave the actual home button and AI notice unobstructed", () => {
  const points = [
    { id: "MCC-3", x: 290, y: 127, kind: "work" },
    { id: "PU-07", x: 201, y: 166, kind: "hazard" },
    { id: "P-203", x: 23, y: 188, kind: "hazard" },
    { id: "T-02", x: 193, y: 89, kind: "hazard" },
  ];
  const reserved = [
    { left: 12, top: 12, width: 90, height: 25 },
    { left: 168, top: 239, width: 131, height: 27 },
    { left: 0, top: 262, width: 311, height: 44 },
  ];
  const boxes = layoutMarkerBoxes(points, 311, 306, { reserved });
  assert.equal(boxes.length, 4);
  assert.ok(boxes.reduce((sum, box) => sum + box.width * box.height, 0) < 311 * 306 * 0.13);
  for (const box of boxes) {
    for (const rect of reserved) {
      assert.ok(box.left + box.width + 6 <= rect.left || rect.left + rect.width + 6 <= box.left
        || box.top + box.height + 6 <= rect.top || rect.top + rect.height + 6 <= box.top);
    }
  }
  const markers = sceneMarkers(config, "MCC-3", workTags, currentTags);
  assert.equal(markerShortName(markers[0]), "내 작업 MCC-3");
  assert.equal(markerShortName(markers[2]), "불산 P-203");
});

test("the phone context camera is selected by canvas width without changing the assigned or desktop view", () => {
  assert.equal(scenePresetForWidth(config, "nearby", 311), "nearby_mobile");
  assert.equal(scenePresetForWidth(config, "nearby", 479), "nearby_mobile");
  assert.equal(scenePresetForWidth(config, "nearby", 480), "nearby");
  assert.equal(scenePresetForWidth(config, "work", 311), "work");
  assert.equal(scenePresetForWidth(config, "P-203", 311), "P-203");
  const replacement = structuredClone(config);
  delete replacement.presets.nearby_mobile;
  assert.equal(scenePresetForWidth(replacement, "nearby", 311), "nearby");
});
