import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const BACKEND_BASE =
  process.env.ASTRA_DETERMINISTIC_BACKEND_URL || "http://127.0.0.1:5000";

function modelId(value) {
  const n = Number(String(value ?? "").match(/[123]/)?.[0]);
  if (![1, 2, 3].includes(n)) throw new Error(`Invalid model: ${value}`);
  return n;
}

function scenarioId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Scenario id is required.");
  if (/^SC-\d+$/i.test(raw)) return raw.toUpperCase();
  if (/^ROW-\d+$/i.test(raw))
    return `SC-${String(Number(raw.split("-")[1])).padStart(4, "0")}`;
  if (/^\d+$/.test(raw)) return `SC-${String(Number(raw)).padStart(4, "0")}`;
  throw new Error(`Invalid scenario id: ${value}`);
}

async function backendFetch(path, options = {}) {
  const response = await fetch(`${BACKEND_BASE}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      payload?.detail?.message ||
      payload?.detail ||
      payload?.error ||
      `HTTP ${response.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return payload;
}

async function postJson(path, body) {
  return backendFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dataUriToBlob(dataUri, filename = "surface.png") {
  const match = String(dataUri || "").match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Image must be supplied as a base64 data URI.");
  const bytes = Buffer.from(match[2], "base64");
  return {
    blob: new Blob([bytes], { type: match[1] }),
    filename,
    mime: match[1],
  };
}

export const getModelsTool = new DynamicStructuredTool({
  name: "get_models",
  description:
    "Return the manufacturing models and the real dataset currently loaded for each model.",
  schema: z.object({}),
  func: async () => backendFetch("/api/models"),
});

export const getScenariosTool = new DynamicStructuredTool({
  name: "get_scenarios",
  description: "Return valid dataset scenarios for a manufacturing model.",
  schema: z.object({ model: z.union([z.number(), z.string()]) }),
  func: async ({ model }) =>
    backendFetch(`/api/models/${modelId(model)}/scenarios`),
});

export const getProductionDataTool = new DynamicStructuredTool({
  name: "get_production_data",
  description:
    "Return measured/calculated production metrics and station values for a real dataset scenario.",
  schema: z.object({
    model: z.union([z.number(), z.string()]),
    scenario_id: z.union([z.number(), z.string()]),
  }),
  func: async ({ model, scenario_id }) =>
    backendFetch(
      `/api/production/${modelId(model)}/${encodeURIComponent(scenarioId(scenario_id))}`,
    ),
});

export const evaluateBottlenecksTool = new DynamicStructuredTool({
  name: "evaluate_bottlenecks",
  description:
    "Run the deterministic multi-signal bottleneck engine for a real dataset scenario.",
  schema: z.object({
    model: z.union([z.number(), z.string()]),
    scenario_id: z.union([z.number(), z.string()]),
  }),
  func: async ({ model, scenario_id }) =>
    backendFetch(
      `/api/bottlenecks/${modelId(model)}/${encodeURIComponent(scenarioId(scenario_id))}`,
    ),
});

export const getInspectionBatchTool = new DynamicStructuredTool({
  name: "get_inspection_batch",
  description:
    "Return the structured results of a previously analyzed image batch, including real classes, boxes, components and coverage.",
  schema: z.object({ batch_id: z.string().min(1) }),
  func: async ({ batch_id }) =>
    backendFetch(
      `/api/inspection/batches/${encodeURIComponent(batch_id)}?compact=true`,
    ),
});

export const batchInspectionAnalysisTool = new DynamicStructuredTool({
  name: "batch_inspection_analysis",
  description:
    "Return the persisted deterministic production-plus-inspection analysis for one real ASTRA batch ID. This is the canonical batch-analysis tool.",
  schema: z.object({ batch_id: z.string().min(1) }),
  func: async ({ batch_id }) =>
    backendFetch(
      `/api/batches/${encodeURIComponent(String(batch_id).trim().toUpperCase())}/analysis`,
    ),
});

export const estimateDefectRiskTool = new DynamicStructuredTool({
  name: "estimate_defect_risk",
  description:
    "Rank the likely defect types using a deterministic evidence-weighted calculation over the active persisted inspection batch. Use this for next/future/likely defect questions; it is an empirical estimate, not a causal or time-series forecast.",
  schema: z.object({ batch_id: z.string().min(1) }),
  func: async ({ batch_id }) =>
    backendFetch(
      `/api/batches/${encodeURIComponent(String(batch_id).trim().toUpperCase())}/defect-risk`,
    ),
});

export const investigateRootCauseTool = new DynamicStructuredTool({
  name: "investigate_root_cause",
  description:
    "Correlate a defect class with the active production evidence using the deterministic investigation service. This returns hypotheses, not causal proof.",
  schema: z.object({
    model: z.union([z.number(), z.string()]),
    scenario_id: z.union([z.number(), z.string()]),
    defect_type: z.string().min(1),
  }),
  func: async ({ model, scenario_id, defect_type }) =>
    postJson("/api/investigation", {
      model: modelId(model),
      scenario_id: scenarioId(scenario_id),
      defect_type,
    }),
});

export const simulateChangeTool = new DynamicStructuredTool({
  name: "simulate_change",
  description:
    "Run nearest-neighbor what-if matching using only numeric columns that exist in the active dataset.",
  schema: z.object({
    model: z.union([z.number(), z.string()]),
    scenario_id: z.union([z.number(), z.string()]),
    changes: z.record(z.string(), z.number()),
  }),
  func: async ({ model, scenario_id, changes }) =>
    postJson("/api/simulation", {
      model: modelId(model),
      scenario_id: scenarioId(scenario_id),
      changes,
    }),
});

export const evaluateEconomicsTool = new DynamicStructuredTool({
  name: "evaluate_economics",
  description:
    "Calculate economic impact only from explicit operator assumptions and supplied counts.",
  schema: z.object({
    defective_units: z.number().int().min(0).optional().default(0),
    scrap_units: z.number().int().min(0).optional().default(0),
    rework_units: z.number().int().min(0).optional().default(0),
    lost_output_units: z.number().int().min(0).optional().default(0),
    scrap_cost_per_unit: z.number().min(0).optional(),
    rework_cost_per_unit: z.number().min(0).optional(),
    value_per_lost_unit: z.number().min(0).optional(),
    contribution_margin_per_unit: z.number().min(0).optional(),
  }),
  func: async (args) => postJson("/api/economics", args),
});

export const getDatasetMetadataTool = new DynamicStructuredTool({
  name: "get_dataset_metadata",
  description:
    "Return dataset provenance, real schemas, row counts and truth labels from the deterministic backend.",
  schema: z.object({}),
  func: async () => backendFetch("/api/metadata"),
});

export const listCsvFilesTool = new DynamicStructuredTool({
  name: "list_csv_files",
  description: "List the production CSV datasets currently available to ASTRA.",
  schema: z.object({}),
  func: async () => backendFetch("/api/csv/files"),
});

export const readCsvFileTool = new DynamicStructuredTool({
  name: "read_csv_file",
  description:
    "Preview rows from an available production CSV without inventing columns or values.",
  schema: z.object({
    file_name: z.string().min(1),
    start_row: z.number().int().min(1).optional().default(1),
    num_rows: z.number().int().min(1).max(100).optional().default(10),
  }),
  func: async ({ file_name, start_row = 1, num_rows = 10 }) =>
    backendFetch(
      `/api/csv/data?file=${encodeURIComponent(file_name)}&action=get_rows&start_row=${start_row}&num_rows=${num_rows}`,
    ),
});

export const detectDefectImageTool = new DynamicStructuredTool({
  name: "detect_defect_image",
  description:
    "Run an attached image through the real trained classifier and localization detector. Returns the real class, mask, boxes, components and coverage.",
  schema: z.object({
    image: z.string().min(20),
    filename: z.string().optional(),
  }),
  func: async ({ image, filename = "surface.png" }) => {
    const { blob } = dataUriToBlob(image, filename);
    const form = new FormData();
    form.append("file", blob, filename);
    return backendFetch("/api/inspection/image", {
      method: "POST",
      body: form,
    });
  },
});

export const ASTRA_TOOLS = [
  getModelsTool,
  getScenariosTool,
  getProductionDataTool,
  evaluateBottlenecksTool,
  getInspectionBatchTool,
  batchInspectionAnalysisTool,
  estimateDefectRiskTool,
  investigateRootCauseTool,
  simulateChangeTool,
  evaluateEconomicsTool,
  getDatasetMetadataTool,
  listCsvFilesTool,
  readCsvFileTool,
  detectDefectImageTool,
];

const toolMap = new Map(ASTRA_TOOLS.map((tool) => [tool.name, tool]));

export function toolCatalogForPrompt() {
  return ASTRA_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

export async function executeTool(name, args = {}) {
  const tool = toolMap.get(name);
  if (!tool) return { status: "failed", error: `Unknown ASTRA tool: ${name}` };
  try {
    return await tool.invoke(args);
  } catch (error) {
    return { status: "failed", error: error?.message || String(error) };
  }
}
