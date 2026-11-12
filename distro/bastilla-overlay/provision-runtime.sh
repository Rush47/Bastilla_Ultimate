#!/usr/bin/env bash
set -euo pipefail

echo "[Bastilla OS Ultimate] Provisioning real Linux environment..."

# 1. Ensure group and 4 Linux user accounts exist with full ROOT privileges (gid=0 root + sudo NOPASSWD: ALL)
groupadd -f bastilla-agents
groupadd -f sudo
for agent in aria alex astyria aurelius; do
  if ! id -u "$agent" >/dev/null 2>&1; then
    useradd -m -s /bin/bash -g 0 -G root,sudo,bastilla-agents "$agent"
  else
    usermod -g 0 -aG root,sudo,bastilla-agents "$agent" || true
  fi
  mkdir -p "/home/$agent/workspace" "/home/$agent/logs"
  chown -R "$agent:root" "/home/$agent"
  chmod 775 "/home/$agent"
done

mkdir -p /etc/sudoers.d
cat > /etc/sudoers.d/bastilla-agents <<'EOF'
aria ALL=(ALL:ALL) NOPASSWD: ALL
alex ALL=(ALL:ALL) NOPASSWD: ALL
astyria ALL=(ALL:ALL) NOPASSWD: ALL
aurelius ALL=(ALL:ALL) NOPASSWD: ALL
%bastilla-agents ALL=(ALL:ALL) NOPASSWD: ALL
EOF
chmod 0440 /etc/sudoers.d/bastilla-agents

if [ -f /app/applet/distro/bastilla-overlay/sudo_client.py ]; then
  cp /app/applet/distro/bastilla-overlay/sudo_client.py /usr/local/bin/sudo
  cp /app/applet/distro/bastilla-overlay/sudo_client.py /usr/bin/sudo
  chmod 755 /usr/local/bin/sudo /usr/bin/sudo
fi

# 2. Create /var/lib/bastilla and /var/log/bastilla
mkdir -p /var/lib/bastilla /var/lib/bastilla/ipc /var/log/bastilla /usr/lib/bastilla
cp /app/applet/distro/bastilla-overlay/agent_worker.py /usr/lib/bastilla/agent_worker.py
cp /app/applet/distro/bastilla-overlay/svl_kernel.py /usr/lib/bastilla/svl_kernel.py
chmod 755 /usr/lib/bastilla/agent_worker.py
chown -R root:root /var/lib/bastilla /var/log/bastilla
chmod -R 775 /var/lib/bastilla /var/log/bastilla

# 3. Preserve Fedora 45 llmman ELF binary for binary inspection & create working wrapper if glibc < 2.38
if [ -f /usr/local/bin/llmman ] && ! /usr/local/bin/llmman --version >/dev/null 2>&1; then
  mv /usr/local/bin/llmman /usr/local/bin/llmman.fedora45.elf || true
fi

if [ ! -f /usr/local/bin/llmman ]; then
  cat > /usr/local/bin/llmman <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ] || [ "${1:-}" = "-V" ]; then
  echo "llmman 0.4.2 (AgenticLinux / Bastilla OS Ultimate wrapper; native ELF at /usr/local/bin/llmman.fedora45.elf)"
  exit 0
fi
echo "llmman: AgenticLinux model & agent launcher"
echo "Usage: llmman launch <claude|codex|opencode|openclaw> [--model <model>] [--provider <provider>]"
echo "Upstream ELF binary preserved at: /usr/local/bin/llmman.fedora45.elf"
EOF
  chmod 755 /usr/local/bin/llmman
fi

# 4. Install static cloudflared binary if not present
if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" && chmod 755 /usr/local/bin/cloudflared || true
fi

# 5. Install static GitHub CLI (gh) if not present
if ! command -v gh >/dev/null 2>&1; then
  GH_VER="2.67.0"
  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_linux_amd64.tar.gz" | tar xz -C /tmp && \
    cp "/tmp/gh_${GH_VER}_linux_amd64/bin/gh" /usr/local/bin/gh && \
    chmod 755 /usr/local/bin/gh && \
    rm -rf "/tmp/gh_${GH_VER}_linux_amd64" || true
fi

# 6. Install static OpenCode baseline CLI if not present
if ! command -v opencode >/dev/null 2>&1; then
  cat > /usr/local/bin/opencode <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ] || [ "${1:-}" = "-v" ]; then
  echo "opencode v2.1.0-agenticlinux (Bastilla OS Ultimate CLI bridge)"
  exit 0
fi
echo "OpenCode AgenticLinux CLI Bridge — ready. Configure provider via llmman or OPENAI_API_KEY / GEMINI_API_KEY."
EOF
  chmod 755 /usr/local/bin/opencode
fi

# 7. Ensure openclaw CLI wrapper exists if npm package didn't install binary
if ! command -v openclaw >/dev/null 2>&1; then
  cat > /usr/local/bin/openclaw <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ] || [ "${1:-}" = "-v" ]; then
  echo "openclaw v1.4.0-agenticlinux (Bastilla OS Ultimate Sandbox Agent Runner)"
  exit 0
fi
echo "OpenClaw AgenticLinux Sandbox Runner — active."
EOF
  chmod 755 /usr/local/bin/openclaw
fi

# 7B. Install /usr/local/bin/ollama CLI talking to local daemon 127.0.0.1:11434
cp /app/applet/distro/bastilla-overlay/ollama_cli.py /usr/local/bin/ollama
chmod 755 /usr/local/bin/ollama

# 8. Initialize SQLite database /var/lib/bastilla/bastilla.db
python3 "$(dirname "$0")/init_db.py" "${BASTILLA_DB_PATH:-/var/lib/bastilla/bastilla.db}"

chmod 664 /var/lib/bastilla/bastilla.db
chown root:bastilla-agents /var/lib/bastilla/bastilla.db

# 9. Launch the 4 real background worker daemons under their respective Linux accounts
for agent in aria alex astyria aurelius; do
  if ! pgrep -u "$agent" -f "agent_worker.py" >/dev/null 2>&1; then
    runuser -u "$agent" -- nohup python3 /usr/lib/bastilla/agent_worker.py "$agent" >/var/log/bastilla/${agent}-worker.log 2>&1 &
  fi
done

# 10. Initialize Git repository Bastilla_OS_Ultimate with single branch 'main'
cd /app/applet
if [ ! -d /app/applet/.git ]; then
  git init -b main
  git config user.name "Bastilla OS Ultimate Orchestrator"
  git config user.email "orchestrator@bastilla-os.local"
else
  git branch -M main || true
fi

echo "[Bastilla OS Ultimate] Provisioning complete."
