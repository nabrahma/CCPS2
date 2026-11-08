//go:build ufbx

package fbx

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/ps2cc/ps2cc/app/backend/exportscene"
	"github.com/ps2cc/ps2cc/app/backend/fbx/ufbx"
)

// Tolerances from PRD 6.3: positions 1e-5 m, weights 1e-6.
const (
	posTol    = 1e-5
	weightTol = 1e-6
	matTol    = 1e-5
)

// checkRoundTrip loads the written file with ufbx and compares it with the scene.
func checkRoundTrip(s *exportscene.Scene, file []byte) error {
	u, err := ufbx.Load(file)
	if err != nil {
		return err
	}
	if len(u.Warnings) > 0 {
		return fmt.Errorf("ufbx warnings: %v", u.Warnings)
	}
	if math.Abs(u.UnitMeters-1) > 1e-12 {
		return fmt.Errorf("unit is %v m, want 1", u.UnitMeters)
	}
	if u.Axes != [3]int{ufbx.AxisPositiveX, ufbx.AxisPositiveY, ufbx.AxisPositiveZ} {
		return fmt.Errorf("axes %v, want +X right, +Y up, +Z front", u.Axes)
	}
	byName := map[string]int{}
	for i, n := range u.Nodes {
		byName[n.Name] = i
	}
	// Skeleton: names, hierarchy and bind matrices.
	for _, b := range s.Bones {
		i, ok := byName[b.Name]
		if !ok {
			return fmt.Errorf("bone %s missing", b.Name)
		}
		n := u.Nodes[i]
		if !n.IsBone {
			return fmt.Errorf("node %s is not a bone", b.Name)
		}
		wantParent := ""
		if b.Parent >= 0 {
			wantParent = s.Bones[b.Parent].Name
		}
		gotParent := ""
		if n.Parent >= 0 && n.Parent < len(u.Nodes) {
			gotParent = u.Nodes[n.Parent].Name
		}
		if gotParent != wantParent && !(wantParent == "" && gotParent == "") {
			return fmt.Errorf("bone %s: parent %q, want %q", b.Name, gotParent, wantParent)
		}
		if d := maxDiff(n.World[:], b.BindGlobal[:]); d > matTol {
			return fmt.Errorf("bone %s: world matrix off by %g", b.Name, d)
		}
	}
	// Meshes.
	for mi := range s.Meshes {
		m := &s.Meshes[mi]
		i, ok := byName[m.Name]
		if !ok || u.Nodes[i].Mesh < 0 {
			return fmt.Errorf("mesh %s missing", m.Name)
		}
		um := u.Meshes[u.Nodes[i].Mesh]
		if len(um.Vertices) != len(m.Positions) {
			return fmt.Errorf("%s: %d vertices, want %d", m.Name, len(um.Vertices)/3, len(m.Positions)/3)
		}
		if d := maxDiff32(um.Vertices, m.Positions); d > posTol {
			return fmt.Errorf("%s: positions off by %g", m.Name, d)
		}
		if !um.AllTriangles || len(um.Indices) != len(m.Indices) {
			return fmt.Errorf("%s: %d corners (triangles %v), want %d", m.Name, len(um.Indices), um.AllTriangles, len(m.Indices))
		}
		for k, v := range m.Indices {
			if um.Indices[k] != v {
				return fmt.Errorf("%s: corner %d is vertex %d, want %d", m.Name, k, um.Indices[k], v)
			}
		}
		if len(um.Normals) != len(m.Indices)*3 || len(um.UVs) != len(m.Indices)*2 {
			return fmt.Errorf("%s: normals or UVs missing", m.Name)
		}
		for k, v := range m.Indices {
			for c := 0; c < 3; c++ {
				if math.Abs(um.Normals[k*3+c]-float64(m.Normals[v*3+uint32(c)])) > posTol {
					return fmt.Errorf("%s: normal of corner %d differs", m.Name, k)
				}
			}
			for c := 0; c < 2; c++ {
				if math.Abs(um.UVs[k*2+c]-float64(m.UVs[v*2+uint32(c)])) > posTol {
					return fmt.Errorf("%s: UV of corner %d differs", m.Name, k)
				}
			}
		}
		// Materials and textures, slot by slot.
		if len(um.Materials) != len(m.Materials) {
			return fmt.Errorf("%s: %d materials, want %d", m.Name, len(um.Materials), len(m.Materials))
		}
		for k, slot := range m.Materials {
			mat := s.Materials[slot]
			if um.Materials[k] != mat.Name || filepath.ToSlash(um.Textures[k]) != mat.Texture {
				return fmt.Errorf("%s: slot %d is %s/%s, want %s/%s", m.Name, k, um.Materials[k], um.Textures[k], mat.Name, mat.Texture)
			}
		}
		for t := 0; t < m.TriangleCount(); t++ {
			want := uint32(0)
			if m.TriangleMaterial != nil {
				want = m.TriangleMaterial[t]
			}
			if um.FaceMaterials[t] != want {
				return fmt.Errorf("%s: triangle %d has material %d, want %d", m.Name, t, um.FaceMaterials[t], want)
			}
		}
		// Weights per vertex and bone, and bind matrices.
		want := map[[2]int]float64{}
		for v := 0; v < m.VertexCount(); v++ {
			for k := 0; k < exportscene.MaxInfluences; k++ {
				if w := m.Weights[v*exportscene.MaxInfluences+k]; w > 0 {
					want[[2]int{v, int(m.Joints[v*exportscene.MaxInfluences+k])}] += float64(w)
				}
			}
		}
		boneIdx := map[string]int{}
		for bi, b := range s.Bones {
			boneIdx[b.Name] = bi
		}
		got := map[[2]int]float64{}
		for _, cl := range um.Clusters {
			bi, ok := boneIdx[cl.Bone]
			if !ok {
				return fmt.Errorf("%s: cluster for unknown bone %q", m.Name, cl.Bone)
			}
			if d := maxDiff(cl.Bind[:], s.Bones[bi].BindGlobal[:]); d > matTol {
				return fmt.Errorf("%s: bind matrix of %s off by %g", m.Name, cl.Bone, d)
			}
			for k, v := range cl.Verts {
				got[[2]int{int(v), bi}] += cl.Weights[k]
			}
		}
		if len(got) != len(want) {
			return fmt.Errorf("%s: %d weights, want %d", m.Name, len(got), len(want))
		}
		for key, w := range want {
			if math.Abs(got[key]-w) > weightTol {
				return fmt.Errorf("%s: weight of vertex %d bone %d is %v, want %v", m.Name, key[0], key[1], got[key], w)
			}
		}
		// Blendshapes: names, indices and deltas.
		if len(um.Shapes) != len(m.Shapes) {
			return fmt.Errorf("%s: %d blendshapes, want %d", m.Name, len(um.Shapes), len(m.Shapes))
		}
		for k, sh := range m.Shapes {
			us := um.Shapes[k]
			if us.Name != sh.Name || len(us.Indices) != len(sh.Indices) {
				return fmt.Errorf("%s: blendshape %d is %s with %d offsets, want %s with %d", m.Name, k, us.Name, len(us.Indices), sh.Name, len(sh.Indices))
			}
			for j, idx := range sh.Indices {
				if us.Indices[j] != idx {
					return fmt.Errorf("%s/%s: offset %d is vertex %d, want %d", m.Name, sh.Name, j, us.Indices[j], idx)
				}
			}
			if d := maxDiff32(us.Deltas, sh.Deltas); d > posTol {
				return fmt.Errorf("%s/%s: deltas off by %g", m.Name, sh.Name, d)
			}
			if sh.NormalDeltas != nil {
				if d := maxDiff32(us.Normals, sh.NormalDeltas); d > posTol {
					return fmt.Errorf("%s/%s: normal deltas off by %g", m.Name, sh.Name, d)
				}
			}
		}
	}
	return nil
}

