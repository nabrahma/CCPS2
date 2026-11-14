package library

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Material Studio's materials (Part 2 F20): the document and its diffuse are
// saved together, the document points at the diffuse, the material is listed
// once (not its image), and deleting it removes both.
func TestMaterialRoundTrip(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	src := filepath.Join(t.TempDir(), "d.png")
	writeTestPNG(t, src, 64, 64, 255)
	png, _ := os.ReadFile(src)
	doc := []byte(`{"format":"ps2cc.material/1","material":{"name":"My denim","kind":"denim","diffuse":"anything.png","tileMetres":0.2}}`)
	item, err := lib.SaveMaterial("My denim", doc, png)
	if err != nil {
		t.Fatal(err)
	}
	if item.File != "materials/My denim.ps2mat" || item.ID != "user:materials/My denim" {
		t.Fatalf("item %+v", item)
	}
	got, err := lib.ReadDocument(item.File)
	if err != nil {
		t.Fatal(err)
	}
	var back struct {
		Format   string `json:"format"`
		Material struct {
			Diffuse    string  `json:"diffuse"`
			TileMetres float64 `json:"tileMetres"`
		} `json:"material"`
	}
	if err := json.Unmarshal(got, &back); err != nil {
		t.Fatal(err)
	}
	if back.Material.Diffuse != "My denim_diffuse.png" || back.Material.TileMetres != 0.2 {
		t.Fatalf("document %s", got)
	}
	if _, err := os.Stat(filepath.Join(lib.Root, "materials", "My denim_diffuse.png")); err != nil {
		t.Fatal(err)
	}
	items, err := lib.List("materials")
	if err != nil || len(items) != 1 || items[0].Thumb == "" {
		t.Fatalf("list: %+v %v", items, err)
	}
	if err := lib.Delete(item.File); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(lib.Root, "materials", "My denim_diffuse.png")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the diffuse should go with its material: %v", err)
	}
}

func TestMaterialRejects(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	src := filepath.Join(t.TempDir(), "d.png")
	writeTestPNG(t, src, 16, 16, 255)
	png, _ := os.ReadFile(src)
	good := []byte(`{"format":"ps2cc.material/1","material":{"name":"x"}}`)
	cases := []struct {
		name string
		doc  []byte
		img  []byte
	}{
		{"x", []byte(`{"format":"ps2cc.hair/2"}`), png},
		{"x", []byte(`{"format":"ps2cc.material/1"}`), png},
		{"x", good, []byte("not a png")},
		{"   ", good, png},
	}
	for i, c := range cases {
		if _, err := lib.SaveMaterial(c.name, c.doc, c.img); err == nil {
			t.Fatalf("case %d was accepted", i)
		}
	}
	// A name cannot leave the materials folder.
	item, err := lib.SaveMaterial("../../escape", good, png)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(item.File, "..") {
		t.Fatalf("file %q", item.File)
	}
}

func TestOutfitRoundTrip(t *testing.T) {
	lib := &Library{Root: t.TempDir()}
	doc := []byte(`{"format":"ps2cc.outfit/1","outfit":{"label":"Weekend","garments":[]}}`)
	item, err := lib.SaveOutfit("Weekend", doc)
	if err != nil {
		t.Fatal(err)
	}
	if item.File != "outfits/Weekend.ps2outfit" {
		t.Fatalf("item %+v", item)
	}
	if got, err := lib.ReadDocument(item.File); err != nil || string(got) != string(doc) {
		t.Fatalf("read: %q %v", got, err)
	}
	if _, err := lib.SaveOutfit("Bad", []byte(`{"format":"ps2cc.preset/1"}`)); err == nil {
		t.Fatal("a preset was saved as an outfit")
	}
	if items, _ := lib.List("outfits"); len(items) != 1 {
		t.Fatalf("list: %+v", items)
	}
}
