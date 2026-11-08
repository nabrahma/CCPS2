package fbx

import (
	"bytes"
	"math"
	"math/rand"
	"testing"

	"github.com/ps2cc/ps2cc/app/backend/exportscene"
)

func TestDecomposeRoundTrip(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	for i := 0; i < 2000; i++ {
		m := rigid(r)
		tr, rot, sc := decompose(m)
		back := compose(tr, rot, sc)
		for k := range m {
			if math.Abs(m[k]-back[k]) > 1e-9 {
				t.Fatalf("matrix %d: element %d %v != %v (rot %v)", i, k, m[k], back[k], rot)
			}
		}
	}
}

// compose rebuilds T * Rz * Ry * Rx * S (FBX eEulerXYZ) from decompose's output.
func compose(t, rot, s [3]float64) [16]float64 {
	rad := math.Pi / 180
	cx, sx := math.Cos(rot[0]*rad), math.Sin(rot[0]*rad)
	cy, sy := math.Cos(rot[1]*rad), math.Sin(rot[1]*rad)
	cz, sz := math.Cos(rot[2]*rad), math.Sin(rot[2]*rad)
	rx := [16]float64{1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1}
	ry := [16]float64{cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1}
	rz := [16]float64{cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}
	sc := [16]float64{s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1}
	m := mul4(rz, mul4(ry, mul4(rx, sc)))
	m[12], m[13], m[14] = t[0], t[1], t[2]
	return m
}

func TestDeterministicOutput(t *testing.T) {
	for seed := int64(0); seed < 20; seed++ {
		a, err := Write(randomScene(seed))
		if err != nil {
			t.Fatal(err)
		}
		b, _ := Write(randomScene(seed))
		if !bytes.Equal(a, b) {
			t.Fatalf("seed %d: two writes differ", seed)
		}
		// A different creation time changes only the time fields.
		s := randomScene(seed)
		s.CreationTime = "2030-01-02 03:04:05:678"
		c, _ := Write(s)
		if len(c) != len(a) {
			t.Fatalf("seed %d: creation time changed the file size", seed)
		}
		diff := 0
		for i := range a {
			if a[i] != c[i] {
				diff++
			}
		}
		if diff == 0 || diff > 24 {
			t.Fatalf("seed %d: %d bytes differ with a new creation time", seed, diff)
		}
	}
}

func TestMessageRoundTrip(t *testing.T) {
	for seed := int64(0); seed < 50; seed++ {
		s := randomScene(seed)
		msg, err := exportscene.Encode(s)
		if err != nil {
			t.Fatal(err)
		}
		d, err := exportscene.Decode(msg)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		a, _ := Write(s)
		b, _ := Write(d)
		if !bytes.Equal(a, b) {
			t.Fatalf("seed %d: decoded scene writes a different file", seed)
		}
	}
}

func TestHeaderAndFooter(t *testing.T) {
	out, err := Write(randomScene(3))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(out, []byte("Kaydara FBX Binary  \x00\x1a\x00")) {
		t.Fatal("missing FBX magic")
	}
	if !bytes.HasSuffix(out, footMagic) {
		t.Fatal("missing footer magic")
	}
}

// The FBX SDK (Unity) rejects a file whose top-level CreationTime does not match the
// fixed footer id; it must stay Blender's constant whatever the creation time.
func TestFooterCreationTime(t *testing.T) {
	s := randomScene(1)
	s.CreationTime = "2031-05-06 07:08:09:010"
	out, err := Write(s)
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte("CreationTime"), 'S', byte(len(footerTime)), 0, 0, 0)
	want = append(want, footerTime...)
	if !bytes.Contains(out, want) {
		t.Fatal("top-level CreationTime is not the footer constant")
	}
}
