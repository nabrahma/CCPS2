//go:build ufbx

// Package ufbx reads FBX files with ufbx (v0.23.1, vendored, MIT or public
// domain): the writer's round-trip tests (PRD 6.3 step 3) and users' garments
// (PRD F4). It needs cgo and a 64-bit mingw-w64 compiler, so it builds only
// with the "ufbx" tag (`pnpm test:go`, `pnpm build` and `pnpm build:installer`
// set it).
package ufbx

/*
#cgo CFLAGS: -O1
#cgo LDFLAGS: -lm
#include <stdlib.h>
#include "ps2_helpers.h"
*/
import "C"

import (
	"errors"
	"unsafe"
)

// Node is a scene node.
type Node struct {
	Name   string
	Parent int // index in Scene.Nodes, -1 for the root
	IsBone bool
	Mesh   int // index in Scene.Meshes, -1 if none
	World  [16]float64
	// Geometry is the mesh's world matrix, including any geometric transform.
	Geometry [16]float64
}

// Cluster is one bone's skin weights.
type Cluster struct {
	Bone    string
	Verts   []uint32
	Weights []float64
	Bind    [16]float64 // bone bind matrix (bind_to_world)
}

// BlendShape is one blendshape channel's target.
type BlendShape struct {
	Name    string
	Indices []uint32
	Deltas  []float64
	Normals []float64
}

// Mesh is a mesh as ufbx sees it.
type Mesh struct {
	Vertices      []float64 // xyz per vertex
	Indices       []uint32  // vertex index per face corner
	AllTriangles  bool
	Normals       []float64 // xyz per face corner
	UVs           []float64 // uv per face corner
	FaceMaterials []uint32
	FaceBegin     []uint32 // first index of each face
	FaceSize      []uint32 // corners of each face
	Materials     []string
	Textures      []string
	Clusters      []Cluster
	Shapes        []BlendShape
}

// Scene is the loaded file.
type Scene struct {
	Warnings   []string
	UnitMeters float64
	Axes       [3]int // right, up, front (ufbx_coordinate_axis)
	Nodes      []Node
	Meshes     []Mesh
}

// Coordinate axes as ufbx enumerates them.
const (
	AxisPositiveX = 0
	AxisNegativeX = 1
	AxisPositiveY = 2
	AxisNegativeY = 3
	AxisPositiveZ = 4
	AxisNegativeZ = 5
)

// Load parses an FBX file from memory in strict mode.
func Load(data []byte) (*Scene, error) {
	return load(data, false)
}

// LoadGarment parses a user's FBX leniently, converted to metres, right-handed and Y up.
func LoadGarment(data []byte) (*Scene, error) {
	return load(data, true)
}

func load(data []byte, garment bool) (*Scene, error) {
	if len(data) == 0 {
		return nil, errors.New("empty file")
	}
	cdata := C.CBytes(data)
	defer C.free(cdata)
	var errBuf [1024]C.char
	var s *C.ufbx_scene
	if garment {
		s = C.ps2_load_garment(cdata, C.size_t(len(data)), &errBuf[0], C.size_t(len(errBuf)))
	} else {
		s = C.ps2_load(cdata, C.size_t(len(data)), &errBuf[0], C.size_t(len(errBuf)))
	}
	if s == nil {
		return nil, errors.New("ufbx: " + C.GoString(&errBuf[0]))
	}
	defer C.ufbx_free_scene(s)
	out := &Scene{UnitMeters: float64(C.ps2_unit_meters(s))}
	for i := C.size_t(0); i < C.ps2_warning_count(s); i++ {
		out.Warnings = append(out.Warnings, C.GoString(C.ps2_warning(s, i)))
	}
	var axes [3]C.int
	C.ps2_axes(s, &axes[0])
	out.Axes = [3]int{int(axes[0]), int(axes[1]), int(axes[2])}
	for i := C.size_t(0); i < C.ps2_node_count(s); i++ {
		n := Node{
			Name:   C.GoString(C.ps2_node_name(s, i)),
			Parent: int(C.ps2_node_parent(s, i)),
			IsBone: C.ps2_node_is_bone(s, i) != 0,
			Mesh:   int(C.ps2_node_mesh(s, i)),
		}
		C.ps2_node_world(s, i, (*C.double)(unsafe.Pointer(&n.World[0])))
		C.ps2_node_geometry_world(s, i, (*C.double)(unsafe.Pointer(&n.Geometry[0])))
		out.Nodes = append(out.Nodes, n)
	}
	for m := C.size_t(0); m < C.ps2_mesh_count(s); m++ {
		out.Meshes = append(out.Meshes, loadMesh(s, m))
	}
	return out, nil
}

