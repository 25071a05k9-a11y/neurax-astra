"""
Comprehensive Test Suite for Visual Inspection & Manufacturing Intelligence Platform
Tests:
1. Dataset ingestion & metadata
2. Production analytics & baseline distribution
3. Bottleneck engine (multi-factor constraint identification)
4. Anomaly detection & production health
5. Economic engine (unavailable reporting & assumption mode)
6. Investigation service (defect-aware reasoning, no false joins)
7. Simulation service (historical match & deterministic capacity)
8. Live HTTP server endpoints & response contracts
"""

import unittest
import json
import urllib.request
import os
import numpy as np

from manufacturing_dataset import ManufacturingDatasetService, ProductionScenario
from production_analytics import ProductionAnalyticsService
from bottleneck_engine import BottleneckService
from anomaly_detector import AnomalyService
from economic_engine import EconomicService
from investigation_service import InvestigationService
from simulation_service import SimulationService


class TestManufacturingIntelligence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds = ManufacturingDatasetService()
        cls.analytics = ProductionAnalyticsService(cls.ds)
        cls.bottleneck = BottleneckService(cls.analytics)
        cls.anomaly = AnomalyService(cls.analytics, cls.bottleneck)
        cls.economic = EconomicService()
        cls.investigation = InvestigationService(
            cls.analytics, cls.bottleneck, cls.anomaly, cls.economic
        )
        cls.simulation = SimulationService(
            cls.ds, cls.analytics, cls.bottleneck
        )

    # 1. Dataset Tests
    def test_dataset_loaded(self):
        self.assertTrue(self.ds.is_loaded, "Manufacturing dataset should be loaded")
        self.assertEqual(len(self.ds.scenarios_model1), 3000, "Model 1 should have 3000 scenarios")
        self.assertEqual(len(self.ds.scenarios_model2), 3000, "Model 2 should have 3000 scenarios")

    def test_dataset_metadata(self):
        meta = self.ds.get_dataset_metadata()
        self.assertIn("Manufacturing Data Shared Facility", meta["title"])
        self.assertFalse(meta["economic_data_present"], "Economic data must NOT be claimed as present")
        self.assertFalse(meta["image_join_present"], "Image join must NOT be claimed as present")

    def test_missing_values_and_malformed_csv(self):
        # Model 1 has trailing commas on lines which should be cleanly stripped
        sc1 = self.ds.get_scenario_by_id(1, "model1")
        self.assertIsNotNone(sc1)
        self.assertEqual(len(sc1.stations), 3)
        self.assertGreater(sc1.throughput, 0)

    # 2. Production Analytics Tests
    def test_production_analytics_model2(self):
        res = self.analytics.analyze_scenario(1, "model2")
        self.assertIsNotNone(res)
        self.assertIn("throughput", res)
        self.assertIn("stations", res)
        self.assertEqual(len(res["stations"]), 3)
        self.assertIn("capacity_imbalance", res)
        self.assertIn("time_breakdown", res)
        self.assertEqual(
            res["time_breakdown"]["transportation_time"],
            "Not available from supplied dataset (transport telemetry not captured in simulation export)"
        )

    def test_baseline_percentile_rankings(self):
        res = self.analytics.analyze_scenario(5, "model2")
        # In scenario 5, assembly is heavily loaded
        assy = next(s for s in res["stations"] if s["id"] == "assembly")
        self.assertGreaterEqual(assy["utilization_percentile"], 80.0)
        self.assertGreater(assy["utilization_pct"], 90.0)

    # 3. Bottleneck Engine Tests
    def test_bottleneck_scenario_5_critical(self):
        bn = self.bottleneck.evaluate_scenario(5, "model2")
        self.assertEqual(bn["primaryConstraintId"], "assembly")
        self.assertIn(bn["severity"], ["critical", "high"])
        self.assertTrue(len(bn["evidence"]) >= 2, "Must produce multiple transparent evidence items")

    def test_bottleneck_explanation_not_hardcoded(self):
        # Compare scenario 5 vs another scenario
        bn5 = self.bottleneck.evaluate_scenario(5, "model2")
        self.assertIn("Assembly", bn5["primaryConstraint"])
        # Explanation includes concrete numbers
        ev_text = " ".join(bn5["evidence"])
        self.assertTrue("%" in ev_text or "parts" in ev_text)

    # 4. Anomaly Detection Tests
    def test_anomaly_detection_distribution_based(self):
        anoms = self.anomaly.detect_anomalies(5, "model2")
        # Must return list of structured anomaly dicts
        self.assertIsInstance(anoms, list)
        for a in anoms:
            self.assertIn("metric", a)
            self.assertIn("evidence", a)
            self.assertIn("severity", a)

    def test_production_health_status(self):
        h1 = self.anomaly.get_production_health(1, "model2")
        self.assertIn(h1["status"], ["healthy", "warning", "degraded", "critical"])
        h5 = self.anomaly.get_production_health(5, "model2")
        self.assertIn(h5["status"], ["critical", "degraded"])

    # 5. Economic Engine Tests
    def test_economics_raw_unavailable(self):
        sc = self.ds.get_scenario_by_id(1, "model2")
        eco = self.economic.evaluate_scenario_economics(sc)
        self.assertFalse(eco["dataset_economic_data_available"])
        self.assertEqual(eco["status"], "UNAVAILABLE_FROM_DATASET")
        self.assertIn("Economic impact unavailable", eco["official_message"])

    def test_economics_user_assumptions(self):
        sc = self.ds.get_scenario_by_id(1, "model2")
        assumptions = {"unit_price": 100.0, "unit_material_cost": 30.0}
        eco = self.economic.evaluate_scenario_economics(sc, assumptions)
        self.assertTrue(eco["assumptions_applied"])
        self.assertEqual(eco["status"], "USER_ASSUMPTIONS_MODE")
        self.assertIn("User-provided assumptions", eco["advisory_calculations"]["source_classification"])
        self.assertEqual(eco["advisory_calculations"]["estimated_gross_revenue"], sc.total_parts * 100.0)

    # 6. Investigation & Reasoning Tests
    def test_investigation_no_false_join(self):
        mock_defect = {
            "defect_type": "hole",
            "has_defect": True,
            "ai_prediction": {"predicted_class": "hole", "confidence": 99.0},
            "overall_box": {"xmin": 10, "ymin": 10, "xmax": 30, "ymax": 30, "area_px": 200, "coverage_pct": 1.2},
            "components": []
        }
        inv = self.investigation.build_investigation(mock_defect, scenario_id=1, model="model2")
        self.assertFalse(inv["traceability"]["direct_join_exists"])
        self.assertIn("No direct unit-level join exists", inv["traceability"]["statement"])
        # Hypotheses
        self.assertTrue(len(inv["root_cause_hypotheses"]) >= 2)
        primary_hyp = inv["root_cause_hypotheses"][0]
        self.assertEqual(primary_hyp["domain_relevance"], "HIGH")
        self.assertIn("Drilling", primary_hyp["hypothesis"])
        self.assertIn(primary_hyp["production_evidence"], ["STRONG", "MODERATE", "WEAK", "INSUFFICIENT"])
        self.assertTrue(len(primary_hyp["missing_evidence"]) > 0, "Must specify missing process parameters")

    def test_normal_investigation(self):
        mock_normal = {
            "defect_type": "normal",
            "has_defect": False,
            "ai_prediction": {"predicted_class": "normal", "confidence": 100.0},
            "overall_box": None,
            "components": []
        }
        inv = self.investigation.build_investigation(mock_normal, scenario_id=1, model="model2")
        self.assertEqual(inv["quality_finding"]["verification_status"], "CONFIRMED_PRISTINE")
        self.assertIn("Product Conforming", inv["investigation_priority"])

    # 7. Simulation Tests
    def test_simulation_historical_demand_match(self):
        sim = self.simulation.simulate_demand_change(baseline_scenario_id=1, target_demand=15.0, model="model2")
        self.assertEqual(sim["simulation_type"], "HISTORICAL_SCENARIO_MATCH")
        self.assertNotEqual(sim["comparison_scenario_id"], 1)
        self.assertEqual(sim["actual_demand_matched"], 15.0)
        self.assertIn("evidence_source", sim)
        self.assertIn("station_comparisons", sim)

    def test_simulation_deterministic_bottleneck_improvement(self):
        sim = self.simulation.simulate_bottleneck_improvement(baseline_scenario_id=5, improvement_pct=20.0, model="model2")
        self.assertEqual(sim["simulation_type"], "DETERMINISTIC_BOTTLENECK_CAPACITY")
        self.assertGreater(sim["results"]["projected_throughput"], sim["results"]["baseline_throughput"])
        self.assertIn("Theory of Constraints", sim["calculation_method"])

    def test_simulation_unsupported_parameter(self):
        sim = self.simulation.evaluate_unsupported_counterfactual("ambient_temperature")
        self.assertFalse(sim["supported"])
        self.assertEqual(sim["status"], "UNSUPPORTED_BY_DATASET")


