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

export interface SystemOverviewResponse {
  ok: boolean;
  svl_report: SVLKernelReport;
  host: {
    legacy_records_unverified?: boolean;
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
    primary_model: string;
    available_models: string[];
    ollama_online: boolean;
    fallback_model: string;
    gemini_configured: boolean;
    active_engine: string;
  };
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
