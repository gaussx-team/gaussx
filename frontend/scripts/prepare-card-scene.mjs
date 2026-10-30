// Local CPU preparation only. Gaussian data stays in ignored public/scenes files.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const scenesDirectory = path.join(frontend, "public/scenes");
const virtualSite = path.resolve(frontend, "../../virtual-site");
const sourceData = path.join(virtualSite, "viewer/data/v2d");
const configPath = path.join(scenesDirectory, "card-active.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

export function readSpzHeader(bytes, { maxOutputLength = 512 * 1024 * 1024 } = {}) {
  const raw = gunzipSync(bytes, { maxOutputLength });
  if (raw.length < 16 || raw.readUInt32LE(0) !== 0x5053474e) {
    throw new Error("Invalid SPZ magic or truncated header");
  }
  const header = {
    version: raw.readUInt32LE(4),
    count: raw.readUInt32LE(8),
    shDegree: raw[12],
    fractionalBits: raw[13],
  };
  if (![2, 3].includes(header.version) || header.count < 1 || header.shDegree > 3) {
    throw new Error("Invalid SPZ version, Gaussian count or SH degree");
  }
  const shCoefficients = (header.shDegree + 1) ** 2 - 1;
  const bytesPerGaussian = (header.version === 3 ? 20 : 19) + shCoefficients * 3;
  if (raw.length !== 16 + header.count * bytesPerGaussian) {
    throw new Error("Invalid SPZ payload length for its Gaussian count and SH degree");
  }
  return header;
}

function readPlyHeader(bytes) {
  const prefix = bytes.subarray(0, 65536).toString("ascii");
  const end = prefix.indexOf("end_header\n");
  if (end < 0 || !prefix.startsWith("ply\nformat binary_little_endian 1.0\n")) {
    throw new Error("Expected a binary little-endian Gaussian PLY");
  }
  const header = prefix.slice(0, end);
  const count = Number(header.match(/^element vertex (\d+)$/m)?.[1]);
  const properties = [...header.matchAll(/^property float (\S+)$/gm)].map((match) => match[1]);
  const expected = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2",
    ...Array.from({ length: 45 }, (_, i) => `f_rest_${i}`), "opacity",
    "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  if (!Number.isSafeInteger(count) || count < 1 || JSON.stringify(properties) !== JSON.stringify(expected)
    || bytes.length !== end + 11 + count * expected.length * 4) {
    throw new Error("PLY count, SH3 properties or byte length do not match");
  }
  return { count, shDegree: 3 };
}

export function preserveSurfacePins(config, previous) {
  const provenance = previous?.metadata?.surfacePins;
  if (config.id !== "a-v2d" || previous?.id !== config.id || previous.version !== config.version
    || !isDeepStrictEqual(previous.model, config.model)
    || previous.metadata?.sourceSha256 !== config.metadata.sourceSha256
    || previous.coordinateSystem !== config.coordinateSystem
    || previous.metadata?.coordinateTransform !== config.metadata.coordinateTransform
    || previous.horizontalFovDegrees !== config.horizontalFovDegrees
    || !isDeepStrictEqual(previous.anchors, config.anchors)
    || provenance?.schema !== "blender-camera-raycast-v1"
    || !/^[a-f0-9]{64}$/i.test(provenance.sourceBlendSha256 ?? "")
    || typeof previous.metadata.anchorLimit !== "string" || !previous.metadata.anchorLimit.trim()) return config;

  const presetIds = Object.keys(config.presets).sort();
  if (!isDeepStrictEqual(Object.keys(previous.presets ?? {}).sort(), presetIds)
    || presetIds.some((id) => !isDeepStrictEqual(previous.presets[id]?.matrix, config.presets[id].matrix))) return config;

  const anchorIds = new Set(config.anchors.map(({ id }) => id));
  let hasPins = false;
  for (const id of presetIds) {
    const positions = previous.presets[id].pinPositions;
    if (positions === undefined) continue;
    if (!positions || typeof positions !== "object" || Array.isArray(positions)) return config;
    for (const [anchorId, position] of Object.entries(positions)) {
      if (!anchorIds.has(anchorId) || (position !== null
        && (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)))) return config;
      hasPins = true;
    }
  }
  if (!hasPins) return config;
  return {
    ...config,
    presets: Object.fromEntries(Object.entries(config.presets).map(([id, preset]) => [id,
      previous.presets[id].pinPositions === undefined ? preset : {
        ...preset, pinPositions: structuredClone(previous.presets[id].pinPositions),
      }])),
    metadata: {
      ...config.metadata,
      anchorLimit: previous.metadata.anchorLimit,
      surfacePins: structuredClone(provenance),
    },
  };
}

