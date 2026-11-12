// ================================================================
// 🎛️ host.js — 진행자 화면 로직
// ================================================================

// ================================================================
// 🌐 전역 상태
// ================================================================
const Host = {
  roomId:       null,
  hostId:       null,
  room:         null,
  stocks:       [],
  players:      [],
  holdings:     [],
  editStocks:   [...DEFAULT_STOCKS],  // 게임 시작 전 편집용 복사본
  processing:   false,                // 라운드 처리 중 여부 (중복 클릭 방지)
  subs:         [],                   // Realtime 구독 목록
};


// ================================================================
// 🚀 초기화
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 새로고침 복원
  const saved = sessionLoad('host');
  if (saved?.roomId) {
    Host.roomId = saved.roomId;
    Host.hostId = saved.hostId;
    await restoreHost();
    return;
  }
  showScreen('screen-setup');
});


// ================================================================
// 🏠 방 생성
// ================================================================
async function hostCreateRoom() {
  const totalRounds  = parseInt(document.getElementById('h-total-rounds').value) || 5;
  const initialCash  = parseInt(document.getElementById('h-initial-cash').value) || 1000000;

  if (totalRounds < 1 || totalRounds > 20) {
    return showToast('⚠️ 라운드는 1~20 사이로 설정하세요.');
  }
  if (initialCash < 10000) {
    return showToast('⚠️ 초기 자금은 10,000원 이상이어야 합니다.');
  }

  try {
    const roomId = generateRoomCode();
    const hostId = 'host_' + Date.now();

    await dbCreateRoom(roomId, hostId, totalRounds, initialCash);

    Host.roomId = roomId;
    Host.hostId = hostId;
    sessionSave('host', { roomId, hostId });

    showScreen('screen-stock-edit');
    renderStockEditor();
    document.getElementById('h-room-code-display').textContent = roomId;

  } catch (e) {
    showToast('❌ 방 생성 실패: ' + e.message);
  }
}


