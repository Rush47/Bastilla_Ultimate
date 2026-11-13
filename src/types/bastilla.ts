import type { SVLKernelReport } from "../utils/svlKernel";

export type AgentId = "aria" | "alex" | "astyria" | "aurelius";

export interface LiveLinuxAgent {
  id: AgentId;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  pid: number;
  running: boolean;
  avatar_url?: string;
  worker_status: {
    agent?: string;
    display_name?: string;
    role?: string;
    operator?: string;
    svl_version?: string;
    svl_locked?: boolean;
    security_level?: string;
    compact_metric_c?: number;
    compact_domain?: [number, number];
    scope_geometry?: string;
    linux_user?: string;
    uid?: number;
    gid?: number;
    pid?: number;
    home_dir?: string;
    state?: string;
    cycle?: number;
    loadavg?: string[];
    last_heartbeat?: string;
  };
}

export interface ToolVerification {
  installed: boolean;
  version: string;
  binary_path: string;
  elf_path?: string;
  auth_ready: boolean;
  requirement_note: string;
}

export interface AgentMemoryRecord {
  id: number;
  agent_id: string;
  category: string;
  content: string;
  importance: number;
  created_at: string;
}

export interface AgentIpcRecord {
  id: number;
  sender: string;
  recipient: string;
  subject: string;
  payload: string;
  status: string;
  created_at: string;
}

export interface TaskHistoryRecord {
  id: number;
  title: string;
  assigned_agent: string;
  terminal_type: string;
  command_or_prompt: string;
  output_summary: string;
  status: string;
  created_at: string;
}

export interface ToolExecutionOutcomeSummary {
  tool: string;
  source: "backend" | "mcp" | "image_engine" | "terminal" | "desktop";
  permission: "public_diag" | "operator_auth" | "mcp_token_required" | "privileged_exec";
  status: "executed" | "planned" | "unavailable" | "denied" | "error";
  summary: string;
  data: Record<string, any> | null;
  error?: string;
  executedAt: string;
  durationMs: number;
}

export interface AgentToolCatalogItem {
  name: string;
  description: string;
  source: "backend" | "mcp" | "image_engine" | "terminal" | "desktop";
  permission: "public_diag" | "operator_auth" | "mcp_token_required" | "privileged_exec";
  allowedAgents: string[];
  usableNow: boolean;
  availabilityNote: string;
}

export interface ChatMessageRecord {
  id: number;
  session_id: string;
  sender_role: "user" | "assistant";
  agent_id: string;
  engine_used: string;
  content: string;
  artifact_title?: string;
  artifact_code?: string;
  created_at: string;
  toolOutcomes?: ToolExecutionOutcomeSummary[];
}

export interface FleetUnitRecord {
  id: string;
  name: string;
  vessel_class: string;
  sector: string;
  orbit_target: string;
  commander_agent: string;
  hull_integrity: number;
  energy_output_gw: number;
  status: string;
  telemetry_json: string;
}

export interface MissionRecord {
  id: string;
  codename: string;
  target_body: string;
  lead_agent: string;
  vessel_id: string;
  phase: string;
  progress_pct: number;
  delta_v_kms: number;
  objective: string;
  updated_at: string;
}

export interface HypercommRelayRecord {
  id: string;
  relay_name: string;
  location_au: number;
  band_thz: number;
  entanglement_fidelity: number;
  latency_ms: number;
  status: string;
  last_packet: string;
}

export interface OllamaStatusData {
  state: "ONLINE" | "OFFLINE" | "MODEL LOADING" | "READY" | "BUSY" | "ERROR";
  reachable: boolean;
  endpoint: string;
  version: string;
  binaryPath: string;
  binaryType: "native-elf" | "python-http-wrapper" | "missing";
  daemonPid: number | null;
  models: Array<{
    name: string;
    sizeBytes: number;
    sizeGb: string;
    parameterSize: string;
    family: string;
    multimodal: boolean;
    uncensored: boolean;
  }>;
  modelNames: string[];
  runningModels: Array<{ name: string; sizeBytes: number; processor: string }>;
  activeRequests: number;
  isGeminiBridge: boolean;
  message: string;
  checkedAt: string;
}

