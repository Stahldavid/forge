import { programAssert } from "./program-contract.ts";

/** Bounded image header validation. Pixel decoding/render acceptance belongs to the registered checker. */
export function programImage(bytes: Uint8Array): { mime: string; width: number; height: number } {
  const data = Buffer.from(bytes); programAssert(data.length >= 24 && data.length <= 8 * 1024 * 1024, "Invalid image byte size");
  let mime = "", width = 0, height = 0;
  if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && data.toString("ascii",12,16) === "IHDR") { mime = "image/png"; width = data.readUInt32BE(16); height = data.readUInt32BE(20); }
  else if (data[0] === 255 && data[1] === 216) {
    mime = "image/jpeg"; let offset = 2;
    while (offset + 9 < data.length) { if (data[offset++] !== 255) break; const marker = data[offset++], size = data.readUInt16BE(offset); if ([192,193,194].includes(marker)) { height = data.readUInt16BE(offset+3); width = data.readUInt16BE(offset+5); break; } if (size < 2) break; offset += size; }
  } else if (data.toString("ascii",0,4) === "RIFF" && data.toString("ascii",8,12) === "WEBP" && data.toString("ascii",12,16) === "VP8X" && data.length >= 30) {
    mime = "image/webp"; width = 1 + data.readUIntLE(24,3); height = 1 + data.readUIntLE(27,3);
  }
  programAssert(width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 64 * 1024 * 1024, "Unsupported/invalid image header or pixel budget"); return { mime, width, height };
}
