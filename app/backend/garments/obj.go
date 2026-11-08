package garments

import (
	"bufio"
	"bytes"
	"fmt"
	"strconv"
	"strings"
)

// parseOBJ reads Wavefront OBJ. Only v, vt and f matter here: normals are
// recomputed after fitting, and materials come from the Wardrobe.
func parseOBJ(data []byte) (*Mesh, error) {
	b := newBuilder()
	var uvs [][2]float64
	scan := bufio.NewScanner(bytes.NewReader(data))
	scan.Buffer(make([]byte, 64<<10), 16<<20)
	for line := 1; scan.Scan(); line++ {
		fields := strings.Fields(scan.Text())
		if len(fields) == 0 {
			continue
		}
		fail := func(what string) error { return fmt.Errorf("OBJ line %d: %s", line, what) }
		switch fields[0] {
		case "v":
			if len(fields) < 4 {
				return nil, fail("a vertex needs x, y and z")
			}
			x, err1 := strconv.ParseFloat(fields[1], 64)
			y, err2 := strconv.ParseFloat(fields[2], 64)
			z, err3 := strconv.ParseFloat(fields[3], 64)
			if err1 != nil || err2 != nil || err3 != nil {
				return nil, fail("invalid vertex")
			}
			if _, err := b.vertex(x, y, z); err != nil {
				return nil, fail(err.Error())
			}
		case "vt":
			if len(fields) < 3 {
				return nil, fail("a texture coordinate needs u and v")
			}
			u, err1 := strconv.ParseFloat(fields[1], 64)
			v, err2 := strconv.ParseFloat(fields[2], 64)
			if err1 != nil || err2 != nil || !finite(u, v) {
				return nil, fail("invalid texture coordinate")
			}
			uvs = append(uvs, [2]float64{u, v})
		case "f":
			verts := make([]uint32, 0, len(fields)-1)
			corners := make([]uint32, 0, len(fields)-1)
			count := len(b.m.Positions) / 3
			for _, c := range fields[1:] {
				parts := strings.Split(c, "/")
				v, err := objIndex(parts[0], count)
				if err != nil {
					return nil, fail(err.Error())
				}
				verts = append(verts, uint32(v))
				if len(parts) > 1 && parts[1] != "" {
					t, err := objIndex(parts[1], len(uvs))
					if err != nil {
						return nil, fail(err.Error())
					}
					id, err := b.uv(uvs[t][0], uvs[t][1])
					if err != nil {
						return nil, fail(err.Error())
					}
					corners = append(corners, id)
				} else {
					corners = append(corners, b.noUV())
				}
			}
			if err := b.face(verts, corners); err != nil {
				return nil, err
			}
		}
	}
	if err := scan.Err(); err != nil {
		return nil, fmt.Errorf("OBJ: %w", err)
	}
	return &b.m, nil
}

// objIndex resolves a 1-based or negative (relative) OBJ index.
func objIndex(s string, count int) (int, error) {
	i, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("invalid index %q", s)
	}
	if i < 0 {
		i += count
	} else {
		i--
	}
	if i < 0 || i >= count {
		return 0, fmt.Errorf("index %s is out of range", s)
	}
	return i, nil
}
