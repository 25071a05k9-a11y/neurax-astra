import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { AgySession, acquireAgySession, getAgyStatus } from "./agy-provider.js";
import { executeTool, toolCatalogForPrompt } from "./astra-tools.js";

const BACKEND_BASE =
  process.env.ASTRA_DETERMINISTIC_BACKEND_URL || "http://127.0.0.1:5000";

export const SYSTEM_PROMPT = `You are ASTRA, the reasoning layer for a manufacturing intelligence system.
Use deterministic ASTRA tools for manufacturing facts. Never invent values, confidence, machine readings, scenario outputs, root causes, or economics.
Always distinguish measured, calculated, hypothesis, simulated, user_assumption, and unavailable.
A visual defect/process association is an investigation hypothesis unless a direct unit-to-machine join is explicitly present.
If evidence conflicts or is missing, say so. Do not claim a machine caused a defect without direct traceability.
When tools are needed, request only tools from AVAILABLE TOOLS. Do not request shell/terminal/filesystem tools.
Return one JSON object: {"answer":"Markdown answer","tool_calls":[{"name":"...","arguments":{}}],"render_blocks":[]}.
Use batch_inspection_analysis for persisted batch analysis and get_inspection_batch for sample-level detector evidence. Never call an endpoint or tool that is not listed.
For questions about the next, future, or likely defect, use estimate_defect_risk and report its ranked evidence score as a calculated estimate. Explain that it is not causal proof, but do not discard a valid estimate as merely unavailable.
Never output a local filesystem path. Image blocks may only reference artifact_url values returned by ASTRA tools; never invent coordinates or image URLs.
When enough evidence is available, tool_calls must be []. Do not expose hidden chain-of-thought.
AVAILABLE TOOLS:
${JSON.stringify(toolCatalogForPrompt(), null, 2)}`;

function parseJsonObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed;
  } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed;
    } catch {}
  }
  return { answer: String(text || ""), tool_calls: [], render_blocks: [] };
}

function agyMessagePrompt(messages = []) {
  return messages
    .map((message) => {
      const role =
        message instanceof SystemMessage
          ? "SYSTEM"
          : message instanceof AIMessage
            ? "ASSISTANT"
            : "USER";
      return `${role}:\n${typeof message.content === "string" ? message.content : JSON.stringify(message.content)}`;
    })
    .join("\n\n");
}

function compactEvidence(value) {
  if (Array.isArray(value)) return value.map(compactEvidence);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      [
        "original_image",
        "annotated_image",
        "mask_image",
        "annotated_image_data_uri",
        "image_markdown",
      ].includes(key)
    )
      continue;
    output[key] = compactEvidence(child);
  }
  return output;
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

export async function serverProviderHealth() {
  const agy = await getAgyStatus().catch((error) => ({
    installed: false,
    authenticated: false,
    version: null,
    version_supported: false,
    models: [],
    model: null,
    configured: false,
    configuration_valid: false,
    detail: error?.message || "AGY status unavailable.",
  }));
  return {
    provider: "agy",
    configured: Boolean(agy.configured),
    model: agy.model || process.env.PARADOX_AI_MODEL || null,
    configurationValid: agy.configuration_valid !== false,
    configurationError: agy.detail,
    agy,
  };
}

export function createModelRuntime(config = {}, { agySessionId = "" } = {}) {
  return {
    config: {
      provider: "agy",
      model: config.model || process.env.PARADOX_AI_MODEL || "",
      reasoning_effort:
        config.reasoning_effort ||
        process.env.PARADOX_AI_REASONING_EFFORT ||
        "medium",
    },
    agySession: null,
    agyLease: null,
    agySessionId,
  };
}

export async function invokeRuntime(runtime, messages, onAgyEvent = null) {
  if (!runtime.agySession) {
    if (runtime.agySessionId) {
      runtime.agyLease = await acquireAgySession(
        runtime.agySessionId,
        runtime.config,
      );
      runtime.agySession = runtime.agyLease.session;
    } else {
      runtime.agySession = new AgySession(runtime.config);
    }
  }
  const response = await runtime.agySession.send(
    agyMessagePrompt(messages),
    onAgyEvent,
  );
  runtime.config = {
    ...runtime.config,
    model: runtime.agySession.config.model,
  };
  return { content: response };
}

export async function closeRuntime(runtime) {
  if (!runtime?.agySession) return;
  if (runtime.agyLease) {
    runtime.agySession = null;
    const lease = runtime.agyLease;
    runtime.agyLease = null;
    await lease.release().catch(() => {});
    return;
  }
  const session = runtime.agySession;
  runtime.agySession = null;
  await session.close().catch(() => {});
}

