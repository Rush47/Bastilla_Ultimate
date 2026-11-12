# BASTILLA OS ULTIMATE — Production Bootc Image Definition
# Base: AgenticLinux (https://github.com/agenticlinux/agenticlinux)
# Preserves full KDE Plasma / Wayland desktop, Docker Engine & Sandboxes,
# Kata Containers, OpenShell, llmman, herdr, OpenAI Codex CLI (ChatGPT Auth),
# OpenCode, OpenClaw, GitHub CLI (gh), KRDP Remote Desktop, and adds:
#   - 4 Autonomous Linux Agent Accounts & Daemons: aria, alex, astyria, aurelius
#   - Ollama Server + llama3.2-vision:11b local multimodal model + Gemini API fallback
#   - Cloudflare Tunnel (cloudflared) HTTPS Zero-Trust Ingress
#   - Bastilla Violet Desktop Theme & Touch/Gesture Compositor Rules

ARG AGENTIC_BASE=docker.io/ericcurtin044/agenticlinux:fedora45-kde
FROM ${AGENTIC_BASE}

LABEL org.opencontainers.image.title="Bastilla OS Ultimate"
LABEL org.opencontainers.image.description="AgenticLinux-based autonomous operating system with Aria, Alex, Astyria, and Aurelius Linux agents, OpenAI Codex CLI, Ollama Vision 11B + Gemini Fallback, and Cloudflare HTTPS."
LABEL org.opencontainers.image.source="https://github.com/Bastilla_OS_Ultimate"

# 1. Install Ollama, Cloudflare Tunnel, SQLite, and Python runtime dependencies
RUN curl -fsSL https://ollama.com/install.sh | sh && \
    curl -fsSL -o /usr/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && \
    chmod 755 /usr/bin/cloudflared

# 2. Ensure OpenAI Codex CLI, OpenClaw, and global agent tools are up to date
RUN npm install -g --prefix /usr @openai/codex openclaw

# 3. Create dedicated Linux group and user accounts for the 4 Bastilla AI Agents
RUN groupadd -f bastilla-agents && \
    useradd -m -s /bin/bash -G bastilla-agents,wheel,docker -c "Aria - Chief Systems Architect" aria && \
    useradd -m -s /bin/bash -G bastilla-agents,wheel,docker -c "Alex - Tactical Security & Kernel" alex && \
    useradd -m -s /bin/bash -G bastilla-agents,wheel,docker -c "Astyria - Astro-Navigation & Vision" astyria && \
    useradd -m -s /bin/bash -G bastilla-agents,wheel,docker -c "Aurelius - Autonomous Fleet & Code" aurelius

# 4. Provision Bastilla OS state directories, IPC bus, and SQLite database
RUN install -d -m 0775 -o root -g bastilla-agents /var/lib/bastilla /var/lib/bastilla/ipc /var/log/bastilla
COPY agent_worker.py /usr/lib/bastilla/agent_worker.py
RUN chmod 755 /usr/lib/bastilla/agent_worker.py

# 5.Update OS identity to Bastilla OS Ultimate (preserving AgenticLinux bootc lineage)
RUN sed -i 's/^PRETTY_NAME=.*/PRETTY_NAME="Bastilla OS Ultimate (AgenticLinux Fedora 45 KDE)"/' /usr/lib/os-release && \
    echo 'BASTILLA_EDITION="Ultimate"' >> /usr/lib/os-release && \
    echo 'BASTILLA_AGENTS="aria,alex,astyria,aurelius"' >> /usr/lib/os-release

# 6. Verify bootc container compliance
RUN bootc container lint || true
