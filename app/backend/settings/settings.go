// Package settings stores app-wide preferences in Documents\PS2CC\settings.json.
package settings

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Settings are the persisted app preferences (PRD 4.4: default Unity project, budgets).
type Settings struct {
	UnityProject      string `json:"unityProject"`
	TriangleBudget    int    `json:"triangleBudget"`
	HardMax           int    `json:"hardMax"`
	HeadTexture       int    `json:"headTexture"`
	BodyTexture       int    `json:"bodyTexture"`
	AutosaveMinutes   int    `json:"autosaveMinutes"`
	FirstRunCompleted bool   `json:"firstRunCompleted"`
	CuratedView       bool   `json:"curatedView"`
	Symmetry          bool   `json:"symmetry"`
	// QualityProfile is the profile new characters start with (PRD Part 2 F13): classic, enhanced or hero.
	QualityProfile string `json:"qualityProfile"`
	// MaterialPainter is the Material Painter executable chosen by the user ("" finds it in the usual install folders; D-115).
	MaterialPainter string `json:"materialPainter"`
	// Favourites are the library entries starred in the library browser (Part 2 F20).
	Favourites []string `json:"favourites"`
	// LibraryTags are the user's own tags on library entries (entry id to tags).
	LibraryTags map[string][]string `json:"libraryTags"`
}

// MaxFavourites caps the starred entries and the entries with user tags.
const MaxFavourites = 2000

// MaxTagsPerEntry caps the user's tags on one entry.
const MaxTagsPerEntry = 12

// Defaults follow the PRD (12k target / 15k max, 1024 textures, 2 min autosave).
func Defaults() Settings {
	return Settings{TriangleBudget: 12000, HardMax: 15000, HeadTexture: 1024, BodyTexture: 1024, AutosaveMinutes: 2,
		CuratedView: true, Symmetry: true, QualityProfile: "enhanced"}
}

// Store reads and writes one settings file.
type Store struct {
	mu   sync.Mutex
	path string
}

// NewStore returns a store for path.
func NewStore(path string) *Store { return &Store{path: path} }

// Load returns the saved settings merged over the defaults.
func (s *Store) Load() (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Defaults()
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return Defaults(), err
	}
	out.sanitise()
	return out, nil
}

// Save writes the settings atomically.
func (s *Store) Save(v Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	v.sanitise()
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (v *Settings) sanitise() {
	d := Defaults()
	if v.HardMax <= 0 || v.HardMax > 15000 {
		v.HardMax = d.HardMax
	}
	if v.TriangleBudget <= 0 || v.TriangleBudget > v.HardMax {
		v.TriangleBudget = d.TriangleBudget
	}
	if v.HeadTexture != 512 && v.HeadTexture != 1024 {
		v.HeadTexture = d.HeadTexture
	}
	if v.BodyTexture != 512 && v.BodyTexture != 1024 {
		v.BodyTexture = d.BodyTexture
	}
	if v.QualityProfile != "classic" && v.QualityProfile != "enhanced" && v.QualityProfile != "hero" {
		v.QualityProfile = d.QualityProfile
	}
	if v.AutosaveMinutes < 1 || v.AutosaveMinutes > 60 {
		v.AutosaveMinutes = d.AutosaveMinutes
	}
	v.Favourites = sanitiseIDs(v.Favourites, MaxFavourites)
	if len(v.LibraryTags) > 0 {
		tags := map[string][]string{}
		for id, list := range v.LibraryTags {
			if len(tags) >= MaxFavourites || id == "" || len(id) > 300 {
				continue
			}
			var clean []string
			for _, t := range list {
				if t = strings.TrimSpace(t); t != "" && len(t) <= 24 && len(clean) < MaxTagsPerEntry {
					clean = append(clean, t)
				}
			}
			if len(clean) > 0 {
				tags[id] = clean
			}
		}
		v.LibraryTags = tags
	}
}

// sanitiseIDs keeps unique, non-empty ids of at most 300 bytes, at most max of them.
func sanitiseIDs(ids []string, max int) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if id == "" || len(id) > 300 || seen[id] || len(out) >= max {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// CheckUnityProject reports whether dir is a Unity project (an Assets folder
// and ProjectSettings/ProjectVersion.txt) and returns its editor version.
func CheckUnityProject(dir string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return "", errors.New("no folder given")
	}
	if st, err := os.Stat(filepath.Join(dir, "Assets")); err != nil || !st.IsDir() {
		return "", errors.New("that folder is not a Unity project (no Assets folder)")
	}
	f, err := os.Open(filepath.Join(dir, "ProjectSettings", "ProjectVersion.txt"))
	if err != nil {
		return "", errors.New("that folder is not a Unity project (no ProjectSettings/ProjectVersion.txt)")
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if v, ok := strings.CutPrefix(strings.TrimSpace(sc.Text()), "m_EditorVersion:"); ok {
			return strings.TrimSpace(v), nil
		}
	}
	return "", nil
}
