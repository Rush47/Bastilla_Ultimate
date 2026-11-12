import { readFileSync } from "node:fs";

export interface SphericalStreamResult<T = unknown> {
  stream: string;
  ok: boolean;
  latencyMs: number;
  data?: T;
  error?: string;
}

export interface SphericalContextSnapshot {
  collectedAt: string;
  concurrencyCap: number;
  memAvailableMb: number;
  degradedStreams: string[];
  streams: Record<string, SphericalStreamResult>;
}

function getMemAvailableMb(): number {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const match = raw.match(/MemAvailable:\s+(\d+)\s+kB/);
    return match ? Math.round(parseInt(match[1], 10) / 1024) : 0;
  } catch {
    return 0;
  }
}

async function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    fn().then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Polymorphic, asynchronous, asymmetric "Spherical Worker" context aggregator.
 * Collects heterogeneous system/agent/model/repo/GUI streams under a strict
 * concurrency cap, per-stream timeout, and memory guard.
 */
export async function collectSphericalContext(
  probes: Array<{ name: string; run: () => Promise<any>; timeoutMs?: number }>,
  options: { concurrencyCap?: number } = {}
): Promise<SphericalContextSnapshot> {
  const memAvailableMb = getMemAvailableMb();
  const baseCap = Math.max(1, Math.min(options.concurrencyCap ?? 3, 6));
  const concurrencyCap = memAvailableMb > 0 && memAvailableMb < 512 ? 1 : baseCap;

  const streams: Record<string, SphericalStreamResult> = {};
  const degradedStreams: string[] = [];
  let cursor = 0;

  async function workerLoop() {
    while (cursor < probes.length) {
      const idx = cursor++;
      const probe = probes[idx];
      const start = Date.now();
      try {
        const data = await runWithTimeout(probe.run, probe.timeoutMs ?? 2000);
        streams[probe.name] = {
          stream: probe.name,
          ok: true,
          latencyMs: Date.now() - start,
          data,
        };
      } catch (err: any) {
        degradedStreams.push(probe.name);
        streams[probe.name] = {
          stream: probe.name,
          ok: false,
          latencyMs: Date.now() - start,
          error: err?.message || "Probe failed",
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrencyCap, probes.length) }, () => workerLoop())
  );

  return {
    collectedAt: new Date().toISOString(),
    concurrencyCap,
    memAvailableMb,
    degradedStreams,
    streams,
  };
}
