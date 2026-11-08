package library

import (
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func writeTestPNG(t *testing.T, path string, w, h int, alpha uint8) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 128, A: alpha})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

func TestImportImage(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(t.TempDir(), "my shirt.png")
	writeTestPNG(t, src, 300, 200, 200)
	lib := &Library{Root: root}
	item, err := lib.ImportImage("garment-textures", src)
	if err != nil {
		t.Fatal(err)
	}
	if item.Width != 300 || item.Height != 200 || !item.HasAlpha {
		t.Errorf("unexpected item %+v", item)
	}
	for _, rel := range []string{item.File, item.Thumb} {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			t.Errorf("missing %s", rel)
		}
	}
	items, err := lib.List("garment-textures")
	if err != nil || len(items) != 1 {
		t.Fatalf("list: %v %+v", err, items)
	}
	if err := lib.Delete(item.File); err != nil {
		t.Fatal(err)
	}
}

func TestImportRejects(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	dir := t.TempDir()
	notImage := filepath.Join(dir, "a.png")
	_ = os.WriteFile(notImage, []byte("not an image"), 0o644)
	var ie *ImportError
	if _, err := lib.ImportImage("skins", notImage); !errors.As(err, &ie) {
		t.Errorf("garbage should be rejected with ImportError, got %v", err)
	}
	if _, err := lib.ImportImage("hairstyles", notImage); !errors.As(err, &ie) {
		t.Errorf("non-image library should be rejected, got %v", err)
	}
	big := filepath.Join(dir, "big.png")
	writeTestPNG(t, big, MaxImageSide+1, 1, 255)
	if _, err := lib.ImportImage("skins", big); !errors.As(err, &ie) {
		t.Errorf("oversized image should be rejected, got %v", err)
	}
	if _, err := lib.ImportFile("garments", notImage, []string{".obj", ".fbx", ".glb"}); !errors.As(err, &ie) {
		t.Errorf("wrong extension should be rejected, got %v", err)
	}
}
