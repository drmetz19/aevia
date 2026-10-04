import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorSchema, publicClinicSchema } from "@aevia/core";
import type { Db } from "@aevia/db";
import { getPublicClinic } from "./service";

export const clinicRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/v1/clinics/:slug/public",
    {
      schema: {
        params: z.object({ slug: z.string().min(1).max(64) }),
        response: { 200: publicClinicSchema, 404: errorSchema },
      },
    },
    async (req, reply) => {
      const clinic = await getPublicClinic(db, req.params.slug);
      if (!clinic) {
        return reply.code(404).send({
          error: "clinic_not_found",
          message: "Klinik yang Anda cari belum kami temukan. Periksa kembali tautan dari klinik Anda.",
        });
      }
      return clinic;
    },
  );
};
