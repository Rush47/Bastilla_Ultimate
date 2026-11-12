import { execFileSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string; required?: boolean }>;
    required?: string[];
  };
}

export const MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: "git_status",
    description: "Pobierz status gałęzi i zmienionych plików w repozytorium GitHub Bastilla_Ultimate",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "agent_memory_read",
    description: "Odczytaj pamięć lokalną agenta (memory.json)",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID agenta (aria, alex, astyria, aurelius)" },
      },
      required: ["agentId"],
    },
  },
];

export class MCPServerManager {
  constructor(private projectRoot: string, private dbPath: string) {}

  listTools() {
    return {
      ok: true,
      protocol: "Model-Context-Protocol/1.0.0",
      server: "Bastilla-OS-Ultimate-MCP",
      tools: MCP_TOOLS,
    };
  }

  executeTool(toolName: string, args: Record<string, any>, operatorToken?: string) {
    const expected = process.env.BASTILLA_API_TOKEN;
    // Never grant privileged MCP operations based on a missing token or a
    // hard-coded magic string. This is defense in depth; HTTP routes must
    // independently apply their normal authentication and origin checks.
    if (!expected || !operatorToken ||
        Buffer.byteLength(expected) !== Buffer.byteLength(operatorToken) ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(operatorToken))) {
      throw new Error("MCP requires an authenticated operator token.");
    }

    if (toolName === "git_status") {
      const status = execFileSync("git", ["status", "--short"], { cwd: this.projectRoot, encoding: "utf8" }).trim();
      const branch = execFileSync("git", ["branch", "--show-current"], { cwd: this.projectRoot, encoding: "utf8" }).trim();
      return { ok: true, branch, status };
    }

    if (toolName === "agent_memory_read") {
      const agentId = String(args.agentId || "").toLowerCase();
      if (!["aria", "alex", "astyria", "aurelius"].includes(agentId)) {
        throw new Error("Invalid agent identifier.");
      }
      const memPath = path.join(this.projectRoot, `home/${agentId}/memory.json`);
      let memData = {};
      if (existsSync(memPath)) {
        try {
          memData = JSON.parse(readFileSync(memPath, "utf8"));
        } catch {}
      } else {
        const globalMem = path.join(this.projectRoot, "memory.json");
        if (existsSync(globalMem)) {
          try {
            memData = JSON.parse(readFileSync(globalMem, "utf8"));
          } catch {}
        }
      }
      return { ok: true, agentId, memory: memData };
    }

    throw new Error(`Nieznane narzędzie MCP: ${toolName}`);
  }
}
