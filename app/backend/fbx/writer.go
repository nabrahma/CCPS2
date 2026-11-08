package fbx

import (
	"math"
	"path"
	"strconv"
	"strings"

	"github.com/ps2cc/ps2cc/app/backend/exportscene"
)

// footerTime is the CreationTime that matches the fixed FileId and footer id (Blender's _TIME_ID).
const footerTime = "1970-01-01 10:00:00:000"

// Creator is written in the FBX header.
const Creator = "PS2CC FBX writer (binary FBX 7.4, after Blender io_scene_fbx)"

// Write builds the FBX for a decoded export scene. The output depends only on
// the scene (object ids are assigned in a fixed order, arrays are compressed
// with a fixed zlib level), so the same character gives the same bytes apart
// from the creation time stamp.
func Write(s *exportscene.Scene) ([]byte, error) {
	w := &graph{scene: s, nextID: 1_000_000_000}
	if err := w.build(); err != nil {
		return nil, err
	}
	return Encode(w.top()), nil
}

type graph struct {
	scene   *exportscene.Scene
	nextID  int64
	objects *Node
	conns   *Node
	counts  map[string]int
	order   []string
}

func (g *graph) id() int64 {
	g.nextID++
	return g.nextID
}

func (g *graph) count(kind string) {
	if g.counts == nil {
		g.counts = map[string]int{}
	}
	if g.counts[kind] == 0 {
		g.order = append(g.order, kind)
	}
	g.counts[kind]++
}

// name in the binary convention "Name\x00\x01Class".
func fbxName(name, class string) string { return name + "\x00\x01" + class }

func (g *graph) oo(child, parent int64) { g.conns.Child("C", "OO", child, parent) }
func (g *graph) op(child, parent int64, prop string) {
	g.conns.Child("C", "OP", child, parent, prop)
}

// p adds a Properties70 entry: P: name, type, subtype, flags, values...
func p(props *Node, name, typ, sub, flags string, vals ...any) {
	n := props.Child("P", name, typ, sub, flags)
	for _, v := range vals {
		n.Add(v)
	}
}

