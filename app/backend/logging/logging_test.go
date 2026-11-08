package logging

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDailyRotationAndPrune(t *testing.T) {
	dir := t.TempDir()
	day := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	l := &Logger{dir: dir, now: func() time.Time { return day }}
	for i := 0; i < KeepDays+5; i++ {
		l.Log("info", "hello")
		day = day.Add(24 * time.Hour)
	}
	_ = l.Close()
	files, _ := filepath.Glob(filepath.Join(dir, "ps2cc-*.log"))
	if len(files) != KeepDays {
		t.Fatalf("kept %d files, want %d", len(files), KeepDays)
	}
	data, err := os.ReadFile(files[len(files)-1])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "[INFO] hello") {
		t.Errorf("unexpected log content %q", data)
	}
}
