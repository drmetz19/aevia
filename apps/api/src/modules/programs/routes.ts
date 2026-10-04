import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { errorSchema, programListSchema } from "@aevia/core";
import { findClinicBySlug, programs, type Db } from "@aevia/db";

export const programRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/v1/clinics/:slug/programs",
    {
      schema: {
        params: z.object({ slug: z.string().min(1).max(64) }),
        response: { 200: programListSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const clinic = await findClinicBySlug(db, req.params.slug);
      if (!clinic) {
        return reply.code(404).send({ error: "clinic_not_found", message: "Klinik yang Anda cari belum kami temukan." });
      }
      const rows = await db.withTenant(clinic.id, (tx) =>
        tx.select().from(programs).where(eq(programs.active, true)).orderBy(asc(programs.sortOrder)),
      );
      return {
        programs: rows.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          summary: p.summary,
          duration_weeks: p.durationWeeks,
          price_idr: p.priceIdr,
          includes: p.includes,
        })),
      };
    },
  );
};
