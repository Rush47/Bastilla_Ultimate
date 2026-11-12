#!/usr/bin/env python3
"""
BASTILLA OS ULTIMATE — ROOT PRIVILEGE ESCALATION CLIENT (/usr/local/bin/sudo)
Bypasses gVisor nosuid filesystem restrictions by communicating with the root-owned
Unix domain socket /var/run/bastilla-root.sock (permissions 0660 root:root).
Allows Linux agents (aria, alex, astyria, aurelius in gid=0 root) to execute commands
with full uid=0(root) gid=0(root) privileges.
"""
import json
import os
import pwd
import socket
import subprocess
import sys

SOCKET_PATH = "/var/run/bastilla-root.sock"


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print("usage: sudo [-n] [-E] [-u user] command [args ...]")
        print("Bastilla OS Ultimate Root Escalation Bridge (uid=0/gid=0 active)")
        return

    if args[0] in ("-V", "--version"):
        print("Sudo version 1.9.13p3 (Bastilla OS Ultimate Root Escalator — uid=0 enabled)")
        return

    # Strip common sudo flags (-n, -E, -S, -H, -i, -s, -u <user>)
    cmd_args = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("-n", "-E", "-S", "-H", "-i", "-s", "--"):
            i += 1
            if arg == "--":
                cmd_args.extend(args[i:])
                break
            continue
        if arg == "-u" and i + 1 < len(args):
            i += 2
            continue
        if arg == "-c" and i + 1 < len(args):
            cmd_args.extend(args[i + 1 :])
            break
        cmd_args.extend(args[i:])
        break

    if not cmd_args:
        cmd_args = ["id"]

    # If already uid=0, execute directly
    if os.getuid() == 0 and os.geteuid() == 0:
        res = subprocess.run(" ".join(cmd_args), shell=True, cwd=os.getcwd())
        sys.exit(res.returncode)

    caller = pwd.getpwuid(os.getuid()).pw_name
    payload = {
        "caller": caller,
        "uid": os.getuid(),
        "gid": os.getgid(),
        "cwd": os.getcwd(),
        "command": " ".join(cmd_args),
    }

    if not os.path.exists(SOCKET_PATH):
        print(
            f"sudo: root socket {SOCKET_PATH} is not active.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(15.0)
        client.connect(SOCKET_PATH)
        client.sendall((json.dumps(payload) + "\n").encode("utf-8"))

        chunks = []
        while True:
            data = client.recv(65536)
            if not data:
                break
            chunks.append(data)
        client.close()

        resp = json.loads(b"".join(chunks).decode("utf-8", "replace"))
        if resp.get("stdout"):
            sys.stdout.write(resp["stdout"])
        if resp.get("stderr"):
            sys.stderr.write(resp["stderr"])
        sys.exit(int(resp.get("exitCode", 0)))
    except Exception as e:
        print(f"sudo root bridge error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
