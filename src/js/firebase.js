// 預設教師信箱名單
let TEACHER_EMAILS = ["s.w.liao@g.nccu.edu.tw"];
let firebaseConfig = null;
let hasConfig = false;

// 1. 嘗試從本地模組動態載入設定檔
try {
  const configModule = await import('../../firebase-config.js').catch(() => {
    console.warn("未偵測到 firebase-config.js 設定檔，嘗試載入瀏覽器快取設定。");
    return null;
  });
  
  if (configModule) {
    firebaseConfig = configModule.firebaseConfig;
    if (configModule.TEACHER_EMAILS) {
      TEACHER_EMAILS = configModule.TEACHER_EMAILS;
    }
    hasConfig = true;
  }
} catch (e) {
  console.log("靜態載入失敗，採用備用快取載入。");
}

// 2. 若本地檔案不存在，從 LocalStorage 載入
if (!firebaseConfig) {
  const localCfg = localStorage.getItem('local_firebase_config');
  if (localCfg) {
    try {
      firebaseConfig = JSON.parse(localCfg);
      hasConfig = true;
    } catch (e) {
      console.error("解析快取 Firebase 設定檔失敗", e);
    }
  }
}

// 3. 初始化 Firebase
let auth = null;
let db = null;
let provider = null;

if (hasConfig && firebaseConfig && firebaseConfig.apiKey) {
  try {
    // 呼叫 Compat CDN 實體
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    
    // 啟用離線資料庫快取 (以確保離線時也能運作)
    db.enablePersistence().catch(err => {
      console.warn("離線快取無法啟動，這不影響正常運作:", err.code);
    });

    provider = new firebase.auth.GoogleAuthProvider();
    // 強制每次登入都要求選擇 Google 帳號 (以便於更換學校帳號測試)
    provider.setCustomParameters({
      prompt: 'select_account'
    });
  } catch (error) {
    console.error("Firebase 初始化失敗:", error);
    hasConfig = false;
  }
}

/**
 * 檢查使用者是否為教師身分
 * @param {string} email 
 * @returns {Promise<'student' | 'teacher'>}
 */
export async function checkUserRole(email) {
  if (!email) return 'student';

  // 優先檢查代碼中寫死的名單
  if (TEACHER_EMAILS.includes(email.toLowerCase())) {
    return 'teacher';
  }

  // 接著檢查資料庫中是否有設定角色
  if (auth && auth.currentUser) {
    try {
      const userDoc = await db.collection('users').doc(auth.currentUser.uid).get();
      if (userDoc.exists && userDoc.data().role === 'teacher') {
        return 'teacher';
      }
    } catch (err) {
      console.warn("無法取得使用者角色數據，預設為 student:", err);
    }
  }

  return 'student';
}

export { auth, db, provider, hasConfig, TEACHER_EMAILS };
