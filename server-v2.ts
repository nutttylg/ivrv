/**
 * Implied vs Realized Volatility Tracker V2
 *
 * Proper implementation with:
 * - Weekly ATM options
 * - Monthly ATM options
 * - Specific strikes and expiries
 * - If weekly = monthly expiry, show next monthly
 */

interface OptionData {
  instrumentName: string;
  expiry: string;
  expiryTimestamp: number;
  strike: number;
  markIV: number;
  bidIV: number;
  askIV: number;
  atmIV: number; // Average of bid/ask
  underlyingPrice: number;
  daysToExpiry: number;
  impliedMove: number; // $ move
  impliedMovePercent: number; // % move
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

  // Weekly comparison
  weeklySurpriseRatio: number;
  weeklyStatus: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  weeklySignal: string;

  // Monthly comparison
  monthlySurpriseRatio: number;
  monthlyStatus: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  monthlySignal: string;

  timeElapsed: number;
}

const dailySnapshots = new Map<string, DailySnapshot>();
let currentSnapshot: DailySnapshot | null = null;

/**
 * Get BTC index price from Deribit
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
 * Get option ticker data (for IV)
 */
async function getOptionTicker(instrumentName: string): Promise<any> {
  const response = await fetch(`https://www.deribit.com/api/v2/public/ticker?instrument_name=${instrumentName}`);
  const data = await response.json();
  return data.result;
}

/**
 * Find ATM strike for a given expiry
 */
