/**
 * Implied vs Realized V3
 * PROPER expiry logic:
 * - Weekly: Next Friday 08:00 UTC
 * - Monthly: Last Friday of month 08:00 UTC
 * - Expiry time: 08:00 UTC (not midnight)
 */

interface OptionData {
  instrumentName: string;
  expiry: string;
  expiryTimestamp: number;
  strike: number;
  markIV: number;
  bidIV: number;
  askIV: number;
  atmIV: number;
  underlyingPrice: number;
  hoursToExpiry: number;
  daysToExpiry: number;
  impliedMove: number;
  impliedMovePercent: number;
  impliedDailyMove: number;
  impliedDailyMovePercent: number;
}

interface DailySnapshot {
  date: string;
  timestamp: number;
  weeklyOption: OptionData;
  monthlyOption: OptionData;
  spotPrice: number;
}

interface RealtimeComparison {
  timestamp: number;
  currentPrice: number;
  dayHigh: number;
  dayLow: number;
  actualRange: number;
  actualRangePercent: number;
  weeklySurpriseRatio: number;
  weeklyStatus: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  weeklySignal: string;
  monthlySurpriseRatio: number;
  monthlyStatus: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  monthlySignal: string;
  timeElapsed: number;
}

interface HistoricalStats {
  weeklyAvgSurprise: number;
  weeklyTrend: 'UP' | 'DOWN' | 'FLAT';
  monthlyAvgSurprise: number;
  monthlyTrend: 'UP' | 'DOWN' | 'FLAT';
  daysTracked: number;
}

interface DailyRecord {
  date: string;
  weeklySurprise: number;
  monthlySurprise: number;
  btcPrice: number;
}

interface ReferenceSnapshot {
  date: string;
  weeklyImpliedDaily: number;
  monthlyImpliedDaily: number;
  btcPrice: number;
}

let currentSnapshot: DailySnapshot | null = null;
const historicalRecords: DailyRecord[] = [];
let weeklyReferenceSnapshot: ReferenceSnapshot | null = null;  // Last Friday's snapshot
let monthlyReferenceSnapshot: ReferenceSnapshot | null = null; // Month start snapshot

/**
 * Get next Friday 08:00 UTC
 */
function getNextFriday(): Date {
  const now = new Date();
  const friday = new Date(now);

  // Get days until Friday (5 = Friday)
  const daysUntilFriday = (5 - now.getUTCDay() + 7) % 7;

  if (daysUntilFriday === 0) {
    // Today is Friday - check if 08:00 UTC has passed
    const todayEightAM = new Date(now);
    todayEightAM.setUTCHours(8, 0, 0, 0);

    if (now.getTime() >= todayEightAM.getTime()) {
      // Already past 08:00 UTC today, use next Friday
      friday.setUTCDate(friday.getUTCDate() + 7);
    }
  } else {
    friday.setUTCDate(friday.getUTCDate() + daysUntilFriday);
  }

  friday.setUTCHours(8, 0, 0, 0);
  return friday;
}

/**
 * Get last Friday of the month at 08:00 UTC
 */
function getLastFridayOfMonth(year: number, month: number): Date {
  // Start with last day of month
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 8, 0, 0, 0));

  // Go backwards to find last Friday
  const dayOfWeek = lastDay.getUTCDay();
  const daysToSubtract = (dayOfWeek + 2) % 7; // Days from Friday

  lastDay.setUTCDate(lastDay.getUTCDate() - daysToSubtract);
  lastDay.setUTCHours(8, 0, 0, 0);

  return lastDay;
}

/**
 * Get monthly expiry (last Friday of month)
 */
function getMonthlyExpiry(): Date {
  const now = new Date();
  const thisMonthExpiry = getLastFridayOfMonth(now.getUTCFullYear(), now.getUTCMonth());

  // If this month's expiry has passed, use next month
  if (now.getTime() >= thisMonthExpiry.getTime()) {
    return getLastFridayOfMonth(now.getUTCFullYear(), now.getUTCMonth() + 1);
  }

  return thisMonthExpiry;
}

/**
 * Get BTC index price
 */
