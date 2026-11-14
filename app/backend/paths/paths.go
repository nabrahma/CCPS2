// Package paths locates PS2CC's folders: the compiled core assets, the user
// library/characters folder (PRD 4.4) and the log folder (PRD 7).
package paths

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Layout holds every folder the app reads or writes.
type Layout struct {
	CoreAssets string // assets/core (read only)
	Root       string // %USERPROFILE%\Documents\PS2CC
	Library    string
	Characters string
	Settings   string // settings.json
	Logs       string // %LOCALAPPDATA%\PS2CC\logs
	// LocalAppData holds location.json, the pointer to a moved data folder.
	LocalAppData string
	// Default is the data folder when none was chosen (Documents\PS2CC).
	Default string
	// FromEnv is set when PS2CC_HOME chose the data folder (it cannot be moved in the app then).
	FromEnv bool
	// Fallback explains why the chosen data folder was not used this time (a drive not connected), or "".
	Fallback string
}

// LibraryKinds are the library sub-folders from PRD 4.4.
var LibraryKinds = []string{"skins", "overlays", "garments", "garment-textures", "hair-atlases", "hairstyles", "photos", "presets", "backgrounds", "materials", "outfits"}

// Resolve finds the folders and creates the user ones if missing.
func Resolve() (*Layout, error) {
	core, err := findCoreAssets()
	if err != nil {
		return nil, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("home folder: %w", err)
	}
	logRoot := os.Getenv("LOCALAPPDATA")
	if logRoot == "" {
		logRoot = filepath.Join(home, "AppData", "Local")
	}
	def := filepath.Join(home, "Documents", "PS2CC")
	root, fromEnv, fallback := os.Getenv("PS2CC_HOME"), false, ""
	if root != "" {
		fromEnv = true
	} else if chosen := readLocation(logRoot); chosen != "" {
		// A data folder on a drive that is not connected must not stop the app: use the default this time.
		if err := Usable(chosen); err != nil {
			fallback = fmt.Sprintf("your data folder %s is not available (%v), so PS2CC is using %s this time", chosen, err, def)
			root = def
		} else {
			root = chosen
		}
	} else {
		root = def
	}
	l := &Layout{
		LocalAppData: logRoot,
		Default:      def,
		FromEnv:      fromEnv,
		Fallback:     fallback,
		CoreAssets:   core,
		Root:         root,
		Library:      filepath.Join(root, "Library"),
		Characters:   filepath.Join(root, "Characters"),
		Settings:     filepath.Join(root, "settings.json"),
		Logs:         filepath.Join(logRoot, "PS2CC", "logs"),
	}
	dirs := []string{l.Root, l.Library, l.Characters, l.Logs}
	for _, k := range LibraryKinds {
		dirs = append(dirs, filepath.Join(l.Library, k))
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, fmt.Errorf("create %s: %w", d, err)
		}
	}
	return l, nil
}

// findCoreAssets looks for assets/core: $PS2CC_ASSETS, next to the executable,
// then walking up from the executable and the working directory (dev builds).
func findCoreAssets() (string, error) {
	if p := os.Getenv("PS2CC_ASSETS"); p != "" {
		if isCoreDir(p) {
			return filepath.Abs(p)
		}
		return "", fmt.Errorf("PS2CC_ASSETS=%s does not contain compiled assets", p)
	}
	var starts []string
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	for _, s := range starts {
		dir := s
		for i := 0; i < 8; i++ {
			candidate := filepath.Join(dir, "assets", "core")
			if isCoreDir(candidate) {
				return candidate, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "", errors.New("compiled assets not found: run `pnpm build:assets` or set PS2CC_ASSETS")
}

func isCoreDir(p string) bool {
	st, err := os.Stat(filepath.Join(p, "catalog.json"))
	return err == nil && !st.IsDir()
}

// SafeJoin joins a user/HTTP supplied relative path under root and rejects
// anything that would escape it (.., absolute paths, drive letters, UNC).
func SafeJoin(root, rel string) (string, error) {
	rel = strings.ReplaceAll(rel, "\\", "/")
	if rel == "" || strings.HasPrefix(rel, "/") || strings.Contains(rel, ":") || strings.HasPrefix(rel, "//") {
		return "", fmt.Errorf("invalid path %q", rel)
	}
	for _, part := range strings.Split(rel, "/") {
		if part == ".." {
			return "", fmt.Errorf("invalid path %q", rel)
		}
	}
	full := filepath.Join(root, filepath.FromSlash(rel))
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	absFull, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	if absFull != absRoot && !strings.HasPrefix(absFull, absRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid path %q", rel)
	}
	return absFull, nil
}

// SafeName turns a character name into a folder/file name.
func SafeName(name string) string {
	name = strings.TrimSpace(name)
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == ' ':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), " .")
	if out == "" {
		out = "Character"
	}
	if len(out) > 64 {
		out = out[:64]
	}
	return out
}
