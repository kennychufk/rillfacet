// CPU-side geometry of the drawn scene objects, numbered exactly as the
// native viewer numbers the structures the NativeBackend (scene_api.py)
// builds from the same objects, so a selection means the same element in
// both viewers:
//
//   rigid mesh  one surface mesh of all instances: vertex = k * V + v,
//               face = k * T + t, edge = k * E + e (per-instance edges in
//               first-seen order, SurfaceMesh::build_edges), segment
//               ("body") = k * B + b, named "<instance>/<body>"
//   boxes       box_mesh(): vertex = 8 * box + corner, face = 12 * box + t,
//               one segment
//   points      a point cloud: point i (drawn as a box on the web)
//
// Positions are world space with the display grid offsets applied.
import { type Vec3 } from "./math";
import { type SceneObject } from "./renderer";

export interface MeshGeo {
  kind: "mesh";
  name: string;
  id: number;
  numVertices: number;
  numFaces: number;
  numEdges: number;
  numSegments: number;
  vertex(i: number): Vec3;
  face(f: number): [number, number, number];
  faceEdge(f: number, k: number): number; // edge k joins corners k and k+1
  edge(e: number): [number, number];
  segmentOfFace(f: number): number;
  segmentOfVertex(v: number): number;
  segmentFaces(s: number): [number, number]; // [first, end)
  segmentName(s: number): string;
  segmentVisible(s: number): boolean;
  faceVisible(f: number): boolean;
  instanceOf?(s: number): number; // rigid: env of a segment
}

export interface PointsGeo {
  kind: "points";
  name: string;
  id: number;
  count: number;
  point(i: number): Vec3;
  radius(i: number): number;
  visible(i: number): boolean;
}

export type Geo = MeshGeo | PointsGeo;

// Unique edges of a triangle list in first-seen order (SurfaceMesh::build_edges).
export function buildEdges(tris: ArrayLike<number>, nf: number) {
  const edges: number[] = [];
  const edgeFaces: number[] = [];
  const faceEdges = new Uint32Array(3 * nf);
  const index = new Map<number, number>();
  for (let f = 0; f < nf; f++)
    for (let k = 0; k < 3; k++) {
      const a = tris[3 * f + k], b = tris[3 * f + ((k + 1) % 3)];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const key = lo * 4294967296 + hi;
      let e = index.get(key);
      if (e === undefined) {
        e = edges.length / 2;
        index.set(key, e);
        edges.push(lo, hi);
        edgeFaces.push(f, -1);
      } else if (edgeFaces[2 * e + 1] === -1) {
        edgeFaces[2 * e + 1] = f;
      }
      faceEdges[3 * f + k] = e;
    }
  return { edges: Uint32Array.from(edges), edgeFaces: Int32Array.from(edgeFaces), faceEdges };
}