func loadMesh(s *C.ufbx_scene, m C.size_t) Mesh {
	var me Mesh
	nv := int(C.ps2_mesh_num_vertices(s, m))
	ni := int(C.ps2_mesh_num_indices(s, m))
	nf := int(C.ps2_mesh_num_faces(s, m))
	me.Vertices = make([]float64, nv*3)
	if nv > 0 {
		C.ps2_mesh_vertices(s, m, (*C.double)(&me.Vertices[0]))
	}
	me.Indices = make([]uint32, ni)
	if ni > 0 {
		C.ps2_mesh_indices(s, m, (*C.uint32_t)(&me.Indices[0]))
	}
	me.AllTriangles = C.ps2_mesh_all_triangles(s, m) != 0
	if C.ps2_mesh_has_normals(s, m) != 0 && ni > 0 {
		me.Normals = make([]float64, ni*3)
		C.ps2_mesh_normals(s, m, (*C.double)(&me.Normals[0]))
	}
	if C.ps2_mesh_has_uvs(s, m) != 0 && ni > 0 {
		me.UVs = make([]float64, ni*2)
		C.ps2_mesh_uvs(s, m, (*C.double)(&me.UVs[0]))
	}
	me.FaceMaterials = make([]uint32, nf)
	me.FaceBegin = make([]uint32, nf)
	me.FaceSize = make([]uint32, nf)
	if nf > 0 {
		C.ps2_mesh_face_materials(s, m, (*C.uint32_t)(&me.FaceMaterials[0]))
		C.ps2_mesh_faces(s, m, (*C.uint32_t)(&me.FaceBegin[0]), (*C.uint32_t)(&me.FaceSize[0]))
	}
	for k := C.size_t(0); k < C.ps2_mesh_material_count(s, m); k++ {
		me.Materials = append(me.Materials, C.GoString(C.ps2_mesh_material_name(s, m, k)))
		me.Textures = append(me.Textures, C.GoString(C.ps2_mesh_material_texture(s, m, k)))
	}
	for c := C.size_t(0); c < C.ps2_skin_cluster_count(s, m); c++ {
		cl := Cluster{Bone: C.GoString(C.ps2_cluster_bone(s, m, c))}
		n := int(C.ps2_cluster_size(s, m, c))
		cl.Verts = make([]uint32, n)
		cl.Weights = make([]float64, n)
		if n > 0 {
			C.ps2_cluster_data(s, m, c, (*C.uint32_t)(&cl.Verts[0]), (*C.double)(&cl.Weights[0]))
		}
		C.ps2_cluster_bind(s, m, c, (*C.double)(unsafe.Pointer(&cl.Bind[0])))
		me.Clusters = append(me.Clusters, cl)
	}
	for c := C.size_t(0); c < C.ps2_blend_channel_count(s, m); c++ {
		sh := BlendShape{Name: C.GoString(C.ps2_blend_channel_name(s, m, c))}
		n := int(C.ps2_blend_shape_size(s, m, c))
		sh.Indices = make([]uint32, n)
		sh.Deltas = make([]float64, n*3)
		sh.Normals = make([]float64, n*3)
		if n > 0 {
			C.ps2_blend_shape_data(s, m, c, (*C.uint32_t)(&sh.Indices[0]), (*C.double)(&sh.Deltas[0]), (*C.double)(&sh.Normals[0]))
		}
		me.Shapes = append(me.Shapes, sh)
	}
	return me
}
