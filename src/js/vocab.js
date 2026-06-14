import { db, auth } from './firebase.js';
import { showToast } from './app.js';

// 快取相關設定
const CACHE_KEY = 'cached_textbook_vocab';
const CACHE_TIME_KEY = 'cached_vocab_timestamp';
const CACHE_EXPIRY = 60 * 60 * 1000; // 快取過期時間：1小時

// 本地解析暫存
let parsedVocabList = [];

/**
 * 取得教科書詞彙清單（包含快取控制）
 * @param {boolean} forceRefresh 是否強制從雲端重新下載
 * @returns {Promise<Array>}
 */
export async function getTextbookVocab(forceRefresh = false) {
  const cachedData = localStorage.getItem(CACHE_KEY);
  const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
  const now = Date.now();

  // 若有快取且未過期，直接回傳
  if (!forceRefresh && cachedData && cachedTime && (now - cachedTime < CACHE_EXPIRY)) {
    return JSON.parse(cachedData);
  }

  // 從雲端 Firestore 下載
  try {
    const snapshot = await db.collection('textbookVocab')
      .orderBy('updatedAt', 'desc')
      .get();
      
    const vocabList = [];
    snapshot.forEach(doc => {
      vocabList.push({ id: doc.id, ...doc.data() });
    });

    // 寫入快取
    localStorage.setItem(CACHE_KEY, JSON.stringify(vocabList));
    localStorage.setItem(CACHE_TIME_KEY, now.toString());

    return vocabList;
  } catch (error) {
    console.error("下載雲端詞彙失敗:", error);
    // 雲端下載失敗時的降級處理：回傳快取（不論是否過期）
    if (cachedData) {
      showToast("無法連線至雲端，使用本機快取資料。", "info");
      return JSON.parse(cachedData);
    }
    throw error;
  }
}

/**
 * 同步本地未儲存的自訂詞彙至 Firestore
 */