// ================================================================
// ✏️ 종목 편집 화면
// ================================================================
function renderStockEditor() {
  const tbody = document.getElementById('h-stock-tbody');
  tbody.innerHTML = '';

  Host.editStocks.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="tbl-input" value="${s.name}"
        onchange="Host.editStocks[${i}].name = this.value"></td>
      <td><input class="tbl-input" value="${s.ticker}"
        onchange="Host.editStocks[${i}].ticker = this.value"></td>
      <td><input class="tbl-input number" type="number" value="${s.price}"
        onchange="Host.editStocks[${i}].price = parseInt(this.value)||0"></td>
      <td><button class="btn btn-sm btn-danger"
        onclick="hostRemoveStock(${i})">🗑</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function hostAddStock() {
  Host.editStocks.push({ name: '새 종목', ticker: 'new' + Date.now(), price: 100000 });
  renderStockEditor();
}

function hostRemoveStock(i) {
  if (Host.editStocks.length <= 1) return showToast('⚠️ 종목은 최소 1개 이상이어야 합니다.');
  Host.editStocks.splice(i, 1);
  renderStockEditor();
}

function hostResetStocks() {
  Host.editStocks = [...DEFAULT_STOCKS];
  renderStockEditor();
  showToast('🔄 기본 종목으로 초기화했습니다.');
}


// ================================================================
// 🎮 게임 시작
// ================================================================
async function hostStartGame() {
  // 유효성 검사
  const names   = Host.editStocks.map(s => s.name.trim());
  const tickers = Host.editStocks.map(s => s.ticker.trim());

  if (names.some(n => !n))   return showToast('⚠️ 종목명을 모두 입력하세요.');
  if (tickers.some(t => !t)) return showToast('⚠️ 티커를 모두 입력하세요.');
  if (new Set(tickers).size !== tickers.length)
    return showToast('⚠️ 티커가 중복되었습니다.');
  if (Host.editStocks.some(s => s.price <= 0))
    return showToast('⚠️ 초기 가격은 0보다 커야 합니다.');

  try {
    setBtnLoading('h-btn-start', true);
    await processGameStart(Host.roomId, Host.editStocks);
    Host.room = await dbGetRoom(Host.roomId);
    await enterGameScreen();
  } catch (e) {
    showToast('❌ 게임 시작 실패: ' + e.message);
  } finally {
    setBtnLoading('h-btn-start', false);
  }
}


// ================================================================
// 🖥️ 게임 화면 진입
// ================================================================
async function enterGameScreen() {
  showScreen('screen-game');
  await refreshAll();
  subscribeAll();
  renderRoomInfo();
}

async function restoreHost() {
  try {
    Host.room = await dbGetRoom(Host.roomId);
    if (!Host.room) throw new Error('방 없음');

    if (Host.room.status === 'waiting') {
      showScreen('screen-stock-edit');
      renderStockEditor();
      document.getElementById('h-room-code-display').textContent = Host.roomId;
    } else {
      await enterGameScreen();
    }
  } catch (e) {
    sessionClear();
    showScreen('screen-setup');
    showToast('⚠️ 세션 복원 실패. 다시 시작해주세요.');
  }
}


// ================================================================
// 🔄 데이터 갱신
// ================================================================
async function refreshAll() {
  const [room, stocks, players, holdings] = await Promise.all([
    dbGetRoom(Host.roomId),
    dbGetStocks(Host.roomId),
    dbGetPlayers(Host.roomId),
    dbGetAllHoldings(Host.roomId),
  ]);
  Host.room     = room;
  Host.stocks   = stocks;
  Host.players  = players;
  Host.holdings = holdings;

  renderGameScreen();
}


// ================================================================
// 📡 Realtime 구독
// ================================================================
function subscribeAll() {
  Host.subs.push(
    dbWatchRoom(Host.roomId, async () => {
      Host.room = await dbGetRoom(Host.roomId);
      renderGameScreen();
    }),
    dbWatchStocks(Host.roomId, stocks => {
      Host.stocks = stocks;
      renderGameScreen();
    }),
    dbWatchPlayers(Host.roomId, players => {
      Host.players = players;
      // holdings도 함께 갱신해야 정확한 순위 계산이 가능
      dbGetAllHoldings(Host.roomId).then(holdings => {
        Host.holdings = holdings;
        renderRankings();
      });
    }),
  );

  // 학생 거래(holdings 변경) 감지 → 진행자 순위 실시간 갱신
  Host.subs.push(
    _sb
      .channel('host-holdings-' + Host.roomId)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'stock_holdings',
        filter: `room_id=eq.${Host.roomId}`,
      }, async () => {
        const [players, holdings] = await Promise.all([
          dbGetPlayers(Host.roomId),
          dbGetAllHoldings(Host.roomId),
        ]);
        Host.players  = players;
        Host.holdings = holdings;
        renderRankings();
      })
      .subscribe()
  );
}


// ================================================================
// 🖼️ 게임 화면 렌더링
// ================================================================
function renderGameScreen() {
  renderRoomInfo();
  renderStockTable();
  renderNewsList();
  renderRankings();
  renderNextBtn();
}

function renderRoomInfo() {
  const r = Host.room;
  if (!r) return;
  document.getElementById('h-info-code').textContent  = Host.roomId;
  document.getElementById('h-info-round').textContent =
    `${r.current_round} / ${r.total_rounds}`;
  document.getElementById('h-info-status').textContent =
    r.status === 'trading'  ? '📈 거래 중' :
    r.status === 'finished' ? '🏁 게임 종료' : r.status;
  document.getElementById('h-info-players').textContent =
    Host.players.length + '명';
}

