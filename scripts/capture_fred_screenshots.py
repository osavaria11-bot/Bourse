#!/usr/bin/env python3
"""Capture 10 FRED chart screenshots with the observation block visible.

Output files are saved to ./screenshots by default.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

SERIES = [
    ("GDPC1", "01_pib_reel"),
    ("CPIAUCSL", "02_cpi"),
    ("CPILFESL", "03_core_inflation"),
    ("UNRATE", "04_chomage"),
    ("PAYEMS", "05_emplois"),
    ("CES0500000003", "06_salaires"),
    ("FEDFUNDS", "07_taux_directeur"),
    ("GS10", "08_taux_10_ans"),
    ("T10Y2Y", "09_spread_10_2"),
    ("RRSFS", "10_ventes_detail"),
]


async def capture(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.firefox.launch()
        context = await browser.new_context(viewport={"width": 1440, "height": 1800})
        page = await context.new_page()

        for series_id, filename in SERIES:
            url = f"https://fred.stlouisfed.org/series/{series_id}"
            await page.goto(url, wait_until="domcontentloaded", timeout=120_000)
            await page.wait_for_timeout(4_000)

            container = page.locator("#content-container").first
            try:
                await container.wait_for(state="visible", timeout=15_000)
                await container.screenshot(path=str(output_dir / f"{filename}.png"))
            except Exception:
                await page.screenshot(path=str(output_dir / f"{filename}.png"), full_page=True)

        await browser.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        default="screenshots",
        help="Output directory for PNG files (default: screenshots)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    asyncio.run(capture(Path(args.output_dir)))


if __name__ == "__main__":
    main()
