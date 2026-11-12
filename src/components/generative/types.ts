import { z } from "zod";

// ============================================================================
// 100+ GENERATIVE UI COMPONENT ZOD SCHEMAS (BASTILLA OS ULTIMATE)
// ============================================================================

// --- 1. WYKRESY I DASHBOARDY (CHARTS & METRICS) ---
export const MetricCardSchema = z.object({
  title: z.string(),
  value: z.union([z.string(), z.number()]),
  change: z.string().optional(),
  unit: z.string().optional(),
  status: z.enum(["normal", "warning", "critical", "success", "info"]).optional(),
  description: z.string().optional(),
});

export const StatsGridSchema = z.object({
  title: z.string().optional(),
  metrics: z.array(MetricCardSchema),
});

export const ChartDataPointSchema = z.object({
  name: z.string(),
  value: z.number(),
  secondary: z.number().optional(),
  tertiary: z.number().optional(),
});

export const ChartComponentSchema = z.object({
  title: z.string(),
  chartType: z.enum(["area", "bar", "line", "pie", "radar", "scatter", "composed"]),
  data: z.array(ChartDataPointSchema),
  color: z.string().optional(),
  secondaryColor: z.string().optional(),
  height: z.number().optional(),
  unit: z.string().optional(),
});

export const RadialGaugeSchema = z.object({
  title: z.string(),
  value: z.number(), // 0 - 100
  label: z.string().optional(),
  unit: z.string().optional(),
  status: z.enum(["normal", "warning", "critical", "success"]).optional(),
});

export const SvlDomainChartSchema = z.object({
  title: z.string().default("TopologicalInfinityEngine (Algebra 97)"),
  x_start: z.number(),
  x_end: z.number(),
  compact_start: z.number(),
  compact_end: z.number(),
  metric_c: z.number(),
});

// --- 2. INTERAKTYWNE KONTROLKI & PRZYCISKI (ACTIONS & CONTROLS) ---
export const ActionButtonSchema = z.object({
  label: z.string(),
  actionType: z.enum([
    "exec_root",
    "exec_python",
    "inspect_db",
    "open_terminal",
    "restart_agent",
    "toggle_setting",
    "send_ipc",
    "copy_text",
  ]),
  payload: z.string(),
  variant: z.enum(["primary", "secondary", "danger", "success", "warning"]).optional(),
  icon: z.string().optional(),
  confirmPrompt: z.string().optional(),
  description: z.string().optional(),
});

export const ActionButtonGroupSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  buttons: z.array(ActionButtonSchema),
});

export const QuickToggleSchema = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  actionPayload: z.string(),
  description: z.string().optional(),
});

export const SliderControlSchema = z.object({
  id: z.string(),
  label: z.string(),
  min: z.number().default(0),
  max: z.number().default(100),
  step: z.number().default(1),
  value: z.number(),
  unit: z.string().optional(),
  actionPayload: z.string(),
});

// --- 3. FORMULARZE & WPROWADZANIE DANYCH (FORMS & INPUTS) ---
export const FormFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "password", "select", "checkbox", "textarea"]),
  defaultValue: z.any().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
});

export const InteractiveFormSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  submitLabel: z.string().default("Zatwierdź"),
  actionType: z.enum(["terminal_exec", "svl_calibrate", "codex_auth", "agent_memory", "custom"]),
  fields: z.array(FormFieldSchema),
});

// --- 4. TABELE & DANE (TABLES & DATA) ---
export const DataTableSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))),
  searchable: z.boolean().optional(),
  maxRows: z.number().optional(),
});

export const ProcessListSchema = z.object({
  title: z.string().default("Lista Procesów Linux"),
  processes: z.array(
    z.object({
      pid: z.number(),
      user: z.string(),
      cpu: z.string().optional(),
      mem: z.string().optional(),
      command: z.string(),
    })
  ),
});

export const SqliteQueryTableSchema = z.object({
  tableName: z.string(),
  columns: z.array(z.string()),
  records: z.array(z.record(z.string(), z.any())),
  totalCount: z.number().optional(),
});

// --- 5. MONITORY SYSTEMU & STATUSY (SYSTEM MONITORS) ---
export const SystemTelemetrySchema = z.object({
  cpu_percent: z.number().optional(),
  ram_used_mb: z.number().optional(),
  ram_total_mb: z.number().optional(),
  disk_used_gb: z.number().optional(),
  disk_total_gb: z.number().optional(),
  ollama_status: z.string().optional(),
  ollama_model: z.string().optional(),
  active_agent: z.string().optional(),
  svl_version: z.string().optional(),
  kernel_version: z.string().optional(),
  system_load: z.string().optional(),
  loadavg: z.array(z.string()).optional(),
  uptime: z.string().optional(),
});

