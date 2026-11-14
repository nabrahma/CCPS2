package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ps2cc/ps2cc/app/backend/library"
	"github.com/ps2cc/ps2cc/app/backend/logging"
	"github.com/ps2cc/ps2cc/app/backend/paths"
	"github.com/ps2cc/ps2cc/app/backend/projects"
	"github.com/ps2cc/ps2cc/app/backend/settings"
)

func testApp(t *testing.T) *App {
	t.Helper()
	root := t.TempDir()
	l := &paths.Layout{Root: root, Library: filepath.Join(root, "Library"), Characters: filepath.Join(root, "Characters"), Settings: filepath.Join(root, "settings.json"),
		Logs: filepath.Join(t.TempDir(), "logs"), LocalAppData: t.TempDir(), Default: root}
	for _, d := range []string{l.Library, l.Characters, l.Logs} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	log, err := logging.New(l.Logs)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = log.Close() })
	return &App{layout: l, log: log, store: projects.NewStore(l.Characters), lib: &library.Library{Root: l.Library}, settings: settings.NewStore(l.Settings)}
}

const doc = `{"schema":1,"id":"a","name":"Mara"}`

// Ctrl+S on a character saved somewhere else updates that file, and the
// character browser lists it beside the ones in the data folder (M18).
func TestSaveAnywhereAndRecentCharacters(t *testing.T) {
	a := testApp(t)
	if _, err := a.SaveCharacter(doc); err != nil {
		t.Fatal(err)
	}
	elsewhere := filepath.Join(t.TempDir(), "Art", "Mara.ps2char")
	_ = os.MkdirAll(filepath.Dir(elsewhere), 0o755)
	if _, err := a.SaveCharacterTo(elsewhere, doc); err != nil {
		t.Fatal(err)
	}
	updated := strings.Replace(doc, `"Mara"`, `"Mara v2"`, 1)
	if p, err := a.SaveCharacterTo(elsewhere, updated); err != nil || p != elsewhere {
		t.Fatalf("save over: %q %v", p, err)
	}
	if got, _ := os.ReadFile(elsewhere); string(got) != updated {
		t.Fatalf("the file was not updated: %s", got)
	}
	list, err := a.ListCharacters()
	if err != nil {
		t.Fatal(err)
	}
	var inFolder, external int
	for _, c := range list {
		if c.External {
			external++
			if c.Path != elsewhere {
				t.Fatalf("external %s", c.Path)
			}
		} else {
			inFolder++
		}
	}
	if inFolder != 1 || external != 1 {
		t.Fatalf("list %+v", list)
	}
	// Only character files are saved, and a file that went away drops out of the list.
	if _, err := a.SaveCharacterTo(filepath.Join(t.TempDir(), "notes.txt"), doc); err == nil {
		t.Fatal("saved a character as .txt")
	}
	_ = os.Remove(elsewhere)
	list, _ = a.ListCharacters()
	if len(list) != 1 {
		t.Fatalf("a deleted file is still listed: %+v", list)
	}
}

func TestDataFolderMoveCopiesAndPoints(t *testing.T) {
	a := testApp(t)
	if _, err := a.SaveCharacter(doc); err != nil {
		t.Fatal(err)
	}
	// A recent file inside the old folder follows the move.
	s, _ := a.settings.Load()
	inside := filepath.Join(a.layout.Characters, "Mara", "Mara.ps2char")
	s.RecentFiles = []string{inside}
	_ = a.settings.Save(s)
	target := filepath.Join(t.TempDir(), "NewHome")
	plan, err := a.MoveDataFolder(target)
	if err != nil || plan.Mode != "copy" {
		t.Fatalf("move: %+v %v", plan, err)
	}
	if _, err := os.Stat(filepath.Join(target, "Characters", "Mara", "Mara.ps2char")); err != nil {
		t.Fatal("the character was not copied")
	}
	if _, err := os.Stat(inside); err != nil {
		t.Fatal("the old folder must stay as it was")
	}
	moved, _ := settings.NewStore(filepath.Join(target, "settings.json")).Load()
	if len(moved.RecentFiles) != 1 || !strings.HasPrefix(moved.RecentFiles[0], target) {
		t.Fatalf("recent files %v", moved.RecentFiles)
	}
	if got := a.DataFolder(); got.Path != a.layout.Root {
		t.Fatalf("the running app keeps its folder until it restarts: %+v", got)
	}
	if err := a.UseDefaultDataFolder(); err != nil {
		t.Fatal(err)
	}
	// With PS2CC_HOME the folder cannot be changed in the app.
	a.layout.FromEnv = true
	if _, err := a.MoveDataFolder(t.TempDir()); err == nil {
		t.Fatal("moved a folder set by PS2CC_HOME")
	}
}
