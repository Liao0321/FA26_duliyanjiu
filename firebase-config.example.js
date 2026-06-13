/**
 * Firebase 設定範本檔
 * 
 * 使用步驟：
 * 1. 請將此檔案複製並重新命名為 `firebase-config.js` 放在同一個目錄下。
 * 2. 至 Firebase 控制台 (https://console.firebase.google.com/) 建立專案。
 * 3. 啟用 Authentication (Google Sign-In) 與 Cloud Firestore 資料庫。
 * 4. 複製您的 Web App SDK 設定，填入下方的 `firebaseConfig` 中。
 * 5. 在 `TEACHER_EMAILS` 中填入老師的學校 Google 信箱。
 */

// 全域變數定義給網頁系統使用
window.firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 老師的電子信箱清單（登入時自動辨識為教師身分並顯示管理後台）
window.TEACHER_EMAILS = [
  "s.w.liao@g.nccu.edu.tw",
  "teacher@g.nccu.edu.tw" // 可以繼續新增其他老師的信箱
];
