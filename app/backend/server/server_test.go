package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestServesCoreAndRejectsTraversal(t *testing.T) {
	core := t.TempDir()
	lib := t.TempDir()
	_ = os.MkdirAll(filepath.Join(core, "targets"), 0o755)
	_ = os.WriteFile(filepath.Join(core, "targets", "t.json"), []byte(`{"ok":true}`), 0o644)
	_ = os.WriteFile(filepath.Join(filepath.Dir(core), "secret.txt"), []byte("x"), 0o644)
	h := &Handler{Core: core, Library: lib}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/core/targets/t.json", nil))
	if rec.Code != 200 || rec.Body.String() != `{"ok":true}` {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct == "" {
		t.Error("missing content type")
	}
	for _, p := range []string{"/core/../secret.txt", "/core/%2e%2e/secret.txt", "/core/C:/Windows/win.ini", "/other/x"} {
		rec = httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.URL.Path = p
		h.ServeHTTP(rec, req)
		if rec.Code == 200 {
			t.Errorf("%s should not be served", p)
		}
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/core/targets/t.json", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST should be rejected, got %d", rec.Code)
	}
}

// The Characters folder holds documents and exports: only browser thumbnails are served from it.
func TestServesOnlyCharacterThumbnails(t *testing.T) {
	chars := t.TempDir()
	_ = os.MkdirAll(filepath.Join(chars, "Bob", "renders"), 0o755)
	_ = os.WriteFile(filepath.Join(chars, "Bob", "renders", "thumb.png"), []byte("\x89PNG\r\n\x1a\nthumb"), 0o644)
	_ = os.WriteFile(filepath.Join(chars, "Bob", "renders", "render_full.png"), []byte("\x89PNG\r\n\x1a\nr"), 0o644)
	_ = os.WriteFile(filepath.Join(chars, "Bob", "Bob.ps2char"), []byte(`{"schema":1}`), 0o644)
	h := &Handler{Core: t.TempDir(), Library: t.TempDir(), Characters: chars}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/characters/Bob/renders/thumb.png?v=1", nil))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("thumbnail: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	for _, p := range []string{"/characters/Bob/Bob.ps2char", "/characters/Bob/renders/render_full.png", "/characters/../Bob/renders/thumb.png",
		"/characters/Bob/../Bob/renders/thumb.png", "/characters/a/b/renders/thumb.png"} {
		rec = httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.URL.Path = p
		h.ServeHTTP(rec, req)
		if rec.Code == 200 {
			t.Errorf("%s should not be served", p)
		}
	}
}
