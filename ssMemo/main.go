package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	appVersion := "V0.1216.1"
	appTitle := "ssMemo " + appVersion

	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  appTitle,
		Width:  1024,
		Height: 768,

		// [중요] 배경 투명 설정
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},

		OnStartup: app.startup,
		Assets:    assets,
		Bind: []interface{}{
			app,
		},
		// 윈도우 전용 옵션
		Windows: &windows.Options{
			WebviewIsTransparent: true,         // 웹뷰 투명 활성화
			WindowIsTranslucent:  true,         // 창 투명 활성화
			BackdropType:         windows.None, // 블러 효과 제거
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
