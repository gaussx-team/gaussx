import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adminSceneMarkers, adminScenePreset, assignedEquipment, distance3d, equipmentIn, layoutMarkerBoxes, markerPosition, markerShortName, sceneHorizontalFov, sceneMarkers, sceneModelUrl, scenePresetForWidth, validateSceneConfig } from "../src/lib/card3d/scene.ts";

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
    (c) => { c.presets.nearby.pinPositions = { "T-02": [1, NaN, 3] }; },
    (c) => { c.presets.nearby.pinPositions = { UNKNOWN: [1, 2, 3] }; },
  ]) {
    const broken = structuredClone(config);
    mutate(broken);
    assert.throws(() => validateSceneConfig(broken));
  }
});

test("per-preset horizontal FOV accepts only finite angles within the scene bounds", () => {
  for (const angle of [10, 90, 140]) {
    const wide = structuredClone(config);
    wide.presets.work.horizontalFovDegrees = angle;
    assert.equal(sceneHorizontalFov(validateSceneConfig(wide), "work"), angle);
  }
  for (const angle of [9.99, 140.01, NaN, Infinity, -Infinity, "90", null]) {
    const invalid = structuredClone(config);
    invalid.presets.work.horizontalFovDegrees = angle;
    assert.throws(() => validateSceneConfig(invalid));
  }
});

