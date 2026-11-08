package fbx

import (
	"testing"

	"github.com/ps2cc/ps2cc/app/backend/exportscene"
)

// FuzzDecodeWrite: no message may crash the decoder or the writer, and every
// accepted message must produce a well-formed file (header and footer). The
// ufbx read-back variant is FuzzExportMessage (build tag ufbx).
func FuzzDecodeWrite(f *testing.F) {
	for seed := int64(0); seed < 6; seed++ {
		msg, err := exportscene.Encode(randomScene(seed))
		if err != nil {
			f.Fatal(err)
		}
		f.Add(msg)
	}
	f.Add([]byte("PS2CCEX1"))
	f.Fuzz(func(t *testing.T, msg []byte) {
		s, err := exportscene.Decode(msg)
		if err != nil {
			return
		}
		out, err := Write(s)
		if err != nil {
			t.Fatalf("write: %v", err)
		}
		if len(out) < 100 || string(out[:18]) != "Kaydara FBX Binary" {
			t.Fatal("malformed output")
		}
	})
}
