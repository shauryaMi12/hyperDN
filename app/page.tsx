'use client'; // Magic words: Makes it clicky!

import { useState, useEffect } from 'react';

interface UniverseAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

interface AssetContext {
  funding: string; // e.g., "0.0000125"
  markPx: string; // Current perp price!
  openInterest: string;
}

interface ApiResponse {
  universe: UniverseAsset[];
  assetCtxs: AssetContext[];
}

interface VaultDetailsResponse {
  apr: number;
  // Other fields omitted for brevity
}

async function fetchHyperliquidData(): Promise<ApiResponse> {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });
  if (!response.ok) throw new Error('API fetch failed');
  const data = await response.json() as [ { universe: UniverseAsset[] }, AssetContext[] ];
  return { universe: data[0].universe, assetCtxs: data[1] };
}

async function fetchHLPYield(): Promise<VaultDetailsResponse> {
  const hlpAddress = '0xdfc24b077bc1425ad1dea75bcb6f8158e10df303';
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'vaultDetails', vaultAddress: hlpAddress }),
  });
  if (!response.ok) throw new Error('HLP API fetch failed');
  const data = await response.json() as VaultDetailsResponse;
  return data;
}

function calculateAnnualizedYield(funding: string): number {
  const rate = parseFloat(funding);
  return rate * 1095 * 100; // As number for sorting
}

export default function Home() {
  const [assets, setAssets] = useState<any[]>([]);
  const [hlpYield, setHlpYield] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc'); // Start with highest first!
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        // Fetch perps data
        const data = await fetchHyperliquidData();
        // Filter only busy coins with open interest > 0 (active perps!)
        const activeUniverse = data.universe.filter((u, i) => {
          const ctx = data.assetCtxs[i];
          return ctx && parseFloat(ctx.openInterest || '0') > 0;
        });
        const newAssets = activeUniverse.map((u) => {
          // Find the matching ctx by name (safer)
          const ctxIndex = data.universe.findIndex(au => au.name === u.name);
          const ctx = data.assetCtxs[ctxIndex] || { funding: '0', openInterest: '0', markPx: '0' };
          return {
            name: u.name,
            funding: ctx.funding || 'N/A',
            annualizedYield: calculateAnnualizedYield(ctx.funding || '0'),
            openInterest: ctx.openInterest || '0',
            currentPrice: parseFloat(ctx.markPx || '0'), // New: Current perp price!
            maxLeverage: u.maxLeverage,
          };
        });
        setAssets(newAssets);

        // Fetch HLP yield
        const hlpData = await fetchHLPYield();
        setHlpYield(hlpData.apr * 100); // Convert to %
      } catch (error) {
        console.error(error);
        setAssets([]);
        setHlpYield(null);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSort = () => {
    setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc');
  };

  const sortedAssets = [...assets].sort((a, b) => {
    if (sortDirection === 'desc') {
      return b.annualizedYield - a.annualizedYield;
    } else {
      return a.annualizedYield - b.annualizedYield;
    }
  });

  const getFundingPercent = (funding: string) => {
    return (parseFloat(funding) * 100).toFixed(4);
  };

  const getOpenInterest = (oi: string) => {
    const num = parseFloat(oi || '0');
    return Math.round(num).toLocaleString(); // Round to nearest whole, add commas!
  };

  const getCurrentPrice = (price: number) => {
    return `$${price.toFixed(2)}`; // USD, 2 decimals!
  };

  const getArrow = () => {
    return sortDirection === 'desc' ? '▾' : '▴'; // Triangle arrows!
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Hyperliquid Delta Neutral Yields</h1>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-600">Current funding-based yields for long spot/short perp strategies. Only active perps shown! Click arrow to sort.</p>
        <p className="text-sm text-purple-600">HLP Yield {hlpYield ? `${hlpYield.toFixed(2)}%` : 'Loading...'}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-300">
          <thead>
            <tr className="bg-gray-50"><th className="px-4 py-2 text-left">Asset</th><th className="px-4 py-2 text-left">Current Funding (8h)</th><th className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100" onClick={handleSort}>Annualized Yield (%) {getArrow()}</th><th className="px-4 py-2 text-left">Open Interest</th><th className="px-4 py-2 text-left">Current Price (USD)</th><th className="px-4 py-2 text-left">Max Leverage</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-2 text-center">Loading treasures...</td></tr>
            ) : sortedAssets.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-2 text-center">No active treasures today! Try later.</td></tr>
            ) : (
              sortedAssets.map((asset) => (
                <tr key={asset.name} className="border-t">
                  <td className="px-4 py-2">
                    <a 
                      href={`https://app.hyperliquid.xyz/trade?asset=${asset.name}`} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="font-mono text-blue-600 hover:underline cursor-pointer"
                    >
                      {asset.name}
                    </a>
                  </td>
                  <td className="px-4 py-2">{getFundingPercent(asset.funding)}%</td>
                  <td className="px-4 py-2 font-bold text-green-600">{asset.annualizedYield.toFixed(2)}%</td>
                  <td className="px-4 py-2">{getOpenInterest(asset.openInterest)}</td>
                  <td className="px-4 py-2 font-bold text-green-600">{getCurrentPrice(asset.currentPrice)}</td>
                  <td className="px-4 py-2">{asset.maxLeverage}x</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-gray-500">Data from Hyperliquid API. Yields approx; funding can flip negative.</p>
    </div>
  );
}