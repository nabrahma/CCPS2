package exportscene

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func validScene() *Scene {
	png := []byte("\x89PNG\r\n\x1a\nrest")
	return &Scene{
		Name:         "Bob",
		CreationTime: "2026-11-08 12:00:00:000",
		Bones: []Bone{
			{Name: "Root", Parent: -1, BindGlobal: [16]float64{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}},
			{Name: "pelvis", Parent: 0, BindGlobal: [16]float64{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1}},
		},
		Materials: []Material{{Name: "Bob_Body", Shader: "PS2/Skin", Texture: "Textures/Bob_Body_D.png", Role: "body"}},
		Textures:  []Texture{{File: "Textures/Bob_Body_D.png", Data: png}},
		Meshes: []Mesh{{
			Name:      "Bob_Body",
			Positions: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0},
			Normals:   []float32{0, 0, 1, 0, 0, 1, 0, 0, 1},
			UVs:       []float32{0, 0, 1, 0, 0, 1},
			Indices:   []uint32{0, 1, 2},
			Materials: []int{0},
			Joints:    []uint16{0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0},
			Weights:   []float32{1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0},
		}},
		Sidecar: json.RawMessage(`{"format":"ps2cc.sidecar/1"}`),
	}
}

func TestEncodeDecode(t *testing.T) {
	msg, err := Encode(validScene())
	if err != nil {
		t.Fatal(err)
	}
	s, err := Decode(msg)
	if err != nil {
		t.Fatal(err)
	}
	if s.Name != "Bob" || len(s.Bones) != 2 || s.Meshes[0].TriangleCount() != 1 || !bytes.Equal(s.Textures[0].Data, validScene().Textures[0].Data) {
		t.Fatalf("decoded scene differs: %+v", s)
	}
}

// Every invalid input is rejected with an error (never a panic, never written).
func TestDecodeRejects(t *testing.T) {
	cases := map[string]func(s *Scene){
		"path traversal in texture": func(s *Scene) {
			s.Textures[0].File = "Textures/../../evil.png"
			s.Materials[0].Texture = s.Textures[0].File
		},
		"absolute texture path": func(s *Scene) {
			s.Textures[0].File = "C:/Windows/evil.png"
			s.Materials[0].Texture = s.Textures[0].File
		},
		"name with path":        func(s *Scene) { s.Name = "../Bob" },
		"index out of range":    func(s *Scene) { s.Meshes[0].Indices[2] = 9 },
		"NaN position":          func(s *Scene) { s.Meshes[0].Positions[0] = float32(math.NaN()) },
		"weights do not sum":    func(s *Scene) { s.Meshes[0].Weights[0] = 0.5 },
		"bone out of range":     func(s *Scene) { s.Meshes[0].Joints[0] = 7 },
		"parent after child":    func(s *Scene) { s.Bones[0].Parent = 1 },
		"sheared bone":          func(s *Scene) { s.Bones[1].BindGlobal[4] = 0.5 },
		"duplicate bone":        func(s *Scene) { s.Bones[1].Name = "Root" },
		"not a PNG":             func(s *Scene) { s.Textures[0].Data = []byte("GIF89a....") },
		"missing texture":       func(s *Scene) { s.Materials[0].Texture = "Textures/Other.png" },
		"material out of range": func(s *Scene) { s.Meshes[0].Materials = []int{3} },
		"bad shape order": func(s *Scene) {
			s.Meshes[0].Shapes = []Shape{{Name: "blink", Indices: []uint32{2, 1}, Deltas: make([]float32, 6)}}
		},
		"bad time": func(s *Scene) { s.CreationTime = "yesterday" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			s := validScene()
			mutate(s)
			msg, err := Encode(s)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Decode(msg); err == nil {
				t.Fatal("accepted")
			}
		})
	}
	for name, msg := range map[string][]byte{
		"empty":     nil,
		"magic":     []byte("NOTPS2CC\x00\x00\x00\x00"),
		"truncated": []byte("PS2CCEX1\xff\x00\x00\x00{}"),
		"unknown field": func() []byte {
			m, _ := Encode(validScene())
			return bytes.Replace(m, []byte(`"format"`), []byte(`"formatX"`), 1)
		}(),
	} {
		if _, err := Decode(msg); err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
}

func TestMessageIsCompact(t *testing.T) {
	msg, _ := Encode(validScene())
	if !strings.HasPrefix(string(msg), Magic) || len(msg) > 4096 {
		t.Fatalf("unexpected message size %d", len(msg))
	}
}
