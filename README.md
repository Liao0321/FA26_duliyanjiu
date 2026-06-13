# 中文詞彙挑戰與閃卡練習系統 (Vocab Practice & Challenge System)

這是一個專為中文學習者設計的網頁工具，包含**間隔重複 (SRS) 閃卡日常練習**、**10題選擇題每日挑戰**以及**即時排行榜**。

本專案完全基於靜態網頁技術建立，搭配 Firebase 的免費雲端服務，**無須任何伺服器成本，100% 免費託管運作！**

---

## 🚀 快速開始 (本地測試)
本系統不需要安裝 Node.js、Git 或任何編譯工具：
1. 下載本專案的所有檔案。
2. 雙擊直接打開 `index.html`，即可在您的瀏覽器（建議使用 Chrome / Safari）中預覽漂亮的深色視覺介面！

---

## ⚙️ 步驟一：設定免費的 Firebase 雲端資料庫 (約 3 分鐘)

系統需要一個雲端資料庫來儲存會員資料、閃卡進度與排行榜分數。請照以下步驟操作：

1. **建立專案**：
   - 前往 [Firebase 控制台 (Firebase Console)](https://console.firebase.google.com/) 並登入您的 Google 帳號。
   - 點選「新增專案」，輸入專案名稱（例如：`vocab-challenge`），一路點選繼續完成建立。

2. **啟用 Google 登入 (Authentication)**：
   - 在左側選單中，點選 **「建置」 ➡️ 「Authentication」**，點選「開始使用」。
   - 在「登入方法」中，選擇 **「Google」**，啟用它，設定您的項目支援聯絡信箱，然後點選「儲存」。

3. **啟用 Cloud Firestore 資料庫**：
   - 在左側選單中，點選 **「建置」 ➡️ 「Firestore Database」**，點選「建立資料庫」。
   - 選擇「以測試模式啟動」（方便初期測試）或「以生產模式啟動」，點選下一步並選取資料庫伺服器位置（建議選擇 `asia-east1` 台灣），完成建立。

4. **取得網頁 SDK 金鑰金鑰**：
   - 在專案首頁，點選 **「專案設定 (齒輪圖示)」 ➡️ 「一般」**。
   - 在下方「您的應用程式」中，點選 **「網頁 (</> 圖示)」** 註冊應用程式。
   - 註冊後，會看到一段類似下方的金鑰 JavaScript 代碼：
     ```javascript
     const firebaseConfig = {
       apiKey: "AIzaSy...",
       authDomain: "vocab-challenge.firebaseapp.com",
       projectId: "vocab-challenge",
       storageBucket: "vocab-challenge.firebasestorage.app",
       messagingSenderId: "123456789",
       appId: "1:1234:web:abcd"
     };
     ```

5. **套用金鑰設定**：
   - **方式一（免代碼貼上）**：直接打開您的 `index.html` 網頁，點選右上角（手機版為底欄）的**「系統設定」**。在表單中依序填入您複製的 `apiKey` 等欄位，點選「儲存」，網頁會自動與您的雲端資料庫連線！
   - **方式二（寫死於專案，推薦發布時使用）**：將專案根目錄的 `firebase-config.example.js` 檔案複製並重新命名為 `firebase-config.js`。將您的金鑰填入其中，並在 `TEACHER_EMAILS` 名單中寫入老師的電子信箱（如 `"s.w.liao@g.nccu.edu.tw"`），隨後一起上傳到伺服器。

---

## 📝 步驟二：教師大宗匯入與詞彙維護 (Google Sheets 貼上)

1. 使用您的教師帳號登入系統。
2. 切換至側邊欄的 **「教師管理後台」** (僅教師信箱登入或輸入教師通行碼後可見)。
3. 在您的 Google Sheets 中，選取您的字彙資料列（**請勿選取標題列**，直接選取數據內容）。欄位順序請依據以下排列：
   - `單字 | 搭配詞 | 中文例句 | 英文例句 | 課堂來源 | 圖片檔名.jpg (選填) | 單字音檔.mp3 (選填) | 例句音檔.mp3 (選填)`
4. 在網頁後台文字框中直接 **Ctrl+V 貼上**。
5. 點選 **「解析貼上內容」** 檢查預覽結果，確認無誤後點選 **「上傳至雲端字庫」**。所有學生在重新整理網頁後，即可立刻同步開始練習這些新單字！

---

## 🔊 步驟三：多媒體檔案放置位置 (圖片與 MP3)
為了完全免去伺服器存取費用，圖片與音檔是直接託管在網頁資料夾中：
* **圖片** 請放入專案的 `assets/images/` 資料夾下。
* **單字發音音檔** 請放入 `assets/audio/words/` 資料夾下。
* **例句發音音檔** 請放入 `assets/audio/sentences/` 資料夾下。

*您只需要在 Google Sheets 中填寫檔案名稱（例如 `colleague.jpg`），網頁在運作時會自動指向對應的路徑進行播放，非常省事！*

---

## 🌐 步驟四：發布至 GitHub Pages (100% 免費託管)

1. 註冊並登入一個免費的 [GitHub 帳號](https://github.com/)。
2. 建立一個新的公開儲存庫 (Public Repository)，命名為 `fervent-bell`。
3. 下載並安裝 [GitHub Desktop](https://desktop.github.com/) (推薦非程式背景者使用) 或是使用網頁上的「Upload files」按鈕，將本專案的所有檔案（包含寫好金鑰的 `firebase-config.js`、您的 `assets` 影音資料夾）上傳至該儲存庫。
4. 在該 GitHub 專案網頁中，點選 **「Settings」 ➡️ 「Pages」**：
   - 在「Build and deployment」下，將 Source 設定為 `Deploy from a branch`。
   - Branch 選擇 `main` (或 `master`) 與 `/ (root)`。
   - 點選 **「Save」**。
5. 約一分鐘後重新整理該頁面，您就會得到一組免費公開網址（例如：`https://your-username.github.io/fervent-bell/`）。學生點此網址即可開始登入使用！

---

## 📲 步驟五：內嵌至 Google Sites (協作平台)
如果您平時是用 Google Sites 管理班級課程，您可以輕鬆將練習工具融入其中：
1. 進入您的 Google Sites 編輯畫面。
2. 在右側工具欄點選 **「內嵌 (Embed)」**。
3. 選擇「按網址 (By URL)」，貼上您上方的 **GitHub Pages 網址**。
4. 調整內嵌視窗的長寬，使其呈現最適合的大小，隨後發布 Google Sites。學生即可直接在您的班級網頁中登入並進行每日挑戰！

---

## 🔒 雲端資料庫安全規則配置建議 (Firestore Rules)
為了確保學生之間不會互相刪除單字，建議您在 Firebase 控制台的 **Firestore ➡️ Rules** 貼上以下規則：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 允許所有人讀取教科書詞彙與排行榜
    match /textbookVocab/{document} {
      allow read: if true;
      allow write: if request.auth != null; // 僅限登入者(教師)修改
    }
    
    match /leaderboard/{document} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == document; // 學生只能修改自己的分數
    }
    
    // 學生個人進度與自訂詞彙：只能讀寫屬於自己 uid 的文件
    match /userProgress/{document} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.uid;
    }
    
    match /userCustomVocab/{document} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.uid;
    }
    
    match /users/{document} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == document;
    }
  }
}
```