export async function syncCustomVocabToCloud() {
  if (!auth.currentUser || !db) return;
  
  const localDataStr = localStorage.getItem('local_custom_vocab');
  if (!localDataStr) return;
  
  try {
    let localList = JSON.parse(localDataStr);
    let updated = false;
    
    for (let i = 0; i < localList.length; i++) {
      const item = localList[i];
      if (!item.synced || !item.uid) {
        item.uid = auth.currentUser.uid;
        
        const docRef = db.collection('userCustomVocab').doc(item.id);
        const { id, synced, ...dbItem } = item;
        const firestoreItem = {
          ...dbItem,
          id: item.id,
          uid: auth.currentUser.uid,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await docRef.set(firestoreItem, { merge: true });
        item.synced = true;
        updated = true;
      }
    }
    
    if (updated) {
      localStorage.setItem('local_custom_vocab', JSON.stringify(localList));
      console.log("已同步自訂詞彙至 Firebase 雲端！");
    }
  } catch (err) {
    console.error("自動同步自訂詞彙失敗:", err);
  }
}

/**
 * 取得學生自訂詞彙清單
 * @returns {Promise<Array>}
 */
export async function getCustomVocab() {
  const localDataStr = localStorage.getItem('local_custom_vocab');
  let localList = localDataStr ? JSON.parse(localDataStr) : [];
  
  if (!auth.currentUser || !db) {
    // 未登入狀態：僅回傳本機中 uid 為 null 的自訂詞彙
    return localList.filter(item => !item.uid);
  }
  
  // 已登入狀態：同步並載入雲端與本機
  try {
    await syncCustomVocabToCloud();
    
    const snapshot = await db.collection('userCustomVocab')
      .where('uid', '==', auth.currentUser.uid)
      .get();
      
    const cloudList = [];
    snapshot.forEach(doc => {
      cloudList.push({ id: doc.id, ...doc.data(), isCustom: true, synced: true });
    });
    
    const mergedMap = new Map();
    
    // 先塞本地
    localList.forEach(item => {
      if (item.uid === auth.currentUser.uid || !item.uid) {
        mergedMap.set(item.id, item);
      }
    });
    
    // 再用雲端覆蓋
    cloudList.forEach(item => {
      mergedMap.set(item.id, item);
    });
    
    const mergedList = Array.from(mergedMap.values());
    localStorage.setItem('local_custom_vocab', JSON.stringify(mergedList));
    return mergedList;
  } catch (error) {
    console.error("載入自訂詞彙失敗，使用本機快取:", error);
    return localList.filter(item => item.uid === auth.currentUser.uid || !item.uid);
  }
}

/**
 * 儲存學生自訂詞彙
 */
export async function saveCustomVocabItem(word, collocation, sentence, sentenceEN) {
  const localDataStr = localStorage.getItem('local_custom_vocab');
  const localList = localDataStr ? JSON.parse(localDataStr) : [];
  
  const itemId = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  
  const newItem = {
    id: itemId,
    word: word.trim(),
    collocation: collocation.trim(),
    sentence: sentence.trim(),
    sentenceEN: sentenceEN.trim(),
    uid: uid,
    synced: false,
    isCustom: true,
    createdAt: Date.now()
  };
  
  if (uid && db) {
    try {
      const docRef = db.collection('userCustomVocab').doc(itemId);
      await docRef.set({
        ...newItem,
        synced: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      newItem.synced = true;
    } catch (e) {
      console.warn("寫入雲端失敗，先儲存於本機稍後同步:", e);
      newItem.synced = false;
    }
  }
  
  localList.push(newItem);
  localStorage.setItem('local_custom_vocab', JSON.stringify(localList));
  return newItem;
}

/**
 * 刪除學生自訂詞彙
 */
export async function deleteCustomVocabItem(id) {
  const localDataStr = localStorage.getItem('local_custom_vocab');
  let localList = localDataStr ? JSON.parse(localDataStr) : [];
  
  localList = localList.filter(item => item.id !== id);
  localStorage.setItem('local_custom_vocab', JSON.stringify(localList));
  
  if (auth.currentUser && db) {
    try {
      await db.collection('userCustomVocab').doc(id).delete();
    } catch (e) {
      console.warn("從雲端刪除自訂詞彙失敗:", e);
    }
  }
}

/**
 * 初始化並渲染學生自訂詞彙頁面
 */
export async function initCustomVocabView() {
  const form = document.getElementById('custom-vocab-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = "true";
    form.onsubmit = async (e) => {
      e.preventDefault();
      const word = document.getElementById('custom-word').value;
      const collocation = document.getElementById('custom-collocation').value;
      const sentence = document.getElementById('custom-sentence').value;
      const sentenceEN = document.getElementById('custom-sentence-en').value;
      
      try {
        await saveCustomVocabItem(word, collocation, sentence, sentenceEN);
        showToast('自訂詞彙儲存成功！', 'success');
        form.reset();
        await renderCustomVocabList();
        
        const countEl = document.getElementById('custom-vocab-count');
        if (countEl) {
          const list = await getCustomVocab();
          countEl.textContent = list.length.toString();
        }
      } catch (err) {
        showToast(`儲存失敗: ${err.message}`, 'error');
      }
    };
  }
  
  await renderCustomVocabList();
}

/**
 * 繪製學生自訂詞彙清單表格
 */
export async function renderCustomVocabList() {
  const rowsContainer = document.getElementById('custom-vocab-rows');
  const totalCountText = document.getElementById('custom-total-count');
  
  if (!rowsContainer) return;
  
  rowsContainer.innerHTML = '<tr><td colspan="4" class="text-center">正在載入自訂詞彙庫中...</td></tr>';
  
  try {
    const list = await getCustomVocab();
    if (totalCountText) totalCountText.textContent = list.length.toString();
    
    if (list.length === 0) {
      rowsContainer.innerHTML = '<tr><td colspan="4" class="text-center">您目前還沒有自訂詞彙，在左側新增一個吧！</td></tr>';
      return;
    }
    
    rowsContainer.innerHTML = '';
    list.forEach(item => {
      const tr = document.createElement('tr');
      
      const syncBadge = item.synced 
        ? '<span class="badge-sync-ok">雲端同步</span>' 
        : '<span class="badge-sync-local">本機暫存</span>';
        
      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; font-size:1.05rem;">${item.word}</div>
          <div style="color: var(--text-secondary); font-size:0.8rem;">英文翻譯：${item.collocation}</div>
        </td>
        <td class="vocab-cell-sentences">
          <strong>中：</strong>${item.sentence}<br>
          <strong>英：</strong>${item.sentenceEN}
        </td>
        <td>${syncBadge}</td>
        <td>
          <button class="btn btn-logout delete-custom-vocab-btn" data-id="${item.id}" style="padding:0.4rem;" title="刪除">
            <span class="material-icons-round" style="font-size:1.15rem;">delete</span>
          </button>
        </td>
      `;
      
      tr.querySelector('.delete-custom-vocab-btn').onclick = async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm(`確定要刪除自訂單字「${item.word}」嗎？`)) {
          try {
            await deleteCustomVocabItem(id);
            showToast('自訂單字已刪除！', 'success');
            await renderCustomVocabList();
            
            const countEl = document.getElementById('custom-vocab-count');
            if (countEl) {
              const updatedList = await getCustomVocab();
              countEl.textContent = updatedList.length.toString();
            }
          } catch (err) {
            showToast(`刪除失敗: ${err.message}`, 'error');
          }
        }
      };
      
      rowsContainer.appendChild(tr);
    });
  } catch (e) {
    rowsContainer.innerHTML = `<tr><td colspan="4" class="text-center" style="color: var(--color-danger)">載入自訂詞彙失敗: ${e.message}</td></tr>`;
  }
}

/**
 * 取得合併後的完整詞彙庫 (教科書 + 自訂)
 * @param {boolean} forceRefresh 
 * @returns {Promise<Array>}
 */
export async function getMergedVocabList(forceRefresh = false) {
  const textbook = await getTextbookVocab(forceRefresh);
  const custom = await getCustomVocab();
  return [...textbook, ...custom];
}

/**
 * 初始化教師管理後台頁面
 */
/**
 * 解析 Google Sheet URL 並下載 CSV
 * @param {string} url 
 * @returns {Promise<string>} CSV 原始文字
 */
async function fetchGoogleSheetCsv(url) {
  url = url.trim();
  let csvUrl = '';
  
  // 1. 發布到網路的連結 (含有 /spreadsheets/d/e/)
  if (url.includes('/spreadsheets/d/e/')) {
    const parts = url.split('/spreadsheets/d/e/');
    if (parts.length > 1) {
      const pubKey = parts[1].split('/')[0];
      csvUrl = `https://docs.google.com/spreadsheets/d/e/${pubKey}/pub?output=csv`;
      
      const gidMatch = url.match(/[#&]gid=([0-9]+)/);
      if (gidMatch) {
        csvUrl += `&gid=${gidMatch[1]}`;
      }
    }
  } 
  // 2. 一般共用連結 (含有 /spreadsheets/d/)
  else if (url.includes('/spreadsheets/d/')) {
    const parts = url.split('/spreadsheets/d/');
    if (parts.length > 1) {
      const docId = parts[1].split('/')[0];
      csvUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv`;
      
      const gidMatch = url.match(/[#&]gid=([0-9]+)/);
      if (gidMatch) {
        csvUrl += `&gid=${gidMatch[1]}`;
      }
    }
  }
  
  if (!csvUrl) {
    throw new Error("網址格式不正確！請貼上標準的 Google Sheet 連結（包含 /spreadsheets/d/...）。");
  }
  
  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error("無法下載試算表，請確認您的 Google Sheet 已共用為「知道連結的任何人均可檢視」或已「發布到網路」。");
  }
  
  return await response.text();
}

/**
 * 支援雙引號與逗號的 CSV 解析器
 * @param {string} text 
 * @returns {Array<Array<string>>}
 */
function parseCSV(text) {
  const result = [];
  let row = [];
  let col = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        col += '"';
        i++; // 跳過下一個雙引號
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(col);
      col = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // 跳過 \n
      }
      row.push(col);
      if (row.length > 1 || row[0] !== '') {
        result.push(row);
      }
      row = [];
      col = '';
    } else {
      col += char;
    }
  }
  if (col || row.length > 0) {
    row.push(col);
    result.push(row);
  }
  return result;
}

export async function initTeacherConsole() {
  const pasteArea = document.getElementById('import-paste-area');
  const parseBtn = document.getElementById('import-parse-btn');
  const uploadBtn = document.getElementById('import-upload-btn');
  const previewCount = document.getElementById('import-preview-count');
  const previewContainer = document.getElementById('import-preview-container');
  const sheetUrlInput = document.getElementById('import-sheet-url');
  const sheetParseBtn = document.getElementById('import-sheet-btn');

  // Tabs 切換邏輯
  const tabSheetUrl = document.getElementById('tab-sheet-url');
  const tabRawPaste = document.getElementById('tab-raw-paste');
  const panelSheetUrl = document.getElementById('panel-sheet-url');
  const panelRawPaste = document.getElementById('panel-raw-paste');

  if (tabSheetUrl && tabRawPaste) {
    tabSheetUrl.onclick = () => {
      tabSheetUrl.classList.add('active');
      tabRawPaste.classList.remove('active');
      panelSheetUrl.classList.remove('hidden');
      panelRawPaste.classList.add('hidden');
    };

    tabRawPaste.onclick = () => {
      tabRawPaste.classList.add('active');
      tabSheetUrl.classList.remove('active');
      panelRawPaste.classList.remove('hidden');
      panelSheetUrl.classList.add('hidden');
    };
  }

  // 重設表單與狀態
  if (pasteArea) pasteArea.value = '';
  if (sheetUrlInput) sheetUrlInput.value = '';
  if (uploadBtn) uploadBtn.classList.add('hidden');
  if (previewCount) previewCount.textContent = '0';
  if (previewContainer) previewContainer.innerHTML = '<div class="empty-state">請輸入試算表連結或貼上複製文字，並點選解析。</div>';
  parsedVocabList = [];

  // 1. 綁定 Google Sheet URL 解析按鈕
  if (sheetParseBtn) {
    sheetParseBtn.onclick = async () => {
      const url = sheetUrlInput.value.trim();
      if (!url) {
        showToast('請先貼上 Google Sheet 共享網址！', 'error');
        return;
      }

      sheetParseBtn.disabled = true;
      sheetParseBtn.textContent = '正在下載解析中...';

      try {
        const csvText = await fetchGoogleSheetCsv(url);
        parseGoogleSheetCsvData(csvText);
      } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
        previewContainer.innerHTML = `<div class="empty-state" style="color: var(--color-danger)">讀取試算表失敗: ${err.message}</div>`;
        uploadBtn.classList.add('hidden');
      } finally {
        sheetParseBtn.disabled = false;
        sheetParseBtn.textContent = '讀取並解析試算表';
      }
    };
  }

  // 2. 綁定手動解析按鈕事件
  if (parseBtn) {
    parseBtn.onclick = () => {
      const text = pasteArea.value.trim();
      if (!text) {
        showToast('請先貼上 Google Sheets 複製的內容！', 'error');
        return;
      }
      parsePastedText(text);
    };
  }

  // 3. 綁定上傳按鈕事件
  if (uploadBtn) {
    uploadBtn.onclick = async () => {
      if (parsedVocabList.length === 0) return;
      
      uploadBtn.disabled = true;
      uploadBtn.textContent = '正在上傳...';
      
      try {
        await uploadVocabBatch(parsedVocabList);
        showToast(`成功匯入 ${parsedVocabList.length} 筆詞彙至雲端！`, 'success');
        
        // 清空輸入並更新快取與清單
        if (pasteArea) pasteArea.value = '';
        if (sheetUrlInput) sheetUrlInput.value = '';
        uploadBtn.classList.add('hidden');
        previewCount.textContent = '0';
        previewContainer.innerHTML = '<div class="empty-state">匯入成功！您可以繼續匯入新資料。</div>';
        parsedVocabList = [];
        
        // 強制重整字庫並繪製現有詞彙表格
        await renderVocabListTable(true);
      } catch (e) {
        console.error(e);
        showToast(`匯入失敗: ${e.message}`, 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '上傳至雲端字庫';
      }
    };
  }

  // 4. 繪製現有詞彙表格
  await renderVocabListTable(false);
}

/**
 * 解析 Google Sheet 下載的 CSV 檔案
 */
function parseGoogleSheetCsvData(csvText) {
  const rows = parseCSV(csvText);
  const previewContainer = document.getElementById('import-preview-container');
  const previewCount = document.getElementById('import-preview-count');
  const uploadBtn = document.getElementById('import-upload-btn');
  
  parsedVocabList = [];
  previewContainer.innerHTML = '';

  rows.forEach((cols, index) => {
    if (cols.length === 0 || !cols[0].trim()) return;

    // 剔除可能的欄位頭部 (標題列防呆)
    if (index === 0 && (cols[0].includes('單字') || cols[0].includes('詞彙') || cols[0].includes('Word'))) {
      return;
    }

    const word = cols[0] ? cols[0].trim() : '';
    const collocation = cols[1] ? cols[1].trim() : '';
    const sentence = cols[2] ? cols[2].trim() : '';
    const sentenceEN = cols[3] ? cols[3].trim() : '';
    const source = cols[4] ? cols[4].trim() : '預設課別';
    const image = cols[5] ? cols[5].trim() : '';
    const audioWord = cols[6] ? cols[6].trim() : '';
    const audioSentence = cols[7] ? cols[7].trim() : '';

    const vocabItem = {
      word,
      collocation,
      sentence,
      sentenceEN,
      source,
      image,
      audioWord,
      audioSentence,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    parsedVocabList.push(vocabItem);

    // 繪製預覽項目
    const itemEl = document.createElement('div');
    itemEl.className = 'preview-item';
    itemEl.innerHTML = `
      <div>
        <span class="preview-title">${word}</span>
        ${collocation ? `<span class="preview-colloc">(${collocation})</span>` : ''}
        <span class="badge badge-mode" style="margin-left:0.5rem; font-size:0.7rem; padding:0.15rem 0.4rem;">${source}</span>
      </div>
      <div class="preview-sentences">
        <strong>中：</strong>${sentence || '無'}<br>
        <strong>英：</strong>${sentenceEN || '無'}
      </div>
    `;
    previewContainer.appendChild(itemEl);
  });

  previewCount.textContent = parsedVocabList.length.toString();

  if (parsedVocabList.length > 0) {
    uploadBtn.classList.remove('hidden');
    showToast(`解析完畢！共 ${parsedVocabList.length} 筆資料可準備上傳。`, 'info');
  } else {
    uploadBtn.classList.add('hidden');
    previewContainer.innerHTML = '<div class="empty-state" style="color: var(--color-danger)">沒有解析出有效的單字，請檢查試算表格式與共用設定。</div>';
  }
}

/**
 * 解析複製貼上文字 (自動支援 Tab 分隔)
 * @param {string} text 
 */
function parsePastedText(text) {
  const rows = text.split(/\r?\n/);
  const previewContainer = document.getElementById('import-preview-container');
  const previewCount = document.getElementById('import-preview-count');
  const uploadBtn = document.getElementById('import-upload-btn');
  
  parsedVocabList = [];
  previewContainer.innerHTML = '';

  rows.forEach((row, index) => {
    if (!row.trim()) return;

    let cols = row.split('\t');
    if (cols.length <= 1) {
      cols = row.split(',');
    }

    if (index === 0 && (cols[0].includes('單字') || cols[0].includes('詞彙') || cols[0].includes('Word'))) {
      return;
    }

    const word = cols[0] ? cols[0].trim() : '';
    if (!word) return;

    const collocation = cols[1] ? cols[1].trim() : '';
    const sentence = cols[2] ? cols[2].trim() : '';
    const sentenceEN = cols[3] ? cols[3].trim() : '';
    const source = cols[4] ? cols[4].trim() : '預設課別';
    const image = cols[5] ? cols[5].trim() : '';
    const audioWord = cols[6] ? cols[6].trim() : '';
    const audioSentence = cols[7] ? cols[7].trim() : '';

    const vocabItem = {
      word,
      collocation,
      sentence,
      sentenceEN,
      source,
      image,
      audioWord,
      audioSentence,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    parsedVocabList.push(vocabItem);

    const itemEl = document.createElement('div');
    itemEl.className = 'preview-item';
    itemEl.innerHTML = `
      <div>
        <span class="preview-title">${word}</span>
        ${collocation ? `<span class="preview-colloc">(${collocation})</span>` : ''}
        <span class="badge badge-mode" style="margin-left:0.5rem; font-size:0.7rem; padding:0.15rem 0.4rem;">${source}</span>
      </div>
      <div class="preview-sentences">
        <strong>中：</strong>${sentence || '無'}<br>
        <strong>英：</strong>${sentenceEN || '無'}
      </div>
    `;
    previewContainer.appendChild(itemEl);
  });

  previewCount.textContent = parsedVocabList.length.toString();

  if (parsedVocabList.length > 0) {
    uploadBtn.classList.remove('hidden');
    showToast(`解析完畢！共 ${parsedVocabList.length} 筆資料可準備上傳。`, 'info');
  } else {
    uploadBtn.classList.add('hidden');
    previewContainer.innerHTML = '<div class="empty-state" style="color: var(--color-danger)">沒有解析出有效的單字，請檢查貼上格式。</div>';
  }
}

/**
 * 批次寫入 Firestore 詞彙 (自動分拆 500 筆上限)
 * @param {Array} list 
 */
async function uploadVocabBatch(list) {
  const CHUNK_SIZE = 500;
  
  for (let i = 0; i < list.length; i += CHUNK_SIZE) {
    const chunk = list.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();

    chunk.forEach(item => {
      // 隨機生成 ID 並寫入 textbookVocab 集合
      const docRef = db.collection('textbookVocab').doc();
      batch.set(docRef, item);
    });

    await batch.commit();
  }
}

/**
 * 繪製現有詞彙庫表格
 * @param {boolean} forceRefresh 
 */
async function renderVocabListTable(forceRefresh = false) {
  const rowsContainer = document.getElementById('vocab-list-rows');
  const totalCountText = document.getElementById('vocab-total-count');
  
  rowsContainer.innerHTML = '<tr><td colspan="5" class="text-center">正在載入現有字庫中...</td></tr>';

  try {
    const list = await getTextbookVocab(forceRefresh);
    totalCountText.textContent = list.length.toString();

    if (list.length === 0) {
      rowsContainer.innerHTML = '<tr><td colspan="5" class="text-center">字庫目前空空如也，請在上方匯入！</td></tr>';
      return;
    }

    rowsContainer.innerHTML = '';
    
    list.forEach(item => {
      const tr = document.createElement('tr');
      
      // 多媒體檢查
      const mediaHtml = [];
      if (item.image) mediaHtml.push(`<span class="media-tag"><span class="material-icons-round" style="font-size:0.95rem;">image</span> ${item.image}</span>`);
      if (item.audioWord) mediaHtml.push(`<span class="media-tag"><span class="material-icons-round" style="font-size:0.95rem;">volume_up</span> ${item.audioWord}</span>`);
      if (item.audioSentence) mediaHtml.push(`<span class="media-tag"><span class="material-icons-round" style="font-size:0.95rem;">play_circle</span> ${item.audioSentence}</span>`);
      
      if (mediaHtml.length === 0) {
        mediaHtml.push('<span class="media-tag-missing">無多媒體</span>');
      }

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; font-size:1.05rem;">${item.word}</div>
          <div style="color: var(--text-secondary); font-size:0.8rem;">搭配：${item.collocation || '無'}</div>
        </td>
        <td>
          <span class="badge badge-mode">${item.source}</span>
        </td>
        <td class="vocab-cell-sentences">
          <strong>中：</strong>${item.sentence || '無'}<br>
          <strong>英：</strong>${item.sentenceEN || '無'}
        </td>
        <td class="vocab-cell-media">
          ${mediaHtml.join('')}
        </td>
        <td>
          <button class="btn btn-logout delete-vocab-btn" data-id="${item.id}" style="padding:0.4rem;" title="刪除">
            <span class="material-icons-round" style="font-size:1.15rem;">delete</span>
          </button>
        </td>
      `;
      
      // 綁定刪除事件
      tr.querySelector('.delete-vocab-btn').onclick = async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm(`確定要刪除單字「${item.word}」嗎？這個動作無法復原！`)) {
          try {
            await db.collection('textbookVocab').doc(id).delete();
            showToast('單字已刪除！', 'success');
            await renderVocabListTable(true); // 強制重整雲端並重繪
          } catch (err) {
            showToast(`刪除失敗: ${err.message}`, 'error');
          }
        }
      };

      rowsContainer.appendChild(tr);
    });
  } catch (error) {
    rowsContainer.innerHTML = `<tr><td colspan="5" class="text-center" style="color: var(--color-danger)">載入字庫失敗: ${error.message}</td></tr>`;
  }
}
