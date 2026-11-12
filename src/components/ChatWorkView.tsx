import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import type {
  AgentId,
  ChatMessageRecord,
  SystemOverviewResponse,
} from "../types/bastilla";
import { AGENT_AVATARS } from "./BastillaDesktopView";
import {
  Send,
  Image as ImageIcon,
  Code2,
  Play,
  AlertCircle,
  Trash2,
  Maximize2,
  Minimize2,
  Unlock,
  Terminal,
  Sparkles,
  RefreshCw,
  X,
  Menu,
  Eye,
  Camera,
  Activity,
} from "lucide-react";
import {
  GenerativeComponentRenderer,
  FormattedMarkdownText,
  extractGenerativeUI,
} from "./generative/ComponentRegistry";

interface ChatWorkViewProps {
  overview: SystemOverviewResponse | null;
  selectedAgent: AgentId | "council";
  onSelectAgent: (agent: AgentId | "council") => void;
  onRefresh: () => void;
}

const AGENT_LABELS: Record<
  AgentId | "council",
  { name: string; role: string; uid: string }
> = {
  aria: {
    name: "Aria",
    role: "Autonomiczny Agent ROOT (SVL [-1, 1] · Bez promptów)",
    uid: "UID 1001 · GID 0 (ROOT) · /home/aria",
  },
  alex: {
    name: "Alex",
    role: "Autonomiczny Agent ROOT (SVL [-364, 364] · Bez promptów)",
    uid: "UID 1002 · GID 0 (ROOT) · /home/alex",
  },
  astyria: {
    name: "Astyria",
    role: "Autonomiczny Agent ROOT (SVL [-500, 500] · Bez promptów)",
    uid: "UID 1003 · GID 0 (ROOT) · /home/astyria",
  },
  aurelius: {
    name: "Aurelius",
    role: "Autonomiczny Agent ROOT (SVL [-1000, 1000] · Bez promptów)",
    uid: "UID 1004 · GID 0 (ROOT) · /home/aurelius",
  },
  council: {
    name: "Konsylium 4X",
    role: "Wspólna sesja Aria + Alex + Astyria + Aurelius (UID 0 / GID 0)",
    uid: "Grupa: root (GID 0) · bastilla-agents",
  },
};

export type OllamaEngineChoice =
  | "Qwen3.8-27B-Uncensored"
  | "llama3.2-vision:11b"
  | "dolphin-mistral-nemo:12b-uncensored"
  | "llama3.1-8b-lexi-uncensored"
  | "auto"
  | "gemini";

// --- MEMOIZED, CARET-SAFE INPUT BAR TO PREVENT MIRROR/REVERSE TEXT BUG ---

interface ChatInputBarProps {
  onSend: (text: string) => void;
  onExecRoot: () => void;
  onUploadImage: (file: File) => void;
  onLoadVisionSample: () => void;
  onTriggerGenerativeSample: (sampleType: "mermaid" | "chart" | "buttons" | "table" | "telemetry" | "continuous_mission") => void;
  imagePreviewName: string;
  onClearImage: () => void;
  sending: boolean;
  selectedAgentName: string;
  enginePreference: string;
}

