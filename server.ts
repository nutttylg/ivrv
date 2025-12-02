/**
 * Implied vs Realized Volatility Tracker
 *
 * Tracks daily implied movement (from ATM IV at 00:00 UTC)
 * vs actual realized movement throughout the day
 *
 * Features:
 * - Historical IV snapshots (can backfill even if not running)
 * - Real-time surprise ratio calculation
 * - Regime detection and projections
 * - No need to run 24/7
 */

interface DailySnapshot {
  date: string; // YYYY-MM-DD
  timestamp: number; // 00:00 UTC
  price: number;
  atmIV: number; // Historical IV from Deribit
  impliedDailyMove: number; // Absolute $
  impliedDailyMovePercent: number; // %
}

interface RealtimeData {
  timestamp: number;
  currentPrice: number;
  dayHigh: number;
  dayLow: number;
  actualRange: number;
  actualRangePercent: number;
  surpriseRatio: number;
  timeElapsed: number; // hours since 00:00 UTC
  projectedEODRange: number;
  status: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  signal: string;
}

// In-memory storage
const dailySnapshots = new Map<string, DailySnapshot>();
let currentSnapshot: DailySnapshot | null = null;

/**
 * Fetch historical IV from Deribit
 * This allows us to get IV even for past dates!
 */
async function getHistoricalIV(timestampMs: number): Promise<number | null> {
  try {
    const url = `https://www.deribit.com/api/v2/public/get_historical_volatility?currency=BTC`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.result || data.result.length === 0) return null;

    // Find closest timestamp
    let closest = data.result[0];
    let minDiff = Math.abs(data.result[0][0] - timestampMs);

    for (const [ts, iv] of data.result) {
      const diff = Math.abs(ts - timestampMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = [ts, iv];
      }
    }

    return closest[1]; // IV value
  } catch (error) {
    console.error('Error fetching historical IV:', error);
    return null;
  }
}

/**
 * Get current BTC price from Binance
 */
async function getCurrentPrice(): Promise<number> {
  const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await response.json();
  return parseFloat(data.price);
}

/**
 * Get today's high and low from Binance
 */
async function getTodayHighLow(): Promise<{ high: number; low: number }> {
  // Get today's kline (1d)
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${todayStart.getTime()}&limit=1`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.length === 0) {
    throw new Error('No kline data');
  }

  return {
    high: parseFloat(data[0][2]),
    low: parseFloat(data[0][3]),
  };
}

/**
 * Create or fetch daily snapshot
 */
async function getDailySnapshot(date: string): Promise<DailySnapshot> {
  // Check cache
  if (dailySnapshots.has(date)) {
    return dailySnapshots.get(date)!;
  }

  // Create snapshot for this date
  const dateParts = date.split('-');
  const snapshotTime = new Date(Date.UTC(
    parseInt(dateParts[0]),
    parseInt(dateParts[1]) - 1,
    parseInt(dateParts[2]),
    0, 0, 0
  ));

  const timestampMs = snapshotTime.getTime();

  console.log(`📸 Creating snapshot for ${date} (${new Date(timestampMs).toISOString()})...`);

  // Get historical IV at 00:00 UTC
  const atmIV = await getHistoricalIV(timestampMs);

  if (!atmIV) {
    throw new Error(`Could not fetch IV for ${date}`);
  }

  // Get price at that time (use kline open)
  const klineUrl = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${timestampMs}&limit=1`;
  const klineResponse = await fetch(klineUrl);
  const klineData = await klineResponse.json();

  if (klineData.length === 0) {
    throw new Error(`No price data for ${date}`);
  }

  const price = parseFloat(klineData[0][1]); // Open price

  // Calculate implied daily move
  const impliedDailyMove = price * (atmIV / 100) / Math.sqrt(365);
  const impliedDailyMovePercent = (impliedDailyMove / price) * 100;

  const snapshot: DailySnapshot = {
    date,
    timestamp: timestampMs,
    price,
    atmIV,
    impliedDailyMove,
    impliedDailyMovePercent,
  };

  dailySnapshots.set(date, snapshot);
  console.log(`✅ Snapshot created: ${date} | Price: $${price.toFixed(2)} | IV: ${atmIV.toFixed(2)}% | Implied: $${impliedDailyMove.toFixed(2)} (${impliedDailyMovePercent.toFixed(2)}%)`);

  return snapshot;
}

