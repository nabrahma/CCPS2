//go:build ufbx

package garments

import (
	"errors"
	"fmt"

	"github.com/ps2cc/ps2cc/app/backend/fbx/ufbx"
)

// parseFBX reads FBX with ufbx, converted to metres and Y up, with every node
// transform applied.
func parseFBX(data []byte) (*Mesh, error) {
	s, err := ufbx.LoadGarment(data)
	if err != nil {
		return nil, fmt.Errorf("this FBX could not be read: %w", err)
	}
	b := newBuilder()
	for n := range s.Nodes {
		node := &s.Nodes[n]
		if node.Mesh < 0 {
			continue
		}
		if node.Mesh >= len(s.Meshes) {
			return nil, errors.New("the FBX names a mesh it does not have")
		}
		if err := addFBXMesh(b, &s.Meshes[node.Mesh], mat4(node.Geometry)); err != nil {
			return nil, err
		}
	}
	return &b.m, nil
}

func addFBXMesh(b *builder, me *ufbx.Mesh, world mat4) error {
	first := uint32(len(b.m.Positions) / 3)
	for v := 0; v+2 < len(me.Vertices); v += 3 {
		x, y, z := world.point(me.Vertices[v], me.Vertices[v+1], me.Vertices[v+2])
		if _, err := b.vertex(x, y, z); err != nil {
			return err
		}
	}
	count := uint32(len(me.Vertices) / 3)
	mirrored := world.mirrors()
	for f := range me.FaceBegin {
		begin, size := int(me.FaceBegin[f]), int(me.FaceSize[f])
		if size < 3 {
			continue
		}
		if begin+size > len(me.Indices) {
			return errors.New("the FBX has an invalid face")
		}
		verts := make([]uint32, size)
		uvs := make([]uint32, size)
		for k := 0; k < size; k++ {
			c := begin + k
			if mirrored {
				c = begin + size - 1 - k
			}
			if me.Indices[c] >= count {
				return errors.New("the FBX has an index out of range")
			}
			verts[k] = first + me.Indices[c]
			if me.UVs != nil {
				id, err := b.uv(me.UVs[c*2], me.UVs[c*2+1])
				if err != nil {
					return err
				}
				uvs[k] = id
			} else {
				uvs[k] = b.noUV()
			}
		}
		if err := b.face(verts, uvs); err != nil {
			return err
		}
	}
	return nil
}
