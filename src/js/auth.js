import { auth, db, provider, hasConfig } from './firebase.js';
import { updateUserUI, showToast, switchView } from './app.js';

/**
 * 設定 Auth 事件監聽與按鈕事件
 */
export function setupAuthListeners() {
  const loginBtn = document.getElementById('google-login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const authLoading = document.getElementById('auth-loading');
  const authActions = document.getElementById('auth-actions');

  // 1. 檢查 Firebase 連線是否就緒
  if (!hasConfig) {
    if (authActions) {
      authActions.innerHTML = `
        <div class="alert alert-warning" style="margin-bottom: 1.5rem; text-align: left; background-color: rgba(245, 158, 11, 0.1); border: 1.5px solid var(--color-warning); padding: 1rem; border-radius: var(--radius-md); font-size: 0.9rem; line-height: 1.5;">
          <h4 style="color: var(--color-warning); font-weight: 600; margin-bottom: 0.25rem;">系統尚未設定連線</h4>
          請先點選下方「前往系統設定」，貼上您的 Firebase Web App 金鑰設定，以開始使用本練習系統。
        </div>
        <button id="go-to-settings-btn" class="btn btn-primary" style="width: 100%;">
          <span class="material-icons-round">settings</span> 前往系統設定
        </button>
      `;
      
      document.getElementById('go-to-settings-btn').addEventListener('click', () => {
        // 解鎖應用程式介面僅顯示設定頁面
        document.getElementById('auth-page').classList.add('hidden');
        document.getElementById('app-page').classList.remove('hidden');
        // 隱藏非設定的導覽項目
        document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
          if (item.getAttribute('data-view') !== 'settings') {
            item.classList.add('hidden');
          }
        });
        switchView('settings');
      });
    }
    return;
  }

  // 2. 登入按鈕事件
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      if (authLoading) authLoading.classList.remove('hidden');
      if (authActions) authActions.classList.add('hidden');

      auth.signInWithPopup(provider)
        .then((result) => {
          showToast(`歡迎回來，${result.user.displayName}！`, 'success');
        })
        .catch((error) => {
          console.error("登入失敗:", error);
          showToast(`登入失敗: ${error.message}`, 'error');
          if (authLoading) authLoading.classList.add('hidden');
          if (authActions) authActions.classList.remove('hidden');
        });
    });
  }

  // 3. 登出按鈕事件
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('確定要登出系統嗎？')) {
        auth.signOut()
          .then(() => {
            showToast('已安全登出！', 'info');
            window.location.hash = '#/dashboard';
            window.location.reload();
          })
          .catch((error) => {
            showToast(`登出失敗: ${error.message}`, 'error');
          });
      }
    });
  }

  // 4. 監聽 Firebase 會員登入狀態改變
  auth.onAuthStateChanged(async (user) => {
    if (authLoading) authLoading.classList.remove('hidden');
    if (authActions) authActions.classList.add('hidden');

    if (user) {
      try {
        // 同步會員基本資料至雲端資料庫
        await syncUserToFirestore(user);
        
        // 載入完整的 App 介面
        await updateUserUI(user);
      } catch (e) {
        console.error("帳戶同步出錯:", e);
        showToast("雲端同步帳戶失敗，請重試", "error");
      }
    } else {
      // 未登入，重設 UI 至登入頁面
      updateUserUI(null);
    }

    if (authLoading) authLoading.classList.add('hidden');
    if (authActions) authActions.classList.remove('hidden');
  });
}

/**
 * 將使用者狀態同步至 Firestore
 * @param {object} user 
 */
async function syncUserToFirestore(user) {
  const userRef = db.collection('users').doc(user.uid);
  const doc = await userRef.get();
  
  if (!doc.exists) {
    // 首次登入，建立預設使用者帳號檔案 (預設為 student)
    await userRef.set({
      uid: user.uid,
      username: user.displayName || '學生',
      email: user.email,
      role: 'student', // 預設身分
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    // 重複登入，僅同步最新的頭像與信箱，不覆寫角色
    await userRef.update({
      username: user.displayName || doc.data().username,
      email: user.email,
      photoURL: user.photoURL
    });
  }
}
