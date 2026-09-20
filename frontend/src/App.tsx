import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bell,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Command,
  Database,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  LoaderCircle,
  Maximize2,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Upload,
  X,
  Zap,
  TriangleAlert,
  Clock,
  Factory,
  FileText,
  Layers,
  Play,
  Pause,
  Paperclip,
  FileSpreadsheet,
  Eye,
} from "lucide-react";
import { ModelPicker } from "./ModelBuilder";
import { initialModel, type Facility } from "./models";
import {
  Badge,
  Count,
  FlowMap,
  Modal,
  SampleViewer,
  SectionTitle,
  Showcase,
} from "./components";
import {
  download,
  facilities,
  diagnosticsStore,
  type Sample,
  type Defect,
  type RequestLog,
} from "./data";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ToolExecutionCard, type ExecutedTool } from "./ToolExecutionCard";
import { ScenarioDropdown } from "./ScenarioDropdown";
import {
  astraApi,
  type BottleneckData,
  type InspectionBatch,
  type ProductionData,
  type ProductionStation,
  type ScenarioOption,
} from "./api";

const nav = [
  { id: "Overview", icon: LayoutGrid },
  { id: "Inspection", icon: ScanLine },
  { id: "Production", icon: GitBranch },
  { id: "Investigations", icon: FlaskConical },
  { id: "Simulation", icon: SlidersHorizontal },
];
const defectColors: Record<string, string> = {
  rust: "#b67551",
  crack: "#596d80",
  scratch: "#c6ab70",
  hole: "#9b99ae",
  unknown: "#b9beb8",
  normal: "#769877",
};
export default function App() {
  const [page, setPage] = useState("Overview");
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [navTop, setNavTop] = useState(0);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("astra-theme-v1") || "light",
  );
  const models: Facility[] = facilities;
  const [model, setModel] = useState(initialModel);
  const [scenario, setScenario] = useState("SC-2048");
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [production, setProduction] = useState<ProductionData | null>(null);
  const [bottleneckData, setBottleneckData] = useState<BottleneckData | null>(
    null,
  );
  const [inspectionBatch, setInspectionBatch] =
    useState<InspectionBatch | null>(null);
  const [batchHistory, setBatchHistory] = useState<any[]>([]);
  const [combinedAnalysis, setCombinedAnalysis] = useState<any | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [selectedStation, setStation] = useState(2);
  const [allSamples, setAllSamples] = useState<Sample[]>([]);
  const [filter, setFilter] = useState("All samples");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Sample | null>(null);
  const [modal, setModal] = useState("");
  const [toast, setToast] = useState("");
  const [assistant, setAssistant] = useState(false);
  const [chat, setChat] = useState<
    {
      role: string;
      text: string;
      image_b64?: string;
      executed_tools?: ExecutedTool[];
      render_blocks?: any[];
    }[]
  >([]);
  const [question, setQuestion] = useState("");
  const [chatAttachedImage, setChatAttachedImage] = useState<{
    b64: string;
    name: string;
  } | null>(null);
  const chatImageInput = useRef<HTMLInputElement>(null);
  const [realCsvFiles, setRealCsvFiles] = useState<any[]>([]);
  const [selectedCsv, setSelectedCsv] = useState<any | null>(null);
  const [csvPreviewRows, setCsvPreviewRows] = useState<any[] | null>(null);
  const [csvPreviewCols, setCsvPreviewCols] = useState<string[]>([]);
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
  const [inspectImageModal, setInspectImageModal] = useState<string | null>(
    null,
  );
  const [detecting, setDetecting] = useState(false);
  const [detectProgress, setDetectProgress] = useState<{
    current: number;
    total: number;
    filename: string;
  } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [availableAiModels, setAvailableAiModels] = useState<
    { id: string; label: string }[]
  >([]);
  const [aiOnline, setAiOnline] = useState(false);
  const [defect, setDefect] = useState("Rust");
  const [audit, setAudit] = useState<string[]>([]);
  const [capacity, setCapacity] = useState(15);
  const [demand, setDemand] = useState(0);
  const [simulation, setSimulation] = useState<any | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [unitCost, setUnitCost] = useState("");
  const [economicImpact, setEconomicImpact] = useState<any | null>(null);
  const [logFilter, setLogFilter] = useState("All requests");
  const [logQuery, setLogQuery] = useState("");
  const [logDetail, setLogDetail] = useState<RequestLog | null>(null);
  const [health, setHealth] = useState("Not checked");
  const [healthBusy, setHealthBusy] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const productionUpload = useRef<HTMLInputElement>(null);
  const logs = useSyncExternalStore(
    diagnosticsStore.subscribe,
    diagnosticsStore.getSnapshot,
  );
  const agentSessionId = useRef<string>(
    sessionStorage.getItem("astra-agent-session") || crypto.randomUUID(),
  );
  useEffect(() => {
    sessionStorage.setItem("astra-agent-session", agentSessionId.current);
  }, []);
  const baseFacility = models.find((f) => f.id === model) || models[0];
  const realStations: ProductionStation[] = production?.stations?.length
    ? production.stations
    : baseFacility.stations.map((station) => ({ station, utilization: null }));
  const util = realStations.map((s) =>
    typeof s.utilization === "number"
      ? Number(s.utilization.toFixed(2))
      : Number.NaN,
  );
  const rateValue =
    production?.metrics?.throughput ?? production?.metrics?.output ?? null;
  const wipValue =
    production?.metrics?.wip ?? production?.metrics?.queue ?? null;
  const rate = Number(rateValue ?? 0);
  const wip = Number(wipValue ?? 0);
  const yieldValue = inspectionBatch?.pass_rate ?? null;
  const yieldRate = yieldValue ?? 0;
  const inspected = inspectionBatch?.total_inspected ?? 0;
  const defective = inspectionBatch?.defective ?? 0;
  const unsupportedCount = inspectionBatch?.counts?.unsupported ?? 0;
  const needsReview = defective + unsupportedCount;
  const facility: Facility = {
    ...baseFacility,
    name: production?.model_name || baseFacility.name,
    stations: realStations.map((s) => s.station),
    rate,
    wip: Math.round(wip),
    yield: yieldRate,
    util,
  };
  const station = Math.min(
    selectedStation,
    Math.max(0, facility.stations.length - 1),
  );
  const rankedConstraint = bottleneckData?.bottlenecks?.[0]?.station;
  const finiteUtil = util.filter(Number.isFinite);
  const fallbackConstraint = finiteUtil.length
    ? util.indexOf(Math.max(...finiteUtil))
    : 0;
  const constraint = Math.max(
    0,
    rankedConstraint
      ? facility.stations.findIndex((s) => s === rankedConstraint)
      : fallbackConstraint,
  );
  const filtered = allSamples.filter(
    (s) =>
      (filter === "All samples" || s.defect === filter) &&
      (s.id + " " + s.defect + " " + (s.name || ""))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const defects = Object.entries(inspectionBatch?.counts || {})
    .filter(([name]) => name !== "normal" && name !== "unsupported")
    .map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      count: Number(count),
      color: defectColors[name] || defectColors.unknown,
    }));
  const selectedStationData = realStations[station] || null;
  const constraintInfo =
    bottleneckData?.bottlenecks?.find(
      (b) => b.station === facility.stations[station],
    ) ||
    bottleneckData?.bottlenecks?.[0] ||
    null;
  const investigationDefects = Object.keys(inspectionBatch?.counts || {})
    .filter((name) => name !== "normal")
    .map((name) => name.charAt(0).toUpperCase() + name.slice(1));
  const currentInvestigation =
    combinedAnalysis?.deterministic?.investigations?.find(
      (x: any) =>
        String(x.defect?.type || "").toLowerCase() === defect.toLowerCase(),
    )?.evidence ||
    combinedAnalysis?.investigations?.find(
      (x: any) =>
        String(x.defect?.type || "").toLowerCase() === defect.toLowerCase(),
    )?.evidence ||
    null;
  const stationBaselineEntry = Object.entries(
    production?.baseline?.metrics || {},
  ).find(
    ([key]) =>
      key
        .toLowerCase()
        .includes(
          (facility.stations[station] || "").toLowerCase().split(" ")[0],
        ) && /util/i.test(key),
  ) as [string, any] | undefined;
  const hyp = {
    title: currentInvestigation
      ? `${defect} · investigation targets`
      : "No analyzed evidence yet",
    mechanism:
      currentInvestigation?.domain_relevance?.join(" · ") ||
      "Upload inspection images and select a production scenario to build evidence.",
    support: currentInvestigation?.production_evidence?.length
      ? currentInvestigation.production_evidence
          .map((e: any) => `${e.metric}: ${e.value}`)
          .join(" · ")
      : "No matching production evidence is available for this defect and scenario.",
    contradiction: currentInvestigation?.contradictory_evidence?.length
      ? currentInvestigation.contradictory_evidence
          .map((e: any) => String(e.metric || e))
          .join(" · ")
      : "No contradictory evidence is recorded in the current deterministic analysis.",
    missing:
      currentInvestigation?.missing_evidence?.join(" · ") ||
      "Inspection batch and production scenario evidence are required.",
    action: currentInvestigation?.missing_evidence?.length
      ? `Verify: ${currentInvestigation.missing_evidence.slice(0, 3).join(", ")}.`
      : "Run the automatic evidence analysis first.",
  };
  const latestModel = useRef("");
  latestModel.current = JSON.stringify([
    model,
    scenario,
    rate,
    wip,
    capacity,
    demand,
  ]);
  useEffect(() => {
    fetch("/api/agent/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.models?.length) {
          setAvailableAiModels(d.models);
          if (d.current) setAiModel(d.current);
          setAiOnline(Boolean(d.installed && d.authenticated));
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const cost = Number(unitCost);
    if (unitCost === "" || !Number.isFinite(cost) || cost < 0) {
      setEconomicImpact(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      astraApi
        .economics({
          defective_units: defective,
          scrap_units: defective,
          rework_units: 0,
          lost_output_units: 0,
          scrap_cost_per_unit: cost,
        })
        .then((result) => {
          if (!cancelled) setEconomicImpact(result);
        })
        .catch(() => {
          if (!cancelled) setEconomicImpact(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [unitCost, defective]);
  useEffect(() => {
    fetch("/api/csv/files")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.files?.length) {
          setRealCsvFiles(d.files);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    astraApi
      .batchHistory()
      .then((data) => setBatchHistory(data.batches || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const update = () => {
      const active = sidebarRef.current?.querySelector(".nav-item.active") as
        | HTMLElement
        | undefined;
      if (active && sidebarRef.current)
        setNavTop(
          active.getBoundingClientRect().top -
            sidebarRef.current.getBoundingClientRect().top +
            sidebarRef.current.scrollTop,
        );
    };
    update();
    const observer = new ResizeObserver(update);
    if (sidebarRef.current) observer.observe(sidebarRef.current);
    return () => observer.disconnect();
  }, [page, collapsed]);
  useEffect(() => {
    try {
      localStorage.setItem("astra-active-model-v1", String(model));
    } catch {}
  }, [model]);
  useEffect(() => {
    const nodes = document.querySelectorAll(
      ".page-content > .panel,.overview-main,.overview-lower,.showcase,.metrics .metric",
    );
    const observer = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("revealed");
            observer.unobserve(e.target);
          }
        }),
      { threshold: 0.07 },
    );
    nodes.forEach((n, i) => {
      n.classList.add("scroll-reveal");
      (n as HTMLElement).style.setProperty(
        "--reveal-delay",
        `${(i % 4) * 65}ms`,
      );
      observer.observe(n);
    });
    return () => observer.disconnect();
  }, [page]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("astra-theme-v1", theme);
  }, [theme]);
  useEffect(() => {
    let cancelled = false;
    if (model < 1 || model > 3) {
      setScenarios([]);
      setProduction(null);
      setBottleneckData(null);
      return;
    }
    astraApi
      .scenarios(model)
      .then((data) => {
        if (cancelled) return;
        setScenarios(data.scenarios);
        if (!data.scenarios.some((item) => item.id === scenario)) {
          const preferred =
            data.scenarios.find((item) => item.id === "SC-2048") ||
            data.scenarios[0];
          if (preferred) setScenario(preferred.id);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setScenarios([]);
          setToast(`Scenario data unavailable: ${err.message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [model]);
  useEffect(() => {
    let cancelled = false;
    if (model < 1 || model > 3 || !scenario) return;
    Promise.all([
      astraApi.production(model, scenario),
      astraApi.bottlenecks(model, scenario),
    ])
      .then(([prod, bn]) => {
        if (cancelled) return;
        setProduction(prod);
        setBottleneckData(bn);
        setSimulation(null);
        const nextDemand = Number(prod.metrics?.demand ?? 0);
        setDemand(Number.isFinite(nextDemand) ? nextDemand : 0);
        const first = bn.bottlenecks?.[0]?.station;
        const nextStation = first
          ? prod.stations.findIndex((s) => s.station === first)
          : 0;
        setStation(Math.max(0, nextStation));
      })
      .catch((err) => {
        if (!cancelled) {
          setProduction(null);
          setBottleneckData(null);
          setToast(`Production data unavailable: ${err.message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [model, scenario]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setModal("Search");
      }
      if (e.key === "Escape") {
        setAssistant(false);
        setInspectImageModal(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function go(p: string) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function samplesFromBatch(batch: InspectionBatch): Sample[] {
    return (batch.results || []).map((res: any) => {
      const raw = String(res.defect_type || "unknown");
      const defectName = (raw.charAt(0).toUpperCase() +
        raw.slice(1).toLowerCase()) as Defect;
      const confidence =
        typeof res.classifier?.confidence === "number"
          ? `${Number(res.classifier.confidence).toFixed(1)}% classifier`
          : "Classifier confidence unavailable";
      return {
        id: res.sample_id,
        name: res.filename,
        defect: defectName,
        coverage: Number(res.coverage_percent || 0),
        agreement: confidence,
        image: res.annotated_image || res.original_image,
        originalImage: res.original_image,
        annotatedImage: res.annotated_image,
        maskImage: res.mask_image,
        source: "upload" as const,
        bbox: res.overall_box,
        image_size: { width: res.image_width, height: res.image_height },
        components: res.components || [],
        error:
          res.error ||
          (res.defect_type === "unsupported"
            ? "Model wasn't trained on this kind of image"
            : undefined),
      };
    });
  }
  async function refreshBatchHistory() {
    try {
      const data = await astraApi.batchHistory();
      setBatchHistory(data.batches || []);
    } catch {}
  }
  async function restoreBatch(batchId: string) {
    try {
      const batch = await astraApi.batch(batchId);
      setInspectionBatch(batch);
      setAllSamples(samplesFromBatch(batch));
      if (batch.model) setModel(Number(batch.model));
      if (batch.scenario_id) setScenario(batch.scenario_id);
      agentSessionId.current =
        batch.agent_session_id || `astra-${batch.batch_id.toLowerCase()}`;
      sessionStorage.setItem("astra-agent-session", agentSessionId.current);
      setCombinedAnalysis(
        batch.automatic_analysis
          ? {
              ...batch.automatic_analysis,
              deterministic: batch.deterministic_analysis,
            }
          : batch.deterministic_analysis
            ? { deterministic: batch.deterministic_analysis, answer: "" }
            : null,
      );
      setChat(
        (batch.conversation || []).map((entry: any) => ({
          role: entry.role,
          text: entry.text || entry.content || "",
          render_blocks: entry.render_blocks || [],
        })),
      );
      const primary = batch.primary_defect?.type;
      if (primary)
        setDefect(primary.charAt(0).toUpperCase() + primary.slice(1));
      setFilter("All samples");
      setPage("Inspection");
      setToast(
        `${batch.batch_id} restored with its production context, detector artifacts, analysis, and conversation.`,
      );
    } catch (err: any) {
      setToast(`Batch restore failed: ${err.message || err}`);
    }
  }
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const fileArr = Array.from(files).filter(
      (f) =>
        ["image/png", "image/jpeg", "image/webp"].includes(f.type) &&
        f.size <= 10 * 1024 * 1024,
    );
    if (!fileArr.length) {
      setToast("Please upload PNG, JPEG, or WebP images under 10 MB.");
      return;
    }
    setDetecting(true);
    setPage("Inspection");
    setDetectProgress({
      current: 0,
      total: fileArr.length,
      filename: fileArr[0].name,
    });
    try {
      const batch = await astraApi.batchInspection(fileArr, {
        model,
        scenario_id: scenario,
      });
      setDetectProgress({
        current: fileArr.length,
        total: fileArr.length,
        filename: fileArr[fileArr.length - 1].name,
      });
      setInspectionBatch(batch);
      setAllSamples(samplesFromBatch(batch));
      agentSessionId.current =
        batch.agent_session_id || `astra-${batch.batch_id.toLowerCase()}`;
      sessionStorage.setItem("astra-agent-session", agentSessionId.current);
      setCombinedAnalysis(
        batch.deterministic_analysis
          ? { deterministic: batch.deterministic_analysis, answer: "" }
          : null,
      );
      const primary = batch.primary_defect?.type;
      if (primary)
        setDefect(primary.charAt(0).toUpperCase() + primary.slice(1));
      setAudit((a) => [
        `${new Date().toLocaleTimeString()} · Batch ${batch.batch_id}: ${batch.total_inspected} images analyzed by the trained detector`,
        ...a,
      ]);
      setFilter("All samples");
      setQuery("");
      setToast(
        `${batch.total_inspected} image(s) analyzed · ${batch.defective} defective · ${batch.normal} normal${batch.unsupported ? ` · ${batch.unsupported} unsupported` : ""}. Automatic analysis started.`,
      );
      await refreshBatchHistory();
      void runAutomaticAnalysis(batch);
    } catch (err: any) {
      setToast(`Inspection failed: ${err.message || err}`);
    } finally {
      setDetecting(false);
      setDetectProgress(null);
      if (upload.current) upload.current.value = "";
    }
  }
  function handleChatImageSelect(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setToast("Please select a PNG, JPEG, or WebP image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result as string;
      setChatAttachedImage({ b64, name: file.name });
      setToast(`Attached ${file.name} to chat.`);
    };
    reader.readAsDataURL(file);
    if (chatImageInput.current) chatImageInput.current.value = "";
  }
  async function previewCsv(file: any) {
    setSelectedCsv(file);
    setCsvPreviewLoading(true);
    setCsvPreviewRows(null);
    try {
      const res = await fetch(
        `/api/csv/data?file=${encodeURIComponent(file.name)}&action=head&num_rows=10`,
      );
      const data = await res.json();
      setCsvPreviewCols(data.columns || []);
      setCsvPreviewRows(data.rows || []);
    } catch (e: any) {
      setToast(`Failed to load ${file.name}: ${e.message}`);
    } finally {
      setCsvPreviewLoading(false);
    }
  }
  async function handleProductionCsv(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setToast("Production datasets must be CSV files.");
      return;
    }
    try {
      const meta = await astraApi.uploadProduction(model, file);
      const catalog = await fetch("/api/csv/files").then((r) => r.json());
      setRealCsvFiles(catalog.files || []);
      const scenarioData = await astraApi.scenarios(model);
      setScenarios(scenarioData.scenarios);
      if (scenarioData.scenarios[0]) setScenario(scenarioData.scenarios[0].id);
      setSelectedCsv({
        name: meta.source_path || file.name,
        model,
        active: true,
      });
      setToast(`${file.name} validated and loaded for Model ${model}.`);
    } catch (err: any) {
      setToast(`CSV import failed: ${err.message || err}`);
    } finally {
      if (productionUpload.current) productionUpload.current.value = "";
    }
  }
  async function runSimulation() {
    setSimBusy(true);
    setSimulation(null);
    try {
      const raw = production?.raw || {};
      let changes: Record<string, number> = {};
      if (
        Object.prototype.hasOwnProperty.call(raw, "Demand") &&
        Number.isFinite(demand)
      )
        changes.Demand = demand;
      const stationName = facility.stations[constraint] || "";
      const capacityCandidates = Object.keys(raw).filter(
        (k) =>
          /capacity/i.test(k) &&
          (!stationName ||
            k.toLowerCase().includes(stationName.toLowerCase().split(" ")[0])),
      );
      if (capacity > 0 && capacityCandidates.length) {
        const key = capacityCandidates[0];
        const base = Number((raw as any)[key]);
        if (Number.isFinite(base)) changes[key] = base * (1 + capacity / 100);
      }
      if (!Object.keys(changes).length) {
        setToast(
          "This dataset does not expose a supported demand/capacity input for nearest-scenario simulation.",
        );
        return;
      }
      const result = await astraApi.simulation({
        model,
        scenario_id: scenario,
        changes,
      });
      setSimulation(result);
      setToast(
        `Matched ${result.matched_scenario || result.scenario_id || "nearest dataset scenario"} using real production data.`,
      );
    } catch (err: any) {
      setToast(`Simulation unavailable: ${err.message || err}`);
    } finally {
      setSimBusy(false);
    }
  }
  async function runAutomaticAnalysis(batchOverride?: InspectionBatch) {
    const activeBatch = batchOverride || inspectionBatch;
    if (!activeBatch) {
      setToast("Upload and analyze an image batch first.");
      return;
    }
    const activeModel = Number(activeBatch.model || model);
    const activeScenario = String(activeBatch.scenario_id || scenario);
    setAnalysisBusy(true);
    setAnalysisStatus("Reading batch…");
    try {
      const context =
        activeBatch.deterministic_analysis ||
        (await astraApi.analysisContext({
          model: activeModel,
          scenario_id: activeScenario,
          inspection_batch_id: activeBatch.batch_id,
        }));
      setCombinedAnalysis({ deterministic: context, answer: "" });
      try {
        const result = await astraApi.streamAnalysis(
          {
            model: activeModel,
            scenario_id: activeScenario,
            inspection_batch_id: activeBatch.batch_id,
            ai_model: aiModel,
            session_id: activeBatch.agent_session_id || agentSessionId.current,
          },
          (event: any) => {
            if (event.type === "status")
              setAnalysisStatus(event.status || "Analyzing evidence…");
            if (event.type === "content")
              setCombinedAnalysis((current: any) => ({
                ...current,
                deterministic: context,
                answer: event.text || "",
              }));
          },
        );
        setCombinedAnalysis(result);
        if (result.answer)
          setChat((c) => [
            ...c,
            {
              role: "assistant",
              text: result.answer,
              render_blocks: result.render_blocks || [],
            },
          ]);
        setAiOnline(true);
        await refreshBatchHistory();
        setToast(
          "Automatic inspection + production analysis is ready. Ask Astra for follow-up questions.",
        );
      } catch (aiErr: any) {
        setToast(
          `Deterministic analysis is ready; AGY summary unavailable: ${aiErr.message || aiErr}`,
        );
      }
    } catch (err: any) {
      setToast(`Automatic analysis failed: ${err.message || err}`);
    } finally {
      setAnalysisBusy(false);
      setAnalysisStatus("");
    }
  }
  async function checkHealth() {
    setHealthBusy(true);
    try {
      const started = performance.now();
      const res = await fetch("/api/health");
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || `Health check failed (${res.status})`);
      await diagnosticsStore.request("/api/health", null, {
        ...data,
        measured_ms: Math.round(performance.now() - started),
      });
      const ready = data.inspection === "ready" && data.production === "ready";
      setAiOnline(data.agentic_reasoning === "ready");
      setHealth(
        ready
          ? data.agentic_reasoning === "ready"
            ? "Healthy · AGY ready"
            : "Healthy · deterministic backend ready"
          : "Degraded",
      );
      setToast(
        `Health check complete: inspection ${data.inspection}, production ${data.production}, AGY ${data.agentic_reasoning}.`,
      );
    } catch (e) {
      setHealth("Degraded · check server");
      setToast((e as Error).message);
    } finally {
      setHealthBusy(false);
    }
  }
  async function ask(
    text: string,
    attachedImg?: { b64: string; name: string } | null,
  ) {
    const imgToSubmit =
      attachedImg !== undefined ? attachedImg : chatAttachedImage;
    if ((!text.trim() && !imgToSubmit) || thinking) return;
    const userMsg = text.trim();
    setQuestion("");
    setChatAttachedImage(null);
    setChat((c) => [
      ...c,
      {
        role: "user",
        text:
          userMsg ||
          (imgToSubmit
            ? `[Attached image: ${imgToSubmit.name}] Please inspect and detect defects.`
            : ""),
        image_b64: imgToSubmit?.b64,
      },
      { role: "assistant", text: "" },
    ]);
    setThinking(true);
    setAgentStatus("Reading batch…");
    try {
      const data = await astraApi.streamChat(
        {
          message: userMsg,
          image_b64: imgToSubmit?.b64,
          filename: imgToSubmit?.name,
          ai_model: aiModel,
          facility: facility.name,
          facility_id: model,
          model,
          scenario,
          defect,
          station: facility.stations[station],
          inspection_batch_id: inspectionBatch?.batch_id || null,
          session_id: agentSessionId.current,
        },
        (event: any) => {
          if (event.type === "status")
            setAgentStatus(event.status || "Analyzing evidence…");
          if (event.type === "content")
            setChat((c) =>
              c.map((m, i) =>
                i === c.length - 1 ? { ...m, text: event.text || "" } : m,
              ),
            );
          if (event.type === "tool_start")
            setChat((c) =>
              c.map((m, i) =>
                i === c.length - 1
                  ? {
                      ...m,
                      executed_tools: [
                        ...(m.executed_tools || []),
                        {
                          tool: event.name,
                          arguments: event.arguments || {},
                          status: "running",
                        },
                      ],
                    }
                  : m,
              ),
            );
          if (event.type === "tool_complete")
            setChat((c) =>
              c.map((m, i) => {
                if (i !== c.length - 1) return m;
                const tools = [...(m.executed_tools || [])];
                for (let index = tools.length - 1; index >= 0; index -= 1) {
                  if (
                    tools[index].tool === event.name &&
                    tools[index].status === "running"
                  ) {
                    tools[index] = {
                      ...tools[index],
                      output: event.result || {},
                      status: "completed",
                    };
                    break;
                  }
                }
                return { ...m, executed_tools: tools };
              }),
            );
        },
      );
      setChat((c) =>
        c.map((m, i) =>
          i === c.length - 1
            ? {
                role: "assistant",
                text: data.answer || "No response generated.",
                executed_tools: data.executed_tools || [],
                render_blocks: data.render_blocks || [],
              }
            : m,
        ),
      );
      setAiOnline(true);
    } catch (err: any) {
      setChat((c) =>
        c.map((m, i) =>
          i === c.length - 1
            ? {
                role: "assistant",
                text: `Agent request failed: ${err.message || err}`,
              }
            : m,
        ),
      );
    } finally {
      setThinking(false);
      setAgentStatus("");
    }
  }
  function exportReport() {
    download(
      `astra-${scenario}-report.json`,
      JSON.stringify(
        {
          title: "ASTRA Investigation report",
          source: production?.source || null,
          facility: facility.name,
          scenario,
          inspection: inspectionBatch,
          production,
          bottlenecks: bottleneckData,
          automatic_analysis: combinedAnalysis
            ? {
                answer: combinedAnalysis.answer,
                deterministic: combinedAnalysis.deterministic,
              }
            : null,
          simulation,
          economic:
            unitCost !== ""
              ? {
                  source: "user_assumption",
                  scrap_cost_per_unit: Number(unitCost),
                  defective_units: defective,
                }
              : null,
          audit,
        },
        null,
        2,
      ),
    );
    setToast("Investigation report exported");
  }

  const filteredLogs = logs.filter(
    (l) =>
      (logFilter === "All requests" ||
        (logFilter === "Errors"
          ? Number(l.status) >= 400
          : l.status === "pending")) &&
      (l.path + " " + l.method).toLowerCase().includes(logQuery.toLowerCase()),
  );
  return (
    <div className={`app-shell ${collapsed ? "nav-collapsed" : ""}`}>
      <aside className="sidebar" ref={sidebarRef}>
        <div
          className="nav-glider"
          style={{
            transform: `translateY(${navTop}px)`,
            opacity: navTop > 0 ? 1 : 0,
          }}
        />
        <button
          className="sidebar-collapse"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
        <button
          className="brand"
          onClick={() => go("Overview")}
          aria-label="ASTRA home"
        >
          <span className="brand-mark">
            A<span />
          </span>
          <span>
            astra<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <button
          className="workspace"
          aria-label="Choose production model"
          onClick={() => setModal("Facility")}
        >
          <span className="workspace-icon">
            <Factory size={19} />
          </span>
          <span>
            <strong>{facility.name}</strong>
            <small>
              Model {facility.id} · {facility.stations.length} stages{" "}
              <i className="tiny green" />
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <button
          className="sidebar-new-model"
          title="Import production CSV"
          onClick={() => go("Batches")}
        >
          <Upload size={15} />
          <span>Production datasets</span>
          <kbd>↗</kbd>
        </button>
        <div className="nav-label">INTELLIGENCE</div>
        <nav>
          {nav.map(({ id, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              title={id}
              aria-label={id}
              onClick={() => go(id)}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{id}</span>
              {id === "Investigations" && <small>3</small>}
              {page === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="nav-label second">WORKSPACE TOOLS</div>
        <button
          className={`nav-item ${page === "Batches" ? "active" : ""}`}
          title="Batches and models"
          aria-label="Batches and models"
          onClick={() => go("Batches")}
        >
          <Database size={18} />
          <span>Batches & models</span>
        </button>
        <button
          className={`nav-item ${page === "System" ? "active" : ""}`}
          title="System health"
          aria-label="System health"
          onClick={() => go("System")}
        >
          <Activity size={18} />
          <span>System health</span>
          <i className="tiny green" />
        </button>
        <button
          className={`nav-item ${page === "Developer" ? "active" : ""}`}
          title="Developer logs"
          aria-label="Developer logs"
          onClick={() => go("Developer")}
        >
          <Code2 size={18} />
          <span>Developer logs</span>
          {logs.length > 0 && <small>{logs.length}</small>}
        </button>
        <div className="sidebar-bottom">
          <div className="assistant-teaser">
            <div className="teaser-icon">
              <Sparkles size={18} />
            </div>
            <strong>A second perspective.</strong>
            <p>Follow the evidence with your investigation assistant.</p>
            <button onClick={() => setAssistant(true)}>
              Ask Astra <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="sidebar-utility">
            <button onClick={() => setModal("Guide")}>
              <CircleHelp size={17} />
              Quick guide
            </button>
            <button
              className="theme-toggle"
              aria-label={
                theme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
          <div className="profile">
            <span className="avatar">AK</span>
            <div>
              <strong>Alex Kim</strong>
              <small>Manufacturing engineer</small>
            </div>
            <Badge>Local</Badge>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <span className="live-indicator">
              <i />{" "}
              {production
                ? `Dataset active · ${production.source?.file || scenario}`
                : "Waiting for production data"}
            </span>
            <button
              className="search-shortcut"
              onClick={() => setModal("Search")}
            >
              <Search size={15} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-btn notification"
              aria-label="Notifications"
              onClick={() => setModal("Notifications")}
            >
              <Bell size={18} />
              <i />
            </button>
            <span className="avatar small">AK</span>
          </div>
        </header>
        <main>
          <div className="context-bar">
            <button onClick={() => setModal("Facility")}>
              <Factory size={15} />
              <strong>{facility.name}</strong>
              <Badge>M{model}</Badge>
              <ChevronDown size={13} />
            </button>
            <span className="context-divider" />
            <label>
              <span>Scenario</span>
              <ScenarioDropdown
                value={scenario}
                options={scenarios}
                onChange={setScenario}
                disabled={!scenarios.length}
              />
            </label>
            <div className="context-end">
              <span className="dot" />
              <span>
                {production?.source?.file
                  ? `${production.source.file} · row ${production.source.row}`
                  : "No production dataset loaded"}
              </span>
              <button
                className="icon-btn"
                aria-label="Dataset provenance"
                onClick={() => setModal("Provenance")}
              >
                <CircleHelp size={14} />
              </button>
            </div>
          </div>
          <div className="page-content" key={page}>
            {page === "Overview" && (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">THE BIG PICTURE</span>
                    <h1>
                      Every part. A clearer picture<span>.</span>
                    </h1>
                    <p>
                      Your production floor, connected to measured inspection
                      and production evidence.
                    </p>
                  </div>
                  <div className="heading-actions">
                    <button className="btn" onClick={exportReport}>
                      <ArrowDownToLine size={15} />
                      Export report
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => upload.current?.click()}
                    >
                      <Plus size={16} />
                      New inspection
                    </button>
                  </div>
                </div>
                <div className="insight-ribbon">
                  <span className="ribbon-icon">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <strong>
                      {constraintInfo
                        ? `${constraintInfo.station} has the strongest current bottleneck evidence.`
                        : "No bottleneck claim without evidence."}
                    </strong>
                    <span>
                      {constraintInfo
                        ? `Backend score ${constraintInfo.score} · ${constraintInfo.severity}. Review the measured signals before acting.`
                        : "Load a production scenario with station-level signals."}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setStation(constraint);
                      go("Investigations");
                    }}
                  >
                    View investigation <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="metrics">
                  <Metric
                    title="Inspected parts"
                    value={inspectionBatch ? inspected : null}
                    trend={inspectionBatch ? "Measured" : "Unavailable"}
                    sub={inspectionBatch?.batch_id || "Upload an image batch"}
                  />
                  <Metric
                    title="First-pass yield"
                    value={yieldValue}
                    suffix="%"
                    digits={1}
                    trend={
                      inspectionBatch
                        ? "Calculated from detector results"
                        : "Unavailable"
                    }
                    sub={
                      inspectionBatch
                        ? `${inspectionBatch.normal} normal · ${inspectionBatch.defective} defective`
                        : "No inspection batch"
                    }
                  />
                  <Metric
                    title={
                      production?.metrics?.throughput != null
                        ? "Throughput"
                        : "Output"
                    }
                    value={rateValue}
                    suffix={
                      production?.metrics?.throughput != null ? "/hr" : " parts"
                    }
                    trend={production ? "Measured" : "Unavailable"}
                    sub={production?.source?.file || "No production source"}
                  />
                  <Metric
                    title={
                      production?.metrics?.wip != null
                        ? "Work in progress"
                        : "Queue"
                    }
                    value={wipValue}
                    trend={wipValue != null ? "Measured" : "Unavailable"}
                    sub={
                      wipValue != null
                        ? "Current dataset scenario"
                        : "Metric absent in selected dataset"
                    }
                    warning={wipValue != null}
                  />
                </div>
                <div className="overview-main">
                  <section className="panel floor-panel">
                    <SectionTitle
                      eyebrow="PRODUCTION INTELLIGENCE"
                      title="The floor, in motion"
                    >
                      <button
                        className="icon-btn"
                        aria-label="Explore production"
                        onClick={() => go("Production")}
                      >
                        <Maximize2 size={16} />
                      </button>
                    </SectionTitle>
                    <FlowMap
                      facility={facility}
                      selected={station}
                      onSelect={setStation}
                    />
                    <div className="station-insight">
                      <div className="station-insight-icon">
                        <Layers size={18} />
                      </div>
                      <div>
                        <strong>
                          {facility.stations[station] || "Station"}
                        </strong>
                        <span>
                          {typeof selectedStationData?.utilization === "number"
                            ? `${selectedStationData.utilization.toFixed(1)}% measured utilization for ${scenario}.`
                            : "Utilization is not available for this station in the selected dataset."}
                        </span>
                      </div>
                      <Badge
                        tone={
                          constraintInfo?.station === facility.stations[station]
                            ? "amber"
                            : "green"
                        }
                      >
                        {constraintInfo?.station === facility.stations[station]
                          ? "Investigate"
                          : "Measured state"}
                      </Badge>
                      <button
                        className="icon-btn"
                        aria-label="Open station evidence"
                        onClick={() => go("Production")}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                  </section>
                  <section className="panel quality-panel">
                    <SectionTitle
                      eyebrow="BATCH QUALITY"
                      title="Behind the surface"
                    >
                      <button
                        className="icon-btn"
                        aria-label="Open quality inspection"
                        onClick={() => go("Inspection")}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </SectionTitle>
                    {inspectionBatch ? (
                      <>
                        <div className="quality-total">
                          <strong>
                            {needsReview}
                            <small>/{inspected}</small>
                          </strong>
                          <span>
                            parts need a closer look{" "}
                            <Badge tone="amber">
                              {inspectionBatch.defect_rate.toFixed(1)}% evaluated defects
                            </Badge>
                          </span>
                        </div>
                        <div className="distribution-bar">
                          {defects.map((d) => (
                            <button
                              key={d.name}
                              title={d.name}
                              aria-label={`Inspect ${d.name} samples`}
                              style={{
                                width: `${(d.count / Math.max(1, defective)) * 100}%`,
                                background: d.color,
                              }}
                              onClick={() => {
                                setFilter(d.name);
                                go("Inspection");
                              }}
                            />
                          ))}
                        </div>
                        <div className="defect-list">
                          {defects.slice(0, 4).map((d) => (
                            <button
                              key={d.name}
                              onClick={() => {
                                setDefect(d.name);
                                go("Investigations");
                              }}
                            >
                              <i style={{ background: d.color }} />
                              <span>{d.name}</span>
                              <div className="mini-bar">
                                <i
                                  style={{
                                    width: `${(d.count / Math.max(1, ...defects.map((x) => x.count))) * 100}%`,
                                    background: d.color,
                                  }}
                                />
                              </div>
                              <strong>{d.count}</strong>
                              <ChevronRight size={13} />
                            </button>
                          ))}
                        </div>
                        {unsupportedCount > 0 && (
                          <button
                            className="quality-foot"
                            onClick={() => {
                              setFilter("Unsupported");
                              go("Inspection");
                            }}
                          >
                            <TriangleAlert size={15} />
                            {unsupportedCount} unsupported · grayscale required
                            <ArrowRight size={14} />
                          </button>
                        )}
                        <button
                          className="quality-foot"
                          onClick={() => {
                            setFilter("Unknown");
                            go("Inspection");
                          }}
                        >
                          <ShieldCheck size={15} />
                          {inspectionBatch.counts?.unknown || 0} uncertain /
                          unknown <ArrowRight size={14} />
                        </button>
                      </>
                    ) : (
                      <div className="empty">
                        <ScanLine size={28} />
                        <h3>No image batch analyzed.</h3>
                        <p>
                          Upload manufacturing surface images to populate
                          quality metrics with the trained detector.
                        </p>
                        <button
                          className="btn"
                          onClick={() => upload.current?.click()}
                        >
                          Upload images
                        </button>
                      </div>
                    )}
                  </section>
                </div>
                <div className="overview-lower">
                  <section className="panel">
                    <SectionTitle title="Scenario evidence">
                      <Badge>
                        {production?.baseline?.available
                          ? "Empirical baseline"
                          : "Unavailable"}
                      </Badge>
                    </SectionTitle>
                    {production ? (
                      <div className="table-scroll">
                        <table>
                          <tbody>
                            <tr>
                              <th>Dataset</th>
                              <td>{production.source.file}</td>
                            </tr>
                            <tr>
                              <th>Scenario row</th>
                              <td>{production.source.row}</td>
                            </tr>
                            <tr>
                              <th>Comparable population</th>
                              <td>
                                {production.baseline?.population_rows ??
                                  "Unavailable"}
                              </td>
                            </tr>
                            <tr>
                              <th>Waiting time</th>
                              <td>
                                {production.metrics?.waiting_time ??
                                  "Unavailable"}
                              </td>
                            </tr>
                            <tr>
                              <th>Cycle time</th>
                              <td>
                                {production.metrics?.cycle_time ??
                                  "Unavailable"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty">
                        No production scenario loaded.
                      </div>
                    )}
                  </section>
                  <section className="next-move">
                    <div className="next-move-top">
                      <span className="eyebrow">YOUR NEXT MOVE</span>
                      <span className="orbit-icon">
                        <FlaskConical size={19} />
                      </span>
                    </div>
                    <h2>
                      What if the line
                      <br />
                      could do more?
                    </h2>
                    <p>
                      Explore changes only against scenarios that actually exist
                      in the loaded dataset.
                    </p>
                    <div className="sim-preview">
                      <div>
                        <small>CURRENT</small>
                        <strong>
                          {rateValue ?? "—"}
                          <span>
                            {production?.metrics?.throughput != null
                              ? "/hr"
                              : " output"}
                          </span>
                        </strong>
                      </div>
                      <ArrowRight size={22} />
                      <div>
                        <small>METHOD</small>
                        <strong>
                          Nearest<span> scenario</span>
                        </strong>
                      </div>
                    </div>
                    <button
                      className="btn dark"
                      onClick={() => go("Simulation")}
                    >
                      Explore a what-if <ArrowUpRight size={16} />
                    </button>
                  </section>
                </div>
                <div className="gallery-heading">
                  <SectionTitle
                    eyebrow="FROM PIXELS TO PROCESS"
                    title="A closer look changes everything."
                  >
                    <button
                      className="text-btn"
                      onClick={() => go("Inspection")}
                    >
                      Open inspection studio <ArrowUpRight size={16} />
                    </button>
                  </SectionTitle>
                </div>
                <Showcase items={allSamples} onSelect={setSelected} />
                <div className="gallery-caption">
                  <span>
                    {inspectionBatch
                      ? `${inspectionBatch.total_inspected} uploaded surfaces · trained detector results`
                      : "No inspection surfaces loaded"}
                  </span>
                  <span>
                    Drag to explore <ArrowRight size={13} />
                  </span>
                </div>
                <Footer />
              </>
            )}

            {page === "Inspection" && (
              <>
                <PageHeader
                  eyebrow="VISUAL INTELLIGENCE"
                  title="Look closer. Know more."
                  description="Uploaded surfaces are automatically classified by the trained defect model and localized by the deterministic vision pipeline. The agent is only for follow-up questions."
                >
                  <button
                    className="btn primary"
                    onClick={() => upload.current?.click()}
                  >
                    <Upload size={15} />
                    Upload images
                  </button>
                </PageHeader>
                {detecting && detectProgress && (
                  <div className="processing" style={{ marginBottom: 20 }}>
                    <LoaderCircle className="spin" size={20} />
                    <div>
                      <strong>
                        Analyzing surface {detectProgress.current} of{" "}
                        {detectProgress.total}: {detectProgress.filename}
                      </strong>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--muted)",
                          marginTop: 2,
                        }}
                      >
                        Running the trained defect classifier and deterministic
                        mask / component localization pipeline...
                      </div>
                      <progress
                        value={detectProgress.current}
                        max={detectProgress.total}
                        style={{ width: "100%", marginTop: 6, height: 5 }}
                      />
                    </div>
                  </div>
                )}
                {allSamples.length === 0 ? (
                  <div
                    className="upload-dropzone-real"
                    onClick={() => upload.current?.click()}
                  >
                    <Upload
                      size={38}
                      style={{ color: "var(--green)", marginBottom: 10 }}
                    />
                    <h3>Real Mode · Visual Inspection Studio</h3>
                    <p>
                      Upload manufacturing surface images (PNG, JPEG, WebP). The
                      backend automatically runs the trained classifier, real
                      localization, mask generation, and batch aggregation
                      before any agent is involved.
                    </p>
                    <button
                      className="btn primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        upload.current?.click();
                      }}
                    >
                      <Upload size={15} />
                      Upload Surface Images
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="inspection-summary">
                      <div>
                        <ScanLine size={22} />
                        <strong>{allSamples.length}</strong>
                        <span>Uploaded samples</span>
                      </div>
                      <div>
                        <ShieldCheck size={22} />
                        <strong>
                          {
                            allSamples.filter((s) => s.defect === "Normal")
                              .length
                          }
                        </strong>
                        <span>Normal references</span>
                      </div>
                      <div>
                        <TriangleAlert size={22} />
                        <strong>
                          {
                            allSamples.filter(
                              (s) =>
                                s.defect !== "Normal" &&
                                s.defect !== "Unsupported",
                            ).length
                          }
                        </strong>
                        <span>Defects found</span>
                      </div>
                      <div>
                        <Layers size={22} />
                        <strong>
                          {new Set(allSamples.map((s) => s.defect)).size}
                        </strong>
                        <span>Active classes</span>
                      </div>
                    </div>
                    <div className="filter-toolbar">
                      <div className="filter-pills">
                        {[
                          "All samples",
                          "Rust",
                          "Crack",
                          "Scratch",
                          "Hole",
                          "Normal",
                          "Unsupported",
                          "Unknown",
                        ].map((f) => (
                          <button
                            className={filter === f ? "active" : ""}
                            onClick={() => setFilter(f)}
                            key={f}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      <label className="search-input">
                        <Search size={15} />
                        <input
                          placeholder="Search sample ID…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    <Showcase items={filtered} onSelect={setSelected} />
                    <div className="gallery-caption">
                      <span>
                        {filtered.length} results · click a surface to open the
                        inspection viewer
                      </span>
                      <Badge tone="green">Real Uploaded Surfaces</Badge>
                    </div>
                    <section className="panel table-panel">
                      <SectionTitle title="Inspection ledger">
                        <Badge tone="green">Real session data</Badge>
                      </SectionTitle>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Sample</th>
                              <th>Classification</th>
                              <th>Coverage</th>
                              <th>Source</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((s) => (
                              <tr key={s.id}>
                                <td>
                                  <button
                                    className="table-sample"
                                    onClick={() => setSelected(s)}
                                  >
                                    <img src={s.image} alt="" />
                                    <span>
                                      {s.id}
                                      <small>{s.name || s.source}</small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <Badge
                                    tone={
                                      s.defect === "Normal"
                                        ? "green"
                                        : s.defect === "Unsupported"
                                          ? "red"
                                          : s.defect === "Unknown"
                                            ? "neutral"
                                            : "amber"
                                    }
                                  >
                                    {s.defect}
                                  </Badge>
                                </td>
                                <td>
                                  {s.defect === "Unsupported"
                                    ? "Not processed"
                                    : s.coverage
                                      ? `${s.coverage}%`
                                      : "Analyzed on demand"}
                                </td>
                                <td>{s.name || "User Upload"}</td>
                                <td>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                      className="btn"
                                      onClick={() => setSelected(s)}
                                    >
                                      <Eye size={13} />
                                      Inspect
                                    </button>
                                    <button
                                      className="btn primary"
                                      onClick={() => {
                                        setAssistant(true);
                                        ask(
                                          `Explain the verified detector result for sample ${s.id} (${s.name || "uploaded image"}) from inspection batch ${inspectionBatch?.batch_id || "current batch"}. Use the inspection-batch tool; do not invent a new detection.`,
                                        );
                                      }}
                                    >
                                      <Sparkles size={13} />
                                      Analyze with AI
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!filtered.length && (
                        <p className="empty">
                          No samples found. Upload images to begin inspection.
                        </p>
                      )}
                    </section>
                  </>
                )}
                <div className="notice">
                  <ShieldCheck size={18} />
                  <span>
                    Uploaded images are analyzed by the trained classifier +
                    deterministic localization backend. AGY is not required for
                    inspection; it is used only for automatic evidence
                    explanation and follow-up questions.
                  </span>
                </div>
              </>
            )}

            {page === "Production" && (
              <>
                <PageHeader
                  eyebrow="PRODUCTION INTELLIGENCE"
                  title="See the whole system."
                  description="Production metrics and constraints are read from the selected dataset scenario."
                >
                  <button className="btn" onClick={() => setModal("Compare")}>
                    Compare scenarios <GitBranch size={15} />
                  </button>
                </PageHeader>
                <div className="metrics">
                  <Metric
                    title={
                      production?.metrics?.throughput != null
                        ? "Throughput"
                        : "Output"
                    }
                    value={rateValue}
                    suffix={
                      production?.metrics?.throughput != null ? "/hr" : " parts"
                    }
                    trend={production ? "Measured" : "Unavailable"}
                    sub={production?.source?.file || "No dataset loaded"}
                  />
                  <Metric
                    title={
                      production?.metrics?.wip != null
                        ? "Work in progress"
                        : "Queue pressure"
                    }
                    value={wipValue}
                    trend={wipValue != null ? "Measured" : "Unavailable"}
                    sub={
                      wipValue != null
                        ? "Current scenario"
                        : "Not available in this dataset"
                    }
                    warning={wipValue != null}
                  />
                  <Metric
                    title="Constraint utilization"
                    value={finiteUtil.length ? Math.max(...finiteUtil) : null}
                    suffix="%"
                    trend={
                      constraintInfo
                        ? `${constraintInfo.severity} · score ${constraintInfo.score}`
                        : "Unavailable"
                    }
                    sub={constraintInfo?.station || "No station evidence"}
                    warning={Boolean(constraintInfo)}
                  />
                  <Metric
                    title="Waiting time"
                    value={
                      production?.metrics?.waiting_time ??
                      selectedStationData?.waiting ??
                      null
                    }
                    trend={
                      production?.metrics?.waiting_time != null ||
                      selectedStationData?.waiting != null
                        ? "Measured"
                        : "Unavailable"
                    }
                    sub={
                      production?.metrics?.waiting_time != null
                        ? "Scenario aggregate"
                        : "Selected station"
                    }
                    warning={production?.metrics?.waiting_time != null}
                  />
                </div>
                <section className="panel">
                  <SectionTitle title={facility.name}>
                    <Badge>
                      Model {model} · {scenario}
                    </Badge>
                  </SectionTitle>
                  <FlowMap
                    facility={facility}
                    selected={station}
                    onSelect={setStation}
                  />
                </section>
                <div className="two-col">
                  <section className="panel">
                    <SectionTitle title="Constraint ranking">
                      <Badge>Deterministic · multiple signals</Badge>
                    </SectionTitle>
                    {facility.stations.map((name, i) => {
                      const evidence = bottleneckData?.bottlenecks?.find(
                        (b) => b.station === name,
                      );
                      const score = evidence?.score ?? 0;
                      return (
                        <button
                          className={`rank-row ${station === i ? "selected" : ""}`}
                          key={name}
                          onClick={() => setStation(i)}
                        >
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          <div>
                            <strong>{name}</strong>
                            <div className="rank-track">
                              <i style={{ width: `${score}%` }} />
                            </div>
                          </div>
                          <b>{evidence ? `${score}%` : "—"}</b>
                          <ChevronRight size={15} />
                        </button>
                      );
                    })}
                    <p className="fine-print">
                      Ranking is calculated by the backend from the signals that
                      actually exist for this model. Missing utilization,
                      waiting, queue, or WIP signals are excluded rather than
                      fabricated.
                    </p>
                  </section>
                  <section className="panel evidence-detail">
                    <SectionTitle
                      title={facility.stations[station] || "Station"}
                    >
                      <Badge
                        tone={
                          constraintInfo?.severity === "critical"
                            ? "amber"
                            : "green"
                        }
                      >
                        {constraintInfo?.severity || "No ranked evidence"}
                      </Badge>
                    </SectionTitle>
                    <div className="evidence-number">
                      {typeof selectedStationData?.utilization === "number"
                        ? selectedStationData.utilization.toFixed(1)
                        : "—"}
                      <span>% utilization</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Queue inventory</dt>
                        <dd>
                          {typeof selectedStationData?.queue === "number"
                            ? `${selectedStationData.queue.toLocaleString()} parts`
                            : "Not available in current dataset"}
                        </dd>
                      </div>
                      <div>
                        <dt>Waiting time</dt>
                        <dd>
                          {typeof selectedStationData?.waiting === "number"
                            ? selectedStationData.waiting.toLocaleString()
                            : "Not available in current dataset"}
                        </dd>
                      </div>
                      <div>
                        <dt>Empirical percentile</dt>
                        <dd>
                          {stationBaselineEntry
                            ? `${stationBaselineEntry[1].percentile}th · ${stationBaselineEntry[1].status}`
                            : "Not available for this station metric"}
                        </dd>
                      </div>
                      <div>
                        <dt>Downtime / changeover</dt>
                        <dd>
                          {production?.unavailable?.includes("downtime")
                            ? "Not available in current dataset"
                            : "See source data"}
                        </dd>
                      </div>
                    </dl>
                    <button
                      className="btn primary"
                      onClick={() => go("Investigations")}
                    >
                      Investigate this constraint <ArrowUpRight size={15} />
                    </button>
                  </section>
                </div>
                <section className="panel">
                  <SectionTitle title="Scenario evidence">
                    <Badge>{production?.source?.kind || "Unavailable"}</Badge>
                  </SectionTitle>
                  <div className="timeline-detail">
                    <Database size={17} />
                    {production
                      ? `Source ${production.source.file}, row ${production.source.row}. Baseline population: ${production.baseline?.population_rows ?? "unavailable"} comparable rows.`
                      : "No production scenario is loaded."}
                  </div>
                  <div className="notice">
                    <ShieldCheck size={18} />
                    <span>
                      No event timeline is synthesized. Only metrics present in
                      the selected dataset row and calculated empirical
                      baselines are shown.
                    </span>
                  </div>
                </section>
              </>
            )}
            {page === "Investigations" && (
              <>
                <PageHeader
                  eyebrow="EVIDENCE BEFORE ANSWERS"
                  title="Connect the dots. Carefully."
                  description="Deterministic defect/process correlation from the active inspection batch and production scenario."
                >
                  <button className="btn" onClick={exportReport}>
                    <ArrowDownToLine size={15} />
                    Export investigation
                  </button>
                  <button
                    className="btn primary"
                    disabled={analysisBusy || !production || !inspectionBatch}
                    onClick={() => runAutomaticAnalysis()}
                  >
                    {analysisBusy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Sparkles size={15} />
                    )}
                    Analyze current evidence
                  </button>
                </PageHeader>
                {investigationDefects.length ? (
                  <div className="filter-pills investigation-tabs">
                    {investigationDefects.map((name, index) => (
                      <button
                        key={name}
                        className={defect === name ? "active" : ""}
                        onClick={() => setDefect(name)}
                      >
                        {name}
                        {inspectionBatch?.primary_defect?.type ===
                          name.toLowerCase() && <small>Primary</small>}
                        {inspectionBatch?.secondary_defect?.type ===
                          name.toLowerCase() && <small>Secondary</small>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="notice">
                    <ScanLine size={18} />
                    <span>
                      Upload an image batch to create defect-specific
                      investigations. Production evidence alone does not create
                      a defect diagnosis.
                    </span>
                  </div>
                )}
                <div className="investigation-layout">
                  <section className="panel hypothesis-panel" key={defect}>
                    <div className="row between">
                      <Badge tone="amber">
                        Hypothesis ·{" "}
                        {currentInvestigation?.evidence_strength ||
                          "not analyzed"}
                      </Badge>
                      <span className="muted">
                        {inspectionBatch?.batch_id || "NO INSPECTION BATCH"}
                      </span>
                    </div>
                    <h2>{hyp.title}</h2>
                    <p>{hyp.mechanism}</p>
                    <div className="evidence-chain">
                      <span>
                        <ScanLine size={17} />
                        {defect}
                      </span>
                      <ArrowRight size={15} />
                      <span>
                        <Layers size={17} />
                        Measured process context
                      </span>
                      <ArrowRight size={15} />
                      <span>
                        <FlaskConical size={17} />
                        Verify
                      </span>
                    </div>
                    {[
                      {
                        title: "Supporting production evidence",
                        text: hyp.support,
                        tone: "green",
                      },
                      {
                        title: "Contradictory evidence",
                        text: hyp.contradiction,
                        tone: "amber",
                      },
                      {
                        title: "Missing evidence",
                        text: hyp.missing,
                        tone: "neutral",
                      },
                    ].map((e, i) => (
                      <details
                        className="evidence-accordion"
                        key={e.title}
                        open={i === 0}
                      >
                        <summary>
                          <span className={`evidence-symbol ${e.tone}`}>
                            {i === 0 ? (
                              <Check size={15} />
                            ) : i === 1 ? (
                              <GitBranch size={15} />
                            ) : (
                              <CircleHelp size={15} />
                            )}
                          </span>
                          {e.title}
                          <ChevronDown size={15} />
                        </summary>
                        <p>{e.text}</p>
                      </details>
                    ))}
                    <div className="recommendation">
                      <span className="eyebrow">RECOMMENDED VERIFICATION</span>
                      <p>{hyp.action}</p>
                      <button
                        className="text-btn"
                        onClick={() => {
                          setAudit((a) => [
                            ...a,
                            `Verification task added: ${hyp.action}`,
                          ]);
                          setToast(
                            "Verification action added to the session audit",
                          );
                        }}
                      >
                        Add to investigation plan <Plus size={15} />
                      </button>
                    </div>
                    {combinedAnalysis?.answer && (
                      <div className="notice">
                        <Sparkles size={18} />
                        <span>
                          <strong>AGY evidence summary:</strong>{" "}
                          {combinedAnalysis.answer}
                        </span>
                      </div>
                    )}
                  </section>
                  <div className="investigation-side">
                    <section className="panel">
                      <SectionTitle title="Selected evidence">
                        <Badge>Measured</Badge>
                      </SectionTitle>
                      <div className="evidence-thumbnails">
                        {allSamples
                          .filter(
                            (s) =>
                              s.defect === defect || s.defect === "Unknown",
                          )
                          .slice(0, 3)
                          .map((s) => (
                            <button key={s.id} onClick={() => setSelected(s)}>
                              <img
                                src={s.annotatedImage || s.image}
                                alt={`${s.defect} inspected surface`}
                              />
                              <span>{s.id}</span>
                            </button>
                          ))}
                      </div>
                      <p>
                        {inspectionBatch
                          ? `${inspectionBatch.total_inspected} real uploaded images analyzed. Representative and uncertain samples remain traceable to detector outputs.`
                          : "No inspection batch loaded."}
                      </p>
                    </section>
                    <section className="traceability">
                      <ShieldCheck size={24} />
                      <h3>Keep the missing link visible.</h3>
                      <p>
                        Direct unit-to-machine traceability:{" "}
                        <strong>Not available.</strong>
                      </p>
                      <p>
                        Defect/process links are investigation hypotheses unless
                        the supplied datasets provide a direct join.
                      </p>
                      <button
                        className="text-btn"
                        onClick={() => setModal("Provenance")}
                      >
                        View provenance <ArrowUpRight size={15} />
                      </button>
                    </section>
                    {inspectionBatch?.secondary_defect && (
                      <section className="panel">
                        <span className="eyebrow">SECONDARY DEFECT</span>
                        <h3>
                          {inspectionBatch.secondary_defect.type} ·{" "}
                          {inspectionBatch.secondary_defect.percent}%
                        </h3>
                        <p>
                          Secondary classes are analyzed independently rather
                          than merged into the primary diagnosis.
                        </p>
                        <button
                          className="text-btn"
                          onClick={() =>
                            setDefect(
                              inspectionBatch
                                .secondary_defect!.type.charAt(0)
                                .toUpperCase() +
                                inspectionBatch.secondary_defect!.type.slice(1),
                            )
                          }
                        >
                          Open secondary evidence <ArrowRight size={14} />
                        </button>
                      </section>
                    )}
                  </div>
                </div>
              </>
            )}
            {page === "Simulation" && (
              <>
                <PageHeader
                  eyebrow="COUNTERFACTUAL WORKSPACE"
                  title="A better shift starts with “what if”."
                  description="Match requested changes against real scenarios in the loaded manufacturing dataset."
                >
                  <Badge tone="amber">
                    Simulated / Advisory · no machine control
                  </Badge>
                </PageHeader>
                <div className="simulation-layout">
                  <section className="panel simulation-controls">
                    <SectionTitle title="Shape an alternative">
                      <SlidersHorizontal size={19} />
                    </SectionTitle>
                    <span className="eyebrow">BASELINE / {scenario}</span>
                    <label className="slider-label">
                      <span>
                        Constraint capacity increase
                        <strong>+{capacity}%</strong>
                      </span>
                      <input
                        aria-label="Capacity increase"
                        type="range"
                        min="0"
                        max="40"
                        step="5"
                        value={capacity}
                        onChange={(e) => {
                          setCapacity(+e.target.value);
                          setSimulation(null);
                        }}
                        disabled={
                          !Object.keys(production?.raw || {}).some((k) =>
                            /capacity/i.test(k),
                          )
                        }
                      />
                      <small>
                        <span>
                          {Object.keys(production?.raw || {}).some((k) =>
                            /capacity/i.test(k),
                          )
                            ? "0% · current"
                            : "Capacity field unavailable in this dataset"}
                        </span>
                        <span>40%</span>
                      </small>
                    </label>
                    <label className="field">
                      Target demand{" "}
                      <span className="input-unit">
                        <input
                          aria-label="Target demand"
                          type="number"
                          min="0"
                          value={demand}
                          onChange={(e) => {
                            setDemand(+e.target.value);
                            setSimulation(null);
                          }}
                          disabled={
                            !Object.prototype.hasOwnProperty.call(
                              production?.raw || {},
                              "Demand",
                            )
                          }
                        />
                        <span>
                          {Object.prototype.hasOwnProperty.call(
                            production?.raw || {},
                            "Demand",
                          )
                            ? "dataset units"
                            : "unavailable"}
                        </span>
                      </span>
                    </label>
                    <button
                      className="btn primary full"
                      disabled={simBusy || !production}
                      onClick={runSimulation}
                    >
                      {simBusy ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Play size={17} />
                      )}{" "}
                      {simBusy
                        ? "Matching scenario…"
                        : "Run what-if simulation"}
                    </button>
                    <details className="assumptions" open>
                      <summary>Method & limitations</summary>
                      <p>
                        Nearest-neighbor matching uses only numeric fields that
                        actually exist in the loaded dataset. No future
                        throughput, WIP, waiting time, or defect rate is
                        invented.
                      </p>
                      <p>
                        If this dataset does not expose the requested control
                        variable, ASTRA reports it as unavailable instead of
                        simulating it.
                      </p>
                    </details>
                  </section>
                  <section className="panel simulation-results">
                    <SectionTitle
                      title={
                        simulation
                          ? "Closest observed alternative"
                          : "The next possibility is yours."
                      }
                    >
                      <Badge>
                        {simulation
                          ? "Simulated / Advisory"
                          : "Ready to explore"}
                      </Badge>
                    </SectionTitle>
                    {simulation ? (
                      <>
                        <div className="sim-big">
                          <span>MATCHED SCENARIO</span>
                          <strong>
                            {simulation.matched_scenario}
                            <small>
                              distance {simulation.similarity_distance}
                            </small>
                          </strong>
                        </div>
                        <div className="compare-bars">
                          {(simulation.changed_features || []).map(
                            (key: string) => {
                              const before = simulation.current_values?.[key];
                              const requested =
                                simulation.requested_values?.[key];
                              const after =
                                simulation.alternative_values?.[key];
                              return (
                                <div key={key}>
                                  <div className="row between">
                                    <strong>{key}</strong>
                                    <span>
                                      {before ?? "—"} → requested{" "}
                                      <b>{requested ?? "—"}</b> → matched{" "}
                                      <b>{after ?? "—"}</b>
                                    </span>
                                  </div>
                                </div>
                              );
                            },
                          )}
                        </div>
                        <div className="notice">
                          <CheckCheck size={19} />
                          <span>
                            {simulation.method}.{" "}
                            {(simulation.limitations || []).join(" ")}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="empty">
                        <GitBranch size={28} />
                        <h3>No simulated result yet.</h3>
                        <p>
                          Choose a field supported by this dataset and run
                          nearest-scenario matching.
                        </p>
                      </div>
                    )}
                  </section>
                </div>
                <section className="panel economics">
                  <div>
                    <span className="eyebrow">ECONOMIC CONTEXT</span>
                    <h2>Put a value on the impact.</h2>
                    <p>
                      Financial impact is calculated only from explicit user
                      assumptions and the real inspected defective count.
                    </p>
                  </div>
                  <label className="field">
                    Scrap cost per defective part ($)
                    <input
                      type="number"
                      min="0"
                      step=".01"
                      placeholder="Enter a cost"
                      value={unitCost}
                      onChange={(e) => setUnitCost(e.target.value)}
                    />
                  </label>
                  <div className="economic-value">
                    <small>
                      {economicImpact?.calculated?.scrap_loss
                        ? "USER ASSUMPTION · BACKEND CALCULATED"
                        : "ECONOMIC DATA UNAVAILABLE"}
                    </small>
                    <strong>
                      {economicImpact?.calculated?.scrap_loss
                        ? `$${Number(economicImpact.calculated.scrap_loss.value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                        : "—"}
                    </strong>
                    <span>
                      {defective} inspected defective units × user-provided
                      scrap cost
                    </span>
                  </div>
                </section>
              </>
            )}
            {page === "Batches" && (
              <>
                <PageHeader
                  eyebrow="YOUR DATA, IN CONTEXT"
                  title="Real Datasets & Production Models"
                  description="Select or import a production CSV, inspect its real schema, then analyze it together with the current image batch."
                >
                  <button
                    className="btn"
                    onClick={() => productionUpload.current?.click()}
                  >
                    <Upload size={15} />
                    Import production CSV
                  </button>
                  <button
                    className="btn primary"
                    disabled={analysisBusy || !production || !inspectionBatch}
                    onClick={() => runAutomaticAnalysis()}
                  >
                    {analysisBusy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Sparkles size={15} />
                    )}
                    Refresh current analysis
                  </button>
                </PageHeader>
                <section
                  className="panel table-panel"
                  style={{ marginBottom: 24 }}
                >
                  <SectionTitle title="Batch History / Previous Batches">
                    <Badge>{batchHistory.length} persisted</Badge>
                  </SectionTitle>
                  {batchHistory.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Batch</th>
                            <th>Completed</th>
                            <th>Production context</th>
                            <th>Inspection</th>
                            <th>Analysis</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchHistory.map((batch) => (
                            <tr
                              key={batch.batch_id}
                              className="batch-history-row"
                              onClick={() => restoreBatch(batch.batch_id)}
                            >
                              <td>
                                <strong>{batch.batch_id}</strong>
                              </td>
                              <td>
                                {batch.completed_at
                                  ? new Date(
                                      batch.completed_at * 1000,
                                    ).toLocaleString()
                                  : "In progress"}
                              </td>
                              <td>
                                Model {batch.model ?? "—"} ·{" "}
                                {batch.scenario_id || "Unavailable"}
                              </td>
                              <td>
                                {batch.total_inspected ?? 0} images ·{" "}
                                {batch.defective ?? 0} defective
                                {batch.unsupported
                                  ? ` · ${batch.unsupported} unsupported`
                                  : ""}
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    batch.analysis_status === "ready"
                                      ? "green"
                                      : "neutral"
                                  }
                                >
                                  {batch.analysis_status === "ready"
                                    ? "Ready"
                                    : "Evidence ready"}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>No persisted inspection batches yet.</p>
                  )}
                </section>
                <section
                  className="panel table-panel"
                  style={{ marginBottom: 24 }}
                >
                  <SectionTitle title="Manufacturing CSV datasets">
                    <Badge tone="green">Backend-validated</Badge>
                  </SectionTitle>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Dataset file</th>
                          <th>Model</th>
                          <th>Rows</th>
                          <th>Columns sample</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {realCsvFiles.map((f) => (
                          <tr
                            key={f.name}
                            className={
                              selectedCsv?.name === f.name ? "selected" : ""
                            }
                          >
                            <td>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <FileSpreadsheet
                                  size={16}
                                  style={{ color: "var(--green)" }}
                                />
                                <strong>{f.name}</strong>
                              </div>
                            </td>
                            <td>Model {f.model ?? "—"}</td>
                            <td>{f.row_count?.toLocaleString?.() ?? "—"}</td>
                            <td>
                              <small style={{ color: "var(--muted)" }}>
                                {f.columns?.slice(0, 4).join(", ")}
                                {f.columns?.length > 4
                                  ? ` +${f.columns.length - 4} more`
                                  : ""}
                              </small>
                            </td>
                            <td>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  flexWrap: "wrap",
                                }}
                              >
                                <button
                                  className="btn"
                                  onClick={() => previewCsv(f)}
                                >
                                  <Eye size={13} />
                                  Preview
                                </button>
                                {f.model && (
                                  <button
                                    className="btn"
                                    onClick={() => {
                                      setSelectedCsv(f);
                                      setModel(Number(f.model));
                                      setToast(
                                        `${f.name} selected as the production data source for Model ${f.model}.`,
                                      );
                                    }}
                                  >
                                    <Database size={13} />
                                    Use dataset
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csvPreviewLoading && (
                    <div
                      style={{
                        padding: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 11,
                        color: "var(--muted)",
                      }}
                    >
                      <LoaderCircle className="spin" size={15} />
                      Loading {selectedCsv?.name} preview...
                    </div>
                  )}
                  {csvPreviewRows && selectedCsv && (
                    <div
                      style={{
                        marginTop: 18,
                        padding: 14,
                        background: "var(--surface-2)",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 10,
                        }}
                      >
                        <strong>Preview: {selectedCsv.name}</strong>
                        <button
                          className="text-btn"
                          onClick={() => setCsvPreviewRows(null)}
                        >
                          <X size={14} />
                          Close preview
                        </button>
                      </div>
                      <div className="table-scroll" style={{ maxHeight: 260 }}>
                        <table>
                          <thead>
                            <tr>
                              {csvPreviewCols.map((c) => (
                                <th key={c}>{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csvPreviewRows.map((r, i) => (
                              <tr key={i}>
                                {csvPreviewCols.map((c) => (
                                  <td key={c}>{String(r[c] ?? "")}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
                <section className="panel" style={{ marginBottom: 24 }}>
                  <SectionTitle title="Combined analysis">
                    <Badge tone={combinedAnalysis ? "green" : "neutral"}>
                      {analysisBusy
                        ? "Analyzing live"
                        : combinedAnalysis
                          ? "Evidence ready"
                          : "Not run"}
                    </Badge>
                  </SectionTitle>
                  {analysisBusy && analysisStatus && (
                    <div className="agent-status">
                      <LoaderCircle className="spin" size={14} />
                      {analysisStatus}
                    </div>
                  )}
                  {combinedAnalysis?.answer ? (
                    <MarkdownRenderer
                      content={combinedAnalysis.answer}
                      renderBlocks={combinedAnalysis.render_blocks || []}
                      onImageClick={(image) => setInspectImageModal(image)}
                    />
                  ) : combinedAnalysis?.deterministic ? (
                    <p>
                      Deterministic image + production evidence is ready. AGY is
                      generating the explanation or is currently unavailable;
                      the evidence remains available in Investigations.
                    </p>
                  ) : (
                    <p>
                      Select the production context, then upload inspection
                      images. ASTRA starts the combined deterministic analysis
                      automatically; AGY then explains the verified evidence.
                    </p>
                  )}
                  <div className="row" style={{ marginTop: 12 }}>
                    <Badge>
                      {inspectionBatch?.batch_id || "No image batch"}
                    </Badge>
                    <Badge>
                      {production
                        ? `${production.source.file} · row ${production.source.row}`
                        : "No production scenario"}
                    </Badge>
                  </div>
                </section>
                <div className="model-library-heading">
                  <div>
                    <span className="eyebrow">PRODUCTION MODEL LIBRARY</span>
                    <h2>Your floor. Your data.</h2>
                  </div>
                </div>
                <div className="facility-cards">
                  {models.slice(0, 3).map((f) => (
                    <button
                      className={`panel facility-card ${model === f.id ? "selected" : ""}`}
                      key={f.id}
                      onClick={() => setModel(f.id)}
                    >
                      <span className="facility-number">0{f.id}</span>
                      <Factory size={32} strokeWidth={1} />
                      <h2>{f.name}</h2>
                      <p>{f.subtitle}</p>
                      <Badge tone={model === f.id ? "green" : "neutral"}>
                        {model === f.id ? "Selected facility" : `Model ${f.id}`}
                      </Badge>
                    </button>
                  ))}
                </div>
                <section className="panel table-panel">
                  <SectionTitle title="Available scenarios">
                    <Badge>{scenarios.length.toLocaleString()} real rows</Badge>
                  </SectionTitle>
                  <div className="table-scroll" style={{ maxHeight: 420 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th>Context</th>
                          <th>Source</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {scenarios.slice(0, 100).map((s) => (
                          <tr key={s.id}>
                            <td>
                              <strong>{s.id}</strong>
                            </td>
                            <td>{s.label}</td>
                            <td>
                              <Badge>{s.source || "dataset"}</Badge>
                            </td>
                            <td>
                              <button
                                className="btn"
                                onClick={() => setScenario(s.id)}
                              >
                                {scenario === s.id ? "Active" : "Load scenario"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {scenarios.length > 100 && (
                    <p className="fine-print">
                      Showing the first 100 scenarios here. Use the header
                      scenario dropdown to access the complete list.
                    </p>
                  )}
                </section>
                <div className="two-col">
                  <section className="panel">
                    <Database size={24} />
                    <h2>Transparent by design.</h2>
                    <p>
                      {production
                        ? `Active source: ${production.source.file}, row ${production.source.row}. Dataset metrics are read by the FastAPI production engine; missing fields remain unavailable.`
                        : "No production source is active."}
                    </p>
                    <button
                      className="text-btn"
                      onClick={() => setModal("Provenance")}
                    >
                      Inspect data provenance <ArrowUpRight size={15} />
                    </button>
                  </section>
                  <section className="panel">
                    <FileText size={24} />
                    <h2>Review activity</h2>
                    {audit.length ? (
                      audit.slice(0, 5).map((a, i) => (
                        <p className="audit-item" key={i}>
                          <Check size={14} />
                          {a}
                        </p>
                      ))
                    ) : (
                      <p>
                        No reviews yet. Inspection and analysis activity will
                        appear here.
                      </p>
                    )}
                  </section>
                </div>
              </>
            )}
            {page === "System" && (
              <>
                <PageHeader
                  eyebrow="PLATFORM OBSERVABILITY"
                  title="Confidence in the connections."
                  description="Live health from the deterministic FastAPI backend and the AGY orchestration server."
                >
                  <button
                    className="btn primary"
                    disabled={healthBusy}
                    onClick={checkHealth}
                  >
                    <RefreshCw className={healthBusy ? "spin" : ""} size={15} />
                    {healthBusy ? "Checking…" : "Run health check"}
                  </button>
                </PageHeader>
                <div
                  className={`health-banner ${health.startsWith("Degraded") ? "degraded" : ""}`}
                >
                  <Activity size={34} />
                  <div>
                    <span className="eyebrow">API HEALTH · LIVE</span>
                    <h2>{health}</h2>
                    <p>
                      {health === "Not checked"
                        ? "Run a live health check against the current backend stack."
                        : health.startsWith("Degraded")
                          ? "One or more live services could not be reached."
                          : "The deterministic inspection/production backend responded successfully. AGY status is reported independently."}
                    </p>
                  </div>
                  <Badge
                    tone={health.startsWith("Degraded") ? "amber" : "green"}
                  >
                    {health === "Not checked"
                      ? "Not checked"
                      : health.startsWith("Degraded")
                        ? "Degraded"
                        : "Live"}
                  </Badge>
                </div>
                <div className="service-grid">
                  {[
                    {
                      name: "API gateway",
                      path: "/api/health",
                      icon: GitBranch,
                      status:
                        health === "Not checked"
                          ? "Not checked"
                          : health.startsWith("Degraded")
                            ? "Check failed"
                            : "Reachable",
                    },
                    {
                      name: "Visual inspection",
                      path: "/api/inspection/batch",
                      icon: ScanLine,
                      status:
                        health === "Not checked"
                          ? "Not checked"
                          : health.startsWith("Degraded")
                            ? "Unknown"
                            : "Ready",
                    },
                    {
                      name: "Production data",
                      path: "/api/production/{model}/{scenario}",
                      icon: Factory,
                      status: production
                        ? "Scenario loaded"
                        : "No active scenario",
                    },
                    {
                      name: "Investigation assistant",
                      path: "/api/agent/chat",
                      icon: Sparkles,
                      status: aiOnline
                        ? "AGY connected"
                        : "AGY unavailable / unchecked",
                    },
                  ].map((svc, i) => (
                    <section className="panel service" key={svc.name}>
                      <div className="row between">
                        <svc.icon size={24} />
                        <Badge
                          tone={
                            svc.status.includes("Ready") ||
                            svc.status.includes("Reachable") ||
                            svc.status.includes("connected") ||
                            svc.status.includes("loaded")
                              ? "green"
                              : "neutral"
                          }
                        >
                          {svc.status}
                        </Badge>
                      </div>
                      <h3>{svc.name}</h3>
                      <code>{svc.path}</code>
                      <span className="muted">
                        Current runtime state · no synthetic heartbeat history
                      </span>
                    </section>
                  ))}
                </div>
                <section className="panel">
                  <SectionTitle title="Current data context">
                    <Badge>Truth-first</Badge>
                  </SectionTitle>
                  <div className="row between">
                    <p>
                      Inspection batch:{" "}
                      <strong>{inspectionBatch?.batch_id || "none"}</strong>
                      <br />
                      Production:{" "}
                      <strong>
                        {production
                          ? `${production.source.file} · row ${production.source.row}`
                          : "none"}
                      </strong>
                      <br />
                      AGY session:{" "}
                      <strong>{agentSessionId.current.slice(0, 8)}…</strong>
                    </p>
                    <button
                      className="text-btn"
                      onClick={() => go("Developer")}
                    >
                      Inspect recorded diagnostics <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
              </>
            )}

            {page === "Developer" && (
              <>
                <PageHeader
                  eyebrow="DEVELOPER WORKSPACE"
                  title="Runtime diagnostics."
                  description="Inspect explicit health/tool diagnostics recorded by this frontend session. These entries are not synthetic network responses."
                >
                  <button
                    className="btn"
                    onClick={() => diagnosticsStore.clear()}
                  >
                    Clear diagnostics
                  </button>
                  <button
                    className="btn primary"
                    onClick={() =>
                      download(
                        "astra-session-diagnostics.json",
                        JSON.stringify(logs, null, 2),
                      )
                    }
                  >
                    <ArrowDownToLine size={15} />
                    Export diagnostics
                  </button>
                </PageHeader>
                <div className="metrics">
                  <Metric
                    title="Recorded checks"
                    value={logs.length}
                    trend="Session log"
                    sub="Explicitly recorded operations"
                  />
                  <Metric
                    title="Successful"
                    value={logs.filter((l) => l.status === 200).length}
                    trend="200 OK"
                    sub="Observed responses"
                  />
                  <Metric
                    title="Failed"
                    value={logs.filter((l) => Number(l.status) >= 400).length}
                    trend="Errors"
                    sub="Observed failures"
                    warning
                  />
                  <Metric
                    title="Pending"
                    value={logs.filter((l) => l.status === "pending").length}
                    trend="In progress"
                    sub="Current session"
                  />
                </div>
                <section className="panel table-panel">
                  <div className="filter-toolbar">
                    <div className="filter-pills">
                      {["All requests", "Errors", "Pending"].map((f) => (
                        <button
                          key={f}
                          className={logFilter === f ? "active" : ""}
                          onClick={() => setLogFilter(f)}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                    <label className="search-input">
                      <Search size={15} />
                      <input
                        aria-label="Filter request path"
                        placeholder="Filter by endpoint…"
                        value={logQuery}
                        onChange={(e) => setLogQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table className="log-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Method</th>
                          <th>Endpoint</th>
                          <th>Status</th>
                          <th>Duration</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLogs.map((l) => (
                          <tr key={l.id} onClick={() => setLogDetail(l)}>
                            <td>{l.time}</td>
                            <td>
                              <Badge>{l.method}</Badge>
                            </td>
                            <td>
                              <code>{l.path}</code>
                            </td>
                            <td>
                              <Badge
                                tone={
                                  l.status === 200
                                    ? "green"
                                    : l.status === "pending"
                                      ? "neutral"
                                      : "amber"
                                }
                              >
                                {l.status}
                              </Badge>
                            </td>
                            <td>
                              {l.status === "pending"
                                ? "…"
                                : `${l.duration} ms`}
                            </td>
                            <td>
                              <button
                                className="icon-btn"
                                aria-label={`Inspect request ${l.path}`}
                                onClick={() => setLogDetail(l)}
                              >
                                <ChevronRight size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!filteredLogs.length && (
                    <div className="empty">
                      <Code2 size={28} />
                      <h3>No diagnostics recorded.</h3>
                      <p>Run the live health check to add a measured entry.</p>
                      <button className="btn" onClick={checkHealth}>
                        Run health check
                      </button>
                    </div>
                  )}
                </section>
                <div className="notice">
                  <Code2 size={18} />
                  <span>
                    Manufacturing facts come from FastAPI endpoints and the
                    trained detector. This panel does not manufacture mock
                    production responses.
                  </span>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
      <input
        ref={upload}
        className="sr-only"
        aria-label="Upload inspection images"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={productionUpload}
        className="sr-only"
        aria-label="Upload production CSV"
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => handleProductionCsv(e.target.files)}
      />
      <button
        className="assistant-fab"
        onClick={() => setAssistant(!assistant)}
        aria-label="Open investigation assistant"
      >
        <Sparkles size={19} />
        <span>Ask Astra</span>
        <kbd>↗</kbd>
      </button>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {selected && (
        <SampleViewer
          sample={selected}
          onClose={() => setSelected(null)}
          onReview={(s) =>
            setAudit((a) => [...a, `${new Date().toLocaleTimeString()} · ${s}`])
          }
          onInvestigate={() => {
            setDefect(
              selected.defect === "Normal" ? "Unknown" : selected.defect,
            );
            setSelected(null);
            go("Investigations");
          }}
          onAskAi={(s) => {
            setSelected(null);
            setAssistant(true);
            ask(
              `Inspect and analyze this ${s.defect} defect on ${s.name || s.id}, review bounding box coordinates, and evaluate process causes.`,
              { b64: s.originalImage || s.image, name: s.name || s.id },
            );
          }}
        />
      )}
      {assistant && (
        <aside
          className="assistant-drawer"
          aria-label="Investigation assistant"
        >
          <div className="assistant-header">
            <span className="teaser-icon">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>Astra Assistant</strong>
              <small>Multi-Tool Agentic Intelligence</small>
            </div>
            <button
              className="icon-btn"
              onClick={() => setAssistant(false)}
              aria-label="Close assistant"
            >
              <X size={19} />
            </button>
          </div>
          <div className="assistant-body">
            <div className="row between" style={{ marginBottom: 14 }}>
              <Badge tone={aiOnline ? "green" : "amber"}>
                {aiOnline ? "Native AGY · LangChain Active" : "AI Connecting…"}
              </Badge>
              {availableAiModels.length > 0 && (
                <select
                  aria-label="Select AGY Model"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  style={{
                    fontSize: 10,
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    padding: "3px 6px",
                    maxWidth: 175,
                  }}
                >
                  {availableAiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label || m.id}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <h2>
              A good question
              <br />
              changes the picture.
            </h2>
            <p>Explore what the evidence supports — and what it doesn’t.</p>
            <div className="suggestions">
              {[
                `Summarize the evidence for ${scenario}`,
                `Explain why ${constraintInfo?.station || "the leading station"} ranks highest`,
                `What evidence supports the ${defect} investigation?`,
                `What information is still missing?`,
              ].map((q) => (
                <button key={q} onClick={() => ask(q)} disabled={thinking}>
                  {q}
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
            {chat.map((m, i) => (
              <div className={`chat-message ${m.role}`} key={i}>
                {m.role === "assistant" && (
                  <span className="eyebrow">
                    ASTRA · AGY ANALYSIS ({aiModel})
                  </span>
                )}
                {m.role === "user" && m.image_b64 && (
                  <div>
                    <img
                      src={m.image_b64}
                      alt="Attached"
                      className="chat-msg-image-thumb"
                      onClick={() => setInspectImageModal(m.image_b64!)}
                    />
                  </div>
                )}
                {m.role === "assistant" &&
                  m.executed_tools &&
                  m.executed_tools.length > 0 && (
                    <ToolExecutionCard
                      tools={m.executed_tools}
                      onImageClick={(img) => setInspectImageModal(img)}
                    />
                  )}
                {m.role === "assistant" ? (
                  <MarkdownRenderer
                    content={m.text}
                    renderBlocks={m.render_blocks}
                    onImageClick={(img) => setInspectImageModal(img)}
                  />
                ) : (
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
                )}
                {m.role === "assistant" && (
                  <button
                    className="text-btn"
                    onClick={() => {
                      setAssistant(false);
                      go("Developer");
                    }}
                  >
                    View tool activity <Code2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {thinking && (
              <div className="chat-message">
                <LoaderCircle className="spin" size={16} />
                {agentStatus || "Generating recommendation…"}
              </div>
            )}
          </div>
          {chatAttachedImage && (
            <div className="chat-attachment-bar">
              <div className="chat-attachment-left">
                <img
                  src={chatAttachedImage.b64}
                  alt=""
                  className="chat-attachment-thumb"
                />
                <span className="chat-attachment-name">
                  {chatAttachedImage.name}
                </span>
              </div>
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={() => setChatAttachedImage(null)}
                aria-label="Remove attached image"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <input
              type="file"
              ref={chatImageInput}
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => handleChatImageSelect(e.target.files)}
            />
            <button
              type="button"
              className="icon-btn"
              title="Attach image to inspect"
              onClick={() => chatImageInput.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <input
              aria-label="Ask investigation assistant"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about CSVs, detect defects, production…"
            />
            <button
              className="icon-btn"
              disabled={thinking || (!question.trim() && !chatAttachedImage)}
              aria-label="Send question"
            >
              <Send size={17} />
            </button>
          </form>
          <small className="assistant-disclaimer">
            Advisory agent. Evidence dynamically queried via LangChain tools &
            AGY.
          </small>
        </aside>
      )}
      {modal && (
        <Modal
          title={
            modal === "Facility"
              ? "Choose your production environment"
              : modal === "Search"
                ? "Find your next insight"
                : modal === "Compare"
                  ? "Scenario comparison"
                  : modal
          }
          onClose={() => setModal("")}
          wide={modal === "Compare"}
        >
          {modal === "Facility" && (
            <ModelPicker
              models={models}
              selected={model}
              onSelect={(id) => {
                setModel(id);
                setModal("");
              }}
            />
          )}
          {modal === "Search" && (
            <>
              <label className="search-input large">
                <Search size={18} />
                <input
                  autoFocus
                  placeholder="Search pages, scenarios, or samples…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="search-results">
                {[...nav.map((n) => n.id), "System", "Developer", "Batches"]
                  .filter((p) => p.toLowerCase().includes(query.toLowerCase()))
                  .map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        go(p);
                        setModal("");
                        setQuery("");
                      }}
                    >
                      <LayoutGrid size={16} />
                      {p}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                {allSamples
                  .filter((s) =>
                    (s.id + " " + s.defect)
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .slice(0, 4)
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelected(s);
                        setModal("");
                        setQuery("");
                      }}
                    >
                      <ScanLine size={16} />
                      {s.id} · {s.defect}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
              </div>
            </>
          )}
          {modal === "Notifications" && (
            <div className="notification-list">
              <Badge>
                {production || inspectionBatch
                  ? "Current evidence"
                  : "No active evidence"}
              </Badge>
              {constraintInfo && (
                <button
                  onClick={() => {
                    setModal("");
                    go("Investigations");
                  }}
                >
                  <TriangleAlert size={20} />
                  <div>
                    <strong>
                      {constraintInfo.station} has the strongest bottleneck
                      evidence
                    </strong>
                    <p>
                      Score {constraintInfo.score} · {constraintInfo.severity}.
                      Open the deterministic investigation before acting.
                    </p>
                  </div>
                  <ChevronRight size={16} />
                </button>
              )}
              {inspectionBatch && (
                <button
                  onClick={() => {
                    setModal("");
                    go("Inspection");
                  }}
                >
                  <ScanLine size={20} />
                  <div>
                    <strong>
                      {inspectionBatch.total_inspected} uploaded images analyzed
                    </strong>
                    <p>
                      {inspectionBatch.defective} defective ·{" "}
                      {inspectionBatch.normal} normal · batch{" "}
                      {inspectionBatch.batch_id}
                    </p>
                  </div>
                  <ChevronRight size={16} />
                </button>
              )}
              {!constraintInfo && !inspectionBatch && (
                <p>
                  Upload an inspection batch or load a production dataset to
                  create evidence-backed notifications.
                </p>
              )}
            </div>
          )}
          {modal === "Provenance" && (
            <div className="provenance">
              <Badge>Live provenance</Badge>
              <h3>Know where every number comes from.</h3>
              <dl>
                <div>
                  <dt>Production source</dt>
                  <dd>
                    {production
                      ? `${production.source?.file} · row ${production.source?.row}`
                      : "No active production dataset"}
                  </dd>
                </div>
                <div>
                  <dt>Active facility</dt>
                  <dd>
                    Model {model} · {facility.name}
                  </dd>
                </div>
                <div>
                  <dt>Inspection source</dt>
                  <dd>
                    {inspectionBatch
                      ? `${inspectionBatch.total_inspected} uploaded images · ${inspectionBatch.batch_id}`
                      : "No inspection batch loaded"}
                  </dd>
                </div>
                <div>
                  <dt>Detector</dt>
                  <dd>
                    {inspectionBatch
                      ? "Trained classifier + deterministic localization"
                      : "Not run"}
                  </dd>
                </div>
                <div>
                  <dt>Scenario metrics</dt>
                  <dd>
                    {production
                      ? "Read from the selected CSV row; missing fields remain unavailable."
                      : "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Direct unit-to-machine join</dt>
                  <dd>Not available unless supplied by the source dataset</dd>
                </div>
              </dl>
              <p>
                Production values are measured from the active dataset row.
                Detector aggregates and empirical baselines are calculated.
                Defect/process links are hypotheses. What-if results are
                simulated/advisory. Economics uses explicit user assumptions.
              </p>
            </div>
          )}
          {modal === "Guide" && (
            <div className="guide">
              {[
                [
                  "01",
                  "Choose production data",
                  "Select Model 1–3 and a real scenario, or import a compatible production CSV.",
                ],
                [
                  "02",
                  "Upload inspection images",
                  "The full batch is automatically classified and localized by the trained detector.",
                ],
                [
                  "03",
                  "Review real outputs",
                  "Open Original, Annotated, and Mask views and verify the returned boxes/components.",
                ],
                [
                  "04",
                  "Analyze together",
                  "With both an inspection batch and production scenario loaded, run combined deterministic analysis; AGY explains that evidence.",
                ],
                [
                  "05",
                  "Ask follow-up questions",
                  "Use Astra Assistant only for additional reasoning over the already analyzed context.",
                ],
              ].map(([n, t, p]) => (
                <div key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{t}</h3>
                    <p>{p}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {modal === "Compare" && (
            <div className="table-scroll">
              <p>
                Comparable scenarios come directly from the active dataset.
                Select a scenario to load its measured row and empirical
                baseline; ASTRA does not synthesize comparison values in the
                browser.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Context</th>
                    <th>Source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {scenarios.slice(0, 50).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.id}</strong>
                      </td>
                      <td>{s.label}</td>
                      <td>{s.source || "dataset"}</td>
                      <td>
                        <button
                          className="btn"
                          onClick={() => {
                            setScenario(s.id);
                            setModal("");
                          }}
                        >
                          {scenario === s.id ? "Active" : "Load"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {scenarios.length > 50 && (
                <p className="fine-print">
                  Showing 50 of {scenarios.length.toLocaleString()} dataset
                  scenarios. The Scenario control contains the full list.
                </p>
              )}
            </div>
          )}
        </Modal>
      )}
      {logDetail && (
        <Modal title="Request details" onClose={() => setLogDetail(null)} wide>
          <div className="row">
            <Badge>{logDetail.method}</Badge>
            <code>{logDetail.path}</code>
            <Badge tone={logDetail.status === 200 ? "green" : "amber"}>
              {logDetail.status}
            </Badge>
          </div>
          <p>
            Source: frontend request diagnostics · request ID {logDetail.id}
          </p>
          <div className="two-col">
            <div>
              <h3>Request payload</h3>
              <pre>{JSON.stringify(logDetail.input, null, 2)}</pre>
            </div>
            <div>
              <h3>Response payload</h3>
              <pre>{JSON.stringify(logDetail.response, null, 2)}</pre>
            </div>
          </div>
        </Modal>
      )}
      {inspectImageModal && (
        <div
          className="image-lightbox-overlay"
          onClick={() => setInspectImageModal(null)}
        >
          <div
            className="image-lightbox-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="image-lightbox-close"
              onClick={() => setInspectImageModal(null)}
              aria-label="Close image lightbox"
            >
              <X size={18} />
            </button>
            <img src={inspectImageModal} alt="Annotated Defect Inspection" />
          </div>
        </div>
      )}
    </div>
  );
}
function Metric({
  title,
  value,
  suffix = "",
  digits = 0,
  trend,
  sub,
  warning = false,
}: {
  title: string;
  value: number | null | undefined;
  suffix?: string;
  digits?: number;
  trend: string;
  sub: string;
  warning?: boolean;
}) {
  const available = typeof value === "number" && Number.isFinite(value);
  return (
    <section className={`metric ${warning ? "warning" : ""}`}>
      <div className="metric-label">
        {title}
        <span>
          {warning ? <TriangleAlert size={14} /> : <ArrowUpRight size={14} />}
        </span>
      </div>
      <div className="metric-value">
        <strong>
          {available ? <Count value={value} digits={digits} /> : <span>—</span>}
        </strong>
        <span>{available ? suffix : ""}</span>
      </div>
      <div className="metric-footer">
        <Badge tone={warning ? "amber" : available ? "green" : "neutral"}>
          {available && !warning && <ArrowUpRight size={10} />} {trend}
        </Badge>
        <span>{sub}</span>
      </div>
    </section>
  );
}
function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Footer() {
  return (
    <footer className="page-footer">
      <span>
        <span className="brand-mini">A</span> ASTRA INTELLIGENCE
      </span>
      <span>Built around evidence. Designed for better decisions.</span>
      <Badge>Connected workspace</Badge>
    </footer>
  );
}
