// Package fbx writes binary FBX 7.4 for skinned characters (PRD 6.3).
//
// encode.go is a port of Blender's io_scene_fbx/encode_bin.py (GPL): the
// binary node records with typed properties, zlib-compressed arrays, the
// header and the footer. writer.go builds the object graph the way
// export_fbx_bin.py does, limited to what a skinned character needs.
package fbx

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"math"
)

// Version is the FBX file version written (7.4, what Unity and Blender use).
const Version = 7400

var (
	headMagic = []byte("Kaydara FBX Binary  \x00\x1a\x00")
	footID    = []byte{0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e}
	footMagic = []byte{0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b}
	// FileID is fixed (Blender writes a constant too) so output is deterministic.
	fileID = []byte{0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1}
)

// blockSentinel ends a list of child records (13 zero bytes before FBX 7.5).
const blockSentinelLen = 13

// arrayCompressMin: arrays of at least this many bytes are zlib-compressed (as Blender does).
const arrayCompressMin = 128

// Node is one FBX record: a name, typed properties and child records.
type Node struct {
	Name     string
	props    [][]byte // each: type code + payload
	Children []*Node
}

// NewNode makes a node with properties (see the add helpers for types).
func NewNode(name string, props ...any) *Node {
	n := &Node{Name: name}
	for _, p := range props {
		n.Add(p)
	}
	return n
}

// Child appends and returns a new child node.
func (n *Node) Child(name string, props ...any) *Node {
	c := NewNode(name, props...)
	n.Children = append(n.Children, c)
	return c
}

// Add appends one property. Supported Go types map to FBX type codes:
// bool C, int16 Y, int32 I, int64 L, float32 F, float64 D, string S, []byte R,
// []int32 i, []int64 l, []float32 f, []float64 d, []bool b.
func (n *Node) Add(p any) {
	var b bytes.Buffer
	le := binary.LittleEndian
	switch v := p.(type) {
	case bool:
		b.WriteByte('C')
		if v {
			b.WriteByte(1)
		} else {
			b.WriteByte(0)
		}
	case int16:
		b.WriteByte('Y')
		_ = binary.Write(&b, le, v)
	case int32:
		b.WriteByte('I')
		_ = binary.Write(&b, le, v)
	case int:
		b.WriteByte('I')
		_ = binary.Write(&b, le, int32(v))
	case int64:
		b.WriteByte('L')
		_ = binary.Write(&b, le, v)
	case float32:
		b.WriteByte('F')
		_ = binary.Write(&b, le, v)
	case float64:
		b.WriteByte('D')
		_ = binary.Write(&b, le, v)
	case string:
		b.WriteByte('S')
		_ = binary.Write(&b, le, uint32(len(v)))
		b.WriteString(v)
	case []byte:
		b.WriteByte('R')
		_ = binary.Write(&b, le, uint32(len(v)))
		b.Write(v)
	case []int32:
		raw := make([]byte, len(v)*4)
		for i, x := range v {
			le.PutUint32(raw[i*4:], uint32(x))
		}
		writeArray(&b, 'i', len(v), raw)
	case []int64:
		raw := make([]byte, len(v)*8)
		for i, x := range v {
			le.PutUint64(raw[i*8:], uint64(x))
		}
		writeArray(&b, 'l', len(v), raw)
	case []float32:
		raw := make([]byte, len(v)*4)
		for i, x := range v {
			le.PutUint32(raw[i*4:], math.Float32bits(x))
		}
		writeArray(&b, 'f', len(v), raw)
	case []float64:
		raw := make([]byte, len(v)*8)
		for i, x := range v {
			le.PutUint64(raw[i*8:], math.Float64bits(x))
		}
		writeArray(&b, 'd', len(v), raw)
	case []bool:
		raw := make([]byte, len(v))
		for i, x := range v {
			if x {
				raw[i] = 1
			}
		}
		writeArray(&b, 'b', len(v), raw)
	default:
		panic("fbx: unsupported property type")
	}
	n.props = append(n.props, b.Bytes())
}

func writeArray(b *bytes.Buffer, code byte, count int, raw []byte) {
	le := binary.LittleEndian
	b.WriteByte(code)
	_ = binary.Write(b, le, uint32(count))
	if len(raw) >= arrayCompressMin {
		var z bytes.Buffer
		w, _ := zlib.NewWriterLevel(&z, zlib.DefaultCompression)
		_, _ = w.Write(raw)
		_ = w.Close()
		_ = binary.Write(b, le, uint32(1))
		_ = binary.Write(b, le, uint32(z.Len()))
		b.Write(z.Bytes())
		return
	}
	_ = binary.Write(b, le, uint32(0))
	_ = binary.Write(b, le, uint32(len(raw)))
	b.Write(raw)
}

func (n *Node) propsLen() int {
	t := 0
	for _, p := range n.props {
		t += len(p)
	}
	return t
}

// size of the record when written: header (3x u32 + name length byte + name) + props + children (+ sentinel).
func (n *Node) size(isLast bool) int {
	s := 13 + len(n.Name) + n.propsLen()
	if len(n.Children) > 0 {
		for i, c := range n.Children {
			s += c.size(i == len(n.Children)-1)
		}
		s += blockSentinelLen
	} else if len(n.props) == 0 && !isLast {
		s += blockSentinelLen
	}
	return s
}

func (n *Node) write(w *bytes.Buffer, isLast bool) {
	start := w.Len()
	end := start + n.size(isLast)
	le := binary.LittleEndian
	_ = binary.Write(w, le, uint32(end))
	_ = binary.Write(w, le, uint32(len(n.props)))
	_ = binary.Write(w, le, uint32(n.propsLen()))
	w.WriteByte(byte(len(n.Name)))
	w.WriteString(n.Name)
	for _, p := range n.props {
		w.Write(p)
	}
	writeChildren(w, n.Children, len(n.props) == 0, isLast)
}

// writeChildren follows encode_bin.py's _write_children: a sentinel after a child
// list, or after an empty record that is not the last of its list.
func writeChildren(w *bytes.Buffer, children []*Node, noProps, isLast bool) {
	if len(children) > 0 {
		for i, c := range children {
			c.write(w, i == len(children)-1)
		}
		w.Write(make([]byte, blockSentinelLen))
	} else if noProps && !isLast {
		w.Write(make([]byte, blockSentinelLen))
	}
}

// Encode writes a complete binary FBX file from the top-level nodes.
func Encode(top []*Node) []byte {
	var w bytes.Buffer
	w.Write(headMagic)
	_ = binary.Write(&w, binary.LittleEndian, uint32(Version))
	// The root's children are the top-level records; a sentinel closes them.
	writeChildren(&w, top, false, false)
	w.Write(footID)
	w.Write(make([]byte, 4))
	pad := ((w.Len() + 15) &^ 15) - w.Len()
	if pad == 0 {
		pad = 16
	}
	w.Write(make([]byte, pad))
	_ = binary.Write(&w, binary.LittleEndian, uint32(Version))
	w.Write(make([]byte, 120))
	w.Write(footMagic)
	return w.Bytes()
}
