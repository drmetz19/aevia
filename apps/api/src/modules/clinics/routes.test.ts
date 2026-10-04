import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, seed, type Db } from "@aevia/db";
import { buildApp } from "../../app";

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  db = await createDb();
  await db.migrate();
  await seed(db);
  app = await buildApp({ db });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("API klinik", () => {
  it("GET /health → ok", async () => {
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("drmetz → 200 cobrand dengan field publik saja", async () => {
    const res = await app.inject("/v1/clinics/drmetz/public");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ slug: "drmetz", name: "DrMetz", brand_mode: "cobrand", tagline: "Aesthetic & Wellness Clinic" });
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("llm_enabled");
    expect(body).not.toHaveProperty("custom_domain");
  });

  it("demo-partner → whitelabel; nama asisten pending tidak dibocorkan", async () => {
    const body = (await app.inject("/v1/clinics/demo-partner/public")).json();
    expect(body.brand_mode).toBe("whitelabel");
    expect(body.colors.primary).toBe("#1F4D3F");
    expect(body.assistant_name).toBe("Sovia");
  });

  it("slug tak dikenal → 404 pesan manusiawi Indonesia", async () => {
    const res = await app.inject("/v1/clinics/tidak-ada/public");
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/belum kami temukan/);
  });
});
