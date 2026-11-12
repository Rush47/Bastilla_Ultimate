import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import type {
  AgentId,
  ChatMessageRecord,
  GeneratedImageItem,
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
  Activity,
  Square,
  RotateCcw,
  Images,
  Wand2,
  Settings2,
} from "lucide-react";
import {
  GenerativeComponentRenderer,
  FormattedMarkdownText,
  extractGenerativeUI,
} from "./generative/ComponentRegistry";
import { apiFetchJson, buildApiUrl } from "../utils/apiClient";

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
    role: "Profil agenta · wykonanie przez serwer",
    uid: "Konto i dostęp: zakładka Sterowanie",
  },
  alex: {
    name: "Alex",
    role: "Profil agenta · wykonanie przez serwer",
    uid: "Konto i dostęp: zakładka Sterowanie",
  },
  astyria: {
    name: "Astyria",
    role: "Profil agenta · wykonanie przez serwer",
    uid: "Konto i dostęp: zakładka Sterowanie",
  },
  aurelius: {
    name: "Aurelius",
    role: "Profil agenta · wykonanie przez serwer",
    uid: "Konto i dostęp: zakładka Sterowanie",
  },
  council: {
    name: "Konsylium 4X",
    role: "Wspólny profil rozmowy; koordynacja @wszyscy",
    uid: "Kanał wieloagentowy",
  },
};

export type OllamaEngineChoice = string;

interface ChatInputBarProps {
  onSend: (text: string) => void;
  onStopStreaming: () => void;
  onExecRoot: () => void;
  onUploadImage: (file: File) => void;
  onLoadVisionSample: () => void;
  onTriggerGenerativeSample: (
    sampleType:
      | "mermaid"
      | "chart"
      | "buttons"
      | "table"
      | "telemetry"
      | "continuous_mission"
  ) => void;
  onOpenImageGenModal: (prefill?: string) => void;
  imagePreviewName: string;
  onClearImage: () => void;
  sending: boolean;
  generatingImage: boolean;
  selectedAgentName: string;
  enginePreference: string;
}

