import { db, auth } from './firebase.js';
import { getMergedVocabList } from './vocab.js';

let leaderboardListener = null;

/**
 * 初始化並監聽即時排行榜 (限制 10 筆)
 */
/**
 * 載入指定模式的排行榜資料並即時監聽
 * @param {'weekly' | 'endless'} mode 排行榜模式
 */
function loadLeaderboardData(mode) {
  const rowsContainer = document.getElementById('leaderboard-rows');
  const myRankCard = document.getElementById('my-ranking-card');
  const headersRow = document.getElementById('leaderboard-headers');

  // 若有既有的監聽器，先卸載以防重複訂閱
  if (leaderboardListener) {
    leaderboardListener();
    leaderboardListener = null;
  }

  // 動態更新表頭
  if (headersRow) {
    if (mode === 'weekly') {
      headersRow.innerHTML = `
        <th>排名</th>
        <th>名字</th>
        <th>挑戰分數</th>
        <th>正確率</th>
        <th>完成時間</th>
        <th>更新時間</th>
      `;
    } else {
      headersRow.innerHTML = `
        <th>排名</th>
        <th>名字</th>
        <th>答對題數</th>
        <th>平均時間</th>
        <th>更新時間</th>
      `;
    }
  }

  // 顯示載入中
  rowsContainer.innerHTML = '<tr><td colspan="6" class="text-center">載入排行榜數據中...</td></tr>';

  const targetCollection = mode === 'weekly' ? 'leaderboard' : 'leaderboardEndless';

  // 實施即時監聽 Firestore
  leaderboardListener = db.collection(targetCollection)
    .orderBy('score', 'desc')
    .onSnapshot(async (snapshot) => {
      rowsContainer.innerHTML = '';
      
      const allRankings = [];
      snapshot.forEach(doc => {
        allRankings.push({ id: doc.id, ...doc.data() });
      });

      // 記憶體複合排序，避免 Firestore 複合索引限制
      if (mode === 'weekly') {
        allRankings.sort((a, b) => {
          const scoreA = a.score || 0;
          const scoreB = b.score || 0;
          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }
          const timeA = a.timeSpent || 0;
          const timeB = b.timeSpent || 0;
          return timeA - timeB; // 耗時越短越靠前
        });
      } else {
        allRankings.sort((a, b) => {
          const scoreA = a.score || 0;
          const scoreB = b.score || 0;
          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }
          const timeA = a.avgTime || 999.0;
          const timeB = b.avgTime || 999.0;
          return timeA - timeB; // 平均作答時間越短越靠前
        });
      }

      if (allRankings.length === 0) {
        const colSpan = mode === 'weekly' ? 6 : 5;
        rowsContainer.innerHTML = `<tr><td colspan="${colSpan}" class="text-center">目前尚無挑戰數據，快去當第一個吧！</td></tr>`;
        myRankCard.classList.add('hidden');
        return;
      }

      // 1. 繪製前 10 名至表格中
      const top10 = allRankings.slice(0, 10);
      top10.forEach((item, index) => {
        const rank = index + 1;
        const tr = document.createElement('tr');
        
        let rankBadge = '';
        if (rank === 1) rankBadge = '<span class="rank-badge-item rank-1">1</span>';
        else if (rank === 2) rankBadge = '<span class="rank-badge-item rank-2">2</span>';
        else if (rank === 3) rankBadge = '<span class="rank-badge-item rank-3">3</span>';
        else rankBadge = `<span class="rank-other">${rank}</span>`;

        // 格式化時間
        const updateDate = item.updatedAt ? new Date(item.updatedAt.seconds * 1000 || item.updatedAt) : new Date();
        const timeStr = `${(updateDate.getMonth()+1)}/${updateDate.getDate()} ${updateDate.getHours().toString().padStart(2,'0')}:${updateDate.getMinutes().toString().padStart(2,'0')}`;

        if (mode === 'weekly') {
          tr.innerHTML = `
            <td>${rankBadge}</td>
            <td style="font-weight:600;">${item.username}</td>
            <td style="color:var(--color-warning); font-weight:700;">${item.score} 分</td>
            <td>${item.accuracy || 0}%</td>
            <td>${item.timeSpent || 0}秒</td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${timeStr}</td>
          `;
        } else {
          tr.innerHTML = `
            <td>${rankBadge}</td>
            <td style="font-weight:600;">${item.username}</td>
            <td style="color:var(--color-warning); font-weight:700;">${item.score} 題</td>
            <td>${item.avgTime || 0}秒</td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${timeStr}</td>
          `;
        }

        rowsContainer.appendChild(tr);
      });

      // 2. 處理當前登入學生的「個人排名卡片」
      if (auth.currentUser) {
        const myUid = auth.currentUser.uid;
        const myIndex = allRankings.findIndex(item => item.uid === myUid);
        const cheerEl = document.getElementById('my-rank-cheer');
        const rankInfoPara = document.querySelector('#my-ranking-card .rank-info p');

        if (myIndex !== -1) {
          const myData = allRankings[myIndex];
          const myRank = myIndex + 1;
          
          document.getElementById('my-rank-number').textContent = `#${myRank}`;
          document.getElementById('my-rank-name').textContent = myData.username;
          
          if (mode === 'weekly') {
            if (rankInfoPara) {
              rankInfoPara.innerHTML = `最高分數：<strong id="my-rank-score">${myData.score} 分</strong> | 正確率：<span id="my-rank-accuracy">${myData.accuracy}%</span> | 耗時：<span id="my-rank-time">${myData.timeSpent}秒</span>`;
            }

            // 設定每週挑戰勉勵字樣與超越計算
            if (myRank === 1) {
              cheerEl.innerHTML = '👑 太強了！您目前是班級第一名！繼續保持！';
            } else if (myRank <= 3) {
              cheerEl.innerHTML = '✨ 棒極了！維持在前三名黃金殿堂中！';
            } else {
              const aboveUser = allRankings[myIndex - 1];
              const diffScore = aboveUser.score - myData.score;
              cheerEl.innerHTML = `🔥 再獲得 <strong>${diffScore} 分</strong>，就能超越上一位同學（${aboveUser.username}）囉！`;
            }
          } else {
            if (rankInfoPara) {
              rankInfoPara.innerHTML = `最高答對：<strong id="my-rank-score">${myData.score} 題</strong> | 平均時間：<span id="my-rank-time">${myData.avgTime}秒</span>`;
            }

            // 設定無盡挑戰勉勵字樣與超越計算
            if (myRank === 1) {
              cheerEl.innerHTML = '👑 太強了！您目前是無盡挑戰班級第一名！繼續保持！';
            } else if (myRank <= 3) {
              cheerEl.innerHTML = '✨ 棒極了！維持在無盡挑戰前三名中！';
            } else {
              const aboveUser = allRankings[myIndex - 1];
              if (aboveUser.score > myData.score) {
                const diffScore = aboveUser.score - myData.score;
                cheerEl.innerHTML = `🔥 再多答對 <strong>${diffScore} 題</strong>，就能超越上一位同學（${aboveUser.username}）囉！`;
              } else {
                const diffTime = (myData.avgTime - aboveUser.avgTime).toFixed(2);
                cheerEl.innerHTML = `🔥 平均作答時間再快 <strong>${diffTime} 秒</strong>，就能超越上一位同學（${aboveUser.username}）囉！`;
              }
            }
          }

          myRankCard.classList.remove('hidden');
        } else {
          // 學生尚未參與過挑戰
          document.getElementById('my-rank-number').textContent = '#--';
          document.getElementById('my-rank-name').textContent = auth.currentUser.displayName || '學生';
          
          if (mode === 'weekly') {
            if (rankInfoPara) {
              rankInfoPara.innerHTML = `最高分數：<strong id="my-rank-score">無紀錄</strong> | 正確率：<span id="my-rank-accuracy">0%</span> | 耗時：<span id="my-rank-time">0s</span>`;
            }
            cheerEl.innerHTML = '您這週還沒有參與每週挑戰喔，快去挑戰上榜吧！';
          } else {
            if (rankInfoPara) {
              rankInfoPara.innerHTML = `最高答對：<strong id="my-rank-score">無紀錄</strong> | 平均時間：<span id="my-rank-time">0s</span>`;
            }
            cheerEl.innerHTML = '您還沒有參與無盡挑戰喔，快去挑戰你的極限吧！';
          }
          myRankCard.classList.remove('hidden');
        }
      }
    }, (error) => {
      console.error("即時監聽排行榜出錯:", error);
      const colSpan = mode === 'weekly' ? 6 : 5;
      rowsContainer.innerHTML = `<tr><td colspan="${colSpan}" class="text-center" style="color:var(--color-danger)">載入排行榜失敗，請檢查權限</td></tr>`;
    });
}

