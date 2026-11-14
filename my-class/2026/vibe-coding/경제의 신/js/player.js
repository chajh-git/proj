// ================================================================
// 👤 player.js — 학생 화면 로직
// ================================================================

// ================================================================
// 🌐 전역 상태
// ================================================================
const Player = {
  roomId:       null,
  name:         null,
  room:         null,
  stocks:       [],
  holdings:     [],
  cash:         0,
  selectedStock: null,   // 매수/매도 팝업용 선택 종목
  processing:   false,
  subs:         [],
};


// ================================================================
// 🚀 초기화
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  const saved = sessionLoad('player');
  if (saved?.roomId && saved?.name) {
    Player.roomId = saved.roomId;
    Player.name   = saved.name;
    await restorePlayer();
    return;
  }
  showScreen('screen-join');
});


// ================================================================
// 🚪 방 입장
// ================================================================
async function playerJoin() {
  const roomId = document.getElementById('p-room-code').value.trim().toUpperCase();
  const name   = document.getElementById('p-name').value.trim();

  if (!roomId || roomId.length !== 4) return showToast('⚠️ 방 코드 4자리를 입력하세요.');
  if (!name)                          return showToast('⚠️ 이름을 입력하세요.');

  try {
    setBtnLoading('p-btn-join', true);

    // 방 존재 확인
    const room = await dbGetRoom(roomId);
    if (!room)                       throw new Error('존재하지 않는 방입니다.');
    if (room.status === 'finished')  throw new Error('이미 종료된 게임입니다.');

    // 플레이어 등록 (중복 이름 차단)
    await dbJoinPlayer(roomId, name, room.initial_cash);

    Player.roomId = roomId;
    Player.name   = name;
    Player.cash   = room.initial_cash;
    sessionSave('player', { roomId, name });

    await enterGameScreen();

  } catch (e) {
    if (e.message === 'DUPLICATE_NAME') {
      showToast('⚠️ 이미 사용 중인 이름입니다. 다른 이름을 입력하세요.');
    } else {
      showToast('❌ ' + e.message);
    }
  } finally {
    setBtnLoading('p-btn-join', false);
  }
}


// ================================================================
// 🔄 세션 복원 (새로고침 시)
// ================================================================
async function restorePlayer() {
  try {
    const room = await dbGetRoom(Player.roomId);
    if (!room) throw new Error('방 없음');
    Player.room = room;

    const playerData = await dbGetPlayer(Player.roomId, Player.name);
    if (!playerData || !playerData.is_active) throw new Error('세션 만료');

    Player.cash = playerData.cash;
    await enterGameScreen();

  } catch (e) {
    sessionClear();
    showScreen('screen-join');
    showToast('⚠️ 세션 복원 실패. 다시 입장해주세요.');
  }
}


// ================================================================
// 🖥️ 게임 화면 진입
// ================================================================
async function enterGameScreen() {
  showScreen('screen-game');
  await refreshAll();
  subscribeAll();
}


// ================================================================
// 🔄 데이터 갱신
// ================================================================
async function refreshAll() {
  const [room, stocks, playerData, holdings] = await Promise.all([
    dbGetRoom(Player.roomId),
    dbGetStocks(Player.roomId),
    dbGetPlayer(Player.roomId, Player.name),
    dbGetHoldings(Player.roomId, Player.name),
  ]);

  Player.room     = room;
  Player.stocks   = stocks;
  Player.cash     = playerData?.cash ?? Player.cash;
  Player.holdings = holdings;

  renderGameScreen();
}


