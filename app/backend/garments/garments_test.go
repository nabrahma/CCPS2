package garments

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOBJFacesAndIndices(t *testing.T) {
	m, err := Parse(".OBJ", []byte(`# a quad, a triangle with relative indices, and a pentagon
o test
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 2 0 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
f 1/1 2/2 3/3 4/4
f -3/-2 -2/-1 -1/-4
f 1 2 3 4 5
`))
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Positions) != 15 {
		t.Fatalf("positions %d", len(m.Positions))
	}
	if !m.HasUVs {
		t.Error("HasUVs")
	}
	// Quad (4), triangle (4), pentagon as three triangles (12).
	if len(m.FaceVerts) != 20 || len(m.FaceUVs) != 20 {
		t.Fatalf("faces %d %d", len(m.FaceVerts), len(m.FaceUVs))
	}
	if got := m.FaceVerts[4:8]; got[0] != 2 || got[1] != 3 || got[2] != 4 || got[3] != 4 {
		t.Errorf("relative indices: %v", got)
	}
	if m.Triangles() != 2+1+3 {
		t.Errorf("triangles %d", m.Triangles())
	}
}

func TestOBJWithoutUVsIsFlagged(t *testing.T) {
	m, err := Parse(".obj", []byte("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"))
	if err != nil {
		t.Fatal(err)
	}
	if m.HasUVs {
		t.Error("no vt lines, yet HasUVs")
	}
	if len(m.UVs) != 2 {
		t.Errorf("uvs %v", m.UVs)
	}
}

func TestBadFilesGiveErrors(t *testing.T) {
	cases := map[string]struct {
		ext  string
		data string
		want string
	}{
		"index":    {".obj", "v 0 0 0\nf 1 2 3\n", "out of range"},
		"nan":      {".obj", "v nan 0 0\n", "invalid vertex position"},
		"short":    {".obj", "v 0 0\n", "needs x, y and z"},
		"no faces": {".obj", "v 0 0 0\n", "no mesh faces"},
		"type":     {".blend", "x", "unsupported"},
		"glb":      {".glb", "not a glb at all, sorry", "not a GLB"},
	}
	for name, c := range cases {
		if _, err := Parse(c.ext, []byte(c.data)); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v, want %q", name, err, c.want)
		}
	}
}

// glbFile packs a glTF document and its binary chunk.
func glbFile(t *testing.T, doc any, bin []byte) []byte {
	t.Helper()
	js, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	for len(bin)%4 != 0 {
		bin = append(bin, 0)
	}
	out := binary.LittleEndian.AppendUint32(nil, glbMagic)
	out = binary.LittleEndian.AppendUint32(out, 2)
	out = binary.LittleEndian.AppendUint32(out, uint32(12+8+len(js)+8+len(bin)))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(js)))
	out = binary.LittleEndian.AppendUint32(out, chunkJSON)
	out = append(out, js...)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(bin)))
	out = binary.LittleEndian.AppendUint32(out, chunkBIN)
	return append(out, bin...)
}

func floats(v ...float32) []byte {
	var out []byte
	for _, f := range v {
		out = binary.LittleEndian.AppendUint32(out, math.Float32bits(f))
	}
	return out
}

// oneTriangle is a GLB with one indexed triangle under the given node.
func oneTriangle(t *testing.T, node map[string]any) []byte {
	t.Helper()
	bin := floats(0, 0, 0, 1, 0, 0, 0, 1, 0) // 36 bytes
	bin = append(bin, floats(0, 0, 1, 0, 0, 0.25)...)
	bin = append(bin, 0, 0, 1, 0, 2, 0)
	node["mesh"] = 0
	return glbFile(t, map[string]any{
		"scenes": []any{map[string]any{"nodes": []int{0}}},
		"nodes":  []any{node},
		"meshes": []any{map[string]any{"primitives": []any{map[string]any{"attributes": map[string]int{"POSITION": 0, "TEXCOORD_0": 1}, "indices": 2}}}},
		"accessors": []any{
			map[string]any{"bufferView": 0, "componentType": gltfFloat, "count": 3, "type": "VEC3"},
			map[string]any{"bufferView": 1, "componentType": gltfFloat, "count": 3, "type": "VEC2"},
			map[string]any{"bufferView": 2, "componentType": gltfUShort, "count": 3, "type": "SCALAR"},
		},
		"bufferViews": []any{
			map[string]any{"buffer": 0, "byteOffset": 0, "byteLength": 36},
			map[string]any{"buffer": 0, "byteOffset": 36, "byteLength": 24},
			map[string]any{"buffer": 0, "byteOffset": 60, "byteLength": 6},
		},
	}, bin)
}

