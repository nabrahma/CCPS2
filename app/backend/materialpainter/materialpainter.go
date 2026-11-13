// Package materialpainter links PS2CC's Texture Studio to Material Painter
// (PRD Part 2 F17, DECISIONS D-115), a GPL-3.0 PBR texture painter that runs
// as its own program. PS2CC drives it through its agent-control server (MCP
// over HTTP on 127.0.0.1, JSON-RPC "tools/call"): it loads a mesh with UVs,
// puts the character's current texture under the artist's layers as a
// reference fill, and later exports the base colour and saves the project.
//
// Each paint target (the skin, or one garment) has a session folder:
//
//	mesh.obj        the mesh with its UVs
//	reference.png   the texture the artist paints over
//	project.mpp     Material Painter's project, so the layers can be reopened
//	export/         Material Painter's last export
package materialpainter

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// FirstPort is Material Painter's default agent port; it takes the first free one of ten from here.
const FirstPort = 39831

// RefLayer is the name of the reference fill layer PS2CC keeps at the bottom of the stack.
const RefLayer = "PS2CC reference (do not paint)"

// PaintLayer is the name of the empty paint layer a new session starts with.
const PaintLayer = "Paint"

// ExportPreset is the output template used to take the base colour back (one PNG, sRGB, alpha from opacity).
const ExportPreset = "glTF PBR (metal/rough)"

// Errors the frontend tells apart (their text starts with these codes).
var (
	ErrNotFound  = errors.New("material-painter:not-found: Material Painter is not installed (or not where PS2CC looks)")
	ErrAgentsOff = errors.New("material-painter:agents-off: Material Painter is running with agent control off")
	ErrNoAnswer  = errors.New("material-painter:no-answer: Material Painter did not answer")
)

// FindExe returns the Material Painter executable: the configured path, the
// PS2CC_MATERIAL_PAINTER variable, or a standard install folder ("" if none).
func FindExe(configured string) string {
	candidates := []string{configured, os.Getenv("PS2CC_MATERIAL_PAINTER")}
	for _, root := range []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs"), os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if root != "" && root != "Programs" {
			candidates = append(candidates, filepath.Join(root, "Material Painter", "MaterialPainter.exe"))
		}
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// PrefsPath is Material Painter's preferences file.
func PrefsPath() string {
	base := os.Getenv("APPDATA")
	if base == "" {
		return ""
	}
	return filepath.Join(base, "MaterialPainter", "preferences.json")
}

