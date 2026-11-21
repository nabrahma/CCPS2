/**
 * The deterministic cloth solver (PRD Part 3, F30): XPBD (Macklin, Müller and Chentanez 2016) with Small
 * Steps (Macklin et al. 2019): every frame is split into substeps, each with one pass over every constraint
 * and its multiplier starting at zero.
 *
 * Constraints, in this order (type, then index):
 * 1. stretch: edge length (compliance per material: near zero for woven cloth, softer for knits);
 * 2. area: triangle area;
 * 3. bending: the dihedral angle across each interior edge, in the isometric form of Bergou et al. 2006 for a
 *    flat rest shape. The hinge's mean-curvature vector C = Σ K_j x_j (cotangent weights K from the rest
 *    triangles) is zero when the hinge is flat and its length grows with the angle, so the energy
 *    3/(A0+A1) k |C|² is the dihedral bending energy, and an XPBD step on it needs no trigonometry;
 * 4. seams: zero-length distance between paired seam samples (a vector constraint), the compliance ramping
 *    from soft to stiff over the first 0.3 s so panels close smoothly;
 * 5. body contacts: signed distance to the body at least the cloth's thickness, with Coulomb friction. The
 *    nearest body point and normal of each particle are found once a frame and used by every substep.
 *
 * Arithmetic is + - * / and sqrt only, in fixed loops: the same bytes in every JavaScript engine.
 */

/** A surface the cloth must stay outside of. */
export interface Collider {
  /**
   * The nearest surface point to (x, y, z) within `maxDist`, with its outward normal, written to
   * out[0..5] as px, py, pz, nx, ny, nz. False when nothing is that close.
   */
  closest(x: number, y: number, z: number, maxDist: number, out: Float64Array): boolean;
}

export interface ClothMaterial {
  /** kg/m². */
  density: number;
  /** Stretch compliance (m/N). */
  stretch: number;
  /** Area compliance (m²/N, per rest area). */
  area: number;
  /** Bending stiffness (N·m). */
  bend: number;
  /** Coulomb friction against the body. */
  friction: number;
}

export interface ClothInput {
  /** Initial positions (m), 3 per particle. */
  positions: Float64Array;
  /** Rest positions in the pattern plane (m), 2 per particle. */
  rest2d: Float64Array;
  /** Counter-clockwise triangles in the pattern plane. */
  tris: Uint32Array;
  /** Material per triangle (index into `materials`). */
  triMaterial: Uint8Array;
  materials: ClothMaterial[];
  /** Paired seam samples. */
  seams: Uint32Array;
  /** Particles held in place (tests). */
  pinned?: Uint8Array;
  /**
   * Welded particles: for each rest point (index into rest2d), its particle. `positions` then has one entry
   * per particle; `tris` stay in rest-point indices and `seams` are particle pairs.
   */
  merge?: Int32Array;
  /** Initial velocities (per particle). */
  velocities?: Float64Array;
  /** Waist attachments: particles, and the height each may not drop below (m). */
  anchors?: { particles: Uint32Array; minY: Float64Array };
}

export interface SolverSettings {
  /** Frame step, s. */
  dt: number;
  substeps: number;
  gravity: number;
  /** Velocity damping per second. */
  damping: number;
  /** Static passes after settling (see Cloth.polish). */
  polishPasses: number;
  /** Velocity damping per second while the seams close (the ramp). */
  sewDamping: number;
  /** Compliance against an edge getting shorter (m/N): soft, so gathers and folds buckle. */
  compression: number;
  /** Collision thickness, m. */
  thickness: number;
  /** Contacts are looked for this far from each particle, m. */
  contactRange: number;
  /** Seam compliance at the start and at the end of the ramp, and the ramp's duration (s). */
  seamSoft: number;
  seamStiff: number;
  seamRamp: number;
}

export const DEFAULT_SETTINGS: SolverSettings = {
  dt: 1 / 60,
  substeps: 20,
  gravity: 9.81,
  damping: 1,
  sewDamping: 8,
  polishPasses: 40,
  compression: 0.05,
  thickness: 0.002,
  contactRange: 0.04,
  seamSoft: 100,
  seamStiff: 1e-8,
  seamRamp: 0.3,
};

