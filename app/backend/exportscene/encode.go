package exportscene

import (
	"encoding/binary"
	"encoding/json"
	"math"
)

// Encode builds a message from a scene (the inverse of Decode). The app's
// encoder lives in TypeScript (packages/core/src/export/message.ts); this one
// serves the Go tests (property and fuzz tests of the writer).
func Encode(s *Scene) ([]byte, error) {
	var data []byte
	add := func(typ string, b []byte) bufRef {
		for len(data)%8 != 0 {
			data = append(data, 0)
		}
		ref := bufRef{Offset: len(data), Length: len(b), Type: typ}
		data = append(data, b...)
		return ref
	}
	f32 := func(v []float32) bufRef {
		b := make([]byte, len(v)*4)
		for i, x := range v {
			binary.LittleEndian.PutUint32(b[i*4:], math.Float32bits(x))
		}
		return add("f32", b)
	}
	u32 := func(v []uint32) bufRef {
		b := make([]byte, len(v)*4)
		for i, x := range v {
			binary.LittleEndian.PutUint32(b[i*4:], x)
		}
		return add("u32", b)
	}
	u16 := func(v []uint16) bufRef {
		b := make([]byte, len(v)*2)
		for i, x := range v {
			binary.LittleEndian.PutUint16(b[i*2:], x)
		}
		return add("u16", b)
	}
	h := header{Format: "ps2cc.export/1", Name: s.Name, CreationTime: s.CreationTime, Materials: s.Materials, Sidecar: s.Sidecar}
	if h.Materials == nil {
		h.Materials = []Material{}
	}
	for _, b := range s.Bones {
		h.Bones = append(h.Bones, boneJSON{Name: b.Name, Parent: b.Parent, BindGlobal: b.BindGlobal[:]})
	}
	for _, m := range s.Meshes {
		mj := meshJSON{
			Name: m.Name, Positions: f32(m.Positions), Normals: f32(m.Normals), UVs: f32(m.UVs), Indices: u32(m.Indices),
			Materials: m.Materials, Joints: u16(m.Joints), Weights: f32(m.Weights),
		}
		if m.TriangleMaterial != nil {
			r := u32(m.TriangleMaterial)
			mj.TriangleMaterial = &r
		}
		for _, sh := range m.Shapes {
			sj := shapeJSON{Name: sh.Name, Indices: u32(sh.Indices), Deltas: f32(sh.Deltas)}
			if sh.NormalDeltas != nil {
				r := f32(sh.NormalDeltas)
				sj.NormalDeltas = &r
			}
			mj.Shapes = append(mj.Shapes, sj)
		}
		h.Meshes = append(h.Meshes, mj)
	}
	for _, t := range s.Textures {
		h.Textures = append(h.Textures, textureJSON{File: t.File, Data: add("u8", t.Data)})
	}
	if s.GLB != nil {
		r := add("u8", s.GLB)
		h.GLB = &r
	}
	hj, err := json.Marshal(h)
	if err != nil {
		return nil, err
	}
	out := make([]byte, 12, 12+len(hj)+8+len(data))
	copy(out, Magic)
	binary.LittleEndian.PutUint32(out[8:], uint32(len(hj)))
	out = append(out, hj...)
	for len(out)%8 != 0 {
		out = append(out, 0)
	}
	return append(out, data...), nil
}
