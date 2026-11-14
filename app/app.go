package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/ps2cc/ps2cc/app/backend/exporter"
	"github.com/ps2cc/ps2cc/app/backend/exportscene"
	"github.com/ps2cc/ps2cc/app/backend/garments"
	"github.com/ps2cc/ps2cc/app/backend/library"
	"github.com/ps2cc/ps2cc/app/backend/logging"
	"github.com/ps2cc/ps2cc/app/backend/materialpainter"
	"github.com/ps2cc/ps2cc/app/backend/paths"
	"github.com/ps2cc/ps2cc/app/backend/projects"
	"github.com/ps2cc/ps2cc/app/backend/settings"
)

// App is bound to the frontend; every exported method becomes a JS function.
type App struct {
	ctx      context.Context
	layout   *paths.Layout
	log      *logging.Logger
	store    *projects.Store
	lib      *library.Library
	settings *settings.Store
	session  *projects.Session
	crashed  bool
}

// AppInfo is returned to the frontend at startup.
type AppInfo struct {
	Version          string `json:"version"`
	CoreAssetsURL    string `json:"coreAssetsUrl"`
	LibraryURL       string `json:"libraryUrl"`
	Root             string `json:"root"`
	LogDir           string `json:"logDir"`
	RecoveryPath     string `json:"recoveryPath"`
	RecoveryModified string `json:"recoveryModified"`
	CharactersURL    string `json:"charactersUrl"`
	// Pid of this process (the M9 crash-recovery test ends it the hard way).
	Pid int `json:"pid"`
}

const appVersion = "0.19.1"

func newApp(layout *paths.Layout, log *logging.Logger) *App {
	return &App{
		layout:   layout,
		log:      log,
		store:    projects.NewStore(layout.Characters),
		lib:      &library.Library{Root: layout.Library},
		settings: settings.NewStore(layout.Settings),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	session, crashed, err := projects.BeginSession(a.layout.Root)
	if err != nil {
		a.log.Errorf("session marker: %v", err)
	}
	a.session, a.crashed = session, crashed
	a.log.Infof("PS2CC %s started; core assets at %s; previous session crashed: %v", appVersion, a.layout.CoreAssets, crashed)
}

func (a *App) shutdown(_ context.Context) {
	if err := a.session.End(); err != nil {
		a.log.Errorf("end session: %v", err)
	}
	a.log.Infof("PS2CC shut down cleanly")
	_ = a.log.Close()
}

// Info returns paths and, after a crash, the autosave to offer for recovery.
func (a *App) Info() AppInfo {
	info := AppInfo{Version: appVersion, CoreAssetsURL: "/core", LibraryURL: "/library", CharactersURL: "/characters", Root: a.layout.Root,
		LogDir: a.layout.Logs, Pid: os.Getpid()}
	if a.crashed {
		if p, t, err := a.store.LatestAutosave(); err == nil && p != "" {
			info.RecoveryPath, info.RecoveryModified = p, t.Format(time.RFC3339)
		}
	}
	return info
}

// Log writes a frontend log line to the daily log file.
func (a *App) Log(level, message string) { a.log.Log(level, "[ui] "+message) }

// ---------------------------------------------------------------- characters

// SaveCharacter saves to Characters\<name>\<name>.ps2char and returns the path.
func (a *App) SaveCharacter(doc string) (string, error) {
	p, err := a.store.Save([]byte(doc))
	if err != nil {
		a.log.Errorf("save character: %v", err)
		return "", err
	}
	a.log.Infof("saved %s", p)
	return p, nil
}

// SaveCharacterAs asks for a path and saves there.
func (a *App) SaveCharacterAs(doc, suggestedName string) (string, error) {
	p, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save character",
		DefaultDirectory: a.layout.Characters,
		DefaultFilename:  paths.SafeName(suggestedName) + ".ps2char",
		Filters:          []runtime.FileFilter{{DisplayName: "PS2CC character (*.ps2char)", Pattern: "*.ps2char"}},
	})
	if err != nil || p == "" {
		return "", err
	}
	if err := a.store.SaveAs(p, []byte(doc)); err != nil {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(p), ".ps2char") {
		p += ".ps2char"
	}
	a.remember(p)
	return p, nil
}

// OpenCharacter shows an open dialog and returns the file and its text (nil when cancelled).
func (a *App) OpenCharacter() (*OpenedCharacter, error) {
	p, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Open character",
		DefaultDirectory: a.layout.Characters,
		Filters:          []runtime.FileFilter{{DisplayName: "PS2CC character (*.ps2char)", Pattern: "*.ps2char"}},
	})
	if err != nil || p == "" {
		return nil, err
	}
	doc, err := a.LoadCharacter(p)
	if err != nil {
		return nil, err
	}
	return &OpenedCharacter{Path: p, Doc: doc}, nil
}

