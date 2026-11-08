package garments

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

type gltfNode struct {
	Mesh        *int      `json:"mesh"`
	Children    []int     `json:"children"`
	Matrix      []float64 `json:"matrix"`
	Translation []float64 `json:"translation"`
	Rotation    []float64 `json:"rotation"`
	Scale       []float64 `json:"scale"`
}

type gltfPrimitive struct {
	Attributes map[string]int `json:"attributes"`
	Indices    *int           `json:"indices"`
	Mode       *int           `json:"mode"`
}

type gltfAccessor struct {
	BufferView    *int            `json:"bufferView"`
	ByteOffset    int             `json:"byteOffset"`
	ComponentType int             `json:"componentType"`
	Count         int             `json:"count"`
	Type          string          `json:"type"`
	Normalized    bool            `json:"normalized"`
	Sparse        json.RawMessage `json:"sparse"`
}

type gltfView struct {
	Buffer     int `json:"buffer"`
	ByteOffset int `json:"byteOffset"`
	ByteLength int `json:"byteLength"`
	ByteStride int `json:"byteStride"`
}

type gltfDoc struct {
	Scene  *int `json:"scene"`
	Scenes []struct {
		Nodes []int `json:"nodes"`
	} `json:"scenes"`
	Nodes  []gltfNode `json:"nodes"`
	Meshes []struct {
		Primitives []gltfPrimitive `json:"primitives"`
	} `json:"meshes"`
	Accessors          []gltfAccessor `json:"accessors"`
	BufferViews        []gltfView     `json:"bufferViews"`
	ExtensionsRequired []string       `json:"extensionsRequired"`
}

const (
	glbMagic     = 0x46546C67 // "glTF"
	chunkJSON    = 0x4E4F534A
	chunkBIN     = 0x004E4942
	gltfByte     = 5121
	gltfUShort   = 5123
	gltfUInt     = 5125
	gltfFloat    = 5126
	maxNodeDepth = 256
)

// parseGLB reads binary glTF 2.0 (metres, Y up): every triangle primitive of
// the default scene, with node transforms applied.
func parseGLB(data []byte) (*Mesh, error) {
	if len(data) < 20 || binary.LittleEndian.Uint32(data) != glbMagic {
		return nil, errors.New("not a GLB file")
	}
	if v := binary.LittleEndian.Uint32(data[4:]); v != 2 {
		return nil, fmt.Errorf("GLB version %d is not supported", v)
	}
	var jsonChunk, bin []byte
	for o := 12; o+8 <= len(data); {
		size := int(binary.LittleEndian.Uint32(data[o:]))
		kind := binary.LittleEndian.Uint32(data[o+4:])
		start := o + 8
		if size < 0 || size > len(data)-start {
			return nil, errors.New("the GLB file is truncated")
		}
		switch {
		case kind == chunkJSON && jsonChunk == nil:
			jsonChunk = data[start : start+size]
		case kind == chunkBIN && bin == nil:
			bin = data[start : start+size]
		}
		o = start + size
	}
	if jsonChunk == nil {
		return nil, errors.New("the GLB file has no JSON chunk")
	}
	var doc gltfDoc
	if err := json.Unmarshal(jsonChunk, &doc); err != nil {
		return nil, fmt.Errorf("invalid GLB JSON: %w", err)
	}
	if len(doc.ExtensionsRequired) > 0 {
		return nil, fmt.Errorf("this GLB needs %v, which PS2CC does not read: export it without compression", doc.ExtensionsRequired)
	}
	r := &glbReader{doc: &doc, bin: bin, b: newBuilder()}
	var roots []int
	switch {
	case len(doc.Scenes) > 0:
		s := 0
		if doc.Scene != nil {
			s = *doc.Scene
		}
		if s < 0 || s >= len(doc.Scenes) {
			return nil, errors.New("the GLB names a scene it does not have")
		}
		roots = doc.Scenes[s].Nodes
	default:
		for i := range doc.Nodes {
			roots = append(roots, i)
		}
	}
	for _, n := range roots {
		if err := r.node(n, identity4(), 0); err != nil {
			return nil, err
		}
	}
	return &r.b.m, nil
}

type mat4 [16]float64 // column-major

func identity4() mat4 { return mat4{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1} }

func (a mat4) mul(b mat4) mat4 {
	var o mat4
	for c := 0; c < 4; c++ {
		for r := 0; r < 4; r++ {
			for k := 0; k < 4; k++ {
				o[c*4+r] += a[k*4+r] * b[c*4+k]
			}
		}
	}
	return o
}