// ================================================================
// 📡 Realtime 구독
// ================================================================
function subscribeAll() {
  Player.subs.push(
    // 방 상태 변경 (라운드 전환, 게임 종료)
    dbWatchRoom(Player.roomId, async newRoom => {
      const prevRound = Player.room?.current_round;
      Player.room = newRoom;

      if (newRoom.status === 'finished') {
        renderFinishScreen();
        return;
      }
      // 라운드 넘어갈 때 전체 갱신
      if (newRoom.current_round !== prevRound) {
        await refreshAll();
        showToast(`📢 ${newRoom.current_round}라운드가 시작되었습니다!`);
      }
      renderGameScreen();
    }),

    // 주가 변동
    dbWatchStocks(Player.roomId, stocks => {
      Player.stocks = stocks;
      renderStockTable();
      renderHoldings();
      renderAssetSummary();
    }),

    // 내 보유 현황 변경
    dbWatchHoldings(Player.roomId, Player.name, holdings => {
      Player.holdings = holdings;
      renderHoldings();
      renderAssetSummary();
    }),
  );

  // 뉴스 구독 (INSERT 감지)
  Player.subs.push(
    dbWatchNews(Player.roomId, async () => {
      const round = Player.room?.current_round;
      if (!round) return;
      const newsList = await dbGetNews(Player.roomId, round);
      renderNews(newsList);
    })
  );
}


// ================================================================
// 🖼️ 전체 게임 화면 렌더링
// ================================================================
function renderGameScreen() {
  renderHeader();
  renderStockTable();
  renderHoldings();
  renderAssetSummary();
  renderRankings();

  const round = Player.room?.current_round;
  if (round) {
    dbGetNews(Player.roomId, round).then(renderNews);
  }
}


// ================================================================
// 📋 헤더 (이름 · 라운드 · 잔액)
// ================================================================
function renderHeader() {
  const r = Player.room;
  document.getElementById('p-name-display').textContent  = Player.name;
  document.getElementById('p-round-display').textContent =
    r ? `${r.current_round} / ${r.total_rounds} 라운드` : '-';
  document.getElementById('p-cash-display').textContent  = formatKRW(Player.cash);
}


// ================================================================
// 📈 종목 목록 테이블
// ================================================================
function renderStockTable() {
  const tbody = document.getElementById('p-stock-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  Player.stocks.forEach(s => {
    const holding   = Player.holdings.find(h => h.ticker === s.ticker);
    const holdingQty = holding?.quantity ?? 0;
    const tr = document.createElement('tr');
    tr.className = s.is_delisted ? 'delisted-row' : 'clickable-row';

    tr.innerHTML = `
      <td>${s.name}</td>
      <td class="${s.is_delisted ? 'delisted' : ''}">${
        s.is_delisted ? '🚫 상장폐지' : formatKRW(s.price)
      }</td>
      <td>${holdingQty > 0 ? holdingQty + '주' : '-'}</td>
      <td>${s.is_delisted ? '-' :
        `<button class="btn btn-sm btn-buy"
          onclick="openTradeModal('${s.ticker}')">💰 거래</button>`
      }</td>
    `;
    tbody.appendChild(tr);
  });
}


