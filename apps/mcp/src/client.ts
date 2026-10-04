/**
 * Klien tipis ke REST integrasi AEVIA. MCP tidak punya akses DB: semua cakupan (scope), persetujuan pasien,
 * isolasi klinik, batas permintaan, dan audit dijalankan oleh API. Header X-Aevia-Actor: mcp membuat API
 * mencatat actor_type=mcp (penanda audit, bukan hak akses tambahan).
 */
export class AeviaApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AeviaClientOptions {
  apiUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class AeviaClient {
  private base: string;
  constructor(private o: AeviaClientOptions) {
    this.base = o.apiUrl.replace(/\/+$/, "");
  }

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await (this.o.fetchFn ?? fetch)(`${this.base}${path}`, {
        method,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000),
        headers: {
          authorization: `Bearer ${this.o.apiKey}`,
          "x-aevia-actor": "mcp",
          "user-agent": "aevia-mcp/0.1",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AeviaApiError(0, "unreachable", "API AEVIA tidak dapat dihubungi. Periksa AEVIA_API_URL dan koneksi Anda, lalu coba lagi.");
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new AeviaApiError(res.status, json.error ?? "error", json.message ?? `Permintaan ditolak (HTTP ${res.status}).`);
    return json as T;
  }

  summary = (patientId: string) => this.req<Record<string, any>>("GET", `/v1/integrations/patients/${patientId}/summary`);
  checkins = (patientId: string, limit: number) => this.req<Record<string, any>>("GET", `/v1/integrations/patients/${patientId}/checkins?limit=${limit}`);
  progress = (patientId: string) => this.req<Record<string, any>>("GET", `/v1/integrations/patients/${patientId}/progress`);
  carePlan = (patientId: string) => this.req<Record<string, any>>("GET", `/v1/integrations/patients/${patientId}/care-plan`);
  reminder = (body: { patient_id: string; kind: "checkin" | "review"; due_at?: string }) => this.req<Record<string, any>>("POST", "/v1/integrations/reminders", body);
  consultationRequest = (body: Record<string, unknown>) => this.req<Record<string, any>>("POST", "/v1/integrations/consultation-requests", body);
}