func TestGLBAppliesNodeTransformsAndFlipsV(t *testing.T) {
	m, err := Parse(".glb", oneTriangle(t, map[string]any{"translation": []float64{0, 2, 0}, "scale": []float64{2, 2, 2}}))
	if err != nil {
		t.Fatal(err)
	}
	if m.Positions[3] != 2 || m.Positions[4] != 2 || m.Positions[7] != 4 {
		t.Errorf("positions %v", m.Positions)
	}
	if !m.HasUVs || len(m.FaceVerts) != 4 {
		t.Fatalf("faces %v", m.FaceVerts)
	}
	// V = 0.25 in glTF is 0.75 here.
	third := m.FaceUVs[2]
	if m.UVs[third*2+1] != 0.75 {
		t.Errorf("v %v", m.UVs[third*2+1])
	}
}

func TestGLBMirroredNodeKeepsFacesOutward(t *testing.T) {
	m, err := Parse(".glb", oneTriangle(t, map[string]any{"scale": []float64{-1, 1, 1}}))
	if err != nil {
		t.Fatal(err)
	}
	if m.FaceVerts[1] != 2 || m.FaceVerts[2] != 1 {
		t.Errorf("winding not reversed: %v", m.FaceVerts)
	}
}

func TestGLBRejectsOutOfBoundsAccessors(t *testing.T) {
	base := oneTriangle(t, map[string]any{})
	jsonLen := binary.LittleEndian.Uint32(base[12:])
	var doc map[string]any
	if err := json.Unmarshal(base[20:20+jsonLen], &doc); err != nil {
		t.Fatal(err)
	}
	bin := base[20+jsonLen+8:]
	doc["accessors"].([]any)[0].(map[string]any)["count"] = 1000000
	if _, err := Parse(".glb", glbFile(t, doc, append([]byte{}, bin...))); err == nil || !strings.Contains(err.Error(), "invalid buffer accessor") {
		t.Errorf("count: got %v", err)
	}
	doc["accessors"].([]any)[0].(map[string]any)["count"] = 3
	doc["accessors"].([]any)[2].(map[string]any)["bufferView"] = 99
	if _, err := Parse(".glb", glbFile(t, doc, append([]byte{}, bin...))); err == nil || !strings.Contains(err.Error(), "invalid buffer accessor") {
		t.Errorf("view: got %v", err)
	}
	// A cycle in the node hierarchy must not hang.
	doc["accessors"].([]any)[2].(map[string]any)["bufferView"] = 2
	doc["nodes"].([]any)[0].(map[string]any)["children"] = []int{0}
	if _, err := Parse(".glb", glbFile(t, doc, append([]byte{}, bin...))); err == nil || !strings.Contains(err.Error(), "hierarchy") {
		t.Errorf("cycle: got %v", err)
	}
}

// Truncating a valid file anywhere gives an error or a mesh, never a panic.
func TestGLBTruncation(t *testing.T) {
	data := oneTriangle(t, map[string]any{})
	for n := 0; n < len(data); n++ {
		_, _ = Parse(".glb", data[:n])
	}
}

func FuzzParse(f *testing.F) {
	f.Add(".obj", []byte("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"))
	f.Add(".glb", []byte("glTF"))
	f.Fuzz(func(t *testing.T, ext string, data []byte) {
		if ext == ".fbx" {
			return // ufbx has its own fuzzing; the cgo call is covered by TestFBX
		}
		m, err := Parse(ext, data)
		if err != nil {
			return
		}
		for _, v := range m.FaceVerts {
			if int(v) >= len(m.Positions)/3 {
				t.Fatalf("index %d of %d vertices", v, len(m.Positions)/3)
			}
		}
		for _, v := range m.FaceUVs {
			if int(v) >= len(m.UVs)/2 {
				t.Fatalf("uv index %d of %d", v, len(m.UVs)/2)
			}
		}
	})
}

// The test garments written by packages/core/test/garment-import.test.ts.
func TestReadsFixtureGarment(t *testing.T) {
	path := filepath.Join("..", "..", "..", "tests", "fixtures", "garments", "test_skirt.obj")
	if _, err := os.Stat(path); err != nil {
		t.Skip("fixture not generated yet")
	}
	m, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if !m.HasUVs || m.Triangles() < 1000 {
		t.Errorf("hasUVs %v, triangles %d", m.HasUVs, m.Triangles())
	}
}