export const AgentStatusBadgeSchema = z.object({
  agentId: z.enum(["aria", "alex", "astyria", "aurelius", "council"]),
  name: z.string(),
  role: z.string(),
  status: z.enum(["active", "idle", "busy", "error", "root_online"]),
  uid: z.number(),
  gid: z.number(),
  metric_c: z.number().optional(),
  pid: z.number().optional(),
});

export const ServiceStatusCardSchema = z.object({
  serviceName: z.string(),
  status: z.enum(["running", "stopped", "failed", "restarting"]),
  uptime: z.string().optional(),
  endpoint: z.string().optional(),
  pid: z.number().optional(),
  details: z.string().optional(),
});

// --- 6. DIAGRAMY & TOPOLOGIA (MERMAID & DIAGRAMS) ---
export const MermaidDiagramSchema = z.object({
  title: z.string().optional(),
  diagramType: z.enum([
    "flowchart",
    "sequence",
    "class",
    "state",
    "er",
    "journey",
    "gantt",
    "pie",
    "git",
    "generic",
  ]).default("generic"),
  code: z.string(),
});

export const TopologyNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  role: z.string().optional(),
  status: z.enum(["online", "standby", "offline", "root"]).default("online"),
  connections: z.array(z.string()).optional(),
});

export const TopologyGraphSchema = z.object({
  title: z.string(),
  nodes: z.array(TopologyNodeSchema),
});

// --- 7. TERMINALE & KOD (TERMINAL & CODE ARTIFACTS) ---
export const EmbeddedTerminalSchema = z.object({
  title: z.string().default("Terminal Wykonawczy"),
  command: z.string(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().default(0),
  mode: z.enum(["LINUX_ROOT", "PYTHON_ROOT", "AI_CLI", "BINARY_ELF", "AGENT_USER"]).default("LINUX_ROOT"),
  executable: z.boolean().default(true),
});

export const CodeSandboxSchema = z.object({
  title: z.string(),
  language: z.string().default("python"),
  code: z.string(),
  output: z.string().optional(),
  runnable: z.boolean().default(true),
});

export const DiffViewerSchema = z.object({
  filename: z.string(),
  oldCode: z.string(),
  newCode: z.string(),
});

// --- 8. PLIKI & DOKUMENTY (FILES & MEDIA) ---
export const FilePreviewSchema = z.object({
  filename: z.string(),
  filesize: z.string().optional(),
  filetype: z.string().optional(),
  content: z.string().optional(),
  isBinary: z.boolean().optional(),
  downloadUrl: z.string().optional(),
});

export const HexDumpSchema = z.object({
  target: z.string(),
  sizeBytes: z.number(),
  dumpLines: z.array(
    z.object({
      offset: z.string(),
      hex: z.string(),
      ascii: z.string(),
    })
  ),
});

export const ImageViewerSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  base64: z.string().optional(),
  caption: z.string().optional(),
  dimensions: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  source: z.string().optional(),
  mimeType: z.string().optional(),
  durationMs: z.number().optional(),
  createdAt: z.string().optional(),
  error: z.string().optional(),
});

// --- 9. MAPY & PRZESTRZEŃ 3D (3D SPATIAL & SOLAR) ---
export const SolarOrbitCardSchema = z.object({
  bodyName: z.string(),
  distanceAu: z.number(),
  orbitalPeriodDays: z.number(),
  fleetUnits: z.number().default(0),
  status: z.string().default("ORBIT_STABLE"),
});

export const FleetCoordinatesSchema = z.object({
  vesselName: z.string(),
  sector: z.string(),
  coordinates: z.tuple([z.number(), z.number(), z.number()]),
  integrityPct: z.number(),
  leadAgent: z.string(),
});

// --- 10. ALERTY, POWIADOMIENIA & PASKI POSTĘPU (ALERTS & WIZARDS) ---
export const AlertBannerSchema = z.object({
  type: z.enum(["info", "success", "warning", "danger"]),
  title: z.string(),
  message: z.string(),
  actionLabel: z.string().optional(),
  actionPayload: z.string().optional(),
});

export const ProgressBarSchema = z.object({
  label: z.string(),
  value: z.number(), // 0 - 100
  total: z.number().default(100),
  unit: z.string().optional(),
  variant: z.enum(["violet", "emerald", "cyan", "amber", "rose"]).default("violet"),
});

export const StepWizardSchema = z.object({
  title: z.string(),
  currentStep: z.number(),
  steps: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      status: z.enum(["completed", "current", "upcoming", "failed"]),
      details: z.string().optional(),
    })
  ),
});

// --- MASTER COMPONENT WRAPPER SCHEMA ---
export const GenerativeComponentPayloadSchema = z.object({
  id: z.string(),
  type: z.string(),
  props: z.record(z.string(), z.any()),
  title: z.string().optional(),
});

export type GenerativeComponentPayload = z.infer<
  typeof GenerativeComponentPayloadSchema
>;
