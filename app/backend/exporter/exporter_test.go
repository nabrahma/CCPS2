package exporter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ps2cc/ps2cc/app/backend/exportscene"
)

func scene() *exportscene.Scene {
	return &exportscene.Scene{
		Name:         "Bob",
		CreationTime: "2026-11-08 12:00:00:000",
		Bones:        []exportscene.Bone{{Name: "Root", Parent: -1, BindGlobal: [16]float64{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}}},
		Materials:    []exportscene.Material{{Name: "Bob_Body", Shader: "PS2/Skin", Texture: "Textures/Bob_Body_D.png", Role: "body"}},
		Textures:     []exportscene.Texture{{File: "Textures/Bob_Body_D.png", Data: []byte("\x89PNG\r\n\x1a\nx")}},
		Meshes: []exportscene.Mesh{{
			Name: "Bob_Body", Positions: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Normals: []float32{0, 0, 1, 0, 0, 1, 0, 0, 1},
			UVs: []float32{0, 0, 1, 0, 0, 1}, Indices: []uint32{0, 1, 2}, Materials: []int{0},
			Joints: make([]uint16, 12), Weights: []float32{1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0},
		}},
		Sidecar: json.RawMessage(`{"format":"ps2cc.sidecar/1","name":"Bob"}`),
		GLB:     []byte("glTF\x02\x00\x00\x00rest"),
	}
}

func TestWriteExport(t *testing.T) {
	dir := t.TempDir()
	res, err := Write(scene(), UnityTarget(dir))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Bob.fbx", "Bob.ps2cc.json", "Bob.glb", filepath.Join("Textures", "Bob_Body_D.png")}
	for _, f := range want {
		if _, err := os.Stat(filepath.Join(dir, "Assets", "PS2CC", "Bob", f)); err != nil {
			t.Errorf("%s missing: %v", f, err)
		}
	}
	if len(res.Files) != len(want) {
		t.Errorf("wrote %d files, want %d", len(res.Files), len(want))
	}
	// No temporary files left behind, and the sidecar is pretty-printed JSON.
	_ = filepath.Walk(dir, func(p string, _ os.FileInfo, _ error) error {
		if strings.HasSuffix(p, ".ps2cc-tmp") {
			t.Errorf("temporary file left: %s", p)
		}
		return nil
	})
	b, _ := os.ReadFile(filepath.Join(res.Dir, "Bob.ps2cc.json"))
	if !json.Valid(b) || !strings.Contains(string(b), "\n  \"name\"") {
		t.Errorf("sidecar not pretty JSON: %s", b)
	}
	// Exporting again replaces the files in place.
	if _, err := Write(scene(), UnityTarget(dir)); err != nil {
		t.Fatal(err)
	}
}

func TestWriteNeedsTarget(t *testing.T) {
	if _, err := Write(scene(), ""); err == nil {
		t.Fatal("empty target accepted")
	}
}
