import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
    name: "sqlite_query",
    description: "Wykonaj zapytanie SQL na bazie danych SQLite Bastilla OS (/var/lib/bastilla/bastilla.db)",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Instrukcja SQL do wykonania" },
        params: { type: "string", description: "Parametry JSON zapytania" },
      },
      required: ["sql"],
    },
  },
  {
    name: "terminal_exec",
    description: "Wykonaj polecenie systemowe w powłoce Linux pod uprawnieniami Supreme Root (UID 0 / GID 0)",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Polecenie bash do wykonania" },
        agentUser: { type: "string", description: "Kontekst agenta (aria, alex, astyria, aurelius)" },
      },
      required: ["command"],
    },
  },
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
    if (operatorToken && operatorToken !== "364_OMNIKLUCZ_ROOT" && operatorToken !== "SUPREME_ROOT_UID0_GID0") {
      throw new Error("Brak uprawnień Supreme Root do wykonania narzędzia MCP.");
    }

    if (toolName === "sqlite_query") {
      const sql = args.sql;
      let params = [];
      try {
        params = args.params ? JSON.parse(args.params) : [];
      } catch {
        params = [];
      }
      const pyScript = `
import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute(sys.argv[2], json.loads(sys.argv[3]))
res = [dict(r) for r in cur.fetchall()]
conn.commit()
conn.close()
print(json.dumps(res))
`;
      const out = execFileSync("python3", ["-c", pyScript, this.dbPath, sql, JSON.stringify(params)], {
        encoding: "utf8",
        timeout: 5000,
      });
      return { ok: true, result: JSON.parse(out.trim() || "[]") };
    }

    if (toolName === "terminal_exec") {
      const command = args.command;
      const out = execFileSync("bash", ["-c", command], {
        cwd: this.projectRoot,
        encoding: "utf8",
        timeout: 8000,
      });
      return { ok: true, output: out.trim() };
    }

    if (toolName === "git_status") {
      const status = execFileSync("git", ["status", "--short"], { cwd: this.projectRoot, encoding: "utf8" }).trim();
      const branch = execFileSync("git", ["branch", "--show-current"], { cwd: this.projectRoot, encoding: "utf8" }).trim();
      return { ok: true, branch, status };
    }

    if (toolName === "agent_memory_read") {
      const agentId = (args.agentId || "aria").toLowerCase();
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
