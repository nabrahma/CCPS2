// Package exportscene decodes the export message the engine sends to the
// backend (PRD 6.3 step 1: "one compact binary message"): a JSON header that
// describes the character (skeleton, meshes, materials, textures, sidecar)
// followed by little-endian binary buffers it references.
//
// Layout:
//
//	"PS2CCEX1" | u32 header length | header JSON | zero padding to 8 | buffers
//
// Every buffer reference is {"offset","length","type"} relative to the start
// of the buffer area; offsets are 8-byte aligned. Decode validates everything
// (sizes, index ranges, NaN) so the FBX writer can trust its input.
package exportscene

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
)

// Magic starts every export message.
const Magic = "PS2CCEX1"

// MaxMessageBytes caps a message (textures included).
const MaxMessageBytes = 512 << 20

// MaxInfluences is the bone influence limit per vertex (PRD 6.2).
const MaxInfluences = 4

// Bone is one skeleton joint in its rest (bind) pose.
type Bone struct {
	Name   string
	Parent int // -1 for the root
	// BindGlobal is the rest world matrix, column-major (translation in 12..14), metres.
	BindGlobal [16]float64
}

// Shape is a blendshape: sparse vertex deltas.
type Shape struct {
	Name         string
	Indices      []uint32
	Deltas       []float32 // xyz per index
	NormalDeltas []float32 // xyz per index, optional
}

// Mesh is one skinned mesh (one SkinnedMeshRenderer in Unity).
type Mesh struct {
	Name      string
	Positions []float32 // xyz per vertex, metres
	Normals   []float32 // xyz per vertex
	UVs       []float32 // uv per vertex (v up)
	Indices   []uint32  // triangles
	// Materials lists the scene material of each slot; TriangleMaterial gives the slot per triangle (nil: all slot 0).
	Materials        []int
	TriangleMaterial []uint32
	Joints           []uint16  // MaxInfluences bone indices per vertex
	Weights          []float32 // MaxInfluences weights per vertex (0 for unused slots)
	Shapes           []Shape
}

// VertexCount is the number of vertices.
func (m *Mesh) VertexCount() int { return len(m.Positions) / 3 }

// TriangleCount is the number of triangles.
func (m *Mesh) TriangleCount() int { return len(m.Indices) / 3 }

// Material is one material (Unity material created from the sidecar).
type Material struct {
	Name        string  `json:"name"`
	Shader      string  `json:"shader"`
	Texture     string  `json:"texture"` // relative path of the diffuse texture, "" for none
	AlphaClip   float64 `json:"alphaClip"`
	DoubleSided bool    `json:"doubleSided"`
	Role        string  `json:"role"`
}

// Texture is an image file written next to the FBX.
type Texture struct {
	File string // relative path, e.g. "Textures/Bob_Head_D.png"
	Data []byte // PNG
}

// Scene is a decoded export.
type Scene struct {
	Name      string
	Bones     []Bone
	Meshes    []Mesh
	Materials []Material
	Textures  []Texture
	// Sidecar is the <Name>.ps2cc.json document, written as is.
	Sidecar json.RawMessage
	// GLB is the optional secondary output (already validated by the app).
	GLB []byte
	// CreationTime is written in the FBX header ("YYYY-MM-DD HH:MM:SS:mmm"); tests fix it for determinism.
	CreationTime string
}

type bufRef struct {
	Offset int    `json:"offset"`
	Length int    `json:"length"`
	Type   string `json:"type"`
}

type header struct {
	Format       string          `json:"format"`
	Name         string          `json:"name"`
	CreationTime string          `json:"creationTime"`
	Bones        []boneJSON      `json:"bones"`
	Meshes       []meshJSON      `json:"meshes"`
	Materials    []Material      `json:"materials"`
	Textures     []textureJSON   `json:"textures"`
	Sidecar      json.RawMessage `json:"sidecar"`
	GLB          *bufRef         `json:"glb"`
}

type boneJSON struct {
	Name       string    `json:"name"`
	Parent     int       `json:"parent"`
	BindGlobal []float64 `json:"bindGlobal"`
}

type shapeJSON struct {
	Name         string  `json:"name"`
	Indices      bufRef  `json:"indices"`
	Deltas       bufRef  `json:"deltas"`
	NormalDeltas *bufRef `json:"normalDeltas"`
}

type meshJSON struct {
	Name             string      `json:"name"`
	Positions        bufRef      `json:"positions"`
	Normals          bufRef      `json:"normals"`
	UVs              bufRef      `json:"uvs"`
	Indices          bufRef      `json:"indices"`
	Materials        []int       `json:"materials"`
	TriangleMaterial *bufRef     `json:"triangleMaterial"`
	Joints           bufRef      `json:"joints"`
	Weights          bufRef      `json:"weights"`
	Shapes           []shapeJSON `json:"shapes"`
}

