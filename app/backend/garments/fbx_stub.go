//go:build !ufbx

package garments

import "errors"

// parseFBX: FBX reading needs ufbx, which only builds with cgo. Release builds
// (`pnpm build`, `pnpm build:installer`) have it; a plain `wails dev` does not.
func parseFBX([]byte) (*Mesh, error) {
	return nil, errors.New("this build of PS2CC cannot read FBX: export the garment as OBJ or GLB")
}
