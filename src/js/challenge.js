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
let challengeMode = 'weekly'; // 'weekly' | 'endless'
let endlessAvgTimeTracker = []; // 紀錄無盡模式每題作答時間
let endlessQuestionStartTime = 0;

/**
 * 初始化挑戰模組設定
 */
export async function initChallenge() {
  const startScreen = document.getElementById('challenge-start-screen');
  const playScreen = document.getElementById('challenge-play-screen');
  const resultScreen = document.getElementById('challenge-result-screen');
  
  const startWeeklyBtn = document.getElementById('start-weekly-challenge-btn');
  const startEndlessBtn = document.getElementById('start-endless-challenge-btn');
  const restartBtn = document.getElementById('challenge-restart-btn');
  const copyBtn = document.getElementById('copy-share-btn');
  const lessonLabel = document.getElementById('weekly-challenge-lesson-label');

  // 1. 顯示首頁說明，隱藏其他
  startScreen.classList.remove('hidden');
  playScreen.classList.add('hidden');
  resultScreen.classList.add('hidden');

  // 停止播放中的音效與計時
  stopChallengeAudio();
  if (timerInterval) clearInterval(timerInterval);

  // 1.5 讀取當前每週挑戰課別設定
  if (lessonLabel) {
    lessonLabel.textContent = '讀取中...';
    try {
      const configDoc = await db.collection('systemConfig').doc('weeklyChallenge').get();
      const currentLesson = configDoc.exists ? configDoc.data().currentLesson || 'ALL' : 'ALL';
      lessonLabel.textContent = currentLesson === 'ALL' ? '全部課別 (ALL)' : currentLesson;
    } catch (e) {
      console.warn("無法取得每週挑戰課別設定:", e);
      lessonLabel.textContent = '全部課別 (ALL)';
    }
  }

  // 2. 綁定按鈕事件
  if (startWeeklyBtn) {
    startWeeklyBtn.onclick = async () => {
      startWeeklyBtn.disabled = true;
      startWeeklyBtn.textContent = '正在準備題目...';
      try {
        await setupChallenge('weekly');
      } catch (e) {
        console.error(e);
        showToast(`初始化挑戰失敗: ${e.message}`, 'error');
      } finally {
        startWeeklyBtn.disabled = false;
        startWeeklyBtn.textContent = '開始每週挑戰';
      }
    };
  }

  if (startEndlessBtn) {
    startEndlessBtn.onclick = async () => {
      startEndlessBtn.disabled = true;
      startEndlessBtn.textContent = '正在準備題目...';
      try {
        await setupChallenge('endless');
      } catch (e) {
        console.error(e);
        showToast(`初始化挑戰失敗: ${e.message}`, 'error');
      } finally {
        startEndlessBtn.disabled = false;
        startEndlessBtn.textContent = '開始無盡挑戰';
      }
    };
  }

  if (restartBtn) {
    restartBtn.onclick = () => {
      initChallenge();
    };
  }

  if (copyBtn) {
    copyBtn.onclick = () => {
      const textarea = document.getElementById('share-text');
      textarea.select();
      document.execCommand('copy');
      showToast('複製分享成果成功，快去發給朋友看吧！', 'success');
    };
  }
}

/**
 * 準備挑戰題目與抽詞 (防呆、混合、題型生成)
 */
async function setupChallenge(mode) {
  challengeMode = mode;
  endlessAvgTimeTracker = [];

  // 1. 取得完整詞彙庫
  allVocabList = await getMergedVocabList(false);
  
  if (allVocabList.length < 4) {
    showToast('字庫單字太少 (少於 4 個)，無法生成選擇題選項！', 'error');
    return;
  }

  if (challengeMode === 'weekly') {
    // === 每週挑戰：過濾出本週指定課別 ===
    let currentLesson = 'ALL';
    try {
      const configDoc = await db.collection('systemConfig').doc('weeklyChallenge').get();
      if (configDoc.exists) {
        currentLesson = configDoc.data().currentLesson || 'ALL';
      }
    } catch (e) {
      console.warn("無法讀取每週挑戰設定，使用全部課別:", e);
    }

    let filteredList = allVocabList;
    if (currentLesson !== 'ALL') {
      filteredList = allVocabList.filter(item => item.source === currentLesson);
    }

    if (filteredList.length < 4) {
      showToast(`指定課別 [${currentLesson}] 的字彙量不足 4 筆，改為使用全部課別進行挑戰！`, 'warning');
      filteredList = allVocabList;
    }

    // 隨機抽取 10 個目標字
    shuffleArray(filteredList);
    targetWords = filteredList.slice(0, 10);
    
    // 若該課別單字少於 10 個，則從其他單字遞補
    if (targetWords.length < 10) {
      const remaining = allVocabList.filter(item => !targetWords.includes(item));
      shuffleArray(remaining);
      const need = 10 - targetWords.length;
      targetWords = [...targetWords, ...remaining.slice(0, need)];
    }

    shuffleArray(targetWords);

    // 生成 10 題
    challengeQuestions = targetWords.map(card => generateQuestionForCard(card));
  } else {
    // === 無盡挑戰：使用所有單字 ===
    targetWords = [...allVocabList];
    shuffleArray(targetWords);
    challengeQuestions = [];
  }

  // 初始化狀態
  currentQuestionIndex = 0;
  correctCount = 0;
  resultsEmojiArray = [];

  // 切換螢幕
  document.getElementById('challenge-start-screen').classList.add('hidden');
  document.getElementById('challenge-play-screen').classList.remove('hidden');

  // 開始計時或啟動第一題
  if (challengeMode === 'weekly') {
    startTime = Date.now();
    startTimer();
  }
  
  renderChallengeQuestion();
}