/**
 * 初始化並監聽即時排行榜 (限制 10 筆)
 */
export function initLeaderboard() {
  const tabWeekly = document.getElementById('leaderboard-tab-weekly');
  const tabEndless = document.getElementById('leaderboard-tab-endless');

  // 綁定頁籤點擊事件
  if (tabWeekly && tabEndless) {
    tabWeekly.onclick = () => {
      tabWeekly.classList.add('active');
      tabEndless.classList.remove('active');
      loadLeaderboardData('weekly');
    };
    tabEndless.onclick = () => {
      tabEndless.classList.add('active');
      tabWeekly.classList.remove('active');
      loadLeaderboardData('endless');
    };
  }

  // 根據當前頁籤的 active 狀態預設載入對應模式，若無 active 則預設為 weekly
  if (tabWeekly && tabWeekly.classList.contains('active')) {
    loadLeaderboardData('weekly');
  } else if (tabEndless && tabEndless.classList.contains('active')) {
    loadLeaderboardData('endless');
  } else {
    if (tabWeekly) tabWeekly.classList.add('active');
    loadLeaderboardData('weekly');
  }
}

/**
 * 統計並渲染儀表板的各項數據 (Mastered, Review, Streaks, Weaknesses)
 */
export async function renderDashboard() {
  if (!auth.currentUser) return;
  
  const uid = auth.currentUser.uid;

  try {
    // 1. 載入合併字庫與進度
    const vocabList = await getMergedVocabList(false);
    const progressSnapshot = await db.collection('userProgress')
      .where('uid', '==', uid)
      .get();

    const progressList = [];
    progressSnapshot.forEach(doc => {
      progressList.push(doc.data());
    });

    const progressMap = {};
    progressList.forEach(p => {
      progressMap[p.vocabId] = p;
    });

    // 2. 計算 Mastery (達 7 次) 與 Review (今日待複習)
    let masteredCount = 0;
    let reviewCount = 0;
    const now = Date.now();

    vocabList.forEach(card => {
      const progress = progressMap[card.id];
      if (!progress) {
        reviewCount++; // 全新單字，今天可練習
      } else {
        const times = progress.times || [];
        if (times.length >= 7) {
          masteredCount++;
        } else {
          // 未熟記，檢查 24 小時內是否練習過
          let recent = false;
          if (times.length > 0) {
            const lastTime = new Date(times[times.length - 1].seconds * 1000 || times[times.length - 1]);
            recent = (now - lastTime.getTime()) < 24 * 60 * 60 * 1000;
          }
          if (!recent) reviewCount++;
        }
      }
    });

    document.getElementById('mastered-count').textContent = `${masteredCount} / ${vocabList.length}`;
    document.getElementById('review-count').textContent = reviewCount.toString();

    // 3. 計算連續學習天數 (Streak)
    const streak = calculateStreak(progressList);
    document.getElementById('streak-count').textContent = `${streak} 天`;

    // 4. 繪製「我的弱點區」前 5 名
    const weaknessList = progressList
      .filter(p => (p.incorrectCount || 0) > 0)
      .map(p => {
        // 比對找出單字原始內容
        const originalCard = vocabList.find(c => c.id === p.vocabId);
        return {
          word: originalCard ? originalCard.word : '未知單字',
          collocation: originalCard ? originalCard.collocation : '',
          incorrectCount: p.incorrectCount
        };
      })
      .sort((a, b) => b.incorrectCount - a.incorrectCount)
      .slice(0, 5);

    const weaknessContainer = document.getElementById('weakness-list');
    weaknessContainer.innerHTML = '';

    if (weaknessList.length === 0) {
      weaknessContainer.innerHTML = '<div class="empty-state">目前沒有弱點記錄，太棒了！</div>';
    } else {
      weaknessList.forEach(item => {
        const div = document.createElement('div');
        div.className = 'weakness-item';
        div.innerHTML = `
          <div class="weakness-info">
            <span class="weakness-word">${item.word}</span>
            <span class="weakness-colloc">${item.collocation ? `搭配：${item.collocation}` : ''}</span>
          </div>
          <span class="weakness-badge">忘記 ${item.incorrectCount} 次</span>
        `;
        weaknessContainer.appendChild(div);
      });
    }

  } catch (error) {
    console.error("計算儀表板數據失敗:", error);
  }
}