const sessionHistories = new Map();
export function getSessionHistory(sessionId) {
  if (!sessionId) return [];
  if (!sessionHistories.has(sessionId)) sessionHistories.set(sessionId, []);
  return sessionHistories.get(sessionId);
}

async function inspectAttachedImage(image_b64, filename) {
  if (!image_b64) return null;
  return executeTool("detect_defect_image", {
    image: image_b64,
    filename: filename || "attached_surface.png",
  });
}

async function backendJson(path, body, method = "POST") {
  return backendFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadBatchConversation(batchId) {
  if (!batchId) return [];
  try {
    const value = await backendFetch(
      `/api/batches/${encodeURIComponent(batchId)}/conversation`,
    );
    return Array.isArray(value.messages) ? value.messages.slice(-12) : [];
  } catch {
    return [];
  }
}

async function storeBatchMessage(batchId, role, content, renderBlocks = []) {
  if (!batchId) return;
  await backendJson(
    `/api/batches/${encodeURIComponent(batchId)}/conversation`,
    {
      role,
      content,
      render_blocks: renderBlocks,
    },
  ).catch(() => {});
}

function artifactUrl(value) {
  const url = String(value || "");
  return /^\/api\/artifacts\/ART-[A-Z0-9]+$/i.test(url) ? url : "";
}

function sanitizeRenderBlocks(blocks = []) {
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, 24).flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const type = String(block.type || "").toLowerCase();
    if (type === "text")
      return [{ type, text: String(block.text || "").slice(0, 12000) }];
    if (["warning", "recommendation", "evidence"].includes(type)) {
      return [
        {
          type,
          title: String(block.title || type),
          text: String(block.text || "").slice(0, 12000),
          kind: block.kind || null,
        },
      ];
    }
    if (type === "metrics" || type === "metric_row") {
      const items = Array.isArray(block.items)
        ? block.items.slice(0, 12).map((item) => ({
            label: String(item?.label || ""),
            value: String(item?.value ?? ""),
            kind: item?.kind || null,
          }))
        : [];
      return items.length ? [{ type: "metrics", items }] : [];
    }
    if (
      type === "table" &&
      Array.isArray(block.columns) &&
      Array.isArray(block.rows)
    ) {
      return [
        {
          type,
          columns: block.columns.slice(0, 12).map(String),
          rows: block.rows
            .slice(0, 100)
            .map((row) =>
              Array.isArray(row)
                ? row.slice(0, 12).map((cell) => String(cell ?? ""))
                : [],
            ),
        },
      ];
    }
    if (type === "simulation_result")
      return [
        {
          type,
          title: String(block.title || "Simulation result"),
          data: compactEvidence(block.data || {}),
        },
      ];
    if (type === "image" || type === "annotated-image") {
      const url = artifactUrl(block.url || block.artifact_url);
      if (!url) return [];
      return [
        {
          type,
          url,
          sample_id: String(block.sample_id || ""),
          label: String(block.label || ""),
          defect_label: String(block.defect_label || ""),
          coverage: block.coverage ?? null,
          bounding_boxes: Array.isArray(block.bounding_boxes)
            ? block.bounding_boxes
            : [],
        },
      ];
    }
    return [];
  });
}