// LoadCharacter reads a .ps2char from disk.
func (a *App) LoadCharacter(path string) (string, error) {
	data, err := a.store.Load(path)
	if err != nil {
		a.log.Errorf("load %s: %v", path, err)
		return "", err
	}
	a.remember(path)
	return string(data), nil
}

// ListCharacters lists saved characters for the browser.
// Characters saved outside the data folder are listed too, from the recent files.
func (a *App) ListCharacters() ([]projects.CharacterInfo, error) {
	list, err := a.store.List()
	if err != nil {
		return nil, err
	}
	return append(list, a.recentOutside()...), nil
}

// Autosave writes a rotating autosave (10 kept per character).
func (a *App) Autosave(doc string) (string, error) {
	p, err := a.store.Autosave([]byte(doc))
	if err != nil {
		a.log.Errorf("autosave: %v", err)
	}
	return p, err
}

// SaveRender writes a PNG (base64) to Characters\<name>\renders and returns its path.
func (a *App) SaveRender(characterName, fileName, pngBase64 string) (string, error) {
	return a.saveCharacterPNG(characterName, "renders", fileName, pngBase64)
}

// SaveTexture writes a PNG (base64), such as the exported head and body skin
// textures, to Characters\<name>\textures and returns its path.
func (a *App) SaveTexture(characterName, fileName, pngBase64 string) (string, error) {
	return a.saveCharacterPNG(characterName, "textures", fileName, pngBase64)
}

func (a *App) saveCharacterPNG(characterName, sub, fileName, pngBase64 string) (string, error) {
	data, err := decodePNG(pngBase64)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(a.store.Dir(characterName), sub)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := paths.SafeName(strings.TrimSuffix(fileName, ".png")) + ".png"
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		return "", err
	}
	a.log.Infof("%s saved %s", strings.TrimSuffix(sub, "s"), p)
	return p, nil
}

// SaveImageAs asks where to save a PNG (base64), such as a UV template, and
// writes it there. It returns the path, or "" when the user cancels.
func (a *App) SaveImageAs(suggestedName, pngBase64 string) (string, error) {
	data, err := decodePNG(pngBase64)
	if err != nil {
		return "", err
	}
	p, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save image",
		DefaultDirectory: a.layout.Root,
		DefaultFilename:  paths.SafeName(strings.TrimSuffix(suggestedName, ".png")) + ".png",
		Filters:          []runtime.FileFilter{{DisplayName: "PNG image (*.png)", Pattern: "*.png"}},
	})
	if err != nil || p == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(p), ".png") {
		p += ".png"
	}
	if err := os.WriteFile(p, data, 0o644); err != nil {
		return "", err
	}
	a.log.Infof("image saved %s", p)
	return p, nil
}

// SaveLookAs asks where to save a look (.ps2look JSON, PRD Part 2 F14) and
// writes it there. It returns the path, or "" when the user cancels.
func (a *App) SaveLookAs(suggestedName, lookJSON string) (string, error) {
	if !json.Valid([]byte(lookJSON)) {
		return "", errors.New("the look is not valid JSON")
	}
	p, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save look",
		DefaultDirectory: a.layout.Root,
		DefaultFilename:  paths.SafeName(strings.TrimSuffix(suggestedName, ".ps2look")) + ".ps2look",
		Filters:          []runtime.FileFilter{{DisplayName: "PS2CC look (*.ps2look)", Pattern: "*.ps2look"}},
	})
	if err != nil || p == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(p), ".ps2look") {
		p += ".ps2look"
	}
	if err := os.WriteFile(p, []byte(lookJSON), 0o644); err != nil {
		return "", err
	}
	a.log.Infof("look saved %s", p)
	return p, nil
}

// decodePNG decodes base64 image data and checks that it is a PNG.
func decodePNG(pngBase64 string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(pngBase64)
	if err != nil {
		return nil, fmt.Errorf("invalid image data: %w", err)
	}
	if len(data) < 8 || string(data[1:4]) != "PNG" {
		return nil, errors.New("image is not a PNG")
	}
	return data, nil
}

// ---------------------------------------------------------------- library

