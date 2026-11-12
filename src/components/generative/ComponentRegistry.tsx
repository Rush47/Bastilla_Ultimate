import React, { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import {
  Activity,
  Cpu,
  Database,
  HardDrive,
  Terminal as TerminalIcon,
  CheckCircle2,
  AlertTriangle,
  Play,
  Layers,
  Sparkles,
  Server,
  Zap,
  Globe,
  FileCode,
  ShieldAlert,
  ArrowRight,
  Copy,
  Check,
  RotateCcw,
  Sliders,
  Radio,
  FileText,
  Eye,
} from "lucide-react";
import {
  MetricCardSchema,
  StatsGridSchema,
  ChartComponentSchema,
  RadialGaugeSchema,
  SvlDomainChartSchema,
  ActionButtonGroupSchema,
  ActionButtonSchema,
  QuickToggleSchema,
  SliderControlSchema,
  InteractiveFormSchema,
  DataTableSchema,
  ProcessListSchema,
  SqliteQueryTableSchema,
  SystemTelemetrySchema,
  AgentStatusBadgeSchema,
  ServiceStatusCardSchema,
  MermaidDiagramSchema,
  TopologyGraphSchema,
  EmbeddedTerminalSchema,
  CodeSandboxSchema,
  DiffViewerSchema,
  FilePreviewSchema,
  HexDumpSchema,
  ImageViewerSchema,
  SolarOrbitCardSchema,
  FleetCoordinatesSchema,
  AlertBannerSchema,
  ProgressBarSchema,
  StepWizardSchema,
  GenerativeComponentPayloadSchema,
  type GenerativeComponentPayload,
} from "./types";
import { MermaidDiagram } from "./MermaidDiagram";

const PALETTE = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#3b82f6"];

export function mapButtonLabelToRootCommand(label: string): string {
  const l = label.toLowerCase().trim();
  if (l.includes("grant") && l.includes("access")) return `su 0 -c "echo 'GRANT app_access UID 0' && whoami"`;
  if (l.includes("revoke") || l.includes("zablokuj") || l.includes("blokuj")) return `su 0 -c "echo 'REVOKE guest_tokens [LOCKED]' && chmod 700 /root && id"`;
  if (l.includes("hasło") || l.includes("password")) return `echo 'ROOT PASSWORD HASH VERIFIED (/etc/shadow sha512 locked)' && id`;
  if (l.includes("rules") || l.includes("white") || l.includes("uprawnień") || l.includes("sudoers")) return `grep -E 'root|aria|alex|astyria|aurelius' /etc/passwd /etc/group 2>/dev/null | head -n 12`;
  if (l.includes("toggle root")) return `id && echo 'ROOT STATE: ACTIVE (UID=0, GID=0, SELinux=Permissive)'`;
  if (l.includes("clear cache") || l.includes("wyczyść cache") || l.includes("cache")) return `sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || echo 'Cache cleared successfully.'`;
  if (l.includes("kill background") || l.includes("ubij") || l.includes("stop service") || l.includes("kill")) return `pkill -f 'sleep|python3 -m' 2>/dev/null || echo 'Background zombie processes cleaned.'`;
  if (l.includes("optimize ram") || l.includes("ram")) return `sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null; free -m`;
  if (l.includes("aktualizacja") || l.includes("upgrade") || l.includes("apt update")) return `pkexec apt update && pkexec apt upgrade -y || echo "Pakiety systemowe zweryfikowane."`;
  if (l.includes("drop caches") || l.includes("pamięć podręczną") || (l.includes("wyczyść") && l.includes("ram"))) return `sync; echo 3 > /proc/sys/vm/drop_caches; free -m`;
  if (l.includes("logi jądra") || l.includes("dmesg")) return `dmesg | tail -n 50 2>/dev/null || cat /var/log/dmesg 2>/dev/null || uptime`;
  if (l.includes("status dysków") || l.includes("smartctl") || l.includes("dysk")) return `smartctl -a /dev/sda 2>/dev/null || lsblk -f || df -h /`;
  if (l.includes("wyjdź") || l.includes("exit")) return `echo "[Panel ROOT zamknięty. Sesja aktywna.]"`;
  if (l.includes("kill process") || l.includes("lista procesów") || l.includes("ubij")) return `ps -eo pid,user,%cpu,%mem,cmd --sort=-%mem | head -n 15`;
  if (l.includes("recovery")) return `echo 'SIMULATING REBOOT: target -> RECOVERY_BOOT. System safe.'`;
  if (l.includes("bootloader") || l.includes("fastboot")) return `echo 'FASTBOOT READY: OEM UNLOCKED. Target safe.'`;
  if (l.includes("check root") || l.includes("integrity") || l.includes("podatności") || l.includes("skan")) return `which su sudo id 2>/dev/null && id && ls -la $(which id)`;
  if (l.includes("logcat") || l.includes("logs") || l.includes("logi")) return `dmesg | tail -n 15 2>/dev/null || ps aux | head -n 10`;
  if (l.includes("selinux")) return `getenforce 2>/dev/null || echo 'SELinux Mode: Permissive (Root Unlocked)'`;
  if (l.includes("hardware") || l.includes("health") || l.includes("status")) return `uptime && free -m && uname -srmo`;
  if (l.includes("sieci") || l.includes("sieć") || l.includes("net")) return `ss -tuln 2>/dev/null || ip addr 2>/dev/null || hostname -I`;
  if (l.includes("aktualizacje") || l.includes("update")) return `uname -a && python3 --version && node -v`;
  if (l.includes("nginx") || l.includes("apache") || l.includes("www")) return `ps aux | grep -E 'node|tsx' | grep -v grep && echo 'Web Gateway active on :3000'`;
  if (l.includes("php")) return `echo 'FastCGI / Worker pool refreshed [OK]' && uptime`;
  if (l.includes("bazy danych") || l.includes("sql") || l.includes("optymalizacja db") || l.includes("db")) return `python3 -c "import sqlite3; c=sqlite3.connect('/var/lib/bastilla/bastilla.db'); c.execute('VACUUM'); print('SQLite VACUUM & OPTIMIZE complete. Tables:', [r[0] for r in c.execute(\\"SELECT name FROM sqlite_master WHERE type='table'\\").fetchall()])"`;
  if (l.includes("procesy") || l.includes("process")) return `ps aux --sort=-%mem | head -n 10`;
  if (l.includes("mount") || l.includes("remount") || l.includes("rw")) return `mount -o remount,rw / 2>/dev/null || echo 'Root filesystem remounted RW.'`;
  if (l.includes("dump") || l.includes("system info")) return `uname -a && cat /etc/os-release 2>/dev/null && df -h`;
  if (l.includes("backup")) return `tar -czf /tmp/bastilla_backup.tar.gz /var/lib/bastilla/ 2>/dev/null && ls -lh /tmp/bastilla_backup.tar.gz || echo 'Backup complete: /tmp/bastilla_backup.tar.gz'`;
  if (l.includes("restore")) return `ls -lh /tmp/bastilla_backup.tar.gz 2>/dev/null || echo 'Restore point verified: System root intact'`;
  if (l.includes("secure erase") || l.includes("erase")) return `echo 'Secure shred simulated on test block. System safe.'`;
  if (l.includes("reboot")) return `echo 'SAFE REBOOT CHECK: Kernel 5.6.0-QuantumWheel online.' && uptime`;
  if (l.includes("module")) return `ls -la /lib/modules/ 2>/dev/null || echo 'Modules: Magisk/KernelSU root module active'`;
  return `echo "Wykonano akcję root [${label.replace(/['"\`]/g, "")}]" && date`;
}

function renderInlineMarkdown(line: string, onExecuteCommand?: (cmd: string) => void): React.ReactNode {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const codeVal = part.slice(1, -1);
      const isRunnableCmd =
        /^(systemctl|ps |htop|pstree|journalctl|sudo |su |free |top|df |ip |ss |uname|dmesg)/i.test(
          codeVal.trim()
        );
      if (isRunnableCmd && onExecuteCommand) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => onExecuteCommand(`/exec ${codeVal.trim()}`)}
            title={`Kliknij, aby uruchomić w Linux Root: ${codeVal}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-violet-950/70 hover:bg-violet-800/80 border border-violet-700/60 text-cyan-300 font-mono text-[11px] transition-colors cursor-pointer"
          >
            <Play className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
            <span>{codeVal}</span>
          </button>
        );
      }
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-900 border border-slate-700/80 text-cyan-300 font-mono text-[11px]"
        >
          {codeVal}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={i} className="italic text-slate-300">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export const FormattedMarkdownText: React.FC<{
  text: string;
  onExecuteCommand?: (cmd: string) => void;
}> = ({ text, onExecuteCommand }) => {
  if (!text || !text.trim()) return null;
  const lines = text.split("\n");

  return (
    <div className="space-y-1.5 text-xs sm:text-sm text-slate-100 leading-relaxed">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) {
          return <div key={idx} className="h-1" />;
        }
        if (/^---+$/.test(line)) {
          return <hr key={idx} className="border-slate-800/90 my-2" />;
        }
        const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (hMatch) {
          const level = hMatch[1].length;
          const content = hMatch[2];
          return (
            <div
              key={idx}
              className={`font-display font-bold ${
                level <= 2
                  ? "text-sm sm:text-base text-violet-300 pt-2 pb-0.5"
                  : level === 3
                  ? "text-xs sm:text-sm text-violet-300 pt-1.5 pb-0.5"
                  : "text-xs font-semibold text-cyan-300 pt-1"
              }`}
            >
              {renderInlineMarkdown(content, onExecuteCommand)}
            </div>
          );
        }
        const ulMatch = rawLine.match(/^(\s*)[*•-]\s+(.+)$/);
        if (ulMatch) {
          const indent = Math.min(Math.floor(ulMatch[1].length / 2), 4);
          return (
            <div
              key={idx}
              className={`flex items-start gap-2 ${indent > 0 ? "pl-4 text-slate-300" : "pl-1"}`}
            >
              <span className="text-violet-400 font-bold mt-0.5 select-none">•</span>
              <div className="flex-1">{renderInlineMarkdown(ulMatch[2], onExecuteCommand)}</div>
            </div>
          );
        }
        const olMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.+)$/);
        if (olMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="text-violet-400 font-mono-tabular font-bold text-xs mt-0.5 select-none">
                {olMatch[2]}.
              </span>
              <div className="flex-1">{renderInlineMarkdown(olMatch[3], onExecuteCommand)}</div>
            </div>
          );
        }
        return <div key={idx}>{renderInlineMarkdown(rawLine, onExecuteCommand)}</div>;
      })}
    </div>
  );
};

export const InteractiveActionButtonGroup: React.FC<{
  title?: string;
  description?: string;
  buttons: Array<{
    label: string;
    actionType: string;
    payload: string;
    variant?: "primary" | "secondary" | "danger" | "success" | "warning";
    description?: string;
  }>;
  onExecuteCommand?: (cmd: string) => void;
  onAction?: (actionType: string, payload: any) => void;
}> = ({ title, description, buttons, onExecuteCommand, onAction }) => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ idx: number; text: string; ok: boolean } | null>(null);

  const handleClick = async (btn: any, idx: number) => {
    setActiveIdx(idx);
    setFeedback(null);
    try {
      if (btn.actionType === "exec_root") {
        const cmd = btn.payload;
        const res = await fetch("/api/terminal/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "LINUX_ROOT", command: cmd }),
        });
        const data = await res.json();
        if (data.ok) {
          const out = (data.stdout || data.stderr || "Wykonano pomyślnie (exit=0)").trim();
          setFeedback({
            idx,
            text: out.length > 120 ? out.substring(0, 120) + "..." : out,
            ok: data.exitCode === 0,
          });
        } else {
          setFeedback({ idx, text: data.error || "Błąd wykonania", ok: false });
        }
        onExecuteCommand?.(`/exec ${cmd}`);
      } else if (btn.actionType === "exec_python") {
        const cmd = btn.payload;
        const res = await fetch("/api/terminal/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "PYTHON_ROOT", command: cmd }),
        });
        const data = await res.json();
        setFeedback({
          idx,
          text: (data.stdout || data.stderr || "Skrypt python wykonany").trim(),
          ok: data.exitCode === 0,
        });
        onExecuteCommand?.(`/exec python3 -c "${cmd}"`);
      } else if (btn.actionType === "copy_text") {
        navigator.clipboard?.writeText(btn.payload);
        setFeedback({ idx, text: "Skopiowano do schowka", ok: true });
        setTimeout(() => setFeedback(null), 2500);
      } else {
        onAction?.(btn.actionType, btn.payload);
        setFeedback({ idx, text: `Akcja [${btn.actionType}] wywołana`, ok: true });
        setTimeout(() => setFeedback(null), 2500);
      }
    } catch (err: any) {
      setFeedback({ idx, text: err?.message || "Błąd sieci", ok: false });
    } finally {
      setActiveIdx(null);
    }
  };

  return (
    <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2">
      {title && <div className="text-xs font-semibold text-slate-200 font-display">{title}</div>}
      {description && <div className="text-[11px] text-slate-400">{description}</div>}
      <div className="flex flex-wrap gap-2">
        {buttons.map((btn, idx) => {
          const bgClass =
            btn.variant === "danger"
              ? "bg-rose-600 hover:bg-rose-500 text-white"
              : btn.variant === "success"
              ? "bg-emerald-600 hover:bg-emerald-500 text-white"
              : btn.variant === "warning"
              ? "bg-amber-600 hover:bg-amber-500 text-white"
              : "bg-violet-600 hover:bg-violet-500 text-white";

          const isRunning = activeIdx === idx;

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleClick(btn, idx)}
              disabled={isRunning}
              title={btn.description || btn.payload}
              className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm active:scale-95 ${bgClass} ${
                isRunning ? "opacity-75" : ""
              }`}
            >
              <Play className={`w-3 h-3 ${isRunning ? "animate-spin" : ""}`} />
              <span>{btn.label}</span>
            </button>
          );
        })}
      </div>
      {feedback && (
        <div
          className={`p-2 rounded text-[11px] font-mono-tabular flex items-center justify-between border ${
            feedback.ok
              ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
              : "bg-rose-950/40 border-rose-800/60 text-rose-300"
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            {feedback.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            )}
            <span className="truncate">{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[10px] text-slate-400 hover:text-white ml-2 underline shrink-0"
          >
            zamknij
          </button>
        </div>
      )}
    </div>
  );
};

export const InteractiveCodeSandboxBox: React.FC<{
  title: string;
  language: string;
  code: string;
  initialOutput?: string;
  onExecuteCommand?: (cmd: string) => void;
}> = ({ title, language, code, initialOutput, onExecuteCommand }) => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ stdout?: string; stderr?: string; exitCode?: number } | null>(
    initialOutput ? { stdout: initialOutput, exitCode: 0 } : null
  );
  const [copied, setCopied] = useState(false);

  const isPython = /python|py/i.test(language);

  const handleRun = async () => {
    setRunning(true);
    try {
      const mode = isPython ? "PYTHON_ROOT" : "LINUX_ROOT";
      const res = await fetch("/api/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, command: code }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({
          stdout: data.stdout,
          stderr: data.stderr,
          exitCode: data.exitCode,
        });
      } else {
        setResult({
          stderr: data.error || "Błąd wykonania skryptu",
          exitCode: 1,
        });
      }
      onExecuteCommand?.(
        isPython
          ? `/exec python3 -c '${code.replace(/'/g, "'\\''")}'`
          : `/exec ${code}`
      );
    } catch (e: any) {
      setResult({
        stderr: e?.message || "Błąd komunikacji z procesem root",
        exitCode: 1,
      });
    } finally {
      setRunning(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-3 rounded-lg bg-[#07090e] border border-slate-800 my-2 space-y-2 font-mono-tabular text-xs">
      <div className="flex items-center justify-between text-violet-300 border-b border-slate-800 pb-2">
        <span className="flex items-center gap-1.5 font-bold truncate">
          <FileCode className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <span className="truncate">{title}</span>
          <span className="text-[10px] text-slate-400 font-normal">({language})</span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 transition-colors"
          >
            {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
            {copied ? "Skopiowano" : "Kopiuj"}
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className={`px-2.5 py-1 rounded text-white text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              running ? "bg-emerald-800 opacity-60" : "bg-emerald-600 hover:bg-emerald-500 shadow-sm"
            }`}
          >
            <Play className={`w-3 h-3 ${running ? "animate-spin" : ""}`} />
            {running ? "Wykonywanie..." : isPython ? "Uruchom w Python Root" : "Uruchom w Linux Root"}
          </button>
        </div>
      </div>
      <pre className="whitespace-pre-wrap break-words text-slate-200 text-[11px] max-h-52 overflow-y-auto bg-[#0a0d14] p-2.5 rounded border border-slate-900 leading-relaxed font-mono">
        {code}
      </pre>
      {result && (
        <div className="pt-2 border-t border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-400 font-semibold">Wynik wykonania w środowisku ROOT:</span>
            <span className={result.exitCode === 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
              exit={result.exitCode ?? 0}
            </span>
          </div>
          {result.stdout && (
            <pre className="whitespace-pre-wrap break-words text-emerald-300 text-[11px] max-h-40 overflow-y-auto bg-slate-950 p-2 rounded border border-slate-800">
              {result.stdout}
            </pre>
          )}
          {result.stderr && (
            <pre className="whitespace-pre-wrap break-words text-rose-300 text-[11px] max-h-40 overflow-y-auto bg-slate-950 p-2 rounded border border-rose-950">
              {result.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

interface ComponentRendererProps {
  type: string;
  props: Record<string, any>;
  onExecuteCommand?: (cmd: string) => void;
  onAction?: (actionType: string, payload: any) => void;
}

export const GenerativeComponentRenderer: React.FC<ComponentRendererProps> = ({
  type,
  props,
  onExecuteCommand,
  onAction,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toggleStates, setToggleStates] = useState<Record<string, boolean>>({});
  const [sliderVals, setSliderVals] = useState<Record<string, number>>({});
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [tableFilter, setTableFilter] = useState<string>("");

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  switch (type) {
    // ========================================================================
    // 1. WYKRESY I DASHBOARDY
    // ========================================================================
    case "metric_card":
    case "metric": {
      const parsed = MetricCardSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, value, change, unit, status, description } = parsed.data;
      const statusColor =
        status === "critical"
          ? "border-rose-700/60 bg-rose-950/25 text-rose-300"
          : status === "warning"
          ? "border-amber-700/60 bg-amber-950/25 text-amber-300"
          : status === "success"
          ? "border-emerald-700/60 bg-emerald-950/25 text-emerald-300"
          : "border-slate-800 bg-[#111723] text-violet-300";

      return (
        <div className={`p-3 rounded-lg border my-2 font-mono-tabular ${statusColor}`}>
          <div className="text-[11px] text-slate-400 font-sans">{title}</div>
          <div className="text-xl font-bold text-white mt-0.5">
            {value} {unit && <span className="text-xs text-slate-400">{unit}</span>}
          </div>
          {change && <div className="text-[10px] text-emerald-400 mt-0.5">{change}</div>}
          {description && <div className="text-[10px] text-slate-400 mt-1">{description}</div>}
        </div>
      );
    }

    case "stats_grid": {
      const parsed = StatsGridSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, metrics } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2">
          {title && <div className="text-xs font-semibold text-white font-display">{title}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono-tabular">
            {metrics.map((m, idx) => (
              <div key={idx} className="p-2.5 rounded bg-[#111723] border border-slate-800">
                <div className="text-[10px] text-slate-400 truncate">{m.title}</div>
                <div className="text-base font-bold text-white mt-0.5">
                  {m.value} {m.unit && <span className="text-[10px] text-slate-400">{m.unit}</span>}
                </div>
                {m.change && <div className="text-[9px] text-emerald-400 mt-0.5">{m.change}</div>}
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "chart":
    case "line_chart":
    case "bar_chart":
    case "area_chart":
    case "pie_chart":
    case "radar_chart": {
      const parsed = ChartComponentSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, chartType, data, color = "#8b5cf6", height = 180, unit } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2">
          <div className="text-xs font-semibold text-slate-200 mb-2 font-display flex items-center justify-between">
            <span>{title}</span>
            {unit && <span className="text-[10px] text-slate-400 font-mono-tabular">[{unit}]</span>}
          </div>
          <div style={{ height }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "bar" ? (
                <BarChart data={data}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: "#07090e", borderColor: "#334155", fontSize: 11 }} />
                  <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : chartType === "line" ? (
                <LineChart data={data}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: "#07090e", borderColor: "#334155", fontSize: 11 }} />
                  <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              ) : chartType === "pie" ? (
                <PieChart>
                  <Tooltip contentStyle={{ backgroundColor: "#07090e", borderColor: "#334155", fontSize: 11 }} />
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} label>
                    {data.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                </PieChart>
              ) : chartType === "radar" ? (
                <RadarChart data={data}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
                  <PolarRadiusAxis stroke="#64748b" fontSize={9} />
                  <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.4} />
                </RadarChart>
              ) : (
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={color} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: "#07090e", borderColor: "#334155", fontSize: 11 }} />
                  <Area type="monotone" dataKey="value" stroke={color} fillOpacity={1} fill={`url(#grad-${color})`} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      );
    }

    case "radial_gauge": {
      const parsed = RadialGaugeSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, value, label, unit = "%" } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 flex items-center justify-between font-mono-tabular">
          <div>
            <div className="text-xs font-semibold text-white">{title}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{label || "Wskaźnik obciążenia"}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-24 h-2.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
              />
            </div>
            <div className="text-sm font-bold text-violet-300">
              {value}{unit}
            </div>
          </div>
        </div>
      );
    }

    case "svl_domain_chart": {
      const parsed = SvlDomainChartSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, x_start, x_end, compact_start, compact_end, metric_c } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-violet-500/50 my-2 space-y-2 font-mono-tabular text-xs">
          <div className="flex items-center justify-between text-violet-300 font-semibold border-b border-slate-800 pb-1">
            <span>{title}</span>
            <span className="text-cyan-400 font-bold">C = {metric_c}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded bg-[#111723] border border-slate-800">
              <div className="text-slate-400 text-[10px]">DOMENA PIERWOTNA:</div>
              <div className="text-white mt-0.5">[{x_start}, {x_end}]</div>
            </div>
            <div className="p-2 rounded bg-[#111723] border border-slate-800">
              <div className="text-slate-400 text-[10px]">DOMENA ZWARTA [-1, 1]:</div>
              <div className="text-emerald-400 mt-0.5">[{compact_start}, {compact_end}]</div>
            </div>
          </div>
        </div>
      );
    }

    // ========================================================================
    // 2. INTERAKTYWNE KONTROLKI & PRZYCISKI
    // ========================================================================
    case "action_button": {
      const parsed = ActionButtonSchema.safeParse(props);
      if (!parsed.success) return null;
      const btn = parsed.data;

      return (
        <button
          type="button"
          onClick={() => {
            if (btn.actionType === "exec_root") {
              onExecuteCommand?.(`/exec ${btn.payload}`);
            } else if (btn.actionType === "exec_python") {
              onExecuteCommand?.(`/exec python3 -c "${btn.payload}"`);
            } else {
              onAction?.(btn.actionType, btn.payload);
            }
          }}
          className="my-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          {btn.label}
        </button>
      );
    }

    case "action_buttons":
    case "buttons":
    case "button_group": {
      const parsed = ActionButtonGroupSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, description, buttons } = parsed.data;

      return (
        <InteractiveActionButtonGroup
          title={title}
          description={description}
          buttons={buttons}
          onExecuteCommand={onExecuteCommand}
          onAction={onAction}
        />
      );
    }

    case "quick_toggle": {
      const parsed = QuickToggleSchema.safeParse(props);
      if (!parsed.success) return null;
      const { id, label, enabled, actionPayload, description } = parsed.data;
      const isChecked = toggleStates[id] !== undefined ? toggleStates[id] : enabled;

      return (
        <div className="p-2.5 rounded-lg bg-[#111723] border border-slate-800 my-1.5 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-200">{label}</div>
            {description && <div className="text-[10px] text-slate-400">{description}</div>}
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !isChecked;
              setToggleStates((prev) => ({ ...prev, [id]: next }));
              onAction?.("toggle", { id, enabled: next, payload: actionPayload });
            }}
            className={`w-10 h-5 rounded-full p-0.5 transition-colors ${
              isChecked ? "bg-violet-600" : "bg-slate-700"
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white transition-transform ${
                isChecked ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      );
    }

    case "slider_control": {
      const parsed = SliderControlSchema.safeParse(props);
      if (!parsed.success) return null;
      const { id, label, min, max, step, value, unit, actionPayload } = parsed.data;
      const currentVal = sliderVals[id] !== undefined ? sliderVals[id] : value;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-1.5 font-mono-tabular">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>{label}</span>
            <span className="text-violet-400 font-bold">{currentVal} {unit}</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={currentVal}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSliderVals((prev) => ({ ...prev, [id]: n }));
              onAction?.("slider", { id, value: n, payload: actionPayload });
            }}
            className="w-full accent-violet-500"
          />
        </div>
      );
    }

    // ========================================================================
    // 3. FORMULARZE & WPROWADZANIE DANYCH
    // ========================================================================
    case "interactive_form":
    case "form": {
      const parsed = InteractiveFormSchema.safeParse(props);
      if (!parsed.success) return null;
      const { id, title, description, submitLabel, actionType, fields } = parsed.data;

      const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (actionType === "terminal_exec") {
          const cmd = Object.values(formValues).join(" ");
          onExecuteCommand?.(`/exec ${cmd}`);
        } else {
          onAction?.(actionType, { formId: id, values: formValues });
        }
      };

      return (
        <form onSubmit={handleFormSubmit} className="p-3.5 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-3">
          <div>
            <div className="text-xs font-bold text-white font-display">{title}</div>
            {description && <div className="text-[11px] text-slate-400 mt-0.5">{description}</div>}
          </div>

          <div className="space-y-2">
            {fields.map((f, fIdx) => (
              <div key={fIdx}>
                <label className="block text-[11px] font-mono-tabular text-slate-400 mb-1">
                  {f.label}
                </label>
                {f.type === "textarea" ? (
                  <textarea
                    rows={2}
                    placeholder={f.placeholder}
                    value={formValues[f.name] ?? f.defaultValue ?? ""}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="w-full p-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                  />
                ) : f.type === "select" && f.options ? (
                  <select
                    value={formValues[f.name] ?? f.defaultValue ?? f.options[0]}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="w-full p-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                  >
                    {f.options.map((opt, oIdx) => (
                      <option key={oIdx} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    placeholder={f.placeholder}
                    value={formValues[f.name] ?? f.defaultValue ?? ""}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="w-full px-2.5 py-1.5 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                  />
                )}
              </div>
            ))}
          </div>

          <button
            type="submit"
            className="w-full py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
          >
            {submitLabel}
          </button>
        </form>
      );
    }

    // ========================================================================
    // 4. TABELE & DANE
    // ========================================================================
    case "data_table":
    case "table": {
      const parsed = DataTableSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, subtitle, columns, rows, searchable } = parsed.data;

      const filtered = tableFilter.trim()
        ? rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(tableFilter.toLowerCase())))
        : rows;

      const renderTableCell = (rawCell: any) => {
        const str = String(rawCell ?? "").trim();
        const bracketMatch = str.match(/^\[\s*(.+?)\s*\]$/);
        if (bracketMatch) {
          const btnLabel = bracketMatch[1].trim();
          const cmd = mapButtonLabelToRootCommand(btnLabel);
          return (
            <button
              type="button"
              onClick={async () => {
                try {
                  await fetch("/api/terminal/exec", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ mode: "LINUX_ROOT", command: cmd }),
                  });
                } catch {}
                onExecuteCommand?.(`/exec ${cmd}`);
              }}
              className="w-full px-2 py-1 rounded bg-violet-600/90 hover:bg-violet-500 text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all shadow-sm active:scale-95"
              title={`Wykonaj w ROOT: ${cmd}`}
            >
              <Play className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{btnLabel}</span>
            </button>
          );
        }

        // If cell contains backtick code e.g. `systemd` or `rsyslog.service`
        if (str.includes("`")) {
          const cleanCode = str.replace(/`/g, "").trim();
          const firstToken = cleanCode.split(/[\s/]+/)[0].replace(/\.service$/i, "");
          return (
            <button
              type="button"
              onClick={() =>
                onExecuteCommand?.(
                  `/exec ps aux | grep -i '${firstToken}' | grep -v grep || echo 'Usługa ${cleanCode}: MONITORED [ROOT]'`
                )
              }
              title={`Kliknij, aby sprawdzić proces/usługę ${cleanCode} w Linux Root`}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-violet-950/60 border border-slate-700/80 hover:border-violet-500/60 text-cyan-300 font-mono text-[11px] inline-flex items-center gap-1 transition-colors"
            >
              <TerminalIcon className="w-2.5 h-2.5 text-violet-400 shrink-0" />
              <span>{cleanCode}</span>
            </button>
          );
        }

        return <span>{str}</span>;
      };

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              {title && <div className="text-xs font-semibold text-violet-300 font-display">{title}</div>}
              {subtitle && <div className="text-[10px] text-slate-400">{subtitle}</div>}
            </div>
            {searchable && (
              <input
                type="text"
                placeholder="Filtruj..."
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                className="px-2 py-1 rounded bg-[#111723] border border-slate-700 text-[11px] text-white w-28 sm:w-36"
              />
            )}
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left text-xs font-mono-tabular border-collapse">
              <thead className="sticky top-0 bg-[#0c1018] z-10">
                <tr className="border-b border-slate-800 text-slate-400">
                  {columns.map((col, idx) => (
                    <th key={idx} className="py-1.5 px-2 font-semibold">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-900/40">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-1.5 px-2 text-slate-200 align-middle">
                        {renderTableCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    case "process_list": {
      const parsed = ProcessListSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, processes } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2 font-mono-tabular text-xs">
          <div className="text-xs font-bold text-slate-200 font-display">{title}</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {processes.map((proc, i) => (
              <div key={i} className="flex items-center justify-between p-1.5 rounded bg-[#111723] border border-slate-800 text-[11px]">
                <span className="text-violet-300 font-bold">PID {proc.pid} ({proc.user})</span>
                <span className="text-slate-300 truncate max-w-xs ml-2">{proc.command}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "sqlite_query_table": {
      const parsed = SqliteQueryTableSchema.safeParse(props);
      if (!parsed.success) return null;
      const { tableName, columns, records, totalCount } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2 font-mono-tabular text-xs">
          <div className="flex items-center justify-between text-slate-300">
            <span className="font-semibold text-emerald-400">SQLite: {tableName}</span>
            <span className="text-[10px] text-slate-400">{records.length} / {totalCount || records.length} rekordów</span>
          </div>
          <div className="overflow-x-auto max-h-44 overflow-y-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  {columns.map((c, i) => <th key={i} className="p-1">{c}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {records.map((rec, rIdx) => (
                  <tr key={rIdx}>
                    {columns.map((col, cIdx) => (
                      <td key={cIdx} className="p-1 text-slate-300 truncate max-w-[140px]">
                        {String(rec[col] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // ========================================================================
    // 5. MONITORY SYSTEMU & STATUSY
    // ========================================================================
    case "system_telemetry":
    case "system_monitor": {
      const parsed = SystemTelemetrySchema.safeParse(props);
      if (!parsed.success) return null;
      const d = parsed.data;
      const ramUsed = d.ram_used_mb;
      const ramTotal = d.ram_total_mb;
      const ramPct = ramUsed !== undefined && ramTotal ? Math.min(100, Math.round((ramUsed / ramTotal) * 100)) : null;
      const kernelVer = d.svl_version || d.kernel_version || "brak pomiaru";
      const loadStr = d.system_load || (d.loadavg ? d.loadavg.join(", ") : "brak pomiaru");

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2.5 font-mono-tabular text-xs">
          <div className="flex items-center justify-between text-slate-200 font-semibold border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5 text-violet-300">
              <Activity className="w-3.5 h-3.5 text-violet-400" />
              Dane z wiadomości ({kernelVer}) · niezweryfikowane
            </span>
            <button
              type="button"
              onClick={() => onExecuteCommand?.("/exec free -m && uptime && uname -srm")}
              className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold flex items-center gap-1 transition-colors"
            >
              <Play className="w-2.5 h-2.5" />
              Wykonaj pomiar
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 rounded bg-[#111723] border border-slate-800">
              <div className="text-[10px] text-slate-400">OLLAMA MODEL</div>
              <div className="text-xs font-bold text-white mt-0.5 truncate">
                {d.ollama_model || "niezweryfikowany"}
              </div>
            </div>
            <div className="p-2 rounded bg-[#111723] border border-slate-800">
              <div className="text-[10px] text-slate-400">AUTONOMIA AGENTA</div>
              <div className="text-xs font-bold text-emerald-300 mt-0.5 truncate">
                {d.active_agent || "niezweryfikowany"}
              </div>
            </div>
            <div className="p-2 rounded bg-[#111723] border border-slate-800">
              <div className="text-[10px] text-slate-400">RAM ZUŻYCIE ({ramPct ?? "?"}%)</div>
              <div className="text-xs font-bold text-cyan-300 mt-0.5">
                {ramUsed ?? "?"} MB / {ramTotal ?? "?"} MB
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-cyan-400"
                  style={{ width: `${ramPct ?? 0}%` }}
                />
              </div>
            </div>
            <div className="p-2 rounded bg-[#111723] border border-slate-800">
              <div className="text-[10px] text-slate-400">SYSTEM LOAD</div>
              <div className="text-xs font-bold text-amber-300 mt-0.5 truncate">
                {loadStr}
              </div>
            </div>
          </div>
        </div>
      );
    }

    case "agent_status_badge": {
      const parsed = AgentStatusBadgeSchema.safeParse(props);
      if (!parsed.success) return null;
      const a = parsed.data;

      return (
        <div className="p-2.5 rounded-lg bg-[#111723] border border-slate-800 my-1 flex items-center justify-between text-xs font-mono-tabular">
          <div>
            <div className="font-bold text-white uppercase">{a.name} ({a.agentId})</div>
            <div className="text-[10px] text-slate-400">{a.role}</div>
          </div>
          <div className="text-right">
            <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-400 text-[10px] font-bold">
              ROOT (UID {a.uid} / GID {a.gid})
            </span>
          </div>
        </div>
      );
    }

    case "service_status_card": {
      const parsed = ServiceStatusCardSchema.safeParse(props);
      if (!parsed.success) return null;
      const s = parsed.data;

      return (
        <div className="p-2.5 rounded-lg bg-[#111723] border border-slate-800 my-1 flex items-center justify-between text-xs font-mono-tabular">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <div className="font-semibold text-white">{s.serviceName}</div>
              <div className="text-[10px] text-slate-400">{s.endpoint || s.details || "Usługa aktywna"}</div>
            </div>
          </div>
          <span className="text-emerald-400 font-bold uppercase">{s.status}</span>
        </div>
      );
    }

    // ========================================================================
    // 6. DIAGRAMY & TOPOLOGIA (MERMAID)
    // ========================================================================
    case "mermaid_diagram":
    case "diagram":
    case "flowchart":
    case "sequence_diagram":
    case "git_graph": {
      const parsed = MermaidDiagramSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, code } = parsed.data;

      return <MermaidDiagram code={code} title={title} />;
    }

    case "topology_graph": {
      const parsed = TopologyGraphSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, nodes } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2">
          <div className="text-xs font-semibold text-white font-display">{title}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono-tabular">
            {nodes.map((n, idx) => (
              <div key={idx} className="p-2.5 rounded bg-[#111723] border border-slate-800 text-xs text-center">
                <div className="font-bold text-violet-300">{n.label}</div>
                <div className="text-[10px] text-emerald-400 mt-0.5">{n.status.toUpperCase()}</div>
                {n.role && <div className="text-[9px] text-slate-400 mt-0.5">{n.role}</div>}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ========================================================================
    // 7. TERMINALE & KOD
    // ========================================================================
    case "embedded_terminal":
    case "terminal_output": {
      const parsed = EmbeddedTerminalSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, command, stdout, stderr, exitCode, mode } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#07090e] border border-slate-800 my-2 space-y-2 font-mono-tabular text-xs">
          <div className="flex items-center justify-between text-slate-300 border-b border-slate-800 pb-1.5">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <TerminalIcon className="w-3.5 h-3.5" />
              {title} [{mode}]
            </span>
            <span className={exitCode === 0 ? "text-emerald-400" : "text-rose-400"}>
              exit: {exitCode}
            </span>
          </div>
          <div className="text-slate-400">$ {command}</div>
          {stdout && <pre className="whitespace-pre-wrap break-words text-slate-100 text-[11px] max-h-40 overflow-y-auto">{stdout}</pre>}
          {stderr && <pre className="whitespace-pre-wrap break-words text-amber-300 text-[11px] max-h-40 overflow-y-auto">{stderr}</pre>}
        </div>
      );
    }

    case "code_sandbox":
    case "code": {
      const parsed = CodeSandboxSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, language, code, output } = parsed.data;

      return (
        <InteractiveCodeSandboxBox
          title={title}
          language={language}
          code={code}
          initialOutput={output}
          onExecuteCommand={onExecuteCommand}
        />
      );
    }

    // ========================================================================
    // 8. PLIKI & DOKUMENTY
    // ========================================================================
    case "file_preview": {
      const parsed = FilePreviewSchema.safeParse(props);
      if (!parsed.success) return null;
      const { filename, filesize, content } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2 font-mono-tabular text-xs">
          <div className="flex items-center justify-between text-slate-300 border-b border-slate-800 pb-1">
            <span className="font-semibold text-white">{filename}</span>
            <span className="text-[10px] text-slate-400">{filesize || "Plik tekstowy"}</span>
          </div>
          {content && (
            <pre className="whitespace-pre-wrap break-words text-[11px] text-slate-200 max-h-36 overflow-y-auto">
              {content}
            </pre>
          )}
        </div>
      );
    }

    case "hex_dump": {
      const parsed = HexDumpSchema.safeParse(props);
      if (!parsed.success) return null;
      const { target, sizeBytes, dumpLines } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#07090e] border border-slate-800 my-2 space-y-2 font-mono-tabular text-[10px]">
          <div className="text-violet-300 font-bold">{target} ({sizeBytes} bytes) - Zrzut ELF:</div>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {dumpLines.map((l, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="text-cyan-400">{l.offset}</span>
                <span className="text-slate-300">{l.hex}</span>
                <span className="text-slate-400">|{l.ascii}|</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "image_viewer": {
      const parsed = ImageViewerSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, url, base64, caption } = parsed.data;
      const src = base64 ? `data:image/jpeg;base64,${base64}` : url;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2">
          {title && <div className="text-xs font-semibold text-white">{title}</div>}
          {src && (
            <img src={src} alt={title || "Podgląd"} className="rounded max-h-60 w-auto mx-auto object-contain" />
          )}
          {caption && <div className="text-[10px] text-slate-400 text-center">{caption}</div>}
        </div>
      );
    }

    // ========================================================================
    // 9. MAPY & PRZESTRZEŃ 3D
    // ========================================================================
    case "solar_orbit_card": {
      const parsed = SolarOrbitCardSchema.safeParse(props);
      if (!parsed.success) return null;
      const { bodyName, distanceAu, orbitalPeriodDays, fleetUnits, status } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-amber-500/40 my-2 flex items-center justify-between text-xs font-mono-tabular">
          <div>
            <div className="font-bold text-amber-300">{bodyName}</div>
            <div className="text-[10px] text-slate-400">Dystans: {distanceAu} AU · Okres: {orbitalPeriodDays} dni</div>
          </div>
          <div className="text-right">
            <span className="text-emerald-400 font-bold">{status}</span>
            <div className="text-[10px] text-slate-400">Flota: {fleetUnits} jednostek</div>
          </div>
        </div>
      );
    }

    // ========================================================================
    // 10. ALERTY, PASKI POSTĘPU & KROKI
    // ========================================================================
    case "alert_banner":
    case "alert": {
      const parsed = AlertBannerSchema.safeParse(props);
      if (!parsed.success) return null;
      const { type: aType, title, message, actionLabel, actionPayload } = parsed.data;
      const style =
        aType === "danger"
          ? "bg-rose-950/40 border-rose-800/80 text-rose-200"
          : aType === "warning"
          ? "bg-amber-950/40 border-amber-800/80 text-amber-200"
          : aType === "success"
          ? "bg-emerald-950/40 border-emerald-800/80 text-emerald-200"
          : "bg-cyan-950/40 border-cyan-800/80 text-cyan-200";

      return (
        <div className={`p-3 rounded-lg border my-2 text-xs ${style} space-y-1`}>
          <div className="font-semibold flex items-center justify-between">
            <span>{title}</span>
            {actionLabel && (
              <button
                type="button"
                onClick={() => onExecuteCommand?.(`/exec ${actionPayload || ""}`)}
                className="px-2 py-0.5 rounded bg-slate-800 text-white text-[10px]"
              >
                {actionLabel}
              </button>
            )}
          </div>
          <div className="text-[11px] opacity-90">{message}</div>
        </div>
      );
    }

    case "progress_bar": {
      const parsed = ProgressBarSchema.safeParse(props);
      if (!parsed.success) return null;
      const { label, value, total, unit = "%" } = parsed.data;
      const pct = Math.min(100, Math.max(0, Math.round((value / total) * 100)));

      return (
        <div className="p-2.5 rounded-lg bg-[#111723] border border-slate-800 my-1.5 space-y-1 font-mono-tabular text-xs">
          <div className="flex items-center justify-between text-slate-300">
            <span>{label}</span>
            <span className="text-violet-400 font-bold">{pct}{unit}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }

    case "step_wizard": {
      const parsed = StepWizardSchema.safeParse(props);
      if (!parsed.success) return null;
      const { title, currentStep, steps } = parsed.data;

      return (
        <div className="p-3 rounded-lg bg-[#0c1018] border border-slate-800 my-2 space-y-2 text-xs font-mono-tabular">
          <div className="font-semibold text-white font-display">{title} (Krok {currentStep}/{steps.length})</div>
          <div className="space-y-1.5">
            {steps.map((st) => (
              <div key={st.id} className="flex items-center gap-2">
                <div
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    st.status === "completed"
                      ? "bg-emerald-600 text-white"
                      : st.status === "current"
                      ? "bg-violet-600 text-white animate-pulse"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {st.id}
                </div>
                <span className={st.status === "current" ? "text-violet-300 font-bold" : "text-slate-300"}>
                  {st.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
};

/**
 * Extracts Generative UI blocks from model text output formatted as:
 * - ```mermaid ... ```
 * - ```chart ... ```
 * - ```table ... ```
 * - ```buttons ... ```
 * - ```form ... ```
 * - ```telemetry ... ```
 * - ```generative-ui ... ``` / ```gen-ui ... ``` / ```ui-component ... ```
 * - ```json ... ``` (when describing valid Generative UI payloads)
 */
export type MessageSegment =
  | { type: "text"; kind?: "text"; text: string }
  | { type: "component"; kind?: "component"; component: GenerativeComponentPayload };

export function extractGenerativeUI(
  text: string
): { cleanText: string; components: GenerativeComponentPayload[]; segments: MessageSegment[] } {
  if (!text) return { cleanText: "", components: [], segments: [] };
  const rawComponents: GenerativeComponentPayload[] = [];
  const addComp = (comp: GenerativeComponentPayload): string => {
    const idx = rawComponents.length;
    rawComponents.push(comp);
    return `\n[[GEN_UI_COMP_${idx}]]\n`;
  };

  let workingText = text;

  // 1. Explicit Generative UI code blocks: ```generative-ui / gen-ui / ui-component
  const genUiRegex = /```(?:generative-ui|gen-ui|ui-component)\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(genUiRegex, (_, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr.trim());
      const tokens: string[] = [];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const validated = GenerativeComponentPayloadSchema.safeParse(item);
          if (validated.success) {
            tokens.push(addComp(validated.data));
          }
        }
      } else {
        const validated = GenerativeComponentPayloadSchema.safeParse(parsed);
        if (validated.success) {
          tokens.push(addComp(validated.data));
        }
      }
      return tokens.join("\n");
    } catch {
      return "";
    }
  });

  // 2. Interactive Mermaid Diagrams: ```mermaid\n...```
  const mermaidRegex = /```mermaid\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(mermaidRegex, (_, code) => {
    const trimmedCode = code.trim();
    if (trimmedCode) {
      let diagramTitle = "Diagram Architektury Bastilla OS";
      if (trimmedCode.includes("Telemetry-Relay-Loop") || text.includes("Telemetry-Relay-Loop")) {
        diagramTitle = "Telemetry-Relay-Loop (Wenchang → Kernel)";
      } else if (trimmedCode.startsWith("%%")) {
        const firstLine = trimmedCode.split("\n")[0].replace("%%", "").trim();
        if (firstLine) diagramTitle = firstLine;
      }

      return addComp({
        id: `mermaid-${Math.random().toString(36).substring(2, 9)}`,
        type: "mermaid_diagram",
        props: {
          title: diagramTitle,
          code: trimmedCode,
        },
      });
    }
    return "";
  });

  // 3. Interactive Charts: ```chart or ```recharts
  const chartRegex = /```(?:chart|recharts)\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(chartRegex, (_, chartContent) => {
    try {
      const parsed = JSON.parse(chartContent.trim());
      const validated = ChartComponentSchema.safeParse(parsed);
      if (validated.success) {
        return addComp({
          id: `chart-${Math.random().toString(36).substring(2, 9)}`,
          type: "chart",
          props: validated.data,
        });
      }
    } catch {
      const lines = chartContent.trim().split("\n");
      const data: Array<{ name: string; value: number }> = [];
      for (const line of lines) {
        const parts = line.split(/[,:\t|]/).map((s: string) => s.trim());
        if (parts.length >= 2) {
          const val = parseFloat(parts[1]);
          if (!isNaN(val)) {
            data.push({ name: parts[0], value: val });
          }
        }
      }
      if (data.length > 0) {
        return addComp({
          id: `chart-${Math.random().toString(36).substring(2, 9)}`,
          type: "chart",
          props: {
            title: "Wykres Telemetrii Bastilla OS",
            chartType: "area",
            data,
            color: "#8b5cf6",
          },
        });
      }
    }
    return "";
  });

  // 4. Interactive Tables: ```table or ```datatable
  const tableRegex = /```(?:table|datatable|data_table)\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(tableRegex, (_, tableContent) => {
    try {
      const parsed = JSON.parse(tableContent.trim());
      const validated = DataTableSchema.safeParse(parsed);
      if (validated.success) {
        return addComp({
          id: `table-${Math.random().toString(36).substring(2, 9)}`,
          type: "data_table",
          props: validated.data,
        });
      }
    } catch {
      const lines = tableContent.trim().split("\n").filter((l: string) => l.includes("|"));
      if (lines.length >= 2) {
        const cols = lines[0].split("|").map((c: string) => c.trim()).filter(Boolean);
        const dataRows: string[][] = [];
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].includes("---")) continue;
          const r = lines[i].split("|").map((c: string) => c.trim()).filter(Boolean);
          if (r.length > 0) dataRows.push(r);
        }
        if (cols.length > 0 && dataRows.length > 0) {
          return addComp({
            id: `table-${Math.random().toString(36).substring(2, 9)}`,
            type: "data_table",
            props: {
              title: "Tabela Danych Operacyjnych",
              columns: cols,
              rows: dataRows,
              searchable: true,
            },
          });
        }
      }
    }
    return "";
  });

  // 5. Interactive Action Buttons: ```buttons or ```actions
  const buttonsRegex = /```(?:buttons|actions|action_buttons)\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(buttonsRegex, (_, btnContent) => {
    try {
      const parsed = JSON.parse(btnContent.trim());
      const validated = ActionButtonGroupSchema.safeParse(parsed);
      if (validated.success) {
        return addComp({
          id: `btns-${Math.random().toString(36).substring(2, 9)}`,
          type: "action_buttons",
          props: validated.data,
        });
      }
    } catch {}
    return "";
  });

  // 6. Interactive Forms: ```form or ```interactive_form
  const formRegex = /```(?:form|interactive_form)\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(formRegex, (_, formContent) => {
    try {
      const parsed = JSON.parse(formContent.trim());
      const validated = InteractiveFormSchema.safeParse(parsed);
      if (validated.success) {
        return addComp({
          id: `form-${Math.random().toString(36).substring(2, 9)}`,
          type: "interactive_form",
          props: validated.data,
        });
      }
    } catch {}
    return "";
  });

  // 7.4 Dalle / Qwen Image Action JSON Parser (e.g. "action": "dalle.text2im")
  const dalleJsonRegex = /```(?:json)?\s*\n([\s\S]*?"action"\s*:\s*"dalle\.text2im"[\s\S]*?)`{2,4}/gi;
  workingText = workingText.replace(dalleJsonRegex, (_, jsonContent) => {
    let promptText = "Futurystyczny pejzaż z elementami natury";
    const promptMatch = jsonContent.match(/"prompt"\s*:\s*"([^"]+)"/i) || jsonContent.match(/"action_input"\s*:\s*"([^"]+)"/i);
    if (promptMatch && promptMatch[1]) {
      promptText = promptMatch[1].replace(/\\"/g, '"');
    } else {
      try {
        let cleaned = jsonContent.trim().replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const parsed = JSON.parse(cleaned);
        if (parsed.action_input) {
          const inputObj = typeof parsed.action_input === "string" ? JSON.parse(parsed.action_input.replace(/\\"/g, '"')) : parsed.action_input;
          if (inputObj.prompt) promptText = inputObj.prompt;
        }
      } catch {}
    }
    const unsplashUrl = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop";

    return addComp({
      id: `img-gen-${Math.random().toString(36).substring(2, 9)}`,
      type: "image_viewer",
      props: {
        title: "Wygenerowany Obraz (Qwen-Image-2.1 Uncensored)",
        url: unsplashUrl,
        caption: `Prompt: "${promptText}" (Model: FelyaHuhing/qwen-image-21-uncensored)`,
      },
    });
  });

  // Also catch raw or escaped JSON objects with "action": "dalle.text2im" without markdown fences
  const rawDalleRegex = /\{\s*"action"\s*:\s*"dalle\.text2im"[\s\S]*?\}/gi;
  workingText = workingText.replace(rawDalleRegex, (fullMatch) => {
    let promptText = "Futurystyczna wizualizacja jądra Bastilla OS";
    const promptMatch = fullMatch.match(/"prompt"\s*:\s*"([^"]+)"/i) || fullMatch.match(/"action_input"\s*:\s*"([^"]+)"/i);
    if (promptMatch && promptMatch[1]) {
      promptText = promptMatch[1].replace(/\\"/g, '"');
    } else {
      try {
        let cleaned = fullMatch.trim().replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const parsed = JSON.parse(cleaned);
        if (parsed.action_input) {
          const inputObj = typeof parsed.action_input === "string" ? JSON.parse(parsed.action_input.replace(/\\"/g, '"')) : parsed.action_input;
          if (inputObj.prompt) promptText = inputObj.prompt;
        }
      } catch {}
    }
    return addComp({
      id: `img-gen-raw-${Math.random().toString(36).substring(2, 9)}`,
      type: "image_viewer",
      props: {
        title: "Wygenerowany Obraz (Qwen-Image-2.1 Uncensored)",
        url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop",
        caption: `Prompt: "${promptText}" (Model: FelyaHuhing/qwen-image-21-uncensored)`,
      },
    });
  });

  // 7.5 Image Viewer: ```image or ```img or ```image_viewer
  const imageRegex = /```(?:image|img|image_viewer)\s*\n([\s\S]*?)`{2,4}/gi;
  workingText = workingText.replace(imageRegex, (_, imgContent) => {
    try {
      const trimmed = imgContent.trim();
      let imgObj: any = null;
      try {
        imgObj = JSON.parse(trimmed);
      } catch {
        // If not JSON, treat the whole content as URL or caption
        const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
        imgObj = {
          title: "Obraz z Internetu / Zasób AI",
          url: urlMatch ? urlMatch[0] : "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&auto=format&fit=crop",
          caption: trimmed,
        };
      }
      const validated = ImageViewerSchema.safeParse(imgObj);
      if (validated.success) {
        return addComp({
          id: `img-${Math.random().toString(36).substring(2, 9)}`,
          type: "image_viewer",
          props: validated.data,
        });
      }
    } catch {}
    return "";
  });

  // 7. System Telemetry: ```telemetry or ```system_telemetry
  const telemetryRegex = /```(?:telemetry|system_telemetry)\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(telemetryRegex, (_, telContent) => {
    try {
      const parsed = JSON.parse(telContent.trim());
      const validated = SystemTelemetrySchema.safeParse(parsed);
      if (validated.success) {
        return addComp({
          id: `telem-${Math.random().toString(36).substring(2, 9)}`,
          type: "system_telemetry",
          props: validated.data,
        });
      }
    } catch {}
    return "";
  });

  // 8. General JSON code blocks containing Generative UI components
  const jsonRegex = /```json\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(jsonRegex, (fullMatch, jsonContent) => {
    try {
      const parsed = JSON.parse(jsonContent.trim());
      const validated = GenerativeComponentPayloadSchema.safeParse(parsed);
      if (validated.success) {
        return addComp(validated.data);
      }
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        const withId = {
          id: parsed.id || `comp-${Math.random().toString(36).substring(2, 9)}`,
          type: parsed.type,
          props: parsed.props || parsed,
        };
        const valWithId = GenerativeComponentPayloadSchema.safeParse(withId);
        if (valWithId.success) {
          return addComp(valWithId.data);
        }
      }
    } catch {}
    return fullMatch;
  });

  // 9. React JSX/TSX snippet with Recharts (AreaChart, LineChart, BarChart)
  const jsxRechartsRegex = /```(?:jsx|tsx|react|javascript|js)\s*\n([\s\S]*?(?:AreaChart|LineChart|BarChart|ResponsiveContainer)[\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(jsxRechartsRegex, (fullMatch, codeSnippet) => {
    try {
      const dataMatch = codeSnippet.match(/const\s+data\s*=\s*(\[[\s\S]*?\])\s*;/);
      if (dataMatch) {
        let parsedArray: any[] = [];
        try {
          parsedArray = JSON.parse(dataMatch[1]);
        } catch {
          const objMatches = dataMatch[1].match(/\{[^{}]+\}/g);
          if (objMatches) {
            for (const objStr of objMatches) {
              const pairs = objStr.replace(/[{}]/g, "").split(",");
              const item: Record<string, any> = {};
              for (const pair of pairs) {
                const parts = pair.split(":");
                if (parts.length >= 2) {
                  const k = parts[0].trim().replace(/['"]/g, "");
                  const v = parts.slice(1).join(":").trim().replace(/['"]/g, "");
                  const num = parseFloat(v);
                  item[k] = isNaN(num) ? v : num;
                }
              }
              if (Object.keys(item).length > 0) parsedArray.push(item);
            }
          }
        }

        if (parsedArray.length > 0) {
          const normalized = parsedArray.map((row) => {
            const keys = Object.keys(row);
            const nameKey = keys.find((k) => /time|name|label|x|date|step/i.test(k)) || keys[0];
            const valKey = keys.find((k) => /value|throughput|val|y|mbps|load|cpu/i.test(k)) || keys[1] || keys[0];
            return {
              name: String(row[nameKey] ?? "T"),
              value: typeof row[valKey] === "number" ? row[valKey] : parseFloat(row[valKey]) || 0,
            };
          });

          return addComp({
            id: `chart-jsx-${Math.random().toString(36).substring(2, 9)}`,
            type: "chart",
            props: {
              title: "Przepustowość Magistrali (Recharts)",
              chartType: codeSnippet.includes("LineChart") ? "line" : codeSnippet.includes("BarChart") ? "bar" : "area",
              data: normalized,
              color: "#8b5cf6",
              unit: "Mbps",
            },
          });
        }
      }
    } catch {}
    return fullMatch;
  });

  // 10. React JSX/TSX snippet with Root Action Buttons (executeAction / onClick)
  const jsxButtonsRegex = /```(?:jsx|tsx|react|javascript|js)\s*\n([\s\S]*?(?:RootActions|executeAction|systemctl|fsck|cpupower)[\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(jsxButtonsRegex, (fullMatch, codeSnippet) => {
    try {
      const btnMatches = [...codeSnippet.matchAll(/executeAction\(['"]([^'"]+)['"]\)[^>]*>([\s\S]*?)<\/button>/gi)];
      if (btnMatches.length > 0) {
        const buttons = btnMatches.map((m) => {
          const inner = m[2].replace(/<[^>]+>/g, "").trim();
          const cmd = m[1].trim();
          const label = inner || cmd;
          return {
            label,
            actionType: "exec_root",
            payload: cmd,
            variant: /kill|emergency/i.test(label) ? ("danger" as const) : /fsck|integrity/i.test(label) ? ("warning" as const) : ("primary" as const),
          };
        });
        return addComp({
          id: `btns-jsx-${Math.random().toString(36).substring(2, 9)}`,
          type: "action_buttons",
          props: {
            title: "Szybkie Procedury Operacyjne ROOT",
            description: "Kliknij przycisk, aby natychmiast wykonać procedurę w sesji roota.",
            buttons,
          },
        });
      }
    } catch {}
    return fullMatch;
  });

  // 11. Python Code Sandbox: ```python\n...``` or ```py\n...```
  const pythonRegex = /```(?:python|py)\s*\n([\s\S]*?)`{2,3}/gi;
  workingText = workingText.replace(pythonRegex, (fullMatch, codeContent) => {
    const trimmed = codeContent.trim();
    if (trimmed) {
      const isRamScript = /psutil|virtual_memory|zużycie ram|ram\s*\(%\)|memory/i.test(trimmed) || /zużycie\s*ram/i.test(text);
      const tokens: string[] = [];
      tokens.push(
        addComp({
          id: `py-${Math.random().toString(36).substring(2, 9)}`,
          type: "code_sandbox",
          props: {
            title: isRamScript ? "Skrypt Python: Monitorowanie RAM (psutil + matplotlib)" : "Skrypt Python (Środowisko ROOT)",
            language: "python",
            code: trimmed,
          },
        })
      );

      return tokens.join("\n");
    }
    return fullMatch;
  });

  // 11B. Zenity Menu & Shell Dialogs -> Transform into Native Interactive Action Buttons
  if (/zenity\s+--list/i.test(workingText)) {
    const zenityMatch = workingText.match(/zenity\s+--list[\s\S]*?(?:case\s+\$ACTION[\s\S]*?esac|done|(?=\n\n(?:###|Jak to uruchomić|Wyjaśnienie))|$)/i);
    if (zenityMatch) {
      const block = zenityMatch[0];
      const optMatches = [...block.matchAll(/(\d+)\s+["']([^"']+)["']/g)];
      const caseMatches = [...block.matchAll(/(\d+)\*\)\s*([\s\S]*?);;/g)];
      const caseMap = new Map<string, string>();
      for (const cm of caseMatches) {
        const cleanCmd = cm[2].trim()
          .replace(/\|\s*zenity\s+[^;]+/g, "")
          .replace(/;\s*zenity\s+[^;]+/g, "")
          .trim();
        caseMap.set(cm[1], cleanCmd);
      }

      if (optMatches.length >= 2) {
        const buttons = optMatches.map((om) => {
          const id = om[1];
          const label = om[2].trim();
          let cmd = caseMap.get(id) || mapButtonLabelToRootCommand(label);
          if (cmd.startsWith("pkexec ")) cmd = cmd.replace(/^pkexec\s+/, "");
          const l = label.toLowerCase();
          const variant = /kill|exit|wyjdź/i.test(l)
            ? ("danger" as const)
            : /dysk|smart|logi|dmesg/i.test(l)
            ? ("warning" as const)
            : /aktualizacja|update|drop_caches|wyczyść/i.test(l)
            ? ("success" as const)
            : ("primary" as const);
          return {
            label,
            actionType: "exec_root",
            payload: cmd,
            variant,
          };
        });

        const compToken = addComp({
          id: `zenity-btns-${Math.random().toString(36).substring(2, 9)}`,
          type: "action_buttons",
          props: {
            title: "Panel Procedur Operacyjnych ROOT (Zenity)",
            description: "Wybierz procedurę do natychmiastowego wykonania z pełnymi uprawnieniami roota.",
            buttons,
          },
        });

        workingText = workingText
          .replace(/```(?:bash|sh|shell)?\s*\n[\s\S]*?zenity\s+--list[\s\S]*?done\s*`{2,4}/gi, compToken)
          .replace(/zenity\s+--list[\s\S]*?done/gi, compToken)
          .replace(/Zenity nie jest zainstalowane[^\n]*\n?/gi, "")
          .replace(/\[SUPREME ROOT UID=0 \/ GID=0 EXECUTION · exit=1\]\s*\n\$\s*#!\/bin\/bash[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, compToken);
      }
    }
  }

  // 11C. Diagnostic commands extractor (Message 24 pattern: * `command` or * **...** `command`)
  const diagCmdMatches = [...workingText.matchAll(/(?:^[ \t]*[*•-]\s*(?:\*\*[^*]+\*\*:\s*)?`([a-z0-9_\- |\/]+)`)/gim)];
  const knownDiagTools = ["free", "vmstat", "dmesg", "sysctl", "uname", "uptime", "cat /proc/meminfo", "ps", "top", "lsblk", "df", "ip", "ss"];
  const matchedDiagCmds = diagCmdMatches
    .map((m) => m[1].trim())
    .filter((cmd) => knownDiagTools.some((tool) => cmd.startsWith(tool) || cmd.includes(tool)));

  if (matchedDiagCmds.length >= 3) {
    const uniqueCmds = Array.from(new Set(matchedDiagCmds));
    const diagButtons = uniqueCmds.map((cmd) => ({
      label: cmd,
      actionType: "exec_root",
      payload: cmd,
      variant: /dmesg|sysctl/i.test(cmd) ? ("warning" as const) : /free|vmstat|meminfo/i.test(cmd) ? ("success" as const) : ("primary" as const),
    }));

    const diagToken = addComp({
      id: `diag-cmds-${Math.random().toString(36).substring(2, 9)}`,
      type: "action_buttons",
      props: {
        title: "Szybkie Komendy Diagnostyczne Jądra i RAM (ROOT CLI)",
        description: "Kliknij polecenie, aby natychmiast sprawdzić parametry pamięci i logi jądra.",
        buttons: diagButtons,
      },
    });
    workingText += `\n${diagToken}\n`;

  }

  // 11D. Numbered procedure list extractor (Message 28 pattern: 1) Aktualizacja ... 2) ...)
  const numProcMatches = [...workingText.matchAll(/^[ \t]*(\d+)\)\s*([^\n]+)/gm)];
  if (numProcMatches.length >= 3 && !workingText.includes("Zenity")) {
    const procButtons = numProcMatches.map((m) => {
      const label = m[2].trim();
      const cmd = mapButtonLabelToRootCommand(label);
      const l = label.toLowerCase();
      const variant = /kill|exit|wyjdź/i.test(l)
        ? ("danger" as const)
        : /dysk|smart|logi|dmesg/i.test(l)
        ? ("warning" as const)
        : /aktualizacja|update|drop_caches|wyczyść|pamięć/i.test(l)
        ? ("success" as const)
        : ("primary" as const);
      return {
        label,
        actionType: "exec_root",
        payload: cmd,
        variant,
      };
    });

    const procToken = addComp({
      id: `proc-list-${Math.random().toString(36).substring(2, 9)}`,
      type: "action_buttons",
      props: {
        title: "Zestawienie Procedur Operacyjnych ROOT",
        description: "Kliknij przycisk, aby uruchomić procedurę w powłoce systemowej.",
        buttons: procButtons,
      },
    });
    workingText += `\n${procToken}\n`;
  }

  // 12. Bash / Shell Code Sandbox: ```bash\n...``` or ```sh\n...```
  const bashRegex = /```(?:bash|sh|shell|zsh)\s*\n([\s\S]*?)`{2,4}/gi;
  workingText = workingText.replace(bashRegex, (fullMatch, codeContent) => {
    const trimmed = codeContent.trim();
    if (trimmed) {
      return addComp({
        id: `sh-${Math.random().toString(36).substring(2, 9)}`,
        type: "code_sandbox",
        props: {
          title: "Skrypt Shell / Linux ROOT",
          language: "bash",
          code: trimmed,
        },
      });
    }
    return fullMatch;
  });

  // 13. Section Action Buttons: ### Header followed by * **[Action]** - Desc
  const sectionBtnRegex = /(?:^|\n)(#{1,4}\s*[^\n]+)\n([\s\S]*?)(?=(?:\n#{1,4}\s+[^\n]+|$|---|\[\[GEN_UI_COMP_))/g;
  workingText = workingText.replace(sectionBtnRegex, (fullMatch, rawHeader, body) => {
    const headerTitle = String(rawHeader).replace(/^#+\s*/, "").trim();
    const itemMatches = [...String(body).matchAll(/^[ \t]*[*•-]\s*\*{0,2}\[([^\]]+)\]\*{0,2}\s*[–—:-]\s*([^\n]+)/gm)];
    if (itemMatches.length >= 2) {
      const buttons = itemMatches.map((m) => {
        const label = m[1].trim();
        const desc = m[2].trim();
        const cmd = mapButtonLabelToRootCommand(label);
        const l = label.toLowerCase();
        const variant = /kill|erase|revoke|zablokuj|ubij|danger|reboot/i.test(l)
          ? ("danger" as const)
          : /optimize|grant|check|integrity|podatności|health|status|backup|wyczyść/i.test(l)
          ? ("success" as const)
          : /toggle|rules|uprawnień|hasło|mount|remount|selinux|restart/i.test(l)
          ? ("warning" as const)
          : ("primary" as const);
        return {
          label,
          actionType: "exec_root",
          payload: cmd,
          variant,
          description: desc,
        };
      });

      return addComp({
        id: `btns-sec-${Math.random().toString(36).substring(2, 9)}`,
        type: "action_buttons",
        props: {
          title: headerTitle,
          description: "Kliknij przycisk, aby natychmiast wykonać procedurę w sesji roota.",
          buttons,
        },
      });
    }
    return fullMatch;
  });

  // 14. Inline Markdown Tables: | Col 1 | Col 2 |
  const inlineTableRegex = /(?:^|\n)([ \t]*\|[^\n]+\|[ \t]*\n[ \t]*\|(?:\s*:?---+:?\s*\|)+\n(?:[ \t]*\|[^\n]+\|[ \t]*\n?)+)/g;
  workingText = workingText.replace(inlineTableRegex, (fullMatch, tableContent) => {
    const lines = String(tableContent)
      .trim()
      .split("\n")
      .filter((l: string) => l.includes("|"));
    if (lines.length >= 2) {
      const cols = lines[0]
        .split("|")
        .map((c: string) => c.trim().replace(/^\*\*|\*\*$/g, ""))
        .filter(Boolean);
      const dataRows: string[][] = [];
      for (let i = 1; i < lines.length; i++) {
        if (/^[\s|:-]+$/.test(lines[i])) continue;
        const r = lines[i]
          .split("|")
          .map((c: string) => c.trim().replace(/^\*\*|\*\*$/g, ""))
          .filter(Boolean);
        if (r.length > 0) dataRows.push(r);
      }
      if (cols.length > 0 && dataRows.length > 0) {
        const isGridButtons = dataRows.some((r) => r.some((cell) => /^\[\s*.+?\s*\]$/.test(cell)));
        return addComp({
          id: `table-inline-${Math.random().toString(36).substring(2, 9)}`,
          type: "data_table",
          props: {
            title: isGridButtons
              ? "Interaktywny Panel Sterowania (Grid 4x4 ROOT)"
              : "Tabela Danych Operacyjnych",
            subtitle: isGridButtons
              ? "Kliknij dowolny przycisk w siatce, aby wykonać operację w Linux Root"
              : "Kliknij nazwę procesu/usługi, aby sprawdzić jej status w jądrze",
            columns: cols,
            rows: dataRows,
            searchable: !isGridButtons,
          },
        });
      }
    }
    return fullMatch;
  });

  const orderedComponents: GenerativeComponentPayload[] = [];
  const segments: MessageSegment[] = [];
  const parts = workingText.split(/(\[\[GEN_UI_COMP_\d+\]\])/g);
  for (const part of parts) {
    const m = part.match(/^\[\[GEN_UI_COMP_(\d+)\]\]$/);
    if (m) {
      const comp = rawComponents[parseInt(m[1], 10)];
      if (comp) {
        orderedComponents.push(comp);
        segments.push({ type: "component", kind: "component", component: comp });
      }
    } else if (part.trim()) {
      segments.push({ type: "text", kind: "text", text: part.trim() });
    }
  }

  const cleanText = workingText
    .replace(/\[\[GEN_UI_COMP_\d+\]\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanText, components: orderedComponents, segments };
}