function findATMStrike(options: any[], expiry: number, spotPrice: number): any | null {
  const expiryOptions = options.filter(opt => opt.expiration_timestamp === expiry);

  if (expiryOptions.length === 0) return null;

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
 * Get weekly and monthly expiries
 */
function getWeeklyAndMonthlyExpiries(options: any[]): { weekly: number; monthly: number } {
  const now = Date.now();
  const expiries = [...new Set(options.map(o => o.expiration_timestamp))].sort();

  // Find nearest weekly (closest Friday)
  let weekly = expiries.find(exp => {
    const daysAway = (exp - now) / (1000 * 60 * 60 * 24);
    return daysAway >= 1 && daysAway <= 8; // Next 1-8 days
  }) || expiries[0];

  // Find nearest monthly (last Friday of month)
  let monthly = expiries.find(exp => {
    const daysAway = (exp - now) / (1000 * 60 * 60 * 24);
    const expDate = new Date(exp);
    const isLastFriday = expDate.getDay() === 5; // Friday
    return daysAway >= 14 && daysAway <= 45 && isLastFriday; // 2-6 weeks out
  });

  // If weekly and monthly are same, find next monthly
  if (monthly === weekly) {
    monthly = expiries.find(exp => {
      const daysAway = (exp - now) / (1000 * 60 * 60 * 24);
      return exp > weekly && daysAway >= 21 && daysAway <= 60;
    });
  }

  return {
    weekly: weekly || expiries[0],
    monthly: monthly || expiries[1] || expiries[0],
  };
}

/**
 * Create option data object
 */
async function getOptionData(instrumentName: string, strike: number, expiry: number, spotPrice: number): Promise<OptionData> {
  const ticker = await getOptionTicker(instrumentName);

  const bidIV = ticker.bid_iv || 0;
  const askIV = ticker.ask_iv || 0;
  const markIV = ticker.mark_iv || (bidIV + askIV) / 2;
  const atmIV = (bidIV + askIV) / 2;

  const now = Date.now();
  const daysToExpiry = (expiry - now) / (1000 * 60 * 60 * 24);
  const yearsToExpiry = daysToExpiry / 365;

  // Calculate implied move: Price * (IV / 100) * sqrt(timeToExpiry)
  const impliedMove = spotPrice * (atmIV / 100) * Math.sqrt(yearsToExpiry);
  const impliedMovePercent = (impliedMove / spotPrice) * 100;

  return {
    instrumentName,
    expiry: new Date(expiry).toISOString().split('T')[0],
    expiryTimestamp: expiry,
    strike,
    markIV,
    bidIV,
    askIV,
    atmIV,
    underlyingPrice: spotPrice,
    daysToExpiry,
    impliedMove,
    impliedMovePercent,
  };
}

/**
 * Create daily snapshot
 */
async function createDailySnapshot(): Promise<DailySnapshot> {
  console.log('📸 Creating snapshot...');

  const spotPrice = await getBTCIndexPrice();
  console.log(`   Spot: $${spotPrice.toFixed(2)}`);

  const options = await getBTCOptions();
  console.log(`   Loaded ${options.length} options`);

  const { weekly, monthly } = getWeeklyAndMonthlyExpiries(options);
  console.log(`   Weekly expiry: ${new Date(weekly).toISOString()}`);
  console.log(`   Monthly expiry: ${new Date(monthly).toISOString()}`);

  // Find ATM strikes
  const weeklyATM = findATMStrike(options, weekly, spotPrice);
  const monthlyATM = findATMStrike(options, monthly, spotPrice);

  if (!weeklyATM || !monthlyATM) {
    throw new Error('Could not find ATM options');
  }

  console.log(`   Weekly ATM: ${weeklyATM.strike} strike`);
  console.log(`   Monthly ATM: ${monthlyATM.strike} strike`);

  // Get option data with IV
  const weeklyOption = await getOptionData(
    weeklyATM.instrument_name,
    weeklyATM.strike,
    weekly,
    spotPrice
  );

  await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit

  const monthlyOption = await getOptionData(
    monthlyATM.instrument_name,
    monthlyATM.strike,
    monthly,
    spotPrice
  );

  console.log(`   Weekly IV: ${weeklyOption.atmIV.toFixed(2)}% | Implied: $${weeklyOption.impliedMove.toFixed(2)}`);
  console.log(`   Monthly IV: ${monthlyOption.atmIV.toFixed(2)}% | Implied: $${monthlyOption.impliedMove.toFixed(2)}`);

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  return {
    date: dateStr,
    timestamp: Date.now(),
    weeklyOption,
    monthlyOption,
    spotPrice,
  };
}

/**
 * Get today's high/low from Binance
 */
async function getTodayHighLow(): Promise<{ high: number; low: number }> {
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
 * Calculate realtime comparison
 */
async function calculateRealtime(snapshot: DailySnapshot): Promise<RealtimeComparison> {
  const currentPrice = await getBTCIndexPrice();
  const { high, low } = await getTodayHighLow();

  const actualRange = high - low;
  const actualRangePercent = (actualRange / snapshot.spotPrice) * 100;

  const now = Date.now();
  const timeElapsed = (now - snapshot.timestamp) / (1000 * 60 * 60);

  // Calculate implied DAILY move from weekly/monthly
  // We need to normalize to 1-day: impliedMove * sqrt(1/daysToExpiry)
  const weeklyDailyMove = snapshot.weeklyOption.impliedMove * Math.sqrt(1 / snapshot.weeklyOption.daysToExpiry);
  const monthlyDailyMove = snapshot.monthlyOption.impliedMove * Math.sqrt(1 / snapshot.monthlyOption.daysToExpiry);

  // Weekly comparison
  const weeklySurpriseRatio = actualRange / weeklyDailyMove;
  let weeklyStatus: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  let weeklySignal: string;

  if (weeklySurpriseRatio > 1.3) {
    weeklyStatus = 'HIGH_VOL';
    weeklySignal = 'Actual >> Weekly Implied | Vol underpriced';
  } else if (weeklySurpriseRatio < 0.7) {
    weeklyStatus = 'LOW_VOL';
    weeklySignal = 'Actual << Weekly Implied | Vol overpriced';
  } else {
    weeklyStatus = 'NORMAL';
    weeklySignal = 'Actual ≈ Weekly Implied | Vol fairly priced';
  }

  // Monthly comparison
  const monthlySurpriseRatio = actualRange / monthlyDailyMove;
  let monthlyStatus: 'HIGH_VOL' | 'NORMAL' | 'LOW_VOL';
  let monthlySignal: string;

  if (monthlySurpriseRatio > 1.3) {
    monthlyStatus = 'HIGH_VOL';
    monthlySignal = 'Actual >> Monthly Implied | Vol underpriced';
  } else if (monthlySurpriseRatio < 0.7) {
    monthlyStatus = 'LOW_VOL';
    monthlySignal = 'Actual << Monthly Implied | Vol overpriced';
  } else {
    monthlyStatus = 'NORMAL';
    monthlySignal = 'Actual ≈ Monthly Implied | Vol fairly priced';
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
 * Initialize
 */
async function initialize() {
  console.log('⏳ Initializing...\n');
  currentSnapshot = await createDailySnapshot();
  console.log('\n✅ Snapshot complete!');
}

// CORS headers
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
        return new Response(JSON.stringify({
          error: 'Not ready',
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

console.log('📊 Implied vs Realized V2 - Options Edition');
console.log(`🌐 Server: http://localhost:${server.port}\n`);

initialize().catch(console.error);
