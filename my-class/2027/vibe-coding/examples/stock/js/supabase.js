// ================================================================
// 🔌 supabase.js — Supabase 클라이언트 초기화 + 공통 헬퍼
// ================================================================

// ⚠️ 아래 두 값을 본인 Supabase 프로젝트 값으로 교체하세요
// Settings → API → Project URL / anon public key
const SUPABASE_URL  = 'https://sdhpzypjqmowhrhxvvsj.supabase.co';
const SUPABASE_ANON = 'sb_publishable_RRyqMtpm4qI0BZ9gdIjTvw_XOnJiaHc';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);


// ================================================================
// 🗂 stock_rooms
// ================================================================

async function dbCreateRoom(roomId, hostId, totalRounds, initialCash) {
  const { error } = await _sb.from('stock_rooms').insert({
    id:           roomId,
    host_id:      hostId,
    status:       'waiting',
    current_round: 0,
    total_rounds:  totalRounds,
    initial_cash:  initialCash,
  });
  if (error) throw error;
}

async function dbGetRoom(roomId) {
  const { data, error } = await _sb
    .from('stock_rooms')
    .select('*')
    .eq('id', roomId)
    .single();
  if (error) throw error;
  return data;
}

async function dbUpdateRoom(roomId, fields) {
  const { error } = await _sb
    .from('stock_rooms')
    .update(fields)
    .eq('id', roomId);
  if (error) throw error;
}

function dbWatchRoom(roomId, callback) {
  return _sb
    .channel('room-' + roomId)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'stock_rooms',
      filter: `id=eq.${roomId}`,
    }, payload => callback(payload.new))
    .subscribe();
}


// ================================================================
// 📈 stock_stocks
// ================================================================

async function dbInsertStocks(roomId, stocks) {
  const rows = stocks.map(s => ({
    room_id:       roomId,
    ticker:        s.ticker,
    name:          s.name,
    price:         s.price,
    initial_price: s.price,
    is_delisted:   false,
  }));
  const { error } = await _sb.from('stock_stocks').insert(rows);
  if (error) throw error;
}

async function dbGetStocks(roomId) {
  const { data, error } = await _sb
    .from('stock_stocks')
    .select('*')
    .eq('room_id', roomId)
    .order('id');
  if (error) throw error;
  return data;
}

async function dbUpdateStock(roomId, ticker, fields) {
  const { error } = await _sb
    .from('stock_stocks')
    .update(fields)
    .eq('room_id', roomId)
    .eq('ticker', ticker);
  if (error) throw error;
}

function dbWatchStocks(roomId, callback) {
  return _sb
    .channel('stocks-' + roomId)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'stock_stocks',
      filter: `room_id=eq.${roomId}`,
    }, () => dbGetStocks(roomId).then(callback))
    .subscribe();
}


// ================================================================
// 👤 stock_players
// ================================================================

async function dbJoinPlayer(roomId, name, initialCash, isHost = false) {
  // 중복 이름 체크
  const { data: existing } = await _sb
    .from('stock_players')
    .select('id, is_active')
    .eq('room_id', roomId)
    .eq('name', name)
    .single();

  if (existing) {
    if (existing.is_active) {
      // 이미 활성 세션 존재 → 차단
      throw new Error('DUPLICATE_NAME');
    } else {
      // 나갔다가 재접속 → 재활성화
      const { error } = await _sb
        .from('stock_players')
        .update({ is_active: true })
        .eq('room_id', roomId)
        .eq('name', name);
      if (error) throw error;
      return;
    }
  }

  const { error } = await _sb.from('stock_players').insert({
    room_id:  roomId,
    name:     name,
    cash:     initialCash,
    is_host:  isHost,
    is_active: true,
  });
  if (error) throw error;
}

async function dbLeavePlayer(roomId, name) {
  const { error } = await _sb
    .from('stock_players')
    .update({ is_active: false })
    .eq('room_id', roomId)
    .eq('name', name);
  if (error) throw error;
}

async function dbGetPlayers(roomId) {
  const { data, error } = await _sb
    .from('stock_players')
    .select('*')
    .eq('room_id', roomId)
    .eq('is_active', true)
    .order('joined_at');
  if (error) throw error;
  return data;
}

async function dbGetPlayer(roomId, name) {
  const { data, error } = await _sb
    .from('stock_players')
    .select('*')
    .eq('room_id', roomId)
    .eq('name', name)
    .single();
  if (error) throw error;
  return data;
}

async function dbUpdatePlayerCash(roomId, name, newCash) {
  const { error } = await _sb
    .from('stock_players')
    .update({ cash: newCash })
    .eq('room_id', roomId)
    .eq('name', name);
  if (error) throw error;
}

// 현금을 덮어쓰지 않고 DB에서 직접 delta 만큼 증감
// 동시 요청(빠른 연속 거래)으로 인한 이중차감/이중지급 방지
async function dbIncrementPlayerCash(roomId, name, delta) {
  // Supabase RPC로 atomic 증감
  const { error } = await _sb.rpc('increment_player_cash', {
    p_room_id: roomId,
    p_name:    name,
    p_delta:   delta,
  });
  if (error) {
    // RPC 미설정 환경 fallback: DB 최신값 읽어서 update (단일 사용자 환경에서는 안전)
    const player = await dbGetPlayer(roomId, name);
    const safeCash = (player?.cash ?? 0) + delta;
    if (safeCash < 0) throw new Error('잔액이 부족합니다.');
    await dbUpdatePlayerCash(roomId, name, safeCash);
  }
}