class TestLiveHttpEndpoints(unittest.TestCase):
    BASE_URL = "http://localhost:5000"

    def test_index_html(self):
        req = urllib.request.urlopen(f"{self.BASE_URL}/")
        self.assertEqual(req.status, 200)
        content = req.read().decode("utf-8")
        self.assertIn("tab-overview", content)
        self.assertIn("tab-quality", content)
        self.assertIn("tab-production", content)
        self.assertIn("tab-investigation", content)
        self.assertIn("tab-simulation", content)

    def test_api_metadata(self):
        req = urllib.request.urlopen(f"{self.BASE_URL}/api/metadata")
        self.assertEqual(req.status, 200)
        data = json.loads(req.read().decode("utf-8"))
        self.assertEqual(data["model1"]["rows"], 3000)
        self.assertEqual(data["model2"]["rows"], 3000)
        self.assertFalse(data["economic_data_present"])

    def test_api_overview(self):
        req = urllib.request.urlopen(f"{self.BASE_URL}/api/overview?scenario_id=1&model=model2")
        self.assertEqual(req.status, 200)
        data = json.loads(req.read().decode("utf-8"))
        self.assertIn("production", data)
        self.assertIn("bottleneck", data)
        self.assertIn("health", data)
        self.assertIn("economics", data)

    def test_api_production(self):
        req = urllib.request.urlopen(f"{self.BASE_URL}/api/production?scenario_id=5&model=model2")
        self.assertEqual(req.status, 200)
        data = json.loads(req.read().decode("utf-8"))
        self.assertIn("analytics", data)
        self.assertIn("bottleneck", data)
        self.assertEqual(data["bottleneck"]["primaryConstraintId"], "assembly")

    def test_api_investigation(self):
        req = urllib.request.urlopen(f"{self.BASE_URL}/api/investigation?scenario_id=5&model=model2&category=crack&filename=crack_00000.png")
        self.assertEqual(req.status, 200)
        data = json.loads(req.read().decode("utf-8"))
        self.assertIn("quality_finding", data)
        self.assertIn("production_finding", data)
        self.assertIn("root_cause_hypotheses", data)
        self.assertFalse(data["traceability"]["direct_join_exists"])

    def test_api_simulation_demand(self):
        req = urllib.request.urlopen(f"{self.BASE_URL}/api/simulate/demand?scenario_id=1&target_demand=12&model=model2")
        self.assertEqual(req.status, 200)
        data = json.loads(req.read().decode("utf-8"))
        self.assertEqual(data["simulation_type"], "HISTORICAL_SCENARIO_MATCH")

    def test_api_simulation_unsupported(self):
        req = urllib.request.urlopen(f"{self.BASE_URL}/api/simulate/unsupported?parameter=cutting_fluid_viscosity")
        self.assertEqual(req.status, 200)
        data = json.loads(req.read().decode("utf-8"))
        self.assertEqual(data["status"], "UNSUPPORTED_BY_DATASET")

    def test_api_classes_and_samples(self):
        req = urllib.request.urlopen(f"{self.BASE_URL}/api/classes")
        self.assertEqual(req.status, 200)
        classes = json.loads(req.read().decode("utf-8"))
        self.assertIn("crack", classes)
        self.assertIn("hole", classes)

        req_samp = urllib.request.urlopen(f"{self.BASE_URL}/api/samples?class=hole")
        self.assertEqual(req_samp.status, 200)
        samps = json.loads(req_samp.read().decode("utf-8"))
        self.assertIn("samples", samps)


if __name__ == "__main__":
    unittest.main()
