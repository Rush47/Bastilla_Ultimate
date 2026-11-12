import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { SystemOverviewResponse, AgentId } from "../types/bastilla";
import { calculateHohmannTransferDeltaV } from "../utils/svlKernel";
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Rocket,
  Radio,
  Shield,
} from "lucide-react";
import { apiFetchJson } from "../utils/apiClient";

interface SolarSystem3DViewProps {
  overview: SystemOverviewResponse | null;
  onRefresh: () => void;
}

interface PlanetSpec {
  name: string;
  radius: number;
  distance: number;
  speed: number;
  color: number;
  bandColor: number;
  hasRings?: boolean;
  orbitAu: number;
}

const PLANETS: PlanetSpec[] = [
  { name: "Mercury", radius: 0.7, distance: 10, speed: 1.6, color: 0x94a3b8, bandColor: 0x64748b, orbitAu: 0.39 },
  { name: "Venus", radius: 1.1, distance: 15, speed: 1.15, color: 0xf59e0b, bandColor: 0xd97706, orbitAu: 0.72 },
  { name: "Earth", radius: 1.3, distance: 22, speed: 0.85, color: 0x0ea5e9, bandColor: 0x10b981, orbitAu: 1.0 },
  { name: "Mars", radius: 1.0, distance: 30, speed: 0.65, color: 0xef4444, bandColor: 0xb91c1c, orbitAu: 1.52 },
  { name: "Jupiter", radius: 2.8, distance: 42, speed: 0.38, color: 0xd97706, bandColor: 0x92400e, orbitAu: 5.2 },
  { name: "Saturn", radius: 2.3, distance: 56, speed: 0.26, color: 0xeab308, bandColor: 0xa16207, hasRings: true, orbitAu: 9.58 },
  { name: "Uranus", radius: 1.7, distance: 70, speed: 0.18, color: 0x06b6d4, bandColor: 0x0891b2, orbitAu: 19.2 },
  { name: "Neptune", radius: 1.65, distance: 82, speed: 0.14, color: 0x3b82f6, bandColor: 0x1d4ed8, orbitAu: 30.05 },
];

function createProceduralPlanetTexture(primaryHex: number, secondaryHex: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const c1 = new THREE.Color(primaryHex);
  const c2 = new THREE.Color(secondaryHex);

  for (let y = 0; y < 128; y++) {
    const t = 0.5 + 0.5 * Math.sin((y / 128) * Math.PI * 10);
    const r = Math.round((c1.r * (1 - t) + c2.r * t) * 255);
    const g = Math.round((c1.g * (1 - t) + c2.g * t) * 255);
    const b = Math.round((c1.b * (1 - t) + c2.b * t) * 255);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, 256, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Composite 7-part procedural Dreadnought / Orbital Station (THREE.Group)
 * Following Three.js skill directive: 3-12 part composite models with varied roughness/metalness
 */
function buildCompositeSpacecraft(accentHex: number): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.85,
    roughness: 0.25,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.92,
    roughness: 0.55,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.8,
    metalness: 0.3,
    roughness: 0.15,
  });

  // 1. Primary hull fuselage
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, 2.2, 8), hullMat);
  hull.rotation.x = Math.PI / 2;
  group.add(hull);

  // 2. Forward command bridge
  const bridge = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.8, 8), trimMat);
  bridge.rotation.x = Math.PI / 2;
  bridge.position.z = 1.4;
  group.add(bridge);

  // 3 & 4. Port & Starboard solar/radiator wings
  const wingGeo = new THREE.BoxGeometry(2.4, 0.06, 0.55);
  const wings = new THREE.Mesh(wingGeo, trimMat);
  wings.position.z = -0.1;
  group.add(wings);

  // 5. Rotating habitation/sensor ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.07, 10, 24), hullMat);
  ring.position.z = 0.3;
  group.add(ring);

  // 6. Quantum SVL Core beacon
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), coreMat);
  beacon.position.set(0, 0.35, 0.3);
  group.add(beacon);

  // 7. Twin ion thruster nozzles
  const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.4, 8), coreMat);
  thruster.rotation.x = Math.PI / 2;
  thruster.position.z = -1.25;
  group.add(thruster);

  return group;
}

