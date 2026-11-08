// Package library imports user files into Documents\PS2CC\Library (PRD 4.4, F10):
// files are copied (never referenced in place), converted to PNG, size-checked
// and given a thumbnail.
package library

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "image/gif" // decoders registered for import

	"github.com/ps2cc/ps2cc/app/backend/paths"
)

// MaxImageSide is the largest accepted image dimension (PRD F10).
const MaxImageSide = 8192

// MaxImportBytes caps a single import.
const MaxImportBytes = 256 << 20

// ThumbSize is the longest side of generated thumbnails.
const ThumbSize = 160

// Item is one library entry.
type Item struct {
	ID       string `json:"id"`   // "user:<kind>/<name>"
	Kind     string `json:"kind"` // skins, overlays, ...
	Name     string `json:"name"`
	File     string `json:"file"` // relative to the library root, forward slashes
	Thumb    string `json:"thumb"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	HasAlpha bool   `json:"hasAlpha"`
	Imported string `json:"imported"` // RFC 3339
}

// ImportError is a user-facing validation failure.
type ImportError struct{ Msg string }

func (e *ImportError) Error() string { return e.Msg }

// Library manages one library root.
type Library struct{ Root string }

func validKind(kind string) bool {
	for _, k := range paths.LibraryKinds {
		if k == kind {
			return true
		}
	}
	return false
}

// imageKinds are the library kinds that hold images (the rest hold meshes or JSON).
var imageKinds = map[string]bool{"skins": true, "overlays": true, "garment-textures": true, "hair-atlases": true, "photos": true, "backgrounds": true}

// ImportImage copies an image into the library as PNG and returns its entry.
func (l *Library) ImportImage(kind, src string) (*Item, error) {
	if !validKind(kind) || !imageKinds[kind] {
		return nil, &ImportError{fmt.Sprintf("%q is not an image library", kind)}
	}
	st, err := os.Stat(src)
	if err != nil {
		return nil, err
	}
	if st.Size() > MaxImportBytes {
		return nil, &ImportError{"file is larger than 256 MB"}
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return nil, err
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, &ImportError{"unsupported image format: use PNG or JPG"}
	}
	if format != "png" && format != "jpeg" && format != "gif" {
		return nil, &ImportError{fmt.Sprintf("unsupported image format %q: use PNG or JPG", format)}
	}
	if cfg.Width > MaxImageSide || cfg.Height > MaxImageSide {
		return nil, &ImportError{fmt.Sprintf("image is %dx%d; the maximum is %d px per side", cfg.Width, cfg.Height, MaxImageSide)}
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, &ImportError{"the image could not be decoded"}
	}
	base := strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))
	name := paths.SafeName(base)
	sum := sha256.Sum256(data)
	stem := fmt.Sprintf("%s_%s", name, hex.EncodeToString(sum[:4]))
	dir := filepath.Join(l.Root, kind)
	if err := os.MkdirAll(filepath.Join(dir, ".thumbs"), 0o755); err != nil {
		return nil, err
	}
	dest := filepath.Join(dir, stem+".png")
	if err := writePNG(dest, img); err != nil {
		return nil, err
	}
	thumb := filepath.Join(dir, ".thumbs", stem+".png")
	if err := writePNG(thumb, thumbnail(img, ThumbSize)); err != nil {
		return nil, err
	}
	return &Item{
		ID:       "user:" + kind + "/" + stem,
		Kind:     kind,
		Name:     base,
		File:     kind + "/" + stem + ".png",
		Thumb:    kind + "/.thumbs/" + stem + ".png",
		Width:    cfg.Width,
		Height:   cfg.Height,
		HasAlpha: hasAlpha(img),
		Imported: now(),
	}, nil
}

// ImportFile copies a non-image asset (garment mesh, hairstyle JSON) as-is.
func (l *Library) ImportFile(kind, src string, allowedExt []string) (*Item, error) {
	if !validKind(kind) {
		return nil, &ImportError{fmt.Sprintf("unknown library %q", kind)}
	}
	ext := strings.ToLower(filepath.Ext(src))
	ok := false
	for _, a := range allowedExt {
		if ext == a {
			ok = true
		}
	}
	if !ok {
		return nil, &ImportError{fmt.Sprintf("unsupported file type %q (allowed: %s)", ext, strings.Join(allowedExt, ", "))}
	}
	in, err := os.Open(src)
	if err != nil {
		return nil, err
	}
	defer in.Close()
	stem := paths.SafeName(strings.TrimSuffix(filepath.Base(src), filepath.Ext(src)))
	dest := filepath.Join(l.Root, kind, stem+ext)
	out, err := os.Create(dest)
	if err != nil {
		return nil, err
	}
	n, copyErr := io.Copy(out, io.LimitReader(in, MaxImportBytes+1))
	closeErr := out.Close()
	if copyErr != nil {
		return nil, copyErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if n > MaxImportBytes {
		_ = os.Remove(dest)
		return nil, &ImportError{"file is larger than 256 MB"}
	}
	return &Item{ID: "user:" + kind + "/" + stem, Kind: kind, Name: stem, File: kind + "/" + stem + ext, Imported: now()}, nil
}

// List returns the image entries of one library kind (newest first).
func (l *Library) List(kind string) ([]Item, error) {
	if !validKind(kind) {
		return nil, &ImportError{fmt.Sprintf("unknown library %q", kind)}
	}
	files, err := filepath.Glob(filepath.Join(l.Root, kind, "*"))
	if err != nil {
		return nil, err
	}
	var items []Item
	for _, f := range files {
		st, err := os.Stat(f)
		if err != nil || st.IsDir() || strings.HasSuffix(f, AtlasSuffix) || strings.HasSuffix(f, ".bin") || strings.HasSuffix(f, ".tmp") {
			continue // sidecars and garment data belong to their entry
		}
		stem := strings.TrimSuffix(filepath.Base(f), filepath.Ext(f))
		item := Item{ID: "user:" + kind + "/" + stem, Kind: kind, Name: stem, File: kind + "/" + filepath.Base(f), Imported: st.ModTime().UTC().Format(time.RFC3339)}
		if _, err := os.Stat(filepath.Join(l.Root, kind, ".thumbs", stem+".png")); err == nil {
			item.Thumb = kind + "/.thumbs/" + stem + ".png"
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Imported > items[j].Imported })
	return items, nil
}

// Delete removes an entry by its relative file path.
func (l *Library) Delete(rel string) error {
	p, err := paths.SafeJoin(l.Root, rel)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	stem := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
	_ = os.Remove(filepath.Join(filepath.Dir(p), ".thumbs", stem+".png"))
	_ = os.Remove(filepath.Join(filepath.Dir(p), stem+AtlasSuffix))
	if strings.HasSuffix(p, ".json") {
		_ = os.Remove(filepath.Join(filepath.Dir(p), stem+".bin")) // a garment's data
	}
	return nil
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func writePNG(path string, img image.Image) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(f, img); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func hasAlpha(img image.Image) bool {
	switch m := img.(type) {
	case *image.YCbCr, *image.Gray, *image.CMYK:
		return false
	case *image.NRGBA:
		for i := 3; i < len(m.Pix); i += 4 {
			if m.Pix[i] != 255 {
				return true
			}
		}
		return false
	}
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y += 4 {
		for x := b.Min.X; x < b.Max.X; x += 4 {
			if _, _, _, a := img.At(x, y).RGBA(); a != 0xffff {
				return true
			}
		}
	}
	return false
}

// thumbnail does a box-filter downscale (good enough for library previews).
func thumbnail(src image.Image, size int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= size && h <= size {
		out := image.NewNRGBA(image.Rect(0, 0, w, h))
		draw.Draw(out, out.Bounds(), src, b.Min, draw.Src)
		return out
	}
	scale := float64(size) / float64(max(w, h))
	tw, th := max(1, int(float64(w)*scale)), max(1, int(float64(h)*scale))
	out := image.NewNRGBA(image.Rect(0, 0, tw, th))
	for ty := 0; ty < th; ty++ {
		y0, y1 := ty*h/th, max(ty*h/th+1, (ty+1)*h/th)
		for tx := 0; tx < tw; tx++ {
			x0, x1 := tx*w/tw, max(tx*w/tw+1, (tx+1)*w/tw)
			var r, g, bl, a, n uint64
			for y := y0; y < y1; y += max(1, (y1-y0)/4) {
				for x := x0; x < x1; x += max(1, (x1-x0)/4) {
					cr, cg, cb, ca := src.At(b.Min.X+x, b.Min.Y+y).RGBA()
					r, g, bl, a, n = r+uint64(cr), g+uint64(cg), bl+uint64(cb), a+uint64(ca), n+1
				}
			}
			i := out.PixOffset(tx, ty)
			out.Pix[i] = uint8(r / n >> 8)
			out.Pix[i+1] = uint8(g / n >> 8)
			out.Pix[i+2] = uint8(bl / n >> 8)
			out.Pix[i+3] = uint8(a / n >> 8)
		}
	}
	return out
}

// EncodeJPEG is used for renders that do not need alpha.
func EncodeJPEG(w io.Writer, img image.Image) error {
	return jpeg.Encode(w, img, &jpeg.Options{Quality: 92})
}