// PickAndImport opens a file dialog and imports the chosen images into a library kind.
func (a *App) PickAndImport(kind string) ([]library.Item, error) {
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import into " + kind,
		Filters: []runtime.FileFilter{{DisplayName: "Images (*.png, *.jpg)", Pattern: "*.png;*.jpg;*.jpeg"}},
	})
	if err != nil {
		return nil, err
	}
	var out []library.Item
	for _, f := range files {
		item, err := a.ImportPath(kind, f)
		if err != nil {
			return out, err
		}
		out = append(out, *item)
	}
	return out, nil
}

// ImportPath imports one file (drag and drop from Explorer passes real paths).
func (a *App) ImportPath(kind, path string) (*library.Item, error) {
	var item *library.Item
	var err error
	switch kind {
	case "hairstyles":
		item, err = a.lib.ImportFile(kind, path, []string{".ps2hair", ".json"})
	default:
		item, err = a.lib.ImportImage(kind, path)
	}
	if err != nil {
		a.log.Errorf("import %s into %s: %v", path, kind, err)
		return nil, err
	}
	a.log.Infof("imported %s as %s", path, item.ID)
	return item, nil
}

// ImportBytes imports a file dropped into the WebView (no path available).
func (a *App) ImportBytes(kind, fileName, base64Data string) (*library.Item, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return nil, fmt.Errorf("invalid file data: %w", err)
	}
	if len(data) > library.MaxImportBytes {
		return nil, &library.ImportError{Msg: "file is larger than 256 MB"}
	}
	tmpDir, err := os.MkdirTemp("", "ps2cc-import-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)
	tmp := filepath.Join(tmpDir, filepath.Base(fileName))
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return nil, err
	}
	return a.ImportPath(kind, tmp)
}

// GarmentFile is a garment mesh read from a file: little-endian typed arrays in base64.
type GarmentFile struct {
	Name      string `json:"name"`
	Positions string `json:"positions"` // f32
	UVs       string `json:"uvs"`       // f32
	FaceVerts string `json:"faceVerts"` // u32
	FaceUVs   string `json:"faceUvs"`   // u32
	HasUVs    bool   `json:"hasUvs"`
	Triangles int    `json:"triangles"`
}

// PickGarmentFile asks for a garment mesh; "" means cancelled.
func (a *App) PickGarmentFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import garment",
		Filters: []runtime.FileFilter{{DisplayName: "Meshes (*.obj, *.fbx, *.glb)", Pattern: "*.obj;*.fbx;*.glb"}},
	})
}

// ReadGarment reads a garment mesh for the engine to bind (PRD F4).
func (a *App) ReadGarment(path string) (*GarmentFile, error) {
	m, err := garments.Read(path)
	if err != nil {
		a.log.Errorf("read garment %s: %v", path, err)
		return nil, err
	}
	a.log.Infof("read garment %s: %d triangles", path, m.Triangles())
	return &GarmentFile{
		Name:      strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)),
		Positions: encodeFloats(m.Positions),
		UVs:       encodeFloats(m.UVs),
		FaceVerts: encodeUints(m.FaceVerts),
		FaceUVs:   encodeUints(m.FaceUVs),
		HasUVs:    m.HasUVs,
		Triangles: m.Triangles(),
	}, nil
}

// SaveGarment stores an imported garment in the library.
func (a *App) SaveGarment(metaJSON, binBase64 string) (*library.Item, error) {
	bin, err := base64.StdEncoding.DecodeString(binBase64)
	if err != nil {
		return nil, fmt.Errorf("invalid garment data: %w", err)
	}
	item, err := a.lib.SaveGarment([]byte(metaJSON), bin)
	if err != nil {
		a.log.Errorf("save garment: %v", err)
		return nil, err
	}
	a.log.Infof("imported garment %s", item.ID)
	return item, nil
}

