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


// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBpLqmNDcqnph59L_t-NPKrVakz93MKbTs",
  authDomain: "cihuilianxi.firebaseapp.com",
  projectId: "cihuilianxi",
  storageBucket: "cihuilianxi.firebasestorage.app",
  messagingSenderId: "643003689518",
  appId: "1:643003689518:web:ed7dd5b10f33ae5c5c4dbf",
  measurementId: "G-SMT8V1PKCD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// 老師的電子信箱清單（登入時自動辨識為教師身分並顯示管理後台）
const TEACHER_EMAILS = [
  "s.w.liao@g.nccu.edu.tw",
  "teacher@g.nccu.edu.tw" // 可以繼續新增其他老師的信箱
];

// 將設定導出給應用程式使用
export { firebaseConfig, TEACHER_EMAILS };
