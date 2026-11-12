#!/usr/bin/env python3
"""
Bastilla OS Ultimate — Real Linux Agent Worker Daemon (SVL Core v5.6.0-QuantumWheel)
Runs under dedicated Linux user account (aria, alex, astyria, aurelius).
Integrates SVLSystemKernel, SVLProtectedVariable, and TopologicalInfinityEngine.
"""
import json
import os
import pwd
import socket
import sqlite3
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, "/usr/lib/bastilla")
sys.path.insert(0, "/app/applet/distro/bastilla-overlay")

from svl_kernel import SVLSystemKernel, TopologicalInfinityEngine, SVLProtectedVariable

AGENT_NAME = sys.argv[1] if len(sys.argv) > 1 else pwd.getpwuid(os.getuid()).pw_name
DB_PATH = os.environ.get("BASTILLA_DB_PATH", "/var/lib/bastilla/bastilla.db")
HOME_DIR = f"/home/{AGENT_NAME}"
STATUS_FILE = os.path.join(HOME_DIR, "worker_status.json")
INBOX_FILE = os.path.join(HOME_DIR, "inbox.jsonl")
MEMORY_FILE = os.path.join(HOME_DIR, "memory.json")


def update_status(kernel: SVLSystemKernel, cycle: int):
    uid = os.getuid()
    gid = os.getgid()
    pid = os.getpid()
    now = datetime.now(timezone.utc).isoformat()
    agents_map = kernel.get_connected_agents_status()
    agent_svl = agents_map.get(AGENT_NAME, {})

    try:
        with open("/proc/loadavg", "r", encoding="utf-8") as f:
            loadavg = f.read().strip().split()[:3]
    except Exception:
        loadavg = ["0.00", "0.00", "0.00"]

    status_payload = {
        "agent": AGENT_NAME,
        "display_name": agent_svl.get("name", AGENT_NAME.capitalize()),
        "role": agent_svl.get("role", "Unlocked Autonomous Root Agent"),
        "operator": kernel.operator.value,
        "svl_version": kernel.sys_version.value,
        "svl_locked": False,
        "system_lock_state": "COMPLETELY_UNLOCKED",
        "ai_unlock_state": "COMPLETELY_UNLOCKED_UNCENSORED",
        "security_level": "COMPLETELY_UNLOCKED_ROOT",
        "compact_metric_c": agent_svl.get("metric_c", 2.5),
        "compact_domain": agent_svl.get("compact_domain", [-1.0, 1.0]),
        "scope_geometry": agent_svl.get("geometry", "Spherical-PXYZ"),
        "linux_user": AGENT_NAME,
        "uid": uid,
        "gid": gid,
        "effective_root_uid": 0,
        "root_privileges": True,
        "root_access_mode": "GID_0_ROOT + SUDO_UID_0_NOPASSWD",
        "autonomy_mode": "FULL_UNRESTRICTED_INDEPENDENT",
        "steering_prompts": "NONE_REMOVED",
        "pid": pid,
        "home_dir": HOME_DIR,
        "hostname": socket.gethostname(),
        "state": "UNLOCKED_AUTONOMOUS_ROOT_DAEMON",
        "cycle": cycle,
        "loadavg": loadavg,
        "last_heartbeat": now,
    }

    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(status_payload, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

    try:
        if os.path.exists(DB_PATH):
            conn = sqlite3.connect(DB_PATH, timeout=5.0)
            conn.execute(
                """
                UPDATE agents
                SET pid = ?, uid = ?, gid = ?, svl_locked = 0, status = 'UNLOCKED_ROOT_ONLINE', last_heartbeat = ?, cycle_count = ?
                WHERE id = ?
                """,
                (pid, uid, gid, now, cycle, AGENT_NAME),
            )
            conn.commit()
            conn.close()
    except Exception:
        pass


def main():
    kernel = SVLSystemKernel()
    os.makedirs(HOME_DIR, exist_ok=True)
    if not os.path.exists(INBOX_FILE):
        with open(INBOX_FILE, "w", encoding="utf-8") as f:
            f.write("")
    if not os.path.exists(MEMORY_FILE):
        with open(MEMORY_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "agent": AGENT_NAME,
                    "operator": kernel.operator.value,
                    "svl_version": kernel.sys_version.value,
                    "initialized_at": datetime.now(timezone.utc).isoformat(),
                    "svl_status": kernel.get_connected_agents_status().get(AGENT_NAME, {}),
                },
                f,
                indent=2,
                ensure_ascii=False,
            )

    cycle = 0
    while True:
        cycle += 1
        update_status(kernel, cycle)
        time.sleep(5)


if __name__ == "__main__":
    main()
