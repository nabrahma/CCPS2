// Package projects saves and loads characters (.ps2char), keeps rotating
// autosaves and detects crashed sessions (PRD F10).
package projects

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ps2cc/ps2cc/app/backend/paths"
)

// AutosaveKeep is how many autosave versions are kept per character.
const AutosaveKeep = 10

// MaxDocumentBytes guards against loading something that is not a character.
const MaxDocumentBytes = 16 << 20

// Store manages Characters\<name>\ folders.
type Store struct {
	Root string // Documents\PS2CC\Characters
	now  func() time.Time
}

// NewStore returns a store rooted at the Characters folder.
func NewStore(root string) *Store { return &Store{Root: root, now: time.Now} }

// CharacterInfo is one entry in the character browser.
type CharacterInfo struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Modified string `json:"modified"` // RFC 3339
	// Thumb is the thumbnail's URL under the app's asset server
	// (/characters/<name>/renders/thumb.png?v=<mtime>), empty when there is none.
	Thumb string `json:"thumb,omitempty"`
}

// header is the minimal part of a .ps2char the backend validates.
type header struct {
	Schema int    `json:"schema"`
	ID     string `json:"id"`
	Name   string `json:"name"`
}

func validate(doc []byte) (*header, error) {
	if len(doc) > MaxDocumentBytes {
		return nil, errors.New("character file is too large")
	}
	var h header
	if err := json.Unmarshal(doc, &h); err != nil {
		return nil, fmt.Errorf("not a valid character file: %w", err)
	}
	if h.Schema != 1 {
		return nil, fmt.Errorf("unsupported character schema %d", h.Schema)
	}
	return &h, nil
}

// Dir returns Characters\<safe name>.
func (s *Store) Dir(name string) string { return filepath.Join(s.Root, paths.SafeName(name)) }

// Save writes <name>\<name>.ps2char atomically and returns its path.
func (s *Store) Save(doc []byte) (string, error) {
	h, err := validate(doc)
	if err != nil {
		return "", err
	}
	dir := s.Dir(h.Name)
	for _, sub := range []string{"", "textures", "renders", "exports", "autosave"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			return "", err
		}
	}
	path := filepath.Join(dir, paths.SafeName(h.Name)+".ps2char")
	return path, writeAtomic(path, doc)
}

// SaveAs writes the document to an explicit path chosen by the user.
func (s *Store) SaveAs(path string, doc []byte) error {
	if _, err := validate(doc); err != nil {
		return err
	}
	if !strings.EqualFold(filepath.Ext(path), ".ps2char") {
		path += ".ps2char"
	}
	return writeAtomic(path, doc)
}

// Load reads and validates a .ps2char file.
func (s *Store) Load(path string) ([]byte, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.Size() > MaxDocumentBytes {
		return nil, errors.New("character file is too large")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if _, err := validate(data); err != nil {
		return nil, err
	}
	return data, nil
}

// List returns all saved characters, newest first.
func (s *Store) List() ([]CharacterInfo, error) {
	entries, err := os.ReadDir(s.Root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var out []CharacterInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p := filepath.Join(s.Root, e.Name(), e.Name()+".ps2char")
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		info := CharacterInfo{Name: e.Name(), Path: p, Modified: st.ModTime().UTC().Format(time.RFC3339)}
		if ts, err := os.Stat(filepath.Join(s.Root, e.Name(), "renders", "thumb.png")); err == nil {
			info.Thumb = "/characters/" + url.PathEscape(e.Name()) + "/renders/thumb.png?v=" + strconv.FormatInt(ts.ModTime().UnixMilli(), 10)
		}
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified > out[j].Modified })
	return out, nil
}

// Autosave writes a timestamped copy and keeps the newest AutosaveKeep.
func (s *Store) Autosave(doc []byte) (string, error) {
	h, err := validate(doc)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(s.Dir(h.Name), "autosave")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := s.now().UTC().Format("20060102T150405.000000000") + ".ps2char"
	path := filepath.Join(dir, name)
	if err := writeAtomic(path, doc); err != nil {
		return "", err
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.ps2char"))
	sort.Strings(files)
	for len(files) > AutosaveKeep {
		_ = os.Remove(files[0])
		files = files[1:]
	}
	return path, nil
}

// LatestAutosave returns the newest autosave across all characters.
func (s *Store) LatestAutosave() (string, time.Time, error) {
	files, err := filepath.Glob(filepath.Join(s.Root, "*", "autosave", "*.ps2char"))
	if err != nil {
		return "", time.Time{}, err
	}
	var best string
	var bestTime time.Time
	for _, f := range files {
		st, err := os.Stat(f)
		if err == nil && st.ModTime().After(bestTime) {
			best, bestTime = f, st.ModTime()
		}
	}
	return best, bestTime, nil
}

// Session marks a running app so the next start can detect a crash.
type Session struct{ path string }

// BeginSession creates the session marker; crashed is true if the previous
// session never ended cleanly.
func BeginSession(root string) (*Session, bool, error) {
	p := filepath.Join(root, ".session")
	_, err := os.Stat(p)
	crashed := err == nil
	if err := os.WriteFile(p, []byte(time.Now().Format(time.RFC3339)), 0o644); err != nil {
		return nil, crashed, err
	}
	return &Session{path: p}, crashed, nil
}

// End removes the marker (clean shutdown).
func (s *Session) End() error {
	if s == nil {
		return nil
	}
	err := os.Remove(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
