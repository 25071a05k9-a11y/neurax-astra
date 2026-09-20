export type Defect =
  | "Rust"
  | "Crack"
  | "Scratch"
  | "Hole"
  | "Normal"
  | "Unknown"
  | "Unsupported";
export type Sample = {
  id: string;
  defect: Defect;
  coverage: number;
  agreement: string;
  image: string;
  source: "upload";
  name?: string;
  originalImage?: string;
  annotatedImage?: string;
  maskImage?: string;
  bbox?: any;
  image_size?: { width: number; height: number };
  components?: any[];
  error?: string;
};
export const facilities = [
  {
    id: 1,
    name: "Linear workshop",
    subtitle: "Drilling → milling → assembly → inspection",
    stations: ["Drilling", "Milling", "Assembly", "Inspection"],
    rate: 0,
    wip: 0,
    yield: 0,
    util: [0, 0, 0, 0],
  },
  {
    id: 2,
    name: "Sub-assembly plant",
    subtitle: "Converging streams · intermediate buffers",
    stations: ["Drilling", "Milling", "Assembly", "Inspection"],
    rate: 0,
    wip: 0,
    yield: 0,
    util: [0, 0, 0, 0],
  },
  {
    id: 3,
    name: "OEM mega-plant",
    subtitle: "Blanking · presses · cells · paint · quality · handling",
    stations: [
      "Blanking",
      "Press line",
      "Assembly cells",
      "Paint",
      "Inspection",
      "Material handling",
    ],
    rate: 0,
    wip: 0,
    yield: 0,
    util: [0, 0, 0, 0, 0, 0],
  },
];
export type RequestLog = {
  id: string;
  time: string;
  method: string;
  path: string;
  status: number | "pending";
  duration: number;
  input: unknown;
  response: unknown;
};
let logs: RequestLog[] = [];
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((fn) => fn());
export const diagnosticsStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot: () => logs,
  async request<T>(
    path: string,
    input: unknown,
    result: T,
    failed = false,
  ): Promise<T> {
    const id = crypto.randomUUID();
    const start = performance.now();
    const status = failed ? 500 : 200;
    logs = [
      {
        id,
        time: new Date().toLocaleTimeString("en-GB"),
        method: input ? "POST" : "GET",
        path,
        status,
        duration: Math.max(0, Math.round(performance.now() - start)),
        input: input ?? null,
        response: result,
      },
      ...logs,
    ].slice(0, 100);
    publish();
    if (failed) throw new Error("Request failed.");
    return result;
  },
  clear() {
    logs = [];
    publish();
  },
};
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
