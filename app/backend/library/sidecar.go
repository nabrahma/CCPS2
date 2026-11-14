package library

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ps2cc/ps2cc/app/backend/paths"
)

// MaxDocumentBytes caps JSON documents stored in the library (atlas.json, .ps2hair).
const MaxDocumentBytes = 1 << 20

// garmentBinary is the only form of garment file name written to the library.
var garmentBinary = regexp.MustCompile(`^[A-Za-z0-9_-]+\.bin$`)

// AtlasSuffix names the hair card atlas sidecar written beside its PNG (PRD F5: "atlas.json beside the PNG").
const AtlasSuffix = ".atlas.json"

// HairstyleExt is the extension of saved hairstyles (PRD F5 step 8).
const HairstyleExt = ".ps2hair"

// PresetExt is the extension of saved user presets (PRD F1).
const PresetExt = ".ps2preset"

// MaterialExt is the extension of Material Studio's materials (Part 2 F20); the diffuse is <stem>_diffuse.png beside it.
const MaterialExt = ".ps2mat"

// MaterialDiffuseSuffix names a material's era diffuse beside its document.
const MaterialDiffuseSuffix = "_diffuse.png"

// OutfitExt is the extension of saved outfits (Part 2 F20).
const OutfitExt = ".ps2outfit"

// MaxMaterialSide is the largest diffuse a material may save.
const MaxMaterialSide = 4096

// SaveGarment stores an imported garment (PRD F4): its proxy document and
// binary, under the file names the document gives. The document goes last, so
// a garment is never listed before its data is on disk.
func (l *Library) SaveGarment(meta, bin []byte) (*Item, error) {
	if err := checkDocument(meta, "ps2cc.proxy/1"); err != nil {
		return nil, err
	}
	var head struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		Binary     string `json:"binary"`
		ByteLength int    `json:"byteLength"`
	}
	if err := json.Unmarshal(meta, &head); err != nil {
		return nil, &ImportError{fmt.Sprintf("invalid JSON: %v", err)}
	}
	if !garmentBinary.MatchString(head.Binary) {
		return nil, &ImportError{"invalid garment file name"}
	}
	if head.ByteLength != len(bin) || len(bin) > MaxImportBytes {
		return nil, &ImportError{"the garment data does not match its document"}
	}
	stem := strings.TrimSuffix(head.Binary, ".bin")
	dir := filepath.Join(l.Root, "garments")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	for _, f := range []struct {
		ext  string
		data []byte
	}{{".bin", bin}, {".json", meta}} {
		tmp := filepath.Join(dir, stem+f.ext+".tmp")
		if err := os.WriteFile(tmp, f.data, 0o644); err != nil {
			return nil, err
		}
		if err := os.Rename(tmp, filepath.Join(dir, stem+f.ext)); err != nil {
			return nil, err
		}
	}
	return &Item{ID: head.ID, Kind: "garments", Name: head.Name, File: "garments/" + stem + ".json", Imported: now()}, nil
}

