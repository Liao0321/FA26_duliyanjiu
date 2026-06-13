import { db, auth } from './firebase.js';
import { getMergedVocabList } from './vocab.js';
import { showToast } from './app.js';

// 挑戰狀態變數
let allVocabList = [];
let targetWords = [];
let challengeQuestions = [];
let currentQuestionIndex = 0;
let correctCount = 0;
let startTime = 0;
let timerInterval = null;
let currentChallengeAudio = null;
let resultsEmojiArray = []; // 用於 Wordle 成果的 🟩 🟥 陣列

/**
 * 初始化挑戰模組設定
 */
export function initChallenge() {
  const startScreen = document.getElementById('challenge-start-screen');
  const playScreen = document.getElementById('challenge-play-screen');
  const resultScreen = document.getElementById('challenge-result-screen');
  const startBtn = document.getElementById('start-challenge-btn');
  const restartBtn = document.getElementById('challenge-restart-btn');
  const copyBtn = document.getElementById('copy-share-btn');

  // 1. 顯示首頁說明，隱藏其他
  startScreen.classList.remove('hidden');
  playScreen.classList.add('hidden');
  resultScreen.classList.add('hidden');

  // 停止播放中的音效
  stopChallengeAudio();

  // 2. 綁定按鈕事件
  startBtn.onclick = async () => {
    startBtn.disabled = true;
    startBtn.textContent = '正在準備題目...';
    try {
      await setupChallenge();
    } catch (e) {
      console.error(e);
      showToast(`初始化挑戰失敗: ${e.message}`, 'error');
      startBtn.disabled = false;
      startBtn.textContent = '開始挑戰';
    }
  };

  restartBtn.onclick = () => {
    initChallenge();
  };

  copyBtn.onclick = () => {
    const textarea = document.getElementById('share-text');
    textarea.select();
    document.execCommand('copy');
    showToast('複製分享成果成功，快去發給朋友看吧！', 'success');
  };
}

/**
 * 準備挑戰題目與抽詞 (防呆、混合、題型生成)
 */
async function setupChallenge() {
  // 1. 取得完整詞彙庫
  allVocabList = await getMergedVocabList(false);
  
  if (allVocabList.length < 4) {
    showToast('字庫單字太少 (少於 4 個)，無法生成選擇題選項！', 'error');
    const startBtn = document.getElementById('start-challenge-btn');
    startBtn.disabled = false;
    startBtn.textContent = '開始挑戰';
    return;
  }

  // 2. 篩選當前學生 SRS 還可以練習的單字
  const progressSnapshot = await db.collection('userProgress')
    .where('uid', '==', auth.currentUser.uid)
    .get();
    
  const progressMap = {};
  progressSnapshot.forEach(doc => {
    progressMap[doc.data().vocabId] = doc.data();
  });

  const now = Date.now();
  let eligibleWords = [];
  let otherWords = [];

  allVocabList.forEach(card => {
    const progress = progressMap[card.id];
    if (!progress) {
      eligibleWords.push(card);
    } else {
      const times = progress.times || [];
      const mastered = times.length >= 7;
      let recentSuccess = false;
      if (times.length > 0) {
        const lastTime = new Date(times[times.length - 1].seconds * 1000 || times[times.length - 1]);
        recentSuccess = (now - lastTime.getTime()) < 24 * 60 * 60 * 1000;
      }
      
      if (!mastered && !recentSuccess) {
        eligibleWords.push(card);
      } else {
        otherWords.push(card);
      }
    }
  });

  // 打亂可練習單字池
  shuffleArray(eligibleWords);
  shuffleArray(otherWords);

  // 3. 抽取 10 個目標字
  targetWords = eligibleWords.slice(0, 10);
  
  // 若不足 10 個，從已過關或今日練習過的單字中隨機抽取遞補
  if (targetWords.length < 10) {
    const needCount = 10 - targetWords.length;
    const padding = otherWords.slice(0, needCount);
    targetWords = [...targetWords, ...padding];
  }

  // 二次打亂，防範順序單調
  shuffleArray(targetWords);

  // 4. 生成 10 題選擇題
  challengeQuestions = [];
  targetWords.forEach(card => {
    const q = generateQuestionForCard(card);
    challengeQuestions.push(q);
  });

  // 5. 初始化作答狀態並啟動挑戰
  currentQuestionIndex = 0;
  correctCount = 0;
  resultsEmojiArray = [];
  
  const startBtn = document.getElementById('start-challenge-btn');
  startBtn.disabled = false;
  startBtn.textContent = '開始挑戰';

  // 切換螢幕
  document.getElementById('challenge-start-screen').classList.add('hidden');
  document.getElementById('challenge-play-screen').classList.remove('hidden');

  // 開始計時
  startTime = Date.now();
  startTimer();

  // 渲染第一題
  renderChallengeQuestion();
}