export interface ImageEnginesStatusData {
  engineStatus: "READY" | "BRAK SILNIKA" | "ERROR";
  activeSource: "comfyui" | "local" | "gemini" | null;
  activeModel: string | null;
  engines: Record<
    "comfyui" | "local" | "gemini",
    {
      id: "comfyui" | "local" | "gemini";
      label: string;
      configured: boolean;
      reachable: boolean;
      model: string;
      endpoint?: string;
      error?: string;
    }
  >;
  message: string;
  checkedAt: string;
}

export interface GeneratedImageItem {
  id: string;
  prompt: string;
  mode: "generate" | "edit" | "variation";
  agent_id: string;
  model: string;
  source: string;
  mime_type: string;
  byte_size: number;
  duration_ms: number;
  status: "completed" | "failed";
  error: string;
  created_at: string;
  url?: string;
}

export interface DesktopWindowInfo {
  id: string;
  desktop: string;
  pid: number | null;
  title: string;
}

export interface DesktopAuditEntry {
  id: string;
  timestamp: string;
  agentId: string;
  tool: string;
  args: Record<string, any>;
  ok: boolean;
  summary: string;
}

export interface DesktopStatusReport {
  display: string | null;
  wayland: boolean;
  x11SessionActive: boolean;
  x11CaptureAvailable: boolean;
  xauthorityPath: string | null;
  displayAccessError: string | null;
  resolution: { width: number; height: number } | null;
  activeWindow: string | null;
  tools: {
    import: boolean;
    xdotool: boolean;
    wmctrl: boolean;
    xprop: boolean;
    xdpyinfo: boolean;
    xvfb: boolean;
    x11vnc: boolean;
    novnc: boolean;
  };
  sessionIsolated: boolean;
  sessionId: string | null;
  vncRunning: boolean;
  vncPort: number | null;
  novncUrl: string | null;
  aiControlEnabled: boolean;
  activeAgent: string | null;
  lastCaptureAt: string | null;
  lastCaptureSessionId: string | null;
  auditLog: DesktopAuditEntry[];
  checkedAt: string;
}

export interface SphericalStreamResult<T = unknown> {
  stream: string;
  ok: boolean;
  latencyMs: number;
  data?: T;
  error?: string;
}

export interface SphericalContextSnapshot {
  collectedAt: string;
  concurrencyCap: number;
  memAvailableMb: number;
  degradedStreams: string[];
  streams: Record<string, SphericalStreamResult>;
}

export interface SystemOverviewResponse {
  ok: boolean;
  svl_report: SVLKernelReport;
  host: {
    legacy_records_unverified?: boolean;
    operator_avatar_url?: string;
    os_release: Record<string, string>;
    uname: string;
    loadavg: string[];
    uptime_sec: number;
    meminfo: {
      total: string;
      available: string;
      free: string;
    };
    disk: {
      size: string;
      used: string;
      avail: string;
      use_pct: string;
    };
    agents_live: LiveLinuxAgent[];
    tools: Record<string, ToolVerification>;
    db: {
      memories: AgentMemoryRecord[];
      ipc: AgentIpcRecord[];
      tasks: TaskHistoryRecord[];
      fleet: FleetUnitRecord[];
      missions: MissionRecord[];
      hypercomm: HypercommRelayRecord[];
      chats: ChatMessageRecord[];
    };
    distro_files: string[];
  };
  ai_routing: {
    default_model?: string;
    primary_model: string;
    available_models: string[];
    ollama_online: boolean;
    ollama_state?: OllamaStatusData["state"];
    fallback_model: string;
    gemini_configured: boolean;
    active_engine: string;
  };
  ollama_status?: OllamaStatusData;
  image_status?: ImageEnginesStatusData;
  images?: GeneratedImageItem[];
  desktop_status?: DesktopStatusReport;
  spherical_context?: SphericalContextSnapshot;
  app_url: string;
}

export type WorkspaceTab =
  | "control"
  | "desktop"
  | "chat"
  | "terminals"
  | "agents"
  | "space3d"
  | "diagnostics";
