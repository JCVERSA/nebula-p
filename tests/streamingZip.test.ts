import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeZipArchiveStream } from "../src/bot/services/streamingZipWriter.js";
import AdmZip from "adm-zip";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

/**
 * Audit 8.15 — adm-zip built whole batch archives in RAM (~1.6 GB peak for a
 * 9-episode batch) and the container cgroup (~954 MB) OOM-killed the bot right
 * after the last episode. The streaming writer must produce archives that real
 * unzip clients (here: adm-zip as an independent parser) read back byte-exact.
 */
describe("StreamingZipWriter (audit 8.15)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "streamzip-test-"));
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const makeFile = (name: string, bytes: Buffer): string => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, bytes);
    return p;
  };

  it("round-trips multi-file archives byte-exactly (incl. binary + empty file)", async () => {
    const binary = crypto.pseudoRandomBytes(3 * 1024 * 1024 + 7); // >1 chunk boundary, odd tail
    const small = Buffer.from("Hello Nebula \u00e9\u00e0\u00e7!", "utf-8");
    const empty = Buffer.alloc(0);

    const zipPath = path.join(tmpDir, "multi.zip");
    const result = await writeZipArchiveStream(zipPath, [
      { entryName: "video_E01.mp4", filePath: makeFile("e01.bin", binary), mtime: new Date(2026, 7, 31, 1, 2, 3) },
      { entryName: "note.txt", filePath: makeFile("note.txt", small) },
      { entryName: "README.txt", data: Buffer.from("manifest", "utf-8") },
      { entryName: "empty.mp4", filePath: makeFile("empty.bin", empty) }
    ]);

    expect(result.entryCount).toBe(4);
    expect(result.totalBytes).toBe(binary.length + small.length + "manifest".length + empty.length);

    const zip = new AdmZip(zipPath);
    const names = zip.getEntries().map((e) => e.entryName).sort();
    expect(names).toEqual(["README.txt", "empty.mp4", "note.txt", "video_E01.mp4"].sort());

    expect(zip.readFile("video_E01.mp4")).toEqual(binary); // byte-exact
    expect(zip.readFile("note.txt")).toEqual(small);
    expect(zip.readFile("README.txt")).toEqual(Buffer.from("manifest", "utf-8"));
    expect(zip.readFile("empty.mp4")).toEqual(Buffer.alloc(0));
  });

  it("supports UTF-8 entry names", async () => {
    const zipPath = path.join(tmpDir, "utf8.zip");
    await writeZipArchiveStream(zipPath, [
      { entryName: "Sparks_\u00c9pisode_01_\u00e9t\u00e9.mp4", data: Buffer.from("vf") }
    ]);
    const zip = new AdmZip(zipPath);
    expect(zip.getEntries()[0]!.entryName).toBe("Sparks_\u00c9pisode_01_\u00e9t\u00e9.mp4");
    expect(zip.readAsText("Sparks_\u00c9pisode_01_\u00e9t\u00e9.mp4")).toBe("vf");
  });

  it("stores entries uncompressed (STORE method) with valid CRCs", async () => {
    const payload = crypto.pseudoRandomBytes(5000);
    const zipPath = path.join(tmpDir, "store.zip");
    await writeZipArchiveStream(zipPath, [{ entryName: "raw.bin", data: payload }]);
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntries()[0]!;
    expect(entry.header.method).toBe(0); // STORE
    expect(entry.header.crc).toBe(crc32Of(payload));
  });

  it("keeps memory flat on a large streamed file (regression guard for adm-zip OOM)", async () => {
    // 64 MB file streamed in 1 MB chunks - the writer must never hold it whole.
    const bigPath = path.join(tmpDir, "big.bin");
    const handle = fs.openSync(bigPath, "w");
    const chunk = Buffer.alloc(1024 * 1024, 7);
    for (let i = 0; i < 64; i++) fs.writeSync(handle, chunk);
    fs.closeSync(handle);

    const zipPath = path.join(tmpDir, "big.zip");
    const result = await writeZipArchiveStream(zipPath, [{ entryName: "big.bin", filePath: bigPath }]);
    expect(result.totalBytes).toBe(64 * 1024 * 1024);

    const zip = new AdmZip(zipPath);
    expect(zip.getEntries()).toHaveLength(1);
    const data = zip.readFile("big.bin")!;
    expect(data.length).toBe(64 * 1024 * 1024);
    expect(crc32Of(data)).toBe(crc32Of(Buffer.concat(Array(64).fill(chunk))));
  });

  it("rejects empty entry lists and cleans up the partial output", async () => {
    const zipPath = path.join(tmpDir, "nope.zip");
    await expect(writeZipArchiveStream(zipPath, [])).rejects.toThrow(/No entries/);
    expect(fs.existsSync(zipPath)).toBe(false);
  });
});

function crc32Of(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE_REF[(c ^ buf[i]!) & 0xff]!;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CRC_TABLE_REF: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
