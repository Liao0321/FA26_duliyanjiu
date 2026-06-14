import { auth, checkUserRole } from './firebase.js';
import { setupAuthListeners } from './auth.js';
import { renderDashboard } from './leaderboard.js'; // 儀表板繪製由 leaderboard.js 統計處理
import { initPractice } from './practice.js';
import { initChallenge } from './challenge.js';
import { initLeaderboard } from './leaderboard.js';
import { initTeacherConsole, initCustomVocabView, getCustomVocab, syncCustomVocabToCloud } from './vocab.js';

// 全域應用程式狀態
export const AppState = {
  currentUser: null,
  userRole: 'student', // 'student' | 'teacher'
  currentView: 'dashboard'
};

// 進入點初始化 (防範 DOMContentLoaded 已經觸發過的安全寫法)
function initAll() {
  initAppRouter();
  setupAuthListeners();
  
  // 監聽金鑰儲存成功時的重新整理
  window.addEventListener('firebase-configured', () => {
    showToast('Firebase 設定成功，正在重新整理網頁...', 'info');
    setTimeout(() => window.location.reload(), 1500);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

/**
 * 初始化前端 Hash 路由
 */
function initAppRouter() {
  const handleRoute = () => {
    const hash = window.location.hash || '#/dashboard';
    const viewName = hash.replace('#/', '');
    
    // 切換分頁 UI
    switchView(viewName);
  };

  // 監聽路由改變與首次載入
  window.addEventListener('hashchange', handleRoute);
  
  // 如果首次載入沒有 hash，給予預設值
  if (!window.location.hash) {
    window.location.hash = '#/dashboard';
  } else {
    handleRoute();
  }
}

/**
 * 切換顯示的分頁
 * @param {string} viewName 
 */
export async function switchView(viewName) {
  // 對應的 HTML Section ID
  const viewId = `view-${viewName}`;
  const targetSection = document.getElementById(viewId);
  
  if (!targetSection) {
    window.location.hash = '#/dashboard';
    return;
  }
  
  AppState.currentView = viewName;

  // 隱藏所有分頁，只顯示目標分頁
  document.querySelectorAll('.app-view').forEach(section => {
    section.classList.add('hidden');
  });
  targetSection.classList.remove('hidden');

  // 更新導覽選單 Active 狀態 (側邊欄與行動底欄)
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
    if (item.getAttribute('data-view') === viewName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // 如果使用者已登入，當切換至特定頁面時，執行對應的模組更新
  if (AppState.currentUser) {
    try {
      switch (viewName) {
        case 'dashboard':
          await renderDashboard();
          const countEl = document.getElementById('custom-vocab-count');
          if (countEl) {
            const list = await getCustomVocab();
            countEl.textContent = list.length.toString();
          }
          break;
        case 'custom-vocab':
          await initCustomVocabView();
          break;
        case 'practice':
          initPractice();
          break;
        case 'challenge':
          initChallenge();
          break;
        case 'leaderboard':
          initLeaderboard();
          break;
        case 'teacher':
          if (AppState.userRole === 'teacher') {
            initTeacherConsole();
          } else {
            window.location.hash = '#/dashboard';
          }
          break;
        case 'settings':
          loadSettingsUI();
          break;
      }
    } catch (error) {
      console.error(`載入分頁 [${viewName}] 出錯:`, error);
      showToast(`載入分頁失敗: ${error.message}`, 'error');
    }
  }
}

/**
 * 載入並更新使用者 UI
 * @param {object} user Firebase 使用者物件
 */
export async function updateUserUI(user) {
  const authPage = document.getElementById('auth-page');
  const appPage = document.getElementById('app-page');
  
  if (user) {
    AppState.currentUser = user;
    
    // 檢查身分
    AppState.userRole = await checkUserRole(user.email);
    
    // 側欄資訊更新
    document.getElementById('user-avatar').src = user.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    document.getElementById('mobile-avatar').src = user.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    document.getElementById('user-name').textContent = user.displayName || '學生';
    
    const roleText = AppState.userRole === 'teacher' ? '教師' : '學生';
    document.getElementById('user-role').textContent = roleText;

    // 顯示/隱藏教師管理選單
    const teacherBtn = document.getElementById('nav-teacher-btn');
    if (AppState.userRole === 'teacher') {
      teacherBtn.classList.remove('hidden');
    } else {
      teacherBtn.classList.add('hidden');
    }

    // 控制 Firebase 設定面板顯示與否
    const firebaseConfigPanel = document.getElementById('firebase-config-panel');
    if (firebaseConfigPanel) {
      if (AppState.userRole === 'student') {
        firebaseConfigPanel.classList.add('hidden');
      } else {
        firebaseConfigPanel.classList.remove('hidden');
      }
    }

    // 立即觸發本機自訂詞彙同步至雲端
    syncCustomVocabToCloud();

    // 切換頁面容器
    authPage.classList.add('hidden');
    appPage.classList.remove('hidden');

    // 重新繪製目前分頁
    switchView(AppState.currentView);
  } else {
    AppState.currentUser = null;
    AppState.userRole = 'student';
    
    // 訪客狀態：顯示 Firebase 設定面板
    const firebaseConfigPanel = document.getElementById('firebase-config-panel');
    if (firebaseConfigPanel) {
      firebaseConfigPanel.classList.remove('hidden');
    }
    
    authPage.classList.remove('hidden');
    appPage.classList.add('hidden');
  }
}

/**
 * 全域載入系統設定介面
 */
function loadSettingsUI() {
  // 載入 LocalStorage 中的 Firebase 配置
  const savedConfig = localStorage.getItem('local_firebase_config');
  if (savedConfig) {
    try {
      const cfg = JSON.parse(savedConfig);
      document.getElementById('cfg-apiKey').value = cfg.apiKey || '';
      document.getElementById('cfg-authDomain').value = cfg.authDomain || '';
      document.getElementById('cfg-projectId').value = cfg.projectId || '';
      document.getElementById('cfg-storageBucket').value = cfg.storageBucket || '';
      document.getElementById('cfg-messagingSenderId').value = cfg.messagingSenderId || '';
      document.getElementById('cfg-appId').value = cfg.appId || '';
    } catch (e) {
      console.error('解析快取設定檔出錯', e);
    }
  }
}

// 監聽設定頁面表單儲存
document.getElementById('firebase-config-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const config = {
    apiKey: document.getElementById('cfg-apiKey').value.trim(),
    authDomain: document.getElementById('cfg-authDomain').value.trim(),
    projectId: document.getElementById('cfg-projectId').value.trim(),
    storageBucket: document.getElementById('cfg-storageBucket').value.trim(),
    messagingSenderId: document.getElementById('cfg-messagingSenderId').value.trim(),
    appId: document.getElementById('cfg-appId').value.trim()
  };

  localStorage.setItem('local_firebase_config', JSON.stringify(config));
  showToast('Firebase 設定已儲存至本機，系統即將重新載入！', 'success');
  setTimeout(() => window.location.reload(), 1500);
});

// 清除本機設定
document.getElementById('reset-config-btn').addEventListener('click', () => {
  if (confirm('確定要清除儲存在本機瀏覽器的 Firebase 設定嗎？')) {
    localStorage.removeItem('local_firebase_config');
    showToast('設定已清除，即將重新整理網頁！', 'info');
    setTimeout(() => window.location.reload(), 1500);
  }
});

// 手動通行碼升級教師
document.getElementById('upgrade-role-btn').addEventListener('click', async () => {
  const passcode = document.getElementById('teacher-passcode-input').value.trim();
  const statusDiv = document.getElementById('role-upgrade-status');
  
  if (!passcode) {
    statusDiv.innerHTML = '<span style="color: var(--color-danger)">請輸入通行碼！</span>';
    return;
  }

  // 通行碼可自由更換 (為方便教學，寫入特定密碼)
  if (passcode === 'NCCU_Teacher_2026' || passcode === 'MySchoolTeacher2026') {
    if (!AppState.currentUser) return;
    
    try {
      const db = firebase.firestore();
      await db.collection('users').doc(AppState.currentUser.uid).set({
        uid: AppState.currentUser.uid,
        email: AppState.currentUser.email,
        username: AppState.currentUser.displayName,
        role: 'teacher'
      }, { merge: true });
      
      statusDiv.innerHTML = '<span style="color: var(--color-success)">驗證成功！您已被升級為教師，正在更新介面...</span>';
      showToast('升級教師成功！', 'success');
      
      // 延遲更新 UI
      setTimeout(async () => {
        AppState.userRole = 'teacher';
        document.getElementById('user-role').textContent = '教師';
        document.getElementById('nav-teacher-btn').classList.remove('hidden');
        document.getElementById('teacher-passcode-input').value = '';
        statusDiv.innerHTML = '';
        switchView('dashboard');
      }, 1500);
    } catch (err) {
      statusDiv.innerHTML = `<span style="color: var(--color-danger)">上傳設定失敗: ${err.message}</span>`;
    }
  } else {
    statusDiv.innerHTML = '<span style="color: var(--color-danger)">通行碼錯誤，請重新輸入。</span>';
  }
});

/**
 * 全域顯示彈窗訊息 (Toasts)
 * @param {string} message 
 * @param {'success' | 'error' | 'info'} type 
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check_circle';
  if (type === 'error') iconName = 'error';

  toast.innerHTML = `
    <span class="material-icons-round toast-icon">${iconName}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  // 4 秒後自動淡出移除
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}
