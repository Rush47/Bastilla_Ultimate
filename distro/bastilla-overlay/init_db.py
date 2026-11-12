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
  uid INTEGER DEFAULT 0,
  gid INTEGER DEFAULT 0,
  pid INTEGER DEFAULT 0,
  status TEXT DEFAULT 'OFFLINE',
  svl_locked INTEGER DEFAULT 0,
  avatar_url TEXT,
  model_primary TEXT DEFAULT 'ollama/llama3.2-vision:11b',
  model_fallback TEXT DEFAULT 'gemini-3.8-flash',
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
  ("aria", "Aria", "Chief Systems Architect & Executive Orchestrator", "System Architecture, Multi-Agent Coordination, Kernel Governance", "aria", "/home/aria", "ollama/llama3.2-vision:11b", "gemini-3.8-flash"),
  ("alex", "Alex", "Tactical Security, Linux Kernel & DevSecOps Engineer", "Container Isolation, Bootguard Verification, Network & Firewall Auditing", "alex", "/home/alex", "ollama/llama3.2-vision:11b", "gemini-3.8-flash"),
  ("astyria", "Astyria", "Deep Space Telemetry, 3D Orbital & Multimodal Vision Analyst", "Solar System Ephemeris, Optical Reconnaissance, Sensor Fusion", "astyria", "/home/astyria", "ollama/llama3.2-vision:11b", "gemini-3.8-flash"),
  ("aurelius", "Aurelius", "Autonomous Code Synthesis, Fleet Logistics & GitHub Strategist", "OpenAI Codex CLI Automation, Git Main Sync, Infrastructure Scaling", "aurelius", "/home/aurelius", "ollama/llama3.2-vision:11b", "gemini-3.8-flash")
]

for a in agents_seed:
  cur.execute("""
    INSERT OR IGNORE INTO agents (id, display_name, role, specialty, linux_user, home_dir, model_primary, model_fallback, last_heartbeat)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  """, (*a, now))

cur.execute("SELECT COUNT(*) FROM agent_memories")
if cur.fetchone()[0] == 0:
  memories = [
    ("aria", "ARCHITECTURE", "AgenticLinux base repository integrated at /app/applet/distro/agenticlinux with bootc & bootguard.", 5, now),
    ("aria", "ORCHESTRATION", "Bastilla OS Ultimate IPC bus initialized at /var/lib/bastilla/bastilla.db with 4 Linux user workers.", 5, now),
    ("alex", "SECURITY", "Verified Linux accounts aria (1001), alex (1002), astyria (1003), aurelius (1004) in /etc/passwd.", 5, now),
    ("alex", "KERNEL", "Bootguard rollback service and Kata Containers configuration audited from AgenticLinux upstream.", 4, now),
    ("astyria", "EPHEMERIS", "3D Solar System orbital ephemeris calibrated for Sol, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune.", 5, now),
    ("astyria", "VISION", "Multimodal pipeline configured: Ollama llama3.2-vision:11b primary with automatic server-side Gemini fallback.", 5, now),
    ("aurelius", "CODEX_CLI", "OpenAI Codex CLI v0.167.2 installed at /usr/local/bin/codex; supports ChatGPT OAuth (codex login) and API keys.", 5, now),
    ("aurelius", "GITHUB", "Bastilla_OS_Ultimate Git repository initialized on single primary branch 'main'.", 5, now),
  ]
  cur.executemany("INSERT INTO agent_memories (agent_id, category, content, importance, created_at) VALUES (?, ?, ?, ?, ?)", memories)

cur.execute("SELECT COUNT(*) FROM agent_ipc_messages")
if cur.fetchone()[0] == 0:
  ipc_seed = [
    ("aria", "alex", "KERNEL_AUDIT_SYNC", "Verify Linux user namespaces and /home/<agent> permissions across all 4 worker accounts.", "DELIVERED", now),
    ("alex", "aria", "AUDIT_CONFIRMED", "All 4 Linux accounts active in group bastilla-agents. Worker daemons isolated and reporting PIDs.", "DELIVERED", now),
    ("astyria", "aurelius", "TELEMETRY_VECTOR_UPDATE", "Jovian relay BASTILLA-RELAY-04 orbital inclination updated; commit ephemeris table to main.", "DELIVERED", now),
    ("aurelius", "aria", "TOOLCHAIN_STATUS", "codex-cli 0.167.2, gh CLI, cloudflared, and SQLite 3.40.1 verified in /usr/local/bin.", "DELIVERED", now),
  ]
  cur.executemany("INSERT INTO agent_ipc_messages (sender, recipient, subject, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)", ipc_seed)