// SaveBaseBody asks where to save the base body OBJ and writes it (PRD F4). "" means cancelled.
func (a *App) SaveBaseBody(objText string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export base body",
		DefaultFilename: "ps2cc_base_body.obj",
		Filters:         []runtime.FileFilter{{DisplayName: "Wavefront OBJ (*.obj)", Pattern: "*.obj"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if err := os.WriteFile(path, []byte(objText), 0o644); err != nil {
		return "", err
	}
	a.log.Infof("wrote the base body to %s", path)
	return path, nil
}

func encodeFloats(v []float32) string {
	out := make([]byte, 0, len(v)*4)
	for _, f := range v {
		out = binary.LittleEndian.AppendUint32(out, math.Float32bits(f))
	}
	return base64.StdEncoding.EncodeToString(out)
}

func encodeUints(v []uint32) string {
	out := make([]byte, 0, len(v)*4)
	for _, u := range v {
		out = binary.LittleEndian.AppendUint32(out, u)
	}
	return base64.StdEncoding.EncodeToString(out)
}

// ListLibrary lists one library kind.
func (a *App) ListLibrary(kind string) ([]library.Item, error) { return a.lib.List(kind) }

// DeleteLibraryItem removes a library file (and its atlas sidecar, if any).
func (a *App) DeleteLibraryItem(file string) error { return a.lib.Delete(file) }

// SaveAtlas writes a hair card atlas (JSON) beside its library image and returns the sidecar path.
func (a *App) SaveAtlas(imageFile, atlasJSON string) (string, error) {
	return a.lib.SaveAtlas(imageFile, []byte(atlasJSON))
}

// LoadAtlas returns the atlas saved beside a library image, or "" when there is none.
func (a *App) LoadAtlas(imageFile string) (string, error) {
	data, err := a.lib.LoadAtlas(imageFile)
	return string(data), err
}

// SaveHairstyle stores a .ps2hair document in the library.
func (a *App) SaveHairstyle(name, styleJSON string) (*library.Item, error) {
	item, err := a.lib.SaveHairstyle(name, []byte(styleJSON))
	if err == nil {
		a.log.Infof("hairstyle saved %s", item.File)
	}
	return item, err
}

// SaveOutfit stores a .ps2outfit document in the library (Part 2 F20).
func (a *App) SaveOutfit(name, outfitJSON string) (*library.Item, error) {
	item, err := a.lib.SaveOutfit(name, []byte(outfitJSON))
	if err == nil {
		a.log.Infof("outfit saved %s", item.File)
	}
	return item, err
}

// SaveMaterial stores a Material Studio material: its .ps2mat document and its era diffuse (PNG, base64).
func (a *App) SaveMaterial(name, materialJSON, diffuseBase64 string) (*library.Item, error) {
	png, err := base64.StdEncoding.DecodeString(diffuseBase64)
	if err != nil {
		return nil, fmt.Errorf("invalid image data: %w", err)
	}
	item, err := a.lib.SaveMaterial(name, []byte(materialJSON), png)
	if err == nil {
		a.log.Infof("material saved %s", item.File)
	}
	return item, err
}

// SavePreset stores a .ps2preset document in the library.
func (a *App) SavePreset(name, presetJSON string) (*library.Item, error) {
	item, err := a.lib.SavePreset(name, []byte(presetJSON))
	if err == nil {
		a.log.Infof("preset saved %s", item.File)
	}
	return item, err
}

// ReadLibraryDocument returns a .ps2hair, .ps2preset, .ps2mat, .ps2outfit or atlas document from the library.
func (a *App) ReadLibraryDocument(file string) (string, error) {
	data, err := a.lib.ReadDocument(file)
	return string(data), err
}

// ---------------------------------------------------------------- export (PRD 6)

// ExportCharacter writes the FBX, textures, sidecar and optional GLB from the
// engine's export message. target "" means <Unity project>/Assets/PS2CC from
// the settings. It returns the written files.
func (a *App) ExportCharacter(messageBase64, target string) (*exporter.Result, error) {
	msg, err := base64.StdEncoding.DecodeString(messageBase64)
	if err != nil {
		return nil, fmt.Errorf("invalid export data: %w", err)
	}
	scene, err := exportscene.Decode(msg)
	if err != nil {
		a.log.Errorf("export message: %v", err)
		return nil, err
	}
	if target == "" {
		st, err := a.settings.Load()
		if err != nil {
			return nil, err
		}
		if st.UnityProject == "" {
			return nil, errors.New("no Unity project is set: choose one in Export or pick a folder")
		}
		target = exporter.UnityTarget(st.UnityProject)
	}
	res, err := exporter.Write(scene, target)
	if err != nil {
		a.log.Errorf("export %s: %v", scene.Name, err)
		return nil, err
	}
	a.log.Infof("exported %s to %s (%d files, %d bytes)", scene.Name, res.Dir, len(res.Files), res.Bytes)
	return res, nil
}

// ChooseExportFolder asks for a folder to export into (instead of the Unity project).
func (a *App) ChooseExportFolder() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose a folder to export into", DefaultDirectory: a.layout.Characters})
}

// OpenFolder shows a folder in Explorer (for "Show exported files").
func (a *App) OpenFolder(dir string) {
	runtime.BrowserOpenURL(a.ctx, "file:///"+filepath.ToSlash(dir))
}

// ---------------------------------------------------------------- settings

// GetSettings returns the saved settings.
func (a *App) GetSettings() (settings.Settings, error) { return a.settings.Load() }

// SaveSettings persists settings.
func (a *App) SaveSettings(s settings.Settings) error { return a.settings.Save(s) }

// PickUnityProject asks for a Unity project folder (must contain Assets\).
func (a *App) PickUnityProject() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose your Unity project folder"})
	if err != nil || dir == "" {
		return "", err
	}
	if _, err := settings.CheckUnityProject(dir); err != nil {
		return "", err
	}
	return dir, nil
}