async function getBTCIndexPrice(): Promise<number> {
  const response = await fetch('https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd');
  const data = await response.json();
  return data.result.index_price;
}

/**
 * Get all BTC options
 */
async function getBTCOptions(): Promise<any[]> {
  const response = await fetch('https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false');
  const data = await response.json();
  return data.result;
}

/**
 * Get option ticker
 */
async function getOptionTicker(instrumentName: string): Promise<any> {
  const response = await fetch(`https://www.deribit.com/api/v2/public/ticker?instrument_name=${instrumentName}`);
  const data = await response.json();
  return data.result;
}

/**
 * Find ATM strike for specific expiry
 */
function findATMStrike(options: any[], expiryTime: number, spotPrice: number): any | null {
  // Filter to exact expiry time (allow 1 hour tolerance)
  const expiryOptions = options.filter(opt => {
    const diff = Math.abs(opt.expiration_timestamp - expiryTime);
    return diff < 3600000; // 1 hour tolerance
  });

  if (expiryOptions.length === 0) {
    console.log(`   ⚠️  No options found for expiry ${new Date(expiryTime).toISOString()}`);
    return null;
  }

  // Find strike closest to spot
  let closest = expiryOptions[0];
  let minDiff = Math.abs(expiryOptions[0].strike - spotPrice);

  for (const opt of expiryOptions) {
    const diff = Math.abs(opt.strike - spotPrice);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  }

  return closest;
}

/**
 * Create option data
 */
async function getOptionData(instrumentName: string, strike: number, expiry: number, spotPrice: number): Promise<OptionData> {
  const ticker = await getOptionTicker(instrumentName);

  const bidIV = ticker.bid_iv || 0;
  const askIV = ticker.ask_iv || 0;
  const markIV = ticker.mark_iv || (bidIV + askIV) / 2;
  const atmIV = (bidIV + askIV) / 2;

  const now = Date.now();
  const hoursToExpiry = (expiry - now) / (1000 * 60 * 60);
  const daysToExpiry = hoursToExpiry / 24;
  const yearsToExpiry = daysToExpiry / 365;

  // Implied move to expiry
  const impliedMove = spotPrice * (atmIV / 100) * Math.sqrt(yearsToExpiry);
  const impliedMovePercent = (impliedMove / spotPrice) * 100;

  // Implied DAILY move (normalized from term structure)
  const impliedDailyMove = spotPrice * (atmIV / 100) / Math.sqrt(365);
  const impliedDailyMovePercent = (impliedDailyMove / spotPrice) * 100;

  return {
    instrumentName,
    expiry: new Date(expiry).toISOString().replace('T', ' ').substring(0, 16),
    expiryTimestamp: expiry,
    strike,
    markIV,
    bidIV,
    askIV,
    atmIV,
    underlyingPrice: spotPrice,
    hoursToExpiry,
    daysToExpiry,
    impliedMove,
    impliedMovePercent,
    impliedDailyMove,
    impliedDailyMovePercent,
  };
}

/**
 * Create snapshot
 */