export class Cloth {
  readonly n: number;
  readonly x: Float64Array;
  readonly prev: Float64Array;
  readonly v: Float64Array;
  readonly w: Float64Array;
  readonly mass: Float64Array;
  readonly edges: Uint32Array;
  readonly edgeRest: Float64Array;
  readonly edgeAlpha: Float64Array;
  readonly tris: Uint32Array;
  readonly triRest: Float64Array;
  readonly triAlpha: Float64Array;
  readonly hinges: Uint32Array;
  readonly hingeK: Float64Array;
  readonly hingeAlpha: Float64Array;
  readonly seams: Uint32Array;
  readonly anchors: { particles: Uint32Array; minY: Float64Array } | null;
  /** Per particle: friction, contact point and normal (valid when `contact` is 1). */
  readonly friction: Float64Array;
  readonly contact: Uint8Array;
  readonly cp: Float64Array;
  /** Where each particle was when its contact was last looked for. */
  readonly qpos: Float64Array;
  /** Positions at the start of the last frame (its motion gives the frame's velocity). */
  readonly frameStart: Float64Array;
  private collider: Collider | null = null;
  time = 0;
  frames = 0;
  readonly s: SolverSettings;
  private readonly tmp = new Float64Array(6);

  constructor(input: ClothInput, settings: SolverSettings = DEFAULT_SETTINGS) {
    this.s = settings;
    const n = input.positions.length / 3;
    this.n = n;
    this.x = Float64Array.from(input.positions);
    this.prev = Float64Array.from(input.positions);
    this.v = input.velocities ? Float64Array.from(input.velocities) : new Float64Array(n * 3);
    this.mass = new Float64Array(n);
    this.friction = new Float64Array(n);
    const R = input.rest2d;
    const M = input.merge ?? null;
    const P = (o: number) => (M ? M[o]! : o);
    const T = input.tris.length / 3;
    this.tris = new Uint32Array(T * 3);
    this.triRest = new Float64Array(T);
    this.triAlpha = new Float64Array(T);
    const fCount = new Float64Array(n);
    for (let t = 0; t < T; t++) {
      const a = input.tris[t * 3]!;
      const b = input.tris[t * 3 + 1]!;
      const c = input.tris[t * 3 + 2]!;
      this.tris[t * 3] = P(a);
      this.tris[t * 3 + 1] = P(b);
      this.tris[t * 3 + 2] = P(c);
      const area = ((R[b * 2]! - R[a * 2]!) * (R[c * 2 + 1]! - R[a * 2 + 1]!) - (R[b * 2 + 1]! - R[a * 2 + 1]!) * (R[c * 2]! - R[a * 2]!)) / 2;
      this.triRest[t] = area;
      const m = input.materials[input.triMaterial[t]!]!;
      this.triAlpha[t] = m.area / area;
      for (const o of [a, b, c]) {
        const v = P(o);
        this.mass[v] = this.mass[v]! + (m.density * area) / 3;
        this.friction[v] = this.friction[v]! + m.friction;
        fCount[v] = fCount[v]! + 1;
      }
    }
    this.w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.w[i] = input.pinned?.[i] || this.mass[i]! <= 0 ? 0 : 1 / this.mass[i]!;
      if (fCount[i]! > 0) this.friction[i] = this.friction[i]! / fCount[i]!;
    }

