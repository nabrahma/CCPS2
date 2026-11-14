package paths

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// The data folder (characters, library, settings) can live anywhere. Where it
// is, is kept outside it, in %LOCALAPPDATA%\PS2CC\location.json, so the app
// finds it again on the next start. PS2CC_HOME, when set, wins over both.

// LocationFileName is the pointer to the data folder, beside the logs.
const LocationFileName = "location.json"

type location struct {
	Root string `json:"root"`
}

// locationPath is %LOCALAPPDATA%\PS2CC\location.json.
func locationPath(localAppData string) string {
	return filepath.Join(localAppData, "PS2CC", LocationFileName)
}

// readLocation returns the data folder the pointer names, or "" when there is none.
func readLocation(localAppData string) string {
	data, err := os.ReadFile(locationPath(localAppData))
	if err != nil {
		return ""
	}
	var l location
	if json.Unmarshal(data, &l) != nil {
		return ""
	}
	return strings.TrimSpace(l.Root)
}

// WriteLocation points the app at a data folder from the next start ("" goes back to the default).
func WriteLocation(localAppData, root string) error {
	p := locationPath(localAppData)
	if root == "" {
		err := os.Remove(p)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(location{Root: root}, "", "  ")
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// Usable reports whether a folder exists (or can be made) and can be written to.
func Usable(root string) error {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	probe, err := os.CreateTemp(root, ".ps2cc-write-test-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	_ = probe.Close()
	return os.Remove(name)
}

// isDataFolder reports whether a folder already holds PS2CC data.
func isDataFolder(root string) bool {
	for _, n := range []string{"settings.json", "Library", "Characters"} {
		if _, err := os.Stat(filepath.Join(root, n)); err == nil {
			return true
		}
	}
	return false
}

func isEmptyDir(p string) (bool, error) {
	entries, err := os.ReadDir(p)
	if errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return len(entries) == 0, nil
}

// within reports whether p is root or inside it.
func within(p, root string) bool {
	rel, err := filepath.Rel(root, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// MovePlan says what choosing a folder as the data folder would do.
type MovePlan struct {
	// Root is the data folder that would be used: the chosen folder, or a PS2CC folder inside it.
	Root string `json:"root"`
	// Mode is "copy" (your data is copied there) or "use" (it already holds PS2CC data, which is used as it is).
	Mode  string `json:"mode"`
	Files int    `json:"files"`
	Bytes int64  `json:"bytes"`
}

// PlanMove checks a folder chosen as the new data folder. An empty (or new)
// folder gets a copy; a folder that already holds PS2CC data is used as it is;
// any other folder gets a PS2CC folder inside it. Folders inside the current
// data folder, holding it, or the compiled assets are refused.
func PlanMove(current, chosen, coreAssets string) (*MovePlan, error) {
	if strings.TrimSpace(chosen) == "" {
		return nil, errors.New("no folder chosen")
	}
	target, err := filepath.Abs(chosen)
	if err != nil {
		return nil, err
	}
	cur, err := filepath.Abs(current)
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(target, cur) {
		return nil, errors.New("that is already the data folder")
	}
	if within(target, cur) {
		return nil, errors.New("the new data folder cannot be inside the current one")
	}
	if within(cur, target) && !strings.EqualFold(cur, target) && isDataFolder(target) {
		return nil, errors.New("the current data folder is inside that folder")
	}
	if coreAssets != "" && (within(target, coreAssets) || within(coreAssets, target)) {
		return nil, errors.New("the data folder cannot share a folder with the app's assets")
	}
	plan := &MovePlan{Root: target, Mode: "copy"}
	switch empty, err := isEmptyDir(target); {
	case err != nil:
		return nil, err
	case isDataFolder(target):
		plan.Mode = "use"
		return plan, Usable(target)
	case !empty:
		plan.Root = filepath.Join(target, "PS2CC")
		if isDataFolder(plan.Root) {
			plan.Mode = "use"
			return plan, Usable(plan.Root)
		}
		if e, err := isEmptyDir(plan.Root); err != nil || !e {
			return nil, fmt.Errorf("%s already exists and is not a PS2CC data folder", plan.Root)
		}
	}
	if err := Usable(plan.Root); err != nil {
		return nil, fmt.Errorf("cannot write to %s: %w", plan.Root, err)
	}
	plan.Files, plan.Bytes, err = treeSize(cur)
	return plan, err
}

// skipped are files of the running session that are not copied.
func skipped(rel string, d fs.DirEntry) bool {
	base := d.Name()
	return base == ".session" || strings.HasSuffix(base, ".tmp") || strings.HasPrefix(base, ".ps2cc-write-test-")
}

func treeSize(root string) (int, int64, error) {
	files, bytes := 0, int64(0)
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		if d.IsDir() || skipped(rel, d) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		files++
		bytes += info.Size()
		return nil
	})
	return files, bytes, err
}

// CopyTree copies a data folder, file by file, and checks every copy against
// its source (size and SHA-256). The source is never changed. progress is
// called after each file.
func CopyTree(src, dst string, progress func(done, total int)) (int, error) {
	total, _, err := treeSize(src)
	if err != nil {
		return 0, err
	}
	done := 0
	err = filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		out := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		if skipped(rel, d) {
			return nil
		}
		if err := copyChecked(p, out); err != nil {
			return fmt.Errorf("%s: %w", rel, err)
		}
		done++
		if progress != nil {
			progress(done, total)
		}
		return nil
	})
	return done, err
}

func copyChecked(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	want := h.Sum(nil)
	// Read the copy back: what is on the disk must be what was read.
	back, err := os.Open(tmp)
	if err != nil {
		return err
	}
	h2 := sha256.New()
	m, err := io.Copy(h2, back)
	_ = back.Close()
	if err != nil || m != n || string(h2.Sum(nil)) != string(want) {
		_ = os.Remove(tmp)
		return errors.New("the copy does not match the original")
	}
	if st, err := os.Stat(src); err == nil {
		_ = os.Chtimes(tmp, st.ModTime(), st.ModTime())
	}
	return os.Rename(tmp, dst)
}