// CheckUnityProject validates a typed Unity project path (first-run setup) and
// returns the Unity version it was made with ("" when unknown).
func (a *App) CheckUnityProject(dir string) (string, error) { return settings.CheckUnityProject(dir) }

// OpenLogFolder opens the log folder in Explorer.
func (a *App) OpenLogFolder() {
	runtime.BrowserOpenURL(a.ctx, "file:///"+filepath.ToSlash(a.layout.Logs))
}

// PainterInfo says where Material Painter is (Texture Studio, D-115).
type PainterInfo struct {
	Exe   string `json:"exe"`
	Found bool   `json:"found"`
}

// PaintResult is what Material Painter painted, with the reference it painted over (PNG, base64).
type PaintResult struct {
	Painted   string `json:"painted"`
	Reference string `json:"reference"`
}

func (a *App) painterExe() string {
	s, _ := a.settings.Load()
	return materialpainter.FindExe(s.MaterialPainter)
}

// PainterStatus reports whether Material Painter was found.
func (a *App) PainterStatus() PainterInfo {
	exe := a.painterExe()
	return PainterInfo{Exe: exe, Found: exe != ""}
}

// PainterLocate asks for MaterialPainter.exe and remembers it. "" means cancelled.
func (a *App) PainterLocate() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Find Material Painter",
		Filters: []runtime.FileFilter{{DisplayName: "MaterialPainter.exe", Pattern: "*.exe"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	s, err := a.settings.Load()
	if err != nil {
		return "", err
	}
	s.MaterialPainter = path
	if err := a.settings.Save(s); err != nil {
		return "", err
	}
	return path, nil
}

// PainterEnableAgents turns on Material Painter's agent control (from its next start).
func (a *App) PainterEnableAgents() error {
	if err := materialpainter.EnableAgents(materialpainter.PrefsPath()); err != nil {
		return err
	}
	a.log.Infof("turned on agent control in Material Painter's preferences")
	return nil
}

// PainterHasSession reports whether a character's paint target has a saved Material Painter project.
func (a *App) PainterHasSession(character, target string) bool {
	return materialpainter.Session{Dir: materialpainter.SessionDir(a.layout.Root, character, target)}.HasProject()
}

// PainterOpen sends a mesh (OBJ text) and the texture to paint over (PNG,
// base64) to Material Painter, starting it if needed, at `size` pixels.
func (a *App) PainterOpen(character, target, objText, referenceBase64 string, size int) error {
	ref, err := base64.StdEncoding.DecodeString(referenceBase64)
	if err != nil {
		return fmt.Errorf("invalid reference image: %w", err)
	}
	s := materialpainter.Session{Dir: materialpainter.SessionDir(a.layout.Root, character, target)}
	if err := s.Write([]byte(objText), ref); err != nil {
		return err
	}
	c, err := materialpainter.Connect(a.painterExe(), 60*time.Second)
	if err != nil {
		return err
	}
	if err := s.Open(c, size); err != nil {
		return err
	}
	a.log.Infof("opened %s of %s in Material Painter (%s)", target, character, s.Dir)
	return nil
}

// PainterCollect takes the base colour back from Material Painter, at the size of the reference it was sent.
func (a *App) PainterCollect(character, target string) (*PaintResult, error) {
	s := materialpainter.Session{Dir: materialpainter.SessionDir(a.layout.Root, character, target)}
	ref, err := os.ReadFile(s.Reference())
	if err != nil {
		return nil, errors.New("nothing was sent to Material Painter for this yet")
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(ref))
	if err != nil {
		return nil, fmt.Errorf("the reference image is not a PNG: %w", err)
	}
	size := max(cfg.Width, cfg.Height)
	c, err := materialpainter.Connect("", 0)
	if err != nil {
		if errors.Is(err, materialpainter.ErrNotFound) {
			return nil, errors.New("material-painter:not-running: Material Painter is not running: open it again from PS2CC")
		}
		return nil, err
	}
	path, err := s.Collect(c, size)
	if err != nil {
		return nil, err
	}
	painted, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	a.log.Infof("took %s of %s back from Material Painter", target, character)
	return &PaintResult{Painted: base64.StdEncoding.EncodeToString(painted), Reference: base64.StdEncoding.EncodeToString(ref)}, nil
}