func (a mat4) point(x, y, z float64) (float64, float64, float64) {
	return a[0]*x + a[4]*y + a[8]*z + a[12], a[1]*x + a[5]*y + a[9]*z + a[13], a[2]*x + a[6]*y + a[10]*z + a[14]
}

// mirrors reports whether the matrix turns the mesh inside out.
func (a mat4) mirrors() bool {
	det := a[0]*(a[5]*a[10]-a[6]*a[9]) - a[4]*(a[1]*a[10]-a[2]*a[9]) + a[8]*(a[1]*a[6]-a[2]*a[5])
	return det < 0
}

func nodeMatrix(n *gltfNode) (mat4, error) {
	if len(n.Matrix) == 16 {
		var m mat4
		copy(m[:], n.Matrix)
		return m, nil
	}
	t := []float64{0, 0, 0}
	if len(n.Translation) == 3 {
		t = n.Translation
	}
	q := []float64{0, 0, 0, 1}
	if len(n.Rotation) == 4 {
		q = n.Rotation
	}
	s := []float64{1, 1, 1}
	if len(n.Scale) == 3 {
		s = n.Scale
	}
	if !finite(t...) || !finite(q...) || !finite(s...) {
		return mat4{}, errors.New("the GLB has an invalid node transform")
	}
	l := math.Sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3])
	if l == 0 {
		l = 1
	}
	x, y, z, w := q[0]/l, q[1]/l, q[2]/l, q[3]/l
	return mat4{
		(1 - 2*(y*y+z*z)) * s[0], 2 * (x*y + z*w) * s[0], 2 * (x*z - y*w) * s[0], 0,
		2 * (x*y - z*w) * s[1], (1 - 2*(x*x+z*z)) * s[1], 2 * (y*z + x*w) * s[1], 0,
		2 * (x*z + y*w) * s[2], 2 * (y*z - x*w) * s[2], (1 - 2*(x*x+y*y)) * s[2], 0,
		t[0], t[1], t[2], 1,
	}, nil
}

type glbReader struct {
	doc *gltfDoc
	bin []byte
	b   *builder
}

func (r *glbReader) node(i int, parent mat4, depth int) error {
	if i < 0 || i >= len(r.doc.Nodes) || depth > maxNodeDepth {
		return errors.New("the GLB has an invalid node hierarchy")
	}
	n := &r.doc.Nodes[i]
	local, err := nodeMatrix(n)
	if err != nil {
		return err
	}
	world := parent.mul(local)
	if n.Mesh != nil {
		if *n.Mesh < 0 || *n.Mesh >= len(r.doc.Meshes) {
			return errors.New("the GLB names a mesh it does not have")
		}
		for p := range r.doc.Meshes[*n.Mesh].Primitives {
			if err := r.primitive(&r.doc.Meshes[*n.Mesh].Primitives[p], world); err != nil {
				return err
			}
		}
	}
	for _, c := range n.Children {
		if err := r.node(c, world, depth+1); err != nil {
			return err
		}
	}
	return nil
}

// element returns the accessor's bytes, its stride and its component size, all bounds-checked.
func (r *glbReader) element(index, components int) ([]byte, int, int, *gltfAccessor, error) {
	bad := func() ([]byte, int, int, *gltfAccessor, error) {
		return nil, 0, 0, nil, errors.New("the GLB has an invalid buffer accessor")
	}
	if index < 0 || index >= len(r.doc.Accessors) {
		return bad()
	}
	a := &r.doc.Accessors[index]
	if a.Sparse != nil {
		return nil, 0, 0, nil, errors.New("sparse GLB accessors are not supported: export the mesh without them")
	}
	if a.BufferView == nil || *a.BufferView < 0 || *a.BufferView >= len(r.doc.BufferViews) || a.Count < 0 || a.ByteOffset < 0 {
		return bad()
	}
	view := &r.doc.BufferViews[*a.BufferView]
	if view.Buffer != 0 || view.ByteOffset < 0 || view.ByteLength < 0 || view.ByteLength > len(r.bin)-view.ByteOffset {
		return bad()
	}
	var size int
	switch a.ComponentType {
	case gltfByte:
		size = 1
	case gltfUShort:
		size = 2
	case gltfUInt, gltfFloat:
		size = 4
	default:
		return bad()
	}
	element := size * components
	stride := view.ByteStride
	if stride == 0 {
		stride = element
	}
	if stride < element || a.ByteOffset > view.ByteLength {
		return bad()
	}
	body := r.bin[view.ByteOffset+a.ByteOffset : view.ByteOffset+view.ByteLength]
	if a.Count > 0 && (a.Count-1 > (len(body)-element)/stride || len(body) < element) {
		return bad()
	}
	return body, stride, size, a, nil
}

