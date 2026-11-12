import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GoogleGenAI } from "@google/genai";
import { redact } from "./security";

export interface ImageEngineCapability {
  id: "comfyui" | "local" | "gemini";
  label: string;
  configured: boolean;
  reachable: boolean;
  model: string;
  endpoint?: string;
  error?: string;
}

export interface ImageEnginesStatus {
  engineStatus: "READY" | "BRAK SILNIKA" | "ERROR";
  activeSource: "comfyui" | "local" | "gemini" | null;
  activeModel: string | null;
  engines: Record<"comfyui" | "local" | "gemini", ImageEngineCapability>;
  message: string;
  checkedAt: string;
}

export interface GeneratedImageRecord {
  id: string;
  prompt: string;
  mode: "generate" | "edit" | "variation";
  agent_id: string;
  model: string;
  source: string;
  mime_type: string;
  file_path: string;
  byte_size: number;
  duration_ms: number;
  status: "completed" | "failed";
  error: string;
  created_at: string;
  url?: string;
}

function hasValidImageHeader(buf: Buffer): boolean {
  if (!buf || buf.length < 16) return false;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // WEBP: RIFF....WEBP
  if (
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return true;
  }
  return false;
}

export class ImageGenerationManager {
  private imagesDir: string;

  constructor(private dbPath: string) {
    this.imagesDir = path.join(path.dirname(path.resolve(dbPath)), "generated-images");
    mkdirSync(this.imagesDir, { recursive: true });
    this.ensureTable();
  }

