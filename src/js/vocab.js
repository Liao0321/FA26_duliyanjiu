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
 * 取得學生自訂詞彙清單
 * @returns {Promise<Array>}
 */
export async function getCustomVocab() {
  if (!auth.currentUser) return [];

  try {
    const snapshot = await db.collection('userCustomVocab')
      .where('uid', '==', auth.currentUser.uid)
      .get();
      
    const list = [];
    snapshot.forEach(doc => {
      list.push({ id: doc.id, ...doc.data() });
    });
    return list;
  } catch (error) {
    console.error("載入自訂詞彙失敗:", error);
    return [];
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
export async function initTeacherConsole() {
  const pasteArea = document.getElementById('import-paste-area');
  const parseBtn = document.getElementById('import-parse-btn');
  const uploadBtn = document.getElementById('import-upload-btn');
  const previewCount = document.getElementById('import-preview-count');
  const previewContainer = document.getElementById('import-preview-container');

  // 重設表單與狀態
  pasteArea.value = '';
  uploadBtn.classList.add('hidden');
  previewCount.textContent = '0';
  previewContainer.innerHTML = '<div class="empty-state">請貼上內容並點選「解析貼上內容」</div>';
  parsedVocabList = [];

  // 1. 綁定解析按鈕事件
  parseBtn.onclick = () => {
    const text = pasteArea.value.trim();
    if (!text) {
      showToast('請先貼上 Google Sheets 複製的內容！', 'error');
      return;
    }
    parsePastedText(text);
  };

  // 2. 綁定上傳按鈕事件
  uploadBtn.onclick = async () => {
    if (parsedVocabList.length === 0) return;
    
    uploadBtn.disabled = true;
    uploadBtn.textContent = '正在上傳...';
    
    try {
      await uploadVocabBatch(parsedVocabList);
      showToast(`成功匯入 ${parsedVocabList.length} 筆詞彙至雲端！`, 'success');
      
      // 清空輸入並更新快取與清單
      pasteArea.value = '';
      uploadBtn.classList.add('hidden');
      previewCount.textContent = '0';
      previewContainer.innerHTML = '<div class="empty-state">匯入成功！您可以繼續貼上新資料。</div>';
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

  // 3. 繪製現有詞彙表格
  await renderVocabListTable(false);
}

/**
 * 解析複製貼上文字 (自動支援 Tab 與 CSV 分隔)
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
    // 略過空行
    if (!row.trim()) return;

    // Google Sheets 貼上預設為 Tab (\t) 分隔，若無則降級使用半角逗號 (,)
    let cols = row.split('\t');
    if (cols.length <= 1) {
      cols = row.split(',');
    }

    // 剔除可能的欄位頭部 (標題列防呆)
    if (index === 0 && (cols[0].includes('單字') || cols[0].includes('詞彙') || cols[0].includes('Word'))) {
      return;
    }

    const word = cols[0] ? cols[0].trim() : '';
    // 單字必填
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
