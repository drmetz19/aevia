import { describe, expect, it } from "vitest";
import { GENERAL_METRICS, checkinFields, computeMetric, computeProgress, isScaleMetric, STATUS_TEXT, NO_CHANGE_TEXT } from "./progress";
import { findForbidden } from "./guardrail";

const up = { metric_key: "tidur", label: "Kualitas tidur", unit: "skor", baseline: 2, target: 4, direction: "up" as const };
const down = { ...up, metric_key: "berat", label: "Berat badan", unit: "kg", direction: "down" as const };
const scaleDown = { ...up, metric_key: "x", label: "Skala", unit: "skor", direction: "down" as const };
const h = (...v: number[]) => v.map((value, i) => ({ at: `2026-10-0${i + 1}T00:00:00Z`, value }));

describe("computeMetric", () => {
  it("skala 1–5 selalu 5 = paling baik: tersimpan direction down pun, memburuk tidak pernah terbaca positif", () => {
    const worse = computeMetric(scaleDown, h(4, 2));
    expect(worse.direction).toBe("up");
    expect(worse.status).toBe("slow");
    expect(worse.status_text).not.toBe("Ada perubahan positif pada area ini.");
    expect(computeMetric(scaleDown, h(2, 4)).status).toBe("positive");
  });
  it("check-in pertama: tanpa delta, pesan menenangkan", () => {
    const m = computeMetric(up, h(3));
    expect(m).toMatchObject({ current: 3, previous: null, change_pct: null, delta_text: null, status: "first" });
  });
  it("naik 8% sejak check-in terakhir (arah naik = positif)", () => {
    const m = computeMetric({ ...up, unit: "kg" }, h(50, 54));
    expect(m.change_pct).toBe(8);
    expect(m.delta_text).toBe("Naik 8% sejak check-in terakhir");
    expect(m.status).toBe("positive");
    expect(m.status_text).toBe(STATUS_TEXT.positive);
  });
  it("arah turun: turun = positif; naik = butuh waktu, tanpa kata buruk/gagal", () => {
    const good = computeMetric(down, h(80, 60));
    expect(good.delta_text).toBe("Turun 25% sejak check-in terakhir");
    expect(good.status).toBe("positive");
    const slow = computeMetric(down, h(60, 80));
    expect(slow.delta_text).toBe("Naik 33.3% sejak check-in terakhir");
    expect(slow.status).toBe("slow");
    expect(JSON.stringify(slow)).not.toMatch(/buruk|gagal/i);
  });
  it("perubahan kecil = stabil; tiga nilai sama = belum terlihat perubahan yang berarti", () => {
    expect(computeMetric({ ...up, unit: "kg" }, h(100, 101)).status).toBe("stable");
    expect(computeMetric(up, h(3, 3, 3)).status_text).toBe(NO_CHANGE_TEXT);
    expect(computeMetric(up, h(3, 3)).delta_text).toBe("Tidak berubah sejak check-in terakhir");
  });
  it("sebelumnya 0 tidak membagi nol", () => {
    const m = computeMetric({ ...up, unit: "kg" }, h(0, 5));
    expect(m.change_pct).toBeNull();
    expect(m.status).toBe("stable");
  });
  it("riwayat diurutkan menurut waktu", () => {
    const m = computeMetric(up, [{ at: "2026-10-03T00:00:00Z", value: 4 }, { at: "2026-10-01T00:00:00Z", value: 2 }]);
    expect(m).toMatchObject({ current: 4, previous: 2 });
  });
});

describe("computeProgress & form", () => {
  it("memetakan nilai per metrik dari check-in", () => {
    const p = computeProgress(GENERAL_METRICS, [
      { at: "2026-10-01T00:00:00Z", values: { tidur: 2, energi: 3, stres: 2 } },
      { at: "2026-10-15T00:00:00Z", values: { tidur: 3, energi: 3, stres: 3 } },
    ], true);
    expect(p.checkin_count).toBe(2);
    expect(p.metrics.find((m) => m.key === "tidur")).toMatchObject({ current: 3, previous: 2, change_pct: 50 });
    expect(p.metrics.find((m) => m.key === "stres")).toMatchObject({ status: "positive", direction: "up", change_pct: 50 });
  });
  it("skala vs numerik", () => {
    expect(isScaleMetric({ unit: "" })).toBe(true);
    expect(isScaleMetric({ unit: "Skor" })).toBe(true);
    expect(isScaleMetric({ unit: "kg" })).toBe(false);
    expect(checkinFields([{ ...up, unit: "kg" }])[0]).toMatchObject({ scale: false, min: 0 });
    expect(checkinFields([up])[0]).toMatchObject({ scale: true, min: 1, max: 5 });
  });
});

describe("findForbidden", () => {
  it("menemukan istilah terlarang & klaim diagnosis; teks aman kosong", () => {
    expect(findForbidden("Hasil permanen dan wajib minum obat")).toEqual(expect.arrayContaining(["permanen", "wajib"]));
    expect(findForbidden("Anda harus istirahat")).toEqual(["anda harus"]);
    expect(findForbidden("Rutinitas malam 3 minggu")).toEqual([]);
  });
});
