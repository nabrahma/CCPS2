// Package garments reads the meshes users model around the exported base body
// (PRD F4 custom garments: OBJ, FBX, GLB) into one neutral form. The engine
// does the rest (packages/core/src/proxy/garment-import.ts). The files are the
// user's and may be malformed, so every index and length is checked.
package garments

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

const (
	// MaxFileBytes caps a garment file (the library's import limit).
	MaxFileBytes = 256 << 20
	// MaxFaces caps a garment's faces: far above any garment, below what would stall the app.
	MaxFaces = 2_000_000
)

// Mesh is a garment as it was modelled. Faces take four entries of FaceVerts
// and FaceUVs; a triangle repeats its last corner (MakeHuman's convention).
type Mesh struct {
	Positions []float32 // xyz per vertex
	UVs       []float32 // uv per entry, v up
	FaceVerts []uint32
	FaceUVs   []uint32
	HasUVs    bool
}

// Triangles is the mesh's triangle count.
func (m *Mesh) Triangles() int {
	n := 0
	for f := 0; f < len(m.FaceVerts); f += 4 {
		if m.FaceVerts[f+2] == m.FaceVerts[f+3] {
			n++
		} else {
			n += 2
		}
	}
	return n
}

// Read loads a garment file, by extension.
func Read(path string) (*Mesh, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.Size() > MaxFileBytes {
		return nil, errors.New("the file is larger than 256 MB")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(filepath.Ext(path), data)
}

// Parse reads garment data of the type named by a file extension.
func Parse(ext string, data []byte) (*Mesh, error) {
	var (
		m   *Mesh
		err error
	)
	switch strings.ToLower(ext) {
	case ".obj":
		m, err = parseOBJ(data)
	case ".glb":
		m, err = parseGLB(data)
	case ".fbx":
		m, err = parseFBX(data)
	default:
		return nil, fmt.Errorf("unsupported file type %q: use OBJ, FBX or GLB", ext)
	}
	if err != nil {
		return nil, err
	}
	if len(m.FaceVerts) == 0 {
		return nil, errors.New("the file has no mesh faces")
	}
	return m, nil
}

// builder collects a mesh and rejects bad data.
type builder struct {
	m     Mesh
	uvIDs map[[2]float32]uint32
}

func newBuilder() *builder { return &builder{uvIDs: map[[2]float32]uint32{}} }

func finite(values ...float64) bool {
	for _, v := range values {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}

func (b *builder) vertex(x, y, z float64) (uint32, error) {
	if !finite(x, y, z) {
		return 0, errors.New("the mesh has an invalid vertex position")
	}
	id := uint32(len(b.m.Positions) / 3)
	b.m.Positions = append(b.m.Positions, float32(x), float32(y), float32(z))
	return id, nil
}

func (b *builder) entry(u, v float32) uint32 {
	key := [2]float32{u, v}
	id, ok := b.uvIDs[key]
	if !ok {
		id = uint32(len(b.m.UVs) / 2)
		b.uvIDs[key] = id
		b.m.UVs = append(b.m.UVs, u, v)
	}
	return id
}

// uv returns the entry of a UV coordinate; identical coordinates share one
// entry, so that only real seams split vertices later.
func (b *builder) uv(u, v float64) (uint32, error) {
	if !finite(u, v) {
		return 0, errors.New("the mesh has an invalid UV coordinate")
	}
	b.m.HasUVs = true
	return b.entry(float32(u), float32(v)), nil
}

// noUV is the entry of a corner without UVs.
func (b *builder) noUV() uint32 { return b.entry(0, 0) }

// face adds a polygon, splitting anything above a quad into a fan of triangles.
func (b *builder) face(verts, uvs []uint32) error {
	if len(verts) < 3 {
		return nil // points and lines are not cloth
	}
	if len(b.m.FaceVerts)/4+len(verts) > MaxFaces {
		return fmt.Errorf("the mesh has more than %d faces", MaxFaces)
	}
	if len(verts) == 4 {
		b.m.FaceVerts = append(b.m.FaceVerts, verts...)
		b.m.FaceUVs = append(b.m.FaceUVs, uvs...)
		return nil
	}
	for k := 1; k+1 < len(verts); k++ {
		b.m.FaceVerts = append(b.m.FaceVerts, verts[0], verts[k], verts[k+1], verts[k+1])
		b.m.FaceUVs = append(b.m.FaceUVs, uvs[0], uvs[k], uvs[k+1], uvs[k+1])
	}
	return nil
}