const ChatInputBar: React.FC<ChatInputBarProps> = memo(
  ({
    onSend,
    onStopStreaming,
    onExecRoot,
    onUploadImage,
    onLoadVisionSample,
    onTriggerGenerativeSample,
    onOpenImageGenModal,
    imagePreviewName,
    onClearImage,
    sending,
    generatingImage,
    selectedAgentName,
    enginePreference,
  }) => {
    const [text, setText] = useState<string>("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const adjustTextareaHeight = useCallback((el?: HTMLTextAreaElement | null) => {
      const target = el ?? textareaRef.current;
      if (!target) return;
      target.style.height = "auto";
      target.style.height = `${Math.min(Math.max(target.scrollHeight, 52), 140)}px`;
    }, []);

    const submitCurrentText = useCallback(() => {
      const trimmed = text.trim();
      if (!trimmed && !imagePreviewName) return;
      onSend(text);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "52px";
      }
    }, [text, imagePreviewName, onSend]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      submitCurrentText();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submitCurrentText();
      }
    };

    const insertMention = (mention: string) => {
      setText((prev) => {
        const prefix = prev.trim().length > 0 && !prev.endsWith(" ") ? `${prev} ` : prev;
        return `${prefix}${mention} `;
      });
      requestAnimationFrame(() => {
        adjustTextareaHeight();
        textareaRef.current?.focus();
      });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onUploadImage(file);
    };

    return (
      <form
        onSubmit={handleSubmit}
        className="p-2 sm:p-3 border-t border-slate-800 bg-[#0a0d14] shrink-0 space-y-2"
      >
        {/* Quick Mentions + Generative UI Interactive Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {(["@wszyscy", "@aria", "@alex", "@astyria", "@aurelius"] as const).map(
            (mention) => (
              <button
                key={mention}
                type="button"
                onClick={() => insertMention(mention)}
                disabled={sending}
                className="min-h-8 sm:min-h-6 px-2 rounded bg-violet-950/50 hover:bg-violet-900/60 border border-violet-700/50 text-violet-200 text-[11px] font-mono-tabular shrink-0"
              >
                {mention}
              </button>
            )
          )}
          <span className="text-slate-700 shrink-0">|</span>
          <button
            type="button"
            onClick={() => onOpenImageGenModal(text.trim())}
            disabled={generatingImage}
            className="min-h-8 sm:min-h-6 px-2.5 rounded bg-cyan-900/50 hover:bg-cyan-800/60 border border-cyan-500/60 text-cyan-200 text-[11px] font-semibold flex items-center gap-1 transition-colors shrink-0"
          >
            <Wand2 className="w-3 h-3 text-cyan-300" />
            <span>{generatingImage ? "Generowanie..." : "Wygeneruj obraz"}</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("continuous_mission")}
            disabled={sending}
            className="min-h-8 sm:min-h-6 px-2 rounded bg-[#111723] hover:bg-emerald-950/40 border border-emerald-600/50 text-emerald-300 text-[10px] font-mono-tabular flex items-center gap-1 shrink-0"
          >
            <Activity className="w-2.5 h-2.5 text-emerald-400" />
            <span>Misja</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("mermaid")}
            disabled={sending}
            className="min-h-8 sm:min-h-6 px-2 rounded bg-[#111723] hover:bg-violet-950/40 border border-violet-800/40 text-violet-300 text-[10px] font-mono-tabular flex items-center gap-1 shrink-0"
          >
            <Sparkles className="w-2.5 h-2.5 text-violet-400" />
            <span>Mermaid</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("chart")}
            disabled={sending}
            className="min-h-8 sm:min-h-6 px-2 rounded bg-[#111723] hover:bg-cyan-950/40 border border-cyan-800/40 text-cyan-300 text-[10px] font-mono-tabular flex items-center gap-1 shrink-0"
          >
            <Play className="w-2.5 h-2.5 text-cyan-400" />
            <span>Wykres</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerGenerativeSample("telemetry")}
            disabled={sending}
            className="min-h-8 sm:min-h-6 px-2 rounded bg-[#111723] hover:bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-mono-tabular flex items-center gap-1 shrink-0"
          >
            <RefreshCw className="w-2.5 h-2.5 text-slate-400" />
            <span>Telemetria</span>
          </button>
        </div>

        {/* Vision / Edit Image Attached Banner */}
        {imagePreviewName && (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-violet-950/40 border border-violet-600/60 text-[11px] text-violet-200 font-mono-tabular">
            <div className="flex items-center gap-1.5 truncate">
              <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="font-semibold text-cyan-300">OBRAZ ZAŁĄCZONY:</span>
              <span className="truncate">{imagePreviewName}</span>
            </div>
            <button
              type="button"
              onClick={onClearImage}
              aria-label="Usuń załączony obraz"
              className="min-h-8 min-w-8 text-rose-400 hover:text-rose-300 ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Full-Width Visible Composer Box + Bottom Action Bar */}
        <div className="rounded-xl bg-[#111724] border border-slate-700 focus-within:border-violet-500 transition-colors p-2 space-y-2">
          <textarea
            ref={textareaRef}
            rows={2}
            dir="ltr"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Wiadomość dla agenta AI"
            placeholder={`Napisz do ${selectedAgentName} (${enginePreference}) lub /exec <komenda>...`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              adjustTextareaHeight(e.currentTarget);
            }}
            onKeyDown={handleKeyDown}
            onFocus={(e) => {
              const target = e.currentTarget;
              setTimeout(() => target.scrollIntoView({ block: "nearest", behavior: "smooth" }), 120);
            }}
            style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
            className="w-full min-h-[52px] max-h-[140px] px-2 py-1 bg-transparent text-base sm:text-sm text-white placeholder-slate-400 caret-violet-400 focus:outline-none resize-none leading-relaxed font-sans"
          />

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="vision-upload-micro"
                className="min-h-10 min-w-10 px-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-[#0b0f18] hover:bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer transition-colors shrink-0 text-xs"
                title="Wgraj obraz (Vision lub edycja/wariant)"
              >
                <ImageIcon className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline text-[11px]">Obraz</span>
                <input
                  id="vision-upload-micro"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={onLoadVisionSample}
                className="min-h-10 px-2.5 rounded-lg bg-[#0b0f18] hover:bg-slate-800 border border-slate-700 text-cyan-400 text-xs font-mono-tabular transition-colors shrink-0 hidden sm:flex items-center gap-1"
                title="Przetestuj Real Vision za pomocą przykładowego obrazu"
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="text-[11px]">Test Vision</span>
              </button>

              <button
                type="button"
                onClick={onExecRoot}
                disabled={sending}
                className="min-h-10 px-2.5 flex items-center justify-center gap-1 rounded-lg bg-[#0b0f18] hover:bg-slate-800 border border-slate-700 text-emerald-400 text-xs font-mono-tabular transition-colors shrink-0"
                title="Wykonaj polecenie ROOT (/exec id)"
                aria-label="Wykonaj /exec"
              >
                <Terminal className="w-4 h-4" />
                <span className="text-[11px]">/exec</span>
              </button>
            </div>

            {sending ? (
              <button
                type="button"
                onClick={onStopStreaming}
                className="min-h-10 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Zatrzymaj</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!text.trim() && !imagePreviewName}
                className="min-h-10 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Wyślij</span>
              </button>
            )}
          </div>
        </div>
      </form>
    );
  }
);
ChatInputBar.displayName = "ChatInputBar";

