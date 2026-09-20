export type ScenarioOption = { id: string; label: string; source?: string };
export type ProductionStation = {
  station: string;
  utilization: number | null;
  waiting?: number | null;
  queue?: number | null;
  wip?: number | null;
  storage_dwell?: number | null;
  cycle_time?: number | null;
  availability?: string;
};
export type ProductionData = {
  model: number;
  model_name: string;
  scenario_id: string;
  source: any;
  metrics: Record<string, number | null>;
  stations: ProductionStation[];
  raw?: Record<string, unknown>;
  unavailable?: string[];
  baseline?: any;
};
export type BottleneckData = {
  model: number;
  scenario_id: string;
  bottlenecks: Array<{
    station: string;
    score: number;
    severity: string;
    evidence: any[];
  }>;
  status?: string;
  message?: string;
};
export type InspectionBatch = {
  batch_id: string;
  created_at?: number;
  completed_at?: number;
  model?: number | null;
  scenario_id?: string | null;
  agent_session_id?: string;
  total_inspected: number;
  normal: number;
  defective: number;
  unsupported?: number;
  evaluated?: number;
  pass_rate: number;
  defect_rate: number;
  counts: Record<string, number>;
  class_percentages: Record<string, number>;
  average_coverage: number;
  max_coverage: number;
  primary_defect?: { type: string; count: number; percent: number } | null;
  secondary_defect?: { type: string; count: number; percent: number } | null;
  representative_samples?: any;
  unusual_samples?: any[];
  results: any[];
  deterministic_analysis?: any;
  automatic_analysis?: any;
  conversation?: any[];
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const d = (payload as any)?.detail;
    throw new Error(
      (typeof d === "object" ? d?.message : d) ||
        (payload as any)?.error ||
        `Request failed (${response.status})`,
    );
  }
  return payload as T;
}
async function streamJson(
  url: string,
  body: any,
  onEvent: (event: any) => void,
): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      payload?.error ||
        payload?.detail?.message ||
        `Request failed (${response.status})`,
    );
  }
  if (!response.body) throw new Error("Streaming response is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: any = null;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const line = frame
        .split(/\r?\n/)
        .find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6));
      onEvent(event);
      if (event.type === "result") result = event.result;
      if (event.type === "error")
        throw new Error(event.error || "Streaming request failed.");
    }
    if (done) break;
  }
  if (!result) throw new Error("Streaming request completed without a result.");
  return result;
}
export const astraApi = {
  scenarios: (model: number) =>
    json<{ model: number; scenarios: ScenarioOption[] }>(
      `/api/models/${model}/scenarios`,
    ),
  production: (model: number, scenario: string) =>
    json<ProductionData>(
      `/api/production/${model}/${encodeURIComponent(scenario)}`,
    ),
  bottlenecks: (model: number, scenario: string) =>
    json<BottleneckData>(
      `/api/bottlenecks/${model}/${encodeURIComponent(scenario)}`,
    ),
  batchInspection: async (
    files: File[],
    context?: { model: number; scenario_id: string },
  ) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file, file.name));
    if (context) {
      form.append("model", String(context.model));
      form.append("scenario_id", context.scenario_id);
    }
    return json<InspectionBatch>("/api/inspection/batch", {
      method: "POST",
      body: form,
    });
  },
  batchHistory: () => json<{ batches: any[]; count: number }>("/api/batches"),
  batch: (batchId: string) =>
    json<InspectionBatch>(`/api/batches/${encodeURIComponent(batchId)}`),
  analysisContext: (body: any) =>
    json<any>("/api/analysis/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  analysis: (body: any) =>
    json<any>("/api/agent/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  streamAnalysis: (body: any, onEvent: (event: any) => void) =>
    streamJson("/api/agent/analyze/stream", body, onEvent),
  streamChat: (body: any, onEvent: (event: any) => void) =>
    streamJson("/api/agent/chat/stream", body, onEvent),
  simulation: (body: any) =>
    json<any>("/api/simulation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  economics: (body: any) =>
    json<any>("/api/economics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  uploadProduction: async (model: number, file: File) => {
    const form = new FormData();
    form.append("model", String(model));
    form.append("file", file, file.name);
    return json<any>("/api/production/upload", { method: "POST", body: form });
  },
};