  private withDb<T>(fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA busy_timeout=5000");
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  private ensureTable() {
    this.withDb((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS generated_images (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'generate',
          agent_id TEXT NOT NULL DEFAULT 'astyria',
          model TEXT NOT NULL,
          source TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_path TEXT NOT NULL,
          byte_size INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
      `);
    });
  }

  async probeStatus(): Promise<ImageEnginesStatus> {
    const comfyUrl = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
    const localUrl = (process.env.LOCAL_IMAGE_API_URL || "").trim().replace(/\/+$/, "");
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const geminiConfigured = Boolean(geminiKey && geminiKey !== "MY_GEMINI_API_KEY");
    const geminiImageModel = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-lite-image";

    let comfyReachable = false;
    let comfyErr: string | undefined;
    try {
      const res = await fetch(`${comfyUrl}/system_stats`, {
        signal: AbortSignal.timeout(1200),
      });
      comfyReachable = res.ok;
      if (!res.ok) comfyErr = `HTTP ${res.status}`;
    } catch (e: any) {
      comfyErr = process.env.COMFYUI_URL ? e?.message || "Niedostępny" : "ComfyUI nie jest uruchomiony pod 127.0.0.1:8188";
    }

    let localReachable = false;
    let localErr: string | undefined;
    if (localUrl) {
      try {
        const res = await fetch(`${localUrl}/sdapi/v1/sd-models`, {
          signal: AbortSignal.timeout(1500),
        });
        localReachable = res.ok;
        if (!res.ok) localErr = `HTTP ${res.status}`;
      } catch (e: any) {
        localErr = e?.message || "Brak odpowiedzi lokalnego API obrazów";
      }
    }

    const engines: ImageEnginesStatus["engines"] = {
      comfyui: {
        id: "comfyui",
        label: "ComfyUI Backend",
        configured: Boolean(process.env.COMFYUI_URL),
        reachable: comfyReachable,
        model: process.env.COMFYUI_CHECKPOINT || "sd_xl_base / flux",
        endpoint: comfyUrl,
        error: comfyReachable ? undefined : comfyErr,
      },
      local: {
        id: "local",
        label: "Lokalny Generator Obrazów (SD WebUI / Diffusers)",
        configured: Boolean(localUrl),
        reachable: localReachable,
        model: process.env.LOCAL_IMAGE_MODEL || "local-diffusion",
        endpoint: localUrl || undefined,
        error: localUrl ? (localReachable ? undefined : localErr) : "Brak LOCAL_IMAGE_API_URL",
      },
      gemini: {
        id: "gemini",
        label: "Gemini Image Engine",
        configured: geminiConfigured,
        reachable: geminiConfigured,
        model: geminiImageModel,
        error: geminiConfigured ? undefined : "Brak klucza GEMINI_API_KEY",
      },
    };

    const activeSource = comfyReachable
      ? "comfyui"
      : localReachable
      ? "local"
      : geminiConfigured
      ? "gemini"
      : null;

    const activeModel = activeSource ? engines[activeSource].model : null;
    const engineStatus: ImageEnginesStatus["engineStatus"] = activeSource
      ? "READY"
      : "BRAK SILNIKA";

    return {
      engineStatus,
      activeSource,
      activeModel,
      engines,
      message: activeSource
        ? `Aktywny silnik obrazów: ${engines[activeSource].label} (${activeModel}).`
        : "BRAK SILNIKA: nie wykryto lokalnego ComfyUI, lokalnego generatora ani klucza Gemini Image.",
      checkedAt: new Date().toISOString(),
    };
  }

  listHistory(limit = 30): GeneratedImageRecord[] {
    return this.withDb((db) => {
      const rows = db
        .prepare(
          "SELECT * FROM generated_images ORDER BY created_at DESC LIMIT ?"
        )
        .all(limit) as unknown as GeneratedImageRecord[];
      return rows.map((row) => ({
        ...row,
        url:
          row.status === "completed" && row.file_path
            ? `/api/images/file/${encodeURIComponent(row.id)}?v=${encodeURIComponent(row.created_at)}`
            : undefined,
      }));
    });
  }

  getImageFile(id: string): { buffer: Buffer; mimeType: string; record: GeneratedImageRecord } | null {
    if (!/^[a-f0-9-]{8,64}$/i.test(id)) return null;
    const record = this.withDb(
      (db) =>
        db
          .prepare("SELECT * FROM generated_images WHERE id = ?")
          .get(id) as unknown as GeneratedImageRecord | undefined
    );
    if (!record || record.status !== "completed" || !record.file_path) return null;
    const resolved = path.resolve(record.file_path);
    if (!resolved.startsWith(path.resolve(this.imagesDir) + path.sep)) return null;
    if (!existsSync(resolved)) return null;
    const buffer = readFileSync(resolved);
    if (!buffer.length) return null;
    return { buffer, mimeType: record.mime_type || "image/png", record };
  }

  private saveAuditRecord(record: GeneratedImageRecord) {
    this.withDb((db) => {
      db.prepare(
        `INSERT INTO generated_images
         (id, prompt, mode, agent_id, model, source, mime_type, file_path, byte_size, duration_ms, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id,
        redact(record.prompt).slice(0, 4000),
        record.mode,
        record.agent_id,
        record.model,
        record.source,
        record.mime_type,
        record.file_path,
        record.byte_size,
        record.duration_ms,
        record.status,
        redact(record.error).slice(0, 1000),
        record.created_at
      );
    });
  }

  private async runComfyUi(
    comfyUrl: string,
    prompt: string,
    aspectRatio: string
  ): Promise<{ buffer: Buffer; mimeType: string; model: string }> {
    const checkpoint = process.env.COMFYUI_CHECKPOINT || "v1-5-pruned-emaonly.ckpt";
    const [w, h] =
      aspectRatio === "16:9"
        ? [1024, 576]
        : aspectRatio === "9:16"
        ? [576, 1024]
        : [768, 768];

    const workflow = {
      "3": {
        class_type: "KSampler",
        inputs: {
          seed: Math.floor(Math.random() * 2147483647),
          steps: 20,
          cfg: 7.0,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
      },
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
      "5": { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
      "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, low quality, corrupted", clip: ["4", 1] } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "bastilla", images: ["8", 0] } },
    };

    const queueRes = await fetch(`${comfyUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(10000),
    });
    if (!queueRes.ok) {
      throw new Error(`ComfyUI /prompt odrzucił żądanie (HTTP ${queueRes.status}).`);
    }
    const queueData: any = await queueRes.json();
    const promptId = queueData?.prompt_id;
    if (!promptId) throw new Error("ComfyUI nie zwrócił prompt_id.");

    for (let attempt = 0; attempt < 45; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      const histRes = await fetch(`${comfyUrl}/history/${encodeURIComponent(promptId)}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!histRes.ok) continue;
      const hist: any = await histRes.json();
      const entry = hist?.[promptId];
      const outImages = entry?.outputs?.["9"]?.images;
      if (Array.isArray(outImages) && outImages[0]?.filename) {
        const imgMeta = outImages[0];
        const params = new URLSearchParams({
          filename: imgMeta.filename,
          subfolder: imgMeta.subfolder || "",
          type: imgMeta.type || "output",
        });
        const imgRes = await fetch(`${comfyUrl}/view?${params.toString()}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!imgRes.ok) {
          throw new Error(`ComfyUI /view HTTP ${imgRes.status}`);
        }
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        return {
          buffer,
          mimeType: imgRes.headers.get("content-type") || "image/png",
          model: `comfyui/${checkpoint}`,
        };
      }
    }
    throw new Error("Przekroczono limit czasu generowania obrazu w ComfyUI (45 s).");
  }

  private async runLocalSdWebUi(
    localUrl: string,
    prompt: string,
    aspectRatio: string
  ): Promise<{ buffer: Buffer; mimeType: string; model: string }> {
    const [width, height] =
      aspectRatio === "16:9"
        ? [1024, 576]
        : aspectRatio === "9:16"
        ? [576, 1024]
        : [768, 768];
    const res = await fetch(`${localUrl}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, width, height, steps: 20 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      throw new Error(`Lokalny silnik obrazów HTTP ${res.status}`);
    }
    const data: any = await res.json();
    const b64 = Array.isArray(data?.images) ? data.images[0] : null;
    if (!b64 || typeof b64 !== "string") {
      throw new Error("Lokalny silnik obrazów nie zwrócił danych obrazu.");
    }
    return {
      buffer: Buffer.from(b64, "base64"),
      mimeType: "image/png",
      model: process.env.LOCAL_IMAGE_MODEL || "local-diffusion",
    };
  }

  private async runGeminiImage(
    prompt: string,
    mode: "generate" | "edit" | "variation",
    aspectRatio: string,
    sourceImageBase64?: string,
    sourceMimeType = "image/png"
  ): Promise<{ buffer: Buffer; mimeType: string; model: string; caption?: string }> {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key || key === "MY_GEMINI_API_KEY") {
      throw new Error("Brak skonfigurowanego GEMINI_API_KEY do generowania obrazów.");
    }
    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        timeout: 60000,
        headers: { "User-Agent": "aistudio-build" },
      },
    });
    const model = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-lite-image";
    const parts: any[] = [];
    if (sourceImageBase64 && (mode === "edit" || mode === "variation")) {
      parts.push({
        inlineData: {
          mimeType: sourceMimeType,
          data: sourceImageBase64,
        },
      });
    }
    parts.push({
      text:
        mode === "variation" && sourceImageBase64
          ? `Create a distinct visual variation inspired by this image: ${prompt}`
          : prompt,
    });

    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: ["1:1", "3:4", "4:3", "9:16", "16:9"].includes(aspectRatio)
            ? aspectRatio
            : "1:1",
        },
      },
    });

    const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
    let imageData = "";
    let mimeType = "image/png";
    let captionText = "";
    for (const part of candidateParts) {
      if (part.inlineData?.data && !imageData) {
        imageData = part.inlineData.data;
        mimeType = part.inlineData.mimeType || "image/png";
      } else if (part.text) {
        captionText += part.text;
      }
    }
    if (!imageData) {
      throw new Error(
        captionText.trim()
          ? `Model ${model} zwrócił tekst zamiast obrazu: ${captionText.slice(0, 180)}`
          : `Model ${model} nie zwrócił binarnych danych obrazu (sprawdź uprawnienia klucza Gemini lub użyj ComfyUI).`
      );
    }
    return {
      buffer: Buffer.from(imageData, "base64"),
      mimeType,
      model,
      caption: captionText.trim() || undefined,
    };
  }

  async generate(input: {
    prompt: string;
    agentId?: string;
    mode?: "generate" | "edit" | "variation";
    preferredEngine?: "auto" | "comfyui" | "local" | "gemini";
    aspectRatio?: string;
    sourceImageBase64?: string;
    sourceMimeType?: string;
  }): Promise<{
    ok: boolean;
    engineStatus: "READY" | "BRAK SILNIKA" | "ERROR";
    image?: GeneratedImageRecord;
    caption?: string;
    error?: string;
  }> {
    const prompt = String(input.prompt || "").trim();
    if (!prompt) {
      return { ok: false, engineStatus: "ERROR", error: "Prompt obrazu nie może być pusty." };
    }
    const mode = input.mode || "generate";
    const agentId = ["aria", "alex", "astyria", "aurelius"].includes(String(input.agentId))
      ? String(input.agentId)
      : "astyria";
    const preferred = input.preferredEngine || "auto";
    const aspectRatio = input.aspectRatio || "1:1";

    const status = await this.probeStatus();
    const order: Array<"comfyui" | "local" | "gemini"> =
      preferred !== "auto"
        ? [preferred]
        : (["comfyui", "local", "gemini"].filter(
            (id) => status.engines[id as "comfyui" | "local" | "gemini"].reachable
          ) as Array<"comfyui" | "local" | "gemini">);

    if (!order.length || (preferred !== "auto" && !status.engines[preferred].reachable)) {
      const reason =
        preferred !== "auto"
          ? `Wybrany silnik (${preferred}) nie jest dostępny: ${status.engines[preferred].error || "offline"}.`
          : status.message;
      return {
        ok: false,
        engineStatus: "BRAK SILNIKA",
        error: reason,
      };
    }

    const chosen = order[0];
    const id = randomUUID();
    const startedAt = Date.now();
    const createdAt = new Date().toISOString();

    try {
      let generated: { buffer: Buffer; mimeType: string; model: string; caption?: string };
      if (chosen === "comfyui") {
        generated = await this.runComfyUi(
          status.engines.comfyui.endpoint || "http://127.0.0.1:8188",
          prompt,
          aspectRatio
        );
      } else if (chosen === "local") {
        generated = await this.runLocalSdWebUi(
          status.engines.local.endpoint || "",
          prompt,
          aspectRatio
        );
      } else {
        generated = await this.runGeminiImage(
          prompt,
          mode,
          aspectRatio,
          input.sourceImageBase64,
          input.sourceMimeType
        );
      }

      if (!hasValidImageHeader(generated.buffer)) {
        throw new Error("Wygenerowane bajty nie przeszły weryfikacji nagłówka pliku obrazu (PNG/JPEG/WEBP).");
      }

      const ext = generated.mimeType.includes("jpeg")
        ? "jpg"
        : generated.mimeType.includes("webp")
        ? "webp"
        : "png";
      const filePath = path.join(this.imagesDir, `${id}.${ext}`);
      writeFileSync(filePath, generated.buffer);

      const record: GeneratedImageRecord = {
        id,
        prompt,
        mode,
        agent_id: agentId,
        model: generated.model,
        source: chosen,
        mime_type: generated.mimeType,
        file_path: filePath,
        byte_size: generated.buffer.length,
        duration_ms: Date.now() - startedAt,
        status: "completed",
        error: "",
        created_at: createdAt,
        url: `/api/images/file/${encodeURIComponent(id)}?v=${encodeURIComponent(createdAt)}`,
      };
      this.saveAuditRecord(record);

      return {
        ok: true,
        engineStatus: "READY",
        image: record,
        caption: generated.caption,
      };
    } catch (err: any) {
      let rawMsg = String(err?.message || "Generowanie obrazu nie powiodło się.");
      try {
        const parsed = JSON.parse(rawMsg);
        if (parsed?.error?.message) {
          const code = parsed.error.code;
          const baseLine = String(parsed.error.message).split("\n")[0];
          rawMsg =
            code === 429
              ? `Przekroczono limit API obrazów (${status.engines[chosen].model}, HTTP 429) — model wymaga aktywnego limitu/płatnego klucza lub uruchomionego ComfyUI.`
              : `Silnik obrazów (${status.engines[chosen].model}${code ? `, HTTP ${code}` : ""}): ${baseLine}`;
        }
      } catch {}
      const errorMsg = redact(rawMsg);
      const failedRecord: GeneratedImageRecord = {
        id,
        prompt,
        mode,
        agent_id: agentId,
        model: status.engines[chosen].model,
        source: chosen,
        mime_type: "image/png",
        file_path: "",
        byte_size: 0,
        duration_ms: Date.now() - startedAt,
        status: "failed",
        error: errorMsg,
        created_at: createdAt,
      };
      this.saveAuditRecord(failedRecord);
      return {
        ok: false,
        engineStatus: "ERROR",
        error: errorMsg,
      };
    }
  }
}