export const ChatWorkView: React.FC<ChatWorkViewProps> = ({
  overview,
  selectedAgent,
  onSelectAgent,
  onRefresh,
}) => {
  const [sending, setSending] = useState<boolean>(false);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [streamingEngine, setStreamingEngine] = useState<string>("");
  const [clearing, setClearing] = useState<boolean>(false);
  const [unlocking, setUnlocking] = useState<boolean>(false);
  const [startingOllama, setStartingOllama] = useState<boolean>(false);
  const [showOllamaConfig, setShowOllamaConfig] = useState<boolean>(false);
  const [ollamaEndpointInput, setOllamaEndpointInput] = useState<string>(
    overview?.ollama_status?.endpoint || "http://127.0.0.1:11434"
  );
  const [savingOllamaConfig, setSavingOllamaConfig] = useState<boolean>(false);
  const [generatingImage, setGeneratingImage] = useState<boolean>(false);
  const [showImageGenPanel, setShowImageGenPanel] = useState<boolean>(false);
  const [imagePromptInput, setImagePromptInput] = useState<string>("");
  const [imageAspectRatio, setImageAspectRatio] = useState<"1:1" | "16:9" | "9:16" | "4:3">("1:1");
  const [showImageGallery, setShowImageGallery] = useState<boolean>(false);
  const [imageHistory, setImageHistory] = useState<GeneratedImageItem[]>(overview?.images || []);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [enginePreference, setEnginePreference] = useState<OllamaEngineChoice>("auto");
  const [filterByAgent, setFilterByAgent] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showCanvasDrawer, setShowCanvasDrawer] = useState<boolean>(false);
  const [showMobileTools, setShowMobileTools] = useState<boolean>(false);
  const [localMessages, setLocalMessages] = useState<ChatMessageRecord[]>([]);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>("image/jpeg");
  const [imagePreviewName, setImagePreviewName] = useState<string>("");
  const [activeArtifact, setActiveArtifact] = useState<{
    title: string;
    code: string;
    output?: string;
  }>({
    title: "svl_kernel.py — biblioteka matematyczna SVL",
    code: `from svl_kernel import SVLSystemKernel\n\nkernel = SVLSystemKernel()\nprint(kernel.generate_system_status_report())`,
  });
  const [executingArtifact, setExecutingArtifact] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isFullscreen) return;
    const exitFullscreen = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", exitFullscreen);
    return () => window.removeEventListener("keydown", exitFullscreen);
  }, [isFullscreen]);

  useEffect(() => {
    const serverChats = overview?.host?.db?.chats || [];
    setLocalMessages((prev) => {
      const pendingLocal = prev.filter((m) => m.id >= 1_000_000_000_000);
      if (pendingLocal.length === 0) return serverChats;
      const unmatched = pendingLocal.filter(
        (loc) =>
          !serverChats.some(
            (srv) =>
              srv.sender_role === loc.sender_role &&
              srv.agent_id === loc.agent_id &&
              srv.content === loc.content
          )
      );
      return [...serverChats, ...unmatched];
    });
  }, [overview?.host?.db?.chats]);

  useEffect(() => {
    if (overview?.images) {
      setImageHistory(overview.images);
    }
  }, [overview?.images]);

  useEffect(() => {
    const ep = overview?.ollama_status?.endpoint;
    if (ep && !showOllamaConfig) {
      setOllamaEndpointInput(ep);
    }
  }, [overview?.ollama_status?.endpoint, showOllamaConfig]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages.length, selectedAgent, streamingContent]);

  const visibleMessages = filterByAgent
    ? localMessages.filter((m) => m.agent_id === selectedAgent)
    : localMessages;

  const handleProcessImageFile = useCallback((file: File) => {
    setImagePreviewName(file.name);
    setImageMimeType(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, []);

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
    setImageBase64(dataUrl.split(",")[1]);
    setImageMimeType("image/jpeg");
    setImagePreviewName("real_vision_test_pattern.jpg");
    setStatusNotice("Załadowano obraz testowy Real Vision.");
  }, []);

  const handleStopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }, []);

  const handleGenerateRealImage = useCallback(
    async (explicitPrompt?: string) => {
      const prompt = (explicitPrompt ?? imagePromptInput).trim();
      if (!prompt) {
        setErrorMsg("Podaj opis obrazu do wygenerowania.");
        return;
      }
      setGeneratingImage(true);
      setErrorMsg(null);
      setStatusNotice(null);

      try {
        const data = await apiFetchJson<{
          ok: boolean;
          image?: GeneratedImageItem;
          error?: string;
          status?: string;
        }>("/api/images/generate", {
          method: "POST",
          body: JSON.stringify({
            prompt,
            aspectRatio: imageAspectRatio,
            agentId: selectedAgent,
            sourceImageBase64: imageBase64 || undefined,
            sourceImageMimeType: imageBase64 ? imageMimeType : undefined,
          }),
          timeoutMs: 90000,
        });

        if (data.ok && data.image) {
          setShowImageGenPanel(false);
          setImagePromptInput("");
          setImageHistory((prev) => [data.image!, ...prev]);
          setStatusNotice(
            `Wygenerowano obraz (${data.image.source}: ${data.image.model}) i zapisano w SQLite.`
          );
          onRefresh();
        } else {
          setErrorMsg(data.error || "Nie udało się wygenerować obrazu.");
        }
      } catch (err: any) {
        setErrorMsg(err?.message || "Błąd generatora obrazów.");
      } finally {
        setGeneratingImage(false);
      }
    },
    [imagePromptInput, imageAspectRatio, selectedAgent, imageBase64, imageMimeType, onRefresh]
  );

  const sendDirectMessage = useCallback(
    async (textToSend: string) => {
      const trimmed = textToSend.trim();
      if (!trimmed && !imageBase64) return;

      setErrorMsg(null);
      setStatusNotice(null);

      // Direct image generation slash command /img or /obraz
      if (/^\/(img|obraz|imagine)\s+/i.test(trimmed)) {
        const imgPrompt = trimmed.replace(/^\/(img|obraz|imagine)\s+/i, "").trim();
        await handleGenerateRealImage(imgPrompt);
        return;
      }

      if (/^\/exec\b/i.test(trimmed)) {
        const cmd = trimmed.replace(/^\/exec\s*/i, "").trim();
        const optimisticUserMsg: ChatMessageRecord = {
          id: Date.now(),
          session_id: "bastilla-main",
          sender_role: "user",
          agent_id: selectedAgent,
          engine_used: "Operator",
          content: trimmed,
          created_at: new Date().toISOString(),
        };
        setLocalMessages((prev) => [...prev, optimisticUserMsg]);
        setSending(true);

        try {
          const data = await apiFetchJson<any>("/api/terminal/exec", {
            method: "POST",
            body: JSON.stringify({
              mode: "LINUX_ROOT",
              command: cmd,
              agentUser: selectedAgent,
            }),
          });
          const execOutput = data.ok
            ? `[SERVER uid=${data.execution_identity?.uid ?? "?"} · exit=${data.exitCode ?? 0}]\n$ ${cmd}\n\n${data.stdout || data.stderr || "[Brak wyjścia (exit=0)]"}`
            : `[BŁĄD WYKONANIA · exit=${data.exitCode || 1}]\n$ ${cmd}\n\n${data.error || data.stderr || data.stdout || "Nieznany błąd powłoki."}`;

          setLocalMessages((prev) => [
            ...prev,
            {
              id: Date.now() + 1,
              session_id: "bastilla-main",
              sender_role: "assistant",
              agent_id: selectedAgent,
              engine_used: "Powłoka serwera",
              content: execOutput,
              created_at: new Date().toISOString(),
            },
          ]);
          onRefresh();
        } catch (err: any) {
          setErrorMsg(err?.message || "Błąd wykonania komendy systemowej.");
        } finally {
          setSending(false);
        }
        return;
      }

      const effectivePrompt =
        trimmed || "Przeanalizuj ten obraz w trybie Real Vision i opisz co przedstawia.";
      const optimisticUserMsg: ChatMessageRecord = {
        id: Date.now(),
        session_id: "bastilla-main",
        sender_role: "user",
        agent_id: selectedAgent,
        engine_used: "Operator",
        content: trimmed || "[Przesłano obraz do analizy Real Vision]",
        created_at: new Date().toISOString(),
      };

      setLocalMessages((prev) => [...prev, optimisticUserMsg]);
      setSending(true);
      setStreamingContent("");
      setStreamingEngine(enginePreference);

      const controller = new AbortController();
      streamAbortRef.current = controller;

      try {
        const res = await fetch(buildApiUrl("/api/chat/stream"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            agentId: selectedAgent,
            sessionId: "bastilla-main",
            message: effectivePrompt,
            imageBase64,
            imageMimeType,
            enginePreference: imageBase64 ? "llama3.2-vision:11b" : enginePreference,
          }),
        });

        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        if (!res.ok || contentType.includes("text/html")) {
          if (contentType.includes("application/json")) {
            const errJson = await res.json();
            throw new Error(errJson?.error || `HTTP ${res.status}`);
          }
          throw new Error(
            contentType.includes("text/html")
              ? `Serwer zwrócił HTML (HTTP ${res.status}) zamiast strumienia API.`
              : `Błąd strumienia czatu (HTTP ${res.status})`
          );
        }

        if (!res.body) {
          throw new Error("Brak strumienia danych z serwera.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assembled = "";
        let finalDonePayload: any = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const dataLines = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim());
            if (!dataLines.length) continue;
            const rawJson = dataLines.join("\n");
            let evt: any = null;
            try {
              evt = JSON.parse(rawJson);
            } catch {
              continue;
            }
            if (
              (evt.type === "chunk" && typeof evt.text === "string") ||
              (evt.type === "token" && typeof evt.token === "string")
            ) {
              assembled += evt.text ?? evt.token ?? "";
              setStreamingContent(assembled);
            } else if (evt.type === "start" || evt.type === "meta") {
              if (evt.engine || evt.enginePreference) {
                setStreamingEngine(evt.engine || evt.enginePreference);
              }
            } else if (evt.type === "done") {
              finalDonePayload = evt;
            } else if (evt.type === "error") {
              throw new Error(evt.error || "Błąd modelu podczas strumieniowania.");
            }
          }
        }

        setImageBase64(null);
        setImagePreviewName("");

        const finalText = (
          finalDonePayload?.assistantMessageRecord?.content ??
          finalDonePayload?.reply ??
          assembled
        ).trim();
        if (finalText) {
          setLocalMessages((prev) => {
            const cleaned = finalDonePayload?.userMessageRecord
              ? prev.map((m) =>
                  m.id === optimisticUserMsg.id ? finalDonePayload.userMessageRecord : m
                )
              : prev;
            const asstRecord: ChatMessageRecord = finalDonePayload?.assistantMessageRecord || {
              id: finalDonePayload?.asstId || Date.now() + 2,
              session_id: "bastilla-main",
              sender_role: "assistant",
              agent_id: selectedAgent,
              engine_used:
                finalDonePayload?.engineUsed || streamingEngine || enginePreference,
              content: finalText,
              artifact_title: finalDonePayload?.artifactTitle,
              artifact_code: finalDonePayload?.artifactCode,
              created_at: finalDonePayload?.createdAt || new Date().toISOString(),
            };
            return [...cleaned, asstRecord];
          });
        }
        if (finalDonePayload?.artifactCode) {
          setActiveArtifact({
            title: finalDonePayload.artifactTitle || "Artefakt Kodu ChatGPT Work",
            code: finalDonePayload.artifactCode,
          });
        }
        onRefresh();
      } catch (err: any) {
        if (err?.name === "AbortError") {
          setStatusNotice("Generowanie odpowiedzi zatrzymane przez Operatora.");
        } else {
          setErrorMsg(err?.message || "Błąd komunikacji z silnikiem AI.");
        }
      } finally {
        streamAbortRef.current = null;
        setStreamingContent("");
        setSending(false);
      }
    },
    [
      imageBase64,
      imageMimeType,
      selectedAgent,
      enginePreference,
      onRefresh,
      handleGenerateRealImage,
      streamingEngine,
    ]
  );

  const handleRegenerateMessage = useCallback(
    (msgIndex: number) => {
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (visibleMessages[i]?.sender_role === "user") {
          void sendDirectMessage(visibleMessages[i].content);
          return;
        }
      }
      setErrorMsg("Nie znaleziono poprzedniego promptu Operatora do regeneracji.");
    },
    [visibleMessages, sendDirectMessage]
  );

  const handleClearMessages = async (clearAll: boolean) => {
    setClearing(true);
    setErrorMsg(null);
    try {
      const data = await apiFetchJson<any>("/api/chat/clear", {
        method: "POST",
        body: JSON.stringify(clearAll ? { clearAll: true } : { agentId: selectedAgent }),
      });
      if (data.ok) {
        if (clearAll) {
          setLocalMessages([]);
          setStatusNotice("Wyczyszczono wszystkie wiadomości czatu w SQLite.");
        } else {
          setLocalMessages((prev) => prev.filter((m) => m.agent_id !== selectedAgent));
          setStatusNotice(`Wyczyszczono historię dla: ${AGENT_LABELS[selectedAgent].name}.`);
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
      const data = await apiFetchJson<any>("/api/chat/clear", {
        method: "POST",
        body: JSON.stringify({ messageId }),
      });
      if (data.ok) {
        setLocalMessages((prev) => prev.filter((m) => m.id !== messageId));
        onRefresh();
      }
    } catch {}
  };

  const handleStartOllama = async () => {
    setStartingOllama(true);
    setErrorMsg(null);
    try {
      const data = await apiFetchJson<{ ok: boolean; started?: boolean; message?: string; error?: string }>(
        "/api/ollama/start",
        { method: "POST", body: "{}", timeoutMs: 15000 }
      );
      if (data.ok) {
        setStatusNotice(data.message || "Zaktualizowano stan demona Ollama.");
      } else {
        setErrorMsg(data.error || data.message || "Nie udało się uruchomić Ollama.");
      }
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Błąd uruchamiania Ollama.");
    } finally {
      setStartingOllama(false);
    }
  };

  const handleSaveOllamaEndpoint = async (endpointOverride?: string) => {
    const nextValue = (endpointOverride !== undefined ? endpointOverride : ollamaEndpointInput).trim();
    setSavingOllamaConfig(true);
    setErrorMsg(null);
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        state?: string;
        endpoint?: string;
        modelNames?: string[];
        message?: string;
        error?: string;
      }>("/api/ollama/config", {
        method: "POST",
        body: JSON.stringify({ endpoint: nextValue }),
        timeoutMs: 10000,
      });
      if (data.endpoint) setOllamaEndpointInput(data.endpoint);
      if (data.state === "READY" || data.state === "ONLINE") {
        setStatusNotice(
          `Ollama ${data.state} (${data.endpoint}) · Modele: ${(data.modelNames || []).join(", ") || "brak"}`
        );
        setShowOllamaConfig(false);
      } else {
        setStatusNotice(data.message || `Zapisano adres Ollama: ${data.endpoint} (${data.state})`);
      }
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Nie udało się zapisać adresu Ollama.");
    } finally {
      setSavingOllamaConfig(false);
    }
  };

  const handleUnlockSystemAndRoot = async () => {
    setUnlocking(true);
    setErrorMsg(null);
    try {
      const data = await apiFetchJson<any>("/api/system/unlock", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (data.ok) {
        setStatusNotice(
          `ODBLOKOWANO: ${data.operator} · ${data.operator_privileges || "SUPREME_ROOT"}`
        );
        onRefresh();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Nie można zmienić uprawnień przez panel.");
    } finally {
      setUnlocking(false);
    }
  };

  const handleComponentAction = useCallback(
    (actionType: string, payload: any) => {
      if (actionType === "generate_image") {
        setImagePromptInput(typeof payload === "string" ? payload : "");
        setShowImageGenPanel(true);
      } else if (actionType === "exec_root" || actionType === "command") {
        void sendDirectMessage(`/exec ${payload}`);
      } else if (actionType === "exec_python") {
        void sendDirectMessage(`/exec python3 -c "${payload}"`);
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
          void sendDirectMessage(`/exec ${payload.payload}`);
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
    (
      sampleType:
        | "mermaid"
        | "chart"
        | "buttons"
        | "table"
        | "telemetry"
        | "continuous_mission"
    ) => {
      if (sampleType === "continuous_mission") {
        void sendDirectMessage("Pokaż status ciągłej misji automatycznej agentów AI");
      } else if (sampleType === "mermaid") {
        void sendDirectMessage("Wygeneruj diagram Mermaid procesu Telemetry-Relay-Loop");
      } else if (sampleType === "chart") {
        void sendDirectMessage("Wygeneruj wykres Recharts przepustowości magistrali");
      } else if (sampleType === "buttons") {
        void sendDirectMessage("Wygeneruj przyciski szybkich akcji procedur ROOT");
      } else if (sampleType === "table") {
        void sendDirectMessage("Wygeneruj tabelę daemonów i procesów systemu");
      } else if (sampleType === "telemetry") {
        void sendDirectMessage("Pokaż telemetrię jądra i status pamięci RAM");
      }
    },
    [sendDirectMessage]
  );

  const handleRunArtifactInPythonRoot = async () => {
    setExecutingArtifact(true);
    try {
      const data = await apiFetchJson<any>("/api/terminal/exec", {
        method: "POST",
        body: JSON.stringify({
          mode: "PYTHON_ROOT",
          command: activeArtifact.code,
        }),
      });
      setActiveArtifact((prev) => ({
        ...prev,
        output: data.stdout || data.stderr || data.error || "Wykonano pomyślnie.",
      }));
      onRefresh();
    } catch (err: any) {
      setActiveArtifact((prev) => ({
        ...prev,
        output: err?.message || "Błąd wykonania artefaktu.",
      }));
    } finally {
      setExecutingArtifact(false);
    }
  };

  const ollamaState =
    overview?.ollama_status?.state ||
    overview?.ai_routing?.ollama_state ||
    (overview?.ai_routing?.ollama_online ? "ONLINE" : "OFFLINE");
  const activeImageEngine = overview?.image_status?.activeSource
    ? `${overview.image_status.activeSource} (${overview.image_status.activeModel || "model"})`
    : "BRAK SILNIKA";

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 bg-[#07090e] flex flex-col w-screen h-[100dvh] overflow-hidden text-slate-100"
          : "w-full flex-1 min-h-0 bg-[#07090e] flex flex-col overflow-hidden text-slate-100"
      }
    >
      {/* Compact Header Toolbar */}
      <div className="border-b border-slate-800 bg-[#0a0d14] px-3 py-1.5 shrink-0 space-y-1.5">
        {/* Row 1: Agent Selector + Status + Quick Controls */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar min-w-0">
            {(["aria", "alex", "astyria", "aurelius", "council"] as const).map((id) => {
              const info = AGENT_LABELS[id];
              const active = selectedAgent === id;
              const count = localMessages.filter((m) => m.agent_id === id).length;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectAgent(id)}
                  className={`min-h-9 sm:min-h-7 px-2.5 rounded-md border text-xs sm:text-[11px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    active
                      ? "bg-violet-600/30 border-violet-500 text-white"
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
                  {count > 0 && (
                    <span className="text-[10px] text-violet-300 font-mono-tabular">
                      ({count})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowImageGallery((v) => !v)}
              className={`min-h-9 sm:min-h-7 px-2 rounded-md border text-[11px] font-mono-tabular flex items-center gap-1 whitespace-nowrap ${
                showImageGallery
                  ? "bg-cyan-700/40 border-cyan-500 text-white"
                  : "bg-[#111723] border-slate-700 text-slate-300"
              }`}
              title="Galeria wygenerowanych obrazów"
            >
              <Images className="w-3.5 h-3.5 text-cyan-300" />
              <span className="hidden md:inline">Galeria ({imageHistory.length})</span>
            </button>

            <button
              type="button"
              onClick={handleUnlockSystemAndRoot}
              disabled={unlocking}
              className="min-h-9 sm:min-h-7 px-2 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 text-[10px] font-mono-tabular hidden sm:flex items-center gap-1 whitespace-nowrap"
              title="Uprawnienia procesu serwera"
            >
              <Unlock className="w-3 h-3" />
              <span className="hidden md:inline">Sprawdź dostęp</span>
            </button>

            <button
              type="button"
              onClick={() => setShowMobileTools((v) => !v)}
              aria-label="Narzędzia czatu i model"
              className="min-h-9 min-w-9 flex items-center justify-center rounded-md bg-[#111723] border border-slate-700 text-slate-300 text-[10px] font-mono-tabular sm:hidden"
            >
              <Menu className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowCanvasDrawer((v) => !v)}
              className={`min-h-9 sm:min-h-7 px-2 rounded-md border text-[10px] font-mono-tabular hidden sm:flex items-center gap-1 whitespace-nowrap ${
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
              aria-label={isFullscreen ? "Wyłącz pełny ekran" : "Włącz pełny ekran"}
              className="min-h-9 sm:min-h-7 px-2.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Normalny</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Pełny Ekran</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Row 2: Model selector + truthful Ollama state + Image engine status + Clear */}
        <div
          className={`flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60 ${
            showMobileTools ? "flex" : "hidden sm:flex"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[200px]">
            <span className="text-[11px] text-slate-400 font-mono-tabular">
              Model:
            </span>
            <select
              aria-label="Wybór modelu AI"
              value={enginePreference}
              onChange={(e) => setEnginePreference(e.target.value as OllamaEngineChoice)}
              className="min-h-8 sm:min-h-6 px-2 rounded bg-[#07090e] border border-violet-500/50 text-[11px] font-mono-tabular text-white focus:outline-none focus:border-violet-400 max-w-[220px] sm:max-w-none"
            >
              <option value="auto">Auto (Ollama → Gemini)</option>
              {(overview?.ai_routing.available_models || []).map((model) => (
                <option key={model} value={model}>
                  Ollama: {model}
                </option>
              ))}
              <option value="gemini">Gemini API</option>
            </select>

            <span
              className={`text-[10px] font-mono-tabular font-semibold ${
                ollamaState === "READY" || ollamaState === "ONLINE"
                  ? "text-emerald-400"
                  : ollamaState === "BUSY" || ollamaState === "MODEL LOADING"
                  ? "text-cyan-300"
                  : "text-amber-300"
              }`}
            >
              Ollama: {ollamaState}
            </span>

            {(ollamaState === "OFFLINE" || ollamaState === "ERROR") && (
              <button
                type="button"
                onClick={handleStartOllama}
                disabled={startingOllama}
                className="min-h-8 sm:min-h-6 px-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] font-mono-tabular text-cyan-300"
              >
                {startingOllama ? "Uruchamianie..." : "Uruchom Ollamę"}
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowOllamaConfig((v) => !v)}
              aria-label="Konfiguruj endpoint Ollama"
              className={`min-h-8 sm:min-h-6 px-2 rounded border text-[10px] font-mono-tabular flex items-center gap-1 ${
                showOllamaConfig
                  ? "bg-violet-700/40 border-violet-500 text-white"
                  : "bg-[#111723] border-slate-700 text-slate-300 hover:border-slate-500"
              }`}
              title="Ustaw lokalny lub zdalny adres OLLAMA_BASE_URL"
            >
              <Settings2 className="w-3 h-3 text-violet-300" />
              <span>Endpoint</span>
            </button>

            <span className="text-[10px] font-mono-tabular text-slate-400">
              · Obrazy: <span className="text-cyan-300">{activeImageEngine}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterByAgent((v) => !v)}
              className="min-h-8 sm:min-h-6 px-2 rounded bg-[#111723] border border-slate-800 text-[10px] font-mono-tabular text-slate-300 hover:text-white"
            >
              {filterByAgent ? "Ten agent" : "Wszystkie"}
            </button>

            <button
              type="button"
              onClick={() => handleClearMessages(false)}
              disabled={clearing}
              className="min-h-8 sm:min-h-6 px-2 rounded bg-rose-950/50 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-[10px] font-medium flex items-center gap-1 whitespace-nowrap"
            >
              <Trash2 className="w-2.5 h-2.5" />
              Wyczyść kanał
            </button>

            <button
              type="button"
              onClick={() => handleClearMessages(true)}
              disabled={clearing}
              className="min-h-8 sm:min-h-6 px-2 rounded bg-rose-700/80 hover:bg-rose-600 text-white text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap"
            >
              Wyczyść wszystko
            </button>
          </div>
        </div>

        {/* Row 3 (Collapsible): Live OLLAMA_BASE_URL Endpoint Configuration */}
        {showOllamaConfig && (
          <div className="pt-1.5 border-t border-slate-800/70 space-y-1 text-[11px]">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="font-mono-tabular text-slate-300 shrink-0">
                OLLAMA_BASE_URL:
              </span>
              <input
                type="url"
                aria-label="Adres URL serwera Ollama"
                value={ollamaEndpointInput}
                onChange={(e) => setOllamaEndpointInput(e.target.value)}
                placeholder="http://127.0.0.1:11434 lub https://twoja-ollama.trycloudflare.com"
                className="flex-1 min-h-8 sm:min-h-7 px-2.5 rounded bg-[#07090e] border border-slate-700 text-white font-mono-tabular text-xs focus:outline-none focus:border-violet-500"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleSaveOllamaEndpoint()}
                  disabled={savingOllamaConfig}
                  className="min-h-8 sm:min-h-7 px-3 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold"
                >
                  {savingOllamaConfig ? "Łączenie..." : "Połącz / Zapisz"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveOllamaEndpoint("")}
                  disabled={savingOllamaConfig}
                  className="min-h-8 sm:min-h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                >
                  Domyślny
                </button>
                <button
                  type="button"
                  onClick={() => setShowOllamaConfig(false)}
                  aria-label="Zamknij konfigurację Ollama"
                  className="min-h-8 sm:min-h-7 px-2 rounded bg-slate-900 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {overview?.ollama_status?.message && (
              <div className="text-[10px] text-amber-300/90 font-mono-tabular leading-snug">
                {overview.ollama_status.message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inline Real Image Generator Drawer / Panel */}
      {showImageGenPanel && (
        <div className="border-b border-cyan-800/50 bg-[#0b101b] px-3 sm:px-6 py-3 space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-cyan-200 flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-cyan-400" />
              <span>Generator Obrazów (Silnik: {activeImageEngine})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowImageGenPanel(false)}
              aria-label="Zamknij generator obrazów"
              className="min-h-8 min-w-8 flex items-center justify-center rounded bg-slate-800 text-slate-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={imagePromptInput}
              onChange={(e) => setImagePromptInput(e.target.value)}
              placeholder="Opisz obraz do wygenerowania..."
              aria-label="Prompt do generowania obrazu"
              className="flex-1 min-h-11 px-3 py-2 rounded-md bg-[#07090e] border border-slate-700 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500"
            />
            <select
              aria-label="Proporcje obrazu"
              value={imageAspectRatio}
              onChange={(e) => setImageAspectRatio(e.target.value as any)}
              className="min-h-11 px-3 rounded-md bg-[#07090e] border border-slate-700 text-xs font-mono-tabular text-white"
            >
              <option value="1:1">1:1 Kwadrat</option>
              <option value="16:9">16:9 Panorama</option>
              <option value="9:16">9:16 Pion</option>
              <option value="4:3">4:3 Klasyczny</option>
            </select>
            <button
              type="button"
              onClick={() => void handleGenerateRealImage()}
              disabled={generatingImage || !imagePromptInput.trim()}
              className="min-h-11 px-4 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap"
            >
              {generatingImage ? "Generowanie..." : imageBase64 ? "Generuj wariant/edycję" : "Generuj teraz"}
            </button>
          </div>
          {imageBase64 && (
            <div className="text-[11px] font-mono-tabular text-cyan-300">
              Tryb edycji aktywny z załączonym obrazem: {imagePreviewName}
            </div>
          )}
        </div>
      )}

      {/* Collapsible Gallery Drawer */}
      {showImageGallery && (
        <div className="border-b border-slate-800 bg-[#090d16] px-3 sm:px-6 py-3 max-h-64 overflow-y-auto shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-white">
              Historia wygenerowanych obrazów ({imageHistory.length})
            </span>
            <button
              type="button"
              onClick={() => setShowImageGallery(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Zamknij
            </button>
          </div>
          {imageHistory.length === 0 ? (
            <p className="text-xs text-slate-400">
              Brak wygenerowanych obrazów w bazie SQLite.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {imageHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-1.5 rounded-lg bg-[#0c1018] border border-slate-800 space-y-1"
                >
                  <img
                    src={buildApiUrl(`${item.url || `/api/images/file/${item.id}`}?t=${encodeURIComponent(item.created_at)}`)}
                    alt={item.prompt}
                    referrerPolicy="no-referrer"
                    className="w-full h-20 object-cover rounded"
                  />
                  <div className="text-[10px] text-slate-300 truncate">{item.prompt}</div>
                  <div className="text-[9px] font-mono-tabular text-slate-400 truncate">
                    {item.source} · {item.mime_type}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Full-Width Chat Stage + Collapsible Drawer */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <section className="flex-1 flex flex-col justify-between min-w-0 h-full">
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 space-y-3">
            {statusNotice && (
              <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-700/60 text-xs text-emerald-200 font-mono-tabular flex items-center justify-between">
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

            {visibleMessages.length === 0 && !streamingContent && (
              <div className="p-4 rounded-xl bg-[#0e131d] border border-slate-800 text-xs text-slate-300 font-mono-tabular space-y-2">
                <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  Kanał: {AGENT_LABELS[selectedAgent].name} ({AGENT_LABELS[selectedAgent].uid})
                </div>
                <div className="text-slate-400">
                  Silnik: <span className="text-white">{enginePreference}</span> · Ollama:{" "}
                  <span className="text-cyan-300">{ollamaState}</span> · Komendy:{" "}
                  <span className="text-cyan-300">/exec &lt;komenda&gt;</span> lub{" "}
                  <span className="text-cyan-300">/img &lt;opis&gt;</span>
                </div>
              </div>
            )}

            {visibleMessages.map((msg, msgIdx) => {
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
                      <span className="text-violet-400 truncate">· {msg.engine_used}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {msg.sender_role === "assistant" && (
                        <button
                          type="button"
                          onClick={() => handleRegenerateMessage(msgIdx)}
                          disabled={sending}
                          className="text-slate-400 hover:text-cyan-300 px-1.5 py-0.5 rounded text-[11px] flex items-center gap-1"
                          title="Regeneruj odpowiedź"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Regeneruj</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteSingleMessage(msg.id)}
                        className="text-slate-500 hover:text-rose-400 px-1.5 py-0.5 rounded text-[11px]"
                        title="Usuń tę wiadomość"
                      >
                        Usuń
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {segments.map((seg, sIdx) =>
                      seg.type === "text" ? (
                        <FormattedMarkdownText
                          key={`txt-${sIdx}`}
                          text={seg.text}
                          onExecuteCommand={(cmd) => void sendDirectMessage(cmd)}
                        />
                      ) : (
                        <GenerativeComponentRenderer
                          key={seg.component.id || `comp-${sIdx}`}
                          type={seg.component.type}
                          props={seg.component.props}
                          onExecuteCommand={(cmd) => void sendDirectMessage(cmd)}
                          onAction={handleComponentAction}
                        />
                      )
                    )}
                  </div>

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

            {sending && (
              <div className="p-3 sm:p-4 rounded-xl border bg-[#0e131d] border-cyan-800/60 mr-auto max-w-[98%] sm:max-w-4xl space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono-tabular text-cyan-300">
                  <span>
                    Agent {selectedAgent.toUpperCase()} · {streamingEngine || enginePreference} (Strumieniowanie)
                  </span>
                  <button
                    type="button"
                    onClick={handleStopStreaming}
                    className="text-rose-300 hover:text-rose-200 underline"
                  >
                    Zatrzymaj
                  </button>
                </div>
                <FormattedMarkdownText
                  text={streamingContent || "Łączenie z silnikiem modelu..."}
                  onExecuteCommand={(cmd) => void sendDirectMessage(cmd)}
                />
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/70 text-xs text-rose-200 flex items-start gap-2 font-mono-tabular">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>{errorMsg}</div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <ChatInputBar
            onSend={sendDirectMessage}
            onStopStreaming={handleStopStreaming}
            onExecRoot={() => void sendDirectMessage("/exec id && whoami && uname -srmo")}
            onUploadImage={handleProcessImageFile}
            onLoadVisionSample={handleLoadVisionSample}
            onTriggerGenerativeSample={handleTriggerGenerativeSample}
            onOpenImageGenModal={(prefill) => {
              if (prefill) setImagePromptInput(prefill);
              setShowImageGenPanel(true);
            }}
            imagePreviewName={imagePreviewName}
            onClearImage={() => {
              setImageBase64(null);
              setImagePreviewName("");
            }}
            sending={sending}
            generatingImage={generatingImage}
            selectedAgentName={AGENT_LABELS[selectedAgent].name}
            enginePreference={enginePreference}
          />
        </section>

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
              <span>Sprawdź dostęp</span>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
