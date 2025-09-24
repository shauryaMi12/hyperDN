'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

// Basic shapes for API data (coin names, prices, OI)
interface AssetContext {
  funding: string;
  markPx: string;
  openInterest: string;
}

interface ApiResponse {
  universe: { name: string; szDecimals: number; maxLeverage: number }[];
  assetCtxs: AssetContext[];
}

// Shape for active assets (filtered busy coins)
interface Asset {
  name: string;
  openInterest: string;
  currentPrice: number;
  assetIndex: number;
}

// Fetches all active perps data from Hyperliquid API (coin names, prices, OI)
async function fetchHyperliquidData(): Promise<ApiResponse> {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });
  if (!response.ok) throw new Error('API fetch failed');
  const data = await response.json() as [ { universe: { name: string; szDecimals: number; maxLeverage: number }[] }, AssetContext[] ];
  return { universe: data[0].universe, assetCtxs: data[1] };
}

// Fetches historical daily candle closes for a single coin (OHLC data, but we use closes for corr)
async function fetchCandles(coin: string): Promise<number[]> {
  const now = Date.now();
  const startTime = 1672531200000; // Jan 1, 2023 (all-time start for Hyperliquid era)
  const endTime = now;
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin, interval: '1d', startTime, endTime } // Daily for all-time depth (API caps ~5000 bars)
    }),
  });
  if (!response.ok) {
    console.warn(`Candle fetch failed for ${coin}: ${response.status}`);
    return [];
  }
  const data = await response.json();
  console.log(`Raw data for ${coin}:`, data);
  const candles = Array.isArray(data) ? data : [];
  console.log(`Candles for ${coin}:`, candles);
  console.log(`Number of candles for ${coin}: ${candles.length}`);
  if (candles.length === 0) return [];
  candles.sort((a: { t?: number }, b: { t?: number }) => (a.t || 0) - (b.t || 0));
  return candles.map((candle: { c?: string }) => parseFloat(candle.c || '0'));
}

// Computes daily returns from close prices: (close - prev_close) / prev_close
function computeReturns(closes: number[]): number[] {
  if (closes.length < 2) return [];
  return closes.slice(1).map((close, i) => (close - closes[i]) / closes[i]);
}

// Computes Pearson correlation between two return arrays (-1 to +1: how synced?)
function pearsonCorr(returnsA: number[], returnsB: number[]): { corr: number; isLowData: boolean } {
  const minLen = Math.min(returnsA.length, returnsB.length);
  if (minLen < 5) return { corr: 0, isLowData: true }; // Flag low data (tune threshold)
  const aSlice = returnsA.slice(0, minLen);
  const bSlice = returnsB.slice(0, minLen);
  const n = minLen;
  const meanA = aSlice.reduce((a, b) => a + b, 0) / n;
  const meanB = bSlice.reduce((a, b) => a + b, 0) / n;
  const num = aSlice.reduce((sum, r, i) => sum + (r - meanA) * (bSlice[i] - meanB), 0);
  const denA = Math.sqrt(aSlice.reduce((sum, r) => sum + Math.pow(r - meanA, 2), 0));
  const denB = Math.sqrt(bSlice.reduce((sum, r) => sum + Math.pow(r - meanB, 2), 0));
  const corr = denA && denB ? num / (denA * denB) : 0;
  return { corr, isLowData: false };
}

// Main function: Builds corr matrix & sorts assets by volume proxy (OI * price, desc for "busiest" top)
async function fetchCorrMatrix(assets: Asset[]): Promise<{ matrix: Record<string, Record<string, {corr: number; lowData: boolean}>>; sortedAssets: Asset[] }> {
  const returnsMap: Record<string, number[]> = {};
  try {
    const promises = assets.map(async (asset) => {
      const closes = await fetchCandles(asset.name);
      returnsMap[asset.name] = computeReturns(closes);
      console.log(`Returns for ${asset.name}:`, returnsMap[asset.name]);
    });
    await Promise.all(promises);

    const fullMatrix: Record<string, Record<string, {corr: number; lowData: boolean}>> = {};
    assets.forEach(assetA => {
      fullMatrix[assetA.name] = {};
      assets.forEach(assetB => {
        const { corr, isLowData } = pearsonCorr(returnsMap[assetA.name], returnsMap[assetB.name]);
        fullMatrix[assetA.name][assetB.name] = { corr: corr * 100, lowData: isLowData };
      });
    });

    // Neat Filter: Skip assets where >80% cells are lowData (no usable corrs)
    const validAssets = assets.filter(assetA => {
      const totalCells = assets.length;
      const lowDataCells = assets.filter(assetB => fullMatrix[assetA.name][assetB.name].lowData).length;
      return (lowDataCells / totalCells) <= 0.8; // Keep if ≤80% low
    });

    // Rebuild slim matrix only for valid assets
    const matrix: Record<string, Record<string, {corr: number; lowData: boolean}>> = {};
    validAssets.forEach(assetA => {
      matrix[assetA.name] = {};
      validAssets.forEach(assetB => {
        matrix[assetA.name][assetB.name] = fullMatrix[assetA.name][assetB.name];
      });
    });

    const sortedAssets = [...validAssets].sort((a, b) => {
      const volA = parseFloat(a.openInterest) * a.currentPrice;
      const volB = parseFloat(b.openInterest) * b.currentPrice;
      return volB - volA;
    });

    return { matrix, sortedAssets };
  } catch (error) {
    console.error('Corr fetch failed:', error);
    return { matrix: {}, sortedAssets: [] };
  }
}