export const SolarSystem3DView: React.FC<SolarSystem3DViewProps> = ({
  overview,
  onRefresh,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [selectedFocus, setSelectedFocus] = useState<string>("Overview");
  const [simSpeed, setSimSpeed] = useState<number>(1.0);
  const [activeSubPanel, setActiveSubPanel] = useState<"none" | "mission" | "hypercomm">("none");

  const [msnCodename, setMsnCodename] = useState<string>("");
  const [msnTarget, setMsnTarget] = useState<string>("Mars");
  const [msnAgent, setMsnAgent] = useState<AgentId>("astyria");
  const [msnObjective, setMsnObjective] = useState<string>("");
  const [msnError, setMsnError] = useState<string>("");

  const [relayId, setRelayId] = useState<string>("HCR-SOL-L2");
  const [packetHeader, setPacketHeader] = useState<string>("SVL_QUANTUM_PACKET_364");

  const focusRef = useRef<string>("Overview");
  const speedRef = useRef<number>(1.0);

  useEffect(() => {
    focusRef.current = selectedFocus;
  }, [selectedFocus]);

  useEffect(() => {
    speedRef.current = simSpeed;
  }, [simSpeed]);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return true;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || 1200;
    const height = container.clientHeight || 680;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070d);
    scene.fog = new THREE.FogExp2(0x05070d, 0.0035);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 600);
    camera.position.set(0, 48, 88);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Studio warm/cool lighting rig
    const hemiLight = new THREE.HemisphereLight(0x8b5cf6, 0x0f172a, 0.65);
    scene.add(hemiLight);

    const sunPointLight = new THREE.PointLight(0xffedd5, 3.8, 300, 0.5);
    sunPointLight.position.set(0, 0, 0);
    scene.add(sunPointLight);

    const rimDirLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
    rimDirLight.position.set(-50, 60, -40);
    scene.add(rimDirLight);

    // Composite Sol Star Core + Corona Rings
    const solGroup = new THREE.Group();
    const solTex = createProceduralPlanetTexture(0xf59e0b, 0xea580c);
    solTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const solMat = new THREE.MeshStandardMaterial({
      map: solTex,
      color: 0xffffff,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.2,
      roughness: 0.2,
    });
    const solSphere = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 24), solMat);
    solGroup.add(solSphere);

    const coronaRing = new THREE.Mesh(
      new THREE.TorusGeometry(5.6, 0.12, 12, 48),
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.9,
        roughness: 0.3,
      })
    );
    coronaRing.rotation.x = Math.PI / 2;
    solGroup.add(coronaRing);
    scene.add(solGroup);

    // Instanced Starfield (> 20 identical items -> InstancedMesh)
    const starCount = 320;
    const starGeo = new THREE.OctahedronGeometry(0.18, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    const starsInstanced = new THREE.InstancedMesh(starGeo, starMat, starCount);
    const dummyMat = new THREE.Matrix4();
    const dummyPos = new THREE.Vector3();
    for (let i = 0; i < starCount; i++) {
      const r = 110 + (i % 70) * 2.2;
      const theta = i * 2.39996;
      const phi = Math.acos(1 - (2 * (i + 0.5)) / starCount);
      dummyPos.set(
        r * Math.sin(phi) * Math.cos(theta),
        (r * Math.cos(phi)) * 0.45,
        r * Math.sin(phi) * Math.sin(theta)
      );
      dummyMat.makeTranslation(dummyPos.x, dummyPos.y, dummyPos.z);
      starsInstanced.setMatrixAt(i, dummyMat);
    }
    starsInstanced.instanceMatrix.needsUpdate = true;
    starsInstanced.computeBoundingSphere();
    scene.add(starsInstanced);

    // Build Planets + Orbits + Composite Fleet Spacecraft
    const planetNodes: {
      spec: PlanetSpec;
      pivot: THREE.Group;
      meshGroup: THREE.Group;
      angle: number;
    }[] = [];

    PLANETS.forEach((spec, idx) => {
      // Orbit ring line
      const orbitGeo = new THREE.RingGeometry(spec.distance - 0.06, spec.distance + 0.06, 64);
      orbitGeo.rotateX(-Math.PI / 2);
      const orbitMat = new THREE.MeshBasicMaterial({
        color: 0x334155,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
      });
      const orbitMesh = new THREE.Mesh(orbitGeo, orbitMat);
      orbitMesh.position.y = -0.02 * (idx + 1);
      scene.add(orbitMesh);

      const pivot = new THREE.Group();
      const meshGroup = new THREE.Group();
      meshGroup.position.set(spec.distance, 0, 0);

      const pTex = createProceduralPlanetTexture(spec.color, spec.bandColor);
      pTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const pMat = new THREE.MeshStandardMaterial({
        map: pTex,
        color: 0xffffff,
        roughness: 0.65,
        metalness: 0.15,
      });
      const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(spec.radius, 20, 20), pMat);
      meshGroup.add(bodyMesh);

      // Saturn / Jovian Rings
      if (spec.hasRings) {
        const ringGeo = new THREE.RingGeometry(spec.radius * 1.4, spec.radius * 2.3, 40);
        ringGeo.rotateX(-Math.PI / 2.3);
        const ringMat = new THREE.MeshStandardMaterial({
          color: 0xfde047,
          roughness: 0.4,
          metalness: 0.5,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75,
        });
        meshGroup.add(new THREE.Mesh(ringGeo, ringMat));
      }

      // Attach a composite 7-part Bastilla Fleet Vessel orbiting Earth, Mars, Jupiter, Saturn
      if (["Earth", "Mars", "Jupiter", "Saturn"].includes(spec.name)) {
        const shipAccent =
          spec.name === "Earth"
            ? 0x8b5cf6
            : spec.name === "Mars"
            ? 0xef4444
            : spec.name === "Jupiter"
            ? 0x06b6d4
            : 0xf59e0b;
        const ship = buildCompositeSpacecraft(shipAccent);
        ship.scale.setScalar(0.85);
        ship.position.set(0, spec.radius + 1.6, 0);
        meshGroup.add(ship);
      }

      const startAngle = idx * 1.1;
      pivot.rotation.y = startAngle;
      pivot.add(meshGroup);
      scene.add(pivot);

      planetNodes.push({ spec, pivot, meshGroup, angle: startAngle });
    });

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    const targetCamPos = new THREE.Vector3(0, 48, 88);
    const targetLookAt = new THREE.Vector3(0, 0, 0);
    const currentLookAt = new THREE.Vector3(0, 0, 0);
    const worldPosScratch = new THREE.Vector3();

    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      const mult = speedRef.current;

      solGroup.rotation.y += dt * 0.25 * mult;

      for (let i = 0; i < planetNodes.length; i++) {
        const node = planetNodes[i];
        node.angle += dt * node.spec.speed * 0.35 * mult;
        node.pivot.rotation.y = node.angle;
        node.meshGroup.rotation.y += dt * 0.6;
      }

      // Smooth exponential camera damping toward selected focus
      const focusName = focusRef.current;
      if (focusName === "Overview") {
        targetCamPos.set(0, 48, 88);
        targetLookAt.set(0, 0, 0);
      } else {
        const found = planetNodes.find((p) => p.spec.name === focusName);
        if (found) {
          found.meshGroup.getWorldPosition(worldPosScratch);
          targetLookAt.copy(worldPosScratch);
          targetCamPos.set(
            worldPosScratch.x + found.spec.radius * 4 + 6,
            worldPosScratch.y + found.spec.radius * 2.5 + 4,
            worldPosScratch.z + found.spec.radius * 4 + 8
          );
        }
      }

      const dampFactor = 1 - Math.exp(-4.5 * dt);
      camera.position.lerp(targetCamPos, dampFactor);
      currentLookAt.lerp(targetLookAt, dampFactor);
      camera.lookAt(currentLookAt);

      renderer.render(scene, camera);
      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    const handleResize = () => {
      if (!container || disposed) return;
      const w = container.clientWidth || 1200;
      const h = container.clientHeight || 680;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      renderer.dispose();
    };
  }, []);

  const fleet = overview?.host?.db?.fleet || [];
  const missions = overview?.host?.db?.missions || [];
  const relays = overview?.host?.db?.hypercomm || [];

  const handleCreateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msnCodename.trim() || !msnObjective.trim()) {
      setMsnError("Podaj kryptonim misji oraz cel operacyjny.");
      return;
    }
    setMsnError("");
    const targetSpec = PLANETS.find((p) => p.name === msnTarget) || PLANETS[3];
    const deltaV = calculateHohmannTransferDeltaV(1.0, targetSpec.orbitAu);

    try {
      const data = await apiFetchJson<any>("/api/fleet/mission", {
        method: "POST",
        body: JSON.stringify({
          codename: msnCodename,
          targetBody: msnTarget,
          leadAgent: msnAgent,
          vesselId: "BSV-03-ASTRAEA",
          objective: msnObjective,
          deltaV,
        }),
      });
      if (data.ok) {
        setMsnCodename("");
        setMsnObjective("");
        setActiveSubPanel("none");
        onRefresh();
      }
    } catch (err: any) {
      setMsnError(err?.message || "Błąd zapisu misji orbitalnej.");
    }
  };

  const handleSendHypercomm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packetHeader.trim()) return;
    try {
      await apiFetchJson("/api/fleet/hypercomm", {
        method: "POST",
        body: JSON.stringify({ relayId, packetHeader }),
      });
      setActiveSubPanel("none");
      onRefresh();
    } catch (err: any) {
      setMsnError(err?.message || "Błąd transmisji hiperkomunikacji.");
    }
  };

  return (
    <div className="bg-[#05070d] flex flex-col">
      {/* Unobstructed 3D Solar System Viewport with Collapsible Bottom Control Dock */}
      <div className="relative w-full h-[540px] border-b border-slate-800 overflow-hidden">
        {/* Isolated WebGL Canvas Mount */}
        <div
          ref={canvasMountRef}
          data-testid="solar-system-3d-canvas"
          className="w-full h-full cursor-crosshair"
        />

        {/* Minimal Top-Left Spec Header (No Side-Panel Clutter) */}
        <div className="absolute top-4 left-6 z-10 pointer-events-none bg-[#0a0e17]/90 border border-slate-800 rounded-lg px-4 py-2.5">
          <div className="font-display font-bold text-sm text-white">
            MAPA UKŁADU SŁONECZNEGO 3D · EPHEMERYDY SVL ASTYRIA
          </div>
          <div className="text-xs font-mono-tabular text-slate-400 mt-0.5">
            Kamera: {selectedFocus} · Prędkość: {simSpeed.toFixed(1)}x · Okręty Floty: {fleet.length} · Przekaźniki: {relays.length}
          </div>
        </div>

        {/* Collapsible Unified Bottom Control Dock */}
        <div
          className="absolute bottom-4 left-0 right-0 mx-auto z-10 w-[min(920px,94vw)] transition-transform duration-200"
          style={{
            transform: dockCollapsed
              ? "translateY(calc(100% - 34px))"
              : "translateY(0)",
          }}
        >
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setDockCollapsed((v) => !v)}
              className="px-4 py-1 rounded-t-lg bg-[#0d121d] border border-b-0 border-slate-700 text-xs font-mono-tabular text-slate-200 hover:text-white flex items-center gap-1.5"
            >
              {dockCollapsed ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" /> Pokaż Dock Sterowania 3D
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" /> Ukryj Dock Sterowania 3D
                </>
              )}
            </button>
          </div>

          <div className="bg-[#0d121d] border border-slate-700 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xl">
            <div className="flex flex-wrap items-center gap-1.5">
              {["Overview", "Earth", "Mars", "Jupiter", "Saturn", "Neptune"].map(
                (target) => (
                  <button
                    key={target}
                    type="button"
                    onClick={() => setSelectedFocus(target)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selectedFocus === target
                        ? "bg-violet-600 text-white"
                        : "bg-[#141c2c] text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {target === "Overview" ? "Układ Słoneczny" : target}
                  </button>
                )
              )}
            </div>

            <div className="flex items-center gap-3">
              <label
                htmlFor="orbital-speed-slider"
                className="text-xs font-mono-tabular text-slate-300 whitespace-nowrap"
              >
                Orbita: {simSpeed.toFixed(1)}x
              </label>
              <input
                id="orbital-speed-slider"
                type="range"
                min="0"
                max="3"
                step="0.2"
                value={simSpeed}
                onChange={(e) => setSimSpeed(parseFloat(e.target.value))}
                className="w-24 accent-violet-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setActiveSubPanel(activeSubPanel === "mission" ? "none" : "mission")
                }
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Nowa Misja Orbitalna
              </button>
              <button
                type="button"
                onClick={() =>
                  setActiveSubPanel(
                    activeSubPanel === "hypercomm" ? "none" : "hypercomm"
                  )
                }
                className="px-3 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Pakiet Hiperkomunikacji
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Expandable Action Forms (Mission / Hypercomm) */}
      {activeSubPanel === "mission" && (
        <div className="px-6 pt-5">
          <form
            onSubmit={handleCreateMission}
            className="bg-[#0c1018] border border-emerald-700/60 rounded-xl p-5 space-y-3"
          >
            <div className="font-display font-bold text-sm text-white">
              Autoryzacja Nowej Misji Kosmicznej (Zapis do SQLite + Obliczenie Hohmann Δv)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                type="text"
                aria-label="Kryptonim misji"
                placeholder="Kryptonim (np. OPERATION TITAN SHIELD)"
                value={msnCodename}
                onChange={(e) => setMsnCodename(e.target.value)}
                className="px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
              />
              <select
                aria-label="Planeta docelowa"
                value={msnTarget}
                onChange={(e) => setMsnTarget(e.target.value)}
                className="px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
              >
                {PLANETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.orbitAu} AU)
                  </option>
                ))}
              </select>
              <select
                aria-label="Agent dowodzący"
                value={msnAgent}
                onChange={(e) => setMsnAgent(e.target.value as AgentId)}
                className="px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
              >
                <option value="astyria">Astyria (Wizja / Nawigacja)</option>
                <option value="aurelius">Aurelius (Flota / Logistyka)</option>
                <option value="alex">Alex (Obrona Taktyczna)</option>
                <option value="aria">Aria (Dowództwo Główne)</option>
              </select>
              <input
                type="text"
                aria-label="Cel operacyjny misji"
                placeholder="Cel operacyjny misji..."
                value={msnObjective}
                onChange={(e) => setMsnObjective(e.target.value)}
                className="px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
              />
            </div>
            {msnError && <div className="text-xs text-rose-400">{msnError}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="submit"
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Zatwierdź Misję
              </button>
            </div>
          </form>
        </div>
      )}

      {activeSubPanel === "hypercomm" && (
        <div className="px-6 pt-5">
          <form
            onSubmit={handleSendHypercomm}
            className="bg-[#0c1018] border border-cyan-700/60 rounded-xl p-5 flex flex-wrap items-center gap-3"
          >
            <span className="font-display font-bold text-sm text-white">
              Transmisja Kwantowej Hiperkomunikacji:
            </span>
            <select
              aria-label="Przekaźnik hiperkomunikacji"
              value={relayId}
              onChange={(e) => setRelayId(e.target.value)}
              className="px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
            >
              {relays.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.relay_name} ({r.location_au} AU)
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Nagłówek pakietu kwantowego"
              value={packetHeader}
              onChange={(e) => setPacketHeader(e.target.value)}
              className="flex-1 px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs font-mono-tabular text-white"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold"
            >
              Wyślij Pakiet Kwantowy
            </button>
          </form>
        </div>
      )}

      {/* Telemetry Grids below 3D Stage: Fleet, Missions, and Hypercomm Infrastructure */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Fleet Units (4 cols) */}
        <section className="lg:col-span-4 bg-[#0c1018] border border-slate-800 rounded-xl p-5">
          <h3 className="font-display text-base font-bold text-white mb-3">
            01. Rejestr Floty Bastilla OS
          </h3>
          <div className="space-y-3">
            {fleet.map((unit) => (
              <div
                key={unit.id}
                className="p-3.5 rounded-lg bg-[#111723] border border-slate-800 text-xs"
              >
                <div className="flex items-center justify-between font-semibold text-white">
                  <span>{unit.name}</span>
                  <span className="font-mono-tabular text-emerald-400">
                    {unit.status}
                  </span>
                </div>
                <div className="text-slate-400 mt-0.5">
                  {unit.vessel_class} · Sektor: {unit.sector}
                </div>
                <div className="flex items-center justify-between font-mono-tabular text-slate-300 mt-2 pt-2 border-t border-slate-800">
                  <span>Dowódca: {unit.commander_agent.toUpperCase()}</span>
                  <span>Kadłub: {unit.hull_integrity}%</span>
                  <span>Moc: {unit.energy_output_gw} GW</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Active Space Missions (4 cols) */}
        <section className="lg:col-span-4 bg-[#0c1018] border border-slate-800 rounded-xl p-5">
          <h3 className="font-display text-base font-bold text-white mb-3">
            02. Aktywne Misje i Transfery Orbitalne
          </h3>
          <div className="space-y-3">
            {missions.map((m) => (
              <div
                key={m.id}
                className="p-3.5 rounded-lg bg-[#111723] border border-slate-800 text-xs"
              >
                <div className="flex items-center justify-between font-semibold text-white">
                  <span>
                    {m.id} · {m.codename}
                  </span>
                  <span className="font-mono-tabular text-violet-300">
                    Δv {m.delta_v_kms} km/s
                  </span>
                </div>
                <p className="text-slate-400 mt-1 leading-relaxed">{m.objective}</p>
                <div className="flex items-center justify-between font-mono-tabular text-slate-300 mt-2 pt-2 border-t border-slate-800">
                  <span>Cel: {m.target_body}</span>
                  <span>Agent: {m.lead_agent.toUpperCase()}</span>
                  <span className="text-cyan-400">Postęp: {m.progress_pct}%</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quantum Hypercomm Relays & Infrastructure (4 cols) */}
        <section className="lg:col-span-4 bg-[#0c1018] border border-slate-800 rounded-xl p-5">
          <h3 className="font-display text-base font-bold text-white mb-3">
            03. Sieć Hiperkomunikacji i Infrastruktura
          </h3>
          <div className="space-y-3">
            {relays.map((r) => (
              <div
                key={r.id}
                className="p-3.5 rounded-lg bg-[#111723] border border-slate-800 text-xs"
              >
                <div className="flex items-center justify-between font-semibold text-white">
                  <span>{r.relay_name}</span>
                  <span className="font-mono-tabular text-cyan-400">
                    {r.location_au} AU
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono-tabular text-slate-400 mt-1">
                  <span>Pasmo: {r.band_thz} THz</span>
                  <span>Splątanie: {r.entanglement_fidelity}%</span>
                  <span>Opóźnienie: {r.latency_ms} ms</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800 font-mono-tabular text-[11px] text-emerald-300 truncate">
                  Ostatni pakiet: {r.last_packet}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