    // Edges (each particle pair once, sorted) and hinges (edges between exactly two triangles). A welded seam
    // joins two panels' edges into one: its rest length is the shorter side's (the longer side gathers).
    const edgeMap = new Map<number, number[]>();
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < 3; k++) {
        const oa = input.tris[t * 3 + k]!;
        const ob = input.tris[t * 3 + ((k + 1) % 3)]!;
        const oc = input.tris[t * 3 + ((k + 2) % 3)]!;
        const a = P(oa);
        const b = P(ob);
        const key = Math.min(a, b) * n + Math.max(a, b);
        let e = edgeMap.get(key);
        if (!e) edgeMap.set(key, (e = []));
        // Triangle, and its original corners ordered as (lower particle, higher particle, opposite).
        if (a < b) e.push(t, oa, ob, oc);
        else e.push(t, ob, oa, oc);
      }
    }
    const keys = [...edgeMap.keys()].sort((p, q) => p - q);
    this.edges = new Uint32Array(keys.length * 2);
    this.edgeRest = new Float64Array(keys.length);
    this.edgeAlpha = new Float64Array(keys.length);
    const hinges: number[] = [];
    const hingeK: number[] = [];
    const hingeAlpha: number[] = [];
    keys.forEach((key, i) => {
      const a = Math.floor(key / n);
      const b = key - a * n;
      this.edges[i * 2] = a;
      this.edges[i * 2 + 1] = b;
      const adj = edgeMap.get(key)!;
      let rest = Infinity;
      let alpha = 0;
      for (let j = 0; j < adj.length; j += 4) {
        const oa = adj[j + 1]!;
        const ob = adj[j + 2]!;
        const dx = R[ob * 2]! - R[oa * 2]!;
        const dy = R[ob * 2 + 1]! - R[oa * 2 + 1]!;
        rest = Math.min(rest, Math.sqrt(dx * dx + dy * dy));
        alpha += input.materials[input.triMaterial[adj[j]!]!]!.stretch;
      }
      this.edgeRest[i] = rest;
      this.edgeAlpha[i] = alpha / (adj.length / 4);
      if (adj.length === 8) {
        const [t0, a0, b0, c0, t1, a1, b1, d1] = adj as [number, number, number, number, number, number, number, number];
        const k = cotanWeights2(R, a0, b0, c0, a1, b1, d1);
        const A0 = Math.abs(this.triRest[t0]!);
        const A1 = Math.abs(this.triRest[t1]!);
        const kb = (input.materials[input.triMaterial[t0]!]!.bend + input.materials[input.triMaterial[t1]!]!.bend) / 2;
        hinges.push(a, b, P(c0), P(d1));
        hingeK.push(...k);
        // E = 3/(A0+A1) kb |C|² = C²/(2 alpha).
        hingeAlpha.push((A0 + A1) / (6 * kb));
      }
    });
    this.hinges = Uint32Array.from(hinges);
    this.hingeK = Float64Array.from(hingeK);
    this.hingeAlpha = Float64Array.from(hingeAlpha);
    this.seams = input.seams;
    this.anchors = input.anchors ?? null;
    this.contact = new Uint8Array(n);
    this.cp = new Float64Array(n * 6);
    this.qpos = new Float64Array(n * 3);
    this.frameStart = Float64Array.from(this.x);
  }

  /** The seam compliance at time t. */
  seamAlpha(t: number): number {
    const { seamSoft, seamStiff, seamRamp } = this.s;
    if (t >= seamRamp) return seamStiff;
    // Geometric interpolation (soft to stiff), without transcendental functions: repeated square roots.
    const f = t / seamRamp;
    return interpGeometric(seamSoft, seamStiff, f);
  }

  /** Find each particle's nearest body point (once a frame). */
  updateContacts(collider: Collider | null): void {
    this.collider = collider;
    this.contact.fill(0);
    if (!collider) return;
    for (let i = 0; i < this.n; i++) this.query(i, this.x);
  }

  /** Look for particle i's contact at its position in `from`. */
  private query(i: number, from: Float64Array): void {
    const out = this.tmp;
    const x = from[i * 3]!;
    const y = from[i * 3 + 1]!;
    const z = from[i * 3 + 2]!;
    this.qpos[i * 3] = x;
    this.qpos[i * 3 + 1] = y;
    this.qpos[i * 3 + 2] = z;
    if (this.collider!.closest(x, y, z, this.s.contactRange, out)) {
      this.contact[i] = 1;
      for (let k = 0; k < 6; k++) this.cp[i * 6 + k] = out[k]!;
    } else this.contact[i] = 0;
  }

  /**
   * Particles that moved more than half the contact range since their contact was found get it found again,
   * from where they started this substep (outside the body), so fast cloth cannot pass through a limb.
   */
  private refreshMoved(): void {
    if (!this.collider) return;
    const { x, prev, qpos } = this;
    const lim = (this.s.contactRange / 2) * (this.s.contactRange / 2);
    for (let i = 0; i < this.n; i++) {
      const dx = x[i * 3]! - qpos[i * 3]!;
      const dy = x[i * 3 + 1]! - qpos[i * 3 + 1]!;
      const dz = x[i * 3 + 2]! - qpos[i * 3 + 2]!;
      if (dx * dx + dy * dy + dz * dz > lim) this.query(i, prev);
    }
  }

  /** One frame: contacts, then the substeps. */
  frame(collider: Collider | null): void {
    this.frameStart.set(this.x);
    this.updateContacts(collider);
    const h = this.s.dt / this.s.substeps;
    for (let s = 0; s < this.s.substeps; s++) this.substep(h);
    this.frames++;
  }

  substep(h: number): void {
    const { x, prev, v, w } = this;
    const n = this.n;
    const g = this.time < this.s.seamRamp ? 0 : this.s.gravity;
    const sewing = this.time < this.s.seamRamp;
    const damp = Math.max(0, 1 - (sewing ? this.s.sewDamping : this.s.damping) * h);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      prev[j] = x[j]!;
      prev[j + 1] = x[j + 1]!;
      prev[j + 2] = x[j + 2]!;
      if (w[i] === 0) continue;
      v[j + 1] = v[j + 1]! - g * h;
      v[j] = v[j]! * damp;
      v[j + 1] = v[j + 1]! * damp;
      v[j + 2] = v[j + 2]! * damp;
      x[j] = x[j]! + v[j]! * h;
      x[j + 1] = x[j + 1]! + v[j + 1]! * h;
      x[j + 2] = x[j + 2]! + v[j + 2]! * h;
    }
    const h2 = h * h;
    this.solveStretch(h2, false);
    this.solveArea(h2);
    this.solveBending(h2);
    this.solveSeams(this.seamAlpha(this.time) / h2);
    this.refreshMoved();
    // No friction while the seams close (panels slide over the body into place), full friction after.
    this.solveContacts(sewing ? 0 : 1);
    this.solveAnchors();
    const inv = 1 / h;
    for (let i = 0; i < n * 3; i++) v[i] = (x[i]! - prev[i]!) * inv;
    this.time += h;
  }

  /**
   * After settling: static Gauss-Seidel passes (positions only) over stretched edges, seams and contacts,
   * which take out the stretch that one iteration per substep leaves where the cloth carries weight. The
   * cloth comes to rest (velocities zero).
   */
  polish(collider: Collider | null, passes: number): void {
    this.updateContacts(collider);
    for (let it = 0; it < passes; it++) {
      this.prev.set(this.x);
      this.solveStretch(Infinity, true);
      this.solveSeams(0);
      this.refreshMoved();
      this.solveContacts(0);
      this.solveAnchors();
    }
    this.v.fill(0);
  }

  /**
   * Last, every particle clear of the body by the thickness, against the nearest point itself (re-found each
   * round): a contact plane through a smooth normal can cut a little into a thin limb.
   */
  clear(collider: Collider, rounds = 3): void {
    const out = this.tmp;
    const th = this.s.thickness;
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < this.n; i++) {
        if (this.w[i] === 0) continue;
        const j = i * 3;
        if (!collider.closest(this.x[j]!, this.x[j + 1]!, this.x[j + 2]!, th * 4, out)) continue;
        const d = (this.x[j]! - out[0]!) * out[3]! + (this.x[j + 1]! - out[1]!) * out[4]! + (this.x[j + 2]! - out[2]!) * out[5]!;
        if (d >= th) continue;
        this.x[j] = out[0]! + out[3]! * th;
        this.x[j + 1] = out[1]! + out[4]! * th;
        this.x[j + 2] = out[2]! + out[5]! * th;
      }
    }
  }

  /** Edge lengths; `stretchOnly` leaves shortened edges alone (the polish passes). */
  private solveStretch(h2: number, stretchOnly: boolean): void {
    const { x, w, edges, edgeRest, edgeAlpha } = this;
    const compress = this.s.compression;
    const E = edgeRest.length;
    for (let e = 0; e < E; e++) {
      const a = edges[e * 2]!;
      const b = edges[e * 2 + 1]!;
      const wa = w[a]!;
      const wb = w[b]!;
      const ws = wa + wb;
      if (ws === 0) continue;
      const dx = x[b * 3]! - x[a * 3]!;
      const dy = x[b * 3 + 1]! - x[a * 3 + 1]!;
      const dz = x[b * 3 + 2]! - x[a * 3 + 2]!;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len === 0) continue;
      const C = len - edgeRest[e]!;
      if (stretchOnly && C <= 0) continue;
      // Cloth buckles rather than compresses: shortening is resisted far more softly than stretching.
      const alpha = C >= 0 ? edgeAlpha[e]! : compress;
      const dl = -C / (ws + alpha / h2);
      const sx = (dx / len) * dl;
      const sy = (dy / len) * dl;
      const sz = (dz / len) * dl;
      x[a * 3] = x[a * 3]! - wa * sx;
      x[a * 3 + 1] = x[a * 3 + 1]! - wa * sy;
      x[a * 3 + 2] = x[a * 3 + 2]! - wa * sz;
      x[b * 3] = x[b * 3]! + wb * sx;
      x[b * 3 + 1] = x[b * 3 + 1]! + wb * sy;
      x[b * 3 + 2] = x[b * 3 + 2]! + wb * sz;
    }
  }

  private solveArea(h2: number): void {
    const { x, w, tris, triRest, triAlpha } = this;
    const T = triRest.length;
    for (let t = 0; t < T; t++) {
      const a = tris[t * 3]!;
      const b = tris[t * 3 + 1]!;
      const c = tris[t * 3 + 2]!;
      const ax = x[a * 3]!;
      const ay = x[a * 3 + 1]!;
      const az = x[a * 3 + 2]!;
      const ux = x[b * 3]! - ax;
      const uy = x[b * 3 + 1]! - ay;
      const uz = x[b * 3 + 2]! - az;
      const vx = x[c * 3]! - ax;
      const vy = x[c * 3 + 1]! - ay;
      const vz = x[c * 3 + 2]! - az;
      // n = u x v; area = |n| / 2.
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl === 0) continue;
      const C = nl / 2 - triRest[t]!;
      // Area holds against growing only (a shrinking triangle is cloth buckling, which bending resists).
      if (C <= 0) continue;
      const ex = nx / nl;
      const ey = ny / nl;
      const ez = nz / nl;
      // dA/db = (v x n̂)/2, dA/dc = (n̂ x u)/2, dA/da = -(dA/db + dA/dc).
      const gbx = (vy * ez - vz * ey) / 2;
      const gby = (vz * ex - vx * ez) / 2;
      const gbz = (vx * ey - vy * ex) / 2;
      const gcx = (ey * uz - ez * uy) / 2;
      const gcy = (ez * ux - ex * uz) / 2;
      const gcz = (ex * uy - ey * ux) / 2;
      const gax = -gbx - gcx;
      const gay = -gby - gcy;
      const gaz = -gbz - gcz;
      const wa = w[a]!;
      const wb = w[b]!;
      const wc = w[c]!;
      const den = wa * (gax * gax + gay * gay + gaz * gaz) + wb * (gbx * gbx + gby * gby + gbz * gbz) + wc * (gcx * gcx + gcy * gcy + gcz * gcz) + triAlpha[t]! / h2;
      if (den === 0) continue;
      const dl = -C / den;
      x[a * 3] = ax + wa * gax * dl;
      x[a * 3 + 1] = ay + wa * gay * dl;
      x[a * 3 + 2] = az + wa * gaz * dl;
      x[b * 3] = x[b * 3]! + wb * gbx * dl;
      x[b * 3 + 1] = x[b * 3 + 1]! + wb * gby * dl;
      x[b * 3 + 2] = x[b * 3 + 2]! + wb * gbz * dl;
      x[c * 3] = x[c * 3]! + wc * gcx * dl;
      x[c * 3 + 1] = x[c * 3 + 1]! + wc * gcy * dl;
      x[c * 3 + 2] = x[c * 3 + 2]! + wc * gcz * dl;
    }
  }

  private solveBending(h2: number): void {
    const { x, w, hinges, hingeK, hingeAlpha } = this;
    const H = hingeAlpha.length;
    for (let e = 0; e < H; e++) {
      const i0 = hinges[e * 4]!;
      const i1 = hinges[e * 4 + 1]!;
      const i2 = hinges[e * 4 + 2]!;
      const i3 = hinges[e * 4 + 3]!;
      const k0 = hingeK[e * 4]!;
      const k1 = hingeK[e * 4 + 1]!;
      const k2 = hingeK[e * 4 + 2]!;
      const k3 = hingeK[e * 4 + 3]!;
      const cx = k0 * x[i0 * 3]! + k1 * x[i1 * 3]! + k2 * x[i2 * 3]! + k3 * x[i3 * 3]!;
      const cy = k0 * x[i0 * 3 + 1]! + k1 * x[i1 * 3 + 1]! + k2 * x[i2 * 3 + 1]! + k3 * x[i3 * 3 + 1]!;
      const cz = k0 * x[i0 * 3 + 2]! + k1 * x[i1 * 3 + 2]! + k2 * x[i2 * 3 + 2]! + k3 * x[i3 * 3 + 2]!;
      const w0 = w[i0]!;
      const w1 = w[i1]!;
      const w2 = w[i2]!;
      const w3 = w[i3]!;
      const den = w0 * k0 * k0 + w1 * k1 * k1 + w2 * k2 * k2 + w3 * k3 * k3 + hingeAlpha[e]! / h2;
      if (den === 0) continue;
      const f = -1 / den;
      const lx = cx * f;
      const ly = cy * f;
      const lz = cz * f;
      x[i0 * 3] = x[i0 * 3]! + w0 * k0 * lx;
      x[i0 * 3 + 1] = x[i0 * 3 + 1]! + w0 * k0 * ly;
      x[i0 * 3 + 2] = x[i0 * 3 + 2]! + w0 * k0 * lz;
      x[i1 * 3] = x[i1 * 3]! + w1 * k1 * lx;
      x[i1 * 3 + 1] = x[i1 * 3 + 1]! + w1 * k1 * ly;
      x[i1 * 3 + 2] = x[i1 * 3 + 2]! + w1 * k1 * lz;
      x[i2 * 3] = x[i2 * 3]! + w2 * k2 * lx;
      x[i2 * 3 + 1] = x[i2 * 3 + 1]! + w2 * k2 * ly;
      x[i2 * 3 + 2] = x[i2 * 3 + 2]! + w2 * k2 * lz;
      x[i3 * 3] = x[i3 * 3]! + w3 * k3 * lx;
      x[i3 * 3 + 1] = x[i3 * 3 + 1]! + w3 * k3 * ly;
      x[i3 * 3 + 2] = x[i3 * 3 + 2]! + w3 * k3 * lz;
    }
  }

  private solveSeams(alphaT: number): void {
    const { x, w, seams } = this;
    const S = seams.length / 2;
    for (let s = 0; s < S; s++) {
      const a = seams[s * 2]!;
      const b = seams[s * 2 + 1]!;
      const wa = w[a]!;
      const wb = w[b]!;
      const den = wa + wb + alphaT;
      if (wa + wb === 0) continue;
      const f = 1 / den;
      for (let k = 0; k < 3; k++) {
        const C = x[a * 3 + k]! - x[b * 3 + k]!;
        const l = -C * f;
        x[a * 3 + k] = x[a * 3 + k]! + wa * l;
        x[b * 3 + k] = x[b * 3 + k]! - wb * l;
      }
    }
  }

  /** Attachments (PRD F30): waistbands held at the waist, as a belt holds them (a floor under each point). */
  private solveAnchors(): void {
    const a = this.anchors;
    if (!a) return;
    for (let k = 0; k < a.particles.length; k++) {
      const i = a.particles[k]!;
      if (this.x[i * 3 + 1]! < a.minY[k]!) this.x[i * 3 + 1] = a.minY[k]!;
    }
  }

  private solveContacts(frictionScale: number): void {
    const { x, prev, w, contact, cp, friction } = this;
    const th = this.s.thickness;
    for (let i = 0; i < this.n; i++) {
      if (!contact[i] || w[i] === 0) continue;
      const j = i * 3;
      const q = i * 6;
      const nx = cp[q + 3]!;
      const ny = cp[q + 4]!;
      const nz = cp[q + 5]!;
      const d = (x[j]! - cp[q]!) * nx + (x[j + 1]! - cp[q + 1]!) * ny + (x[j + 2]! - cp[q + 2]!) * nz;
      if (d >= th) continue;
      const pen = th - d;
      x[j] = x[j]! + nx * pen;
      x[j + 1] = x[j + 1]! + ny * pen;
      x[j + 2] = x[j + 2]! + nz * pen;
      // Friction: remove tangential motion over this substep, up to mu times the push.
      const mx = x[j]! - prev[j]!;
      const my = x[j + 1]! - prev[j + 1]!;
      const mz = x[j + 2]! - prev[j + 2]!;
      const mn = mx * nx + my * ny + mz * nz;
      const tx = mx - mn * nx;
      const ty = my - mn * ny;
      const tz = mz - mn * nz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl === 0) continue;
      const lim = friction[i]! * frictionScale * pen;
      const k = tl <= lim ? 1 : lim / tl;
      x[j] = x[j]! - tx * k;
      x[j + 1] = x[j + 1]! - ty * k;
      x[j + 2] = x[j + 2]! - tz * k;
    }
  }

  /** Largest particle speed over the last frame (m/s): its motion from the frame's start, without the
   *  substeps' corrections going back and forth. */
  frameSpeed(): number {
    let m = 0;
    const x = this.x;
    const f = this.frameStart;
    for (let i = 0; i < this.n; i++) {
      const dx = x[i * 3]! - f[i * 3]!;
      const dy = x[i * 3 + 1]! - f[i * 3 + 1]!;
      const dz = x[i * 3 + 2]! - f[i * 3 + 2]!;
      const s = dx * dx + dy * dy + dz * dz;
      if (s > m) m = s;
    }
    return Math.sqrt(m) / this.s.dt;
  }

  /** Largest particle speed (m/s). */
  maxSpeed(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.v[i * 3]! * this.v[i * 3]! + this.v[i * 3 + 1]! * this.v[i * 3 + 1]! + this.v[i * 3 + 2]! * this.v[i * 3 + 2]!;
      if (s > m) m = s;
    }
    return Math.sqrt(m);
  }

  /** Kinetic (over the last frame), gravitational, stretch and bending energy (J). */
  energy(): { kinetic: number; gravity: number; elastic: number; bending: number; total: number } {
    const { x, mass, frameStart } = this;
    let kinetic = 0;
    let gravity = 0;
    // Kinetic energy from the last frame's motion (a substep's velocity carries the solver's corrections).
    const inv = 1 / this.s.dt;
    for (let i = 0; i < this.n; i++) {
      if (this.w[i] === 0) continue;
      const vx = (x[i * 3]! - frameStart[i * 3]!) * inv;
      const vy = (x[i * 3 + 1]! - frameStart[i * 3 + 1]!) * inv;
      const vz = (x[i * 3 + 2]! - frameStart[i * 3 + 2]!) * inv;
      kinetic += 0.5 * mass[i]! * (vx * vx + vy * vy + vz * vz);
      gravity += mass[i]! * this.s.gravity * x[i * 3 + 1]!;
    }
    let elastic = 0;
    for (let e = 0; e < this.edgeRest.length; e++) {
      const a = this.edges[e * 2]!;
      const b = this.edges[e * 2 + 1]!;
      const dx = x[b * 3]! - x[a * 3]!;
      const dy = x[b * 3 + 1]! - x[a * 3 + 1]!;
      const dz = x[b * 3 + 2]! - x[a * 3 + 2]!;
      const C = Math.sqrt(dx * dx + dy * dy + dz * dz) - this.edgeRest[e]!;
      const alpha = C >= 0 ? this.edgeAlpha[e]! : this.s.compression;
      if (alpha > 0) elastic += (C * C) / (2 * alpha);
    }
    for (let t = 0; t < this.triRest.length; t++) {
      const a = this.tris[t * 3]!;
      const b = this.tris[t * 3 + 1]!;
      const c = this.tris[t * 3 + 2]!;
      const ux = x[b * 3]! - x[a * 3]!;
      const uy = x[b * 3 + 1]! - x[a * 3 + 1]!;
      const uz = x[b * 3 + 2]! - x[a * 3 + 2]!;
      const vx = x[c * 3]! - x[a * 3]!;
      const vy = x[c * 3 + 1]! - x[a * 3 + 1]!;
      const vz = x[c * 3 + 2]! - x[a * 3 + 2]!;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const C = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2 - this.triRest[t]!;
      if (C > 0 && this.triAlpha[t]! > 0) elastic += (C * C) / (2 * this.triAlpha[t]!);
    }
    let bending = 0;
    for (let e = 0; e < this.hingeAlpha.length; e++) {
      let c2 = 0;
      for (let k = 0; k < 3; k++) {
        let c = 0;
        for (let j = 0; j < 4; j++) c += this.hingeK[e * 4 + j]! * x[this.hinges[e * 4 + j]! * 3 + k]!;
        c2 += c * c;
      }
      bending += c2 / (2 * this.hingeAlpha[e]!);
    }
    return { kinetic, gravity, elastic, bending, total: kinetic + gravity + elastic + bending };
  }
}