func (g *graph) build() error {
	s := g.scene
	g.objects = NewNode("Objects")
	g.conns = NewNode("Connections")

	// Skeleton: LimbNode models with local rest transforms.
	boneIDs := make([]int64, len(s.Bones))
	for i, b := range s.Bones {
		attr := g.id()
		model := g.id()
		boneIDs[i] = model
		na := g.objects.Child("NodeAttribute", attr, fbxName(b.Name, "NodeAttribute"), "LimbNode")
		pp := na.Child("Properties70")
		p(pp, "Size", "double", "Number", "", 1.0)
		na.Child("TypeFlags", "Skeleton")
		g.count("NodeAttribute")

		local := b.BindGlobal
		if b.Parent >= 0 {
			local = mul4(invertAffine(s.Bones[b.Parent].BindGlobal), b.BindGlobal)
		}
		t, r, sc := decompose(local)
		m := g.objects.Child("Model", model, fbxName(b.Name, "Model"), "LimbNode")
		m.Child("Version", int32(232))
		mp := m.Child("Properties70")
		p(mp, "Lcl Translation", "Lcl Translation", "", "A", t[0], t[1], t[2])
		p(mp, "Lcl Rotation", "Lcl Rotation", "", "A", r[0], r[1], r[2])
		p(mp, "Lcl Scaling", "Lcl Scaling", "", "A", sc[0], sc[1], sc[2])
		p(mp, "RotationActive", "bool", "", "", int32(1))
		p(mp, "InheritType", "enum", "", "", int32(1))
		p(mp, "ScalingMax", "Vector3D", "Vector", "", 0.0, 0.0, 0.0)
		p(mp, "DefaultAttributeIndex", "int", "Integer", "", int32(0))
		m.Child("MultiLayer", int32(0))
		m.Child("MultiTake", int32(0))
		m.Child("Shading", true)
		m.Child("Culling", "CullingOff")
		g.count("Model")
		g.oo(attr, model)
		if b.Parent >= 0 {
			g.oo(model, boneIDs[b.Parent])
		} else {
			g.oo(model, 0)
		}
	}

	// Materials, textures and videos (once each).
	matIDs := make([]int64, len(s.Materials))
	texIDs := map[string]int64{}
	for i, mat := range s.Materials {
		id := g.id()
		matIDs[i] = id
		mn := g.objects.Child("Material", id, fbxName(mat.Name, "Material"), "")
		mn.Child("Version", int32(102))
		mn.Child("ShadingModel", "Lambert")
		mn.Child("MultiLayer", int32(0))
		mp := mn.Child("Properties70")
		p(mp, "DiffuseColor", "Color", "", "A", 1.0, 1.0, 1.0)
		p(mp, "DiffuseFactor", "Number", "", "A", 1.0)
		p(mp, "AmbientColor", "Color", "", "A", 0.0, 0.0, 0.0)
		p(mp, "Emissive", "Vector3D", "Vector", "", 0.0, 0.0, 0.0)
		p(mp, "Opacity", "double", "Number", "", 1.0)
		g.count("Material")
		if mat.Texture == "" {
			continue
		}
		tex, ok := texIDs[mat.Texture]
		if !ok {
			base := strings.TrimSuffix(path.Base(mat.Texture), path.Ext(mat.Texture))
			vid := g.id()
			tex = g.id()
			texIDs[mat.Texture] = tex
			v := g.objects.Child("Video", vid, fbxName(base, "Video"), "Clip")
			v.Child("Type", "Clip")
			vp := v.Child("Properties70")
			p(vp, "Path", "KString", "XRefUrl", "", mat.Texture)
			v.Child("UseMipMap", int32(0))
			v.Child("Filename", mat.Texture)
			v.Child("RelativeFilename", mat.Texture)
			g.count("Video")
			t := g.objects.Child("Texture", tex, fbxName(base, "Texture"), "")
			t.Child("Type", "TextureVideoClip")
			t.Child("Version", int32(202))
			t.Child("TextureName", fbxName(base, "Texture"))
			tp := t.Child("Properties70")
			p(tp, "UVSet", "KString", "", "", "UVMap")
			p(tp, "UseMaterial", "bool", "", "", int32(1))
			t.Child("Media", fbxName(base, "Video"))
			t.Child("FileName", mat.Texture)
			t.Child("RelativeFilename", mat.Texture)
			t.Child("ModelUVTranslation", 0.0, 0.0)
			t.Child("ModelUVScaling", 1.0, 1.0)
			t.Child("Texture_Alpha_Source", "None")
			t.Child("Cropping", int32(0), int32(0), int32(0), int32(0))
			g.count("Texture")
			g.oo(vid, tex)
		}
		g.op(tex, id, "DiffuseColor")
	}

	// Meshes.
	type poseEntry struct {
		node   int64
		matrix [16]float64
	}
	var pose []poseEntry
	for mi := range s.Meshes {
		m := &s.Meshes[mi]
		geom := g.id()
		model := g.id()
		g.writeGeometry(geom, m)
		mn := g.objects.Child("Model", model, fbxName(m.Name, "Model"), "Mesh")
		mn.Child("Version", int32(232))
		mp := mn.Child("Properties70")
		p(mp, "Lcl Translation", "Lcl Translation", "", "A", 0.0, 0.0, 0.0)
		p(mp, "Lcl Rotation", "Lcl Rotation", "", "A", 0.0, 0.0, 0.0)
		p(mp, "Lcl Scaling", "Lcl Scaling", "", "A", 1.0, 1.0, 1.0)
		p(mp, "DefaultAttributeIndex", "int", "Integer", "", int32(0))
		p(mp, "InheritType", "enum", "", "", int32(1))
		mn.Child("MultiLayer", int32(0))
		mn.Child("MultiTake", int32(0))
		mn.Child("Shading", true)
		mn.Child("Culling", "CullingOff")
		g.count("Model")
		g.oo(model, 0)
		g.oo(geom, model)
		for _, slot := range m.Materials {
			g.oo(matIDs[slot], model)
		}
		pose = append(pose, poseEntry{model, identity()})

		// Skin: one cluster per bone that has weights in this mesh.
		skin := g.id()
		sk := g.objects.Child("Deformer", skin, fbxName(m.Name, "Deformer"), "Skin")
		sk.Child("Version", int32(101))
		sk.Child("Link_DeformAcuracy", 50.0)
		g.count("Deformer")
		g.oo(skin, geom)
		perBone := make([][]int32, len(s.Bones))
		perWeight := make([][]float64, len(s.Bones))
		n := m.VertexCount()
		for v := 0; v < n; v++ {
			for k := 0; k < exportscene.MaxInfluences; k++ {
				w := m.Weights[v*exportscene.MaxInfluences+k]
				if w <= 0 {
					continue
				}
				b := m.Joints[v*exportscene.MaxInfluences+k]
				perBone[b] = append(perBone[b], int32(v))
				perWeight[b] = append(perWeight[b], float64(w))
			}
		}
		for b := range s.Bones {
			if len(perBone[b]) == 0 {
				continue
			}
			cl := g.id()
			c := g.objects.Child("Deformer", cl, fbxName(s.Bones[b].Name, "SubDeformer"), "Cluster")
			c.Child("Version", int32(100))
			c.Child("UserData", "", "")
			c.Child("Indexes", perBone[b])
			c.Child("Weights", perWeight[b])
			// Transform: mesh space to bone bind space (mesh global is identity); TransformLink: bone bind global.
			c.Child("Transform", toSlice(invertAffine(s.Bones[b].BindGlobal)))
			c.Child("TransformLink", toSlice(s.Bones[b].BindGlobal))
			g.count("Deformer")
			g.oo(cl, skin)
			g.oo(boneIDs[b], cl)
		}

		// Blendshapes.
		if len(m.Shapes) > 0 {
			bs := g.id()
			bn := g.objects.Child("Deformer", bs, fbxName(m.Name, "Deformer"), "BlendShape")
			bn.Child("Version", int32(100))
			g.count("Deformer")
			g.oo(bs, geom)
			for _, sh := range m.Shapes {
				ch := g.id()
				shape := g.id()
				cn := g.objects.Child("Deformer", ch, fbxName(sh.Name, "SubDeformer"), "BlendShapeChannel")
				cn.Child("Version", int32(100))
				cn.Child("DeformPercent", 0.0)
				cn.Child("FullWeights", []float64{100})
				g.count("Deformer")
				sg := g.objects.Child("Geometry", shape, fbxName(sh.Name, "Geometry"), "Shape")
				sg.Child("Version", int32(100))
				idx := make([]int32, len(sh.Indices))
				for i, x := range sh.Indices {
					idx[i] = int32(x)
				}
				sg.Child("Indexes", idx)
				sg.Child("Vertices", to64(sh.Deltas))
				if sh.NormalDeltas != nil {
					sg.Child("Normals", to64(sh.NormalDeltas))
				} else {
					sg.Child("Normals", make([]float64, len(sh.Deltas)))
				}
				g.count("Geometry")
				g.oo(shape, ch)
				g.oo(ch, bs)
			}
		}
	}
	for i, b := range s.Bones {
		pose = append(pose, poseEntry{boneIDs[i], b.BindGlobal})
	}
	poseID := g.id()
	pn := g.objects.Child("Pose", poseID, fbxName(s.Name, "Pose"), "BindPose")
	pn.Child("Type", "BindPose")
	pn.Child("Version", int32(100))
	pn.Child("NbPoseNodes", int32(len(pose)))
	for _, e := range pose {
		node := pn.Child("PoseNode")
		node.Child("Node", e.node)
		node.Child("Matrix", toSlice(e.matrix))
	}
	g.count("Pose")
	return nil
}