/**
 * Calculate real-time comparison
 */
async function calculateRealtime(snapshot: DailySnapshot): Promise<RealtimeData> {
  const currentPrice = await getCurrentPrice();
  const { high, low } = await getTodayHighLow();

  const actualRange = high - low;
  const actualRangePercent = (actualRange / snapshot.price) * 100;
  const surpriseRatio = actualRange / snapshot.impliedDailyMove;

  const now = Date.now();
  const timeElapsed = (now - snapshot.timestamp) / (1000 * 60 * 60); // hours

  // Project end-of-day range based on time elapsed
  const hoursInDay = 24;
  const projectedEODRange = actualRange * (hoursInDay / timeElapsed);

  let status: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  let signal: string;

  if (surpriseRatio > 1.3) {
    status = 'HIGH_VOL';
    signal = 'Actual >> Implied | Vol underpriced | Trend day likely';
  } else if (surpriseRatio < 0.7) {
    status = 'LOW_VOL';
    signal = 'Actual << Implied | Vol overpriced | Range-bound day';
  } else {
    status = 'NORMAL';
    signal = 'Actual ≈ Implied | Vol fairly priced | Normal day';
  }

  return {
    timestamp: now,
    currentPrice,
    dayHigh: high,
    dayLow: low,
    actualRange,
    actualRangePercent,
    surpriseRatio,
    timeElapsed,
    projectedEODRange,
    status,
    signal,
  };
}

/**
 * Initialize current snapshot
 */
async function initializeCurrentSnapshot() {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  try {
    currentSnapshot = await getDailySnapshot(todayStr);
    console.log(`\n✅ Today's snapshot loaded: ${todayStr}`);
  } catch (error) {
    console.error('Error loading today\'s snapshot:', error);
  }
}

/**
 * Backfill historical snapshots
 */
async function backfillSnapshots(days: number = 30) {
  console.log(`\n📚 Backfilling last ${days} days...`);

  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    try {
      await getDailySnapshot(dateStr);
      await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit
    } catch (error) {
      console.log(`⚠️  Skipped ${dateStr}: ${error}`);
    }
  }

  console.log(`✅ Backfill complete! ${dailySnapshots.size} snapshots loaded.`);
}

// CORS headers
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = Bun.serve({
  port: 3200,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // Serve HTML
    if (url.pathname === '/') {
      return new Response(Bun.file('index.html'), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Get current snapshot and realtime data
    if (url.pathname === '/api/current') {
      if (!currentSnapshot) {
        return new Response(JSON.stringify({
          error: 'Snapshot not ready',
          message: 'Please wait for initialization...',
        }), {
          status: 503,
          headers,
        });
      }

      const realtime = await calculateRealtime(currentSnapshot);

      return new Response(JSON.stringify({
        snapshot: currentSnapshot,
        realtime,
      }), { headers });
    }

    // Get historical snapshots
    if (url.pathname === '/api/history') {
      const days = parseInt(url.searchParams.get('days') || '30');
      const history = Array.from(dailySnapshots.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, days);

      return new Response(JSON.stringify(history), { headers });
    }

    // Get statistics
    if (url.pathname === '/api/stats') {
      const snapshots = Array.from(dailySnapshots.values());

      if (snapshots.length === 0) {
        return new Response(JSON.stringify({
          totalDays: 0,
          avgIV: 0,
          avgImpliedMove: 0,
        }), { headers });
      }

      const avgIV = snapshots.reduce((sum, s) => sum + s.atmIV, 0) / snapshots.length;
      const avgImpliedMove = snapshots.reduce((sum, s) => sum + s.impliedDailyMovePercent, 0) / snapshots.length;

      return new Response(JSON.stringify({
        totalDays: snapshots.length,
        avgIV,
        avgImpliedMove,
        oldestDate: snapshots[snapshots.length - 1]?.date,
        newestDate: snapshots[0]?.date,
      }), { headers });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log('📊 Implied vs Realized Volatility Tracker');
console.log(`🌐 Server running at http://localhost:${server.port}`);
console.log('\n⏳ Initializing...\n');

// Initialize
(async () => {
  await initializeCurrentSnapshot();
  await backfillSnapshots(30);
  console.log('\n✅ Ready to track volatility!');
})();
