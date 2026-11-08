package settings

import (
	"os"
	"path/filepath"
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
