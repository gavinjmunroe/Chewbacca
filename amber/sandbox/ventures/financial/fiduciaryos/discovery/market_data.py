"""
discovery/market_data.py — Fetch historical market data for FiduciaryOS training
scenario generation.

Data sources:
  - yfinance: Historical OHLCV prices, dividends, splits for equities/ETFs/indices
  - FRED API: Macroeconomic indicators (interest rates, inflation, GDP, unemployment)
  - Alpha Vantage: Intraday + fundamentals (optional, requires API key)

Output:
  - data/raw/market_data/prices/{ticker}.parquet    — daily OHLCV
  - data/raw/market_data/fundamentals/{ticker}.json — P/E, P/B, dividends
  - data/raw/market_data/fred/{series_id}.json      — macro time series
  - data/raw/market_data/market_summary.json        — portfolio construction inputs

Usage:
    python discovery/market_data.py \
        --output data/raw/market_data \
        --tickers-file data/raw/market_data/tickers.txt \
        --start 2000-01-01
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

ALPHA_VANTAGE_API_KEY = os.environ.get("ALPHA_VANTAGE_API_KEY", "")
FRED_API_KEY = os.environ.get("FRED_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

FRED_BASE = "https://api.stlouisfed.org/fred"

# Core equity universe for portfolio construction scenarios
EQUITY_TICKERS: list[str] = [
    # US Large Cap
    "AAPL",
    "MSFT",
    "AMZN",
    "NVDA",
    "GOOGL",
    "META",
    "BRK-B",
    "LLY",
    "V",
    "JPM",
    "JNJ",
    "XOM",
    "UNH",
    "MA",
    "AVGO",
    "PG",
    "HD",
    "CVX",
    "MRK",
    "COST",
    # US Mid Cap
    "DG",
    "MPWR",
    "TREX",
    "RCL",
    "VRT",
    "TYL",
    "ENTG",
    "BRKR",
    "TTC",
    "RGEN",
    # International Developed
    "ASML",
    "NVO",
    "MC",
    "SAP",
    "NESN",
    "ROG",
    "NOVN",
    "AZN",
    "LVMH",
    "SIEGY",
    # Emerging Markets
    "TSM",
    "BABA",
    "JD",
    "NIO",
    "RELIANCE.NS",
    "INFY",
    # Bonds / Fixed Income ETFs
    "AGG",
    "BND",
    "TLT",
    "IEF",
    "SHY",
    "HYG",
    "LQD",
    "EMB",
    "MUB",
    "VTIP",
    # Equity ETFs
    "SPY",
    "QQQ",
    "IWM",
    "VTI",
    "VEA",
    "VWO",
    "EFA",
    "EEM",
    "GLD",
    "SLV",
    "VNQ",
    "XLE",
    "XLF",
    "XLK",
    "XLV",
    "XLP",
    "XLU",
    "XLI",
    "XLB",
    "XLC",
    # Sector / Factor
    "VIG",
    "DGRO",
    "USMV",
    "QUAL",
    "VYM",
    "MTUM",
    "VBR",
    "VBK",
    "VXUS",
    # Dividend Focus
    "SCHD",
    "DVY",
    "SDY",
    "HDV",
    # Fixed Income
    "BNDX",
    "FLOT",
    "STIP",
    "LTPZ",
    "SCHP",
]

# FRED macroeconomic series for scenario generation
FRED_SERIES: list[dict[str, str]] = [
    {"id": "DFF", "name": "Fed Funds Rate", "category": "interest_rates"},
    {"id": "GS10", "name": "10-Year Treasury Yield", "category": "interest_rates"},
    {"id": "GS2", "name": "2-Year Treasury Yield", "category": "interest_rates"},
    {"id": "GS30", "name": "30-Year Treasury Yield", "category": "interest_rates"},
    {"id": "T10YIE", "name": "10-Year Breakeven Inflation", "category": "inflation"},
    {"id": "CPIAUCSL", "name": "CPI (All Urban)", "category": "inflation"},
    {"id": "PCEPI", "name": "PCE Price Index", "category": "inflation"},
    {"id": "GDPC1", "name": "Real GDP (Seasonally Adjusted)", "category": "gdp"},
    {"id": "UNRATE", "name": "Unemployment Rate", "category": "labor"},
    {"id": "PAYEMS", "name": "Nonfarm Payrolls", "category": "labor"},
    {
        "id": "UMCSENT",
        "name": "U of Michigan Consumer Sentiment",
        "category": "sentiment",
    },
    {"id": "VIXCLS", "name": "CBOE Volatility Index (VIX)", "category": "volatility"},
    {"id": "DTWEXBGS", "name": "USD Broad Index", "category": "fx"},
    {"id": "NASDAQCOM", "name": "NASDAQ Composite", "category": "equity"},
    {"id": "SP500", "name": "S&P 500", "category": "equity"},
    {"id": "BAMLH0A0HYM2", "name": "HY OAS Spread", "category": "credit"},
    {"id": "BAMLC0A0CM", "name": "IG OAS Spread", "category": "credit"},
    {"id": "MORTGAGE30US", "name": "30-Year Mortgage Rate", "category": "housing"},
    {
        "id": "CSUSHPINSA",
        "name": "Case-Shiller Home Price Index",
        "category": "housing",
    },
    {"id": "TOTALSL", "name": "Consumer Credit Outstanding", "category": "credit"},
]


def _yfinance_available() -> bool:
    try:
        import yfinance  # type: ignore  # noqa: F401

        return True
    except ImportError:
        return False


def _download_yfinance(
    tickers: list[str],
    start: str,
    end: str | None = None,
    output_dir: Path | None = None,
) -> dict[str, Any]:
    """
    Download historical price data using yfinance.
    Returns summary statistics dict.
    """
    if not _yfinance_available():
        logger.warning(
            "yfinance not installed — skipping equity price download. pip install yfinance"
        )
        return {}

    import yfinance as yf  # type: ignore

    summary: dict[str, Any] = {}
    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"Downloading {len(tickers)} tickers from yfinance (start={start})...")

    # Batch download (faster than individual)
    batch_size = 50
    for i in range(0, len(tickers), batch_size):
        batch = tickers[i : i + batch_size]
        try:
            data = yf.download(
                batch,
                start=start,
                end=end,
                progress=False,
                auto_adjust=True,
                actions=True,
            )

            for ticker in batch:
                try:
                    if len(batch) == 1:
                        ticker_data = data
                    else:
                        # Multi-ticker download has MultiIndex columns
                        ticker_data = (
                            data.xs(ticker, level=1, axis=1)
                            if ticker in data.columns.get_level_values(1)
                            else None
                        )

                    if ticker_data is None or ticker_data.empty:
                        logger.debug(f"  No data for {ticker}")
                        continue

                    # Save as parquet if pandas available
                    if output_dir:
                        try:
                            parquet_path = (
                                output_dir / f"{ticker.replace('-', '_')}.parquet"
                            )
                            ticker_data.to_parquet(parquet_path)
                        except Exception:
                            # Fall back to CSV
                            csv_path = output_dir / f"{ticker.replace('-', '_')}.csv"
                            ticker_data.to_csv(csv_path)

                    summary[ticker] = {
                        "start": str(ticker_data.index.min().date())
                        if not ticker_data.empty
                        else "",
                        "end": str(ticker_data.index.max().date())
                        if not ticker_data.empty
                        else "",
                        "rows": len(ticker_data),
                        "columns": list(ticker_data.columns),
                    }
                except Exception as exc:
                    logger.debug(f"  {ticker} data extraction failed: {exc}")

            logger.debug(
                f"  Batch {i // batch_size + 1}/{(len(tickers) + batch_size - 1) // batch_size} complete"
            )
            time.sleep(0.5)

        except Exception as exc:
            logger.warning(f"  Batch {batch} download failed: {exc}")

    return summary


def _download_fundamentals(tickers: list[str], output_dir: Path) -> dict[str, Any]:
    """
    Download fundamental data (P/E, P/B, dividend yield, market cap) via yfinance.
    """
    if not _yfinance_available():
        return {}

    import yfinance as yf  # type: ignore

    output_dir.mkdir(parents=True, exist_ok=True)
    fundamentals: dict[str, Any] = {}

    for ticker in tickers[:100]:  # Cap at 100 for fundamentals
        try:
            tkr = yf.Ticker(ticker)
            info = tkr.info

            if not info:
                continue

            fund_data = {
                "ticker": ticker,
                "longName": info.get("longName", ""),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "marketCap": info.get("marketCap"),
                "trailingPE": info.get("trailingPE"),
                "forwardPE": info.get("forwardPE"),
                "priceToBook": info.get("priceToBook"),
                "dividendYield": info.get("dividendYield"),
                "beta": info.get("beta"),
                "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
                "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
                "earningsGrowth": info.get("earningsGrowth"),
                "revenueGrowth": info.get("revenueGrowth"),
                "returnOnEquity": info.get("returnOnEquity"),
                "debtToEquity": info.get("debtToEquity"),
                "currency": info.get("currency", "USD"),
                "exchange": info.get("exchange", ""),
            }
            fundamentals[ticker] = fund_data
            (output_dir / f"{ticker.replace('-', '_')}.json").write_text(
                json.dumps(fund_data, indent=2, default=str)
            )
            time.sleep(0.2)

        except Exception as exc:
            logger.debug(f"  Fundamentals for {ticker}: {exc}")

    return fundamentals


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _fred_fetch_series(series_id: str, start: str = "2000-01-01") -> list[dict]:
    """Fetch a FRED time series. Returns list of {date, value} dicts."""
    params: dict[str, Any] = {
        "series_id": series_id,
        "observation_start": start,
        "file_type": "json",
        "sort_order": "asc",
    }
    if FRED_API_KEY:
        params["api_key"] = FRED_API_KEY

    resp = requests.get(
        f"{FRED_BASE}/series/observations",
        params=params,
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    observations = data.get("observations", [])
    return [
        {
            "date": obs["date"],
            "value": float(obs["value"]) if obs["value"] != "." else None,
        }
        for obs in observations
    ]


def download_fred_data(
    series_list: list[dict[str, str]], output_dir: Path, start: str = "2000-01-01"
) -> dict[str, int]:
    """Download all FRED series and save to output_dir."""
    output_dir.mkdir(parents=True, exist_ok=True)
    results: dict[str, int] = {}

    for series_def in series_list:
        series_id = series_def["id"]
        name = series_def["name"]
        category = series_def["category"]

        try:
            observations = _fred_fetch_series(series_id, start=start)
            output = {
                "series_id": series_id,
                "name": name,
                "category": category,
                "observations": observations,
            }
            (output_dir / f"{series_id}.json").write_text(json.dumps(output, indent=2))
            results[series_id] = len(observations)
            logger.debug(
                f"  FRED {series_id} ({name}): {len(observations)} observations"
            )
            time.sleep(0.5)
        except Exception as exc:
            logger.warning(f"  FRED {series_id} failed: {exc}")
            results[series_id] = 0

    return results


def _build_market_summary(
    price_summary: dict[str, Any],
    fundamentals: dict[str, Any],
    fred_counts: dict[str, int],
    output_path: Path,
) -> None:
    """Build a market summary JSON for scenario generation."""
    summary = {
        "generated_at": datetime.utcnow().isoformat(),
        "equity_universe": {
            "total_tickers": len(price_summary),
            "tickers": list(price_summary.keys()),
            "date_ranges": {
                t: {"start": v.get("start"), "end": v.get("end"), "rows": v.get("rows")}
                for t, v in price_summary.items()
            },
        },
        "fundamentals": {
            "total_tickers": len(fundamentals),
            "avg_pe": _safe_mean([f.get("trailingPE") for f in fundamentals.values()]),
            "avg_pb": _safe_mean([f.get("priceToBook") for f in fundamentals.values()]),
            "avg_dividend_yield": _safe_mean(
                [f.get("dividendYield") for f in fundamentals.values()]
            ),
        },
        "macro_data": {
            "total_series": len(fred_counts),
            "series": fred_counts,
        },
        "asset_classes": {
            "equities": [
                t
                for t in EQUITY_TICKERS
                if t
                not in [
                    "AGG",
                    "BND",
                    "TLT",
                    "IEF",
                    "SHY",
                    "HYG",
                    "LQD",
                    "EMB",
                    "MUB",
                    "VTIP",
                    "GLD",
                    "SLV",
                    "VNQ",
                ]
            ],
            "bonds": [
                "AGG",
                "BND",
                "TLT",
                "IEF",
                "SHY",
                "HYG",
                "LQD",
                "EMB",
                "MUB",
                "VTIP",
            ],
            "alternatives": ["GLD", "SLV", "VNQ"],
            "indices": ["SPY", "QQQ", "IWM", "VTI", "VEA", "VWO"],
        },
    }
    output_path.write_text(json.dumps(summary, indent=2, default=str))
    logger.info(f"Market summary → {output_path}")


def _safe_mean(values: list) -> float | None:
    valid = [v for v in values if v is not None and isinstance(v, (int, float))]
    return round(sum(valid) / len(valid), 4) if valid else None


class MarketDataCollector:
    """
    Orchestrates all market data collection for FiduciaryOS.
    """

    def __init__(self, output_dir: str | Path) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def run(
        self,
        tickers: list[str] | None = None,
        start: str = "2000-01-01",
        end: str | None = None,
    ) -> dict[str, int]:
        if tickers is None:
            tickers = EQUITY_TICKERS

        logger.info(f"Market data collection: {len(tickers)} tickers, start={start}")

        # Download prices
        price_dir = self.output_dir / "prices"
        price_summary = _download_yfinance(
            tickers, start=start, end=end, output_dir=price_dir
        )
        logger.info(f"Prices: {len(price_summary)} tickers downloaded")

        # Download fundamentals
        fund_dir = self.output_dir / "fundamentals"
        fundamentals = _download_fundamentals(tickers[:100], fund_dir)
        logger.info(f"Fundamentals: {len(fundamentals)} tickers")

        # Download FRED macroeconomic series
        fred_dir = self.output_dir / "fred"
        fred_counts = download_fred_data(FRED_SERIES, fred_dir, start=start)
        logger.info(f"FRED: {len(fred_counts)} series downloaded")

        # Build summary
        _build_market_summary(
            price_summary,
            fundamentals,
            fred_counts,
            self.output_dir / "market_summary.json",
        )

        return {
            "tickers_downloaded": len(price_summary),
            "fundamentals_downloaded": len(fundamentals),
            "fred_series_downloaded": sum(1 for v in fred_counts.values() if v > 0),
        }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Collect market data for FiduciaryOS")
    parser.add_argument("--output", default="data/raw/market_data")
    parser.add_argument("--start", default="2000-01-01")
    parser.add_argument("--end", default=None)
    parser.add_argument(
        "--tickers-file",
        default=None,
        help="Optional text file with one ticker per line (default: built-in universe)",
    )
    args = parser.parse_args()

    tickers = None
    if args.tickers_file:
        tickers_path = Path(args.tickers_file)
        if tickers_path.exists():
            tickers = [
                t.strip() for t in tickers_path.read_text().splitlines() if t.strip()
            ]

    collector = MarketDataCollector(output_dir=args.output)
    stats = collector.run(tickers=tickers, start=args.start, end=args.end)
    logger.info(f"Market data collection complete: {stats}")