export function makeConfig({ scene, anchors, presets, modelUrl, format, sourceSha256, previousConfig }) {
  const named = Object.fromEntries(presets.map((preset) => [preset.id, {
    label: preset.label,
    matrix: preset.frame.matrix,
  }]));
  const length = Math.hypot(7.7, 0.6);
  const c = 7.7 / length;
  const s = 0.6 / length;
  const config = {
    version: 1,
    id: "a-v2d",
    label: "A구역",
    displayName: "",
    model: { url: modelUrl, format, count: scene.model.count, shDegree: 3 },
    coordinateSystem: "Blender Z-up meters",
    background: scene.background.sRGB,
    horizontalFovDegrees: 2 * Math.atan(scene.intrinsics.w / (2 * scene.intrinsics.fx)) * 180 / Math.PI,
    nearbyRadiusMeters: 8,
    defaultWorkEquipment: "MCC-3",
    contextEquipment: ["PU-07", "P-203", "T-02"],
    anchors: anchors.anchors.map(({ id, name, position }) => ({ id, name, position })),
    presets: {
      work: { ...named["MCC-3"], label: "내 작업 위치" },
      nearby: {
        label: "주변 위험",
        matrix: [[1, 0, 0, 2], [0, -s, -c, 0.3], [0, c, -s, 2.1], [0, 0, 0, 1]],
      },
      nearby_mobile: {
        label: "주변 위험",
        matrix: [
          [0.9987871732972772, -0.00482502785471698, 0.04899899553088733, 2],
          [0.04923598741606297, 0.09787913648140156, -0.9939796236265713, 0.9],
          [0, 0.9951866125244332, 0.09799799106177443, 2.4],
          [0, 0, 0, 1],
        ],
      },
      ...named,
    },
    metadata: {
      sourceSha256,
      source: "virtual-site/viewer/data/v2d",
      coordinateTransform: "identity",
      distanceMeaning: "3D 메타데이터 앵커 간 직선거리이며 보행거리나 위험 영향반경이 아님",
      nearbyRadiusMeaning: "주변 공정 태그를 선택하는 시연 표시 범위",
      nearbyCameraSource: "카드용 내부 시점(시각 검토 완료, 원본 평가 점수가 없는 novel view)",
      mobileNearbyCameraSource: "폰용 내부 시점 [2,0.9,2.4] → [1.65,8,1.7], 원본 평가 점수가 없는 novel view",
      anchorLimit: "P-203는 지정 플랜지 중심, 나머지는 원본 label anchor로 가시 표면점이 아님",
    },
  };
  // Match persisted JSON for both raycast validation and the preparation cache:
  // two original Blender camera matrices contain -0, which JSON writes as 0.
  return preserveSurfacePins(JSON.parse(JSON.stringify(config)), previousConfig);
}