async function createDailySnapshot(): Promise<DailySnapshot> {
  console.log('📸 Creating snapshot...');

  const spotPrice = await getBTCIndexPrice();
  console.log(`   Spot: $${spotPrice.toFixed(2)}`);

  const options = await getBTCOptions();
  console.log(`   Loaded ${options.length} options`);

  // Calculate correct expiries
  const nextFriday = getNextFriday();
  const monthlyExpiry = getMonthlyExpiry();

  console.log(`   Next Friday: ${nextFriday.toISOString()}`);
  console.log(`   Monthly (last Fri of month): ${monthlyExpiry.toISOString()}`);

  // If weekly and monthly are same, use next month for monthly
  let finalMonthlyExpiry = monthlyExpiry;
  if (nextFriday.getTime() === monthlyExpiry.getTime()) {
    const nextMonth = new Date(monthlyExpiry);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    finalMonthlyExpiry = getLastFridayOfMonth(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth());
    console.log(`   ⚠️  Weekly = Monthly, using next month: ${finalMonthlyExpiry.toISOString()}`);
  }

  // Find ATM strikes
  const weeklyATM = findATMStrike(options, nextFriday.getTime(), spotPrice);
  const monthlyATM = findATMStrike(options, finalMonthlyExpiry.getTime(), spotPrice);

  if (!weeklyATM || !monthlyATM) {
    throw new Error('Could not find ATM options');
  }

  console.log(`   Weekly ATM: ${weeklyATM.strike} (${weeklyATM.instrument_name})`);
  console.log(`   Monthly ATM: ${monthlyATM.strike} (${monthlyATM.instrument_name})`);

  // Get option data
  const weeklyOption = await getOptionData(
    weeklyATM.instrument_name,
    weeklyATM.strike,
    nextFriday.getTime(),
    spotPrice
  );

  await new Promise(resolve => setTimeout(resolve, 100));

  const monthlyOption = await getOptionData(
    monthlyATM.instrument_name,
    monthlyATM.strike,
    finalMonthlyExpiry.getTime(),
    spotPrice
  );

  console.log(`   Weekly: IV ${weeklyOption.atmIV.toFixed(2)}% | ${weeklyOption.hoursToExpiry.toFixed(1)}h | Daily: $${weeklyOption.impliedDailyMove.toFixed(2)}`);
  console.log(`   Monthly: IV ${monthlyOption.atmIV.toFixed(2)}% | ${monthlyOption.hoursToExpiry.toFixed(1)}h | Daily: $${monthlyOption.impliedDailyMove.toFixed(2)}`);

  // Set timestamp to today's 00:00 UTC for accurate time elapsed calculation
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return {
    date: new Date().toISOString().split('T')[0],
    timestamp: today.getTime(),
    weeklyOption,
    monthlyOption,
    spotPrice,
  };
}

/**
 * Get today's high/low
 */
