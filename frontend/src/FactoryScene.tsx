import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { robotPose } from "./robotMotion";
import {
  productionPose,
  PART_SECONDS,
  BELT_PART_Y,
  type WorkflowRoute,
} from "./productionMotion";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  RefreshCw,
  Expand,
  Layers,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { architectureNames, architectureOf, type Facility } from "./models";

type StationPosition = { x: number; z: number };
function layout(f: Facility): StationPosition[] {
  const a = architectureOf(f),
    n = f.stations.length;
  if (a === "converging" && n >= 3)
    return f.stations.map((_, i) =>
      i < 2 ? { x: -3.3, z: i === 0 ? -2.1 : 2.1 } : { x: (i - 2) * 3.4, z: 0 },
    );
  if (a === "parallel" && n >= 4)
    return f.stations.map((_, i) =>
      i === 0
        ? { x: -4, z: 0 }
        : i === n - 1
          ? { x: Math.ceil((n - 2) / 2) * 3.4, z: 0 }
          : { x: Math.floor((i - 1) / 2) * 3.4, z: i % 2 ? -2.3 : 2.3 },
    );
  return f.stations.map((_, i) => ({ x: i * 3.5, z: 0 }));
}
function connections(f: Facility): [number, number][] {
  const n = f.stations.length,
    a = architectureOf(f);
  if (a === "converging" && n >= 3)
    return [
      [0, 2],
      [1, 2],
      ...Array.from(
        { length: n - 3 },
        (_, i) => [i + 2, i + 3] as [number, number],
      ),
    ];
  if (a === "parallel" && n >= 4) {
    const out: [number, number][] = [];
    for (let i = 1; i < n - 1; i++) {
      out.push([i <= 2 ? 0 : i - 2, i]);
      if (i + 2 >= n - 1) out.push([i, n - 1]);
    }
    return out;
  }
  return Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);
}

