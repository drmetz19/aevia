import { describe, expect, it } from "vitest";
import { annotationSchema, sniffImage, skinBodySchema } from "./clinical";

describe("sniffImage", () => {
  it("mengenali jpg/png/webp dari magic bytes", () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("menolak selain itu", () => {
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffImage(Buffer.from("<svg></svg>"))).toBeNull();
    expect(sniffImage(Buffer.from("%PDF-1.4"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("annotationSchema", () => {
  it("titik dan area valid; area butuh w/h dan di dalam foto; koordinat 0–1", () => {
    expect(annotationSchema.safeParse({ type: "point", x: 0.2, y: 0.4, label: "a", severity: "low" }).success).toBe(true);
    expect(annotationSchema.safeParse({ type: "area", x: 0.2, y: 0.4, w: 0.3, h: 0.2, label: "b", severity: "high" }).success).toBe(true);
    expect(annotationSchema.safeParse({ type: "area", x: 0.2, y: 0.4, label: "b", severity: "high" }).success).toBe(false);
    expect(annotationSchema.safeParse({ type: "area", x: 0.9, y: 0.4, w: 0.3, h: 0.2, label: "b", severity: "high" }).success).toBe(false);
    expect(annotationSchema.safeParse({ type: "point", x: 1.2, y: 0.4, label: "a", severity: "low" }).success).toBe(false);
  });
});

describe("skinBody", () => {
  it("skor 0–100 bilangan bulat", () => {
    expect(skinBodySchema.safeParse({ scores: { a: 0, b: 100 }, notes: "" }).success).toBe(true);
    expect(skinBodySchema.safeParse({ scores: { a: 101 }, notes: "" }).success).toBe(false);
    expect(skinBodySchema.safeParse({ scores: { a: 5.5 }, notes: "" }).success).toBe(false);
  });
});