// EnableAgents turns on "start the agent server" in Material Painter's
// preferences, keeping every other preference. It takes effect the next time
// Material Painter starts.
func EnableAgents(prefsPath string) error {
	if prefsPath == "" {
		return errors.New("no settings folder for Material Painter")
	}
	prefs := map[string]any{}
	if data, err := os.ReadFile(prefsPath); err == nil {
		if err := json.Unmarshal(data, &prefs); err != nil {
			return fmt.Errorf("Material Painter's preferences are not JSON: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	prefs["mcp_on_start"] = true
	data, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(prefsPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(prefsPath, data, 0o644)
}

// Client calls Material Painter's agent server.
type Client struct {
	URL  string
	HTTP *http.Client
}

// NewClient returns a client for the server at a port on 127.0.0.1.
func NewClient(port int) *Client {
	// Bakes and exports answer when they finish: allow minutes.
	return &Client{URL: fmt.Sprintf("http://127.0.0.1:%d/mcp", port), HTTP: &http.Client{Timeout: 5 * time.Minute}}
}

type rpcResponse struct {
	Result *struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError    bool `json:"isError"`
		ServerInfo *struct {
			Name string `json:"name"`
		} `json:"serverInfo"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (c *Client) post(method string, params any) (*rpcResponse, error) {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode == http.StatusServiceUnavailable {
		return nil, ErrAgentsOff
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Material Painter answered %s", res.Status)
	}
	var out rpcResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("Material Painter's answer is not JSON-RPC: %w", err)
	}
	if out.Error != nil {
		return nil, fmt.Errorf("Material Painter: %s", out.Error.Message)
	}
	if out.Result == nil {
		return nil, errors.New("Material Painter gave no result")
	}
	return &out, nil
}

// Ping checks that a Material Painter agent server answers here.
func (c *Client) Ping() error {
	out, err := c.post("initialize", map[string]any{
		"protocolVersion": "2025-06-18",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "ps2cc", "version": "1"},
	})
	if err != nil {
		return err
	}
	if out.Result.ServerInfo == nil || out.Result.ServerInfo.Name != "material-painter" {
		return errors.New("something else answers on Material Painter's port")
	}
	return nil
}

// Call runs one tool and returns its text; a tool error becomes an error.
func (c *Client) Call(tool string, args map[string]any) (string, error) {
	if args == nil {
		args = map[string]any{}
	}
	out, err := c.post("tools/call", map[string]any{"name": tool, "arguments": args})
	if err != nil {
		return "", err
	}
	var text []string
	for _, ct := range out.Result.Content {
		if ct.Type == "text" || ct.Text != "" {
			text = append(text, ct.Text)
		}
	}
	joined := strings.Join(text, "\n")
	if out.Result.IsError {
		return "", fmt.Errorf("Material Painter %s: %s", tool, joined)
	}
	return joined, nil
}

// Layer is one entry of Material Painter's layer stack.
type Layer struct {
	Index   int    `json:"index"`
	Name    string `json:"name"`
	Folder  *int   `json:"folder"`
	Content struct {
		Kind string `json:"kind"`
	} `json:"content"`
}

// Layers lists the stack, bottom first.
func (c *Client) Layers() ([]Layer, error) {
	text, err := c.Call("get_state", nil)
	if err != nil {
		return nil, err
	}
	var st struct {
		Layers []Layer `json:"layers_bottom_to_top"`
	}
	if err := json.Unmarshal([]byte(text), &st); err != nil {
		return nil, fmt.Errorf("Material Painter's state is not JSON: %w", err)
	}
	return st.Layers, nil
}

// Connect finds a running Material Painter (any of its ten ports), starting
// it from exe if none answers, and waits up to `wait` for its agent server.
// A Material Painter that runs with agent control off gives ErrAgentsOff.
func Connect(exe string, wait time.Duration) (*Client, error) {
	if c, err := find(); c != nil || errors.Is(err, ErrAgentsOff) {
		return c, err
	}
	if exe == "" {
		return nil, ErrNotFound
	}
	cmd := exec.Command(exe)
	cmd.Dir = filepath.Dir(exe)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("could not start Material Painter: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	deadline := time.Now().Add(wait)
	for time.Now().Before(deadline) {
		time.Sleep(500 * time.Millisecond)
		if c, err := find(); c != nil || errors.Is(err, ErrAgentsOff) {
			return c, err
		}
	}
	return nil, ErrNoAnswer
}

// find looks for an answering agent server on Material Painter's ports.
func find() (*Client, error) {
	var off error
	for p := FirstPort; p < FirstPort+10; p++ {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", p), 300*time.Millisecond)
		if err != nil {
			continue
		}
		conn.Close()
		c := NewClient(p)
		c.HTTP.Timeout = 3 * time.Second
		err = c.Ping()
		if err == nil {
			return NewClient(p), nil
		}
		if errors.Is(err, ErrAgentsOff) {
			off = err
		}
	}
	return nil, off
}

// Session is one paint target's folder.
type Session struct {
	Dir string
}

// SessionDir is the folder of a character's paint target under root.
func SessionDir(root, character, target string) string {
	return filepath.Join(root, "paint", safeName(character), safeName(target))
}

func (s Session) Mesh() string      { return filepath.Join(s.Dir, "mesh.obj") }
func (s Session) Reference() string { return filepath.Join(s.Dir, "reference.png") }
func (s Session) Project() string   { return filepath.Join(s.Dir, "project.mpp") }
func (s Session) ExportDir() string { return filepath.Join(s.Dir, "export") }

// Write stores the mesh and the reference texture for the session.
func (s Session) Write(obj, referencePNG []byte) error {
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(s.Mesh(), obj, 0o644); err != nil {
		return err
	}
	return os.WriteFile(s.Reference(), referencePNG, 0o644)
}

// HasProject reports whether the session has a saved Material Painter project.
func (s Session) HasProject() bool {
	_, err := os.Stat(s.Project())
	return err == nil
}

// Open sets Material Painter up for the session: its saved project (the
// artist's layers) with the current mesh, or a new document; the document
// size; the reference fill at the bottom with the current texture; a paint
// layer above it when there is none; then saves the project.
func (s Session) Open(c *Client, size int) error {
	fresh := !s.HasProject()
	if !fresh {
		if _, err := c.Call("open_project", map[string]any{"path": s.Project()}); err != nil {
			return err
		}
	}
	// The character's current shape (load_mesh keeps the layers).
	if _, err := c.Call("load_mesh", map[string]any{"path": s.Mesh()}); err != nil {
		return err
	}
	layers, err := c.Layers()
	if err != nil {
		return err
	}
	if fresh {
		// A new document comes with a starter layer; the session's own layers replace it.
		for i := len(layers) - 1; i >= 0; i-- {
			if _, err := c.Call("delete_layer", map[string]any{"index": layers[i].Index}); err != nil {
				return err
			}
		}
		layers = nil
	}
	// The document size (it also re-bakes the mesh maps at that size).
	if _, err := c.Call("bake", map[string]any{"resolution": size}); err != nil {
		return err
	}
	ref := -1
	for _, l := range layers {
		if l.Name == RefLayer {
			ref = l.Index
		}
	}
	if ref < 0 {
		if _, err := c.Call("add_layer", map[string]any{"kind": "fill", "name": RefLayer, "index": 0}); err != nil {
			return err
		}
		// Everything already there moved up by one.
		for i := range layers {
			layers[i].Index++
		}
		layers = append([]Layer{{Index: 0, Name: RefLayer}}, layers...)
		ref = 0
	}
	// Exactly the reference: no colour or part variation, plain dielectric.
	if _, err := c.Call("update_layer", map[string]any{
		"index": ref, "metallic": 0, "roughness": 0.8, "color_variation": 0, "part_variation": 0,
		"images": map[string]any{"color": s.Reference()},
	}); err != nil {
		return err
	}
	if len(layers) == 1 {
		if _, err := c.Call("add_layer", map[string]any{"kind": "paint", "name": PaintLayer}); err != nil {
			return err
		}
	}
	_, err = c.Call("save_project", map[string]any{"path": s.Project()})
	return err
}

var baseColorFile = regexp.MustCompile(`(?i)(base_?colou?r|albedo|basemap)\.png$`)

// Collect exports the base colour at the session's size (no padding, so
// texels nobody painted stay exactly the reference) and saves the project.
// It returns the exported PNG's path.
func (s Session) Collect(c *Client, size int) (string, error) {
	_ = os.RemoveAll(s.ExportDir())
	if err := os.MkdirAll(s.ExportDir(), 0o755); err != nil {
		return "", err
	}
	text, err := c.Call("export_textures", map[string]any{
		"folder": s.ExportDir(), "preset": ExportPreset, "format": "png", "bit_depth": 8, "size": size, "padding": "none", "prefix": "ps2cc",
	})
	if err != nil {
		return "", err
	}
	var res struct {
		Files []string `json:"files"`
	}
	if err := json.Unmarshal([]byte(text), &res); err != nil {
		return "", fmt.Errorf("Material Painter's export answer is not JSON: %w", err)
	}
	found := ""
	for _, f := range res.Files {
		if baseColorFile.MatchString(f) {
			found = f
		}
	}
	if found == "" {
		return "", fmt.Errorf("Material Painter exported no base colour (%s)", strings.Join(res.Files, ", "))
	}
	if _, err := c.Call("save_project", map[string]any{"path": s.Project()}); err != nil {
		return "", err
	}
	return found, nil
}

var unsafeChars = regexp.MustCompile(`[^\w.-]+`)

func safeName(s string) string {
	s = strings.Trim(unsafeChars.ReplaceAllString(s, "_"), "._")
	if s == "" {
		return "untitled"
	}
	if len(s) > 64 {
		s = s[:64]
	}
	return s
}
