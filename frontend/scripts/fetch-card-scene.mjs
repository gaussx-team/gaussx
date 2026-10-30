// Download private/shared Gaussian assets locally; never upload them to Git.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { readSpzHeader } from "./prepare-card-scene.mjs";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const defaultSourceFile = fileURLToPath(new URL("./scene-source.json", import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

export async function fetchCardScene({
  url,
  sha256,
  sourceFile = defaultSourceFile,
  configFile = path.join(frontend, "public/scenes/card-active.json"),
  publicDirectory = path.join(frontend, "public"),
} = {}) {
  const source = await readJson(sourceFile);
  const downloadUrl = url ?? source.url;
  const expectedSha256 = sha256 ?? source.sha256;
  if (!downloadUrl) {
    throw new Error("No scene download URL is configured. Set scripts/scene-source.json url (and optional sha256), "
      + "or run npm run scene:fetch -- --url https://host/a-v2d.spz. "
      + "For the existing sibling virtual-site source, run npm run scene:prepare.");
  }
  let remote;
  try {
    remote = new URL(downloadUrl);
  } catch {
    throw new Error("The scene URL must be an HTTP(S) direct download URL");
  }
  if (!["https:", "http:"].includes(remote.protocol)) {
    throw new Error("The scene URL must be an HTTP(S) direct download URL");
  }
  if (expectedSha256 && !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error("The optional scene sha256 must contain exactly 64 hexadecimal characters");
  }
  const config = await readJson(configFile);
  const model = config.model;
  if (model?.format !== "spz" || !/^\/scenes\/[a-z0-9][a-z0-9._-]*\.spz$/i.test(model.url)) {
    throw new Error("card-active.json model must specify a local /scenes/<filename>.spz path and spz format");
  }
  if (!Number.isSafeInteger(model.count) || model.count < 1
    || !Number.isInteger(model.shDegree) || model.shDegree < 0 || model.shDegree > 3) {
    throw new Error("card-active.json must specify a positive Gaussian count and SH degree 0–3");
  }
  const maxRawBytes = 16 + model.count * (20 + ((model.shDegree + 1) ** 2 - 1) * 3);
  if (maxRawBytes > 512 * 1024 * 1024) throw new Error("The configured SPZ exceeds the 512 MiB preparation limit");
  const maxDownloadBytes = maxRawBytes + 1024 * 1024;
  const destination = path.join(publicDirectory, model.url.slice(1));
  const temporary = `${destination}.${process.pid}.${randomUUID()}.download.tmp`;
  const response = await fetch(remote, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Scene download failed with HTTP ${response.status}; the existing asset was preserved`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    await response.body.cancel();
    throw new Error("The scene URL returned an HTML sharing/sign-in page. Use a direct binary download URL");
  }
  if (Number(response.headers.get("content-length")) > maxDownloadBytes) {
    await response.body.cancel();
    throw new Error("The download is too large for the configured scene; the existing asset was preserved");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  let file;
  try {
    file = await open(temporary, "wx");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maxDownloadBytes) throw new Error("The download exceeded the configured scene size limit");
      hash.update(chunk);
      await file.writeFile(chunk);
    }
    await file.close();
    file = undefined;
    const actualSha256 = hash.digest("hex");
    if (expectedSha256 && actualSha256 !== expectedSha256.toLowerCase()) {
      throw new Error("Downloaded scene SHA256 mismatch; the existing asset was preserved");
    }
    const downloaded = await readFile(temporary);
    if (/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(downloaded.subarray(0, 1024).toString("utf8"))) {
      throw new Error("The scene URL returned HTML instead of a binary SPZ; use a direct download URL");
    }
    const header = readSpzHeader(downloaded, { maxOutputLength: maxRawBytes });
    if (header.count !== model.count || header.shDegree !== model.shDegree) {
      throw new Error("Downloaded SPZ count or SH degree does not match card-active.json");
    }
    // Avoid replacing a file already in use by a running Windows demo server.
    const result = { output: destination, bytes, sha256: actualSha256, ...header };
    try {
      if (createHash("sha256").update(await readFile(destination)).digest("hex") === actualSha256) {
        return { status: "unchanged", ...result };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, destination); break; }
      catch (error) {
        if (["EPERM", "EACCES", "EBUSY"].includes(error.code) && attempt < 4) {
          await setTimeout(200 * 2 ** attempt);
          continue;
        }
        throw new Error("Could not replace the local scene. Stop the demo server and retry; the existing file was preserved", { cause: error });
      }
    }
    return { status: "downloaded", ...result };
  } finally {
    await file?.close();
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      url: { type: "string" },
      sha256: { type: "string" },
    } });
    console.log(JSON.stringify(await fetchCardScene(values), null, 2));
  } catch (error) {
    console.error(`Card scene download failed: ${error.message}`);
    process.exitCode = 1;
  }
}