func (g *graph) writeGeometry(id int64, m *exportscene.Mesh) {
	gn := g.objects.Child("Geometry", id, fbxName(m.Name, "Geometry"), "Mesh")
	gn.Child("Properties70")
	gn.Child("GeometryVersion", int32(124))
	gn.Child("Vertices", to64(m.Positions))
	poly := make([]int32, len(m.Indices))
	for i, x := range m.Indices {
		poly[i] = int32(x)
		if i%3 == 2 {
			poly[i] = -int32(x) - 1 // the last index of a polygon is stored as -(i+1)
		}
	}
	gn.Child("PolygonVertexIndex", poly)
	ln := gn.Child("LayerElementNormal", int32(0))
	ln.Child("Version", int32(101))
	ln.Child("Name", "")
	ln.Child("MappingInformationType", "ByVertice")
	ln.Child("ReferenceInformationType", "Direct")
	ln.Child("Normals", to64(m.Normals))
	lu := gn.Child("LayerElementUV", int32(0))
	lu.Child("Version", int32(101))
	lu.Child("Name", "UVMap")
	lu.Child("MappingInformationType", "ByVertice")
	lu.Child("ReferenceInformationType", "Direct")
	lu.Child("UV", to64(m.UVs))
	lm := gn.Child("LayerElementMaterial", int32(0))
	lm.Child("Version", int32(101))
	lm.Child("Name", "")
	if m.TriangleMaterial == nil {
		lm.Child("MappingInformationType", "AllSame")
		lm.Child("ReferenceInformationType", "IndexToDirect")
		lm.Child("Materials", []int32{0})
	} else {
		lm.Child("MappingInformationType", "ByPolygon")
		lm.Child("ReferenceInformationType", "IndexToDirect")
		mats := make([]int32, len(m.TriangleMaterial))
		for i, x := range m.TriangleMaterial {
			mats[i] = int32(x)
		}
		lm.Child("Materials", mats)
	}
	layer := gn.Child("Layer", int32(0))
	layer.Child("Version", int32(100))
	for _, t := range []string{"LayerElementNormal", "LayerElementUV", "LayerElementMaterial"} {
		le := layer.Child("LayerElement")
		le.Child("Type", t)
		le.Child("TypedIndex", int32(0))
	}
	g.count("Geometry")
}