/**
 * 針對特定單字隨機生成一種題型選擇題
 * @param {object} card 目標字卡 
 * @returns {object} 題目規格物件
 */
function generateQuestionForCard(card) {
  // 決定可用題型列表 (0: 英翻中選擇, 1: 例句填空選擇)
  const availableTypes = [0, 1];
  
  // 聽音辨詞需要有單字發音音檔
  if (card.audioWord) availableTypes.push(2);
  // 聽句選詞需要有例句發音音檔
  if (card.audioSentence) availableTypes.push(3);

  // 隨機抽一個題型
  const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];

  let questionText = '';
  let correctAnswer = '';
  let distractorField = ''; // 用於產生干擾項的欄位種類
  let audioPath = '';

  switch (type) {
    case 0: // 中英翻譯
      questionText = `【翻譯選擇】請選出以下英文句子的正確中文翻譯：\n\n「 ${card.sentenceEN} 」`;
      correctAnswer = card.sentence;
      distractorField = 'sentence';
      break;
    case 1: // 填空選擇
      let blank = card.sentence;
      if (card.word) blank = blank.replaceAll(card.word, '_____');
      // 搭配詞若存在也一起挖空
      if (card.collocation) blank = blank.replaceAll(card.collocation, '_____');
      
      questionText = `【填空選擇】請依據英文提示，選出最適合填入空格中的詞彙：\n\n「 ${blank} 」\n\n英文提示：${card.sentenceEN}`;
      correctAnswer = card.word;
      distractorField = 'word';
      break;
    case 2: // 聽音辨詞
      questionText = `【聽力選擇】請播放並收聽單詞音檔，選出正確的中文單字：`;
      correctAnswer = card.word;
      distractorField = 'word';
      audioPath = `assets/audio/words/${card.audioWord}`;
      break;
    case 3: // 聽句選詞
      let blankSent = card.sentence;
      if (card.word) blankSent = blankSent.replaceAll(card.word, '_____');
      
      questionText = `【聽力填空】請播放並收聽中文例句發音，選出劇中被挖空 [_____] 的詞彙：\n\n「 ${blankSent} 」`;
      correctAnswer = card.word;
      distractorField = 'word';
      audioPath = `assets/audio/sentences/${card.audioSentence}`;
      break;
  }

  // 生成三個干擾選項 (必須不重複，且不能與正確答案相同)
  const distractors = [];
  const candidates = allVocabList.filter(item => item.id !== card.id);
  shuffleArray(candidates);

  for (let item of candidates) {
    const val = item[distractorField] ? item[distractorField].trim() : '';
    if (val && val !== correctAnswer && !distractors.includes(val)) {
      distractors.push(val);
    }
    if (distractors.length >= 3) break;
  }

  // 防呆：如果備選池不夠生出 3 個不同選項，用 placeholder 補足
  while (distractors.length < 3) {
    distractors.push(`備選干擾項 ${distractors.length + 1}`);
  }

  // 組合並打亂四個選項
  const options = [correctAnswer, ...distractors];
  shuffleArray(options);

  return {
    vocabId: card.id,
    type,
    questionText,
    audioPath,
    options,
    correctAnswer
  };
}

/**
 * 渲染單一挑戰問題
 */
function renderChallengeQuestion() {
  const question = challengeQuestions[currentQuestionIndex];
  
  // 1. 更新進度標題
  document.getElementById('challenge-question-num').textContent = `${currentQuestionIndex + 1} / 10`;
  
  // 2. 顯示題目文字
  document.getElementById('challenge-question-text').textContent = question.questionText;

  // 3. 處理聽力按鈕
  const audioContainer = document.getElementById('challenge-media-container');
  const audioBtn = document.getElementById('challenge-audio-btn');
  
  // 停止上一個問題的播放
  stopChallengeAudio();

  if (question.audioPath) {
    audioContainer.classList.remove('hidden');
    audioBtn.onclick = () => {
      playChallengeAudio(question.audioPath);
    };
    // 自動播放，提供更好的體驗
    playChallengeAudio(question.audioPath);
  } else {
    audioContainer.classList.add('hidden');
  }

  // 4. 繪製 4 個選項按鈕
  const optionsContainer = document.getElementById('challenge-options');
  optionsContainer.innerHTML = '';

  question.options.forEach((optText) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = optText;
    
    btn.onclick = (e) => {
      handleOptionSelect(e.currentTarget, optText, question);
    };

    optionsContainer.appendChild(btn);
  });
}

/**
 * 處理學生點選選項
 */
