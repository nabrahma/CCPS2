// Command ps2cc-export writes character exports from saved export messages
// (*.ps2exp, the binary message the app sends to the backend). The Unity
// harness uses it to fill tests/UnityHarness/Assets/PS2CC from the test
// characters in app/backend/fbx/testdata/characters.
//
//	go run ./cmd/ps2cc-export -out <folder> <file.ps2exp>...
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/ps2cc/ps2cc/app/backend/exporter"
	"github.com/ps2cc/ps2cc/app/backend/exportscene"
)

func main() {
	out := flag.String("out", "", "folder to write <Name>/ exports into")
	flag.Parse()
	if *out == "" || flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: ps2cc-export -out <folder> <file.ps2exp>...")
		os.Exit(2)
	}
	for _, f := range flag.Args() {
		msg, err := os.ReadFile(f)
		if err != nil {
			fail(f, err)
		}
		s, err := exportscene.Decode(msg)
		if err != nil {
			fail(f, err)
		}
		res, err := exporter.Write(s, *out)
		if err != nil {
			fail(f, err)
		}
		fmt.Printf("%s -> %s (%d files, %d bytes)\n", f, res.Dir, len(res.Files), res.Bytes)
	}
}

func fail(f string, err error) {
	fmt.Fprintf(os.Stderr, "%s: %v\n", f, err)
	os.Exit(1)
}