async function getTodayHighLow(): Promise<{ high: number; low: number }> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${todayStart.getTime()}&limit=1`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.length === 0) throw new Error('No kline data');

  return {
    high: parseFloat(data[0][2]),
    low: parseFloat(data[0][3]),
  };
}

/**
 * Calculate realtime
 */
async function calculateRealtime(snapshot: DailySnapshot): Promise<RealtimeComparison> {
  const currentPrice = await getBTCIndexPrice();
  const { high, low } = await getTodayHighLow();

  const actualRange = high - low;
  const actualRangePercent = (actualRange / snapshot.spotPrice) * 100;

  const now = Date.now();
  const timeElapsed = (now - snapshot.timestamp) / (1000 * 60 * 60);

  // Compare against implied DAILY moves
  const weeklySurpriseRatio = actualRange / snapshot.weeklyOption.impliedDailyMove;
  const monthlySurpriseRatio = actualRange / snapshot.monthlyOption.impliedDailyMove;

  let weeklyStatus: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  let weeklySignal: string;

  if (weeklySurpriseRatio > 1.3) {
    weeklyStatus = 'HIGH_VOL';
    weeklySignal = `Actual ${weeklySurpriseRatio.toFixed(2)}x weekly implied | Vol underpriced`;
  } else if (weeklySurpriseRatio < 0.7) {
    weeklyStatus = 'LOW_VOL';
    weeklySignal = `Actual ${weeklySurpriseRatio.toFixed(2)}x weekly implied | Vol overpriced`;
  } else {
    weeklyStatus = 'NORMAL';
    weeklySignal = `Actual ${weeklySurpriseRatio.toFixed(2)}x weekly implied | Vol fairly priced`;
  }

  let monthlyStatus: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  let monthlySignal: string;

  if (monthlySurpriseRatio > 1.3) {
    monthlyStatus = 'HIGH_VOL';
    monthlySignal = `Actual ${monthlySurpriseRatio.toFixed(2)}x monthly implied | Vol underpriced`;
  } else if (monthlySurpriseRatio < 0.7) {
    monthlyStatus = 'LOW_VOL';
    monthlySignal = `Actual ${monthlySurpriseRatio.toFixed(2)}x monthly implied | Vol overpriced`;
  } else {
    monthlyStatus = 'NORMAL';
    monthlySignal = `Actual ${monthlySurpriseRatio.toFixed(2)}x monthly implied | Vol fairly priced`;
  }

  return {
    timestamp: now,
    currentPrice,
    dayHigh: high,
    dayLow: low,
    actualRange,
    actualRangePercent,
    weeklySurpriseRatio,
    weeklyStatus,
    weeklySignal,
    monthlySurpriseRatio,
    monthlyStatus,
    monthlySignal,
    timeElapsed,
  };
}

/**
 * Check if we need to set new reference snapshots
 */
function updateReferenceSnapshots(snapshot: DailySnapshot) {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const dayOfMonth = now.getUTCDate();

  // Set weekly reference on Friday (day 5) if we don't have one or it's a new week
  if (dayOfWeek === 5) {
    const dateStr = snapshot.date;
    if (!weeklyReferenceSnapshot || weeklyReferenceSnapshot.date !== dateStr) {
      weeklyReferenceSnapshot = {
        date: dateStr,
        weeklyImpliedDaily: snapshot.weeklyOption.impliedDailyMove,
        monthlyImpliedDaily: snapshot.monthlyOption.impliedDailyMove,
        btcPrice: snapshot.spotPrice,
      };
      console.log(`   📌 Set weekly reference snapshot: ${dateStr} @ $${snapshot.spotPrice.toFixed(2)}`);
    }
  }

  // Set monthly reference on 1st of month if we don't have one or it's a new month
  if (dayOfMonth === 1) {
    const dateStr = snapshot.date;
    if (!monthlyReferenceSnapshot || monthlyReferenceSnapshot.date !== dateStr) {
      monthlyReferenceSnapshot = {
        date: dateStr,
        weeklyImpliedDaily: snapshot.weeklyOption.impliedDailyMove,
        monthlyImpliedDaily: snapshot.monthlyOption.impliedDailyMove,
        btcPrice: snapshot.spotPrice,
      };
      console.log(`   📌 Set monthly reference snapshot: ${dateStr} @ $${snapshot.spotPrice.toFixed(2)}`);
    }
  }
}

/**
 * Save end-of-day surprise ratios for historical tracking
 */
function saveDailyRecord(date: string, weeklySurprise: number, monthlySurprise: number, btcPrice: number) {
  // Remove old record for same date if exists
  const existingIndex = historicalRecords.findIndex(r => r.date === date);
  if (existingIndex >= 0) {
    historicalRecords.splice(existingIndex, 1);
  }

  historicalRecords.push({ date, weeklySurprise, monthlySurprise, btcPrice });

  // Keep only last 30 days
  if (historicalRecords.length > 30) {
    historicalRecords.shift();
  }
}

/**
 * Calculate historical statistics
 */
function calculateHistoricalStats(): HistoricalStats {
  // Need at least 3 days of data for meaningful stats
  if (historicalRecords.length < 3) {
    return {
      weeklyAvgSurprise: 0,
      weeklyTrend: 'FLAT',
      monthlyAvgSurprise: 0,
      monthlyTrend: 'FLAT',
      daysTracked: 0,  // Return 0 to hide the card
    };
  }

  // Calculate averages
  const weeklySum = historicalRecords.reduce((sum, r) => sum + r.weeklySurprise, 0);
  const monthlySum = historicalRecords.reduce((sum, r) => sum + r.monthlySurprise, 0);
  const weeklyAvgSurprise = weeklySum / historicalRecords.length;
  const monthlyAvgSurprise = monthlySum / historicalRecords.length;

  // Calculate trends (compare recent 3 days vs older days)
  let weeklyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
  let monthlyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';

  if (historicalRecords.length >= 6) {
    const recent3 = historicalRecords.slice(-3);
    const older3 = historicalRecords.slice(-6, -3);

    const weeklyRecentAvg = recent3.reduce((sum, r) => sum + r.weeklySurprise, 0) / 3;
    const weeklyOlderAvg = older3.reduce((sum, r) => sum + r.weeklySurprise, 0) / 3;
    const weeklyDiff = weeklyRecentAvg - weeklyOlderAvg;

    if (weeklyDiff > 0.15) weeklyTrend = 'UP';
    else if (weeklyDiff < -0.15) weeklyTrend = 'DOWN';

    const monthlyRecentAvg = recent3.reduce((sum, r) => sum + r.monthlySurprise, 0) / 3;
    const monthlyOlderAvg = older3.reduce((sum, r) => sum + r.monthlySurprise, 0) / 3;
    const monthlyDiff = monthlyRecentAvg - monthlyOlderAvg;

    if (monthlyDiff > 0.15) monthlyTrend = 'UP';
    else if (monthlyDiff < -0.15) monthlyTrend = 'DOWN';
  }

  return {
    weeklyAvgSurprise,
    weeklyTrend,
    monthlyAvgSurprise,
    monthlyTrend,
    daysTracked: historicalRecords.length,
  };
}

/**
 * Backfill historical data from past days
 */
async function backfillHistoricalData(days: number = 7) {
  console.log(`📊 Backfilling ${days} days of historical data...`);

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (let i = days; i >= 1; i--) {
    const dateMs = now - (i * oneDayMs);
    const date = new Date(dateMs);
    date.setUTCHours(0, 0, 0, 0);
    const dateStr = date.toISOString().split('T')[0];

    try {
      // Get historical price data from Binance
      const startTime = date.getTime();
      const endTime = date.getTime() + oneDayMs;

      const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${startTime}&limit=1`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.length === 0) continue;

      const high = parseFloat(data[0][2]);
      const low = parseFloat(data[0][3]);
      const open = parseFloat(data[0][1]);
      const actualRange = high - low;

      // Estimate implied daily move (roughly 2% for BTC)
      // This is a rough estimate - actual IV varies, but good enough for historical context
      const estimatedIV = 50; // 50% annualized IV is typical for BTC
      const impliedDailyMove = open * (estimatedIV / 100) / Math.sqrt(365);

      const weeklySurprise = actualRange / impliedDailyMove;
      const monthlySurprise = actualRange / impliedDailyMove;

      saveDailyRecord(dateStr, weeklySurprise, monthlySurprise, open);
      console.log(`   ${dateStr}: Range $${actualRange.toFixed(0)} / Implied $${impliedDailyMove.toFixed(0)} = ${weeklySurprise.toFixed(2)}x`);

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.log(`   ⚠️  Failed to backfill ${dateStr}:`, error);
    }
  }

  console.log(`✅ Backfilled ${historicalRecords.length} days of data\n`);
}

