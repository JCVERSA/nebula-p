import { describe, it, expect } from "vitest";
import {
  pickOptimalStream,
  StreamQualityTrack,
  unpackDeanEdwards,
  decodeJsStringLiteral,
  decodeJsArrayLiteral
} from "../src/bot/services/animeStreamExtractor.js";
import { robustFetchText, robustFetchBuffer } from "../src/bot/services/hlsDownloader.js";

describe("Anime Stream Quality Prioritization", () => {
  it("prioritizes 480p first when multiple tracks are detected", () => {
    const tracks: StreamQualityTrack[] = [
      { resolution: "1080P", url: "https://vidmoly.to/1080.m3u8", type: "hls" },
      { resolution: "720P", url: "https://vidmoly.to/720.m3u8", type: "hls" },
      { resolution: "480P", url: "https://vidmoly.to/480.m3u8", type: "hls" },
      { resolution: "360P", url: "https://vidmoly.to/360.m3u8", type: "hls" },
    ];

    const optimal = pickOptimalStream(tracks);
    expect(optimal.resolution).toBe("480P");
    expect(optimal.url).toBe("https://vidmoly.to/480.m3u8");
  });

  it("prioritizes 360p if 480p is not available", () => {
    const tracks: StreamQualityTrack[] = [
      { resolution: "1080P", url: "https://vidmoly.to/1080.m3u8", type: "hls" },
      { resolution: "720P", url: "https://vidmoly.to/720.m3u8", type: "hls" },
      { resolution: "360P", url: "https://vidmoly.to/360.m3u8", type: "hls" },
    ];

    const optimal = pickOptimalStream(tracks);
    expect(optimal.resolution).toBe("360P");
  });

  it("honors explicit requested resolution if supplied", () => {
    const tracks: StreamQualityTrack[] = [
      { resolution: "1080P", url: "https://vidmoly.to/1080.m3u8", type: "hls" },
      { resolution: "720P", url: "https://vidmoly.to/720.m3u8", type: "hls" },
      { resolution: "480P", url: "https://vidmoly.to/480.m3u8", type: "hls" },
    ];

    const selected = pickOptimalStream(tracks, "720P");
    expect(selected.resolution).toBe("720P");
    expect(selected.url).toBe("https://vidmoly.to/720.m3u8");
  });
});

describe("Safe Dean Edwards Unpacker", () => {
  it("unpacks Dean Edwards script safely without eval/new Function", () => {
    // Packed script representing: file:"https://vidmoly.to/stream.m3u8"
    const packedHtml = `<html><script>eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\b'+c.toString(a)+'\\b','g'),k[c]);return p}('0:\\'1://2.3/4.5\\'',6,6,'file|https|vidmoly|to|stream|m3u8'.split('|')))</script></html>`;
    const unpacked = unpackDeanEdwards(packedHtml);
    expect(unpacked).toContain("https://vidmoly.to/stream.m3u8");
    expect(unpacked).toContain("file:'https://vidmoly.to/stream.m3u8'");
  });

  it("decodes hex and unicode escapes in string literals", () => {
    expect(decodeJsStringLiteral("'\\x68\\x74\\x74\\x70\\x73'")).toBe("https");
    expect(decodeJsArrayLiteral("['\\x61','\\x62']")).toEqual(["a", "b"]);
  });
});

describe("HLS Downloader SSRF Guard", () => {
  it("blocks non-public or loopback destinations", async () => {
    const localText = await robustFetchText("http://127.0.0.1:8080/secret", {});
    expect(localText).toBeNull();

    const localBuffer = await robustFetchBuffer("http://169.254.169.254/latest/meta-data", {});
    expect(localBuffer).toBeNull();
  });
});
