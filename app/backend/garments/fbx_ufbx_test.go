//go:build ufbx

package garments

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ps2cc/ps2cc/app/backend/exportscene"
	"github.com/ps2cc/ps2cc/app/backend/fbx"
)

// A character written by PS2CC's own FBX writer reads back, through ufbx's unit
// and axis conversion, in the metres and Y-up of the scene it was made from.
func TestFBXReadsBackInMetresYUp(t *testing.T) {
	msg, err := os.ReadFile(filepath.Join("..", "fbx", "testdata", "characters", "01_Default_Male.ps2exp"))
	if err != nil {
		t.Skip("no test character")
	}
	scene, err := exportscene.Decode(msg)
	if err != nil {
		t.Fatal(err)
	}
	data, err := fbx.Write(scene)
	if err != nil {
		t.Fatal(err)
	}
	m, err := Parse(".fbx", data)
	if err != nil {
		t.Fatal(err)
	}
	vertices := 0
	lo, hi := math.Inf(1), math.Inf(-1)
	for i := range scene.Meshes {
		vertices += len(scene.Meshes[i].Positions) / 3
		for v := 1; v < len(scene.Meshes[i].Positions); v += 3 {
			y := float64(scene.Meshes[i].Positions[v])
			lo, hi = math.Min(lo, y), math.Max(hi, y)
		}
	}
	if len(m.Positions)/3 != vertices {
		t.Errorf("vertices: %d, scene has %d", len(m.Positions)/3, vertices)
	}
	mlo, mhi := math.Inf(1), math.Inf(-1)
	for v := 1; v < len(m.Positions); v += 3 {
		y := float64(m.Positions[v])
		mlo, mhi = math.Min(mlo, y), math.Max(mhi, y)
	}
	if math.Abs(mlo-lo) > 1e-3 || math.Abs(mhi-hi) > 1e-3 {
		t.Errorf("height range [%v, %v], scene [%v, %v]", mlo, mhi, lo, hi)
	}
	if !m.HasUVs || m.Triangles() == 0 {
		t.Errorf("hasUVs %v, triangles %d", m.HasUVs, m.Triangles())
	}
}

func TestFBXGarbageGivesAnError(t *testing.T) {
	if _, err := Parse(".fbx", []byte("this is not an fbx file")); err == nil || !strings.Contains(err.Error(), "could not be read") {
		t.Errorf("got %v", err)
	}
}
