// ================================================================
// 🎮 game.js — 주가 변동 · 뉴스 생성 · 라운드 처리 로직
// ================================================================


// ================================================================
// 🎲 주가 변동 계산
// ================================================================

/**
 * 한 종목의 다음 라운드 변동을 계산
 * @param {number} currentPrice 현재가
 * @returns {{ tier, label, changeRate, newPrice }}
 */
function calcPriceChange(currentPrice) {
  const tier       = rollTier();
  const changeRate = rollChangeRate(tier);
  const newPrice   = Math.max(0, Math.round(currentPrice * (1 + changeRate)));
  return {
    tier:       tier.tier,
    label:      tier.label,
    changeRate: changeRate,
    newPrice:   newPrice,
  };
}

/**
 * 전체 종목 변동 계산
 * @param {Array} stocks dbGetStocks() 결과
 * @returns {Array} results
 */
function calcAllPriceChanges(stocks) {
  return stocks.map(s => {
    if (s.is_delisted) {
      return {
        ticker:     s.ticker,
        name:       s.name,
        oldPrice:   0,
        newPrice:   0,
        changeRate: 0,
        tier:       'delisted',
        label:      '🚫 상장폐지',
      };
    }
    const result = calcPriceChange(s.price);
    return {
      ticker:     s.ticker,
      name:       s.name,
      oldPrice:   s.price,
      newPrice:   result.newPrice,
      changeRate: result.changeRate,
      tier:       result.tier,
      label:      result.label,
    };
  });
}


// ================================================================
// 📰 뉴스 생성
// ================================================================

/**
 * 거래 전 뉴스 10개 생성
 * - 25% 확률로 실제 변동 방향과 일치
 * - 75% 확률로 랜덤 (반대 방향 or 시장 전반)
 *
 * @param {Array} stocks      전체 종목 배열
 * @param {Array} realChanges calcAllPriceChanges() 결과 (미리 계산된 실제 변동)
 * @returns {string[]} 뉴스 문자열 10개
 */
function generatePreNews(stocks, realChanges) {
  const activeStocks = stocks.filter(s => !s.is_delisted);
  const newsList = [];

  for (let i = 0; i < 10; i++) {
    const isAccurate = Math.random() < 0.25;
    const stock      = activeStocks[Math.floor(Math.random() * activeStocks.length)];
    const realResult = realChanges.find(r => r.ticker === stock?.ticker);

    let content;

    if (isAccurate && stock && realResult) {
      // ✅ 실제 방향과 일치하는 뉴스
      const isUp = realResult.changeRate >= 0;
      const pool = isUp ? NEWS_BULL : NEWS_BEAR;
      content = pickRandom(pool).replace('{name}', stock.name);
    } else {
      // ❌ 랜덤 뉴스 (시장 전반 or 무작위 방향)
      const poolType = Math.floor(Math.random() * 3);
      if (poolType === 0) {
        content = pickRandom(NEWS_MARKET);
      } else if (poolType === 1) {
        const s = activeStocks[Math.floor(Math.random() * activeStocks.length)];
        content = pickRandom(NEWS_BULL).replace('{name}', s?.name || '시장');
      } else {
        const s = activeStocks[Math.floor(Math.random() * activeStocks.length)];
        content = pickRandom(NEWS_BEAR).replace('{name}', s?.name || '시장');
      }
    }

    newsList.push(content);
  }

  return newsList;
}

/**
 * 거래 후 뉴스 생성
 * - 큰폭상승 / 큰폭하락 / 대폭발 / 최악 종목만 뉴스 생성
 *
 * @param {Array} results calcAllPriceChanges() 결과
 * @returns {string[]} 뉴스 문자열 배열 (0개 이상)
 */
function generatePostNews(results) {
  const newsList = [];

  for (const r of results) {
    if (!POST_NEWS_TIERS.has(r.tier)) continue;

    const isUp   = r.changeRate >= 0;
    const pool   = isUp ? NEWS_BULL : NEWS_BEAR;
    const content = pickRandom(pool).replace('{name}', r.name);
    const prefix  = `${r.label} ${r.name} (${formatRate(r.changeRate)})`;
    newsList.push(`[${prefix}] ${content}`);
  }

  return newsList;
}


// ================================================================
// 🔄 라운드 진행 (진행자가 "다음 라운드" 버튼 눌렀을 때)
// ================================================================

/**
 * 다음 라운드 처리 전체 흐름
 * 1. 현재 종목 가격 조회
 * 2. 변동 계산
 * 3. DB에 새 가격 반영
 * 4. 라운드 결과 저장
 * 5. 거래 후 뉴스 저장
 * 6. room current_round + 1
 * 7. 다음 라운드 거래 전 뉴스 생성 & 저장
 *
 * @param {string} roomId
 * @param {number} currentRound  현재 라운드 번호
 * @param {number} totalRounds   총 라운드 수
 */