/**
 * 針對特定單字隨機生成一種題型選擇題
 */
function generateQuestionForCard(card) {
  const availableTypes = [0, 1];
  if (card.audioWord) availableTypes.push(2);
  if (card.audioSentence) availableTypes.push(3);

  const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];

  let questionText = '';
  let correctAnswer = '';
  let distractorField = '';
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

  // 生成三個干擾選項
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

  while (distractors.length < 3) {
    distractors.push(`備選干擾項 ${distractors.length + 1}`);
  }

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
  let question;
  if (challengeMode === 'weekly') {
    question = challengeQuestions[currentQuestionIndex];
    document.getElementById('challenge-question-num').textContent = `${currentQuestionIndex + 1} / 10`;
  } else {
    // 無盡挑戰：動態抽取下一個單字生成題目
    if (currentQuestionIndex >= targetWords.length) {
      targetWords = [...allVocabList];
      shuffleArray(targetWords);
    }
    const card = targetWords[currentQuestionIndex];
    question = generateQuestionForCard(card);
    challengeQuestions[currentQuestionIndex] = question; // 快取下來
    document.getElementById('challenge-question-num').textContent = `第 ${currentQuestionIndex + 1} 題 (連續答對: ${correctCount})`;
  }
  
  // 2. 顯示題目文字
  document.getElementById('challenge-question-text').textContent = question.questionText;

  // 3. 處理聽力按鈕
  const audioContainer = document.getElementById('challenge-media-container');
  const audioBtn = document.getElementById('challenge-audio-btn');
  
  stopChallengeAudio();

  if (question.audioPath) {
    audioContainer.classList.remove('hidden');
    audioBtn.onclick = () => {
      playChallengeAudio(question.audioPath);
    };
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

  // 5. 啟動無盡模式專屬倒數計時
  if (challengeMode === 'endless') {
    startEndlessQuestionTimer();
  }
}

/**
 * 處理學生點選選項
 */
async function handleOptionSelect(selectedBtn, selectedText, question) {
  const optionButtons = document.querySelectorAll('#challenge-options .option-btn');
  optionButtons.forEach(btn => btn.disabled = true);
  
  if (timerInterval) clearInterval(timerInterval);
  stopChallengeAudio();

  const isCorrect = (selectedText === question.correctAnswer);
  
  if (challengeMode === 'endless') {
    const elapsed = (Date.now() - endlessQuestionStartTime) / 1000;
    endlessAvgTimeTracker.push(elapsed);
  }

  if (isCorrect) {
    selectedBtn.classList.add('correct');
    correctCount++;
    resultsEmojiArray.push('🟩');
    showToast('答對了！', 'success');
  } else {
    selectedBtn.classList.add('incorrect');
    resultsEmojiArray.push('🟥');
    showToast(challengeMode === 'weekly' ? '答錯了，將列入您的弱點清單中！' : '答錯了！挑戰結束！', 'error');

    // 尋找並標明正確的按鈕
    optionButtons.forEach(btn => {
      if (btn.textContent === question.correctAnswer) {
        btn.classList.add('correct');
      }
    });

    recordChallengeError(question.vocabId);
  }

  // 延遲 1.5 秒進入下一題或結算
  setTimeout(() => {
    if (challengeMode === 'weekly') {
      currentQuestionIndex++;
      if (currentQuestionIndex < 10) {
        renderChallengeQuestion();
      } else {
        endChallenge();
      }
    } else {
      if (isCorrect) {
        currentQuestionIndex++;
        renderChallengeQuestion();
      } else {
        endChallenge();
      }
    }
  }, 1500);
}

/**
 * 每週挑戰：計時器邏輯
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
 * 無盡挑戰：每題 10 秒計時器
 */