function dbWatchPlayers(roomId, callback) {
  return _sb
    .channel('players-' + roomId)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'stock_players',
      filter: `room_id=eq.${roomId}`,
    }, () => dbGetPlayers(roomId).then(callback))
    .subscribe();
}


// ================================================================
// 💼 stock_holdings
// ================================================================

async function dbGetHoldings(roomId, playerName) {
  const { data, error } = await _sb
    .from('stock_holdings')
    .select('*')
    .eq('room_id', roomId)
    .eq('player_name', playerName);
  if (error) throw error;
  return data || [];
}

async function dbGetAllHoldings(roomId) {
  const { data, error } = await _sb
    .from('stock_holdings')
    .select('*')
    .eq('room_id', roomId);
  if (error) throw error;
  return data || [];
}

// 매수: 보유 없으면 insert, 있으면 평단가 재계산 후 update
async function dbBuyStock(roomId, playerName, ticker, quantity, price) {
  const { data: existing } = await _sb
    .from('stock_holdings')
    .select('*')
    .eq('room_id', roomId)
    .eq('player_name', playerName)
    .eq('ticker', ticker)
    .single();

  if (existing) {
    const newQty      = existing.quantity + quantity;
    const newAvgPrice = Math.round(
      (existing.avg_price * existing.quantity + price * quantity) / newQty
    );
    const { error } = await _sb
      .from('stock_holdings')
      .update({ quantity: newQty, avg_price: newAvgPrice })
      .eq('room_id', roomId)
      .eq('player_name', playerName)
      .eq('ticker', ticker);
    if (error) throw error;
  } else {
    const { error } = await _sb
      .from('stock_holdings')
      .insert({
        room_id:     roomId,
        player_name: playerName,
        ticker:      ticker,
        quantity:    quantity,
        avg_price:   price,
      });
    if (error) throw error;
  }
}

// 매도: 수량 차감 (0이 되면 삭제하지 않고 0으로 유지 — 상장폐지 표시 대응)
async function dbSellStock(roomId, playerName, ticker, quantity) {
  const { data: existing, error: fetchErr } = await _sb
    .from('stock_holdings')
    .select('*')
    .eq('room_id', roomId)
    .eq('player_name', playerName)
    .eq('ticker', ticker)
    .single();
  if (fetchErr) throw fetchErr;
  if (!existing || existing.quantity < quantity) throw new Error('INSUFFICIENT_HOLDINGS');

  const newQty = existing.quantity - quantity;
  const { error } = await _sb
    .from('stock_holdings')
    .update({ quantity: newQty })
    .eq('room_id', roomId)
    .eq('player_name', playerName)
    .eq('ticker', ticker);
  if (error) throw error;
}

function dbWatchHoldings(roomId, playerName, callback) {
  return _sb
    .channel('holdings-' + roomId + '-' + playerName)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'stock_holdings',
      filter: `room_id=eq.${roomId}`,
    }, () => dbGetHoldings(roomId, playerName).then(callback))
    .subscribe();
}


// ================================================================
// 📰 stock_news
// ================================================================

async function dbInsertNews(roomId, round, phase, items) {
  const rows = items.map(content => ({
    room_id: roomId,
    round:   round,
    phase:   phase,
    content: content,
  }));
  const { error } = await _sb.from('stock_news').insert(rows);
  if (error) throw error;
}

async function dbGetNews(roomId, round) {
  const { data, error } = await _sb
    .from('stock_news')
    .select('*')
    .eq('room_id', roomId)
    .eq('round', round)
    .order('id');
  if (error) throw error;
  return data || [];
}

function dbWatchNews(roomId, callback) {
  // callback 은 round 를 직접 지정해 재조회하는 신호 전용
  // dbGetNews(roomId, null) 은 .eq('round', null) 이 되어 항상 빈 배열 반환하는 버그 수정
  return _sb
    .channel('news-' + roomId)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'stock_news',
      filter: `room_id=eq.${roomId}`,
    }, () => callback())
    .subscribe();
}


// ================================================================
// 📊 stock_round_results
// ================================================================

async function dbInsertRoundResults(roomId, round, results) {
  const rows = results.map(r => ({
    room_id:     roomId,
    round:       round,
    ticker:      r.ticker,
    old_price:   r.oldPrice,
    new_price:   r.newPrice,
    change_rate: r.changeRate,
    tier:        r.tier,
  }));
  const { error } = await _sb.from('stock_round_results').insert(rows);
  if (error) throw error;
}

async function dbGetRoundResults(roomId, round) {
  const { data, error } = await _sb
    .from('stock_round_results')
    .select('*')
    .eq('room_id', roomId)
    .eq('round', round)
    .order('id');
  if (error) throw error;
  return data || [];
}

function dbWatchRoundResults(roomId, callback) {
  return _sb
    .channel('results-' + roomId)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'stock_round_results',
      filter: `room_id=eq.${roomId}`,
    }, () => callback())
    .subscribe();
}


// ================================================================
// 🧹 세션 스토리지 헬퍼 (새로고침 시 복원용)
// ================================================================

function sessionSave(key, value) {
  sessionStorage.setItem('stockgame_' + key, JSON.stringify(value));
}

function sessionLoad(key) {
  const v = sessionStorage.getItem('stockgame_' + key);
  return v ? JSON.parse(v) : null;
}

function sessionClear() {
  Object.keys(sessionStorage)
    .filter(k => k.startsWith('stockgame_'))
    .forEach(k => sessionStorage.removeItem(k));
}
