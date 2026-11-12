import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { Copy, Check, Maximize2, Minimize2, Download, RefreshCw, Code2 } from "lucide-react";

interface MermaidDiagramProps {
  code: string;
  title?: string;
}

let mermaidInitialized = false;

function getMermaidApi() {
  return (mermaid as any).default || mermaid;
}

function initMermaidOnce() {
  if (!mermaidInitialized && typeof window !== "undefined") {
    try {
      const api = getMermaidApi();
      api.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          darkMode: true,
          background: "#0c1018",
          primaryColor: "#8b5cf6",
          primaryTextColor: "#ffffff",
          primaryBorderColor: "#7c3aed",
          lineColor: "#06b6d4",
          secondaryColor: "#111723",
          tertiaryColor: "#07090e",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        },
        securityLevel: "strict",
        suppressErrorRendering: true,
      });
      mermaidInitialized = true;
    } catch (e) {
      console.warn("Mermaid init notice:", e);
    }
  }
}

/**
 * Normalizes mermaid code to prevent common parser syntax errors
 */
function sanitizeMermaidCode(raw: string): string {
  let cleaned = raw.trim();
  // Strip outer markdown fences if present
  cleaned = cleaned.replace(/^```(?:mermaid)?\s*\n?/i, "").replace(/\n?```$/i, "");
  // Unescape common HTML entities
  cleaned = cleaned
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
  return cleaned.trim();
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({
  code,
  title = "Diagram Architektury Bastilla OS",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svgHtml, setSvgHtml] = useState<string>("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isZoomed, setIsZoomed] = useState<boolean>(false);
  const [showCode, setShowCode] = useState<boolean>(false);

  const cleanCode = sanitizeMermaidCode(code);

  useEffect(() => {
    initMermaidOnce();
    let isMounted = true;
    // Generate valid DOM ID without special chars or hyphens for mermaid
    const renderId = `mermaid_diag_${Math.random().toString(36).substring(2, 10)}`;

    async function renderDiagram() {
      try {
        setRenderError(null);
        const api = getMermaidApi();
        const { svg } = await api.render(renderId, cleanCode);
        if (isMounted) {
          setSvgHtml(svg);
        }
      } catch (err: any) {
        if (isMounted) {
          // Clean up dangling temp element if mermaid left one behind
          const dangling = document.getElementById(renderId);
          if (dangling) dangling.remove();
          setRenderError(err?.message || "Błąd generowania diagramu");
        }
      }
    }

    renderDiagram();

    return () => {
      isMounted = false;
    };
  }, [cleanCode]);

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(cleanCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!svgHtml) return;
    const blob = new Blob([svgHtml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/\s+/g, "_")}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-3 rounded-xl bg-[#0c1018] border border-violet-500/40 my-2 space-y-2 shadow-lg">
      {/* Header with Title and Interactive Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-xs font-semibold text-slate-100 font-display">
            {title}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-violet-950/70 border border-violet-700/60 text-[10px] text-violet-300 font-mono-tabular">
            INTERAKTYWNY SVG
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            className="p-1 rounded bg-[#111723] hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
            title="Pokaż / Ukryj źródło Mermaid"
          >
            <Code2 className="w-3 h-3 text-cyan-400" />
            <span className="hidden sm:inline">Kod</span>
          </button>

          <button
            type="button"
            onClick={handleCopyCode}
            className="p-1 rounded bg-[#111723] hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
            title="Kopiuj kod diagramu"
          >
            {copied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3 text-slate-400" />
            )}
            <span className="hidden sm:inline">{copied ? "Skopiowano" : "Kopiuj"}</span>
          </button>

          {svgHtml && (
            <button
              type="button"
              onClick={handleDownloadSvg}
              className="p-1 rounded bg-[#111723] hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
              title="Pobierz plik SVG"
            >
              <Download className="w-3 h-3 text-emerald-400" />
              <span className="hidden sm:inline">SVG</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsZoomed((v) => !v)}
            className="p-1 rounded bg-[#111723] hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
            title={isZoomed ? "Zmniejsz widok" : "Powiększ na pełny ekran"}
          >
            {isZoomed ? (
              <Minimize2 className="w-3 h-3 text-violet-400" />
            ) : (
              <Maximize2 className="w-3 h-3 text-violet-400" />
            )}
          </button>
        </div>
      </div>

      {/* Code Toggle View */}
      {showCode && (
        <div className="p-2.5 rounded bg-[#07090e] border border-slate-800 text-[11px] font-mono-tabular">
          <div className="text-[10px] text-slate-400 mb-1">ŹRÓDŁO MERMAID:</div>
          <pre className="whitespace-pre-wrap text-slate-300 max-h-36 overflow-y-auto">{cleanCode}</pre>
        </div>
      )}

      {/* Render Area */}
      {renderError ? (
        <div className="p-3 rounded bg-amber-950/20 border border-amber-800/50 text-[11px] font-mono-tabular space-y-1.5">
          <div className="text-amber-400 font-semibold flex items-center gap-1.5">
            <span>Schemat logiczny (podgląd kodu):</span>
          </div>
          <pre className="whitespace-pre-wrap text-slate-200 p-2 rounded bg-[#07090e] max-h-48 overflow-y-auto">
            {cleanCode}
          </pre>
          <div className="text-[10px] text-slate-500">
            Uwaga: Diagram zawiera niestandardowe znaczniki ({renderError}). Kod został zachowany.
          </div>
        </div>
      ) : svgHtml ? (
        <div
          ref={containerRef}
          className={`overflow-x-auto py-2 flex justify-center bg-[#07090e]/60 rounded-lg p-2 [&_svg]:max-w-full [&_svg]:h-auto transition-all ${
            isZoomed ? "fixed inset-4 z-50 bg-[#07090e]/95 border border-violet-500 p-6 flex flex-col justify-center items-center backdrop-blur-md" : ""
          }`}
        >
          {isZoomed && (
            <div className="w-full flex justify-between items-center mb-2 pb-2 border-b border-slate-800">
              <span className="text-sm font-bold text-white">{title} (Pełny Rozmiar)</span>
              <button
                type="button"
                onClick={() => setIsZoomed(false)}
                className="px-3 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
              >
                Zamknij podgląd
              </button>
            </div>
          )}
          <div
            className="w-full flex justify-center overflow-auto"
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        </div>
      ) : (
        <div className="p-4 text-center text-xs text-violet-400 font-mono-tabular animate-pulse">
          Renderowanie wektorowego diagramu SVG...
        </div>
      )}
    </div>
  );
};
