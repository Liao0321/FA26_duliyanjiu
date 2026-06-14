import { db, auth } from './firebase.js';
import { getMergedVocabList } from './vocab.js';
import { showToast } from './app.js';

// 練習狀態
let availableCards = [];
let currentCard = null;
let currentProgress = null;
let currentAudio = null;

/**
 * 初始化練習頁面
 */
export async function initPractice() {
  // 重設界面狀態
  const flashcard = document.getElementById('flashcard');
  if (flashcard) flashcard.classList.remove('flipped');
  
  // 載入詞彙與進度
  await loadPracticeData();
  
  // 設置按鈕事件 (僅在首次載入時綁定)
  setupPracticeEvents();
  
  // 抽取第一張字卡
  drawNextCard();
}

/**
 * 載入並比對使用者練習進度
 */
async function loadPracticeData() {
  if (!auth.currentUser) return;

  try {
    // 1. 取得合併字庫
    const vocabList = await getMergedVocabList(false);
    
    // 2. 取得目前學生的 SRS 進度
    const progressSnapshot = await db.collection('userProgress')
      .where('uid', '==', auth.currentUser.uid)
      .get();
      
    const progressMap = {};
    progressSnapshot.forEach(doc => {
      progressMap[doc.data().vocabId] = doc.data();
    });

    const now = Date.now();
    availableCards = [];

    // 3. 篩選出今天可練習的單字 (SRS 未達 7 級，且 24 小時內未成功複習)
    vocabList.forEach(card => {
      const progress = progressMap[card.id];
      
      if (!progress) {
        // 沒有進度記錄，代表全新單字
        availableCards.push({ card, progress: { times: [], incorrectCount: 0 } });
      } else {
        const times = progress.times || [];
        const mastered = times.length >= 7;
        
        // 檢查 24 小時內是否有成功記錄
        let recentSuccess = false;
        if (times.length > 0) {
          const lastTime = new Date(times[times.length - 1].seconds * 1000 || times[times.length - 1]);
          recentSuccess = (now - lastTime.getTime()) < 24 * 60 * 60 * 1000;
        }

        // 若未過關且 24 小時內沒有成功記住過，則加入練習池
        if (!mastered && !recentSuccess) {
          availableCards.push({ card, progress });
        }
      }
    });

    document.getElementById('practice-status').textContent = `剩餘字卡: ${availableCards.length} 張`;
  } catch (e) {
    console.error("載入練習資料出錯:", e);
    showToast("無法載入練習進度，請重新整理", "error");
  }
}

/**
 * 依據弱點加權抽取下一張字卡
 */
function drawNextCard() {
  const flashcard = document.getElementById('flashcard');
  flashcard.classList.remove('flipped');

  // 停止之前正在播放的聲音
  stopAudio();

  if (availableCards.length === 0) {
    // 無卡片可練習
    currentCard = null;
    currentProgress = null;
    renderEmptyState();
    return;
  }

  // 執行加權隨機抽選 (弱點權重：忘記次數越多，抽中機率越高)
  // 權重公式 = 1 + (忘記次數 * 2)
  let totalWeight = 0;
  const weightedCards = availableCards.map(item => {
    const incorrect = item.progress.incorrectCount || 0;
    const weight = 1 + incorrect * 2;
    totalWeight += weight;
    return { ...item, weight };
  });

  let randomVal = Math.random() * totalWeight;
  let selected = weightedCards[0];

  for (let i = 0; i < weightedCards.length; i++) {
    randomVal -= weightedCards[i].weight;
    if (randomVal <= 0) {
      selected = weightedCards[i];
      break;
    }
  }

  currentCard = selected.card;
  currentProgress = selected.progress;

  // 渲染卡片內容
  renderCard(currentCard, currentProgress);
}

/**
 * 渲染卡片介面 (包含 3 種題型)
 */