type textureJSON struct {
	File string `json:"file"`
	Data bufRef `json:"data"`
}

var (
	safeName = regexp.MustCompile(`^[\pL\pN _.\-()]{1,64}$`)
	safeFile = regexp.MustCompile(`^Textures/[\pL\pN _.\-()]{1,96}\.png$`)
	timeRe   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3}$`)
)

// Decode parses and validates a message.
func Decode(msg []byte) (*Scene, error) {
	if len(msg) > MaxMessageBytes {
		return nil, errors.New("export message is too large")
	}
	if len(msg) < 12 || string(msg[:8]) != Magic {
		return nil, errors.New("not a PS2CC export message")
	}
	hlen := int(binary.LittleEndian.Uint32(msg[8:12]))
	if hlen <= 0 || 12+hlen > len(msg) {
		return nil, errors.New("export message header is truncated")
	}
	var h header
	dec := json.NewDecoder(bytes.NewReader(msg[12 : 12+hlen]))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&h); err != nil {
		return nil, fmt.Errorf("export header: %w", err)
	}
	if h.Format != "ps2cc.export/1" {
		return nil, fmt.Errorf("unsupported export format %q", h.Format)
	}
	start := align8(12 + hlen)
	if start > len(msg) {
		start = len(msg)
	}
	data := msg[start:]
	s := &Scene{Name: h.Name, Sidecar: h.Sidecar, CreationTime: h.CreationTime}
	if !safeName.MatchString(s.Name) || strings.TrimSpace(s.Name) != s.Name {
		return nil, fmt.Errorf("invalid character name %q", s.Name)
	}
	if s.CreationTime == "" {
		s.CreationTime = "1970-01-01 00:00:00:000"
	}
	if !timeRe.MatchString(s.CreationTime) {
		return nil, fmt.Errorf("invalid creation time %q", s.CreationTime)
	}
	if len(s.Sidecar) > 0 && !json.Valid(s.Sidecar) {
		return nil, errors.New("invalid sidecar JSON")
	}
	r := reader{data: data}

	// Skeleton.
	if len(h.Bones) == 0 || len(h.Bones) > 512 {
		return nil, fmt.Errorf("skeleton needs 1..512 bones, got %d", len(h.Bones))
	}
	names := map[string]bool{}
	for i, b := range h.Bones {
		if !safeName.MatchString(b.Name) || names[b.Name] {
			return nil, fmt.Errorf("bone %d: invalid or duplicate name %q", i, b.Name)
		}
		names[b.Name] = true
		if b.Parent < -1 || b.Parent >= i {
			return nil, fmt.Errorf("bone %s: parent %d must come before it", b.Name, b.Parent)
		}
		if len(b.BindGlobal) != 16 || !finite64(b.BindGlobal) {
			return nil, fmt.Errorf("bone %s: bind matrix must be 16 finite numbers", b.Name)
		}
		var m [16]float64
		copy(m[:], b.BindGlobal)
		if math.Abs(m[3])+math.Abs(m[7])+math.Abs(m[11]) > 1e-9 || math.Abs(m[15]-1) > 1e-9 {
			return nil, fmt.Errorf("bone %s: bind matrix is not affine", b.Name)
		}
		// Bones are rigid (rotation + translation): FBX node transforms cannot carry shear.
		if !rigid(m) {
			return nil, fmt.Errorf("bone %s: bind matrix is not a rotation plus translation", b.Name)
		}
		s.Bones = append(s.Bones, Bone{Name: b.Name, Parent: b.Parent, BindGlobal: m})
	}

	// Materials.
	if len(h.Materials) > 64 {
		return nil, errors.New("too many materials")
	}
	for i, m := range h.Materials {
		if !safeName.MatchString(m.Name) {
			return nil, fmt.Errorf("material %d: invalid name %q", i, m.Name)
		}
		if m.Texture != "" && !safeFile.MatchString(m.Texture) {
			return nil, fmt.Errorf("material %s: invalid texture path %q", m.Name, m.Texture)
		}
		if math.IsNaN(m.AlphaClip) || m.AlphaClip < 0 || m.AlphaClip > 1 {
			return nil, fmt.Errorf("material %s: alpha clip out of range", m.Name)
		}
	}
	s.Materials = h.Materials

	// Meshes.
	if len(h.Meshes) == 0 || len(h.Meshes) > 16 {
		return nil, fmt.Errorf("export needs 1..16 meshes, got %d", len(h.Meshes))
	}
	meshNames := map[string]bool{}
	for _, mj := range h.Meshes {
		m, err := decodeMesh(&r, mj, len(s.Bones), len(s.Materials))
		if err != nil {
			return nil, fmt.Errorf("mesh %q: %w", mj.Name, err)
		}
		if meshNames[m.Name] || names[m.Name] {
			return nil, fmt.Errorf("mesh name %q is used twice", m.Name)
		}
		meshNames[m.Name] = true
		s.Meshes = append(s.Meshes, *m)
	}

	// Textures.
	files := map[string]bool{}
	for _, t := range h.Textures {
		if !safeFile.MatchString(t.File) || files[strings.ToLower(t.File)] {
			return nil, fmt.Errorf("invalid or duplicate texture path %q", t.File)
		}
		files[strings.ToLower(t.File)] = true
		b, err := r.bytes(t.Data)
		if err != nil {
			return nil, fmt.Errorf("texture %s: %w", t.File, err)
		}
		if len(b) < 8 || string(b[1:4]) != "PNG" {
			return nil, fmt.Errorf("texture %s is not a PNG", t.File)
		}
		s.Textures = append(s.Textures, Texture{File: t.File, Data: b})
	}
	for _, m := range s.Materials {
		if m.Texture != "" && !files[strings.ToLower(m.Texture)] {
			return nil, fmt.Errorf("material %s uses texture %s, which is not in the export", m.Name, m.Texture)
		}
	}
	if h.GLB != nil {
		b, err := r.bytes(*h.GLB)
		if err != nil {
			return nil, fmt.Errorf("glb: %w", err)
		}
		if len(b) < 12 || string(b[:4]) != "glTF" {
			return nil, errors.New("glb data is not a binary glTF")
		}
		s.GLB = b
	}
	return s, nil
}

func decodeMesh(r *reader, mj meshJSON, boneCount, materialCount int) (*Mesh, error) {
	if !safeName.MatchString(mj.Name) {
		return nil, fmt.Errorf("invalid name")
	}
	m := &Mesh{Name: mj.Name, Materials: mj.Materials}
	var err error
	if m.Positions, err = r.f32(mj.Positions); err != nil {
		return nil, fmt.Errorf("positions: %w", err)
	}
	n := len(m.Positions) / 3
	if n == 0 || len(m.Positions)%3 != 0 || n > 1<<20 {
		return nil, errors.New("positions must be 1..1M xyz triples")
	}
	if m.Normals, err = r.f32(mj.Normals); err != nil || len(m.Normals) != n*3 {
		return nil, fmt.Errorf("normals must match the vertex count (%v)", err)
	}
	if m.UVs, err = r.f32(mj.UVs); err != nil || len(m.UVs) != n*2 {
		return nil, fmt.Errorf("uvs must match the vertex count (%v)", err)
	}
	if m.Indices, err = r.u32(mj.Indices); err != nil || len(m.Indices) == 0 || len(m.Indices)%3 != 0 {
		return nil, fmt.Errorf("indices must be whole triangles (%v)", err)
	}
	for _, i := range m.Indices {
		if int(i) >= n {
			return nil, fmt.Errorf("index %d out of range (%d vertices)", i, n)
		}
	}
	if !finite32(m.Positions) || !finite32(m.Normals) || !finite32(m.UVs) {
		return nil, errors.New("non-finite vertex data")
	}
	if len(m.Materials) == 0 || len(m.Materials) > 16 {
		return nil, errors.New("a mesh needs 1..16 material slots")
	}
	for _, mi := range m.Materials {
		if mi < 0 || mi >= materialCount {
			return nil, fmt.Errorf("material %d out of range", mi)
		}
	}
	if mj.TriangleMaterial != nil {
		if m.TriangleMaterial, err = r.u32(*mj.TriangleMaterial); err != nil || len(m.TriangleMaterial) != len(m.Indices)/3 {
			return nil, fmt.Errorf("triangle materials must match the triangle count (%v)", err)
		}
		for _, s := range m.TriangleMaterial {
			if int(s) >= len(m.Materials) {
				return nil, fmt.Errorf("material slot %d out of range", s)
			}
		}
	}
	if m.Joints, err = r.u16(mj.Joints); err != nil || len(m.Joints) != n*MaxInfluences {
		return nil, fmt.Errorf("joints must be %d per vertex (%v)", MaxInfluences, err)
	}
	if m.Weights, err = r.f32(mj.Weights); err != nil || len(m.Weights) != n*MaxInfluences {
		return nil, fmt.Errorf("weights must be %d per vertex (%v)", MaxInfluences, err)
	}
	for v := 0; v < n; v++ {
		sum := float32(0)
		for k := 0; k < MaxInfluences; k++ {
			w := m.Weights[v*MaxInfluences+k]
			if !(w >= 0 && w <= 1) {
				return nil, fmt.Errorf("vertex %d: weight %v out of range", v, w)
			}
			if w > 0 && int(m.Joints[v*MaxInfluences+k]) >= boneCount {
				return nil, fmt.Errorf("vertex %d: bone %d out of range", v, m.Joints[v*MaxInfluences+k])
			}
			sum += w
		}
		if math.Abs(float64(sum)-1) > 1e-3 {
			return nil, fmt.Errorf("vertex %d: weights sum to %v, not 1", v, sum)
		}
	}
	shapeNames := map[string]bool{}
	for _, sj := range mj.Shapes {
		if !safeName.MatchString(sj.Name) || shapeNames[sj.Name] {
			return nil, fmt.Errorf("invalid or duplicate blendshape name %q", sj.Name)
		}
		shapeNames[sj.Name] = true
		sh := Shape{Name: sj.Name}
		if sh.Indices, err = r.u32(sj.Indices); err != nil {
			return nil, fmt.Errorf("blendshape %s: %w", sj.Name, err)
		}
		if sh.Deltas, err = r.f32(sj.Deltas); err != nil || len(sh.Deltas) != len(sh.Indices)*3 || !finite32(sh.Deltas) {
			return nil, fmt.Errorf("blendshape %s: deltas must be xyz per index (%v)", sj.Name, err)
		}
		if sj.NormalDeltas != nil {
			if sh.NormalDeltas, err = r.f32(*sj.NormalDeltas); err != nil || len(sh.NormalDeltas) != len(sh.Indices)*3 || !finite32(sh.NormalDeltas) {
				return nil, fmt.Errorf("blendshape %s: normal deltas must be xyz per index (%v)", sj.Name, err)
			}
		}
		prev := -1
		for _, i := range sh.Indices {
			if int(i) >= n || int(i) <= prev {
				return nil, fmt.Errorf("blendshape %s: indices must be increasing and in range", sj.Name)
			}
			prev = int(i)
		}
		m.Shapes = append(m.Shapes, sh)
	}
	return m, nil
}

type reader struct{ data []byte }

func (r *reader) slice(ref bufRef, typ string, elem int) ([]byte, error) {
	if ref.Type != typ {
		return nil, fmt.Errorf("buffer type %q, expected %q", ref.Type, typ)
	}
	if ref.Offset < 0 || ref.Length < 0 || ref.Offset%8 != 0 || ref.Length%elem != 0 || ref.Offset+ref.Length > len(r.data) {
		return nil, fmt.Errorf("buffer %d+%d out of range", ref.Offset, ref.Length)
	}
	return r.data[ref.Offset : ref.Offset+ref.Length], nil
}

func (r *reader) bytes(ref bufRef) ([]byte, error) { return r.slice(ref, "u8", 1) }

func (r *reader) f32(ref bufRef) ([]float32, error) {
	b, err := r.slice(ref, "f32", 4)
	if err != nil {
		return nil, err
	}
	out := make([]float32, len(b)/4)
	for i := range out {
		out[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return out, nil
}

func (r *reader) u32(ref bufRef) ([]uint32, error) {
	b, err := r.slice(ref, "u32", 4)
	if err != nil {
		return nil, err
	}
	out := make([]uint32, len(b)/4)
	for i := range out {
		out[i] = binary.LittleEndian.Uint32(b[i*4:])
	}
	return out, nil
}

func (r *reader) u16(ref bufRef) ([]uint16, error) {
	b, err := r.slice(ref, "u16", 2)
	if err != nil {
		return nil, err
	}
	out := make([]uint16, len(b)/2)
	for i := range out {
		out[i] = binary.LittleEndian.Uint16(b[i*2:])
	}
	return out, nil
}

func align8(n int) int { return (n + 7) &^ 7 }

func finite32(v []float32) bool {
	for _, x := range v {
		if math.IsNaN(float64(x)) || math.IsInf(float64(x), 0) {
			return false
		}
	}
	return true
}

func finite64(v []float64) bool {
	for _, x := range v {
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return false
		}
	}
	return true
}

// rigid reports whether the 3x3 part is a proper rotation (orthonormal, det +1) within 1e-5.
func rigid(m [16]float64) bool {
	for a := 0; a < 3; a++ {
		for b := 0; b < 3; b++ {
			dot := m[a*4]*m[b*4] + m[a*4+1]*m[b*4+1] + m[a*4+2]*m[b*4+2]
			want := 0.0
			if a == b {
				want = 1
			}
			if math.Abs(dot-want) > 1e-5 {
				return false
			}
		}
	}
	det := m[0]*(m[5]*m[10]-m[9]*m[6]) - m[4]*(m[1]*m[10]-m[9]*m[2]) + m[8]*(m[1]*m[6]-m[5]*m[2])
	return det > 0
}
