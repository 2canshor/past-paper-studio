# Past Paper Studio

零新增費用、離線優先嘅 iPad past-paper 練習 PWA。使用者多選 Topics，開始一個固定題池；MC 本地判分，SQ 手寫及 self-mark。已通過題目退出，目前題池清空後由使用者重新選 Topics。

## 目前狀態

第一階段可操作版本，包含完整 MC／SQ 流程、本地筆跡、shuffle、保存、備份及還原。私人試用題庫為兩科共 12 個視覺核對單位。**Apple Pencil／Home Screen 實機驗收未完成，全量題庫尚未完成。**

公開網站只提供空程式，無考卷、答案、OCR 或草稿。無帳戶、analytics、model calls、付費 API 或 server database。GitHub Pages 仍可產生一般網站連線紀錄。

## 日常使用

1. 在 iPad Safari 開啟網址，加入 Home Screen。
2. 從 Home Screen 開啟，再 import 私人 `.ppsbank` 一次。
3. 多選 Topics，按「開始」。
4. MC 點選答案後按「下一題」；SQ 按「查看答案」再 self-mark。
5. 隨時離開，重新開啟恢復原位。題池清空後可備份至 Files。

Apple Pencil 或 Mac 滑鼠可畫；手指不畫。雙指移動及縮放；Mac trackpad 滾動可移動，Ctrl＋滾動可縮放。細字可從「筆粗」調整。舊 attempts 在「更多 → 之前作答」。

Browser storage 可能被使用者清除或被系統回收；程式會請求 persistent storage，但仍需保留 `.ppsbackup`。按備份後，系統分享或下載畫面可能仍需要選擇目的地。

## 開發與測試

需要 Node.js 22.12 或更新版本。

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

`npm run build` 產生 `dist`，並加入具版本嘅 Service Worker。Active session 不強制 reload；關閉舊程式後才使用更新。Production build 掃描明顯私人檔案類型與來源資料夾。

Playwright 以真正停止測試 origin 驗證 offline reload；Chromium 另加 network offline。WebKit `setOffline` instrumentation 會在 Service Worker 之前拒絕 navigation，因此不使用該機制冒充 Safari 實機飛航模式測試。

## 私人題庫製作

主工作區提供 `src/build_practice_bank.py`，依固定 source hash 及視覺核對座標製作試用題庫；與其他 Biology 分析工作分開。輸出包含 `.ppsbank`、雙欄題目／答案核對頁及逐頁 coverage report。此公開 repository 不包含來源 PDF 或私人裁切資料。

題庫格式：ZIP 內有 `manifest.json`（format、version、每檔 SHA-256）、`bank.json` 及 content-addressed PNG/JPG assets。備份加入 `banks.json`、`workspace.json` 及所有資產。Import 先檢查 checksum、題目結構、唯一 MC key 及草稿關聯，再更新本地資料。

## 發佈

GitHub Pages Actions 發佈純靜態 `dist`。首次安裝必須有 HTTPS；普通 LAN HTTP 不可當成可離線安裝嘅 PWA。Private banks 透過 Files/AirDrop import，不推送到 GitHub。

UI 依據與實機驗收邊界見 HIG.md。`perfect-freehand`（MIT）、`fflate`（MIT）、React（MIT）隨程式打包，不需要 runtime CDN。