function renderCard(card, progress) {
  // 顯示操作按鈕與字卡
  document.getElementById('flashcard').style.display = 'block';
  document.querySelector('.action-buttons').style.display = 'flex';
  document.querySelector('.srs-status-box').style.display = 'flex';
  document.querySelector('.speed-control').style.display = 'flex';

  const isCustom = card.isCustom;
  const collocationLabel = isCustom ? '英文翻譯' : '搭配詞';

  // 1. 決定隨機題型 (0: 翻譯, 1: 填空, 2: 造句)
  const mode = Math.floor(Math.random() * 3);
  const modeBadge = document.getElementById('practice-mode-badge');
  const questionText = document.getElementById('practice-question');

  if (mode === 0) {
    modeBadge.textContent = '【翻譯挑戰】';
    questionText.textContent = `請將以下的英文句子口頭翻譯為中文：\n\n${card.sentenceEN}`;
  } else if (mode === 1) {
    modeBadge.textContent = '【填空挑戰】';
    // 將中文例句中的單字與搭配詞挖空
    let blank = card.sentence;
    if (card.word) blank = blank.replaceAll(card.word, '_____');
    if (card.collocation) blank = blank.replaceAll(card.collocation, '_____');
    
    questionText.textContent = `請根據英文提示，口頭填入空格中的中文詞彙：\n\n${blank}\n\n英文提示：${card.sentenceEN}`;
  } else {
    modeBadge.textContent = '【造句挑戰】';
    questionText.textContent = `請使用下方詞彙與${collocationLabel}口頭完成造句：\n\n詞彙：「${card.word}」\n${collocationLabel}：「${card.collocation || '無'}」\n\n英文提示：${card.sentenceEN}`;
  }

  // 2. 處理提示圖片
  const imgBox = document.getElementById('practice-image-box');
  const imgEl = document.getElementById('practice-image');
  if (card.image) {
    imgEl.src = `assets/images/${card.image}`;
    imgBox.classList.remove('hidden');
  } else {
    imgBox.classList.add('hidden');
  }

  // 3. 處理卡片正面播放按鈕 (單字 / 例句)
  const wordPlayBtn = document.getElementById('play-word-audio-btn');
  const sentPlayBtn = document.getElementById('play-sentence-audio-btn');

  if (card.audioWord) {
    wordPlayBtn.classList.remove('hidden');
    wordPlayBtn.onclick = (e) => {
      e.stopPropagation(); // 阻止卡片翻轉
      playAudio(`assets/audio/words/${card.audioWord}`);
    };
  } else {
    wordPlayBtn.classList.add('hidden');
  }

  if (card.audioSentence) {
    sentPlayBtn.classList.remove('hidden');
    sentPlayBtn.onclick = (e) => {
      e.stopPropagation();
      playAudio(`assets/audio/sentences/${card.audioSentence}`);
    };
  } else {
    sentPlayBtn.classList.add('hidden');
  }

  // 4. 渲染卡片背面 (解答)
  document.getElementById('practice-word').textContent = card.word;
  document.getElementById('practice-collocation').textContent = card.collocation ? `${collocationLabel}：${card.collocation}` : '';
  document.getElementById('practice-sentence').textContent = card.sentence;
  document.getElementById('practice-sentence-en').textContent = card.sentenceEN;

  // 5. 處理背面播放按鈕
  const backWordBtn = document.getElementById('play-back-word-btn');
  const backSentBtn = document.getElementById('play-back-sentence-btn');

  if (card.audioWord) {
    backWordBtn.classList.remove('hidden');
    backWordBtn.onclick = (e) => {
      e.stopPropagation();
      playAudio(`assets/audio/words/${card.audioWord}`);
    };
  } else {
    backWordBtn.classList.add('hidden');
  }

  if (card.audioSentence) {
    backSentBtn.classList.remove('hidden');
    backSentBtn.onclick = (e) => {
      e.stopPropagation();
      playAudio(`assets/audio/sentences/${card.audioSentence}`);
    };
  } else {
    backSentBtn.classList.add('hidden');
  }

  // 6. 更新 SRS 圓點狀態 (以圓點標示目前掌握等級，0 ~ 7 級)
  const dots = document.querySelectorAll('#srs-dots .dot');
  const level = progress.times ? progress.times.length : 0;
  dots.forEach((dot, index) => {
    if (index < level) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

/**
 * 渲染「已背完所有單字」的狀態
 */
function renderEmptyState() {
  document.getElementById('practice-mode-badge').textContent = '【完成】';
  document.getElementById('practice-question').innerHTML = '🎉 今日所有卡片都已練習完畢！<br><br>請明天再來抽卡，或前往「每日挑戰」參與競速排行榜！';
  document.getElementById('practice-image-box').classList.add('hidden');
  document.getElementById('play-word-audio-btn').classList.add('hidden');
  document.getElementById('play-sentence-audio-btn').classList.add('hidden');
  
  // 隱藏背面按鈕與圓點
  document.querySelector('.action-buttons').style.display = 'none';
  document.querySelector('.srs-status-box').style.display = 'none';
  document.querySelector('.speed-control').style.display = 'none';
}

/**
 * 綁定練習按鈕與翻牌事件
 */
function setupPracticeEvents() {
  const flashcard = document.getElementById('flashcard');
  const flipBtn = document.getElementById('flip-btn');
  const rememberBtn = document.getElementById('remember-btn');
  const forgetBtn = document.getElementById('forget-btn');
  const refreshBtn = document.getElementById('practice-refresh-btn');

  // 1. 卡片點擊翻轉事件
  flashcard.onclick = () => {
    if (currentCard) {
      flashcard.classList.toggle('flipped');
      stopAudio();
    }
  };

  // 2. 翻牌按鈕事件
  flipBtn.onclick = (e) => {
    e.stopPropagation();
    if (currentCard) {
      flashcard.classList.toggle('flipped');
      stopAudio();
    }
  };

  // 3. 記住了 (Remembered) 事件
  rememberBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!currentCard || !auth.currentUser) return;
    
    rememberBtn.disabled = true;
    try {
      await handleRemember();
      showToast(`「${currentCard.word}」進度升級！`, 'success');
      // 重載資料並更新至下一張卡
      await loadPracticeData();
      drawNextCard();
    } catch (err) {
      showToast(`儲存失敗: ${err.message}`, 'error');
    } finally {
      rememberBtn.disabled = false;
    }
  };

  // 4. 忘記了 (Forgotten) 事件
  forgetBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!currentCard || !auth.currentUser) return;
    
    forgetBtn.disabled = true;
    try {
      const penalized = await handleForget();
      if (penalized) {
        showToast(`「${currentCard.word}」忘記了，受到降級處罰！`, 'error');
      } else {
        showToast(`「${currentCard.word}」已標記為忘記，下次優先練習。`, 'info');
      }
      await loadPracticeData();
      drawNextCard();
    } catch (err) {
      showToast(`儲存失敗: ${err.message}`, 'error');
    } finally {
      forgetBtn.disabled = false;
    }
  };

  // 5. 重新整理按鈕事件
  refreshBtn.onclick = async () => {
    await initPractice();
    showToast('練習資料已重整！', 'info');
  };
}

