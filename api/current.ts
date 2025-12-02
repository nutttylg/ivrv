/**
 * Serverless API endpoint for Vercel
 * Optimized for fast execution (< 10s timeout)
 */

export const config = {
  runtime: 'edge',
  maxDuration: 30, // 30 seconds for Pro plan
};

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

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function fetchWithTimeout(url: string, timeout = 5000): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function getBTCIndexPrice(): Promise<number> {
  const data = await fetchWithTimeout('https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd');
  return data.result.index_price;
}

async function getBTCOptions(): Promise<any[]> {
  const data = await fetchWithTimeout('https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false', 8000);
  return data.result;
}

async function getOptionTicker(instrumentName: string): Promise<any> {
  const data = await fetchWithTimeout(`https://www.deribit.com/api/v2/public/ticker?instrument_name=${instrumentName}`);
  return data.result;
}

function getNextFriday(): Date {
  const now = new Date();
  const friday = new Date(now);
  const daysUntilFriday = (5 - now.getUTCDay() + 7) % 7;

  if (daysUntilFriday === 0) {
    const todayEightAM = new Date(now);
    todayEightAM.setUTCHours(8, 0, 0, 0);
    if (now.getTime() >= todayEightAM.getTime()) {
      friday.setUTCDate(friday.getUTCDate() + 7);
    }
  } else {
    friday.setUTCDate(friday.getUTCDate() + daysUntilFriday);
  }

  friday.setUTCHours(8, 0, 0, 0);
  return friday;
}

function getLastFridayOfMonth(): Date {
  const now = new Date();
  let month = now.getUTCMonth();
  let year = now.getUTCFullYear();

  const nextFriday = getNextFriday();
  const daysToNextFriday = Math.ceil((nextFriday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysToNextFriday <= 7) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const lastDayOfWeek = lastDay.getUTCDay();
  const daysToSubtract = lastDayOfWeek === 5 ? 0 : (lastDayOfWeek + 2) % 7;
  const lastFriday = new Date(lastDay);
  lastFriday.setUTCDate(lastDay.getUTCDate() - daysToSubtract);
  lastFriday.setUTCHours(8, 0, 0, 0);

  return lastFriday;
}

function findATMStrike(options: any[], expiry: number, spotPrice: number): any | null {
  const expiryOptions = options.filter(opt => opt.expiration_timestamp === expiry);
  if (expiryOptions.length === 0) return null;

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

  const impliedMove = spotPrice * (atmIV / 100) * Math.sqrt(yearsToExpiry);
  const impliedMovePercent = (impliedMove / spotPrice) * 100;
  const impliedDailyMove = spotPrice * (atmIV / 100) / Math.sqrt(365);
  const impliedDailyMovePercent = (impliedDailyMove / spotPrice) * 100;

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
    hoursToExpiry,
    daysToExpiry,
    impliedMove,
    impliedMovePercent,
    impliedDailyMove,
    impliedDailyMovePercent,
  };
}

async function getTodayHighLow(): Promise<{ high: number; low: number }> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const data = await fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${todayStart.getTime()}&limit=1`);

  if (data.length === 0) {
    throw new Error('No kline data');
  }

  return {
    high: parseFloat(data[0][2]),
    low: parseFloat(data[0][3]),
  };
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    // Fetch spot price and options in parallel
    const [spotPrice, options] = await Promise.all([
      getBTCIndexPrice(),
      getBTCOptions(),
    ]);

    const nextFriday = getNextFriday();
    let lastFridayOfMonth = getLastFridayOfMonth();

    // If weekly and monthly are same, get next month
    if (Math.abs(nextFriday.getTime() - lastFridayOfMonth.getTime()) < 24 * 60 * 60 * 1000) {
      const nextMonth = new Date(lastFridayOfMonth);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      lastFridayOfMonth = getLastFridayOfMonth();
    }

    const weeklyATM = findATMStrike(options, nextFriday.getTime(), spotPrice);
    const monthlyATM = findATMStrike(options, lastFridayOfMonth.getTime(), spotPrice);

    if (!weeklyATM || !monthlyATM) {
      throw new Error('Could not find ATM options');
    }

    // Fetch option data in parallel
    const [weeklyOption, monthlyOption, todayHL, currentPrice] = await Promise.all([
      getOptionData(weeklyATM.instrument_name, weeklyATM.strike, nextFriday.getTime(), spotPrice),
      getOptionData(monthlyATM.instrument_name, monthlyATM.strike, lastFridayOfMonth.getTime(), spotPrice),
      getTodayHighLow(),
      getBTCIndexPrice(), // Get current price again for realtime
    ]);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const snapshot: DailySnapshot = {
      date: new Date().toISOString().split('T')[0],
      timestamp: today.getTime(),
      weeklyOption,
      monthlyOption,
      spotPrice,
    };

    // Calculate realtime comparison
    const actualRange = todayHL.high - todayHL.low;
    const actualRangePercent = (actualRange / spotPrice) * 100;
    const now = Date.now();
    const timeElapsed = (now - snapshot.timestamp) / (1000 * 60 * 60);

    const weeklySurpriseRatio = actualRange / weeklyOption.impliedDailyMove;
    const monthlySurpriseRatio = actualRange / monthlyOption.impliedDailyMove;

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

    const realtime: RealtimeComparison = {
      timestamp: now,
      currentPrice,
      dayHigh: todayHL.high,
      dayLow: todayHL.low,
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

    const stats: HistoricalStats = {
      weeklyAvgSurprise: 0,
      weeklyTrend: 'FLAT',
      monthlyAvgSurprise: 0,
      monthlyTrend: 'FLAT',
      daysTracked: 0,
    };

    return new Response(JSON.stringify({
      snapshot,
      realtime,
      stats,
    }), {
      headers: {
        ...headers,
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      }
    });
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined,
    }), {
      status: 500,
      headers,
    });
  }
}
