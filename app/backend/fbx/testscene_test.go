package fbx

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"math/rand"

	"github.com/ps2cc/ps2cc/app/backend/exportscene"
)

// randomScene builds a valid export scene from a seed: a random bone tree with
// rigid transforms, meshes with random triangles, normalised 1..4-bone
// weights, several material slots and sparse blendshapes.
func randomScene(seed int64) *exportscene.Scene {
	r := rand.New(rand.NewSource(seed))
	s := &exportscene.Scene{Name: fmt.Sprintf("Char_%d", seed), CreationTime: "2026-11-08 12:00:00:000", Sidecar: []byte(`{"format":"ps2cc.sidecar/1"}`)}
	nb := 1 + r.Intn(60)
	for i := 0; i < nb; i++ {
		parent := -1
		if i > 0 {
			parent = r.Intn(i)
		}
		local := rigid(r)
		g := local
		if parent >= 0 {
			g = mul4(s.Bones[parent].BindGlobal, local)
		}
		s.Bones = append(s.Bones, exportscene.Bone{Name: fmt.Sprintf("bone_%02d", i), Parent: parent, BindGlobal: g})
	}
	nmat := 1 + r.Intn(5)
	for i := 0; i < nmat; i++ {
		m := exportscene.Material{Name: fmt.Sprintf("Mat%d", i), Shader: "PS2/Skin", AlphaClip: r.Float64(), DoubleSided: r.Intn(2) == 0, Role: "body"}
		if r.Intn(3) > 0 {
			m.Texture = fmt.Sprintf("Textures/Tex_%d.png", i)
			s.Textures = append(s.Textures, exportscene.Texture{File: m.Texture, Data: tinyPNG(r)})
		}
		s.Materials = append(s.Materials, m)
	}
	nm := 1 + r.Intn(5)
	for mi := 0; mi < nm; mi++ {
		nv := 3 + r.Intn(300)
		m := exportscene.Mesh{Name: fmt.Sprintf("Mesh%d", mi)}
		for v := 0; v < nv; v++ {
			m.Positions = append(m.Positions, float32(r.NormFloat64()), float32(r.NormFloat64()+1), float32(r.NormFloat64()))
			n := [3]float64{r.NormFloat64(), r.NormFloat64(), r.NormFloat64()}
			l := math.Sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) + 1e-9
			m.Normals = append(m.Normals, float32(n[0]/l), float32(n[1]/l), float32(n[2]/l))
			m.UVs = append(m.UVs, float32(r.Float64()), float32(r.Float64()))
			k := 1 + r.Intn(exportscene.MaxInfluences)
			if k > nb {
				k = nb
			}
			perm := r.Perm(nb)[:k]
			ws := make([]float64, k)
			sum := 0.0
			for i := range ws {
				ws[i] = 0.05 + r.Float64()
				sum += ws[i]
			}
			for i := 0; i < exportscene.MaxInfluences; i++ {
				if i < k {
					m.Joints = append(m.Joints, uint16(perm[i]))
					m.Weights = append(m.Weights, float32(ws[i]/sum))
				} else {
					m.Joints = append(m.Joints, 0)
					m.Weights = append(m.Weights, 0)
				}
			}
		}
		nt := 1 + r.Intn(400)
		for t := 0; t < nt; t++ {
			a, b, c := r.Intn(nv), r.Intn(nv), r.Intn(nv)
			m.Indices = append(m.Indices, uint32(a), uint32(b), uint32(c))
		}
		slots := 1 + r.Intn(nmat)
		for k := 0; k < slots; k++ {
			m.Materials = append(m.Materials, r.Intn(nmat))
		}
		if slots > 1 {
			for t := 0; t < nt; t++ {
				m.TriangleMaterial = append(m.TriangleMaterial, uint32(r.Intn(slots)))
			}
		}
		for k := 0; k < r.Intn(4); k++ {
			sh := exportscene.Shape{Name: fmt.Sprintf("shape_%d", k)}
			for v := 0; v < nv; v++ {
				if r.Intn(3) == 0 {
					sh.Indices = append(sh.Indices, uint32(v))
					sh.Deltas = append(sh.Deltas, float32(r.NormFloat64()*0.01), float32(r.NormFloat64()*0.01), float32(r.NormFloat64()*0.01))
					sh.NormalDeltas = append(sh.NormalDeltas, float32(r.NormFloat64()*0.1), float32(r.NormFloat64()*0.1), float32(r.NormFloat64()*0.1))
				}
			}
			if len(sh.Indices) == 0 {
				sh.Indices = []uint32{0}
				sh.Deltas = []float32{0.01, 0, 0}
				sh.NormalDeltas = []float32{0, 0, 0}
			}
			m.Shapes = append(m.Shapes, sh)
		}
		s.Meshes = append(s.Meshes, m)
	}
	return s
}

// rigid is a random rotation (any orientation, including near gimbal lock) plus a translation.
func rigid(r *rand.Rand) [16]float64 {
	// Random unit quaternion.
	q := [4]float64{r.NormFloat64(), r.NormFloat64(), r.NormFloat64(), r.NormFloat64()}
	if r.Intn(10) == 0 {
		// Exactly 90 degrees about Y: the gimbal-lock case of the Euler decomposition.
		q = [4]float64{0, math.Sqrt2 / 2, 0, math.Sqrt2 / 2}
	}
	l := math.Sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3])
	x, y, z, w := q[0]/l, q[1]/l, q[2]/l, q[3]/l
	return [16]float64{
		1 - 2*(y*y+z*z), 2 * (x*y + z*w), 2 * (x*z - y*w), 0,
		2 * (x*y - z*w), 1 - 2*(x*x+z*z), 2 * (y*z + x*w), 0,
		2 * (x*z + y*w), 2 * (y*z - x*w), 1 - 2*(x*x+y*y), 0,
		r.NormFloat64() * 0.3, r.NormFloat64() * 0.3, r.NormFloat64() * 0.3, 1,
	}
}

func tinyPNG(r *rand.Rand) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{uint8(r.Intn(256)), 0, 0, 255})
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}