func (g *graph) top() []*Node {
	s := g.scene
	ct := parseTime(s.CreationTime)
	header := NewNode("FBXHeaderExtension")
	header.Child("FBXHeaderVersion", int32(1003))
	header.Child("FBXVersion", int32(Version))
	header.Child("EncryptionType", int32(0))
	ts := header.Child("CreationTimeStamp")
	ts.Child("Version", int32(1000))
	for i, f := range []string{"Year", "Month", "Day", "Hour", "Minute", "Second", "Millisecond"} {
		ts.Child(f, int32(ct[i]))
	}
	header.Child("Creator", Creator)

	gs := NewNode("GlobalSettings")
	gs.Child("Version", int32(1000))
	gp := gs.Child("Properties70")
	// Y up, +Z front, X right; 1 unit = 1 metre (UnitScaleFactor is in centimetres).
	p(gp, "UpAxis", "int", "Integer", "", int32(1))
	p(gp, "UpAxisSign", "int", "Integer", "", int32(1))
	p(gp, "FrontAxis", "int", "Integer", "", int32(2))
	p(gp, "FrontAxisSign", "int", "Integer", "", int32(1))
	p(gp, "CoordAxis", "int", "Integer", "", int32(0))
	p(gp, "CoordAxisSign", "int", "Integer", "", int32(1))
	p(gp, "OriginalUpAxis", "int", "Integer", "", int32(1))
	p(gp, "OriginalUpAxisSign", "int", "Integer", "", int32(1))
	p(gp, "UnitScaleFactor", "double", "Number", "", 100.0)
	p(gp, "OriginalUnitScaleFactor", "double", "Number", "", 100.0)
	p(gp, "AmbientColor", "ColorRGB", "Color", "", 0.0, 0.0, 0.0)
	p(gp, "DefaultCamera", "KString", "", "", "Producer Perspective")
	p(gp, "TimeMode", "enum", "", "", int32(11))
	p(gp, "TimeProtocol", "enum", "", "", int32(2))
	p(gp, "SnapOnFrameMode", "enum", "", "", int32(0))
	p(gp, "TimeSpanStart", "KTime", "Time", "", int64(0))
	p(gp, "TimeSpanStop", "KTime", "Time", "", int64(46186158000))
	p(gp, "CustomFrameRate", "double", "Number", "", -1.0)
	p(gp, "CurrentTimeMarker", "int", "Integer", "", int32(-1))

	docs := NewNode("Documents")
	docs.Child("Count", int32(1))
	doc := docs.Child("Document", int64(999_999_999), "Scene", "Scene")
	dp := doc.Child("Properties70")
	p(dp, "SourceObject", "object", "", "")
	p(dp, "ActiveAnimStackName", "KString", "", "", "")
	doc.Child("RootNode", int64(0))

	defs := NewNode("Definitions")
	defs.Child("Version", int32(100))
	total := 1
	for _, k := range g.order {
		total += g.counts[k]
	}
	defs.Child("Count", int32(total))
	defs.Child("ObjectType", "GlobalSettings").Child("Count", int32(1))
	for _, k := range g.order {
		defs.Child("ObjectType", k).Child("Count", int32(g.counts[k]))
	}

	takes := NewNode("Takes")
	takes.Child("Current", "")

	return []*Node{
		header,
		NewNode("FileId", fileID),
		// Fixed, as Blender writes it: the FBX SDK checks the footer id against FileId and this
		// string, and rejects the file as corrupted otherwise. The real time is in CreationTimeStamp.
		NewNode("CreationTime", footerTime),
		NewNode("Creator", Creator),
		gs,
		docs,
		NewNode("References"),
		defs,
		g.objects,
		g.conns,
		takes,
	}
}