async function handleOptionSelect(selectedBtn, selectedText, question) {
  // 鎖定所有選項避免重複點選
  const optionButtons = document.querySelectorAll('#challenge-options .option-btn');
  optionButtons.forEach(btn => btn.disabled = true);
  
  stopChallengeAudio();

  const isCorrect = (selectedText === question.correctAnswer);
  
  if (isCorrect) {
    selectedBtn.classList.add('correct');
    correctCount++;
    resultsEmojiArray.push('🟩');
    showToast('答對了！加 100 分', 'success');
  } else {
    selectedBtn.classList.add('incorrect');
    resultsEmojiArray.push('🟥');
    showToast('答錯了，將列入您的弱點清單中！', 'error');

    // 尋找並標明正確的按鈕
    optionButtons.forEach(btn => {
      if (btn.textContent === question.correctAnswer) {
        btn.classList.add('correct');
      }
    });

    // 針對答錯的單字，異步更新其雲端 incorrectCount 加權日常練習
    recordChallengeError(question.vocabId);
  }

  // 延遲 1.5 秒進入下一題
  setTimeout(() => {
    currentQuestionIndex++;
    if (currentQuestionIndex < 10) {
      renderChallengeQuestion();
    } else {
      endChallenge();
    }
  }, 1500);
}

/**
 * 挑戰計時器邏輯
 */
function startTimer() {
  const timerText = document.getElementById('challenge-timer-text');
  
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    timerText.textContent = `${elapsed.toFixed(1)}s`;
  }, 100);
}

/**
 * 結束挑戰結算分數與排行榜寫入
 */
async function endChallenge() {
  // 1. 關閉計時器與音效
  if (timerInterval) clearInterval(timerInterval);
  stopChallengeAudio();

  const timeSpent = (Date.now() - startTime) / 1000;
  
  // 2. 計分公式：正確題數 * 100 - 秒數
  let score = (correctCount * 100) - Math.round(timeSpent);
  score = Math.max(0, score); // 避免負分

  // 3. 顯示結果畫面
  document.getElementById('challenge-play-screen').classList.add('hidden');
  document.getElementById('challenge-result-screen').classList.remove('hidden');

  document.getElementById('result-correct').textContent = `${correctCount} / 10`;
  document.getElementById('result-time').textContent = `${timeSpent.toFixed(1)} 秒`;
  document.getElementById('result-score').textContent = `${score} 分`;

  // 4. 產生 Wordle 分享區段
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
  const emojiStr = resultsEmojiArray.join('');
  
  const shareText = `🎯 中文詞彙每日挑戰 ${dateStr}
得 分: ${score} 分 | 正確率: ${correctCount * 10}%
總耗時: ${timeSpent.toFixed(1)} 秒
${emojiStr}
#中文詞彙挑戰 #排行榜競賽`;

  document.getElementById('share-text').value = shareText;

  // 5. 自動寫入雲端排行榜 (當日最高分覆蓋/存入)
  if (auth.currentUser) {
    try {
      const uid = auth.currentUser.uid;
      const userRef = db.collection('leaderboard').doc(uid);
      const doc = await userRef.get();

      let shouldUpdate = true;
      if (doc.exists) {
        const oldScore = doc.data().score || 0;
        // 如果新分數小於等於舊分數，不予覆寫 (只紀錄最高分)
        if (score <= oldScore) {
          shouldUpdate = false;
        }
      }

      if (shouldUpdate) {
        await userRef.set({
          uid,
          username: auth.currentUser.displayName || '無名學生',
          score,
          accuracy: correctCount * 10,
          timeSpent: Math.round(timeSpent),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('新最高分紀錄已自動上傳至即時排行榜！', 'success');
      } else {
        showToast('挑戰完成！此次分數未超越今日最高分數。', 'info');
      }
    } catch (err) {
      console.error(err);
      showToast('排行榜更新失敗，請檢查網路連線', 'error');
    }
  }
}

/**
 * 非同步背景更新答錯單字的 incorrectCount 權重
 */
async function recordChallengeError(vocabId) {
  if (!auth.currentUser) return;
  
  const uid = auth.currentUser.uid;
  const docId = `${uid}_${vocabId}`;
  
  try {
    await db.collection('userProgress').doc(docId).set({
      uid,
      vocabId,
      incorrectCount: firebase.firestore.FieldValue.increment(1),
      lastAttemptDate: new Date()
    }, { merge: true });
  } catch (e) {
    console.error("更新單字答錯加權進度失敗:", e);
  }
}

/**
 * 播放挑戰音檔
 */
function playChallengeAudio(path) {
  stopChallengeAudio();
  const audio = new Audio(path);
  audio.play()
    .then(() => {
      currentChallengeAudio = audio;
    })
    .catch(err => {
      console.warn("挑戰播放音檔失敗:", err);
    });
}

/**
 * 停止挑戰音檔
 */
function stopChallengeAudio() {
  if (currentChallengeAudio) {
    currentChallengeAudio.pause();
    currentChallengeAudio = null;
  }
}

/**
 * 陣列隨機打亂 (Fisher-Yates Shuffle)
 * @param {Array} array 
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
