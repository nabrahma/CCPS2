package materialpainter

import (
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fake is a stand-in for Material Painter's agent server: a layer stack, a
// project file and an export, enough to check the calls a session makes.
type fake struct {
	t      *testing.T
	layers []map[string]any
	calls  []string
	off    bool
}

func (f *fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if f.off {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	body, _ := io.ReadAll(r.Body)
	var req struct {
		Method string `json:"method"`
		Params struct {
			Name string         `json:"name"`
			Args map[string]any `json:"arguments"`
		} `json:"params"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		f.t.Fatalf("bad request: %v", err)
	}
	reply := func(result any) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": result})
	}
	text := func(s string) { reply(map[string]any{"content": []any{map[string]any{"type": "text", "text": s}}}) }
	if req.Method == "initialize" {
		reply(map[string]any{"serverInfo": map[string]any{"name": "material-painter"}})
		return
	}
	a := req.Params.Args
	f.calls = append(f.calls, req.Params.Name)
	idx := func() int { return int(a["index"].(float64)) }
	switch req.Params.Name {
	case "get_state":
		ls := make([]map[string]any, len(f.layers))
		for i, l := range f.layers {
			ls[i] = map[string]any{"index": i, "name": l["name"], "content": map[string]any{"kind": l["kind"]}}
		}
		b, _ := json.Marshal(map[string]any{"layers_bottom_to_top": ls})
		text(string(b))
	case "load_mesh":
		if len(f.layers) == 0 {
			f.layers = []map[string]any{{"name": "Layer 1", "kind": "paint"}}
		}
		text("{}")
	case "open_project":
		data, err := os.ReadFile(a["path"].(string))
		if err != nil {
			reply(map[string]any{"isError": true, "content": []any{map[string]any{"type": "text", "text": err.Error()}}})
			return
		}
		_ = json.Unmarshal(data, &f.layers)
		text("{}")
	case "delete_layer":
		i := idx()
		f.layers = append(f.layers[:i], f.layers[i+1:]...)
		text("Deleted")
	case "add_layer":
		l := map[string]any{"name": a["name"], "kind": a["kind"]}
		if i, ok := a["index"]; ok {
			at := int(i.(float64))
			f.layers = append(f.layers[:at], append([]map[string]any{l}, f.layers[at:]...)...)
		} else {
			f.layers = append(f.layers, l)
		}
		text("Added")
	case "update_layer":
		f.layers[idx()]["images"] = a["images"]
		f.layers[idx()]["color_variation"] = a["color_variation"]
		text("Updated")
	case "bake":
		text("{}")
	case "save_project":
		b, _ := json.Marshal(f.layers)
		_ = os.WriteFile(a["path"].(string), b, 0o644)
		text("Saved")
	case "export_textures":
		file := filepath.Join(a["folder"].(string), "ps2cc_baseColor.png")
		writePNG(f.t, file, color.NRGBA{200, 10, 10, 255})
		b, _ := json.Marshal(map[string]any{"files": []string{file, filepath.Join(a["folder"].(string), "ps2cc_normal.png")}})
		text(string(b))
	default:
		f.t.Fatalf("unexpected tool %s", req.Params.Name)
	}
}

func writePNG(t *testing.T, path string, c color.NRGBA) {
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for i := 0; i < 16; i++ {
		img.Set(i%4, i/4, c)
	}
	fh, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	if err := png.Encode(fh, img); err != nil {
		t.Fatal(err)
	}
}

func client(srv *httptest.Server) *Client {
	return &Client{URL: srv.URL + "/mcp", HTTP: srv.Client()}
}

func names(layers []map[string]any) []string {
	out := make([]string, len(layers))
	for i, l := range layers {
		out[i] = l["name"].(string)
	}
	return out
}

func TestSessionOpenAndCollect(t *testing.T) {
	f := &fake{t: t}
	srv := httptest.NewServer(f)
	defer srv.Close()
	c := client(srv)
	if err := c.Ping(); err != nil {
		t.Fatal(err)
	}
	s := Session{Dir: filepath.Join(t.TempDir(), "paint", "Mara", "skin")}
	if err := s.Write([]byte("o skin\n"), []byte("png")); err != nil {
		t.Fatal(err)
	}

	// A new session: the starter layer goes, the reference fill and a paint layer come.
	if err := s.Open(c, 2048); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names(f.layers), " | "); got != RefLayer+" | "+PaintLayer {
		t.Fatalf("layers %q", got)
	}
	if f.layers[0]["color_variation"].(float64) != 0 || f.layers[0]["images"].(map[string]any)["color"] != s.Reference() {
		t.Fatalf("reference layer %v", f.layers[0])
	}
	if !s.HasProject() {
		t.Fatal("no project saved")
	}

	// The artist adds a layer; reopening keeps it and the reference, and adds no second paint layer.
	f.layers = append(f.layers, map[string]any{"name": "Freckles", "kind": "paint"})
	if _, err := c.Call("save_project", map[string]any{"path": s.Project()}); err != nil {
		t.Fatal(err)
	}
	f.layers = nil
	f.calls = nil
	if err := s.Open(c, 2048); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names(f.layers), " | "); got != RefLayer+" | "+PaintLayer+" | Freckles" {
		t.Fatalf("reopened layers %q", got)
	}
	if f.calls[0] != "open_project" || f.calls[1] != "load_mesh" {
		t.Fatalf("reopen calls %v", f.calls)
	}

	// Collect: the base colour from the export, and the project saved.
	path, err := s.Collect(c, 2048)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "ps2cc_baseColor.png" {
		t.Fatalf("collected %s", path)
	}
	if f.calls[len(f.calls)-1] != "save_project" {
		t.Fatalf("collect calls %v", f.calls)
	}
}

func TestAgentsOffAndTextErrors(t *testing.T) {
	f := &fake{t: t, off: true}
	srv := httptest.NewServer(f)
	defer srv.Close()
	if err := client(srv).Ping(); !errors.Is(err, ErrAgentsOff) {
		t.Fatalf("want ErrAgentsOff, got %v", err)
	}
	f.off = false
	if _, err := client(srv).Call("open_project", map[string]any{"path": filepath.Join(t.TempDir(), "missing.mpp")}); err == nil || !strings.Contains(err.Error(), "open_project") {
		t.Fatalf("a tool error must come back as an error, got %v", err)
	}
}

func TestEnableAgentsKeepsOtherPreferences(t *testing.T) {
	p := filepath.Join(t.TempDir(), "MaterialPainter", "preferences.json")
	if err := EnableAgents(p); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(`{"theme": "dark", "mcp_on_start": false, "mcp_port": 39831}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := EnableAgents(p); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	data, _ := os.ReadFile(p)
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["mcp_on_start"] != true || got["theme"] != "dark" || got["mcp_port"].(float64) != 39831 {
		t.Fatalf("preferences %v", got)
	}
}

func TestFindExeAndNames(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "MaterialPainter.exe")
	if err := os.WriteFile(exe, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if FindExe(exe) != exe {
		t.Fatal("configured path not used")
	}
	if got := SessionDir("root", "Mara / bench?", "garment:top"); got != filepath.Join("root", "paint", "Mara_bench", "garment_top") {
		t.Fatalf("session dir %s", got)
	}
}

// TestLive runs a whole session against the real Material Painter
// (PS2CC_MP_LIVE=1, agent control on): a plane, a reference, a painted
// triangle, and the export compared with the reference.
func TestLive(t *testing.T) {
	if os.Getenv("PS2CC_MP_LIVE") != "1" {
		t.Skip("set PS2CC_MP_LIVE=1 to run against the real Material Painter")
	}
	c, err := Connect(FindExe(""), 60*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	s := Session{Dir: filepath.Join(t.TempDir(), "paint", "live", "skin")}
	ref := image.NewNRGBA(image.Rect(0, 0, 512, 512))
	for y := 0; y < 512; y++ {
		for x := 0; x < 512; x++ {
			ref.Set(x, y, color.NRGBA{uint8(x / 2), uint8(y / 2), uint8((x * 7) ^ (y * 13)), 255})
		}
	}
	refPath := filepath.Join(t.TempDir(), "ref.png")
	fh, _ := os.Create(refPath)
	_ = png.Encode(fh, ref)
	fh.Close()
	refBytes, _ := os.ReadFile(refPath)
	obj := "o plane\nv -0.5 0 0\nv 0.5 0 0\nv 0.5 1 0\nv -0.5 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl plane\nf 1/1 2/2 3/3\nf 1/1 3/3 4/4\n"
	if err := s.Write([]byte(obj), refBytes); err != nil {
		t.Fatal(err)
	}
	if err := s.Open(c, 512); err != nil {
		t.Fatal(err)
	}
	// Nothing painted: the export is the reference, texel for texel.
	path, err := s.Collect(c, 512)
	if err != nil {
		t.Fatal(err)
	}
	if n := differing(t, path, ref); n != 0 {
		t.Fatalf("unpainted export differs from the reference in %d texels", n)
	}
	// Paint one of the two triangles on the paint layer: half the texture changes.
	if _, err := c.Call("poly_fill", map[string]any{"index": 1, "uv": []float64{0.6, 0.3}, "mode": "triangle", "color": []float64{1, 0, 0}}); err != nil {
		t.Fatal(err)
	}
	path, err = s.Collect(c, 512)
	if err != nil {
		t.Fatal(err)
	}
	if n := differing(t, path, ref); n < 100000 || n > 160000 {
		t.Fatalf("painted triangle changed %d texels, want about half of 262144", n)
	}
	// Reopening the saved project keeps the paint.
	if err := s.Open(c, 512); err != nil {
		t.Fatal(err)
	}
	path, err = s.Collect(c, 512)
	if err != nil {
		t.Fatal(err)
	}
	if n := differing(t, path, ref); n < 100000 {
		t.Fatalf("paint lost on reopening (%d texels differ)", n)
	}
}

func differing(t *testing.T, path string, ref *image.NRGBA) int {
	fh, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	img, err := png.Decode(fh)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	b := ref.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r1, g1, b1, _ := img.At(x, y).RGBA()
			r2, g2, b2, _ := ref.At(x, y).RGBA()
			if r1>>8 != r2>>8 || g1>>8 != g2>>8 || b1>>8 != b2>>8 {
				n++
			}
		}
	}
	return n
}