func parseTime(t string) [7]int {
	// "YYYY-MM-DD HH:MM:SS:mmm", validated by exportscene.
	var out [7]int
	f := strings.FieldsFunc(t, func(r rune) bool { return r == '-' || r == ' ' || r == ':' })
	for i := 0; i < 7 && i < len(f); i++ {
		out[i], _ = strconv.Atoi(f[i])
	}
	return out
}

func to64(v []float32) []float64 {
	out := make([]float64, len(v))
	for i, x := range v {
		out[i] = float64(x)
	}
	return out
}

func toSlice(m [16]float64) []float64 { return append([]float64(nil), m[:]...) }

// ---------------------------------------------------------------- matrices (column-major)

func identity() [16]float64 {
	return [16]float64{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}
}

func mul4(a, b [16]float64) [16]float64 {
	var o [16]float64
	for c := 0; c < 4; c++ {
		for r := 0; r < 4; r++ {
			s := 0.0
			for k := 0; k < 4; k++ {
				s += a[k*4+r] * b[c*4+k]
			}
			o[c*4+r] = s
		}
	}
	return o
}

// invertAffine inverts an affine matrix (3x3 linear part plus translation).
func invertAffine(m [16]float64) [16]float64 {
	a, b, c := m[0], m[4], m[8]
	d, e, f := m[1], m[5], m[9]
	g, h, i := m[2], m[6], m[10]
	det := a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g)
	if det == 0 {
		return identity()
	}
	inv := 1 / det
	r := [9]float64{
		(e*i - f*h) * inv, (c*h - b*i) * inv, (b*f - c*e) * inv,
		(f*g - d*i) * inv, (a*i - c*g) * inv, (c*d - a*f) * inv,
		(d*h - e*g) * inv, (b*g - a*h) * inv, (a*e - b*d) * inv,
	} // row-major inverse
	var o [16]float64
	for row := 0; row < 3; row++ {
		for col := 0; col < 3; col++ {
			o[col*4+row] = r[row*3+col]
		}
	}
	tx, ty, tz := m[12], m[13], m[14]
	o[12] = -(o[0]*tx + o[4]*ty + o[8]*tz)
	o[13] = -(o[1]*tx + o[5]*ty + o[9]*tz)
	o[14] = -(o[2]*tx + o[6]*ty + o[10]*tz)
	o[15] = 1
	return o
}

// decompose splits an affine matrix into translation, Euler XYZ rotation in
// degrees (FBX eEulerXYZ: R = Rz * Ry * Rx) and scale.
func decompose(m [16]float64) (t, rot, scale [3]float64) {
	t = [3]float64{m[12], m[13], m[14]}
	for c := 0; c < 3; c++ {
		scale[c] = math.Sqrt(m[c*4]*m[c*4] + m[c*4+1]*m[c*4+1] + m[c*4+2]*m[c*4+2])
	}
	at := func(r, c int) float64 { return m[c*4+r] / scale[c] }
	deg := 180 / math.Pi
	sy := -at(2, 0)
	if sy > 1 {
		sy = 1
	} else if sy < -1 {
		sy = -1
	}
	y := math.Asin(sy)
	var x, z float64
	if math.Abs(sy) < 0.9999999 {
		x = math.Atan2(at(2, 1), at(2, 2))
		z = math.Atan2(at(1, 0), at(0, 0))
	} else {
		// Gimbal lock: put everything into x.
		x = math.Atan2(-at(1, 2), at(1, 1))
		z = 0
	}
	rot = [3]float64{x * deg, y * deg, z * deg}
	return t, rot, scale
}
