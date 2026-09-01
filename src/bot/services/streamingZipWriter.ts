import fs from "fs";
import { Readable } from "stream";

/**
 * Streaming STORE-only ZIP writer (audit 8.15).
 *
 * Why this exists: adm-zip builds the ENTIRE archive in RAM (entry buffers +
 * the final zip Buffer), so packaging a 9-episode batch (~830 MB) peaked at
 * ~1.6 GB RSS inside the ~954 MB container cgroup and the kernel OOM-killed
 * the bot right after the last episode finished. This writer keeps memory
 * flat (a few MB of chunk buffers) by streaming each file to disk with
 * backpressure.
 *
 * Format choices for maximum extractor compatibility (phone unzip apps
 * included):
 * - method STORE (0): episodes are H.264/AAC MP4s, deflate would waste CPU
 *   for ~0% gain. STORE is universally supported.
 * - CRC32 and sizes are written in the LOCAL header (pre-pass CRC) instead
 *   of a trailing data descriptor - the most compatible layout.
 * - UTF-8 name flag (0x0800), Unix "version made by" with explicit 0644
 *   external attributes so extracted files are readable on Unix.
 * - No ZIP64: throws early if the archive would exceed the 4 GB classic
 *   limit (batch quota is far below that).
 */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(register: number, data: Buffer): number {
  let c = register;
  for (let i = 0; i < data.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ data[i])! & 0xff]!;
  }
  return c >>> 0;
}

/** DOS date/time pair from a JS Date (clamped to the 1980-2107 range). */
function dosDateTime(d: Date): { time: number; date: number } {
  let year = d.getFullYear();
  if (year < 1980) year = 1980;
  if (year > 2107) year = 2107;
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: (time & 0xffff) >>> 0, date: (date & 0xffff) >>> 0 };
}

export interface StreamingZipEntry {
  /** Entry name inside the archive (e.g. "Title_S01E01_480P.mp4"). */
  entryName: string;
  /** Local file to stream into the archive. */
  filePath?: string;
  /** OR: small in-memory payload (e.g. README manifest). Mutually exclusive with filePath. */
  data?: Buffer;
  /** Modification timestamp recorded in the archive (default: now). */
  mtime?: Date;
}