async function initialize() {
  console.log('⏳ Initializing...\n');

  // Backfill historical data first
  await backfillHistoricalData(7);

  // Then create today's snapshot
  currentSnapshot = await createDailySnapshot();
  console.log('\n✅ Ready!');
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = Bun.serve({
  port: 3201,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    if (url.pathname === '/') {
      return new Response(Bun.file('index-v2.html'), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.pathname === '/api/current') {
      if (!currentSnapshot) {
        return new Response(JSON.stringify({ error: 'Not ready' }), {
          status: 503,
          headers,
        });
      }

      // Check if we need to update reference snapshots
      updateReferenceSnapshots(currentSnapshot);

      const realtime = await calculateRealtime(currentSnapshot);
      const stats = calculateHistoricalStats();

      // Auto-save current day's surprise ratio (updates throughout the day)
      saveDailyRecord(
        currentSnapshot.date,
        realtime.weeklySurpriseRatio,
        realtime.monthlySurpriseRatio,
        realtime.currentPrice
      );

      return new Response(JSON.stringify({
        snapshot: currentSnapshot,
        realtime,
        stats,
      }), { headers });
    }

    if (url.pathname === '/api/refresh') {
      try {
        currentSnapshot = await createDailySnapshot();
        return new Response(JSON.stringify({ success: true }), { headers });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }), {
          status: 500,
          headers,
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log('📊 Implied vs Realized V3 - CORRECT Expiries');
console.log(`🌐 Server: http://localhost:${server.port}\n`);

initialize().catch(console.error);
