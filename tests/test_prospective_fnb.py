import copy
import unittest
import tempfile
from pathlib import Path

import numpy as np

from scripts import prospective_fnb as P


class ProspectiveResearchTests(unittest.TestCase):
    def test_holdings_drift_until_january(self):
        # October–December: A doubles then halves, B is flat. No trading
        # inside that interval: wealth is exactly one at December's close.
        self.assertEqual(P.portfolio_values([[2, 1], [.5, 1], [1, 1]], [.5, .5]), [1., 1.5, 1., 1.])
        # December followed by January does rebalance before the second shock.
        self.assertEqual(P.portfolio_values([[2, 1], [.5, 1]], [.5, .5], 11), [1., 1.5, 1.125])

    def test_wealth_is_a_position_aggregation_without_extra_correlation(self):
        np.testing.assert_allclose(P.portfolio_values([[.8, 1.2]], [.25, .75]), [1, 1.1])
        for data, weights in [([[0, 1]], [.5, .5]), ([[np.nan, 1]], [.5, .5]), ([[1, 1]], [.7, .5]), ([[1, 1]], [-.1, 1.1])]:
            with self.assertRaises(ValueError):
                P.portfolio_values(data, weights)

    def test_binomial_bounds_are_simulation_error_only(self):
        lo, hi = P.wilson(12500, 25000)
        self.assertLess(lo, .5)
        self.assertGreater(hi, .5)
        self.assertAlmostEqual(lo, 1-hi)
        self.assertEqual(P.wilson(0, 100)[0], 0)
        with self.assertRaises(ValueError): P.wilson(2, 1)

    def test_end_losses_and_drawdowns_are_distinct(self):
        q = P.metrics(np.array([1.2, 1.4]), np.log([1.1, 1.5]), np.array([.35, .1]), 2)
        self.assertEqual(q['beatProbability'], .5)
        self.assertEqual(q['lossProbability'], 0)
        self.assertEqual(q['drawdownProbability']['0.3'], .5)
        self.assertAlmostEqual(q['medianAnnual'], 1.3**.5-1)
        self.assertAlmostEqual(q['futureValue'], 130000)

    @staticmethod
    def packet():
        rows = [dict(mean=.05, annualLogVariance=.02, viewResponse=1., beta=1., coreCoefficients=[1.],
                     residual=[0., 0., 0., 0.], correlationScale=1., mer=.001) for _ in range(2)]
        p = dict(rows=rows, means={'cholesky': [[.01, 0], [.01, 0]]}, core=[[-.05], [.05]]*60,
                 longAvailable=True, initialVol=1., end='2026-09', options={'blockLength': 3})
        return dict(ids=['A'], indices=[0], reference=1, prepared=p, planning=copy.deepcopy(p),
                    maxFunds=8, minWeight=.02, limits={'caps': [1.], 'rows': [[1.], [-1.]], 'bounds': [1., 0.]})

    def test_identical_asset_is_a_tie_not_a_fabricated_win(self):
        packet = self.packet()
        original = copy.deepcopy(packet)
        a = P.simulate(packet, 'history', 100, 17, allocations={'same': {'A': 1.}})
        b = P.simulate(packet, 'history', 100, 17, allocations={'same': {'A': 1.}})
        self.assertEqual(a, b)
        self.assertEqual(packet, original)
        for y in P.HORIZONS:
            self.assertEqual(a[y]['same']['beatProbability'], 0)
            self.assertEqual(a[y]['same']['tieProbability'], 1)

    def test_intermediate_horizon_does_not_rebalance_the_long_path(self):
        packet = self.packet()
        p = packet['prepared']
        second = copy.deepcopy(p['rows'][0])
        second.update(mean=.09, annualLogVariance=.03, coreCoefficients=[-.3], residual=[.03, -.02, .01, -.02])
        p['rows'].insert(1, second)
        p['means']['cholesky'] = [[.01, 0, 0], [0, .02, 0], [.01, 0, 0]]
        packet.update(ids=['A', 'B'], indices=[0, 1], reference=2, planning=copy.deepcopy(p))
        bundle = P.simulate(packet, 'history', 100, 17)
        result = P.simulate(packet, 'history', 100, 17, allocations={'mix': {'A': .6, 'B': .4}})
        for y in P.HORIZONS:
            wealth = np.prod(bundle[y]['segments']@np.array([.6, .4]), axis=0)
            self.assertAlmostEqual(np.median(wealth)*100000, result[y]['mix']['futureValue'])
            self.assertEqual(bundle[y]['segments'].shape[0], y+1)

    def test_local_constraints_are_required_before_publishing(self):
        packet = self.packet()
        self.assertTrue(P.allocation_valid({'A': 1.}, packet))
        for weights in ({'A': .9}, {'B': 1.}, {'A': float('nan')}, {'A': -1.}):
            self.assertFalse(P.allocation_valid(weights, packet))
        with self.assertRaises(ValueError): P.evaluate(packet, {'same': {'A': 1.}}, count=24999)
        with self.assertRaises(ValueError): P.simulate(packet, 'unknown', 100, 1)

    def test_published_research_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/'fnb-prospective-history'/'dated.json'
            P.save(file, {'weights': {'A': 1.}})
            before = file.read_bytes()
            P.save(file, {'weights': {'A': 1.}})
            with self.assertRaises(ValueError): P.save(file, {'weights': {'A': .5}})
            self.assertEqual(before, file.read_bytes())


if __name__ == '__main__':
    unittest.main()
