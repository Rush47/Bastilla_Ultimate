#!/usr/bin/env python3
"""Initialize or migrate Bastilla SQLite state without provisioning the host."""
import sqlite3
import os
import sys
import json
from datetime import datetime, timezone

db_path = sys.argv[1]
os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.executescript("""
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  specialty TEXT NOT NULL,
  linux_user TEXT NOT NULL,
  home_dir TEXT NOT NULL,
  uid INTEGER DEFAULT -1,
  gid INTEGER DEFAULT -1,
  pid INTEGER DEFAULT 0,
  status TEXT DEFAULT 'OFFLINE',
  svl_locked INTEGER DEFAULT 0,
  avatar_url TEXT,
  model_primary TEXT DEFAULT 'ollama/llama3.2-vision:11b',
  model_fallback TEXT DEFAULT 'gemini-flash-latest',
  last_heartbeat TEXT,
  cycle_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INTEGER DEFAULT 3,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_ipc_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'DELIVERED',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  assigned_agent TEXT NOT NULL,
  terminal_type TEXT NOT NULL,
  command_or_prompt TEXT NOT NULL,
  output_summary TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  engine_used TEXT NOT NULL,
  content TEXT NOT NULL,
  artifact_title TEXT,
  artifact_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fleet_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vessel_class TEXT NOT NULL,
  sector TEXT NOT NULL,
  orbit_target TEXT NOT NULL,
  commander_agent TEXT NOT NULL,
  hull_integrity REAL NOT NULL,
  energy_output_gw REAL NOT NULL,
  status TEXT NOT NULL,
  telemetry_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  codename TEXT NOT NULL,
  target_body TEXT NOT NULL,
  lead_agent TEXT NOT NULL,
  vessel_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  progress_pct INTEGER NOT NULL,
  delta_v_kms REAL NOT NULL,
  objective TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hypercomm_relays (
  id TEXT PRIMARY KEY,
  relay_name TEXT NOT NULL,
  location_au REAL NOT NULL,
  band_thz REAL NOT NULL,
  entanglement_fidelity REAL NOT NULL,
  latency_ms REAL NOT NULL,
  status TEXT NOT NULL,
  last_packet TEXT NOT NULL
);
""")

# Migrate existing databases without replacing user data.
columns = {row[1] for row in cur.execute("PRAGMA table_info(agents)")}
for column, declaration in [("svl_locked", "INTEGER DEFAULT 0"), ("avatar_url", "TEXT")]:
    if column not in columns:
        cur.execute(f"ALTER TABLE agents ADD COLUMN {column} {declaration}")

now = datetime.now(timezone.utc).isoformat()

agents_seed = [
  ("aria", "Aria", "Chief Systems Architect & Executive Orchestrator", "System Architecture, Multi-Agent Coordination, Kernel Governance", "aria", "/home/aria", "ollama/llama3.2-vision:11b", "gemini-flash-latest"),
  ("alex", "Alex", "Tactical Security, Linux Kernel & DevSecOps Engineer", "Container Isolation, Bootguard Verification, Network & Firewall Auditing", "alex", "/home/alex", "ollama/llama3.2-vision:11b", "gemini-flash-latest"),
  ("astyria", "Astyria", "Deep Space Telemetry, 3D Orbital & Multimodal Vision Analyst", "Solar System Ephemeris, Optical Reconnaissance, Sensor Fusion", "astyria", "/home/astyria", "ollama/llama3.2-vision:11b", "gemini-flash-latest"),
  ("aurelius", "Aurelius", "Autonomous Code Synthesis, Fleet Logistics & GitHub Strategist", "OpenAI Codex CLI Automation, Git Main Sync, Infrastructure Scaling", "aurelius", "/home/aurelius", "ollama/llama3.2-vision:11b", "gemini-flash-latest")
]

for a in agents_seed:
  cur.execute("""
    INSERT OR IGNORE INTO agents (id, display_name, role, specialty, linux_user, home_dir, model_primary, model_fallback)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  """, a)

# Only profiles are seed data. Operational records must come from real actions.
cur.execute("CREATE TABLE IF NOT EXISTS bastilla_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
if not cur.execute("SELECT 1 FROM bastilla_metadata WHERE key='legacy_records_unverified'").fetchone():
  legacy = any(cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
               for table in ["task_history", "agent_ipc_messages", "chat_messages", "agent_memories", "fleet_units"])
  cur.execute("INSERT INTO bastilla_metadata VALUES ('legacy_records_unverified', ?)", ("true" if legacy else "false",))
cur.executescript("""
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, prompt TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL, model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')),
  result TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, heartbeat_at TEXT,
  lease_until TEXT, owner TEXT, idempotency_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS agent_tasks_pending ON agent_tasks(status,priority DESC,created_at);
""")
conn.commit()
conn.close()
