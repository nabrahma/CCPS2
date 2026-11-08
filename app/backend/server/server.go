// Package server serves compiled core assets and library files to the
// WebView through Wails' AssetServer handler (no network: Wails routes these
// requests in-process).
package server

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ps2cc/ps2cc/app/backend/paths"
)

// Handler serves /core/<path> from the core assets folder, /library/<path>
// from the user library and /characters/<name>/renders/thumb.png (character
// browser thumbnails, nothing else) from the Characters folder.
type Handler struct {
	Core       string
	Library    string
	Characters string
}

// thumbPath matches the only files served from the Characters folder.
var thumbPath = regexp.MustCompile(`^[^/\\]+/renders/thumb\.png$`)

func init() {
	_ = mime.AddExtensionType(".bin", "application/octet-stream")
	_ = mime.AddExtensionType(".json", "application/json")
	_ = mime.AddExtensionType(".task", "application/octet-stream")
	_ = mime.AddExtensionType(".wasm", "application/wasm")
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var root, rel string
	switch {
	case strings.HasPrefix(r.URL.Path, "/core/"):
		root, rel = h.Core, strings.TrimPrefix(r.URL.Path, "/core/")
	case strings.HasPrefix(r.URL.Path, "/library/"):
		root, rel = h.Library, strings.TrimPrefix(r.URL.Path, "/library/")
	case strings.HasPrefix(r.URL.Path, "/characters/") && h.Characters != "":
		root, rel = h.Characters, strings.TrimPrefix(r.URL.Path, "/characters/")
		if !thumbPath.MatchString(rel) {
			http.NotFound(w, r)
			return
		}
	default:
		http.NotFound(w, r)
		return
	}
	full, err := paths.SafeJoin(root, rel)
	if err != nil {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	st, err := os.Stat(full)
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	if ct := mime.TypeByExtension(filepath.Ext(full)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if strings.HasPrefix(r.URL.Path, "/core/") {
		// Core assets are immutable for a given build.
		w.Header().Set("Cache-Control", "max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	f, err := os.Open(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}
