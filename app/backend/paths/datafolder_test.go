package paths

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A data folder with a character, a library file, settings and a session marker.
func dataFolder(t *testing.T) string {
	root := filepath.Join(t.TempDir(), "PS2CC")
	write(t, filepath.Join(root, "settings.json"), `{"firstRunCompleted":true}`)
	write(t, filepath.Join(root, "Characters", "Mara", "Mara.ps2char"), `{"schema":1,"name":"Mara"}`)
	write(t, filepath.Join(root, "Library", "materials", "My denim.ps2mat"), `{"format":"ps2cc.material/1"}`)
	write(t, filepath.Join(root, ".session"), "running")
	write(t, filepath.Join(root, "Characters", "Mara", "Mara.ps2char.tmp"), "half written")
	return root
}

func TestPlanMove(t *testing.T) {
	cur := dataFolder(t)
	core := filepath.Join(t.TempDir(), "assets", "core")
	_ = os.MkdirAll(core, 0o755)

	// A new or empty folder gets a copy of the four files that matter.
	empty := filepath.Join(t.TempDir(), "new")
	plan, err := PlanMove(cur, empty, core)
	if err != nil || plan.Mode != "copy" || plan.Root != empty || plan.Files != 3 {
		t.Fatalf("empty: %+v %v", plan, err)
	}
	// A folder with other things in it gets a PS2CC folder inside.
	busy := t.TempDir()
	write(t, filepath.Join(busy, "holiday.jpg"), "x")
	plan, err = PlanMove(cur, busy, core)
	if err != nil || plan.Mode != "copy" || plan.Root != filepath.Join(busy, "PS2CC") {
		t.Fatalf("busy: %+v %v", plan, err)
	}
	// A folder that already holds PS2CC data is used as it is.
	other := dataFolder(t)
	plan, err = PlanMove(cur, other, core)
	if err != nil || plan.Mode != "use" || plan.Root != other {
		t.Fatalf("existing: %+v %v", plan, err)
	}
	// Refused: the same folder, one inside it, the assets folder, nothing.
	for _, bad := range []string{cur, filepath.Join(cur, "Library", "x"), core, filepath.Join(core, "x"), "  "} {
		if _, err := PlanMove(cur, bad, core); err == nil {
			t.Fatalf("%q was accepted", bad)
		}
	}
}

func TestCopyTreeChecksAndSkipsSessionFiles(t *testing.T) {
	src := dataFolder(t)
	dst := filepath.Join(t.TempDir(), "copy")
	var calls int
	n, err := CopyTree(src, dst, func(done, total int) {
		calls++
		if total != 3 {
			t.Fatalf("total %d", total)
		}
	})
	if err != nil || n != 3 || calls != 3 {
		t.Fatalf("copied %d, %d calls: %v", n, calls, err)
	}
	got, _ := os.ReadFile(filepath.Join(dst, "Characters", "Mara", "Mara.ps2char"))
	if string(got) != `{"schema":1,"name":"Mara"}` {
		t.Fatalf("copy %q", got)
	}
	for _, skipped := range []string{".session", filepath.Join("Characters", "Mara", "Mara.ps2char.tmp")} {
		if _, err := os.Stat(filepath.Join(dst, skipped)); err == nil {
			t.Fatalf("%s was copied", skipped)
		}
	}
	// The source is untouched.
	if _, err := os.Stat(filepath.Join(src, ".session")); err != nil {
		t.Fatal("the source lost its session marker")
	}
}

func TestLocationPointer(t *testing.T) {
	local := t.TempDir()
	if readLocation(local) != "" {
		t.Fatal("no pointer yet")
	}
	if err := WriteLocation(local, `E:\Art\PS2CC`); err != nil {
		t.Fatal(err)
	}
	if got := readLocation(local); got != `E:\Art\PS2CC` {
		t.Fatalf("read %q", got)
	}
	if err := WriteLocation(local, ""); err != nil {
		t.Fatal(err)
	}
	if readLocation(local) != "" {
		t.Fatal("pointer not removed")
	}
	if err := WriteLocation(local, ""); err != nil {
		t.Fatal("removing a missing pointer must not fail")
	}
}

// A data folder that cannot be used (a drive not connected) falls back to the default with a warning.
func TestResolveFallsBackWhenTheDataFolderIsMissing(t *testing.T) {
	home := t.TempDir()
	local := t.TempDir()
	t.Setenv("PS2CC_HOME", "")
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	t.Setenv("LOCALAPPDATA", local)
	// A path that cannot be created: under a file.
	blocker := filepath.Join(t.TempDir(), "not-a-folder")
	write(t, blocker, "x")
	if err := WriteLocation(local, filepath.Join(blocker, "PS2CC")); err != nil {
		t.Fatal(err)
	}
	l, err := Resolve()
	if err != nil {
		t.Skipf("no compiled assets here: %v", err)
	}
	if l.Root != filepath.Join(home, "Documents", "PS2CC") || !strings.Contains(l.Fallback, "not available") {
		t.Fatalf("root %s fallback %q", l.Root, l.Fallback)
	}
	// A usable chosen folder is used.
	chosen := filepath.Join(t.TempDir(), "Data")
	_ = WriteLocation(local, chosen)
	l, err = Resolve()
	if err != nil || l.Root != chosen || l.Fallback != "" || l.FromEnv {
		t.Fatalf("chosen: %+v %v", l, err)
	}
	// PS2CC_HOME wins.
	env := filepath.Join(t.TempDir(), "Env")
	t.Setenv("PS2CC_HOME", env)
	l, err = Resolve()
	if err != nil || l.Root != env || !l.FromEnv {
		t.Fatalf("env: %+v %v", l, err)
	}
}
