package settings

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestCheckUnityProject(t *testing.T) {
	dir := t.TempDir()
	if _, err := CheckUnityProject(dir); err == nil {
		t.Fatal("a folder without Assets was accepted")
	}
	_ = os.MkdirAll(filepath.Join(dir, "Assets"), 0o755)
	if _, err := CheckUnityProject(dir); err == nil {
		t.Fatal("a folder without ProjectSettings/ProjectVersion.txt was accepted")
	}
	_ = os.MkdirAll(filepath.Join(dir, "ProjectSettings"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "ProjectSettings", "ProjectVersion.txt"), []byte("m_EditorVersion: 6000.6.8f1\nm_EditorVersionWithRevision: 6000.6.8f1 (abc)\n"), 0o644)
	v, err := CheckUnityProject(dir + "  ")
	if err != nil || v != "6000.6.8f1" {
		t.Fatalf("got %q, %v", v, err)
	}
}

func TestSettingsDefaultsAndSanitise(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "settings.json"))
	v, err := s.Load()
	if err != nil || v.FirstRunCompleted || v.TriangleBudget != 12000 || v.AutosaveMinutes != 2 {
		t.Fatalf("defaults: %+v %v", v, err)
	}
	v.FirstRunCompleted = true
	v.UnityProject = `C:\Unity\Game`
	v.HardMax = 99999
	v.AutosaveMinutes = 0
	if err := s.Save(v); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Load()
	if !got.FirstRunCompleted || got.UnityProject != `C:\Unity\Game` || got.HardMax != 15000 || got.AutosaveMinutes != 2 {
		t.Fatalf("round trip: %+v", got)
	}
}

// Library browser favourites and tags (Part 2 F20) are kept, checked and capped.
func TestFavouritesAndTags(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "settings.json"))
	v, _ := s.Load()
	v.Favourites = []string{"garment:a", "garment:a", "", "hair:starter:bob"}
	v.LibraryTags = map[string][]string{"garment:a": {"mara", " ", "this tag is far too long to keep"}, "": {"x"}, "skin:b": {}}
	if err := s.Save(v); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Load()
	if len(got.Favourites) != 2 || got.Favourites[0] != "garment:a" || got.Favourites[1] != "hair:starter:bob" {
		t.Fatalf("favourites %v", got.Favourites)
	}
	if len(got.LibraryTags) != 1 || len(got.LibraryTags["garment:a"]) != 1 || got.LibraryTags["garment:a"][0] != "mara" {
		t.Fatalf("tags %v", got.LibraryTags)
	}
	many := make([]string, MaxFavourites+50)
	for i := range many {
		many[i] = "e" + strings.Repeat("x", i%7) + string(rune('a'+i%26)) + strconv.Itoa(i)
	}
	v.Favourites = many
	_ = s.Save(v)
	got, _ = s.Load()
	if len(got.Favourites) != MaxFavourites {
		t.Fatalf("want %d favourites, got %d", MaxFavourites, len(got.Favourites))
	}
}
