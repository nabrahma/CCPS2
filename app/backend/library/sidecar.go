package library

import (
	"encoding/json"
	"errors"
	"fmt"
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
func checkDocument(data []byte, format string) error {
	if len(data) > MaxDocumentBytes {
		return &ImportError{"document is larger than 1 MB"}
	}
	var head struct {
		Format string `json:"format"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return &ImportError{fmt.Sprintf("invalid JSON: %v", err)}
	}
	if head.Format != format {
		return &ImportError{fmt.Sprintf("expected a %s document, got %q", format, head.Format)}
	}
	return nil
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
	if err := checkDocument(data, "ps2cc.hair/1"); err != nil {
		return nil, err
	}
	stem := paths.SafeName(strings.TrimSuffix(name, HairstyleExt))
	if stem == "" {
		return nil, &ImportError{"the hairstyle needs a name"}
	}
	dir := filepath.Join(l.Root, "hairstyles")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, stem+HairstyleExt), data, 0o644); err != nil {
		return nil, err
	}
	return &Item{ID: "user:hairstyles/" + stem, Kind: "hairstyles", Name: stem, File: "hairstyles/" + stem + HairstyleExt, Imported: now()}, nil
}

// ReadDocument returns a JSON document stored in the library (a .ps2hair or atlas sidecar).
func (l *Library) ReadDocument(rel string) ([]byte, error) {
	if !strings.HasSuffix(rel, HairstyleExt) && !strings.HasSuffix(rel, AtlasSuffix) {
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