export default function FactoryScene({
  facility,
  selected,
  onSelect,
}: {
  facility: Facility;
  selected: number;
  onSelect: (n: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLButtonElement | null)[]>([]);
  const leaders = useRef<(SVGPathElement | null)[]>([]);
  const leaderDots = useRef<(SVGCircleElement | null)[]>([]);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [playing, setPlaying] = useState(
    () => !matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const playRef = useRef(playing);
  playRef.current = playing;
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme || "light",
  );
  const cycleLabel = useRef<HTMLSpanElement>(null);
  const queuedLabel = useRef<HTMLSpanElement>(null);
  const transitLabel = useRef<HTMLSpanElement>(null);
  const deliveredLabel = useRef<HTMLSpanElement>(null);
  const simulationClock = useRef({ id: facility.id, time: 0 });
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const actions = useRef({
    reset: () => {},
    restart: () => {},
    zoom: (_v: number) => {},
  });
  useEffect(() => {
    const o = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme || "light"),
    );
    o.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    const el = canvasHost.current;
    if (!el) return;
    setError(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      setError(true);
      return;
    }
    const dark = theme === "dark";
    renderer.setPixelRatio(Math.min(3, Math.max(2, devicePixelRatio)));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = dark ? 1.35 : 1.12;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D factory. Drag to orbit, use controls to zoom, and select a station.",
    );
    renderer.domElement.setAttribute("role", "img");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 180);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = 0.3;
    controls.maxPolarAngle = 1.35;
    controls.minDistance = 6;
    controls.maxDistance = 75;
    const positions = layout(facility);
    const maxX = Math.max(...positions.map((p) => p.x)),
      minX = Math.min(...positions.map((p) => p.x));
    const centerX = (maxX + minX) / 2;
    positions.forEach((p) => (p.x -= centerX));
    const extent = maxX - minX + 5;
    const distance = Math.max(14, extent * 1.15);
    const initial = new THREE.Vector3(
      distance * 0.6,
      distance * 0.8,
      distance * 0.85,
    );
    camera.position.copy(initial);
    controls.target.set(0, 0.3, 0);
    controls.update();
    actions.current = {
      restart() {},
      reset() {
        camera.position.copy(initial);
        controls.target.set(0, 0.3, 0);
        controls.update();
      },
      zoom(v) {
        const d = camera.position.clone().sub(controls.target);
        const length = Math.max(
          controls.minDistance,
          Math.min(controls.maxDistance, d.length() * v),
        );
        camera.position
          .copy(controls.target)
          .add(d.normalize().multiplyScalar(length));
        controls.update();
      },
    };
    scene.add(
      new THREE.HemisphereLight(
        dark ? 0xcddbc5 : 0xffffff,
        dark ? 0x455346 : 0xb8c5b2,
        2.3,
      ),
    );
    const sun = new THREE.DirectionalLight(0xfff6e5, 2.7);
    sun.position.set(-4, 12, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xd8ead0, 1.5);
    rim.position.set(6, 5, -8);
    scene.add(rim);
    const materials: THREE.Material[] = [];
    function mat(color: string, metal = 0.25, rough = 0.55) {
      const m = new THREE.MeshStandardMaterial({
        color,
        metalness: metal,
        roughness: rough,
      });
      materials.push(m);
      return m;
    }
    const ivory = mat(dark ? "#b9c6b3" : "#e5e9df");
    const metal = mat("#7f9188", 0.65, 0.36);
    const graphite = mat("#394940", 0.45);
    const green = mat("#7eaa82", 0.4);
    const amber = mat("#c9a36b", 0.4);
    const glass = mat("#273e39", 0.7, 0.19);
    const black = mat("#17251d", 0.3);
    const silver = mat("#d0d6cb", 0.75, 0.25);
    const timber = mat("#b69a70", 0.1, 0.8);
    const orange = mat("#c59a63", 0.35);
    const box = (
      g: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      m: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(
        w > 1 && h > 0.5 && d > 0.3
          ? new RoundedBoxGeometry(w, h, d, 2, 0.035)
          : new THREE.BoxGeometry(w, h, d),
        m,
      );
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const cylinder = (
      g: THREE.Object3D,
      r: number,
      h: number,
      x: number,
      y: number,
      z: number,
      m: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    const addPassThroughDoors = (group: THREE.Group) => {
      for (const side of [-1, 1]) {
        const x = side * 0.86;
        // A dark open portal with a structural frame and retracted sliding
        // panels. The material route runs through the clear center opening.
        box(group, 0.045, 0.72, 0.72, x, 0.58, 0, black);
        box(group, 0.09, 0.86, 0.065, x, 0.61, -0.38, metal);
        box(group, 0.09, 0.86, 0.065, x, 0.61, 0.38, metal);
        box(group, 0.09, 0.08, 0.82, x, 1.02, 0, green);
        box(group, 0.035, 0.63, 0.13, x + side * 0.045, 0.57, -0.28, silver);
        box(group, 0.035, 0.63, 0.13, x + side * 0.045, 0.57, 0.28, silver);
      }
    };
    const floor = box(
      scene,
      extent + 2,
      0.13,
      9,
      0,
      -0.18,
      0,
      mat(dark ? "#25342b" : "#e4eadd", 0.1, 0.9),
    );
    floor.receiveShadow = true;
    const grid = new THREE.GridHelper(
      Math.ceil(extent + 2),
      Math.ceil(extent + 2) * 2,
      dark ? 0x4b5f4c : 0xb9c7b0,
      dark ? 0x364639 : 0xcdd6c7,
    );
    grid.position.y = -0.106;
    scene.add(grid);
    // Low curb and embedded work-zone markings give the model a physical base.
    box(scene, extent + 2, 0.08, 0.06, 0, -0.07, 4.45, metal);
    box(scene, extent + 2, 0.08, 0.06, 0, -0.07, -4.45, metal);
    const sourceIndex = Math.max(
      0,
      facility.stations.findIndex((s) =>
        /buffer|storage|warehouse|intake|stock/i.test(s),
      ),
    );
    const robotIndex = facility.stations.findIndex((s) =>
      /assembly|robot|cell|weld/i.test(s),
    );
    const targetIndex =
      robotIndex >= 0 ? robotIndex : Math.min(1, facility.stations.length - 1);
    const finalIndex = facility.stations.length - 1;
    const stock: { mesh: THREE.Mesh; start: THREE.Vector3 }[] = [];
    const beltRoutes = new Map<
      string,
      { from: THREE.Vector3; to: THREE.Vector3 }
    >();
    const stationEdges = connections(facility);
    const clickable: THREE.Object3D[] = [];
    const rings: THREE.Mesh[] = [];
    const robots: {
      base: THREE.Group;
      shoulder: THREE.Group;
      elbow: THREE.Group;
      wrist: THREE.Group;
      fingers: THREE.Mesh[];
      stage: number;
      origin: THREE.Vector3;
    }[] = [];
    const scanLights: THREE.Mesh[] = [];
    const beaconMats: THREE.MeshStandardMaterial[] = [];
    positions.forEach((p, i) => {
      const group = new THREE.Group();
      group.position.set(p.x, 0, p.z);
      group.userData.station = i;
      scene.add(group);
      const accent = facility.util[i] >= 94 ? amber : green;
      const kind = facility.stations[i].toLowerCase();
      box(
        group,
        2.0,
        0.11,
        1.65,
        0,
        0.01,
        0,
        mat(dark ? "#53634e" : "#c8d5bd", 0.1, 0.9),
      );
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.14, 1.18, 48),
        new THREE.MeshBasicMaterial({
          color: facility.util[i] >= 94 ? 0xcfaa75 : 0x91b87e,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      ring.visible = i === selectedRef.current;
      group.add(ring);
      rings.push(ring);
      if (/buffer|storage|warehouse|intake|stock/.test(kind)) {
        // Racked stock buffer with real pallets and metal parts.
        for (const x of [-0.72, 0.72])
          for (const z of [-0.5, 0.5])
            box(group, 0.065, 1.9, 0.065, x, 1, z, metal);
        for (const y of [0.22, 0.95, 1.68]) {
          box(group, 1.65, 0.065, 1.22, 0, y, 0, graphite);
          for (const z of [-0.28, 0.28]) {
            box(group, 1.32, 0.1, 0.36, 0, y + 0.08, z, timber);
            for (const x of [0.4, 0, -0.4]) {
              const mesh = box(group, 0.17, 0.12, 0.16, x, y + 0.19, z, ivory);
              if (i === sourceIndex)
                stock.push({
                  mesh,
                  start: new THREE.Vector3(p.x + x, y + 0.19, p.z + z),
                });
            }
          }
        }
      } else if (/assembly|robot|cell|weld/.test(kind)) {
        // Articulated robot transfers from the infeed to a real outfeed conveyor.
        box(group, 0.56, 0.1, 0.4, -0.28, 0.515, 0.7, graphite);
        box(group, 0.65, 0.1, 0.46, 0.505, 0.515, 0, graphite);
        for (const x of [0.25, 0.4, 0.55, 0.7, 0.82]) {
          const roller = cylinder(group, 0.047, 0.43, x, 0.58, 0, metal);
          roller.rotation.x = Math.PI / 2;
        }
        for (const z of [-0.25, 0.25])
          box(group, 0.65, 0.08, 0.04, 0.505, 0.58, z, silver);
        for (const x of [0.22, 0.78])
          box(group, 0.06, 0.5, 0.35, x, 0.22, 0, metal);
        // Fixed pickup stand: the infeed delivers one part here, then the
        // existing robot motion lifts it and places it on the outfeed rollers.
        box(group, 0.82, 0.1, 0.78, -0.28, 0.52, 0.7, graphite);
        box(group, 0.7, 0.045, 0.66, -0.28, 0.595, 0.7, green);
        for (const x of [-0.57, 0.01])
          for (const z of [0.43, 0.97])
            box(group, 0.07, 0.49, 0.07, x, 0.245, z, metal);
        for (const z of [0.39, 1.01])
          box(group, 0.76, 0.08, 0.04, -0.28, 0.63, z, silver);
        cylinder(group, 0.3, 0.23, -0.72, 0.24, -0.2, graphite);
        const arm = new THREE.Group();
        arm.position.set(-0.72, 0.39, -0.2);
        group.add(arm);
        cylinder(arm, 0.16, 0.3, 0, 0.1, 0, orange);
        const shoulder = new THREE.Group();
        shoulder.position.y = 0.25;
        arm.add(shoulder);
        const upperLength = 0.83,
          lowerLength = 0.8;
        const shoulderJoint = cylinder(shoulder, 0.17, 0.29, 0, 0, 0, graphite);
        shoulderJoint.rotation.x = Math.PI / 2;
        box(shoulder, upperLength, 0.2, 0.24, upperLength / 2, 0, 0, orange);
        box(shoulder, 0.45, 0.06, 0.25, 0.4, 0.12, 0, ivory);
        const elbow = new THREE.Group();
        elbow.position.x = upperLength;
        shoulder.add(elbow);
        const elbowJoint = cylinder(elbow, 0.145, 0.28, 0, 0, 0, graphite);
        elbowJoint.rotation.x = Math.PI / 2;
        box(elbow, lowerLength, 0.15, 0.18, lowerLength / 2, 0, 0, orange);
        box(elbow, 0.47, 0.05, 0.19, 0.32, 0.1, 0, ivory);
        const wrist = new THREE.Group();
        wrist.position.x = lowerLength;
        elbow.add(wrist);
        box(wrist, 0.27, 0.12, 0.22, 0, 0, 0, metal);
        const fingers = [
          box(wrist, 0.045, 0.19, 0.08, -0.14, -0.13, 0, graphite),
          box(wrist, 0.045, 0.19, 0.08, 0.14, -0.13, 0, graphite),
        ];
        robots.push({
          base: arm,
          shoulder,
          elbow,
          wrist,
          fingers,
          stage: i,
          origin: new THREE.Vector3(-0.72, 0.64, -0.2),
        });
      } else if (/inspection|quality|scan|test/.test(kind)) {
        // Inspection tunnel with lens, scanner and illuminated conveyor.
        box(group, 1.7, 0.22, 1.0, 0, 0.51, 0, graphite);
        for (const x of [-0.62, 0.62])
          box(group, 0.18, 1.15, 0.22, x, 0.72, -0.22, ivory);
        box(group, 1.48, 0.23, 0.42, 0, 1.38, -0.22, ivory);
        const lens = cylinder(group, 0.12, 0.26, 0, 1.13, -0.22, black);
        box(group, 1.68, 0.06, 0.7, 0, 0.596, 0.02, metal);
        const sm = new THREE.MeshStandardMaterial({
          color: 0xa1d89f,
          emissive: 0x79b77d,
          emissiveIntensity: 1,
          transparent: true,
          opacity: 0.65,
        });
        materials.push(sm);
        const scan = box(group, 0.035, 0.5, 0.6, -0.4, 0.91, 0, sm);
        scanLights.push(scan);
        box(group, 0.33, 0.4, 0.15, 0.85, 1.0, -0.15, graphite);
        box(group, 0.25, 0.26, 0.02, 0.85, 1.04, -0.06, glass);
      } else {
        // Enclosed CNC machine with front glazing, control panel and spindle.
        box(group, 1.65, 1.4, 1.18, 0, 0.81, 0, ivory);
        box(group, 1.6, 0.12, 1.24, 0, 1.56, 0, accent);
        box(group, 1.05, 0.83, 0.04, -0.18, 0.94, 0.61, glass);
        box(group, 0.035, 0.8, 0.06, -0.18, 0.94, 0.645, metal);
        box(group, 0.13, 0.3, 0.08, 0.12, 0.91, 0.665, silver);
        box(group, 0.32, 0.5, 0.12, 0.63, 1.05, 0.64, graphite);
        box(group, 0.24, 0.23, 0.02, 0.63, 1.16, 0.71, glass);
        for (let j = 0; j < 3; j++)
          box(
            group,
            0.04,
            0.04,
            0.02,
            0.54 + j * 0.085,
            0.94,
            0.715,
            j === 0 ? green : amber,
          );
        box(group, 1.2, 0.22, 0.07, -0.1, 0.29, 0.64, accent);
        for (let j = 0; j < 7; j++)
          box(group, 0.065, 0.09, 0.013, -0.5 + j * 0.13, 0.3, 0.684, graphite);
        cylinder(group, 0.1, 0.32, 0, 1.38, 0.2, metal);
      }
      if (!/buffer|storage|warehouse|intake|stock/.test(kind)) {
        addPassThroughDoors(group);
      }
      // Operational beacon and floor bollards on every station.
      const beaconMaterial = new THREE.MeshStandardMaterial({
        color: facility.util[i] >= 94 ? 0xe5b16b : 0xa3ce91,
        emissive: facility.util[i] >= 94 ? 0xc99a54 : 0x8fbd7a,
        emissiveIntensity: 0.8,
      });
      materials.push(beaconMaterial);
      beaconMats.push(beaconMaterial);
      cylinder(group, 0.035, 0.32, 0.65, 1.87, -0.34, graphite);
      cylinder(group, 0.075, 0.13, 0.65, 2.04, -0.34, beaconMaterial);
      for (const x of [-0.9, 0.9]) {
        cylinder(group, 0.045, 0.36, x, 0.2, 0.7, amber);
        cylinder(group, 0.048, 0.07, x, 0.25, 0.7, graphite);
      }
      group.traverse((o) => {
        o.userData.station = i;
        if (o instanceof THREE.Mesh && o !== ring) clickable.push(o);
      });
    });

    stationEdges.forEach(([a, b]) => {
      const from = new THREE.Vector3(positions[a].x, 0.5, positions[a].z),
        to = new THREE.Vector3(positions[b].x, 0.5, positions[b].z);
      const heading = to.clone().sub(from).normalize();
      const clearance = Math.min(
        0.82 / Math.max(0.0001, Math.abs(heading.x)),
        0.6 / Math.max(0.0001, Math.abs(heading.z)),
      );
      from.addScaledVector(heading, clearance);
      to.addScaledVector(heading, -clearance);
      const delta = to.clone().sub(from);
      const length = delta.length();
      if (length < 0.2) return;
      const angle = Math.atan2(delta.z, delta.x);
      const belt = new THREE.Group();
      belt.position.copy(from.clone().lerp(to, 0.5));
      belt.rotation.y = -angle;
      scene.add(belt);
      box(belt, length, 0.12, 0.48, 0, 0, 0, graphite);
      for (const z of [-0.29, 0.29])
        box(belt, length, 0.08, 0.045, 0, 0.07, z, silver);
      for (let j = 0; j < Math.floor(length * 4); j++) {
        const roller = cylinder(
          belt,
          0.047,
          0.46,
          -length / 2 + j * 0.25,
          0.08,
          0,
          metal,
        );
        roller.rotation.x = Math.PI / 2;
      }
      for (const x of [-length / 3, length / 3])
        box(belt, 0.09, 0.5, 0.38, x, -0.3, 0, metal);
      for (const x of [-length / 2, length / 2]) {
        box(belt, 0.24, 0.13, 0.59, x, -0.035, 0, graphite);
        for (const z of [-0.29, 0.29])
          box(belt, 0.3, 0.09, 0.06, x, 0.08, z, amber);
      }
      beltRoutes.set(`${a}-${b}`, {
        from: from.clone().setY(BELT_PART_Y),
        to: to.clone().setY(BELT_PART_Y),
      });
    });

    // One finite inventory. The same meshes leave the shelf and remain in the output tray.
    const source = positions[sourceIndex],
      target = positions[targetIndex],
      final = positions[finalIndex];
    if (!stock.length) {
      box(scene, 0.75, 0.12, 1.05, source.x - 1.45, 0.28, source.z, graphite);
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 2; col++) {
          const start = new THREE.Vector3(
            source.x - 1.6 + col * 0.27,
            0.4,
            source.z - 0.3 + row * 0.3,
          );
          stock.push({
            mesh: box(
              scene,
              0.17,
              0.12,
              0.16,
              start.x,
              start.y,
              start.z,
              ivory,
            ),
            start,
          });
        }
    }
    scene.updateMatrixWorld(true);
    stock.forEach((item) => scene.attach(item.mesh));
    const outputCenter = new THREE.Vector3(final.x + 1.75, 0.31, final.z);
    box(scene, 1.1, 0.12, 1.6, outputCenter.x, 0.18, outputCenter.z, graphite);
    for (const z of [-0.81, 0.81])
      box(
        scene,
        1.15,
        0.15,
        0.06,
        outputCenter.x,
        0.3,
        outputCenter.z + z,
        silver,
      );
    for (const x of [-0.56, 0.56])
      box(
        scene,
        0.06,
        0.15,
        1.6,
        outputCenter.x + x,
        0.3,
        outputCenter.z,
        silver,
      );
    const liftCarriage = new THREE.Group();
    scene.add(liftCarriage);
    box(liftCarriage, 0.37, 0.04, 0.31, 0, -0.08, 0, metal);
    box(scene, 0.07, 2.15, 0.07, source.x + 1.17, 1, source.z, metal);
    box(scene, 0.07, 2.15, 0.07, source.x + 1.17, 1, source.z + 0.42, metal);
    const direct = beltRoutes.get(sourceIndex + "-" + targetIndex);
    const inlet =
      direct?.to ||
      new THREE.Vector3(target.x - 0.82, BELT_PART_Y, target.z + 0.52);
    const sourcePort =
      direct?.from || new THREE.Vector3(source.x + 0.82, BELT_PART_Y, source.z);
    const outgoing = beltRoutes.get(targetIndex + "-" + finalIndex);
    const outfeed =
      outgoing?.from ||
      new THREE.Vector3(target.x + 1.07, BELT_PART_Y, target.z);
    const robotOrigin = new THREE.Vector3(target.x, 0, target.z);
    const inspection = new THREE.Vector3(final.x, BELT_PART_Y, final.z);
    // Transfer bridges join machine docks to the main roller conveyor at one elevation.
    const bridge = (a: THREE.Vector3, b: THREE.Vector3) => {
      const d = b.clone().sub(a);
      const length = Math.hypot(d.x, d.z);
      if (length < 0.08) return;
      const group = new THREE.Group();
      group.position.copy(a.clone().lerp(b, 0.5)).setY(0.5);
      group.rotation.y = -Math.atan2(d.z, d.x);
      scene.add(group);
      box(group, length, 0.1, 0.4, 0, 0, 0, graphite);
      for (let n = 0; n <= Math.floor(length / 0.15); n++) {
        const roller = cylinder(
          group,
          0.047,
          0.38,
          -length / 2 + n * 0.15,
          0.08,
          0,
          metal,
        );
        roller.rotation.x = Math.PI / 2;
      }
      for (const z of [-0.23, 0.23])
        box(group, length, 0.06, 0.035, 0, 0.065, z, silver);
    };

    const stagePath = (start: number, end: number) => {
      if (start === end) return [start];
      const search = (directed: boolean) => {
        const queue: number[][] = [[start]];
        const visited = new Set([start]);
        while (queue.length) {
          const path = queue.shift()!;
          const current = path[path.length - 1];
          const neighbors = stationEdges.flatMap(([a, b]) => {
            if (a === current) return [b];
            if (!directed && b === current) return [a];
            return [];
          });
          for (const next of neighbors) {
            if (visited.has(next)) continue;
            const candidate = [...path, next];
            if (next === end) return candidate;
            visited.add(next);
            queue.push(candidate);
          }
        }
        return [] as number[];
      };
      return search(true).length ? search(true) : search(false);
    };
    const conveyorPath = (start: number, end: number) => {
      const stages = stagePath(start, end);
      if (!stages.length) return [] as THREE.Vector3[];
      const points = [
        new THREE.Vector3(
          positions[stages[0]].x,
          BELT_PART_Y,
          positions[stages[0]].z,
        ),
      ];
      for (let index = 0; index < stages.length - 1; index++) {
        const a = stages[index];
        const b = stages[index + 1];
        const forward = beltRoutes.get(`${a}-${b}`);
        const reverse = beltRoutes.get(`${b}-${a}`);
        const from = forward?.from || reverse?.to;
        const to = forward?.to || reverse?.from;
        if (from && to) points.push(from, to);
        points.push(
          new THREE.Vector3(positions[b].x, BELT_PART_Y, positions[b].z),
        );
      }
      return points;
    };

    // Close every conveyor gap between a station center and its edge dock. The
    // animated part uses the same graph, so the visible and logical paths agree.
    stationEdges.forEach(([a, b]) => {
      const segment = beltRoutes.get(`${a}-${b}`);
      if (!segment) return;
      bridge(
        new THREE.Vector3(positions[a].x, BELT_PART_Y, positions[a].z),
        segment.from,
      );
      bridge(
        segment.to,
        new THREE.Vector3(positions[b].x, BELT_PART_Y, positions[b].z),
      );
    });
    const transferPath = conveyorPath(sourceIndex, targetIndex);
    const inspectionPath = conveyorPath(targetIndex, finalIndex);
    bridge(
      inlet,
      robotOrigin.clone().add(new THREE.Vector3(-0.69, BELT_PART_Y, 0.7)),
    );
    bridge(
      robotOrigin.clone().add(new THREE.Vector3(1.07, BELT_PART_Y, 0)),
      outfeed,
    );
    bridge(inspection, outputCenter.clone().setY(BELT_PART_Y));
    const routes: WorkflowRoute[] = stock.map((item, i) => ({
      stock: item.start,
      lift: new THREE.Vector3(source.x + 1.03, BELT_PART_Y, item.start.z),
      sourcePort,
      infeed: inlet,
      transferPath,
      robotOrigin,
      outfeed,
      inspection,
      inspectionPath,
      output: outputCenter
        .clone()
        .add(
          new THREE.Vector3(
            ((i % 3) - 1) * 0.27,
            0,
            (Math.floor(i / 3) - 2.5) * 0.23,
          ),
        ),
      hasRobot: robotIndex >= 0,
    }));
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = { x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickable, false)[0];
      if (hit) selectRef.current(Number(hit.object.userData.station));
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    const resize = () => {
      const width = el.clientWidth,
        height = el.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let frame = 0;
    let time =
      simulationClock.current.id === facility.id
        ? simulationClock.current.time
        : 0;
    simulationClock.current = { id: facility.id, time };
    actions.current.restart = () => {
      time = 0;
      simulationClock.current.time = 0;
      setPlaying(true);
    };
    let last = performance.now();
    const labelPosition = new THREE.Vector3();
    let visible = true;
    const visibility = () => {
      visible = !document.hidden;
    };
    document.addEventListener("visibilitychange", visibility);
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;
      if (playRef.current)
        time = Math.min(stock.length * PART_SECONDS, time + dt);
      simulationClock.current.time = time;
      controls.update();
      if (!stock.length || !routes.length) {
        renderer.render(scene, camera);
        return;
      }
      if (!Number.isFinite(time)) time = 0;
      const currentIndex = Math.min(
        stock.length,
        Math.floor(time / PART_SECONDS),
      );
      const partTime = time % PART_SECONDS;
      const current = routes[Math.min(currentIndex, routes.length - 1)];
      if (!current) {
        renderer.render(scene, camera);
        return;
      }
      const pose = productionPose(
        currentIndex >= stock.length ? PART_SECONDS : partTime,
        current,
      );
      stock.forEach((item, index) => {
        if (index < currentIndex) {
          item.mesh.position.copy(routes[index].output);
          item.mesh.rotation.set(0, 0, 0);
        } else if (index === currentIndex) {
          item.mesh.position.copy(pose.position);
          item.mesh.rotation.y = pose.held ? pose.hand.yaw : 0;
        } else {
          item.mesh.position.copy(item.start);
          item.mesh.rotation.set(0, 0, 0);
        }
      });
      liftCarriage.position.copy(
        currentIndex < stock.length && partTime < 2
          ? pose.position
          : current.lift,
      );
      robots.forEach((robot) => {
        const hand = robot.stage === targetIndex ? pose.hand : robotPose(0);
        robot.base.rotation.y = hand.yaw;
        robot.shoulder.rotation.z = hand.shoulder;
        robot.elbow.rotation.z = hand.elbow;
        robot.wrist.rotation.z = hand.wrist;
        robot.fingers[0].position.x = -hand.gap;
        robot.fingers[1].position.x = hand.gap;
      });
      if (cycleLabel.current) {
        cycleLabel.current.textContent =
          currentIndex >= stock.length
            ? "Batch complete"
            : playRef.current
              ? pose.state
              : "Paused";
        cycleLabel.current.parentElement?.style.setProperty(
          "--cycle-progress",
          String((partTime / PART_SECONDS) * 100) + "%",
        );
      }
      queuedLabel.current &&
        (queuedLabel.current.textContent = String(
          stock.length - currentIndex - (currentIndex < stock.length ? 1 : 0),
        ));
      transitLabel.current &&
        (transitLabel.current.textContent = String(
          currentIndex < stock.length ? 1 : 0,
        ));
      deliveredLabel.current &&
        (deliveredLabel.current.textContent = String(currentIndex));
      scanLights.forEach((s) => {
        s.position.x = Math.sin(time * 1.7) * 0.43;
      });
      beaconMats.forEach((m, i) => {
        m.emissiveIntensity = 0.55 + (Math.sin(time * 2 + i) + 1) * 0.2;
      });
      rings.forEach((r, i) => {
        r.visible = i === selectedRef.current;
        const scale = 1 + Math.sin(time * 2) * 0.025;
        r.scale.setScalar(scale);
      });
      const projected = positions.map((p, i) => {
        labelPosition.set(p.x, 1.15, p.z).project(camera);
        return {
          i,
          x: (labelPosition.x * 0.5 + 0.5) * el.clientWidth,
          y: (-labelPosition.y * 0.5 + 0.5) * el.clientHeight,
          visible: labelPosition.z < 1,
        };
      });
      const sorted = [...projected].sort((a, b) => a.x - b.x);
      const split = Math.ceil(sorted.length / 2);
      const groups = [sorted.slice(0, split), sorted.slice(split)];
      groups.forEach((group, side) => {
        group.sort((a, b) => a.y - b.y);
        const h = el.clientHeight;
        const margin = 14;
        const gap = Math.min(57, (h - 30) / Math.max(1, group.length));
        group.forEach((point, index) => {
          const label = labels.current[point.i],
            line = leaders.current[point.i],
            dot = leaderDots.current[point.i];
          if (!label || !line || !dot) return;
          const lw = label.offsetWidth || 118;
          const top = THREE.MathUtils.clamp(
            h / 2 - (group.length * gap) / 2 + index * gap,
            margin,
            h - 53,
          );
          const left = side === 0 ? 10 : el.clientWidth - lw - 10;
          label.style.left = left + "px";
          label.style.top = top + "px";
          label.style.opacity = point.visible ? "1" : "0";
          const endX = side === 0 ? left + lw : left;
          const endY = top + 21;
          const bendX = endX + (side === 0 ? 16 : -16);
          line.setAttribute(
            "d",
            `M ${point.x.toFixed(1)} ${point.y.toFixed(1)} L ${bendX} ${endY} L ${endX} ${endY}`,
          );
          line.style.opacity = point.visible
            ? point.i === selectedRef.current
              ? "0.9"
              : "0.45"
            : "0";
          dot.setAttribute("cx", String(point.x));
          dot.setAttribute("cy", String(point.y));
          dot.style.opacity = point.visible ? "1" : "0";
        });
      });
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((m) => m.dispose());
        }
      });
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [facility, theme]);
  return (
    <div className={`factory-twin ${expanded ? "expanded" : ""}`} ref={host}>
      <div className="twin-toolbar">
        <span>
          <i className="dot" />
          {playing ? "Tracked flow active" : "Motion paused"}
          <Badge3D />
        </span>
        <div>
          <button
            aria-label="Zoom into 3D scene"
            className="icon-btn"
            onClick={() => actions.current.zoom(0.85)}
          >
            <ZoomIn size={14} />
          </button>
          <button
            aria-label="Zoom out of 3D scene"
            className="icon-btn"
            onClick={() => actions.current.zoom(1.15)}
          >
            <ZoomOut size={14} />
          </button>
          <button
            aria-label="Reset 3D camera"
            className="icon-btn"
            onClick={() => actions.current.reset()}
          >
            <RotateCcw size={14} />
          </button>
          <button
            aria-label={
              playing ? "Pause flow animation" : "Play flow animation"
            }
            className="icon-btn"
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            aria-label={expanded ? "Collapse 3D scene" : "Expand 3D scene"}
            className="icon-btn"
            onClick={() => setExpanded(!expanded)}
          >
            <Expand size={14} />
          </button>
        </div>
      </div>
      <div className="twin-stage">
        {facility.stations.some((s) => /assembly|robot|cell|weld/i.test(s)) && (
          <div className="robot-cycle">
            <i />
            <span>TRACKED PART FLOW</span>
            <strong ref={cycleLabel}>Approach</strong>
            <div />
          </div>
        )}
        <div className="webgl-canvas" ref={canvasHost} />
        <svg className="twin-leaders" aria-hidden="true">
          {facility.stations.map((_, i) => (
            <g key={i}>
              <path
                fill="none"
                stroke="var(--green)"
                strokeWidth="1"
                strokeDasharray="2.5 4"
                ref={(el) => {
                  leaders.current[i] = el;
                }}
              />
              <circle
                ref={(el) => {
                  leaderDots.current[i] = el;
                }}
                r={selected === i ? 3.3 : 2.1}
              />
            </g>
          ))}
        </svg>
        {!error &&
          facility.stations.map((name, i) => (
            <button
              ref={(el) => {
                labels.current[i] = el;
              }}
              className={`twin-station-label ${selected === i ? "selected" : ""}`}
              key={i}
              onClick={() => onSelect(i)}
              aria-label={`Select ${name}, ${Number.isFinite(facility.util[i]) ? `${facility.util[i]} percent utilization` : "utilization unavailable"}`}
            >
              <span className="callout-head">
                <i
                  className={`tiny ${facility.util[i] >= 94 ? "amber" : "green"}`}
                />
                <strong>{name}</strong>
                <b>{String(i + 1).padStart(2, "0")}</b>
              </span>
              <span className="callout-detail">
                {Number.isFinite(facility.util[i])
                  ? facility.util[i] >= 94
                    ? "Constraint candidate"
                    : "Measured utilization"
                  : "Utilization unavailable"}
                <b>
                  {Number.isFinite(facility.util[i])
                    ? `${facility.util[i]}%`
                    : "—"}
                </b>
              </span>
              <span className="callout-meter">
                <i
                  style={{
                    width: `${Number.isFinite(facility.util[i]) ? facility.util[i] : 0}%`,
                  }}
                />
              </span>
            </button>
          ))}
        {error && (
          <div className="empty">
            <Layers size={30} />
            <h3>3D is unavailable in this browser.</h3>
            <p>
              Enable hardware acceleration. Station data remains available
              below.
            </p>
          </div>
        )}
      </div>
      <div className="workflow-inventory" aria-label="Tracked flow inventory">
        <div className="flow-stat-list" aria-label="Live flow counts">
          <div className="flow-stat queued" aria-label="Queued parts">
            <i className="flow-stat-dot" />
            <span className="flow-stat-copy">
              <small>Queued</small>
              <strong ref={queuedLabel} aria-live="polite">—</strong>
            </span>
          </div>
          <div className="flow-stat transit" aria-label="Parts in transit">
            <i className="flow-stat-dot" />
            <span className="flow-stat-copy">
              <small>In transit</small>
              <strong ref={transitLabel} aria-live="polite">—</strong>
            </span>
          </div>
          <div className="flow-stat delivered" aria-label="Delivered parts">
            <i className="flow-stat-dot" />
            <span className="flow-stat-copy">
              <small>Delivered</small>
              <strong ref={deliveredLabel} aria-live="polite">—</strong>
            </span>
          </div>
        </div>
        <button
          className="workflow-restart"
          onClick={() => actions.current.restart()}
          aria-label="Restart tracked flow"
        >
          <RefreshCw size={11} />
          Restart flow
        </button>
      </div>
      <div className="twin-footer">
        <span>
          <MousePointer2 size={12} />
          Drag to orbit · select a machine
        </span>
        <span>
          {architectureNames[architectureOf(facility)]} <i />{" "}
          {facility.stations.length} stages
        </span>
      </div>
      <div className="station-selector" aria-label="Production stations">
        {facility.stations.map((name, i) => (
          <button
            className={selected === i ? "active" : ""}
            key={i}
            onClick={() => onSelect(i)}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {name}
            <small>
              {Number.isFinite(facility.util[i]) ? `${facility.util[i]}%` : "—"}
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}
function Badge3D() {
  return <b className="three-d-badge">3D TWIN</b>;
}