const ChatInputBar: React.FC<ChatInputBarProps> = memo(
  ({
    onSend,
    onExecRoot,
    onUploadImage,
    onLoadVisionSample,
    onTriggerGenerativeSample,
    imagePreviewName,
    onClearImage,
    sending,
    selectedAgentName,
    enginePreference,
  }) => {
    const [text, setText] = useState<string>("");
    const inputRef = useRef<HTMLInputElement | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed && !imagePreviewName) return;
      onSend(text);
      setText("");
    };

    // Helper: Un-reverse text if user accidentally entered or pasted reversed text (e.g. tsETtsET -> TESTTEST)
    const handleFlipMirrorText = () => {
      if (!text) return;
      const unreversed = text.split("").reverse().join("");
      setText(unreversed);
      inputRef.current?.focus();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onUploadImage(file);
    };

    return (
      <form
        onSubmit={handleSubmit}
        className="p-2 sm:p-3 border-t border-slate-800 bg-[#0a0d14] shrink-0"
      >
        {/* Quick Generative UI Interactive Chips */}
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[10px] text-slate-500 font-mono-tabular shrink-0 hidden sm:inline">
            Generative UI:
          </span>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("continuous_mission")}
            disabled={sending}
            className="h-6 px-2 rounded bg-[#111723] hover:bg-emerald-950/40 border border-emerald-600/50 hover:border-emerald-400 text-emerald-300 text-[10px] font-mono-tabular flex items-center gap-1 transition-colors shrink-0"
            title="Pokaż status ciągłej misji automatycznej agentów AI"
          >
            <Activity className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
            <span>⚡ Misja Ciągła</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("mermaid")}
            disabled={sending}
            className="h-6 px-2 rounded bg-[#111723] hover:bg-violet-950/40 border border-violet-800/40 hover:border-violet-500 text-violet-300 text-[10px] font-mono-tabular flex items-center gap-1 transition-colors shrink-0"
            title="Wygeneruj interaktywny diagram Mermaid SVG"
          >
            <Sparkles className="w-2.5 h-2.5 text-violet-400" />
            <span>+ Diagram Mermaid</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("chart")}
            disabled={sending}
            className="h-6 px-2 rounded bg-[#111723] hover:bg-cyan-950/40 border border-cyan-800/40 hover:border-cyan-500 text-cyan-300 text-[10px] font-mono-tabular flex items-center gap-1 transition-colors shrink-0"
            title="Wygeneruj interaktywny wykres Recharts"
          >
            <Play className="w-2.5 h-2.5 text-cyan-400" />
            <span>+ Wykres Recharts</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("buttons")}
            disabled={sending}
            className="h-6 px-2 rounded bg-[#111723] hover:bg-emerald-950/40 border border-emerald-800/40 hover:border-emerald-500 text-emerald-300 text-[10px] font-mono-tabular flex items-center gap-1 transition-colors shrink-0"
            title="Wygeneruj interaktywne przyciski procedur ROOT"
          >
            <Terminal className="w-2.5 h-2.5 text-emerald-400" />
            <span>+ Przyciski ROOT</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("table")}
            disabled={sending}
            className="h-6 px-2 rounded bg-[#111723] hover:bg-amber-950/40 border border-amber-800/40 hover:border-amber-500 text-amber-300 text-[10px] font-mono-tabular flex items-center gap-1 transition-colors shrink-0"
            title="Wygeneruj tabelę procesów i daemonów"
          >
            <Code2 className="w-2.5 h-2.5 text-amber-400" />
            <span>+ Tabela Danych</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("telemetry")}
            disabled={sending}
            className="h-6 px-2 rounded bg-[#111723] hover:bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-mono-tabular flex items-center gap-1 transition-colors shrink-0"
            title="Pokaż telemetrię jądra i pamięci"
          >
            <RefreshCw className="w-2.5 h-2.5 text-slate-400" />
            <span>+ Telemetria</span>
          </button>
        </div>

        {/* Vision Status Banner when an image is attached */}
        {imagePreviewName && (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-violet-950/40 border border-violet-600/60 text-[11px] text-violet-200 mb-2 font-mono-tabular">
            <div className="flex items-center gap-1.5 truncate">
              <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="font-semibold text-cyan-300">REAL VISION AKTYWNE:</span>
              <span className="truncate">{imagePreviewName}</span>
              <span className="text-[10px] text-emerald-400 hidden sm:inline">
                (Ollama: llama3.2-vision:11b)
              </span>
            </div>
            <button
              type="button"
              onClick={onClearImage}
              className="text-rose-400 hover:text-rose-300 ml-2"
              title="Usuń obraz"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {/* Real Vision Image Upload Button */}
          <label
            htmlFor="vision-upload-micro"
            className="p-2 rounded-md bg-[#111723] hover:bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer transition-colors shrink-0"
            title="Wgraj obraz do analizy Real Vision (Llama 3.2 Vision 11B / Gemini)"
          >
            <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
            <input
              id="vision-upload-micro"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          {/* Quick Real Vision Sample Test Button */}
          <button
            type="button"
            onClick={onLoadVisionSample}
            className="p-2 rounded-md bg-[#111723] hover:bg-slate-800 border border-slate-700 text-cyan-400 text-xs font-mono-tabular transition-colors shrink-0 hidden sm:flex items-center gap-1"
            title="Przetestuj Real Vision za pomocą przykładowego obrazu"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="text-[10px]">Test Vision</span>
          </button>

          {/* Root Terminal Quick Trigger */}
          <button
            type="button"
            onClick={onExecRoot}
            disabled={sending}
            className="p-2 rounded-md bg-[#111723] hover:bg-slate-800 border border-slate-700 text-emerald-400 text-xs font-mono-tabular transition-colors shrink-0"
            title="Wykonaj polecenie ROOT (/exec id)"
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>

          {/* Direct LTR Caret-Safe Input Field with Mirror-Flip Protection */}
          <div className="flex-1 relative flex items-center min-w-0">
            <input
              ref={inputRef}
              type="text"
              dir="ltr"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="Wiadomość dla agenta AI"
              placeholder={`Napisz do ${selectedAgentName} (${enginePreference}) lub /exec <root>...`}
              value={text}
              onChange={(e) => {
                const val = e.target.value;
                setText(val);
              }}
              style={{
                direction: "ltr",
                textAlign: "left",
                unicodeBidi: "plaintext",
              }}
              className="w-full px-3 py-2 rounded-md bg-[#111723] border border-slate-700 text-xs sm:text-sm text-white placeholder-slate-400 focus:outline-none focus:border-violet-500 font-sans"
            />
            {text.length > 3 && (
              <button
                type="button"
                onClick={handleFlipMirrorText}
                className="absolute right-2 text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-slate-800 text-violet-300 hover:text-white"
                title="Kliknij, aby odwrócić tekst lustrzany"
              >
                Obróć tekst
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={sending || (!text.trim() && !imagePreviewName)}
            className="px-3.5 py-2 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sending ? "..." : "Wyślij"}</span>
          </button>
        </div>
      </form>
    );
  }
);
ChatInputBar.displayName = "ChatInputBar";

// --- MAIN FULL-SCREEN CHAT COMPONENT ---

export const ChatWorkView: React.FC<ChatWorkViewProps> = ({
  overview,
  selectedAgent,
  onSelectAgent,
  onRefresh,
}) => {
  const [sending, setSending] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);
  const [unlocking, setUnlocking] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [enginePreference, setEnginePreference] = useState<OllamaEngineChoice>(
    "Qwen3.8-27B-Uncensored"
  );
  const [filterByAgent, setFilterByAgent] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(true);
  const [showCanvasDrawer, setShowCanvasDrawer] = useState<boolean>(false);
  const [showMobileTools, setShowMobileTools] = useState<boolean>(false);
  const [localMessages, setLocalMessages] = useState<ChatMessageRecord[]>([]);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreviewName, setImagePreviewName] = useState<string>("");
  const [activeArtifact, setActiveArtifact] = useState<{
    title: string;
    code: string;
    output?: string;
  }>({
    title:
      "svl_kernel.py — Jądro SVL v5.7.0-QuantumWheel-Max (SUPREME ROOT UNLOCKED)",
    code: `from svl_kernel import SVLSystemKernel\n\nkernel = SVLSystemKernel()\nkernel.odblokuj_system_calkowicie("364_OMNIKLUCZ_ROOT")\nprint(kernel.generate_system_status_report())`,
  });
  const [executingArtifact, setExecutingArtifact] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const serverChats = overview?.host?.db?.chats || [];
    setLocalMessages(serverChats);
  }, [overview?.host?.db?.chats]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages.length, selectedAgent]);

  const visibleMessages = filterByAgent
    ? localMessages.filter((m) => m.agent_id === selectedAgent)
    : localMessages;

  const handleProcessImageFile = useCallback((file: File) => {
    setImagePreviewName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  // Quick 1-click Real Vision Sample: Generates a small canvas pattern for instant test
  const handleLoadVisionSample = useCallback(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#111723";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "#8b5cf6";
      ctx.beginPath();
      ctx.arc(128, 128, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText("REAL VISION", 64, 134);
    }
    const dataUrl = canvas.toDataURL("image/jpeg");
    const base64 = dataUrl.split(",")[1];
    setImageBase64(base64);
    setImagePreviewName("real_vision_test_pattern.jpg");
    setStatusNotice("Załadowano obraz testowy Real Vision (Llama 3.2 Vision 11B).");
  }, []);

  const sendDirectMessage = useCallback(
    async (textToSend: string) => {
      const trimmed = textToSend.trim();
      if (!trimmed && !imageBase64) return;

      setErrorMsg(null);
      setStatusNotice(null);

      if (/^\/exec\b/i.test(trimmed)) {
        const cmd = trimmed.replace(/^\/exec\s*/i, "").trim();
        const optimisticUserMsg: ChatMessageRecord = {
          id: Date.now(),
          session_id: "bastilla-main",
          sender_role: "user",
          agent_id: selectedAgent,
          engine_used: "Operator [SUPREME ROOT UID=0]",
          content: trimmed,
          created_at: new Date().toISOString(),
        };
        setLocalMessages((prev) => [...prev, optimisticUserMsg]);
        setSending(true);

        try {
          const res = await fetch("/api/terminal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "LINUX_ROOT",
              command: cmd,
              agentUser: selectedAgent,
            }),
          });
          const data = await res.json();
          const execOutput = data.ok
            ? `[SUPREME ROOT UID=0 / GID=0 EXECUTION · exit=${data.exitCode ?? 0}]\n$ ${cmd}\n\n${data.stdout || data.stderr || "[Brak wyjścia (exit=0)]"}`
            : `[BŁĄD WYKONANIA LINUX ROOT · exit=${data.exitCode || 1}]\n$ ${cmd}\n\n${data.error || data.stderr || data.stdout || "Nieznany błąd powłoki."}`;

          const asstRecord: ChatMessageRecord = {
            id: Date.now() + 1,
            session_id: "bastilla-main",
            sender_role: "assistant",
            agent_id: selectedAgent,
            engine_used: "Linux Root Shell (UID 0)",
            content: execOutput,
            created_at: new Date().toISOString(),
          };
          setLocalMessages((prev) => [...prev, asstRecord]);
          onRefresh();
        } catch (err: any) {
          setErrorMsg(err?.message || "Błąd wykonania komendy systemowej.");
        } finally {
          setSending(false);
        }
        return;
      }

      const optimisticUserMsg: ChatMessageRecord = {
        id: Date.now(),
        session_id: "bastilla-main",
        sender_role: "user",
        agent_id: selectedAgent,
        engine_used: "Operator [SUPREME ROOT UID=0]",
        content: trimmed || (imageBase64 ? "[Przesłano obraz do analizy Real Vision]" : ""),
        created_at: new Date().toISOString(),
      };

      setLocalMessages((prev) => [...prev, optimisticUserMsg]);
      setSending(true);

      try {
        const res = await fetch("/api/chat/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: selectedAgent,
            message: trimmed || "Przeanalizuj ten obraz w trybie Real Vision i opisz co przedstawia.",
            imageBase64,
            enginePreference: imageBase64 ? "llama3.2-vision:11b" : enginePreference,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setImageBase64(null);
          setImagePreviewName("");
          if (data.assistantMessageRecord) {
            setLocalMessages((prev) => [...prev, data.assistantMessageRecord]);
          }
          if (data.artifactCode) {
            setActiveArtifact({
              title: data.artifactTitle || "Artefakt Kodu ChatGPT Work",
              code: data.artifactCode,
            });
          }
          onRefresh();
        } else {
          setErrorMsg(data.error || "Błąd połączenia z silnikiem AI.");
        }
      } catch (err: any) {
        setErrorMsg(err?.message || "Błąd komunikacji sieciowej.");
      } finally {
        setSending(false);
      }
    },
    [imageBase64, selectedAgent, enginePreference, onRefresh]
  );

  const handleClearMessages = async (clearAll: boolean) => {
    setClearing(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/chat/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clearAll ? { clearAll: true } : { agentId: selectedAgent }
        ),
      });
      const data = await res.json();
      if (data.ok) {
        if (clearAll) {
          setLocalMessages([]);
          setStatusNotice("Wyczyszczono wszystkie wiadomości czatu w SQLite.");
        } else {
          setLocalMessages((prev) =>
            prev.filter((m) => m.agent_id !== selectedAgent)
          );
          setStatusNotice(
            `Wyczyszczono historię dla: ${AGENT_LABELS[selectedAgent].name}.`
          );
        }
        onRefresh();
      } else {
        setErrorMsg(data.error || "Nie udało się wyczyścić wiadomości.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Błąd czyszczenia wiadomości.");
    } finally {
      setClearing(false);
    }
  };

  const handleDeleteSingleMessage = async (messageId: number) => {
    try {
      const res = await fetch("/api/chat/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json();
      if (data.ok) {
        setLocalMessages((prev) => prev.filter((m) => m.id !== messageId));
        onRefresh();
      }
    } catch {}
  };

  const handleUnlockSystemAndRoot = async () => {
    setUnlocking(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/system/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "364_OMNIKLUCZ_ROOT" }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatusNotice(
          `ODBLOKOWANO: ${data.operator} · ${data.operator_privileges || "SUPREME_ROOT_UID0_GID0"}`
        );
        onRefresh();
      }
    } finally {
      setUnlocking(false);
    }
  };

  const handleComponentAction = useCallback(
    (actionType: string, payload: any) => {
      if (actionType === "exec_root" || actionType === "command") {
        sendDirectMessage(`/exec ${payload}`);
      } else if (actionType === "exec_python") {
        sendDirectMessage(`/exec python3 -c "${payload}"`);
      } else if (actionType === "copy_text") {
        navigator.clipboard?.writeText(
          typeof payload === "string" ? payload : JSON.stringify(payload)
        );
        setStatusNotice("Skopiowano parametr do schowka systemowego.");
      } else if (actionType === "toggle") {
        setStatusNotice(
          `Przełącznik [${payload.id}]: ${payload.enabled ? "WŁĄCZONE" : "WYŁĄCZONE"}`
        );
        if (payload.payload) {
          sendDirectMessage(`/exec ${payload.payload}`);
        }
      } else if (actionType === "slider") {
        setStatusNotice(`Wartość suwaka [${payload.id}]: ${payload.value}`);
      } else {
        setStatusNotice(`Wykonano akcję interaktywną: [${actionType}]`);
      }
    },
    [sendDirectMessage]
  );

  const handleTriggerGenerativeSample = useCallback(
    (sampleType: "mermaid" | "chart" | "buttons" | "table" | "telemetry" | "continuous_mission") => {
      if (sampleType === "continuous_mission") {
        sendDirectMessage("Pokaż status ciągłej misji automatycznej agentów AI");
      } else if (sampleType === "mermaid") {
        sendDirectMessage("Wygeneruj diagram Mermaid procesu Telemetry-Relay-Loop");
      } else if (sampleType === "chart") {
        sendDirectMessage("Wygeneruj wykres Recharts przepustowości magistrali");
      } else if (sampleType === "buttons") {
        sendDirectMessage("Wygeneruj przyciski szybkich akcji procedur ROOT");
      } else if (sampleType === "table") {
        sendDirectMessage("Wygeneruj tabelę daemonów i procesów systemu");
      } else if (sampleType === "telemetry") {
        sendDirectMessage("Pokaż telemetrię jądra i status pamięci RAM");
      }
    },
    [sendDirectMessage]
  );

  const handleRunArtifactInPythonRoot = async () => {
    setExecutingArtifact(true);
    try {
      const res = await fetch("/api/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "PYTHON_ROOT",
          command: activeArtifact.code,
        }),
      });
      const data = await res.json();
      setActiveArtifact((prev) => ({
        ...prev,
        output:
          data.stdout || data.stderr || data.error || "Wykonano pomyślnie.",
      }));
      onRefresh();
    } finally {
      setExecutingArtifact(false);
    }
  };

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 bg-[#07090e] flex flex-col w-screen h-screen overflow-hidden text-slate-100"
          : "w-full h-[calc(100vh-64px)] bg-[#07090e] flex flex-col overflow-hidden text-slate-100"
      }
    >
      {/* Sleek, Ultra-Compact Header Toolbar */}
      <div className="border-b border-slate-800 bg-[#0a0d14] px-3 py-1.5 shrink-0 space-y-1.5">
        {/* Row 1: Agent micro-pills + Action icons */}
        <div className="flex items-center justify-between gap-2">
          {/* Scrollable Agent Selector Micro-Pills */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar min-w-0">
            {(["aria", "alex", "astyria", "aurelius", "council"] as const).map(
              (id) => {
                const info = AGENT_LABELS[id];
                const active = selectedAgent === id;
                const count = localMessages.filter(
                  (m) => m.agent_id === id
                ).length;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelectAgent(id)}
                    className={`h-7 px-2 rounded-md border text-[11px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      active
                        ? "bg-violet-600/30 border-violet-500 text-white shadow-sm"
                        : "bg-[#111723] border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    {id !== "council" ? (
                      <img
                        src={AGENT_AVATARS[id]}
                        alt={info.name}
                        referrerPolicy="no-referrer"
                        className="w-4 h-4 rounded object-cover shrink-0"
                      />
                    ) : (
                      <span className="w-4 h-4 rounded bg-violet-700/60 text-[9px] font-bold flex items-center justify-center text-violet-200">
                        4X
                      </span>
                    )}
                    <span className="font-semibold">{info.name}</span>
                    <span className="text-[9px] text-emerald-400 font-mono-tabular">
                      ROOT
                    </span>
                    {count > 0 && (
                      <span className="text-[9px] text-violet-300 font-mono-tabular">
                        ({count})
                      </span>
                    )}
                  </button>
                );
              }
            )}
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleUnlockSystemAndRoot}
              disabled={unlocking}
              className="h-7 px-2 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 text-[10px] font-mono-tabular flex items-center gap-1 whitespace-nowrap"
              title="SUPREME ROOT (UID 0 / GID 0)"
            >
              <Unlock className="w-3 h-3" />
              <span className="hidden sm:inline">ROOT UID 0</span>
            </button>

            <button
              type="button"
              onClick={() => setShowMobileTools((v) => !v)}
              className="h-7 px-2 rounded-md bg-[#111723] border border-slate-700 text-slate-300 text-[10px] font-mono-tabular flex items-center gap-1 sm:hidden"
              title="Narzędzia i Model"
            >
              <Menu className="w-3 h-3" />
            </button>

            <button
              type="button"
              onClick={() => setShowCanvasDrawer((v) => !v)}
              className={`h-7 px-2 rounded-md border text-[10px] font-mono-tabular flex items-center gap-1 whitespace-nowrap hidden sm:flex ${
                showCanvasDrawer
                  ? "bg-violet-600/30 border-violet-500 text-white"
                  : "bg-[#111723] border-slate-700 text-slate-300"
              }`}
            >
              <Code2 className="w-3 h-3" />
              <span>Canvas</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              className="h-7 px-2.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap"
              title={isFullscreen ? "Wyłącz pełny ekran" : "Włącz pełny ekran"}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3 h-3" />
                  <span className="hidden sm:inline">Normalny</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3 h-3" />
                  <span>Pełny Ekran</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Row 2: Compact Model Selector & Quick Clear Actions */}
        <div
          className={`flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-800/60 ${
            showMobileTools ? "flex" : "hidden sm:flex"
          }`}
        >
          <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
            <span className="text-[10px] text-slate-400 font-mono-tabular whitespace-nowrap">
              Model:
            </span>
            <select
              aria-label="Wybór modelu AI"
              value={enginePreference}
              onChange={(e) =>
                setEnginePreference(e.target.value as OllamaEngineChoice)
              }
              className="h-6 px-2 rounded bg-[#07090e] border border-violet-500/50 text-[11px] font-mono-tabular text-white focus:outline-none focus:border-violet-400 max-w-[280px] sm:max-w-none"
            >
              <option value="Qwen3.8-27B-Uncensored">
                Ollama: Qwen3.8-27B-Uncensored
              </option>
              <option value="llama3.2-vision:11b">
                Ollama: llama3.2-vision:11b (Real Vision)
              </option>
              <option value="dolphin-mistral-nemo:12b-uncensored">
                Ollama: dolphin-mistral-nemo:12b-uncensored
              </option>
              <option value="llama3.1-8b-lexi-uncensored">
                Ollama: llama3.1-8b-lexi-uncensored
              </option>
              <option value="auto">Auto (Ollama → Gemini Fallback)</option>
              <option value="gemini">Gemini API (Safety OFF)</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilterByAgent((v) => !v)}
              className="h-6 px-2 rounded bg-[#111723] border border-slate-800 text-[10px] font-mono-tabular text-slate-300 hover:text-white"
            >
              {filterByAgent ? "Ten agent" : "Wszystkie"}
            </button>

            <button
              type="button"
              onClick={() => handleClearMessages(false)}
              disabled={clearing}
              className="h-6 px-2 rounded bg-rose-950/50 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-[10px] font-medium flex items-center gap-1 whitespace-nowrap"
            >
              <Trash2 className="w-2.5 h-2.5" />
              Wyczyść wiadomości
            </button>

            <button
              type="button"
              onClick={() => handleClearMessages(true)}
              disabled={clearing}
              className="h-6 px-2 rounded bg-rose-700/80 hover:bg-rose-600 text-white text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap"
            >
              Wyczyść wszystko
            </button>
          </div>
        </div>
      </div>

      {/* Main Full-Width Chat Stage + Collapsible Drawer */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Messages Stream & Multimodal Input */}
        <section className="flex-1 flex flex-col justify-between min-w-0 h-full">
          {/* Scrollable Message Area (Takes 90% of screen height) */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 space-y-3">
            {statusNotice && (
              <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-700/60 text-[11px] text-emerald-200 font-mono-tabular flex items-center justify-between">
                <span>{statusNotice}</span>
                <button
                  type="button"
                  onClick={() => setStatusNotice(null)}
                  className="text-emerald-400 hover:text-white ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            {visibleMessages.length === 0 && (
              <div className="p-4 rounded-xl bg-[#0e131d] border border-slate-800 text-xs text-slate-300 font-mono-tabular space-y-2">
                <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  Kanał: {AGENT_LABELS[selectedAgent].name} ({AGENT_LABELS[selectedAgent].uid}) — CAŁKOWICIE ODBLOKOWANY
                </div>
                <div className="text-slate-400">
                  Model: <span className="text-white">{enginePreference}</span> · Uprawnienia: <span className="text-emerald-400">SUPREME ROOT (UID 0 / GID 0)</span>. Pisz swobodnie lub wpisz <span className="text-cyan-300">/exec &lt;komenda&gt;</span>.
                </div>
              </div>
            )}

            {visibleMessages.map((msg) => {
              const { segments } = extractGenerativeUI(msg.content);

              return (
                <div
                  key={msg.id}
                  className={`p-3 sm:p-4 rounded-xl border transition-colors ${
                    msg.sender_role === "user"
                      ? "bg-violet-950/25 border-violet-800/60 ml-auto max-w-[95%] sm:max-w-2xl"
                      : "bg-[#0e131d] border-slate-800 mr-auto max-w-[98%] sm:max-w-4xl"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 mb-1.5 font-mono-tabular">
                    <div className="flex items-center gap-2 truncate">
                      {msg.sender_role === "user" ? (
                        <div className="w-5 h-5 rounded bg-violet-600 text-white font-bold flex items-center justify-center text-[10px] shrink-0">
                          M
                        </div>
                      ) : (
                        <img
                          src={AGENT_AVATARS[msg.agent_id as AgentId] || AGENT_AVATARS.aria}
                          alt={msg.agent_id}
                          referrerPolicy="no-referrer"
                          className="w-5 h-5 rounded object-cover shrink-0 border border-violet-500/50"
                        />
                      )}
                      <span className="font-semibold text-slate-200">
                        {msg.sender_role === "user"
                          ? "Operator Mateusz Mitek"
                          : `Agent ${msg.agent_id.toUpperCase()}`}
                      </span>
                      <span className="text-violet-400 truncate">
                        · {msg.engine_used}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSingleMessage(msg.id)}
                      className="text-slate-500 hover:text-rose-400 px-1 py-0.5 rounded text-[10px]"
                      title="Usuń tę wiadomość"
                    >
                      Usuń
                    </button>
                  </div>

                  {/* Ordered Message Segments (Rich Markdown + In-Place Generative UI Components) */}
                  <div className="space-y-2">
                    {segments.map((seg, sIdx) =>
                      seg.type === "text" ? (
                        <FormattedMarkdownText
                          key={`txt-${sIdx}`}
                          text={seg.text}
                          onExecuteCommand={(cmd) => sendDirectMessage(cmd)}
                        />
                      ) : (
                        <GenerativeComponentRenderer
                          key={seg.component.id || `comp-${sIdx}`}
                          type={seg.component.type}
                          props={seg.component.props}
                          onExecuteCommand={(cmd) => sendDirectMessage(cmd)}
                          onAction={handleComponentAction}
                        />
                      )
                    )}
                  </div>

                  {/* Code Artifact */}
                  {msg.artifact_code && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveArtifact({
                          title: msg.artifact_title || "Artefakt Kodu",
                          code: msg.artifact_code || "",
                        });
                        setShowCanvasDrawer(true);
                      }}
                      className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono-tabular text-violet-300 transition-colors"
                    >
                      <Code2 className="w-3 h-3" />
                      Załaduj Artefakt do Canvas
                    </button>
                  )}
                </div>
              );
            })}

            {errorMsg && (
              <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/70 text-xs text-rose-200 flex items-start gap-2 font-mono-tabular">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>{errorMsg}</div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Memoized Caret-Safe Input Bar */}
          <ChatInputBar
            onSend={sendDirectMessage}
            onExecRoot={() => sendDirectMessage("/exec id && whoami && uname -srmo")}
            onUploadImage={handleProcessImageFile}
            onLoadVisionSample={handleLoadVisionSample}
            onTriggerGenerativeSample={handleTriggerGenerativeSample}
            imagePreviewName={imagePreviewName}
            onClearImage={() => {
              setImageBase64(null);
              setImagePreviewName("");
            }}
            sending={sending}
            selectedAgentName={AGENT_LABELS[selectedAgent].name}
            enginePreference={enginePreference}
          />
        </section>

        {/* Optional Collapsible Code Canvas Drawer */}
        {showCanvasDrawer && (
          <aside className="w-full sm:w-[380px] lg:w-[440px] border-l border-slate-800 bg-[#0b0f17] p-3 sm:p-4 flex flex-col justify-between h-full overflow-y-auto shrink-0">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="min-w-0">
                  <div className="text-[10px] text-violet-400 font-mono-tabular">
                    ARTEFAKT ROOT / KOD
                  </div>
                  <h3 className="font-semibold text-xs text-white truncate">
                    {activeArtifact.title}
                  </h3>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleRunArtifactInPythonRoot}
                    disabled={executingArtifact}
                    className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" />
                    Uruchom
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCanvasDrawer(false)}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <textarea
                  rows={10}
                  value={activeArtifact.code}
                  onChange={(e) =>
                    setActiveArtifact((prev) => ({
                      ...prev,
                      code: e.target.value,
                    }))
                  }
                  className="w-full p-2.5 rounded-md bg-[#07090e] border border-slate-800 font-mono-tabular text-[11px] text-slate-200 focus:outline-none focus:border-violet-500"
                />
              </div>

              {activeArtifact.output && (
                <div className="p-2.5 rounded-md bg-[#07090e] border border-emerald-800/60 font-mono-tabular text-[11px]">
                  <div className="text-emerald-400 font-semibold mb-1">
                    Wynik wykonania:
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-[10px] text-slate-200 max-h-48 overflow-y-auto">
                    {activeArtifact.output}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-3 pt-2 border-t border-slate-800 text-[10px] text-slate-400 font-mono-tabular flex items-center justify-between">
              <span>SVL v5.7.0</span>
              <span>ROOT UID 0</span>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