// Property test (PRD 6.3 writer rules): random meshes, skeletons and
// blendshapes always give files ufbx loads without errors or warnings, and
// every round-trip check passes.
func TestRoundTripRandomScenes(t *testing.T) {
	n := int64(300)
	if testing.Short() {
		n = 40
	}
	for seed := int64(0); seed < n; seed++ {
		s := randomScene(seed)
		out, err := Write(s)
		if err != nil {
			t.Fatalf("seed %d: write: %v", seed, err)
		}
		if err := checkRoundTrip(s, out); err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
	}
}

// The exported test characters (PRD M7: "ufbx loads 10 exported test
// characters with no errors or warnings and every round-trip check passes").
// They are written by `pnpm export:testchars` (app/frontend/e2e/tools).
func TestExportedCharacters(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join("testdata", "characters", "*.ps2exp"))
	sort.Strings(files)
	if len(files) < 10 {
		t.Fatalf("need 10 exported test characters in testdata/characters, found %d (run pnpm export:testchars)", len(files))
	}
	for _, f := range files {
		name := strings.TrimSuffix(filepath.Base(f), ".ps2exp")
		t.Run(name, func(t *testing.T) {
			msg, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			s, err := exportscene.Decode(msg)
			if err != nil {
				t.Fatal(err)
			}
			out, err := Write(s)
			if err != nil {
				t.Fatal(err)
			}
			if err := checkRoundTrip(s, out); err != nil {
				t.Fatal(err)
			}
			tris := 0
			shapes := 0
			for _, m := range s.Meshes {
				tris += m.TriangleCount()
				shapes += len(m.Shapes)
				// M8: the head carries the full default expression set (15 blendshapes).
				if strings.HasSuffix(m.Name, "_Head") && len(m.Shapes) != 15 {
					t.Errorf("%s: %d blendshapes, want the 15 defaults", m.Name, len(m.Shapes))
				}
			}
			t.Logf("%s: %d bones, %d meshes, %d triangles, %d blendshapes, %d bytes", s.Name, len(s.Bones), len(s.Meshes), tris, shapes, len(out))
		})
	}
}

// Fuzz test of the writer's inputs (PRD 6.3): any message either fails to
// decode, or decodes into a scene whose FBX ufbx loads and round-trips.
func FuzzExportMessage(f *testing.F) {
	for seed := int64(0); seed < 8; seed++ {
		msg, err := exportscene.Encode(randomScene(seed))
		if err != nil {
			f.Fatal(err)
		}
		f.Add(msg)
	}
	f.Fuzz(func(t *testing.T, msg []byte) {
		s, err := exportscene.Decode(msg)
		if err != nil {
			return
		}
		out, err := Write(s)
		if err != nil {
			t.Fatalf("write: %v", err)
		}
		if err := checkRoundTrip(s, out); err != nil {
			t.Fatal(err)
		}
	})
}

func maxDiff(a, b []float64) float64 {
	d := 0.0
	for i := range a {
		d = math.Max(d, math.Abs(a[i]-b[i]))
	}
	return d
}

func maxDiff32(a []float64, b []float32) float64 {
	if len(a) != len(b) {
		return math.Inf(1)
	}
	d := 0.0
	for i := range a {
		d = math.Max(d, math.Abs(a[i]-float64(b[i])))
	}
	return d
}
