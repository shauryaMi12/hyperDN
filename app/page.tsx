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

// Blueprint for your assets (keeps ESLint happy!)
interface Asset {
  name: string;
  funding: string;
  annualizedYield: number;
  openInterest: string;
  currentPrice: number;
  maxLeverage: number;
  assetIndex: number; // Original index for correct URL!
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
  const [assets, setAssets] = useState<Asset[]>([]);
  const [hlpYield, setHlpYield] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<'yield' | 'oi' | 'price' | 'leverage'>('yield'); // Which column to sort
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc'); // Direction
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        // Fetch perps data
        const data = await fetchHyperliquidData();
        // Direct zip with index (ensures correct ctx & URL index match!)
        const newAssets = data.universe
          .map((u, i) => {
            const ctx = data.assetCtxs[i] || { funding: '0', openInterest: '0', markPx: '0' };
            if (parseFloat(ctx.openInterest || '0') <= 0) return null; // Skip quiet ones
            return {
              name: u.name,
              funding: ctx.funding || 'N/A',
              annualizedYield: calculateAnnualizedYield(ctx.funding || '0'),
              openInterest: ctx.openInterest || '0',
              currentPrice: parseFloat(ctx.markPx || '0'),
              maxLeverage: u.maxLeverage,
              assetIndex: i, // Original index for correct URL!
            };
          })
          .filter((asset): asset is Asset => asset !== null); // Type guard: Drop nulls & narrow to Asset[]
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

  const handleSort = (key: 'yield' | 'oi' | 'price' | 'leverage') => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc'); // Toggle if same key
    } else {
      setSortKey(key); // Switch key, start desc
      setSortDirection('desc');
    }
  };

  const sortedAssets = [...assets].sort((a, b) => {
    let aVal, bVal;
    switch (sortKey) {
      case 'yield':
        aVal = a.annualizedYield;
        bVal = b.annualizedYield;
        break;
      case 'oi':
        aVal = parseFloat(a.openInterest);
        bVal = parseFloat(b.openInterest);
        break;
      case 'price':
        aVal = a.currentPrice;
        bVal = b.currentPrice;
        break;
      case 'leverage':
        aVal = a.maxLeverage;
        bVal = b.maxLeverage;
        break;
      default:
        return 0;
    }
    const dir = sortDirection === 'desc' ? -1 : 1;
    return (aVal > bVal ? 1 : aVal < bVal ? -1 : 0) * dir;
  });

  const getFundingPercent = (funding: string) => {
    return (parseFloat(funding) * 100).toFixed(4);
  };

  const getOpenInterest = (oi: string) => {
    const num = parseFloat(oi || '0');
    return Math.round(num).toLocaleString(); // Round to nearest whole, add commas!
  };

  const getCurrentPrice = (price: number) => {
    if (price < 1) {
      return `$${price.toFixed(4)}`; // < $1: 4 decimals (e.g., $0.0039)
    } else if (price < 100) {
      return `$${price.toFixed(3)}`; // $1-99: 3 decimals (e.g., $12.345)
    } else {
      return `$${price.toFixed(2)}`; // $100+: 2 decimals (e.g., $65,432.10)
    }
  };

  const getArrow = (key: 'yield' | 'oi' | 'price' | 'leverage') => {
    if (sortKey !== key) return '↕'; // Neutral symbol for sortable awareness!
    return sortDirection === 'desc' ? '▾' : '▴'; // Full arrow when active
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Hyperliquid Delta Neutral Yields</h1>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-600">Current funding-based yields for long spot/short perp strategies. Only active perps shown! Click headers to sort.</p>
        <div className="flex items-center space-x-4">
          <p className="text-sm text-purple-600">HLP Yield {hlpYield ? `${hlpYield.toFixed(2)}%` : 'Loading...'}</p>
          <a href="/corr" className="text-blue-600 hover:underline text-sm">View Correlation Matrix</a>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-300">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-2 text-left">Asset</th>
              <th className="px-4 py-2 text-left">Current Funding (8h)</th>
              <th 
                className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100" 
                onClick={() => handleSort('yield')}
              >
                Annualized Yield (%) {getArrow('yield')}
              </th>
              <th 
                className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100" 
                onClick={() => handleSort('oi')}
              >
                Open Interest {getArrow('oi')}
              </th>
              <th 
                className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100" 
                onClick={() => handleSort('price')}
              >
                Current Price (USD) {getArrow('price')}
              </th>
              <th 
                className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100" 
                onClick={() => handleSort('leverage')}
              >
                Max Leverage {getArrow('leverage')}
              </th>
            </tr>
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
                      href={`https://app.hyperliquid.xyz/trade?asset=${asset.assetIndex}`} 
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
