# UI 對照與驗收

本作品係 web PWA。Safari 原生 HTML 控制項與自行實作 canvas 並存，並非 SwiftUI、UIKit 或 PencilKit。

| 使用位置   | 官方參考                                                                                                 | 實作                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Topics     | [Selection and input](https://developer.apple.com/design/human-interface-guidelines/selection-and-input) | fieldset、legend、label、原生 checkbox；整行可選                 |
| 主操作     | [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)                         | 原生 button；文字清楚，單一主要操作，44 CSS px 或以上觸控範圍    |
| 書寫工具   | [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)                       | 筆、擦膠、選取、Undo／Redo；筆粗使用原生 range，在 details 展開  |
| 版面       | [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)                           | safe-area-inset、橫直向調整、system font；畫布縮放與介面文字分離 |
| 答案／進度 | [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)                       | 答對／答錯文字、正確字母、保存狀態；不依賴顏色                   |
| 顏色       | [Color](https://developer.apple.com/design/human-interface-guidelines/color)                             | 中性底色、藍色操作提示；保留原卷白底及圖表原貌                   |
| 恢復       | [Launching](https://developer.apple.com/design/human-interface-guidelines/launching)                     | 恢復目前題目、草稿及各畫布視角；無開場動畫                       |
| 匯入／備份 | [File management](https://developer.apple.com/design/human-interface-guidelines/file-management)         | 系統 file picker、Share sheet 或下載；不重造檔案瀏覽器           |

## 必要自訂部分

### 資料操作（2026-09-05 修訂）

- 主題頁入口為「管理資料」，練習頁為「更多選項」。
- 用原生 HTML `popover=auto` 提供點外面關閉、Esc 關閉及 keyboard focus 行為；取代不會自動收起的 `details` 選單。
- 按「目前題目」「題庫」「備份」分組，各動作獨立；「匯入題庫」與「還原備份」有分開的 file input 及格式驗證。
- 還原採用原生 HTML `dialog`；標明會取代本機題庫、草稿及進度，不會合併；預設 focus 在取消。
- 備份準備完成只保留一個主要儲存／分享或下載動作；不用兩個近似下載按鈕競爭。
- 選單說明草稿及進度自動保存在本機；匯出備份不是日常保存的必需步驟。

依據：[Menus](https://developer.apple.com/design/human-interface-guidelines/menus)、[Writing](https://developer.apple.com/design/human-interface-guidelines/writing)、[Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)。

- Canvas 2D／Pointer Events 書寫、雙指移動縮放、筆跡 eraser／lasso。
- MC 2×2 選项排列，A–D 順序及文字固定；不複製 Kahoot 商標、四色皮膚或音效。
- SQ 橫線答案区及空白思考区；參考答案在題目位置展開，草稿保持可見。

## 已有 desktop 證據

Chromium 與 WebKit automation 覆蓋實際 import、MC 判分、SQ 畫筆、Undo／Redo、eraser、self-mark、重做、離線 shell、backup restore，以及 200% 介面文字不橫向溢出。私人真題畫面由 `scripts/pilot-qa.mjs` 產生於主工作區 Reports/Practice，不包含在 public build。

## 尚待 iPad 實機驗收

Apple Pencil Pro 實際延遲、手掌接觸、細字與化學式、雙指移動縮放、鎖屏後恢復、Home Screen offline 啟動、Files 分享、長時間書寫。Desktop WebKit 通過不等於 iPad 手感已通過；全量題庫擴展在此驗收之後。
