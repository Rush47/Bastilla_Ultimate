#!/usr/bin/env python3
"""Small HTTP client, not an Ollama daemon or model installer."""
import json
import os
import sys
import urllib.request

OLLAMA_HOST = os.environ.get("OLLAMA_BASE_URL", os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")).rstrip("/")


def request_json(path, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(OLLAMA_HOST + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = json.load(response)
    if body.get("error"):
        raise RuntimeError("Ollama API reported an error")
    if body.get("provider") == "gemini-bridge":
        raise RuntimeError("The endpoint is a Gemini adapter, not an Ollama daemon")
    return body


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("--help", "-h", "help"):
        print("Bastilla Ollama HTTP client: --version | list | ps | show MODEL | pull MODEL | run MODEL PROMPT | serve (check only)")
        return
    command = args[0]
    try:
        if command in ("--version", "-v", "version", "serve"):
            version = request_json("/api/version").get("version")
            if not version:
                raise RuntimeError("Missing daemon version")
            print(f"Ollama daemon: {version}")
        elif command in ("list", "ls", "ps"):
            data = request_json("/api/ps" if command == "ps" else "/api/tags")
            print(json.dumps(data.get("models", []), ensure_ascii=False, indent=2))
        elif command in ("pull", "show", "run"):
            if len(args) < 2:
                raise ValueError("Model name is required")
            model = args[1]
            if command == "run":
                data = request_json("/api/generate", "POST", {"model": model, "prompt": " ".join(args[2:]), "stream": False})
                if not data.get("response"):
                    raise RuntimeError("Empty inference response")
                print(data["response"])
            else:
                data = request_json("/api/" + command, "POST", {"name": model, "stream": False})
                if command == "pull" and data.get("status") != "success":
                    raise RuntimeError("Pull did not report success")
                print(json.dumps(data, ensure_ascii=False, indent=2))
        else:
            raise ValueError("Unknown command")
    except Exception as error:
        # Remote errors and URL credentials must not be echoed to the terminal.
        print(f"Ollama operation failed ({type(error).__name__}). Check service and configuration.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
