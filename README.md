# Implied vs Realized Volatility Tracker

A professional-grade tool for tracking Bitcoin's implied volatility (from options) vs actual realized volatility.

## Key Innovation: Historical IV Snapshots

**Unlike traditional volatility trackers**, this tool can fetch historical implied volatility data even if it wasn't running. This means:

- ✅ **No need to run 24/7** - Historical IV data is available via Deribit API
- ✅ **Backfill capability** - Can load past 30+ days even if never run before
- ✅ **Sync across devices** - Start on any machine, get full historical context
- ✅ **Reference point** - Always compares to 00:00 UTC snapshot, not moving target

## How It Works

### 1. Daily Snapshot (00:00 UTC)
Every day at midnight UTC, the system captures:
- BTC Price at open
- ATM Implied Volatility (from Deribit)
- Calculated Implied Daily Move: `Price × (IV / sqrt(365))`

### 2. Real-Time Tracking
Throughout the day, tracks:
- Actual high-low range
- Surprise Ratio: `Actual Range / Implied Range`
- Projections for end-of-day

### 3. Historical Analysis
Can backfill up to months of data for:
- Regime detection
- Pattern analysis
- Volatility trends

## Metrics Explained

### Surprise Ratio
```
Surprise Ratio = Actual Range / Implied Range

> 1.3x = HIGH VOLATILITY (market moving more than expected)
< 0.7x = LOW VOLATILITY (market moving less than expected)
~1.0x = NORMAL (market behaving as expected)
```

### Trading Signals

| Surprise Ratio | Interpretation | Signal |
|----------------|----------------|--------|
| **> 1.5x** | Volatility explosion | Vol was too cheap, likely to rise |
| **1.2x - 1.5x** | Above average vol | Trend day, expect continuation |
| **0.8x - 1.2x** | Normal range | Vol fairly priced |
| **0.5x - 0.8x** | Below average vol | Range-bound, mean reversion |
| **< 0.5x** | Extremely quiet | Vol was too expensive, will compress |

### Example Scenarios

**Scenario 1: Breakout Day**
```
00:00 UTC: BTC $42,000, IV 50%, Implied Move $840 (2%)
14:00 UTC: Range $1,680 (4%)
Surprise Ratio: 2.0x
Signal: Strong trend day, vol underpriced
Action: Expect continued volatility
```

**Scenario 2: Range-Bound Day**
```
00:00 UTC: BTC $42,000, IV 50%, Implied Move $840 (2%)
14:00 UTC: Range $420 (1%)
Surprise Ratio: 0.5x
Signal: Quiet day, vol overpriced
Action: Expect compression, mean reversion
```

## Quick Start

```bash
# Start the server
bun run implied-realized

# Or manually
cd implied-vs-realized
bun run server.ts
```

**Access**: http://localhost:3200

## Features

### Real-Time Display
- **Surprise Ratio** - Large display showing actual vs implied
- **Status Badge** - HIGH_VOL / NORMAL / LOW_VOL
- **Progress Bar** - Visual representation of surprise ratio
- **Signal Box** - Trading interpretation

### Implied Section (00:00 UTC Reference)
- Date and snapshot time
- Price at open
- ATM Implied Volatility
- Implied Daily Move ($)
- Implied Daily Move (%)

### Realized Section (Current)
- Time elapsed since midnight
- Current price
- Day's high and low
- Actual range ($)
- Actual range (%)

### Projections
- Projected EOD range (based on current pace)
- Projected EOD surprise ratio
- Range utilization %
- Difference vs implied

### Historical Data
- Last 30 days of snapshots
- ATM IV history
- Implied move trends
- Can backfill on startup

## API Endpoints

### GET /api/current
Returns current snapshot and real-time data
```json
{
  "snapshot": {
    "date": "2025-12-02",
    "timestamp": 1733097600000,
    "price": 42000,
    "atmIV": 50.5,
    "impliedDailyMove": 840.2,
    "impliedDailyMovePercent": 2.0
  },
  "realtime": {
    "currentPrice": 42500,
    "dayHigh": 42800,
    "dayLow": 41600,
    "actualRange": 1200,
    "actualRangePercent": 2.86,
    "surpriseRatio": 1.43,
    "timeElapsed": 14.5,
    "projectedEODRange": 2000,
    "status": "HIGH_VOL",
    "signal": "Actual >> Implied | Vol underpriced | Trend day likely"
  }
}
```

### GET /api/history?days=30
Returns historical snapshots
```json
[
  {
    "date": "2025-12-02",
    "timestamp": 1733097600000,
    "price": 42000,
    "atmIV": 50.5,
    "impliedDailyMove": 840.2,
    "impliedDailyMovePercent": 2.0
  },
  ...
]
```

### GET /api/stats
Returns aggregate statistics
```json
{
  "totalDays": 30,
  "avgIV": 52.3,
  "avgImpliedMove": 2.15,
  "oldestDate": "2025-11-02",
  "newestDate": "2025-12-02"
}
```

## Technical Details

### Data Sources
- **Price Data**: Binance BTC/USDT (spot)
- **Implied Volatility**: Deribit historical volatility API
- **Time Reference**: UTC

### Calculation Method
```
Implied Daily Move = Price × (ATM_IV / 100) / sqrt(365)

Where:
- ATM_IV = At-the-money implied volatility (%)
- sqrt(365) = Converts annual vol to daily vol
- Result = Expected 1-standard-deviation move in dollars
```

### Why 00:00 UTC?
- Standard market reset time
- Clean daily boundary
- Aligns with options expiry conventions
- Deribit data availability

## Advantages Over Continuous IV Tracking

| Feature | Continuous IV | Fixed Snapshot (This Tool) |
|---------|--------------|---------------------------|
| **Reference Point** | ❌ Moving target | ✅ Fixed at 00:00 UTC |
| **Surprise Detection** | ❌ Circular logic | ✅ Clear ratio-based |
| **Predictive Value** | ❌ Low | ✅ High (can project EOD) |
| **Historical Analysis** | ❌ Difficult | ✅ Easy (daily snapshots) |
| **Trading Signals** | ❌ Unclear | ✅ Clear (buy/sell vol) |
| **24/7 Running** | ✅ Required | ❌ Optional (backfill) |
| **Device Sync** | ❌ State dependent | ✅ Works anywhere |

## Use Cases

### Day Trading
- Identify trend days early (high surprise ratio by 10am)
- Detect range-bound days (low surprise ratio)
- Time entries/exits based on vol regime

### Options Trading
- Identify when vol is mispriced
- Buy vol when surprise > 1.5x
- Sell vol when surprise < 0.5x

### Risk Management
- Adjust position sizes based on vol regime
- Set wider stops on high vol days
- Tighten stops on low vol days

### Research
- Study correlation between surprise ratio and price action
- Build predictive models
- Identify seasonal patterns

## Port

Runs on port **3200** (different from other monitors)

## Future Enhancements

Potential additions:
- [ ] Multiple timeframes (4H, weekly snapshots)
- [ ] ETH and other coins
- [ ] Vol surface analysis (not just ATM)
- [ ] Regime classification ML model
- [ ] Historical surprise ratio statistics
- [ ] Alerts/notifications
- [ ] Export to CSV

---

**Built to solve the "moving target" problem in volatility analysis.**