cur.execute("SELECT COUNT(*) FROM fleet_units")
if cur.fetchone()[0] == 0:
  fleet_seed = [
    ("BSV-01-SOVEREIGN", "BSV Violet Sovereign", "Heavy Command Dreadnought", "Sol-Earth L2", "Earth", "aria", 99.4, 48.5, "NOMINAL", json.dumps({"crew": 420, "ai_cores": 16, "shield_pct": 100})),
    ("BSV-02-AEGIS", "BSV Tactical Aegis", "Stealth Interceptor Frigate", "Mars Orbital Ring", "Mars", "alex", 97.8, 19.2, "PATROL", json.dumps({"crew": 85, "ai_cores": 8, "shield_pct": 98})),
    ("BSV-03-ASTRAEA", "BSV Astraea Horizon", "Deep-Space Science & Vision Vessel", "Europa High Orbit", "Jupiter", "astyria", 98.9, 31.0, "SCANNING", json.dumps({"crew": 140, "ai_cores": 24, "shield_pct": 99})),
    ("BSV-04-FORGE", "BSV Aurelian Forge", "Autonomous Carrier & Shipyard", "Titan Logistics Hub", "Saturn", "aurelius", 100.0, 64.0, "CONSTRUCTING", json.dumps({"crew": 610, "ai_cores": 32, "shield_pct": 100})),
  ]
  cur.executemany("INSERT INTO fleet_units VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", fleet_seed)

cur.execute("SELECT COUNT(*) FROM missions")
if cur.fetchone()[0] == 0:
  missions_seed = [
    ("MSN-401", "OPERATION VIOLET DAWN", "Mars", "alex", "BSV-02-AEGIS", "ORBITAL_LOCK", 84, 4.32, "Deploy hardened AgenticLinux micro-nodes across Phobos and Deimos telemetry relays.", now),
    ("MSN-402", "EUROPA CRYOSPECTRUM", "Jupiter", "astyria", "BSV-03-ASTRAEA", "ACTIVE_SCAN", 62, 9.85, "Run Llama 3.2 Vision + Gemini spectral analysis on Europa subsurface plume imagery.", now),
    ("MSN-403", "TITAN CITADEL SYNC", "Saturn", "aurelius", "BSV-04-FORGE", "TRANSIT", 45, 11.40, "Establish high-redundancy Git main mirror and quantum hypercomm array at Titan.", now),
    ("MSN-404", "SOL CORE GOVERNANCE", "Earth", "aria", "BSV-01-SOVEREIGN", "NOMINAL", 96, 1.80, "Coordinate all 4 Linux agent daemons and maintain zero-trust Cloudflare HTTPS uplink.", now),
  ]
  cur.executemany("INSERT INTO missions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", missions_seed)

cur.execute("SELECT COUNT(*) FROM hypercomm_relays")
if cur.fetchone()[0] == 0:
  relays_seed = [
    ("HCR-SOL-L2", "Sol-Terra L2 Primary Array", 1.00, 420.5, 99.94, 0.42, "LOCKED", "SYN_ACK_ARIA_ROOT_0x9F"),
    ("HCR-MARS-01", "Olympus Mons Quantum Spire", 1.52, 385.0, 99.81, 1.18, "LOCKED", "TELEMETRY_FRAME_8841"),
    ("HCR-JUP-EUROPA", "Jovian Magnetosphere Relay", 5.20, 512.8, 99.45, 3.84, "ACTIVE_SYNC", "VISION_SPECTRAL_PACK_11B"),
    ("HCR-SAT-TITAN", "Cronus Ring Transceiver", 9.58, 640.0, 99.12, 7.15, "LOCKED", "GIT_MAIN_MIRROR_HASH"),
  ]
  cur.executemany("INSERT INTO hypercomm_relays VALUES (?, ?, ?, ?, ?, ?, ?, ?)", relays_seed)

cur.execute("SELECT COUNT(*) FROM task_history")
if cur.fetchone()[0] == 0:
  tasks_seed = [
    ("Clone AgenticLinux Base Distro", "aurelius", "LINUX_ROOT", "git clone https://github.com/agenticlinux/agenticlinux.git", "Cloned upstream AgenticLinux Dockerfile, build.sh, packages.txt, and bootguard into /distro/agenticlinux.", "COMPLETED", now),
    ("Provision 4 Linux Agent Accounts", "alex", "LINUX_ROOT", "useradd -m -s /bin/bash -G bastilla-agents aria alex astyria aurelius", "Created /home/aria (1001), /home/alex (1002), /home/astyria (1003), /home/aurelius (1004).", "COMPLETED", now),
    ("Install OpenAI Codex CLI", "aurelius", "AI_CLI", "npm install -g @openai/codex && codex --version", "Installed codex-cli 0.167.2 globally with ChatGPT OAuth login support.", "COMPLETED", now),
    ("Initialize SQLite Long-Term Memory", "aria", "PYTHON_ROOT", "sqlite3 /var/lib/bastilla/bastilla.db", "Created persistent tables for agents, memories, IPC, tasks, fleet, missions, and hypercomm.", "COMPLETED", now),
  ]
  cur.executemany("INSERT INTO task_history (title, assigned_agent, terminal_type, command_or_prompt, output_summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", tasks_seed)

conn.commit()
conn.close()