function renderStockTable() {
  const tbody = document.getElementById('h-game-stock-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  Host.stocks.forEach(s => {
    const initPrice  = s.initial_price;
    const curPrice   = s.price;
    const totalRate  = initPrice > 0 ? (curPrice - initPrice) / initPrice : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.name}</td>
      <td class="${s.is_delisted ? 'delisted' : ''}">${
        s.is_delisted ? '🚫 상장폐지' : formatKRW(curPrice)
      }</td>
      <td class="${totalRate >= 0 ? 'up' : 'down'}">
        ${s.is_delisted ? '-' : formatRate(totalRate)}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderNewsList() {
  const round = Host.room?.current_round;
  if (!round) return;

  dbGetNews(Host.roomId, round).then(newsList => {
    const pre  = newsList.filter(n => n.phase === 'pre');
    const post = newsList.filter(n => n.phase === 'post');

    const preEl  = document.getElementById('h-news-pre');
    const postEl = document.getElementById('h-news-post');

    if (preEl) preEl.innerHTML = pre.length
      ? pre.map(n => `<li>📰 ${n.content}</li>`).join('')
      : '<li class="muted">뉴스 없음</li>';

    if (postEl) postEl.innerHTML = post.length
      ? post.map(n => `<li>📣 ${n.content}</li>`).join('')
      : '<li class="muted">결과 뉴스 없음</li>';
  });
}

function renderRankings() {
  const tbody = document.getElementById('h-rank-tbody');
  if (!tbody) return;

  // Host.holdings 는 subscribeAll/refreshAll 에서 항상 최신 상태 유지
  // 총자산 기준 내림차순 정렬을 방어적으로 보장
  const rankings = calcRankings(Host.players, Host.holdings, Host.stocks);
  rankings.sort((a, b) => b.total - a.total);

  tbody.innerHTML = '';
  rankings.forEach((r, i) => {
    const tr = document.createElement('tr');
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}위`;
    tr.innerHTML = `
      <td>${medal}</td>
      <td>${r.name}</td>
      <td>${formatKRW(r.cash)}</td>
      <td>${formatKRW(r.stockValue)}</td>
      <td><strong>${formatKRW(r.total)}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderNextBtn() {
  const btn = document.getElementById('h-btn-next');
  if (!btn) return;
  const r = Host.room;
  if (!r) return;

  if (r.status === 'finished') {
    btn.textContent = '🏁 게임 종료됨';
    btn.disabled    = true;
  } else {
    btn.textContent = `⏭️ 다음 라운드 (${r.current_round} → ${r.current_round + 1})`;
    btn.disabled    = Host.processing;
  }
}


// ================================================================
// ⏭️ 다음 라운드 버튼
// ================================================================
async function hostNextRound() {
  if (Host.processing) return;
  const r = Host.room;
  if (!r || r.status === 'finished') return;

  if (!confirm(`⏭️ ${r.current_round}라운드를 종료하고 다음으로 넘어갈까요?`)) return;

  Host.processing = true;
  renderNextBtn();

  try {
    const result = await processNextRound(
      Host.roomId,
      r.current_round,
      r.total_rounds
    );

    // 결과 반영
    await refreshAll();

    if (result.finished) {
      showToast('🏁 게임이 종료되었습니다!');
      renderFinishScreen(result.changes);
    } else {
      showToast(`✅ ${r.current_round + 1}라운드 시작!`);
    }

  } catch (e) {
    showToast('❌ 오류: ' + e.message);
  } finally {
    Host.processing = false;
    renderNextBtn();
  }
}


// ================================================================
// 🏆 게임 종료 화면
// ================================================================
function renderFinishScreen(lastChanges) {
  const rankings = calcRankings(Host.players, Host.holdings, Host.stocks);
  const el = document.getElementById('h-finish-section');
  if (!el) return;

  el.style.display = 'block';
  el.innerHTML = `
    <h2>🏆 최종 순위</h2>
    <table class="rank-table">
      <thead>
        <tr>
          <th>순위</th><th>이름</th>
          <th>현금</th><th>주식평가</th><th>총자산</th>
        </tr>
      </thead>
      <tbody>
        ${rankings.map((r, i) => {
          const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}위`;
          return `<tr>
            <td>${medal}</td>
            <td>${r.name}</td>
            <td>${formatKRW(r.cash)}</td>
            <td>${formatKRW(r.stockValue)}</td>
            <td><strong>${formatKRW(r.total)}</strong></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}


// ================================================================
// 🛠️ UI 유틸리티
// ================================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.style.display = 'none');
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

function showToast(msg) {
  const el = document.getElementById('h-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

function setBtnLoading(id, loading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) btn.dataset.origText = btn.textContent;
  btn.textContent = loading ? '⏳ 처리 중…' : (btn.dataset.origText || btn.textContent);
}
