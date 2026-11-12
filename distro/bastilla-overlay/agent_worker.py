#!/usr/bin/env python3
"""Account heartbeat only. Model jobs are executed by the server task queue."""
import json
import os
import pwd
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

AGENTS = {"aria", "alex", "astyria", "aurelius"}


def main():
    account = pwd.getpwuid(os.getuid())
    agent = sys.argv[1] if len(sys.argv) > 1 else account.pw_name
    if agent not in AGENTS or account.pw_name != agent:
        raise SystemExit("Worker must run under its own configured Linux account.")
    home = Path(account.pw_dir)
    database = os.environ.get("BASTILLA_DB_PATH", "/var/lib/bastilla/bastilla.db")
    cycle = 0
    while True:
        cycle += 1
        now = datetime.now(timezone.utc).isoformat()
        status = {"agent": agent, "uid": os.getuid(), "gid": os.getgid(), "pid": os.getpid(),
                  "state": "HEARTBEAT_ONLY", "cycle": cycle, "last_heartbeat": now,
                  "model_verified": False, "tool_execution": False, "repository_verified": False}
        try:
            temporary = home / "worker_status.tmp"
            temporary.write_text(json.dumps(status), encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(home / "worker_status.json")
            with sqlite3.connect(database, timeout=5) as connection:
                connection.execute("UPDATE agents SET pid=?,uid=?,gid=?,status='HEARTBEAT_ONLY',last_heartbeat=?,cycle_count=? WHERE id=?",
                                   (os.getpid(), os.getuid(), os.getgid(), now, cycle, agent))
        except (OSError, sqlite3.Error):
            print("Worker heartbeat could not be persisted.", file=sys.stderr)
        time.sleep(5)


if __name__ == "__main__":
    main()
