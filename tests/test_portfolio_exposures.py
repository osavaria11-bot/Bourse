import json
import unittest
from scripts import collect_portfolio_exposures as exposures


class ExposureTests(unittest.TestCase):
    def test_disclosed_weights_keep_the_whole_fund_denominator(self):
        weights = exposures.distribution({"technology": 20, "financials": 75})
        self.assertEqual({row["id"]: row["weight"] for row in weights}, {"technology": 20, "financials": 75, "other_assets": 5})
        self.assertAlmostEqual(sum(row["weight"] for row in exposures.distribution({"a": 60.1, "b": 40.1})), 100)
        with self.assertRaises(ValueError): exposures.distribution({"a": 105})
        with self.assertRaises(ValueError): exposures.distribution({"a": -10, "b": 100})

    def test_ishares_uses_underlying_section_and_market_values_not_rounded_percentages(self):
        data = 'Fund Holdings as of,"Oct 9, 2026"\n\nTicker,Name,Sector,Asset Class,Market Value,Weight (%),Location\nETF,Wrapper,Financials,Equity,100,100,Canada\n\nFund Holdings as of,"Oct 9, 2026"\n\nTicker,Name,Sector,Asset Class,Market Value,Weight (%),Location\nTECH,Technology,Information Technology,Equity,70,69,Taiwan\nBOND,Bond,Treasury,Fixed Income,29,30,Canada\nCASH,Cash,Cash and/or Derivatives,Cash,1,1,Canada\n'
        result = exposures.aggregate_ishares(data)
        self.assertEqual(result["as_of"], "2026-10-09")
        self.assertEqual({r["id"]: r["weight"] for r in result["sectors"]}, {"technology": 70, "bonds": 29, "other_assets": 1})
        self.assertEqual({r["id"]: r["weight"] for r in result["geography"]}, {"taiwan": 70, "canada": 30})

    def test_vanguard_uses_gics_instead_of_icb_and_keeps_bonds_in_the_denominator(self):
        rows = [
            {"marketValuePercentage": 60, "gicsSectorDescription": "Communication Services", "icbIndustryDescription": "Technology", "securityType": "EQ.STOCK", "effectiveDate": "2026-08-31", "bloombergIsoCountry": "US"},
            {"marketValuePercentage": 40, "gicsSectorDescription": None, "securityType": "FI.CORP", "effectiveDate": "2026-08-31", "bloombergIsoCountry": "CA"},
        ]
        result = exposures.aggregate_vanguard(rows)
        self.assertEqual({r["id"]: r["weight"] for r in result["sectors"]}, {"communication_services": 60, "bonds": 40})
        rows[1]["effectiveDate"] = "2026-07-31"
        with self.assertRaises(ValueError): exposures.aggregate_vanguard(rows)

    def test_fidelity_decodes_country_chart_and_uses_current_month_and_actual_report_date(self):
        chart = json.dumps({"data": [["47.9 United States", 47.9], ["23.2 Canada", 23.2]]}).replace('"', '&#34;')
        body = '<div id="pdf-country-allocation"><div class="fd-grey-text">30-Sep-2026</div><div id="country-allocation-data-cm"><div data-chart-pie="' + chart + '"></div></div></div><div id="pdf-sector-allocation"><div class="fd-grey-text">30-Sep-2026</div><table>'
        for name, weight in [("Information Technology", 20), ("Financials", 20), ("Industrials", 20), ("Energy", 20), ("Materials", 17)]:
            body += f'<tr><th>{name}<img /></th><td>1</td><td>2</td><td>{weight}</td></tr>'
        body += '</table></div>'
        result = exposures.fidelity_exposure(body)
        self.assertEqual(result["as_of"], "2026-09-30")
        self.assertEqual(next(row["weight"] for row in result["sectors"] if row["id"] == "other_assets"), 3)
        self.assertAlmostEqual(next(row["weight"] for row in result["geography"] if row["id"] == "other_countries"), 28.9)


if __name__ == "__main__":
    unittest.main()