async function atomicWrite(file, bytes) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function prepareCardScene({ source, output }) {
  source = path.resolve(source);
  output = path.resolve(output);
  if (path.relative(scenesDirectory, output).startsWith("..") || path.dirname(output) !== scenesDirectory
    || path.extname(output).toLowerCase() !== ".spz" || source === output) {
    throw new Error("--output must be an .spz filename directly inside frontend/public/scenes");
  }
  const started = performance.now();
  const [scene, anchors, presets, input] = await Promise.all([
    readJson(path.join(sourceData, "scene.json")),
    readJson(path.join(sourceData, "anchors.json")),
    readJson(path.join(sourceData, "presets.json")),
    readFile(source),
  ]);
  const sourceSha256 = sha256(input);
  const sourceHeader = readPlyHeader(input);
  if (sourceSha256 !== scene.model.sha256 || sourceHeader.count !== scene.model.count) {
    throw new Error("Source does not match the verified V2D scene metadata; do not reuse V2D anchors for another scene");
  }
  await mkdir(scenesDirectory, { recursive: true });
  const receiptPath = `${output}.receipt.json`;
  let previousConfig;
  try {
    previousConfig = await readJson(configPath);
    const old = await readJson(receiptPath);
    const existingPath = path.join(scenesDirectory, old.output.filename);
    if (path.dirname(existingPath) !== scenesDirectory) throw new Error("Invalid cached asset path");
    const existing = await readFile(existingPath);
    const modelUrl = `/scenes/${old.output.filename}`;
    const expectedConfig = makeConfig({ scene, anchors, presets, modelUrl, format: old.output.format, sourceSha256, previousConfig });
    if (old.source.sha256 === sourceSha256 && old.output.sha256 === sha256(existing)
      && isDeepStrictEqual(previousConfig, expectedConfig)) {
      if (old.output.format === "spz") {
        const header = readSpzHeader(existing);
        if (header.count !== sourceHeader.count || header.shDegree !== 3
          || header.version !== 3 || header.fractionalBits !== 12) throw new Error("Cached SPZ header mismatch");
      }
      return { status: "unchanged", receipt: receiptPath, output: existingPath, bytes: existing.length };
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Existing preparation will be refreshed: ${error.message}`);
  }

  let bytes;
  let header;
  let format = "spz";
  let fallbackReason = null;
  try {
    const { transcodeSpz, SplatFileType } = await import("@sparkjsdev/spark");
    const converted = await transcodeSpz({
      inputs: [{ fileBytes: input, fileType: SplatFileType.PLY }],
      maxSh: 3,
      fractionalBits: 12,
      version: 3,
    });
    bytes = Buffer.from(converted.fileBytes);
    header = readSpzHeader(bytes);
    if (converted.clippedCount !== 0 || header.count !== sourceHeader.count || header.shDegree !== 3
      || header.version !== 3 || header.fractionalBits !== 12) {
      throw new Error("SPZ conversion did not preserve count, SH3 or requested precision");
    }
  } catch (error) {
    fallbackReason = error.message;
    console.warn(`SPZ unavailable; preserving the verified PLY instead: ${fallbackReason}`);
    output = output.replace(/\.spz$/i, ".ply");
    format = "ply";
    bytes = input;
    header = sourceHeader;
  }
  if (sha256(await readFile(source)) !== sourceSha256) throw new Error("Source changed during preparation");
  await atomicWrite(output, bytes);
  if (sha256(await readFile(output)) !== sha256(bytes)) throw new Error("Written asset hash mismatch");
  const modelUrl = `/scenes/${path.basename(output)}`;
  const config = makeConfig({ scene, anchors, presets, modelUrl, format, sourceSha256, previousConfig });
  await atomicWrite(configPath, JSON.stringify(config, null, 2) + "\n");
  const receipt = {
    schema: "gaussx-card-scene-preparation-v1",
    preparedAt: new Date().toISOString(),
    method: format === "spz" ? "@sparkjsdev/spark@2.4.0 transcodeSpz" : "verified PLY copy",
    source: { filename: path.basename(source), bytes: input.length, sha256: sourceSha256, ...sourceHeader },
    output: { filename: path.basename(output), bytes: bytes.length, sha256: sha256(bytes), format, ...header },
    sourceUnchanged: true,
    transform: "identity",
    fallbackReason,
    elapsedSeconds: (performance.now() - started) / 1000,
  };
  await atomicWrite(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  return { status: "prepared", ...receipt, receipt: receiptPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      source: { type: "string", default: path.join(virtualSite, "p3-v2d-final/splat.ply") },
      output: { type: "string", default: path.join(scenesDirectory, "a-v2d.spz") },
    } });
    console.log(JSON.stringify(await prepareCardScene(values), null, 2));
  } catch (error) {
    console.error(`Card scene preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