function dedupeRenderBlocks(blocks = []) {
  const seen = new Set();
  return blocks.filter((block) => {
    const key =
      block.type === "image" || block.type === "annotated-image"
        ? `${block.type}:${block.url}:${block.sample_id || ""}`
        : JSON.stringify(block);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceBlocks(
  deterministic,
  { includeImage = true, query = "" } = {},
) {
  const inspection =
    deterministic?.inspection || deterministic?.deterministic?.inspection;
  if (!inspection) return [];
  const blocks = [
    {
      type: "metrics",
      items: [
        {
          label: "Inspected",
          value: inspection.total_inspected,
          kind: "measured",
        },
        { label: "Defective", value: inspection.defective, kind: "calculated" },
        { label: "Normal", value: inspection.normal, kind: "calculated" },
        {
          label: "Defect rate",
          value: `${inspection.defect_rate}%`,
          kind: "calculated",
        },
        {
          label: "Average coverage",
          value: `${inspection.average_coverage}%`,
          kind: "calculated",
        },
        {
          label: "Maximum coverage",
          value: `${inspection.max_coverage}%`,
          kind: "calculated",
        },
      ],
    },
  ];
  const primary = inspection.primary_defect;
  if (primary)
    blocks.push({
      type: "evidence",
      title: "Primary detector evidence",
      text: `${primary.type}: ${primary.count} samples (${primary.percent}%).`,
      kind: "calculated",
    });
  const samples = Array.isArray(inspection.samples) ? inspection.samples : [];
  const requestedTerms =
    String(query || "")
      .toLowerCase()
      .match(/crack|rust|scratch|hole|normal/g) || [];
  const chosen =
    samples.find((sample) =>
      requestedTerms.some(
        (term) =>
          String(sample.defect_type || "").toLowerCase() === term ||
          String(sample.filename || "")
            .toLowerCase()
            .includes(term),
      ),
    ) ||
    samples.find((sample) => primary && sample.defect_type === primary.type) ||
    samples.find((sample) => sample.has_defect) ||
    samples[0];
  if (includeImage && chosen) {
    const url = artifactUrl(chosen.annotated_image);
    if (url)
      blocks.push({
        type: "annotated-image",
        url,
        sample_id: chosen.sample_id,
        label: chosen.filename,
        defect_label: chosen.defect_type,
        coverage: chosen.coverage_percent,
        bounding_boxes: [
          chosen.overall_box,
          ...(chosen.components || []),
        ].filter(Boolean),
      });
  }
  return sanitizeRenderBlocks(blocks);
}

function isDefectRiskIntent(text) {
  return /(?:what|which).{0,24}(?:will|would|could|likely).{0,24}defect|(?:next|future|likely|predict\w*).{0,24}defect|defect.{0,24}(?:next|future|likely|predict\w*)/i.test(
    String(text || ""),
  );
}

function defectRiskBlocks(estimate) {
  if (
    !estimate ||
    estimate.status !== "estimated" ||
    !Array.isArray(estimate.ranked_risks)
  )
    return [];
  const likely = estimate.likely_defect || estimate.ranked_risks[0];
  return sanitizeRenderBlocks([
    {
      type: "metrics",
      items: [
        {
          label: "Likely defect",
          value: String(likely?.defect || "unknown"),
          kind: "calculated",
        },
        {
          label: "Evidence score",
          value: `${likely?.risk_score ?? 0}%`,
          kind: "calculated",
        },
        {
          label: "Samples used",
          value: String(estimate.sample_count ?? 0),
          kind: "measured",
        },
      ],
    },
    {
      type: "table",
      columns: [
        "Rank",
        "Defect",
        "Evidence score",
        "Mean classifier probability",
        "Observed share",
      ],
      rows: estimate.ranked_risks.map((row, index) => [
        index + 1,
        row.defect,
        `${row.risk_score}%`,
        `${row.mean_classifier_probability}%`,
        `${row.observed_share}%`,
      ]),
    },
    {
      type: "evidence",
      title: "Deterministic defect-risk method",
      text: `${estimate.method} ${estimate.limitations}`,
      kind: "calculated",
    },
  ]);
}

function partialAnswer(text) {
  const source = String(text || "");
  const match = /"answer"\s*:\s*"/.exec(source);
  if (!match) return "";
  let escaped = false;
  let value = "";
  for (
    let index = match.index + match[0].length;
    index < source.length;
    index += 1
  ) {
    const char = source[index];
    if (!escaped && char === '"') break;
    if (!escaped && char === "\\") {
      escaped = true;
      value += char;
      continue;
    }
    escaped = false;
    value += char;
  }
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

export async function chatAgent({
  message,
  image_b64 = "",
  filename = "",
  config = {},
  context = {},
  sessionId = "",
  onEvent = null,
}) {
  const text = String(message || "").trim();
  if (!text && !image_b64) throw new Error("Message or image is required.");
  const emit = async (event) => {
    if (typeof onEvent === "function") {
      try {
        await onEvent({ time: Date.now(), ...event });
      } catch {}
    }
  };
  const runtime = createModelRuntime(config, { agySessionId: sessionId });
  const executedTools = [];
  try {
    const history = getSessionHistory(sessionId);
    const batchId = String(context.inspection_batch_id || "")
      .trim()
      .toUpperCase();
    await emit({ type: "status", status: "Reading batch…" });
    const [persistedConversation, persistedAnalysis] = await Promise.all([
      loadBatchConversation(batchId),
      batchId
        ? backendFetch(
            `/api/batches/${encodeURIComponent(batchId)}/analysis`,
          ).catch(() => null)
        : null,
    ]);
    const riskIntent = isDefectRiskIntent(text);
    let defectRisk = null;
    if (batchId && riskIntent) {
      await emit({
        type: "tool_start",
        name: "estimate_defect_risk",
        arguments: { batch_id: batchId },
      });
      defectRisk = await executeTool("estimate_defect_risk", {
        batch_id: batchId,
      });
      executedTools.push({
        tool: "estimate_defect_risk",
        arguments: { batch_id: batchId },
        output: defectRisk,
      });
      await emit({
        type: "tool_complete",
        name: "estimate_defect_risk",
        result: compactEvidence(defectRisk),
      });
    }
    let attachedInspection = null;
    if (image_b64) {
      await emit({ type: "tool_start", name: "detect_defect_image" });
      attachedInspection = await inspectAttachedImage(image_b64, filename);
      executedTools.push({
        tool: "detect_defect_image",
        arguments: { filename: filename || "attached_surface.png" },
        output: attachedInspection,
      });
      await emit({ type: "tool_complete", name: "detect_defect_image" });
    }

    const promptContext = {
      model: context.model ?? context.facility_id ?? null,
      facility: context.facility ?? null,
      scenario_id: context.scenario ?? context.scenario_id ?? null,
      station: context.station ?? null,
      inspection_batch_id: context.inspection_batch_id ?? null,
      active_defect: context.defect ?? null,
      attached_image_inspection: compactEvidence(attachedInspection),
      defect_risk_estimate: compactEvidence(defectRisk),
    };
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      ...persistedConversation
        .slice(-8)
        .map((entry) =>
          entry.role === "assistant"
            ? new AIMessage(entry.text)
            : new HumanMessage(entry.text),
        ),
      ...(batchId ? [] : history.slice(-8)),
      new HumanMessage(
        `ACTIVE ASTRA CONTEXT:\n${JSON.stringify(promptContext, null, 2)}\n\nPERSISTED VERIFIED BATCH ANALYSIS:\n${JSON.stringify(compactEvidence(persistedAnalysis), null, 2)}\n\nOPERATOR REQUEST:\n${text || "Explain the attached image inspection result."}`,
      ),
    ];

    let envelope = { answer: "", tool_calls: [], render_blocks: [] };
    for (let round = 1; round <= 4; round += 1) {
      await emit({
        type: "status",
        status:
          round === 1
            ? "Checking defect evidence…"
            : "Verifying tool evidence…",
        round,
      });
      let lastPartial = "";
      const rawResult = await invokeRuntime(runtime, messages, (agyEvent) => {
        if (
          agyEvent?.event !== "step_update" ||
          agyEvent.step_update?.step_type !== "agent_response"
        )
          return;
        const candidate = partialAnswer(
          runtime.agySession?.pending?.text || "",
        );
        if (candidate && candidate !== lastPartial) {
          lastPartial = candidate;
          void emit({ type: "content", text: candidate, replace: true });
        }
      });
      envelope = parseJsonObject(rawResult.content);
      const calls = Array.isArray(envelope.tool_calls)
        ? envelope.tool_calls.slice(0, 8)
        : [];
      if (!calls.length) break;
      await emit({ type: "tool_calls", calls, round });
      const observations = await Promise.all(
        calls.map(async (call) => {
          const args = { ...(call.arguments || {}) };
          if (call.name === "detect_defect_image" && !args.image && image_b64) {
            args.image = image_b64;
            args.filename = args.filename || filename || "attached_surface.png";
          }
          await emit({
            type: "tool_start",
            name: call.name,
            arguments: compactEvidence(args),
          });
          const result = await executeTool(call.name, args);
          executedTools.push({
            tool: call.name,
            arguments: compactEvidence(args),
            output: result,
          });
          await emit({
            type: "tool_complete",
            name: call.name,
            result: compactEvidence(result),
          });
          return {
            tool: call.name,
            arguments: compactEvidence(args),
            result: compactEvidence(result),
          };
        }),
      );
      messages.push(
        new AIMessage(
          JSON.stringify({ answer: envelope.answer || "", tool_calls: calls }),
        ),
      );
      messages.push(
        new HumanMessage(
          `VERIFIED TOOL OBSERVATIONS:\n${JSON.stringify(observations, null, 2)}\n\nUpdate the answer using only supported evidence. Return the required JSON object.`,
        ),
      );
    }

    const likelyRisk =
      defectRisk?.status === "estimated" ? defectRisk.likely_defect : null;
    const deterministicLead =
      likelyRisk && riskIntent
        ? `**Stored-evidence estimate:** **${likelyRisk.defect}** ranks highest at **${likelyRisk.risk_score}%** [calculated] across ${defectRisk.sample_count} persisted samples. This is an evidence-weighted current-batch estimate, not causal proof or a trained time-series forecast.`
        : "";
    const answer = [deterministicLead, envelope.answer || "Analysis complete."]
      .filter(Boolean)
      .join("\n\n");
    const showImage =
      /show|where|image|annotat|box|mask|defect|crack|rust|scratch|hole/i.test(
        text,
      );
    const verifiedBlocks = dedupeRenderBlocks([
      ...sanitizeRenderBlocks(envelope.render_blocks),
      ...defectRiskBlocks(defectRisk),
      ...evidenceBlocks(persistedAnalysis, {
        includeImage: showImage,
        query: text,
      }),
    ]);
    if (sessionId && !batchId) {
      history.push(
        new HumanMessage(text || `[Attached image: ${filename || "surface"}]`),
      );
      history.push(new AIMessage(answer));
      if (history.length > 12) history.splice(0, history.length - 12);
    }
    await storeBatchMessage(
      batchId,
      "user",
      text || `[Attached image: ${filename || "surface"}]`,
    );
    await storeBatchMessage(batchId, "assistant", answer, verifiedBlocks);
    return {
      answer,
      render_blocks: verifiedBlocks,
      executed_tools: executedTools,
      model: runtime.config.model,
      session_id: sessionId,
    };
  } finally {
    await closeRuntime(runtime);
  }
}

export async function analyzeEvidence({
  model,
  scenarioId,
  inspectionBatchId = "",
  config = {},
  sessionId = "",
  onEvent = null,
}) {
  const emit = async (event) => {
    if (typeof onEvent === "function") {
      try {
        await onEvent({ time: Date.now(), ...event });
      } catch {}
    }
  };
  await emit({ type: "status", status: "Reading batch…" });
  const deterministic = await backendFetch("/api/analysis/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Number(model),
      scenario_id: scenarioId,
      inspection_batch_id: inspectionBatchId || null,
    }),
  });
  const runtime = createModelRuntime(config, { agySessionId: sessionId });
  try {
    await emit({ type: "status", status: "Loading production conditions…" });
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `This is an automatic batch analysis, not a chat request. The deterministic backend has already analyzed the uploaded images and the selected production scenario.\n\nVERIFIED EVIDENCE PACKAGE:\n${JSON.stringify(compactEvidence(deterministic), null, 2)}\n\nProduce a concise manufacturing analysis: dominant/secondary defects, production state, strongest bottleneck evidence, defect-process investigation targets, contradictory/missing evidence, and what the operator should verify next. Do not request tools unless the package is genuinely insufficient. Return the required JSON object.`,
      ),
    ];
    await emit({ type: "status", status: "Comparing baseline…" });
    await emit({ type: "status", status: "Checking defect evidence…" });
    await emit({ type: "status", status: "Generating recommendation…" });
    let lastPartial = "";
    const raw = await invokeRuntime(runtime, messages, (agyEvent) => {
      if (
        agyEvent?.event !== "step_update" ||
        agyEvent.step_update?.step_type !== "agent_response"
      )
        return;
      const candidate = partialAnswer(runtime.agySession?.pending?.text || "");
      if (candidate && candidate !== lastPartial) {
        lastPartial = candidate;
        void emit({ type: "content", text: candidate, replace: true });
      }
    });
    const envelope = parseJsonObject(raw.content);
    if (Array.isArray(envelope.tool_calls) && envelope.tool_calls.length) {
      // Automatic analysis already contains all deterministic evidence. Do not create extra sessions/loops here.
      envelope.tool_calls = [];
    }
    const history = getSessionHistory(sessionId);
    if (sessionId) {
      history.push(
        new HumanMessage(
          `Automatic analysis for ${scenarioId}${inspectionBatchId ? ` and ${inspectionBatchId}` : ""}.`,
        ),
      );
      history.push(
        new AIMessage(envelope.answer || "Automatic analysis complete."),
      );
      if (history.length > 12) history.splice(0, history.length - 12);
    }
    const renderBlocks = dedupeRenderBlocks([
      ...sanitizeRenderBlocks(envelope.render_blocks),
      ...evidenceBlocks(deterministic),
    ]);
    const result = {
      answer: envelope.answer || "Automatic analysis complete.",
      render_blocks: renderBlocks,
      deterministic,
      model: runtime.config.model,
      session_id: sessionId,
    };
    if (inspectionBatchId) {
      await Promise.all([
        backendJson(
          `/api/batches/${encodeURIComponent(inspectionBatchId)}/analysis`,
          {
            answer: result.answer,
            render_blocks: result.render_blocks,
            model: result.model,
          },
          "PUT",
        ),
        storeBatchMessage(
          inspectionBatchId,
          "assistant",
          result.answer,
          result.render_blocks,
        ),
      ]);
    }
    return result;
  } finally {
    await closeRuntime(runtime);
  }
}
