package paths

import (
	"path/filepath"
	"testing"
)

func TestSafeJoinRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	bad := []string{"", "../x", "a/../../x", "/etc/passwd", "C:/Windows", "\\\\server\\share", "a\\..\\..\\b", "x/../.."}
	for _, p := range bad {
		if _, err := SafeJoin(root, p); err == nil {
			t.Errorf("SafeJoin(%q) should fail", p)
		}
	}
	got, err := SafeJoin(root, "textures/skins/a.jpg")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "textures", "skins", "a.jpg")
	if got != want {
		t.Errorf("got %s want %s", got, want)
	}
}

func TestSafeName(t *testing.T) {
	cases := map[string]string{"Mara v3": "Mara v3", "../evil": "___evil", "  ": "Character", "a:b*c": "a_b_c"}
	for in, want := range cases {
		if got := SafeName(in); got != want {
			t.Errorf("SafeName(%q) = %q, want %q", in, got, want)
		}
	}
}
