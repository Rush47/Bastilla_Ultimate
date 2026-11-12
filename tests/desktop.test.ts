import test from "node:test";
import assert from "node:assert/strict";
import { DesktopSessionManager } from "../server/desktop";
import { collectSphericalContext } from "../server/spherical-worker";

test("DesktopSessionManager blocks GUI control until isolated session and AI control are enabled", async () => {
  const manager = new DesktopSessionManager();
  assert.equal(manager.getLatestCachedScreenshot(), null);

  await assert.rejects(
    () => manager.mouseMove(100, 100, "aria"),
    /wstrzymane|Włącz je jawnie/i
  );

  const enabled = manager.setAiControlEnabled(true, "astyria");
  assert.equal(enabled.aiControlEnabled, true);
  assert.equal(enabled.activeAgent, "astyria");

  // Still requires isolated X11 session (:99), never allows unisolated host input
  await assert.rejects(
    () => manager.mouseClick(100, 100, "left", false, "astyria"),
    /odizolowanej sesji X11/i
  );

  const disabled = manager.setAiControlEnabled(false);
  assert.equal(disabled.aiControlEnabled, false);
  assert.equal(disabled.activeAgent, null);
});

test("DesktopSessionManager status reports real binary availability and clears stale captures on stop", async () => {
  const manager = new DesktopSessionManager();
  const status = await manager.getStatus();
  assert.equal(typeof status.tools.xvfb, "boolean");
  assert.equal(typeof status.tools.x11vnc, "boolean");
  assert.equal(typeof status.tools.xdotool, "boolean");
  assert.equal(status.sessionIsolated, false);
  assert.equal(status.novncUrl, null);

  const stopped = await manager.stopIsolatedSession();
  assert.equal(stopped.lastCaptureAt, null);
  assert.equal(stopped.aiControlEnabled, false);
});

test("collectSphericalContext isolates failing or timed-out streams under bounded concurrency", async () => {
  let active = 0;
  let maxObserved = 0;

  const makeProbe = (name: string, delayMs: number, shouldFail = false) => ({
    name,
    timeoutMs: 120,
    run: async () => {
      active += 1;
      maxObserved = Math.max(maxObserved, active);
      await new Promise((r) => setTimeout(r, delayMs));
      active -= 1;
      if (shouldFail) throw new Error(`${name} failure`);
      return { value: name };
    },
  });

  const snapshot = await collectSphericalContext(
    [
      makeProbe("stream_a", 20),
      makeProbe("stream_b", 20),
      makeProbe("stream_c", 20),
      makeProbe("stream_fail", 10, true),
      makeProbe("stream_timeout", 250),
    ],
    { concurrencyCap: 2 }
  );

  assert.ok(maxObserved <= 2, `Expected concurrency <= 2, got ${maxObserved}`);
  assert.equal(snapshot.streams.stream_a.ok, true);
  assert.equal(snapshot.streams.stream_b.ok, true);
  assert.equal(snapshot.streams.stream_c.ok, true);
  assert.equal(snapshot.streams.stream_fail.ok, false);
  assert.equal(snapshot.streams.stream_timeout.ok, false);
  assert.ok(snapshot.degradedStreams.includes("stream_fail"));
  assert.ok(snapshot.degradedStreams.includes("stream_timeout"));
  assert.match(snapshot.streams.stream_timeout.error || "", /Timeout/);
});