// ================================================================
// 💼 보유 주식 현황
// ================================================================
function renderHoldings() {
  const tbody = document.getElementById('p-holdings-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const activeHoldings = Player.holdings.filter(h => h.quantity > 0);

  if (!activeHoldings.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">보유 주식 없음</td></tr>';
    return;
  }

  activeHoldings.forEach(h => {
    const stock      = Player.stocks.find(s => s.ticker === h.ticker);
    const curPrice   = stock?.is_delisted ? 0 : (stock?.price ?? 0);
    const curValue   = curPrice * h.quantity;
    const costBasis  = h.avg_price * h.quantity;
    const profit     = curValue - costBasis;
    const profitRate = costBasis > 0 ? profit / costBasis : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${stock?.name ?? h.ticker}${stock?.is_delisted ? ' 🚫' : ''}</td>
      <td>${h.quantity}주</td>
      <td>${formatKRW(h.avg_price)}</td>
      <td>${stock?.is_delisted ? '🚫 0원' : formatKRW(curValue)}</td>
      <td class="${profit >= 0 ? 'up' : 'down'}">
        ${profit >= 0 ? '+' : ''}${formatKRW(profit)}
        (${formatRate(profitRate)})
      </td>
    `;
    tbody.appendChild(tr);
  });
}


// ================================================================
// 💰 자산 요약
// ================================================================
function renderAssetSummary() {
  const stockValue = Player.holdings
    .filter(h => h.quantity > 0)
    .reduce((sum, h) => {
      const stock = Player.stocks.find(s => s.ticker === h.ticker);
      const price = stock?.is_delisted ? 0 : (stock?.price ?? 0);
      return sum + price * h.quantity;
    }, 0);

  const total = Player.cash + stockValue;

  document.getElementById('p-cash-value').textContent       = formatKRW(Player.cash);
  document.getElementById('p-stock-value').textContent      = formatKRW(stockValue);
  document.getElementById('p-total-value').textContent      = formatKRW(total);
}


// ================================================================
// 📰 뉴스
// ================================================================
function renderNews(newsList) {
  const pre  = newsList.filter(n => n.phase === 'pre');
  const post = newsList.filter(n => n.phase === 'post');

  const preEl  = document.getElementById('p-news-pre');
  const postEl = document.getElementById('p-news-post');

  if (preEl) preEl.innerHTML = pre.length
    ? pre.map(n => `<li>📰 ${n.content}</li>`).join('')
    : '<li class="muted">뉴스 없음</li>';

  if (postEl) postEl.innerHTML = post.length
    ? post.map(n => `<li>📣 ${n.content}</li>`).join('')
    : '<li class="muted">결과 뉴스 없음</li>';
}


// ================================================================
// 🏆 순위표
// ================================================================
function renderRankings() {
  dbGetPlayers(Player.roomId).then(async players => {
    const holdings = await dbGetAllHoldings(Player.roomId);
    const rankings = calcRankings(players, holdings, Player.stocks);
    const tbody    = document.getElementById('p-rank-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    rankings.forEach((r, i) => {
      const medal  = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}위`;
      const isMe   = r.name === Player.name;
      const tr     = document.createElement('tr');
      tr.className = isMe ? 'my-row' : '';
      tr.innerHTML = `
        <td>${medal}</td>
        <td>${r.name}${isMe ? ' ⭐' : ''}</td>
        <td>${formatKRW(r.total)}</td>
      `;
      tbody.appendChild(tr);
    });
  });
}


// ================================================================
// 💱 매수/매도 모달
// ================================================================
function openTradeModal(ticker) {
  const stock = Player.stocks.find(s => s.ticker === ticker);
  if (!stock || stock.is_delisted) return showToast('⚠️ 거래할 수 없는 종목입니다.');

  Player.selectedStock = stock;

  const holding = Player.holdings.find(h => h.ticker === ticker);

  document.getElementById('modal-stock-name').textContent  = stock.name;
  document.getElementById('modal-stock-price').textContent = formatKRW(stock.price);
  document.getElementById('modal-holding-qty').textContent =
    (holding?.quantity ?? 0) + '주';
  document.getElementById('modal-cash').textContent        = formatKRW(Player.cash);
  document.getElementById('modal-qty-input').value         = '';
  document.getElementById('modal-cost-preview').textContent = '-';

  document.getElementById('trade-modal').style.display = 'flex';
  document.getElementById('modal-qty-input').focus();
}

function closeTradeModal() {
  document.getElementById('trade-modal').style.display = 'none';
  Player.selectedStock = null;
}

// 수량 입력 시 예상 금액 미리보기
document.addEventListener('DOMContentLoaded', () => {
  const qtyInput = document.getElementById('modal-qty-input');
  if (qtyInput) {
    qtyInput.addEventListener('input', () => {
      const qty   = parseInt(qtyInput.value) || 0;
      const price = Player.selectedStock?.price ?? 0;
      const cost  = qty * price;
      document.getElementById('modal-cost-preview').textContent =
        qty > 0 ? formatKRW(cost) : '-';
    });
  }
});