/**
 * 計算學生的連續學習天數 (Streak)
 * @param {Array} progressList 該使用者的所有練習記錄
 * @returns {number} 連續天數
 */
function calculateStreak(progressList) {
  if (progressList.length === 0) return 0;

  // 1. 收集所有練習記錄中的日期 (格式 YYYY-MM-DD)，包括成功與忘記
  const dateSet = new Set();
  progressList.forEach(p => {
    if (p.lastAttemptDate) {
      const d = new Date(p.lastAttemptDate.seconds * 1000 || p.lastAttemptDate);
      const dateStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
      dateSet.add(dateStr);
    }
  });

  const uniqueDates = Array.from(dateSet).sort((a, b) => new Date(b) - new Date(a));
  
  if (uniqueDates.length === 0) return 0;

  // 2. 判斷今天與昨天日期
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}-${today.getDate().toString().padStart(2,'0')}`;
  
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${(yesterday.getMonth()+1).toString().padStart(2,'0')}-${yesterday.getDate().toString().padStart(2,'0')}`;

  // 若最近一次練習既不是今天也不是昨天，代表連續中斷，Streak 為 0
  if (uniqueDates[0] !== todayStr && uniqueDates[0] !== yesterdayStr) {
    return 0;
  }

  // 3. 從最近的練習日開始往回數連續的天數
  let streak = 1;
  let currentDate = new Date(uniqueDates[0]);

  for (let i = 1; i < uniqueDates.length; i++) {
    const prevDate = new Date(uniqueDates[i]);
    const diffTime = Math.abs(currentDate - prevDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      streak++;
      currentDate = prevDate;
    } else if (diffDays > 1) {
      // 間隔大於1天，連續中斷
      break;
    }
  }

  return streak;
}
