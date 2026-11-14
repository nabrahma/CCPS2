package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/ps2cc/ps2cc/app/backend/paths"
	"github.com/ps2cc/ps2cc/app/backend/projects"
	"github.com/ps2cc/ps2cc/app/backend/settings"
)

// ---------------------------------------------------------------- data folder (M18)

// DataFolder says where characters, the library and settings are kept.
type DataFolder struct {
	Path      string `json:"path"`
	Default   string `json:"default"`
	IsDefault bool   `json:"isDefault"`
	// FromEnv: PS2CC_HOME chose it, so it cannot be changed in the app.
	FromEnv bool `json:"fromEnv"`
	// Fallback explains why the chosen folder is not used this time ("" when it is).
	Fallback string `json:"fallback"`
}

// DataFolder returns where the app keeps your work.
func (a *App) DataFolder() DataFolder {
	l := a.layout
	return DataFolder{Path: l.Root, Default: l.Default, IsDefault: strings.EqualFold(filepath.Clean(l.Root), filepath.Clean(l.Default)), FromEnv: l.FromEnv, Fallback: l.Fallback}
}

// ChooseDataFolder asks for a folder and says what using it would do (nil when cancelled).
func (a *App) ChooseDataFolder() (*paths.MovePlan, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose where PS2CC keeps your characters and library", DefaultDirectory: filepath.Dir(a.layout.Root)})
	if err != nil || dir == "" {
		return nil, err
	}
	return a.PlanDataFolder(dir)
}

// PlanDataFolder says what using a folder as the data folder would do, without doing it.
func (a *App) PlanDataFolder(dir string) (*paths.MovePlan, error) {
	if a.layout.FromEnv {
		return nil, errors.New("the data folder is set by PS2CC_HOME; change that variable instead")
	}
	return paths.PlanMove(a.layout.Root, dir, a.layout.CoreAssets)
}

// MoveDataFolder makes a folder the data folder from the next start: your
// characters, library and settings are copied there and each copy is checked
// (a folder that already holds PS2CC data is used as it is). The current
// folder is left as it is. Progress is sent as "datafolder:progress" events.
func (a *App) MoveDataFolder(dir string) (*paths.MovePlan, error) {
	plan, err := a.PlanDataFolder(dir)
	if err != nil {
		return nil, err
	}
	if plan.Mode == "copy" {
		a.log.Infof("copying the data folder %s to %s (%d files)", a.layout.Root, plan.Root, plan.Files)
		_, err := paths.CopyTree(a.layout.Root, plan.Root, func(done, total int) {
			if a.ctx != nil && (done%25 == 0 || done == total) {
				runtime.EventsEmit(a.ctx, "datafolder:progress", done, total)
			}
		})
		if err != nil {
			a.log.Errorf("copy data folder: %v", err)
			return nil, err
		}
		// Recent characters that were in the old folder are in the new one now.
		st := settings.NewStore(filepath.Join(plan.Root, "settings.json"))
		if s, err := st.Load(); err == nil {
			for i, p := range s.RecentFiles {
				if rel, err := filepath.Rel(a.layout.Root, p); err == nil && !strings.HasPrefix(rel, "..") {
					s.RecentFiles[i] = filepath.Join(plan.Root, rel)
				}
			}
			_ = st.Save(s)
		}
	}
	if err := paths.WriteLocation(a.layout.LocalAppData, plan.Root); err != nil {
		return nil, err
	}
	a.log.Infof("data folder is %s from the next start (%s)", plan.Root, plan.Mode)
	return plan, nil
}

// UseDefaultDataFolder goes back to Documents\PS2CC from the next start (nothing is copied or deleted).
func (a *App) UseDefaultDataFolder() error {
	if a.layout.FromEnv {
		return errors.New("the data folder is set by PS2CC_HOME; change that variable instead")
	}
	return paths.WriteLocation(a.layout.LocalAppData, "")
}

// Restart starts PS2CC again and closes this window (to use a new data folder).
func (a *App) Restart() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Env = os.Environ()
	if err := cmd.Start(); err != nil {
		return err
	}
	a.log.Infof("restarting (new process %d)", cmd.Process.Pid)
	go func() {
		time.Sleep(200 * time.Millisecond)
		runtime.Quit(a.ctx)
	}()
	return nil
}

// ---------------------------------------------------------------- characters anywhere (M18)

// OpenedCharacter is a character read from a file, with where it was.
type OpenedCharacter struct {
	Path string `json:"path"`
	Doc  string `json:"doc"`
}

// SaveCharacterTo saves over a character file wherever it is (Ctrl+S on a character opened or saved there).
func (a *App) SaveCharacterTo(path, doc string) (string, error) {
	if !strings.EqualFold(filepath.Ext(path), ".ps2char") {
		return "", errors.New("not a character file")
	}
	if err := a.store.SaveAs(path, []byte(doc)); err != nil {
		a.log.Errorf("save %s: %v", path, err)
		return "", err
	}
	a.remember(path)
	a.log.Infof("saved %s", path)
	return path, nil
}

// remember puts a character file at the top of the recent list (kept in settings).
func (a *App) remember(path string) {
	s, err := a.settings.Load()
	if err != nil {
		return
	}
	list := []string{path}
	for _, p := range s.RecentFiles {
		if !strings.EqualFold(p, path) {
			list = append(list, p)
		}
	}
	s.RecentFiles = list
	if err := a.settings.Save(s); err != nil {
		a.log.Errorf("recent files: %v", err)
	}
}

// recentOutside lists recent character files that are not in the data folder's Characters folder.
func (a *App) recentOutside() []projects.CharacterInfo {
	s, err := a.settings.Load()
	if err != nil {
		return nil
	}
	var out []projects.CharacterInfo
	for _, p := range s.RecentFiles {
		if rel, err := filepath.Rel(a.layout.Characters, p); err == nil && !strings.HasPrefix(rel, "..") {
			continue
		}
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			continue
		}
		out = append(out, projects.CharacterInfo{Name: strings.TrimSuffix(filepath.Base(p), filepath.Ext(p)), Path: p, Modified: st.ModTime().UTC().Format(time.RFC3339), External: true})
	}
	return out
}