// The page component (loads on /corr)
export default function CorrPage() {
  const [corrMatrix, setCorrMatrix] = useState<Record<string, Record<string, {corr: number; lowData: boolean}>>>({});
  const [sortedAssets, setSortedAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Auto-cache: Check localStorage for fresh data (7 days = 604800000 ms)
    const cacheKey = 'hyperCorrCache_v1';
    const cached = localStorage.getItem(cacheKey);
    const now = Date.now();
    let useCache = false;
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const { timestamp, data } = parsed;
        if (data && now - timestamp < 604800000) { // <7 days + safety check for data
          setCorrMatrix(data.matrix);
          setSortedAssets(data.sortedAssets);
          setLoading(false);
          useCache = true;
          console.log('Used cached corr data (fresh <7 days)');
        } else {
          localStorage.removeItem(cacheKey); // Nuke stale/broken cache
          console.log('Cleared invalid cache');
        }
      } catch (parseErr) {
        console.warn('Cache parse error, nuking:', parseErr);
        localStorage.removeItem(cacheKey); // Nuke bad JSON
      }
    }

    if (!useCache) {
      async function loadData() {
        try {
          setLoading(true);
          setError('');
          const data = await fetchHyperliquidData();
          const activeAssets = data.universe
            .map((u, i) => {
              const ctx = data.assetCtxs[i] || { openInterest: '0', markPx: '0' };
              if (parseFloat(ctx.openInterest || '0') <= 0) return null;
              return {
                name: u.name,
                openInterest: ctx.openInterest || '0',
                currentPrice: parseFloat(ctx.markPx || '0'),
                assetIndex: i,
              };
            })
            .filter((asset): asset is Asset => asset !== null);

          const { matrix, sortedAssets: validSorted } = await fetchCorrMatrix(activeAssets);
          setCorrMatrix(matrix);
          setSortedAssets(validSorted);

          // Cache it (with timestamp)
          localStorage.setItem(cacheKey, JSON.stringify({
            timestamp: now,
            data: { // Wrapped in 'data' for safety
              matrix,
              sortedAssets: validSorted,
            }
          }));
          console.log('Fetched & cached fresh corr data');
        } catch (err) {
          console.error('Load data error:', err);
          setError('Failed to load correlation data. Try again?');
        } finally {
          setLoading(false);
        }
      }
      loadData();
    }
  }, []);

  if (loading) {
    return <div className="container mx-auto p-4"><p className="text-center">Loading correlation matrix...</p></div>;
  }

  if (error) {
    return (
      <div className="container mx-auto p-4">
        <p className="text-red-600">{error}</p>
        <button onClick={() => window.location.reload()} className="text-blue-600 hover:underline">Retry</button>
        <Link href="/" className="text-purple-600 hover:underline ml-4">← Back to Yields</Link>
      </div>
    );
  }

  if (sortedAssets.length === 0) {
    return (
      <div className="container mx-auto p-4">
        <p className="text-gray-600">No valid correlation data available yet. Check back soon!</p>
        <Link href="/" className="text-purple-600 hover:underline">← Back to Yields</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Hyperliquid Correlation Matrix (All-Time)</h1>
      <p className="text-sm text-gray-600 mb-4">Assets sorted by trading volume (OI * price). Hover for exact %. Diagonal = 100% (self). Based on daily returns since ~2023. Only assets with sufficient history shown.</p>
      <Link href="/" className="text-purple-600 hover:underline mb-4 inline-block">← Back to Yields</Link>
      <div className="overflow-x-auto">
        <div className="max-h-96 overflow-y-auto"> {/* Fixed: Scroll box with fixed height for vertical sticky */}
          <table className="min-w-full bg-white border border-gray-300"><thead className="sticky top-0 bg-gray-50 z-10"><tr className="bg-gray-50"><th className="px-2 py-2 text-left border sticky left-0 bg-gray-50 z-20"></th>{sortedAssets.map((asset)=>(<th key={asset.name} className="px-2 py-2 text-left border">{asset.name}</th>))}</tr></thead><tbody>{sortedAssets.map((assetA)=>(
            <tr key={assetA.name}>
              <th className="px-2 py-2 text-left border font-medium sticky left-0 bg-white z-10"> {/* Fixed: Sticky left labels */}
                {assetA.name}
              </th>
              {sortedAssets.map((assetB)=>{const entry=corrMatrix[assetA.name]?.[assetB.name]||{corr:0,lowData:true};const corr=entry.corr;const lowData=entry.lowData;const display=lowData?'Low Data':Math.abs(corr).toFixed(0)+'%';const color=lowData?'#f0f0f0':(corr>0?`hsl(${corr},70%,70%)`:`hsl(210,70%,${70-corr}%)`);const title=lowData?'Insufficient history (<5 days)':`${corr.toFixed(1)}%`;return(<td key={assetB.name} className="px-2 py-2 text-center border" style={{backgroundColor:color}} title={title}>{display}</td>);})}
            </tr>
          ))}</tbody></table> {/* Fixed: Ultra-tight <table> no whitespace between tags */}
        </div>
      </div>
      <p className="mt-4 text-xs text-gray-500">Correlation based on daily returns (all available history, API max ~5000 bars). High = long-term sync. Refreshes weekly via cache.</p>
    </div>
  );
}