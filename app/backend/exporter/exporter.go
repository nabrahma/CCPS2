// Package exporter writes one character export (PRD 6.1):
//
//	<target>/<Name>/<Name>.fbx         skinned meshes, GameEngine skeleton, blendshapes
//	<target>/<Name>/<Name>.ps2cc.json  sidecar for the Unity importer
//	<target>/<Name>/Textures/*.png
//	<target>/<Name>/<Name>.glb         optional
//
// Each file is written to a temporary name and renamed, so Unity never
// imports a half-written FBX.
package exporter

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ps2cc/ps2cc/app/backend/exportscene"
	"github.com/ps2cc/ps2cc/app/backend/fbx"
)

// Result lists what was written.
type Result struct {
	Dir   string   `json:"dir"`
	Files []string `json:"files"`
	Bytes int64    `json:"bytes"`
}

// UnityTarget is where exports go inside a Unity project.
func UnityTarget(project string) string { return filepath.Join(project, "Assets", "PS2CC") }

// Write writes the export of a decoded scene under target.
func Write(s *exportscene.Scene, target string) (*Result, error) {
	if target == "" {
		return nil, errors.New("no export folder")
	}
	data, err := fbx.Write(s)
	if err != nil {
		return nil, fmt.Errorf("fbx: %w", err)
	}
	dir := filepath.Join(target, s.Name)
	if err := os.MkdirAll(filepath.Join(dir, "Textures"), 0o755); err != nil {
		return nil, err
	}
	res := &Result{Dir: dir}
	write := func(rel string, b []byte) error {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := writeAtomic(p, b); err != nil {
			return err
		}
		res.Files = append(res.Files, p)
		res.Bytes += int64(len(b))
		return nil
	}
	// Textures first, so the FBX finds them when Unity imports it.
	for _, t := range s.Textures {
		if err := write(t.File, t.Data); err != nil {
			return nil, err
		}
	}
	if len(s.Sidecar) > 0 && string(s.Sidecar) != "null" {
		var pretty bytes.Buffer
		if err := json.Indent(&pretty, s.Sidecar, "", "  "); err != nil {
			return nil, fmt.Errorf("sidecar: %w", err)
		}
		pretty.WriteByte('\n')
		if err := write(s.Name+".ps2cc.json", pretty.Bytes()); err != nil {
			return nil, err
		}
	}
	if s.GLB != nil {
		if err := write(s.Name+".glb", s.GLB); err != nil {
			return nil, err
		}
	}
	if err := write(s.Name+".fbx", data); err != nil {
		return nil, err
	}
	return res, nil
}

func writeAtomic(path string, data []byte) error {
	tmp := path + ".ps2cc-tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}