function startEndlessQuestionTimer() {
  endlessQuestionStartTime = Date.now();
  const timerText = document.getElementById('challenge-timer-text');
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - endlessQuestionStartTime) / 1000;
    const remaining = 10.0 - elapsed;
    
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerText.textContent = '0.0s';
      handleEndlessTimeout();
    } else {
      timerText.textContent = `${remaining.toFixed(1)}s`;
    }
  }, 100);
}

/**
 * 無盡挑戰：超時未答處理
 */
function handleEndlessTimeout() {
  stopChallengeAudio();
  showToast('時間到！挑戰結束！', 'error');
  endlessAvgTimeTracker.push(10.0);
  endChallenge();
}

/**
 * 結束挑戰結算分數與排行榜寫入
 */
async function endChallenge() {
  if (timerInterval) clearInterval(timerInterval);
  stopChallengeAudio();

  // 1. 計算數據
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
  const emojiStr = resultsEmojiArray.join('');
  
  let score = 0;
  let timeSpent = 0;
  let avgTime = 0;
  let shareText = '';

  // 動態修改結算欄位名稱
  document.getElementById('result-stat-label-1').textContent = challengeMode === 'weekly' ? '答對題數' : '連續答對';
  document.getElementById('result-stat-label-2').textContent = challengeMode === 'weekly' ? '總共耗時' : '平均答題時間';
  document.getElementById('result-stat-label-3').textContent = challengeMode === 'weekly' ? '本次得分' : '挑戰成績';

  if (challengeMode === 'weekly') {
    timeSpent = (Date.now() - startTime) / 1000;
    
    // 每週挑戰計分公式
    let baseScore = correctCount * 100;
    let speedBonus = 0;
    if (correctCount === 10) {
      speedBonus = Math.max(0, Math.round((60.0 - timeSpent) * 10)); // 100% 正確率享有速度加分
    }
    score = baseScore + speedBonus;

    document.getElementById('result-correct').textContent = `${correctCount} / 10`;
    document.getElementById('result-time').textContent = `${timeSpent.toFixed(1)} 秒`;
    document.getElementById('result-score').textContent = `${score} 分`;

    shareText = `🎯 中文詞彙每週挑戰 ${dateStr}
得 分: ${score} 分 | 正確率: ${correctCount * 10}%
總耗時: ${timeSpent.toFixed(1)} 秒
${emojiStr}
#DomainResearchInChinese #每週排行榜`;
  } else {
    // 無盡挑戰計分公式
    score = correctCount;
    avgTime = endlessAvgTimeTracker.length > 0 
      ? endlessAvgTimeTracker.reduce((a, b) => a + b, 0) / endlessAvgTimeTracker.length 
      : 0;

    document.getElementById('result-correct').textContent = `${correctCount} 題`;
    document.getElementById('result-time').textContent = `${avgTime.toFixed(1)} 秒/題`;
    document.getElementById('result-score').textContent = `${score} 題`;

    shareText = `⚡ 中文詞彙極限無盡挑戰 ${dateStr}
連 擊: ${correctCount} 題 | 平均答題: ${avgTime.toFixed(1)} 秒/題
${emojiStr}
#DomainResearchInChinese #無盡排行榜`;
  }

  document.getElementById('share-text').value = shareText;

  // 2. 切換結果畫面
  document.getElementById('challenge-play-screen').classList.add('hidden');
  document.getElementById('challenge-result-screen').classList.remove('hidden');

  // 3. 自動寫入對應的雲端排行榜
  if (auth.currentUser) {
    try {
      const uid = auth.currentUser.uid;
      const targetCollection = challengeMode === 'weekly' ? 'leaderboard' : 'leaderboardEndless';
      const userRef = db.collection(targetCollection).doc(uid);
      const doc = await userRef.get();

      let shouldUpdate = true;
      if (doc.exists) {
        const oldScore = doc.data().score || 0;
        
        if (challengeMode === 'weekly') {
          if (score <= oldScore) {
            shouldUpdate = false;
          }
        } else {
          // 無盡挑戰排行覆寫邏輯：題數多者勝出；若題數相同，平均作答時間短者勝出
          const oldAvgTime = doc.data().avgTime || 999.0;
          if (score < oldScore) {
            shouldUpdate = false;
          } else if (score === oldScore && avgTime >= oldAvgTime) {
            shouldUpdate = false;
          }
        }
      }

      if (shouldUpdate) {
        const payload = {
          uid,
          username: auth.currentUser.displayName || '無名學生',
          score,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (challengeMode === 'weekly') {
          payload.accuracy = correctCount * 10;
          payload.timeSpent = Math.round(timeSpent);
        } else {
          payload.avgTime = parseFloat(avgTime.toFixed(2));
        }

        await userRef.set(payload);
        showToast('新最高分紀錄已自動上傳至排行榜！', 'success');
      } else {
        showToast('挑戰完成！此次分數未超越您的最高分數紀錄。', 'info');
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
