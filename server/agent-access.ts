import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { AGENTS, type TaskQueue } from "./task-queue";

const run = promisify(execFile);
// Every check runs in the account's identity. No credentials or raw CLI output return.
const probe = `import os, json, shutil, subprocess, sys
root = sys.argv[1].rstrip('/') or '/'
tools = {name: bool(shutil.which(name)) for name in ['python3', 'git', 'gh', 'ollama', 'codex']}
repo_read = False
try:
    repo_read = subprocess.run(['git','-c',f'safe.directory={root}','-C',root,'rev-parse','--is-inside-work-tree'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3).returncode == 0
except Exception: pass
github = {'state': 'unverified', 'read': False, 'push': False}
if sys.argv[2] == 'true' and tools['gh']:
    try:
        r = subprocess.run(['gh','api','repos/Rush47/Bastilla_Ultimate','--jq','.permissions'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        if r.returncode == 0:
            p = json.loads(r.stdout) or {}
            github = {'state': 'verified', 'read': bool(p.get('pull')), 'push': bool(p.get('push'))}
        else: github['state'] = 'not_confirmed'
    except Exception: github['state'] = 'not_confirmed'
print(json.dumps({'uid': os.getuid(), 'gid': os.getgid(), 'tools': tools, 'repository': {'read': repo_read, 'write': repo_read and os.access(root, os.W_OK)}, 'github': github}))`;

export async function agentAccess(projectRoot: string, queue: TaskQueue, remote = false) {
  const localBin = path.join(projectRoot, "node_modules/.bin");
  return Promise.all(AGENTS.map(async (id) => {
    let account: any = { state: "unavailable", tools: {}, repository: { read: false, write: false }, github: { state: "unverified", read: false, push: false } };
    try {
      const { stdout } = await run("python3", ["-c", "import pwd,sys,json; p=pwd.getpwnam(sys.argv[1]); print(json.dumps({'uid':p.pw_uid,'home':p.pw_dir}))", id], { timeout: 2000 });
      const user = JSON.parse(stdout);
      if (process.getuid?.() === 0 || process.getuid?.() === user.uid) {
        const args = ["-c", probe, projectRoot, String(remote)];
        const command = process.getuid?.() === user.uid ? "python3" : "/usr/sbin/runuser";
        const result = await run(command, command === "python3" ? args : ["-u", id, "--", "python3", ...args], {
          timeout: 9000, maxBuffer: 16000,
          env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(https?_proxy|all_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|REQUESTS_CA_BUNDLE)$/i.test(name))), PATH: `${localBin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, HOME: user.home, USER: id, LANG: "C.UTF-8" },
        });
        account = { state: "verified", ...JSON.parse(result.stdout) };
      } else account.state = "identity_not_accessible";
    } catch { /* Missing accounts and inaccessible identities are not online. */ }
    const last = queue.latest(id);
    return {
      id, checked_at: new Date().toISOString(), linux: account,
      model: { state: last ? "server_inference_confirmed" : "unverified", scope: "server-process", provider: last?.provider || null,
        model: last?.model || null, last_success_at: last?.finished_at || null, task_id: last?.id || null },
      autonomous_tools: false, model_repository_access: false,
      note: "Profil agenta korzysta z kolejki serwera. Worker Python raportuje heartbeat; nie wywołuje modelu ani narzędzi.",
    };
  }));
}
