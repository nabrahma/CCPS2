package library

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestAtlasSidecar(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	src := filepath.Join(t.TempDir(), "my atlas.png")
	writeTestPNG(t, src, 64, 64, 128)
	item, err := lib.ImportImage("hair-atlases", src)
	if err != nil {
		t.Fatal(err)
	}
	if data, err := lib.LoadAtlas(item.File); err != nil || data != nil {
		t.Fatalf("no atlas yet: got %q, %v", data, err)
	}
	doc := []byte(`{"format":"ps2cc.atlas/1","texture":"x","regions":[]}`)
	rel, err := lib.SaveAtlas(item.File, doc)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := lib.LoadAtlas(item.File); err != nil || string(got) != string(doc) {
		t.Fatalf("round trip: %q, %v", got, err)
	}
	if got, err := lib.ReadDocument(rel); err != nil || string(got) != string(doc) {
		t.Fatalf("read document: %q, %v", got, err)
	}
	// The sidecar is not listed as an item, and goes away with its image.
	items, _ := lib.List("hair-atlases")
	if len(items) != 1 {
		t.Fatalf("want 1 item, got %d", len(items))
	}
	if err := lib.Delete(item.File); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(lib.Root, filepath.FromSlash(rel))); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("sidecar should be deleted with its image: %v", err)
	}
}

func TestAtlasRejects(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	src := filepath.Join(t.TempDir(), "a.png")
	writeTestPNG(t, src, 16, 16, 255)
	item, err := lib.ImportImage("hair-atlases", src)
	if err != nil {
		t.Fatal(err)
	}
	var ie *ImportError
	for _, bad := range [][]byte{[]byte(`not json`), []byte(`{"format":"ps2cc.hair/1"}`)} {
		if _, err := lib.SaveAtlas(item.File, bad); !errors.As(err, &ie) {
			t.Fatalf("%s: want ImportError, got %v", bad, err)
		}
	}
	if _, err := lib.SaveAtlas("../escape.png", []byte(`{"format":"ps2cc.atlas/1"}`)); err == nil {
		t.Fatal("path escape must be rejected")
	}
	if _, err := lib.SaveAtlas("hair-atlases/missing.png", []byte(`{"format":"ps2cc.atlas/1"}`)); err == nil {
		t.Fatal("atlas for a missing image must be rejected")
	}
	if _, err := lib.ReadDocument("hair-atlases/a.png"); err == nil {
		t.Fatal("only documents can be read")
	}
}

func TestHairstyle(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	doc := []byte(`{"format":"ps2cc.hair/1","style":{"name":"Mine"}}`)
	item, err := lib.SaveHairstyle("My style!", doc)
	if err != nil {
		t.Fatal(err)
	}
	if item.File != "hairstyles/My style_.ps2hair" { // SafeName keeps spaces, replaces "!"
		t.Fatalf("file %q", item.File)
	}
	got, err := lib.ReadDocument(item.File)
	if err != nil || string(got) != string(doc) {
		t.Fatalf("round trip %q %v", got, err)
	}
	items, err := lib.List("hairstyles")
	if err != nil || len(items) != 1 {
		t.Fatalf("list %v %v", items, err)
	}
	if _, err := lib.SaveHairstyle("x", []byte(`{"format":"ps2cc.atlas/1"}`)); err == nil {
		t.Fatal("wrong format must be rejected")
	}
}

func TestSaveGarmentStoresDocumentAndData(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	bin := []byte{1, 2, 3, 4}
	meta := []byte(`{"format":"ps2cc.proxy/1","id":"user:garment/coat_1a2b","name":"Coat","binary":"coat_1a2b.bin","byteLength":4}`)
	item, err := lib.SaveGarment(meta, bin)
	if err != nil {
		t.Fatal(err)
	}
	if item.File != "garments/coat_1a2b.json" || item.ID != "user:garment/coat_1a2b" || item.Name != "Coat" {
		t.Errorf("item %+v", item)
	}
	items, err := lib.List("garments")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].File != item.File {
		t.Errorf("the data file must not be listed: %+v", items)
	}
	if err := lib.Delete(item.File); err != nil {
		t.Fatal(err)
	}
	left, _ := filepath.Glob(filepath.Join(lib.Root, "garments", "*"))
	if len(left) != 0 {
		t.Errorf("left behind: %v", left)
	}
}

func TestSaveGarmentRejectsBadInput(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	for name, meta := range map[string]string{
		"format":    `{"format":"ps2cc.atlas/1","binary":"a.bin","byteLength":1}`,
		"traversal": `{"format":"ps2cc.proxy/1","binary":"../../evil.bin","byteLength":1}`,
		"extension": `{"format":"ps2cc.proxy/1","binary":"a.exe","byteLength":1}`,
		"length":    `{"format":"ps2cc.proxy/1","binary":"a.bin","byteLength":99}`,
	} {
		if _, err := lib.SaveGarment([]byte(meta), []byte{1}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if left, _ := filepath.Glob(filepath.Join(lib.Root, "garments", "*")); len(left) != 0 {
		t.Errorf("wrote %v", left)
	}
}
