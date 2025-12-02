/**
 * Serverless API endpoint for Vercel
 * Returns current snapshot + realtime data
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

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getBTCIndexPrice(): Promise<number> {
  const response = await fetch('https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd');
  const data = await response.json();
  return data.result.index_price;
}

async function getBTCOptions(): Promise<any[]> {
  const response = await fetch('https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false');
  const data = await response.json();
  return data.result;
}

async function getOptionTicker(instrumentName: string): Promise<any> {
  const response = await fetch(`https://www.deribit.com/api/v2/public/ticker?instrument_name=${instrumentName}`);
  const data = await response.json();
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

async function createDailySnapshot(): Promise<DailySnapshot> {
  const spotPrice = await getBTCIndexPrice();
  const options = await getBTCOptions();

  const nextFriday = getNextFriday();
  const lastFridayOfMonth = getLastFridayOfMonth();

  let finalMonthlyExpiry = lastFridayOfMonth;
  if (Math.abs(nextFriday.getTime() - lastFridayOfMonth.getTime()) < 24 * 60 * 60 * 1000) {
    const nextMonth = new Date(lastFridayOfMonth);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    finalMonthlyExpiry = getLastFridayOfMonth();
  }

  const weeklyATM = findATMStrike(options, nextFriday.getTime(), spotPrice);
  const monthlyATM = findATMStrike(options, finalMonthlyExpiry.getTime(), spotPrice);

  if (!weeklyATM || !monthlyATM) {
    throw new Error('Could not find ATM options');
  }

  const weeklyOption = await getOptionData(weeklyATM.instrument_name, weeklyATM.strike, nextFriday.getTime(), spotPrice);
  await new Promise(resolve => setTimeout(resolve, 100));
  const monthlyOption = await getOptionData(monthlyATM.instrument_name, monthlyATM.strike, finalMonthlyExpiry.getTime(), spotPrice);

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

async function calculateRealtime(snapshot: DailySnapshot): Promise<RealtimeComparison> {
  const currentPrice = await getBTCIndexPrice();
  const { high, low } = await getTodayHighLow();

  const actualRange = high - low;
  const actualRangePercent = (actualRange / snapshot.spotPrice) * 100;

  const now = Date.now();
  const timeElapsed = (now - snapshot.timestamp) / (1000 * 60 * 60);

  const weeklySurpriseRatio = actualRange / snapshot.weeklyOption.impliedDailyMove;
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

  const monthlySurpriseRatio = actualRange / snapshot.monthlyOption.impliedDailyMove;
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

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    const snapshot = await createDailySnapshot();
    const realtime = await calculateRealtime(snapshot);

    // Simplified stats for serverless (no historical tracking)
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
    }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers,
    });
  }
}
