#!/usr/bin/env bash
set -euo pipefail

# Explicit host provisioning. Never replace sudo/pkexec or assign agents root.
project_root="${BASTILLA_PROJECT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
database_path="${BASTILLA_DB_PATH:-/var/lib/bastilla/bastilla.db}"
if [ "$(id -u)" -ne 0 ]; then
  echo 'Host provisioning requires an administrator.' >&2
  exit 1
fi
groupadd -f bastilla-agents
for agent in aria alex astyria aurelius; do
  if ! id -u "$agent" >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G bastilla-agents "$agent"
  else
    usermod -aG bastilla-agents "$agent"
  fi
  # Existing users and sudo policy are retained for explicit administrator review.
  install -d -m 750 -o "$agent" -g bastilla-agents "/home/$agent/workspace" "/home/$agent/logs"
done
install -d -m 2770 -o root -g bastilla-agents "$(dirname "$database_path")"
install -d -m 750 -o root -g bastilla-agents /var/log/bastilla /usr/lib/bastilla
install -m 755 "$project_root/distro/bastilla-overlay/agent_worker.py" /usr/lib/bastilla/agent_worker.py
python3 "$project_root/distro/bastilla-overlay/init_db.py" "$database_path"
chown root:bastilla-agents "$database_path"
chmod 660 "$database_path"
for tool in git gh ollama codex; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing tool: $tool. Install its official distribution separately." >&2
  fi
done
for agent in aria alex astyria aurelius; do
  if ! pgrep -u "$agent" -f "agent_worker.py $agent" >/dev/null 2>&1; then
    BASTILLA_DB_PATH="$database_path" runuser -u "$agent" -- nohup python3 /usr/lib/bastilla/agent_worker.py "$agent" >"/var/log/bastilla/$agent-worker.log" 2>&1 &
  fi
done
echo 'Provisioned account heartbeats. Model and GitHub access require separate verification.'