/**
 * 處理記住了邏輯 (寫入時間戳記)
 */
async function handleRemember() {
  const uid = auth.currentUser.uid;
  const vocabId = currentCard.id;
  const docId = `${uid}_${vocabId}`;
  
  // 獲取最新進度資料
  const docRef = db.collection('userProgress').doc(docId);
  const doc = await docRef.get();
  
  let times = [];
  if (doc.exists) {
    times = doc.data().times || [];
  }
  
  // 推入目前時間戳記
  const now = new Date();
  times.push(now);
  
  // 限制長度上限 7 次
  if (times.length > 7) {
    times = times.slice(-7);
  }

  await docRef.set({
    uid,
    vocabId,
    times,
    lastAttemptDate: now
  }, { merge: true });
}

/**
 * 處理忘記了邏輯 (24小時內降級扣分，累加忘記次數)
 * @returns {Promise<boolean>} 是否被扣減了階段等級 (Penalized)
 */
async function handleForget() {
  const uid = auth.currentUser.uid;
  const vocabId = currentCard.id;
  const docId = `${uid}_${vocabId}`;
  const docRef = db.collection('userProgress').doc(docId);
  
  const doc = await docRef.get();
  let times = [];
  let incorrectCount = 0;
  
  if (doc.exists) {
    times = doc.data().times || [];
    incorrectCount = doc.data().incorrectCount || 0;
  }

  let penalized = false;
  const now = Date.now();

  // 若最近一次的成功時間在 24 小時內，則退回一級 (Pop 一次時間戳記)
  if (times.length > 0) {
    const lastSuccessObj = times[times.length - 1];
    const lastSuccessTime = new Date(lastSuccessObj.seconds * 1000 || lastSuccessObj).getTime();
    
    if (now - lastSuccessTime < 24 * 60 * 60 * 1000) {
      times.pop(); // 降級處罰
      penalized = true;
    }
  }

  // 忘記次數遞增
  incorrectCount += 1;

  await docRef.set({
    uid,
    vocabId,
    times,
    incorrectCount,
    lastAttemptDate: new Date()
  }, { merge: true });

  return penalized;
}

/**
 * 播放 MP3 檔案
 * @param {string} path 
 */
function playAudio(path) {
  // 停止當前播放
  stopAudio();
  
  // 讀取當前播放速率
  const speedRadios = document.getElementsByName('audio-speed');
  let speed = 1.0;
  for (let r of speedRadios) {
    if (r.checked) {
      speed = parseFloat(r.value);
      break;
    }
  }

  const audio = new Audio(path);
  audio.playbackRate = speed;
  audio.play()
    .then(() => {
      currentAudio = audio;
    })
    .catch(err => {
      console.warn("播放音檔失敗，可能音檔不存在:", err);
      showToast("音檔載入失敗，請確認檔案是否存在於專案中！", "error");
    });
}

/**
 * 停止發音播放
 */
function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}
