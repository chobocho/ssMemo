package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	_ "github.com/glebarez/go-sqlite" // ✅ Pure Go 드라이버 (해결책 1번)
	"github.com/pkg/browser"
	"github.com/wailsapp/wails/v2/pkg/runtime" // ✅ [추가] 런타임 패키지
)

// App struct
type App struct {
	ctx context.Context // ✅ 수정됨: 줄바꿈 및 타입 명시
	db  *sql.DB         // ✅ 수정됨: 별도 필드로 분리
}

// Note 구조체 (Frontend와 주고받을 데이터 모델)
type Note struct {
	ID      int    `json:"id"`
	Date    string `json:"date"` // YYYY-MM-DD 형식
	Content string `json:"content"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	var err error

	// DB 파일 열기 시도
	a.db, err = sql.Open("sqlite", "./ssmemo.db")
	if err != nil {
		// [수정] 에러 발생 시 앱을 끄지 않고 경고창 띄우기
		runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
			Type:    runtime.ErrorDialog,
			Title:   "DB Error",
			Message: "DB 연결 실패: " + err.Error(),
		})
		return
	}

	// 테이블 생성
	sqlStmt := `
	CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		date TEXT NOT NULL,
		content TEXT
	);
	`
	_, err = a.db.Exec(sqlStmt)
	if err != nil {
		// [수정] 테이블 생성 실패 시 경고창
		runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
			Type:    runtime.ErrorDialog,
			Title:   "DB Error",
			Message: "테이블 생성 실패: " + err.Error(),
		})
		return
	}

	// [추가] NOTEPAD 필드 확인 및 생성
	var count int
	err = a.db.QueryRow("SELECT COUNT(*) FROM notes WHERE date = 'NOTEPAD'").Scan(&count)
	if err == nil && count == 0 {
		_, _ = a.db.Exec("INSERT INTO notes(date, content) VALUES('NOTEPAD', '')")
	}
}

// shutdown: 앱 종료 시 DB 닫기 (main.go에서 호출 필요)
func (a *App) shutdown(ctx context.Context) {
	if a.db != nil {
		a.db.Close()
	}
}

// --- API Methods (Frontend에서 호출) ---

// GetNotesByMonth: 특정 년-월(YYYY-MM)에 해당하는 모든 메모를 가져옵니다.
func (a *App) GetNotesByMonth(yearMonth string) []Note {
	rows, err := a.db.Query("SELECT id, date, content FROM notes WHERE date LIKE ?", yearMonth+"%")
	if err != nil {
		log.Println("Query Error:", err)
		return []Note{}
	}
	defer rows.Close()

	var notes []Note
	for rows.Next() {
		var n Note
		err = rows.Scan(&n.ID, &n.Date, &n.Content)
		if err != nil {
			log.Println(err)
			continue
		}
		notes = append(notes, n)
	}
	return notes
}

// GetAllNotes: fetch all notes for search.
func (a *App) GetAllNotes() []Note {
	rows, err := a.db.Query("SELECT id, date, content FROM notes ORDER BY date ASC, id ASC")
	if err != nil {
		log.Println("Query Error:", err)
		return []Note{}
	}
	defer rows.Close()

	var notes []Note
	for rows.Next() {
		var n Note
		err = rows.Scan(&n.ID, &n.Date, &n.Content)
		if err != nil {
			log.Println(err)
			continue
		}
		notes = append(notes, n)
	}
	return notes
}

// GetNoteByDate: 특정 날짜의 메모를 가져옵니다.
func (a *App) GetNoteByDate(date string) Note {
	var n Note
	err := a.db.QueryRow("SELECT id, date, content FROM notes WHERE date = ?", date).Scan(&n.ID, &n.Date, &n.Content)
	if err != nil {
		return Note{}
	}
	return n
}

// SaveOrUpdateNoteByDate: 날짜를 기준으로 메모를 저장하거나 업데이트합니다.
func (a *App) SaveOrUpdateNoteByDate(date string, content string) string {
	var id int
	err := a.db.QueryRow("SELECT id FROM notes WHERE date = ?", date).Scan(&id)
	if err != nil {
		// 존재하지 않으면 삽입
		_, err = a.db.Exec("INSERT INTO notes(date, content) VALUES(?, ?)", date, content)
		if err != nil {
			return fmt.Sprintf("Error: %s", err)
		}
		return "Saved"
	}
	// 존재하면 업데이트
	_, err = a.db.Exec("UPDATE notes SET content = ? WHERE id = ?", content, id)
	if err != nil {
		return fmt.Sprintf("Error: %s", err)
	}
	log.Println("SaveOrUpdateNoteByDate: Updated")
	return "Updated"
}

// SaveNote: 메모 저장
func (a *App) SaveNote(date string, content string) string {
	if content == "" {
		return "Content is empty"
	}
	_, err := a.db.Exec("INSERT INTO notes(date, content) VALUES(?, ?)", date, content)
	if err != nil {
		return fmt.Sprintf("Error: %s", err)
	}
	return "Saved"
}

func (a *App) UpdateNote(id int, content string) string {
	if content == "" {
		return "Content is empty"
	}
	_, err := a.db.Exec("UPDATE notes SET content = ? WHERE id = ?", content, id)
	if err != nil {
		return fmt.Sprintf("Error: %s", err)
	}
	return "Updated"
}

// DeleteNote: 메모 삭제
func (a *App) DeleteNote(id int) string {
	_, err := a.db.Exec("DELETE FROM notes WHERE id = ?", id)
	if err != nil {
		return fmt.Sprintf("Error: %s", err)
	}
	return "Deleted"
}

func (a *App) ShowMessage(title string, message string) {
	runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:    runtime.InfoDialog,
		Title:   title,
		Message: message,
	})
}

func (a *App) OpenURL(url string) {
	log.Println("OpenURL: " + url)
	browser.OpenURL(url)
}

// Quit : 앱 종료 함수 (Frontend에서 호출)
func (a *App) Quit() {
	runtime.Quit(a.ctx)
}