async function executeBuy() {
  if (Player.processing) return;
  const stock = Player.selectedStock;
  if (!stock) return;

  const qty = parseInt(document.getElementById('modal-qty-input').value);
  if (!qty || qty <= 0) return showToast('⚠️ 수량을 입력하세요.');

  Player.processing = true;
  setBtnLoading('modal-btn-buy', true);

  try {
    const newCash = await processBuy(
      Player.roomId,
      Player.name,
      stock.ticker,
      qty,
      stock.price,
      Player.cash,
    );
    Player.cash = newCash;
    closeTradeModal();
    await refreshAll();
    showToast(`✅ ${stock.name} ${qty}주 매수 완료!`);
  } catch (e) {
    showToast('❌ ' + e.message);
  } finally {
    Player.processing = false;
    setBtnLoading('modal-btn-buy', false);
  }
}

async function executeSell() {
  if (Player.processing) return;
  const stock = Player.selectedStock;
  if (!stock) return;

  const qty     = parseInt(document.getElementById('modal-qty-input').value);
  const holding = Player.holdings.find(h => h.ticker === stock.ticker);
  const holdQty = holding?.quantity ?? 0;

  if (!qty || qty <= 0)  return showToast('⚠️ 수량을 입력하세요.');
  if (qty > holdQty)     return showToast(`⚠️ 보유 수량(${holdQty}주)을 초과했습니다.`);

  Player.processing = true;
  setBtnLoading('modal-btn-sell', true);

  try {
    const newCash = await processSell(
      Player.roomId,
      Player.name,
      stock.ticker,
      qty,
      stock.price,
      Player.cash,
      holdQty,
    );
    Player.cash = newCash;
    closeTradeModal();
    await refreshAll();
    showToast(`✅ ${stock.name} ${qty}주 매도 완료!`);
  } catch (e) {
    showToast('❌ ' + e.message);
  } finally {
    Player.processing = false;
    setBtnLoading('modal-btn-sell', false);
  }
}


// ================================================================
// 🚪 나가기
// ================================================================
async function playerLeave() {
  if (!confirm('🚪 게임에서 나가시겠습니까?\n나간 후에는 재입장할 수 없습니다.')) return;
  try {
    await dbLeavePlayer(Player.roomId, Player.name);
    sessionClear();
    showScreen('screen-join');
    showToast('👋 게임에서 나갔습니다.');
  } catch (e) {
    showToast('❌ ' + e.message);
  }
}


// ================================================================
// 🏁 게임 종료 화면
// ================================================================
async function renderFinishScreen() {
  showScreen('screen-finish');
  const players  = await dbGetPlayers(Player.roomId);
  const holdings = await dbGetAllHoldings(Player.roomId);
  const rankings = calcRankings(players, holdings, Player.stocks);
  const myRank   = rankings.findIndex(r => r.name === Player.name) + 1;
  const myResult = rankings.find(r => r.name === Player.name);

  document.getElementById('p-finish-msg').textContent =
    myRank > 0 ? `🏆 최종 ${myRank}위` : '게임 종료';

  const tbody = document.getElementById('p-finish-tbody');
  if (!tbody) return;
  tbody.innerHTML = rankings.map((r, i) => {
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}위`;
    const isMe  = r.name === Player.name;
    return `<tr class="${isMe ? 'my-row' : ''}">
      <td>${medal}</td>
      <td>${r.name}${isMe ? ' ⭐' : ''}</td>
      <td>${formatKRW(r.cash)}</td>
      <td>${formatKRW(r.stockValue)}</td>
      <td><strong>${formatKRW(r.total)}</strong></td>
    </tr>`;
  }).join('');
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
  const el = document.getElementById('p-toast');
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
  btn.textContent = loading
    ? '⏳ 처리 중…'
    : (btn.dataset.origText || btn.textContent);
}