/** a^(1-f) b^f for f in [0, 1], with 2^-12 resolution in f (square roots only). */
export function interpGeometric(a: number, b: number, f: number): number {
  // Binary expansion of f: product of a^(1-f) b^f = a * (b/a)^f.
  const r = b / a;
  let out = a;
  let root = r;
  let rem = f;
  for (let bit = 0; bit < 12; bit++) {
    root = Math.sqrt(root);
    rem *= 2;
    if (rem >= 1) {
      out *= root;
      rem -= 1;
    }
  }
  return out;
}

/**
 * Bergou's weights for a hinge whose two triangles are given by their own rest corners (a0, b0, c0) and
 * (a1, b1, d1), where a0 and a1 are the same particle, as are b0 and b1 (a welded seam joins two panels, each
 * with its own pattern coordinates). Every cotangent is an angle inside one triangle.
 */
export function cotanWeights2(R: Float64Array, a0: number, b0: number, c0: number, a1: number, b1: number, d1: number): [number, number, number, number] {
  const cot = (o: number, p: number, q: number): number => {
    const ux = R[p * 2]! - R[o * 2]!;
    const uy = R[p * 2 + 1]! - R[o * 2 + 1]!;
    const vx = R[q * 2]! - R[o * 2]!;
    const vy = R[q * 2 + 1]! - R[o * 2 + 1]!;
    const dot = ux * vx + uy * vy;
    const cr = Math.abs(ux * vy - uy * vx);
    return cr > 0 ? dot / cr : 0;
  };
  const c01 = cot(a0, b0, c0);
  const c02 = cot(a1, b1, d1);
  const c03 = cot(b0, a0, c0);
  const c04 = cot(b1, a1, d1);
  return [c03 + c04, c01 + c02, -c01 - c03, -c02 - c04];
}

/**
 * Bergou's isometric bending weights for the hinge (a, b) with wings c and d, from rest positions in the
 * plane: C = Σ K x over (a, b, c, d) is the hinge's mean-curvature vector.
 */
export function cotanWeights(R: Float64Array, a: number, b: number, c: number, d: number): [number, number, number, number] {
  const cot = (o: number, p: number, q: number): number => {
    // Cotangent of the angle at o in triangle (o, p, q).
    const ux = R[p * 2]! - R[o * 2]!;
    const uy = R[p * 2 + 1]! - R[o * 2 + 1]!;
    const vx = R[q * 2]! - R[o * 2]!;
    const vy = R[q * 2 + 1]! - R[o * 2 + 1]!;
    const dot = ux * vx + uy * vy;
    const cr = Math.abs(ux * vy - uy * vx);
    return cr > 0 ? dot / cr : 0;
  };
  // Angles at a and b in each wing triangle (a, b, c) and (a, b, d).
  const c01 = cot(a, b, c);
  const c02 = cot(a, b, d);
  const c03 = cot(b, a, c);
  const c04 = cot(b, a, d);
  return [c03 + c04, c01 + c02, -c01 - c03, -c02 - c04];
}