export interface StreamingZipResult {
  entryCount: number;
  totalBytes: number;
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const VERSION = 20;
const VERSION_MADE_BY = (3 << 8) | 20; // Unix host, spec 2.0
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0; // regular file, rw-r--r--
const CHUNK_SIZE = 1024 * 1024;
const CLASSIC_ZIP_MAX = 0xffffffff; // 4 GB - 1

/**
 * Write a STORE-only zip archive to `outputPath` with constant memory usage.
 * Throws (and removes the partial output) if any single entry is unreadable
 * or the archive would exceed the classic (non-ZIP64) limits.
 */
export async function writeZipArchiveStream(
  outputPath: string,
  entries: StreamingZipEntry[],
  onEntry?: (entryName: string, bytesWritten: number) => void
): Promise<StreamingZipResult> {
  if (!entries || entries.length === 0) {
    throw new Error("No entries to archive");
  }
  if (entries.length > 0xffff) {
    throw new Error(`Too many entries for a classic zip archive (${entries.length})`);
  }

  const writer = fs.createWriteStream(outputPath);
  let failed: Error | null = null;
  let writerError: Error | null = null;
  writer.on("error", (err: Error) => {
    // Surface write errors (e.g. disk full) to pending drain waits instead of
    // hanging forever, and to the outer catch via `failed`.
    writerError = err;
    failed = failed ?? err;
    writer.emit("drain");
  });

  const writeChunk = async (chunk: Buffer): Promise<void> => {
    if (failed) return;
    if (!writer.write(chunk)) {
      await new Promise<void>((resolveDrain) => writer.once("drain", () => resolveDrain()));
      if (writerError) throw writerError;
    }
  };

  interface CentralRecord {
    nameBuf: Buffer;
    crc: number;
    size: number;
    time: number;
    date: number;
    offset: number;
  }
  const centralRecords: CentralRecord[] = [];
  let offset = 0;
  let totalBytes = 0;

  try {
    for (const entry of entries) {
      if (failed) break;

      const nameBuf = Buffer.from(entry.entryName, "utf-8");
      if (nameBuf.length === 0 || nameBuf.length > 1024) {
        throw new Error(`Invalid zip entry name length: "${entry.entryName}"`);
      }

      let dataStream: Readable;
      let size: number;
      let crc = 0xffffffff;

      if (entry.data) {
        dataStream = Readable.from(entry.data);
        size = entry.data.length;
        crc = crc32Update(crc, entry.data);
      } else if (entry.filePath) {
        const stat = await fs.promises.stat(entry.filePath);
        if (!stat.isFile()) {
          throw new Error(`Not a regular file: ${entry.filePath}`);
        }
        size = stat.size;
        // Pre-pass CRC so the local header is complete (no data descriptor).
        const crcHandle = fs.promises.open(entry.filePath, "r");
        const crcFd = await crcHandle;
        try {
          const chunk = Buffer.alloc(CHUNK_SIZE);
          let readTotal = 0;
          while (readTotal < size) {
            const { bytesRead } = await crcFd.read(chunk, 0, Math.min(CHUNK_SIZE, size - readTotal), readTotal);
            if (bytesRead <= 0) break;
            crc = crc32Update(crc, chunk.subarray(0, bytesRead));
            readTotal += bytesRead;
          }
        } finally {
          await crcFd.close();
        }
        dataStream = fs.createReadStream(entry.filePath, { highWaterMark: CHUNK_SIZE });
      } else {
        throw new Error(`Zip entry "${entry.entryName}" has neither filePath nor data`);
      }

      crc = (crc ^ 0xffffffff) >>> 0;
      if (size > CLASSIC_ZIP_MAX || offset > CLASSIC_ZIP_MAX) {
        throw new Error(`Archive exceeds the 4 GB classic zip limit (zip64 unsupported): ${entry.entryName}`);
      }

      const { time, date } = dosDateTime(entry.mtime ?? new Date());

      // ---- Local file header ----
      const lfh = Buffer.alloc(30);
      lfh.writeUInt32LE(LOCAL_HEADER_SIG, 0);
      lfh.writeUInt16LE(VERSION, 4);
      lfh.writeUInt16LE(UTF8_FLAG, 6);
      lfh.writeUInt16LE(STORE_METHOD, 8);
      lfh.writeUInt16LE(time, 10);
      lfh.writeUInt16LE(date, 12);
      lfh.writeUInt32LE(crc, 14);
      lfh.writeUInt32LE(size, 18); // compressed size
      lfh.writeUInt32LE(size, 22); // uncompressed size (STORE => identical)
      lfh.writeUInt16LE(nameBuf.length, 26);
      lfh.writeUInt16LE(0, 28); // extra field length
      await writeChunk(lfh);
      await writeChunk(nameBuf);

      // ---- Payload (streamed with backpressure; for-await pauses/resumes
      // the readable automatically and propagates read errors) ----
      const localOffset = offset;
      offset += 30 + nameBuf.length;
      for await (const chunk of dataStream) {
        const buf = chunk as Buffer;
        offset += buf.length;
        totalBytes += buf.length;
        await writeChunk(buf);
      }

      centralRecords.push({ nameBuf, crc, size, time, date, offset: localOffset });
      onEntry?.(entry.entryName, size);
    }

    if (!failed) {
      // ---- Central directory ----
      const cdStart = offset;
      for (const rec of centralRecords) {
        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
        cdh.writeUInt16LE(VERSION_MADE_BY, 4);
        cdh.writeUInt16LE(VERSION, 6);
        cdh.writeUInt16LE(UTF8_FLAG, 8);
        cdh.writeUInt16LE(STORE_METHOD, 10);
        cdh.writeUInt16LE(rec.time, 12);
        cdh.writeUInt16LE(rec.date, 14);
        cdh.writeUInt32LE(rec.crc, 16);
        cdh.writeUInt32LE(rec.size, 20);
        cdh.writeUInt32LE(rec.size, 24);
        cdh.writeUInt16LE(rec.nameBuf.length, 28);
        cdh.writeUInt16LE(0, 30); // extra
        cdh.writeUInt16LE(0, 32); // comment
        cdh.writeUInt16LE(0, 34); // disk number start
        cdh.writeUInt16LE(0, 36); // internal attrs
        cdh.writeUInt32LE(EXTERNAL_ATTRS, 38);
        cdh.writeUInt32LE(rec.offset, 42);
        await writeChunk(cdh);
        await writeChunk(rec.nameBuf);
        offset += 46 + rec.nameBuf.length;
      }
      const cdSize = offset - cdStart;
      if (cdStart > CLASSIC_ZIP_MAX || cdSize > CLASSIC_ZIP_MAX) {
        throw new Error("Central directory exceeds the 4 GB classic zip limit");
      }

      // ---- End of central directory ----
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(EOCD_SIG, 0);
      eocd.writeUInt16LE(0, 4); // this disk
      eocd.writeUInt16LE(0, 6); // disk with central directory
      eocd.writeUInt16LE(centralRecords.length, 8);
      eocd.writeUInt16LE(centralRecords.length, 10);
      eocd.writeUInt32LE(cdSize, 12);
      eocd.writeUInt32LE(cdStart, 16);
      eocd.writeUInt16LE(0, 20); // comment length
      await writeChunk(eocd);
    }

    await new Promise<void>((resolveClose, rejectClose) => {
      writer.end((err?: Error | null) => {
        if (err) rejectClose(err);
        else resolveClose();
      });
    });

    return { entryCount: centralRecords.length, totalBytes };
  } catch (err) {
    failed = err as Error;
    try {
      writer.destroy();
    } catch {}
    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {}
    throw err;
  }
}