func (r *glbReader) primitive(p *gltfPrimitive, world mat4) error {
	if p.Mode != nil && *p.Mode != 4 {
		return nil // lines and points are not cloth
	}
	posIndex, ok := p.Attributes["POSITION"]
	if !ok {
		return nil
	}
	body, stride, _, a, err := r.element(posIndex, 3)
	if err != nil {
		return err
	}
	if a.ComponentType != gltfFloat || a.Type != "VEC3" {
		return errors.New("GLB positions must be 32-bit floats")
	}
	first := uint32(len(r.b.m.Positions) / 3)
	count := a.Count
	for i := 0; i < count; i++ {
		o := i * stride
		x, y, z := world.point(float64(f32(body[o:])), float64(f32(body[o+4:])), float64(f32(body[o+8:])))
		if _, err := r.b.vertex(x, y, z); err != nil {
			return err
		}
	}
	uvs := make([]uint32, count)
	if uvIndex, ok := p.Attributes["TEXCOORD_0"]; ok {
		if err := r.readUVs(uvIndex, uvs, count); err != nil {
			return err
		}
	} else {
		blank := r.b.noUV()
		for i := range uvs {
			uvs[i] = blank
		}
	}
	indices, err := r.indices(p, count)
	if err != nil {
		return err
	}
	mirrored := world.mirrors()
	for t := 0; t+2 < len(indices); t += 3 {
		a, b, c := indices[t], indices[t+1], indices[t+2]
		if mirrored {
			b, c = c, b
		}
		if err := r.b.face([]uint32{first + a, first + b, first + c}, []uint32{uvs[a], uvs[b], uvs[c]}); err != nil {
			return err
		}
	}
	return nil
}

func (r *glbReader) readUVs(index int, out []uint32, count int) error {
	body, stride, size, a, err := r.element(index, 2)
	if err != nil {
		return err
	}
	if a.Count != count || a.Type != "VEC2" {
		return errors.New("the GLB's UVs do not match its vertices")
	}
	for i := range out {
		o := i * stride
		var u, v float64
		switch {
		case a.ComponentType == gltfFloat:
			u, v = float64(f32(body[o:])), float64(f32(body[o+4:]))
		case a.ComponentType == gltfUShort && a.Normalized && size == 2:
			u, v = float64(binary.LittleEndian.Uint16(body[o:]))/65535, float64(binary.LittleEndian.Uint16(body[o+2:]))/65535
		case a.ComponentType == gltfByte && a.Normalized:
			u, v = float64(body[o])/255, float64(body[o+1])/255
		default:
			return errors.New("the GLB's UVs use a format PS2CC does not read")
		}
		// glTF's V runs down the image; PS2CC's runs up.
		id, err := r.b.uv(u, 1-v)
		if err != nil {
			return err
		}
		out[i] = id
	}
	return nil
}

func (r *glbReader) indices(p *gltfPrimitive, count int) ([]uint32, error) {
	if p.Indices == nil {
		out := make([]uint32, count)
		for i := range out {
			out[i] = uint32(i)
		}
		return out, nil
	}
	body, stride, size, a, err := r.element(*p.Indices, 1)
	if err != nil {
		return nil, err
	}
	if a.ComponentType == gltfFloat || a.Type != "SCALAR" {
		return nil, errors.New("the GLB has invalid indices")
	}
	out := make([]uint32, a.Count)
	for i := range out {
		o := i * stride
		switch size {
		case 1:
			out[i] = uint32(body[o])
		case 2:
			out[i] = uint32(binary.LittleEndian.Uint16(body[o:]))
		default:
			out[i] = binary.LittleEndian.Uint32(body[o:])
		}
		if int64(out[i]) >= int64(count) {
			return nil, errors.New("the GLB has an index out of range")
		}
	}
	return out, nil
}

func f32(b []byte) float32 { return math.Float32frombits(binary.LittleEndian.Uint32(b)) }