// Per face, bit k = edge k lies between faces whose normals differ by less
// than `angleDeg` (SurfaceMesh::flat_edge_mask).
export function flatEdgeMask(tris: ArrayLike<number>, nf: number, pos: (i: number) => Vec3,
  e: ReturnType<typeof buildEdges>, angleDeg: number): Uint8Array {
  const mask = new Uint8Array(nf);
  if (angleDeg <= 0) return mask;
  const n = new Float64Array(3 * nf);
  for (let f = 0; f < nf; f++) {
    const a = pos(tris[3 * f]), b = pos(tris[3 * f + 1]), c = pos(tris[3 * f + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const x = u[1] * w[2] - u[2] * w[1], y = u[2] * w[0] - u[0] * w[2], z = u[0] * w[1] - u[1] * w[0];
    const l = Math.hypot(x, y, z);
    if (l > 0) n.set([x / l, y / l, z / l], 3 * f);
  }
  const lim = Math.cos((angleDeg * Math.PI) / 180);
  for (let f = 0; f < nf; f++)
    for (let k = 0; k < 3; k++) {
      const ed = e.faceEdges[3 * f + k];
      const o = e.edgeFaces[2 * ed] === f ? e.edgeFaces[2 * ed + 1] : e.edgeFaces[2 * ed];
      if (o >= 0 && n[3 * f] * n[3 * o] + n[3 * f + 1] * n[3 * o + 1] + n[3 * f + 2] * n[3 * o + 2] >= lim)
        mask[f] |= 1 << k;
    }
  return mask;
}

// Rigid bodies of `instances` envs: body-local template + one pose per segment.
export class RigidGeo implements MeshGeo {
  readonly kind = "mesh";
  readonly V: number; // vertices per instance
  readonly T: number; // faces per instance
  readonly B: number;
  readonly instances: number;
  readonly local: Float32Array;
  readonly vertexBody: Uint32Array;
  readonly tris: Uint32Array;
  readonly faceBody: Uint32Array;
  readonly bodyOffsets: Int32Array;
  readonly offsets: Float32Array; // [instances, 4]
  readonly edges: ReturnType<typeof buildEdges>;
  poses: Float32Array | null = null; // [instances, B, 7]
  appVisible: Uint8Array; // per segment, as sent
  userHidden: Uint8Array; // per segment (H)
  isolated = -1; // env shown alone (-1: all)
  private bodyNames: string[];
  private instanceNames: string[];
  private flat: { angle: number; mask: Uint8Array } | null = null;

  constructor(readonly name: string, readonly id: number, o: SceneObject) {
    const a = o.arrays;
    this.instances = o.attrs.instances;
    this.local = Float32Array.from(a.local_vertices.data as ArrayLike<number>);
    this.vertexBody = Uint32Array.from(a.vertex_body.data as ArrayLike<number>);
    this.tris = Uint32Array.from(a.triangles.data as ArrayLike<number>);
    this.bodyOffsets = Int32Array.from(a.body_triangle_offsets.data as ArrayLike<number>);
    this.V = this.vertexBody.length;
    this.T = this.tris.length / 3;
    this.B = this.bodyOffsets.length - 1;
    this.faceBody = new Uint32Array(this.T);
    for (let b = 0; b < this.B; b++) this.faceBody.fill(b, this.bodyOffsets[b], this.bodyOffsets[b + 1]);
    this.offsets = new Float32Array(this.instances * 4);
    for (let k = 0; k < this.instances; k++)
      for (let i = 0; i < 3; i++) this.offsets[k * 4 + i] = a.offsets.data[k * 3 + i];
    this.edges = buildEdges(this.tris, this.T);
    const S = this.instances * this.B;
    const vis = a.segment_visible?.data;
    this.appVisible = new Uint8Array(S).map((_, s) => (vis && !vis[s] ? 0 : 1));
    this.userHidden = new Uint8Array(S);
    this.bodyNames = o.attrs.body_names ?? Array.from({ length: this.B }, (_, b) => `body${b}`);
    this.instanceNames = o.attrs.instance_names ?? Array.from({ length: this.instances }, (_, k) => `env${k}`);
  }

  get numVertices() { return this.instances * this.V; }
  get numFaces() { return this.instances * this.T; }
  get numEdges() { return this.instances * (this.edges.edges.length / 2); }
  get numSegments() { return this.instances * this.B; }

  vertex(i: number): Vec3 {
    const k = Math.floor(i / this.V), v = i - k * this.V;
    const L = this.local, x = L[3 * v], y = L[3 * v + 1], z = L[3 * v + 2];
    const ox = this.offsets[4 * k], oy = this.offsets[4 * k + 1], oz = this.offsets[4 * k + 2];
    const p = this.poses;
    if (!p) return [x + ox, y + oy, z + oz];
    const j = (k * this.B + this.vertexBody[v]) * 7;
    const qx = p[j + 3], qy = p[j + 4], qz = p[j + 5], qw = p[j + 6];
    // v + 2 qw (q x v) + 2 q x (q x v)
    const ux = 2 * (qy * z - qz * y), uy = 2 * (qz * x - qx * z), uz = 2 * (qx * y - qy * x);
    return [p[j] + ox + x + qw * ux + (qy * uz - qz * uy),
      p[j + 1] + oy + y + qw * uy + (qz * ux - qx * uz),
      p[j + 2] + oz + z + qw * uz + (qx * uy - qy * ux)];
  }

  face(f: number): [number, number, number] {
    const k = Math.floor(f / this.T), t = f - k * this.T, o = k * this.V;
    return [this.tris[3 * t] + o, this.tris[3 * t + 1] + o, this.tris[3 * t + 2] + o];
  }

  faceEdge(f: number, c: number): number {
    const k = Math.floor(f / this.T), t = f - k * this.T;
    return this.edges.faceEdges[3 * t + c] + k * (this.edges.edges.length / 2);
  }

  edge(e: number): [number, number] {
    const E = this.edges.edges.length / 2, k = Math.floor(e / E), i = e - k * E;
    return [this.edges.edges[2 * i] + k * this.V, this.edges.edges[2 * i + 1] + k * this.V];
  }

  segmentOfFace(f: number) {
    const k = Math.floor(f / this.T);
    return k * this.B + this.faceBody[f - k * this.T];
  }

  segmentOfVertex(v: number) {
    const k = Math.floor(v / this.V);
    return k * this.B + this.vertexBody[v - k * this.V];
  }

  segmentFaces(s: number): [number, number] {
    const k = Math.floor(s / this.B), b = s - k * this.B;
    return [k * this.T + this.bodyOffsets[b], k * this.T + this.bodyOffsets[b + 1]];
  }

  segmentName(s: number) {
    const k = Math.floor(s / this.B), b = s - k * this.B;
    return this.instances === 1 ? this.bodyNames[b] : `${this.instanceNames[k]}/${this.bodyNames[b]}`;
  }

  instanceOf(s: number) {
    return Math.floor(s / this.B);
  }

  segmentVisible(s: number) {
    return !!this.appVisible[s] && !this.userHidden[s] &&
      (this.isolated < 0 || Math.floor(s / this.B) === this.isolated);
  }

  faceVisible(f: number) {
    return this.segmentVisible(this.segmentOfFace(f));
  }

  // Flat-edge bits of the template faces (rigid: computed once per angle).
  flatMask(angle: number): Uint8Array {
    if (this.flat?.angle !== angle) {
      const L = this.local;
      this.flat = {
        angle, mask: flatEdgeMask(this.tris, this.T, (i) => [L[3 * i], L[3 * i + 1], L[3 * i + 2]], this.edges, angle),
      };
    }
    return this.flat.mask;
  }
}

const BOX_CORNERS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
const BOX_TRIS = [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

// Axis-aligned boxes as one mesh (scene_api.box_mesh), or the boxes the web
// draws for a point cloud. `hidden` boxes belong to envs not shown.
export class BoxGeo implements MeshGeo {
  readonly kind = "mesh";
  pos = new Float32Array(0); // [8n, 3]
  tris = new Uint32Array(0); // [12n, 3]
  hidden: Uint8Array = new Uint8Array(0); // per box
  userHidden = false; // the one segment, hidden by the user (H)
  edges: ReturnType<typeof buildEdges> = buildEdges([], 0);
  private flat: { angle: number; mask: Uint8Array } | null = null;
  private n = -1;

  constructor(readonly name: string, readonly id: number) {}

  set(lo: ArrayLike<number>, hi: ArrayLike<number>, hidden: Uint8Array) {
    const n = lo.length / 3;
    this.pos = new Float32Array(24 * n);
    for (let b = 0; b < n; b++)
      for (let v = 0; v < 8; v++)
        for (let k = 0; k < 3; k++)
          this.pos[b * 24 + v * 3 + k] = lo[3 * b + k] + BOX_CORNERS[v * 3 + k] * (hi[3 * b + k] - lo[3 * b + k]);
    if (n !== this.n) {
      this.tris = new Uint32Array(36 * n);
      for (let b = 0; b < n; b++) for (let t = 0; t < 36; t++) this.tris[b * 36 + t] = BOX_TRIS[t] + 8 * b;
      this.edges = buildEdges(this.tris, 12 * n);
      this.n = n;
    }
    this.hidden = hidden;
    this.flat = null;
  }

  get boxes() { return this.n; }
  get numVertices() { return 8 * this.n; }
  get numFaces() { return 12 * this.n; }
  get numEdges() { return this.edges.edges.length / 2; }
  get numSegments() { return 1; }
  vertex(i: number): Vec3 { return [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]]; }
  face(f: number): [number, number, number] { return [this.tris[3 * f], this.tris[3 * f + 1], this.tris[3 * f + 2]]; }
  faceEdge(f: number, k: number) { return this.edges.faceEdges[3 * f + k]; }
  edge(e: number): [number, number] { return [this.edges.edges[2 * e], this.edges.edges[2 * e + 1]]; }
  segmentOfFace() { return 0; }
  segmentOfVertex() { return 0; }
  segmentFaces(): [number, number] { return [0, this.numFaces]; }
  segmentName() { return "segment 0"; }
  segmentVisible() { return !this.userHidden; }
  faceVisible(f: number) { return !this.userHidden && !this.hidden[Math.floor(f / 12)]; }

  flatMask(angle: number): Uint8Array {
    if (this.flat?.angle !== angle)
      this.flat = { angle, mask: flatEdgeMask(this.tris, this.numFaces, (i) => this.vertex(i), this.edges, angle) };
    return this.flat.mask;
  }
}

// A point cloud (drawn as boxes: face f belongs to point floor(f / 12)).
export class PointsGeoImpl implements PointsGeo {
  readonly kind = "points";
  points = new Float32Array(0);
  radii: Float32Array | null = null;
  defaultRadius = 0.01;
  hidden: Uint8Array = new Uint8Array(0);

  constructor(readonly name: string, readonly id: number) {}

  get count() { return this.points.length / 3; }
  point(i: number): Vec3 { return [this.points[3 * i], this.points[3 * i + 1], this.points[3 * i + 2]]; }
  radius(i: number) { return this.radii ? this.radii[i] : this.defaultRadius; }
  visible(i: number) { return !this.hidden[i]; }
}
