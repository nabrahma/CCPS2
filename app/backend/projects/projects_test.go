package projects

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const doc = `{"schema":1,"id":"abc","name":"Mara v3","macros":{}}`

func TestSaveLoadRoundTrip(t *testing.T) {
	s := NewStore(t.TempDir())
	path, err := s.Save([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "Mara v3.ps2char" {
		t.Errorf("unexpected path %s", path)
	}
	for _, sub := range []string{"textures", "renders", "exports", "autosave"} {
		if _, err := os.Stat(filepath.Join(filepath.Dir(path), sub)); err != nil {
			t.Errorf("missing %s folder", sub)
		}
	}
	got, err := s.Load(path)
	if err != nil || string(got) != doc {
		t.Fatalf("load: %v %q", err, got)
	}
	list, err := s.List()
	if err != nil || len(list) != 1 || list[0].Name != "Mara v3" || list[0].Thumb != "" {
		t.Fatalf("list: %v %+v", err, list)
	}
	// A thumbnail is listed as a URL of the app's asset server, escaped, with a cache-busting version.
	_ = os.WriteFile(filepath.Join(filepath.Dir(path), "renders", "thumb.png"), []byte("png"), 0o644)
	list, _ = s.List()
	if !strings.HasPrefix(list[0].Thumb, "/characters/Mara%20v3/renders/thumb.png?v=") {
		t.Fatalf("thumb URL %q", list[0].Thumb)
	}
}

func TestRejectsInvalidDocuments(t *testing.T) {
	s := NewStore(t.TempDir())
	for _, bad := range []string{"", "nope", `{"schema":2,"name":"x"}`, `[1,2]`} {
		if _, err := s.Save([]byte(bad)); err == nil {
			t.Errorf("Save(%q) should fail", bad)
		}
	}
}

func TestAutosaveKeepsTenVersions(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 15; i++ {
		s.now = func() time.Time { return base.Add(time.Duration(i) * 2 * time.Minute) }
		if _, err := s.Autosave([]byte(doc)); err != nil {
			t.Fatal(err)
		}
	}
	files, _ := filepath.Glob(filepath.Join(s.Dir("Mara v3"), "autosave", "*.ps2char"))
	if len(files) != AutosaveKeep {
		t.Fatalf("kept %d autosaves, want %d", len(files), AutosaveKeep)
	}
	latest, _, err := s.LatestAutosave()
	if err != nil || latest == "" {
		t.Fatalf("latest autosave: %v", err)
	}
}

func TestSessionDetectsCrash(t *testing.T) {
	root := t.TempDir()
	s1, crashed, err := BeginSession(root)
	if err != nil || crashed {
		t.Fatalf("first session: crashed=%v err=%v", crashed, err)
	}
	// Simulate a crash: no End().
	_, crashed, err = BeginSession(root)
	if err != nil || !crashed {
		t.Fatalf("second session should detect crash: crashed=%v err=%v", crashed, err)
	}
	_ = s1
	s3, _, _ := BeginSession(root)
	if err := s3.End(); err != nil {
		t.Fatal(err)
	}
	_, crashed, _ = BeginSession(root)
	if crashed {
		t.Error("clean shutdown reported as crash")
	}
}