// checkDocument validates a JSON document and its "format" field.
func checkDocument(data []byte, formats ...string) error {
	if len(data) > MaxDocumentBytes {
		return &ImportError{"document is larger than 1 MB"}
	}
	var head struct {
		Format string `json:"format"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return &ImportError{fmt.Sprintf("invalid JSON: %v", err)}
	}
	for _, f := range formats {
		if head.Format == f {
			return nil
		}
	}
	return &ImportError{fmt.Sprintf("expected a %s document, got %q", formats[len(formats)-1], head.Format)}
}

// SaveAtlas writes the atlas for a library image beside it as <stem>.atlas.json
// and returns the sidecar's relative path.
func (l *Library) SaveAtlas(imageRel string, data []byte) (string, error) {
	img, err := paths.SafeJoin(l.Root, imageRel)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(img); err != nil {
		return "", &ImportError{"the atlas image is not in the library"}
	}
	if err := checkDocument(data, "ps2cc.atlas/1"); err != nil {
		return "", err
	}
	side := strings.TrimSuffix(img, filepath.Ext(img)) + AtlasSuffix
	if err := os.WriteFile(side, data, 0o644); err != nil {
		return "", err
	}
	return strings.TrimSuffix(imageRel, filepath.Ext(imageRel)) + AtlasSuffix, nil
}

// LoadAtlas returns the atlas saved beside a library image, or nil when there is none.
func (l *Library) LoadAtlas(imageRel string) ([]byte, error) {
	img, err := paths.SafeJoin(l.Root, imageRel)
	if err != nil {
		return nil, err
	}
	data, err := readLimited(strings.TrimSuffix(img, filepath.Ext(img)) + AtlasSuffix)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return data, err
}

// SaveHairstyle stores a .ps2hair document under hairstyles/ and returns its item.
func (l *Library) SaveHairstyle(name string, data []byte) (*Item, error) {
	// Version 2 (Hair v2) adds locks, the scalp layer and an authored groom; version 1 files still load.
	return l.saveDocument("hairstyles", HairstyleExt, []string{"ps2cc.hair/1", "ps2cc.hair/2"}, "hairstyle", name, data)
}

// SaveOutfit stores a .ps2outfit document under outfits/ and returns its item.
func (l *Library) SaveOutfit(name string, data []byte) (*Item, error) {
	return l.saveDocument("outfits", OutfitExt, []string{"ps2cc.outfit/1"}, "outfit", name, data)
}

// SaveMaterial stores a Material Studio material: its era diffuse (a PNG) as
// materials/<stem>_diffuse.png, a thumbnail, then the document as
// materials/<stem>.ps2mat with its "diffuse" field pointing at the PNG. The
// document goes last, so a material is never listed before its image.
func (l *Library) SaveMaterial(name string, data, diffusePNG []byte) (*Item, error) {
	if err := checkDocument(data, "ps2cc.material/1"); err != nil {
		return nil, err
	}
	stem := paths.SafeName(strings.TrimSuffix(name, MaterialExt))
	if strings.TrimSpace(name) == "" || stem == "" {
		return nil, &ImportError{"the material needs a name"}
	}
	if len(diffusePNG) > MaxImportBytes {
		return nil, &ImportError{"the material image is larger than 256 MB"}
	}
	img, err := png.Decode(bytes.NewReader(diffusePNG))
	if err != nil {
		return nil, &ImportError{fmt.Sprintf("the material image is not a PNG: %v", err)}
	}
	if b := img.Bounds(); b.Dx() < 1 || b.Dy() < 1 || b.Dx() > MaxMaterialSide || b.Dy() > MaxMaterialSide {
		return nil, &ImportError{fmt.Sprintf("the material image must be at most %d px", MaxMaterialSide)}
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, &ImportError{fmt.Sprintf("invalid JSON: %v", err)}
	}
	mat, ok := doc["material"].(map[string]any)
	if !ok {
		return nil, &ImportError{"the material document has no material"}
	}
	mat["diffuse"] = stem + MaterialDiffuseSuffix
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(l.Root, "materials")
	if err := os.MkdirAll(filepath.Join(dir, ".thumbs"), 0o755); err != nil {
		return nil, err
	}
	if err := writeAtomic(filepath.Join(dir, stem+MaterialDiffuseSuffix), diffusePNG); err != nil {
		return nil, err
	}
	if err := writePNG(filepath.Join(dir, ".thumbs", stem+".png"), thumbnail(img, ThumbSize)); err != nil {
		return nil, err
	}
	if err := writeAtomic(filepath.Join(dir, stem+MaterialExt), out); err != nil {
		return nil, err
	}
	return &Item{ID: "user:materials/" + stem, Kind: "materials", Name: stem, File: "materials/" + stem + MaterialExt,
		Thumb: "materials/.thumbs/" + stem + ".png", Imported: now()}, nil
}

func writeAtomic(p string, data []byte) error {
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// SavePreset stores a .ps2preset document under presets/ and returns its item.
func (l *Library) SavePreset(name string, data []byte) (*Item, error) {
	return l.saveDocument("presets", PresetExt, []string{"ps2cc.preset/1"}, "preset", name, data)
}

func (l *Library) saveDocument(kind, ext string, formats []string, noun, name string, data []byte) (*Item, error) {
	if err := checkDocument(data, formats...); err != nil {
		return nil, err
	}
	stem := paths.SafeName(strings.TrimSuffix(name, ext))
	if stem == "" {
		return nil, &ImportError{"the " + noun + " needs a name"}
	}
	dir := filepath.Join(l.Root, kind)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, stem+ext), data, 0o644); err != nil {
		return nil, err
	}
	return &Item{ID: "user:" + kind + "/" + stem, Kind: kind, Name: stem, File: kind + "/" + stem + ext, Imported: now()}, nil
}

// ReadDocument returns a JSON document stored in the library (a .ps2hair, .ps2preset, .ps2mat, .ps2outfit or atlas sidecar).
func (l *Library) ReadDocument(rel string) ([]byte, error) {
	ok := false
	for _, ext := range []string{HairstyleExt, PresetExt, AtlasSuffix, MaterialExt, OutfitExt} {
		ok = ok || strings.HasSuffix(rel, ext)
	}
	if !ok {
		return nil, &ImportError{"not a library document"}
	}
	p, err := paths.SafeJoin(l.Root, rel)
	if err != nil {
		return nil, err
	}
	return readLimited(p)
}

func readLimited(p string) ([]byte, error) {
	st, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	if st.Size() > MaxDocumentBytes {
		return nil, &ImportError{"document is larger than 1 MB"}
	}
	return os.ReadFile(p)
}
