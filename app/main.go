// PS2CC desktop app entry point (Wails v2: Go backend + WebView2 frontend).
package main

import (
	"embed"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"github.com/ps2cc/ps2cc/app/backend/logging"
	"github.com/ps2cc/ps2cc/app/backend/paths"
	"github.com/ps2cc/ps2cc/app/backend/server"
)

//go:embed all:frontend/dist
var frontendAssets embed.FS

func main() {
	layout, err := paths.Resolve()
	if err != nil {
		fmt.Fprintln(os.Stderr, "PS2CC:", err)
		os.Exit(1)
	}
	logger, err := logging.New(layout.Logs)
	if err != nil {
		fmt.Fprintln(os.Stderr, "PS2CC: cannot open log:", err)
		os.Exit(1)
	}
	app := newApp(layout, logger)
	err = wails.Run(&options.App{
		Title:     "PS2CC",
		Width:     1600,
		Height:    960,
		MinWidth:  1280,
		MinHeight: 720,
		AssetServer: &assetserver.Options{
			Assets:  frontendAssets,
			Handler: &server.Handler{Core: layout.CoreAssets, Library: layout.Library, Characters: layout.Characters},
		},
		BackgroundColour: &options.RGBA{R: 18, G: 18, B: 20, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []interface{}{app},
		DragAndDrop:      &options.DragAndDrop{EnableFileDrop: true, DisableWebViewDrop: false},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			Theme:                windows.Dark,
		},
	})
	if err != nil {
		logger.Errorf("wails: %v", err)
		fmt.Fprintln(os.Stderr, "PS2CC:", err)
		os.Exit(1)
	}
}
