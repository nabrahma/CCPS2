// Package logging writes daily-rotated log files to %LOCALAPPDATA%\PS2CC\logs (PRD 7).
package logging

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// KeepDays is how many daily log files are kept.
const KeepDays = 14

// Logger is a small, concurrency-safe daily file logger.
type Logger struct {
	mu   sync.Mutex
	dir  string
	day  string
	file *os.File
	now  func() time.Time
}

// New opens (or creates) today's log file in dir.
func New(dir string) (*Logger, error) {
	l := &Logger{dir: dir, now: time.Now}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return l, l.rotate()
}

func (l *Logger) rotate() error {
	day := l.now().Format("2006-01-02")
	if day == l.day && l.file != nil {
		return nil
	}
	if l.file != nil {
		_ = l.file.Close()
	}
	f, err := os.OpenFile(filepath.Join(l.dir, "ps2cc-"+day+".log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	l.file = f
	l.day = day
	l.prune()
	return nil
}

func (l *Logger) prune() {
	entries, err := filepath.Glob(filepath.Join(l.dir, "ps2cc-*.log"))
	if err != nil || len(entries) <= KeepDays {
		return
	}
	sort.Strings(entries)
	for _, old := range entries[:len(entries)-KeepDays] {
		_ = os.Remove(old)
	}
}

// Log writes one line: timestamp, level, message.
func (l *Logger) Log(level, msg string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := l.rotate(); err != nil {
		fmt.Fprintln(os.Stderr, "log rotate failed:", err)
		return
	}
	level = strings.ToUpper(level)
	line := fmt.Sprintf("%s [%s] %s\n", l.now().Format(time.RFC3339), level, strings.ReplaceAll(msg, "\n", "\n    "))
	_, _ = l.file.WriteString(line)
}

// Infof logs at INFO.
func (l *Logger) Infof(format string, args ...any) { l.Log("info", fmt.Sprintf(format, args...)) }

// Errorf logs at ERROR.
func (l *Logger) Errorf(format string, args ...any) { l.Log("error", fmt.Sprintf(format, args...)) }

// Close closes the current file.
func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return nil
	}
	err := l.file.Close()
	l.file = nil
	return err
}