test("preset FOV overrides leave legacy card cameras on the scene default", () => {
  const wide = structuredClone(config);
  delete wide.presets.work.horizontalFovDegrees;
  wide.presets.admin = { ...wide.presets.nearby, label: "관리자 전체 현장", horizontalFovDegrees: 110 };
  validateSceneConfig(wide);
  assert.equal(sceneHorizontalFov(wide, "admin"), 110);
  assert.equal(sceneHorizontalFov(wide, "work"), config.horizontalFovDegrees);
  assert.equal(sceneHorizontalFov(wide, "UNKNOWN"), config.horizontalFovDegrees);
  delete wide.presets.admin.horizontalFovDegrees;
  assert.equal(sceneHorizontalFov(wide, "admin"), config.horizontalFovDegrees);
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

test("preset-specific mesh surfaces position pins while reference anchors keep all distances stable", () => {
  const markers = sceneMarkers(config, "MCC-3", workTags, currentTags);
  for (const marker of markers) {
    for (const preset of ["nearby", "nearby_mobile", marker.id]) {
      const position = markerPosition(config, marker, preset);
      assert.deepEqual(position, config.presets[preset].pinPositions[marker.id]);
      assert.ok(position && position.every(Number.isFinite));
      assert.ok(distance3d(position, marker.position) > 0.02, `${preset}/${marker.id} must use its surface, not the floating reference`);
    }
  }
  assert.notDeepEqual(config.presets.nearby.pinPositions, config.presets.nearby_mobile.pinPositions);
  assert.deepEqual(markers.map((m) => m.distanceMeters.toFixed(1)), ["0.0", "3.2", "6.1", "7.2"]);
  assert.ok(config.presets.nearby.pinPositions["T-02"][2] > 1.3);
  assert.ok(config.presets.nearby.pinPositions["T-02"][2] < 3.1);
});

test("a camera-occluded pin stays hidden instead of falling back to a floating distance anchor", () => {
  const marker = sceneMarkers(config, "MCC-3", workTags, currentTags)[0];
  const hidden = structuredClone(config);
  hidden.presets.work.pinPositions[marker.id] = null;
  assert.equal(markerPosition(validateSceneConfig(hidden), marker, "work"), null);
  delete hidden.presets.work.pinPositions[marker.id];
  assert.equal(markerPosition(hidden, marker, "work"), null);
  delete hidden.presets.work.pinPositions;
  assert.deepEqual(markerPosition(hidden, marker, "work"), marker.position);
});

test("the admin maps every active equipment tag independently of the card context and radius", () => {
  const tags = [
    tag("배관 P-203", { id: 7, hazard: "불산 누출", substance: "불산 55%" }),
    tag("밸브 V-11", { id: 2 }),
    tag("탱크 T-02", { id: 3, official: false }),
    tag("펌프 PU-07", { id: 4 }),
    tag("분전반 MCC-3", { id: 5, substance: null }),
    tag("환기팬 F-2 지지대", { id: 6, official: false }),
    tag("P-203 이전 버전", { id: 8, status: "superseded" }),
    tag("P-2030 알 수 없는 설비", { id: 9 }),
    tag("P-203 별도 위험", { id: 10, official: false }),
  ];
  const original = structuredClone(tags);
  const markers = adminSceneMarkers({ ...config, contextEquipment: [], nearbyRadiusMeters: 0 }, tags);
  assert.deepEqual(markers.map((m) => m.id), ["7", "2", "3", "4", "5", "6", "10"]);
  assert.deepEqual(markers.map((m) => m.equipmentId), ["P-203", "V-11", "T-02", "PU-07", "MCC-3", "F-2", "P-203"]);
  assert.ok(markers.every((m) => m.kind === "hazard" && m.distanceMeters === 0));
  for (const marker of markers) {
    const source = tags.find((t) => String(t.id) === marker.id);
    assert.deepEqual(marker.position, config.anchors.find((a) => a.id === marker.equipmentId).position);
    assert.equal(marker.title, source.title);
    assert.equal(marker.hazard, source.hazard);
    assert.equal(marker.substance, source.substance ?? "");
    assert.equal(marker.official, source.official);
  }
  assert.deepEqual(tags, original);
  assert.equal(markerShortName(markers[0]), "불산 P-203");
  assert.equal(markerShortName(markers[4]), "설비 MCC-3");
});

test("admin tag identities resolve equipment surfaces and preserve camera occlusion", () => {
  const marker = adminSceneMarkers(config, [tag("P-203 불산 배관", { id: 77 })])[0];
  assert.equal(marker.id, "77");
  assert.deepEqual(markerPosition(config, marker, "P-203"), config.presets["P-203"].pinPositions["P-203"]);
  const hidden = structuredClone(config);
  hidden.presets["P-203"].pinPositions["P-203"] = null;
  hidden.presets["P-203"].pinPositions["77"] = [1, 2, 3];
  assert.equal(markerPosition(hidden, marker, "P-203"), null);
  delete hidden.presets["P-203"].pinPositions["P-203"];
  assert.equal(markerPosition(hidden, marker, "P-203"), null);
  delete hidden.presets["P-203"].pinPositions;
  assert.deepEqual(markerPosition(hidden, marker, "P-203"), marker.position);
});

test("admin equipment mapping and camera selection follow a replacement scene config", () => {
  const replacement = structuredClone(config);
  const equipment = "HX-42";
  replacement.id = "full-building";
  replacement.defaultWorkEquipment = equipment;
  replacement.contextEquipment = [];
  replacement.anchors = [{ id: equipment, name: "교체 장면 열교환기", position: [12, 20, 3] }];
  const matrix = [[1, 0, 0, 12], [0, 1, 0, 10], [0, 0, 1, 4], [0, 0, 0, 1]];
  replacement.presets = {
    work: { label: "작업", matrix },
    nearby: { label: "주변", matrix },
    admin: { label: "전체동", matrix },
    [equipment]: { label: "열교환기", matrix, pinPositions: { [equipment]: [12.2, 19.5, 2] } },
  };
  validateSceneConfig(replacement);
  const markers = adminSceneMarkers(replacement, [tag("P-203 기존 설비", { id: 1 }), tag("HX-42 열교환기", { id: 202 })]);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].id, "202");
  assert.equal(markers[0].equipmentId, equipment);
  assert.deepEqual(markerPosition(replacement, markers[0], adminScenePreset(replacement, equipment)), [12.2, 19.5, 2]);
  assert.equal(markerShortName(markers[0]), "황산 HX-42");
  assert.equal(adminScenePreset(replacement, equipment), equipment);
  assert.equal(adminScenePreset(replacement), "admin");
  assert.equal(adminScenePreset(replacement, "UNKNOWN"), "admin");
  delete replacement.presets.admin;
  assert.equal(adminScenePreset(replacement, null), "nearby");
  assert.equal(adminScenePreset(replacement, "UNKNOWN"), "nearby");
  assert.equal(adminScenePreset(replacement, equipment), equipment);
});