async function processNextRound(roomId, currentRound, totalRounds) {
  // 1. 종목 조회
  const stocks  = await dbGetStocks(roomId);
  const nextRound = currentRound + 1;

  // 2. 변동 계산 (미리 결정 — 뉴스 생성에도 사용)
  const changes = calcAllPriceChanges(stocks);

  // 3. DB 가격 업데이트
  for (const c of changes) {
    if (c.tier === 'delisted') continue;

    const isDelisted = c.newPrice <= 0;
    await dbUpdateStock(roomId, c.ticker, {
      price:       isDelisted ? 0 : c.newPrice,
      is_delisted: isDelisted,
    });
  }

  // 4. 라운드 결과 저장
  const resultRows = changes
    .filter(c => c.tier !== 'delisted')
    .map(c => ({
      ticker:     c.ticker,
      oldPrice:   c.oldPrice,
      newPrice:   c.newPrice,
      changeRate: c.changeRate,
      tier:       c.tier,
    }));
  await dbInsertRoundResults(roomId, nextRound, resultRows);

  // 5. 거래 후 뉴스 저장
  const postNews = generatePostNews(changes);
  if (postNews.length > 0) {
    await dbInsertNews(roomId, nextRound, 'post', postNews);
  }

  // 6. 게임 종료 여부 확인
  if (nextRound >= totalRounds) {
    await dbUpdateRoom(roomId, {
      current_round: nextRound,
      status:        'finished',
    });
    return { finished: true, changes };
  }

  // 7. 다음 라운드 거래 전 뉴스 생성
  //    (업데이트된 종목 가격 기준으로 한 번 더 조회)
  const updatedStocks  = await dbGetStocks(roomId);
  const nextChanges    = calcAllPriceChanges(updatedStocks);
  const preNews        = generatePreNews(updatedStocks, nextChanges);

  // ⚠️ nextChanges는 "예고" 용도로만 사용 — DB에 반영하지 않음
  //    실제 변동은 다음 processNextRound() 호출 시 새로 계산
  await dbInsertNews(roomId, nextRound + 1, 'pre', preNews);

  // 8. room 상태 업데이트
  await dbUpdateRoom(roomId, {
    current_round: nextRound,
    status:        'trading',
  });

  return { finished: false, changes };
}


// ================================================================
// 🏁 게임 시작 처리 (진행자가 "게임 시작" 버튼 눌렀을 때)
// ================================================================

/**
 * @param {string} roomId
 * @param {Array}  stocks  편집 완료된 종목 배열
 */
async function processGameStart(roomId, stocks) {
  // 1. 종목 DB 저장
  await dbInsertStocks(roomId, stocks);

  // 2. 1라운드 거래 전 뉴스 생성
  //    (실제 변동은 아직 결정 안 됨 — 뉴스만 미리 생성)
  const fakeChanges = calcAllPriceChanges(stocks.map(s => ({
    ...s,
    is_delisted: false,
  })));
  const preNews = generatePreNews(
    stocks.map(s => ({ ...s, is_delisted: false })),
    fakeChanges
  );
  await dbInsertNews(roomId, 1, 'pre', preNews);

  // 3. room 상태 → trading
  await dbUpdateRoom(roomId, {
    status:        'trading',
    current_round: 1,
  });
}


// ================================================================
// 💰 매수 처리
// ================================================================

/**
 * @param {string} roomId
 * @param {string} playerName
 * @param {string} ticker
 * @param {number} quantity
 * @param {number} currentPrice  현재 주가
 * @param {number} playerCash    현재 보유 현금
 */
async function processBuy(roomId, playerName, ticker, quantity, currentPrice, playerCash) {
  if (quantity <= 0)               throw new Error('수량은 1 이상이어야 합니다.');
  if (!Number.isInteger(quantity)) throw new Error('수량은 정수여야 합니다.');

  const totalCost = currentPrice * quantity;
  if (totalCost > playerCash)      throw new Error('잔액이 부족합니다.');

  // DB에서 직접 차감 (atomic) — 빠른 연속 거래로 인한 이중차감 방지
  await dbIncrementPlayerCash(roomId, playerName, -totalCost);
  // 보유 주식 추가
  await dbBuyStock(roomId, playerName, ticker, quantity, currentPrice);

  // 최신 현금 반환
  const player = await dbGetPlayer(roomId, playerName);
  return player.cash;
}


// ================================================================
// 💸 매도 처리
// ================================================================

/**
 * @param {string} roomId
 * @param {string} playerName
 * @param {string} ticker
 * @param {number} quantity
 * @param {number} currentPrice
 * @param {number} playerCash
 * @param {number} holdingQty    현재 보유 수량
 */
async function processSell(roomId, playerName, ticker, quantity, currentPrice, playerCash, holdingQty) {
  if (quantity <= 0)               throw new Error('수량은 1 이상이어야 합니다.');
  if (!Number.isInteger(quantity)) throw new Error('수량은 정수여야 합니다.');
  if (quantity > holdingQty)       throw new Error('보유 수량이 부족합니다.');

  const totalGain = currentPrice * quantity;

  // 보유 주식 차감 먼저
  await dbSellStock(roomId, playerName, ticker, quantity);
  // DB에서 직접 증가 (atomic) — 빠른 연속 거래로 인한 이중지급 방지
  await dbIncrementPlayerCash(roomId, playerName, totalGain);

  // 최신 현금 반환
  const player = await dbGetPlayer(roomId, playerName);
  return player.cash;
}


// ================================================================
// 🏆 순위 계산
// ================================================================

/**
 * 전체 플레이어 총자산 계산 및 상위 10명 반환
 * @param {Array} players   dbGetPlayers() 결과
 * @param {Array} holdings  dbGetAllHoldings() 결과
 * @param {Array} stocks    dbGetStocks() 결과
 * @returns {Array} 상위 10명 [ { name, cash, stockValue, total } ]
 */
function calcRankings(players, holdings, stocks) {
  const priceMap = {};
  stocks.forEach(s => { priceMap[s.ticker] = s.is_delisted ? 0 : s.price; });

  const ranked = players.map(p => {
    const myHoldings = holdings.filter(h =>
      h.player_name === p.name && h.quantity > 0
    );
    const stockValue = myHoldings.reduce((sum, h) => {
      return sum + (priceMap[h.ticker] || 0) * h.quantity;
    }, 0);
    return {
      name:       p.name,
      cash:       p.cash,
      stockValue: stockValue,
      total:      p.cash + stockValue,
    };
  });

  return ranked
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}
