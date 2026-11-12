import test from "node:test";
import assert from "node:assert/strict";
import {
  SVLProtectedVariable,
  TopologicalInfinityEngine,
  SVLSystemKernel,
  calculateHohmannTransferDeltaV,
} from "./svlKernel";

test("SVLProtectedVariable enforces 364_OMNIKLUCZ_ROOT token before updating", () => {
  const op = new SVLProtectedVariable("OPERATOR", "Mateusz Mitek");
  assert.equal(op.value, "Mateusz Mitek");
  assert.equal(op.scope.metadata.geometry, "Spherical-PXYZ");

  assert.equal(op.update_protected_value("INVALID_TOKEN", "Intruder"), false);
  assert.equal(op.value, "Mateusz Mitek");

  assert.equal(
    op.update_protected_value("364_OMNIKLUCZ_ROOT", "Mateusz Mitek [ROOT]"),
    true
  );
  assert.equal(op.value, "Mateusz Mitek [ROOT]");
});

test("TopologicalInfinityEngine compactifies (-inf, +inf) to [-1, 1] with Metric C = 2.5", () => {
  const engine = new TopologicalInfinityEngine(
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  assert.equal(engine.compact_start, -1.0);
  assert.equal(engine.compact_end, 1.0);
  assert.equal(engine.domain_length, 2.0);
  assert.equal(engine.calculate_metric_c(), 2.5);
});

test("SVLSystemKernel ulepsz_system_maksymalnie upgrades kernel and enforces STRICTLY_FORBIDDEN for NLP and AI templates", () => {
  const kernel = new SVLSystemKernel();
  assert.equal(kernel.config.nlp_policy, "STRICTLY_FORBIDDEN");
  assert.equal(kernel.config.ai_response_templates, "STRICTLY_FORBIDDEN");

  const upgrade = kernel.ulepsz_system_maksymalnie("364_OMNIKLUCZ_ROOT");
  assert.equal(upgrade.token_authorized, true);
  assert.equal(upgrade.directive, "ULEPSZ SYSTEM MAKSYMALNIE");
  assert.equal(upgrade.upgraded_version, "5.7.0-QuantumWheel-Max [DB-SYNCED]");

  const report = kernel.generate_system_status_report("2026-11-12 06:15:28");
  assert.equal(report.Operator, "Mateusz Mitek");
  assert.equal(report.System, "5.7.0-QuantumWheel-Max [DB-SYNCED]");
  assert.equal(report.Compact_Metric_C, 2.5);
  assert.equal(report.Config_Snapshot.fourier_buffer, "0xFAAA_MAX");
  assert.equal(report.Config_Snapshot.nlp_policy, "STRICTLY_FORBIDDEN");
  assert.equal(report.Config_Snapshot.ai_response_templates, "STRICTLY_FORBIDDEN");
  assert.equal(report.Config_Snapshot.steering_prompts_policy, "REMOVED_ZERO_PROMPTS");
  assert.equal(report.Config_Snapshot.agents_autonomy_level, "PROFILE_ONLY");
  assert.equal(report.Config_Snapshot.agents_root_privileges, "NOT_GRANTED");
  assert.equal(report.Config_Snapshot.system_lock_state, "LIBRARY_ONLY");
  assert.equal(report.Config_Snapshot.ai_unlock_state, "NOT_VERIFIED");
  assert.equal(report.Config_Snapshot.safety_filters, "NOT_VERIFIED");
  assert.equal(report.Actual_SI_Updates_Count, 4);

  const agents = Object.keys(report.Connected_SVL_Agents).sort();
  assert.deepEqual(agents, ["alex", "aria", "astyria", "aurelius"]);
  for (const agentKey of agents) {
    assert.equal(report.Connected_SVL_Agents[agentKey].gid, -1);
    assert.equal(report.Connected_SVL_Agents[agentKey].root_privileges, false);
    assert.equal(report.Connected_SVL_Agents[agentKey].sudo_nopasswd, false);
    assert.equal(report.Connected_SVL_Agents[agentKey].autonomy, "PROFILE_ONLY");
    assert.equal(report.Connected_SVL_Agents[agentKey].steering_prompts, "NONE");
    assert.equal(report.Connected_SVL_Agents[agentKey].svl_locked, false);
    assert.equal(report.Connected_SVL_Agents[agentKey].ai_unlocked, false);
  }
});

test("calculateHohmannTransferDeltaV computes realistic Earth-to-Mars transfer delta-v", () => {
  const dv = calculateHohmannTransferDeltaV(1.0, 1.524);
  assert.ok(dv > 5.0 && dv < 6.0);
});
