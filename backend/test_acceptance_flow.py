"""
End-to-End Acceptance Test Verification Script
Validates all 15 points of Section 17 of the Hackathon Specification against the running application.
"""

import urllib.request
import json
import unittest


class AcceptanceTestFlow(unittest.TestCase):
    BASE = "http://localhost:5000"

    def test_step_1_to_3_application_and_dataset(self):
        # 1. Start application & 2. Manufacturing dataset is loaded
        req = urllib.request.urlopen(f"{self.BASE}/api/metadata")
        self.assertEqual(req.status, 200)
        meta = json.loads(req.read().decode("utf-8"))
        self.assertEqual(meta["model2"]["rows"], 3000)
        self.assertEqual(meta["model1"]["rows"], 3000)
        print("[STEP 1-2 OK] Application running, dataset loaded (3000 scenarios in Model 1 & 2)")

        # 3. Production overview displays real metrics
        req = urllib.request.urlopen(f"{self.BASE}/api/overview?scenario_id=1&model=model2")
        self.assertEqual(req.status, 200)
        ov = json.loads(req.read().decode("utf-8"))
        self.assertIn("throughput", ov["production"])
        self.assertIn("primaryConstraint", ov["bottleneck"])
        print(f"[STEP 3 OK] Production overview displays real metrics: Throughput={ov['production']['throughput']} PPH, Bottleneck={ov['bottleneck']['primaryConstraint']}")

    def test_step_4_to_7_scenario_and_bottleneck(self):
        # 4. Select manufacturing scenario #5
        # 5. View utilization/waiting/throughput
        req = urllib.request.urlopen(f"{self.BASE}/api/production?scenario_id=5&model=model2")
        self.assertEqual(req.status, 200)
        prod = json.loads(req.read().decode("utf-8"))
        st = prod["analytics"]["stations"]
        assy = next(s for s in st if s["id"] == "assembly")
        self.assertGreater(assy["utilization_pct"], 99.0)
        self.assertGreater(assy["waiting_time"], 2.0)
        print(f"[STEP 4-5 OK] Scenario 5: Assembly Util={assy['utilization_pct']}%, Wait={assy['waiting_time']:.2f}min, Throughput={prod['analytics']['throughput']} PPH")

        # 6. Bottleneck engine identifies constraint
        # 7. "Why?" shows evidence
        bn = prod["bottleneck"]
        self.assertEqual(bn["primaryConstraintId"], "assembly")
        self.assertEqual(bn["severity"], "critical")
        self.assertTrue(len(bn["evidence"]) >= 3)
        print(f"[STEP 6-7 OK] Bottleneck identified as '{bn['primaryConstraint']}' ({bn['severity']}) with {len(bn['evidence'])} evidence lines:")
        for ev in bn["evidence"][:3]:
            print(f"       * {ev}")

    def test_step_8_to_9_visual_defect_pipeline(self):
        # 8. Select or analyze a defect image
        # 9. Existing image pipeline returns original + annotated + mask
        req = urllib.request.urlopen(f"{self.BASE}/api/sample_file?category=crack&filename=crack_00000.png")
        self.assertEqual(req.status, 200)
        vis = json.loads(req.read().decode("utf-8"))
        self.assertEqual(vis["defect_type"], "crack")
        self.assertTrue(vis["original_b64"].startswith("data:image/png;base64,"))
        self.assertTrue(vis["mask_b64"].startswith("data:image/png;base64,"))
        self.assertTrue(vis["annotated_b64"].startswith("data:image/png;base64,"))
        self.assertIsNotNone(vis["overall_box"])
        print(f"[STEP 8-9 OK] Visual pipeline returned original + annotated + mask for {vis['filename']} ({vis['defect_type']})")

    def test_step_10_to_12_investigation_and_hypotheses(self):
        # 10. Investigation screen combines quality and production evidence honestly
        req = urllib.request.urlopen(f"{self.BASE}/api/investigation?scenario_id=5&model=model2&category=crack&filename=crack_00000.png")
        self.assertEqual(req.status, 200)
        inv = json.loads(req.read().decode("utf-8"))

        # 11. If no direct join exists, UI clearly states that fact
        self.assertFalse(inv["traceability"]["direct_join_exists"])
        self.assertIn("No direct unit-level join exists", inv["traceability"]["statement"])
        print("[STEP 10-11 OK] Investigation combines streams honestly; confirms direct_join_exists=False")

        # 12. Reasoning layer generates hypotheses, not fake causal claims
        hyps = inv["root_cause_hypotheses"]
        self.assertTrue(len(hyps) >= 2)
        for h in hyps:
            self.assertIn(h["domain_relevance"], ["HIGH", "MODERATE", "LOW", "N/A"])
            self.assertIn(h["production_evidence"], ["STRONG", "MODERATE", "WEAK", "INSUFFICIENT"])
            self.assertIn("not established", h["conclusion"].lower())
        print(f"[STEP 12 OK] Generated {len(hyps)} domain-backed hypotheses without fake causal claims:")
        for h in hyps[:2]:
            print(f"       * {h['hypothesis']} [Domain: {h['domain_relevance']} | Prod: {h['production_evidence']}]")

    def test_step_13_simulation_supported_variables_only(self):
        # 13. Simulation works only for supported variables
        # Supported: Demand change (nearest historical match)
        req_sim1 = urllib.request.urlopen(f"{self.BASE}/api/simulate/demand?scenario_id=1&target_demand=15&model=model2")
        self.assertEqual(req_sim1.status, 200)
        sim1 = json.loads(req_sim1.read().decode("utf-8"))
        self.assertEqual(sim1["simulation_type"], "HISTORICAL_SCENARIO_MATCH")
        self.assertEqual(sim1["actual_demand_matched"], 15.0)

        # Supported: Deterministic bottleneck capacity improvement
        req_sim2 = urllib.request.urlopen(f"{self.BASE}/api/simulate/bottleneck?scenario_id=5&improvement_pct=15&model=model2")
        self.assertEqual(req_sim2.status, 200)
        sim2 = json.loads(req_sim2.read().decode("utf-8"))
        self.assertEqual(sim2["simulation_type"], "DETERMINISTIC_BOTTLENECK_CAPACITY")
        self.assertGreater(sim2["results"]["projected_throughput"], sim2["results"]["baseline_throughput"])

        # Unsupported: Querying arbitrary unmodeled variable rejects cleanly
        req_sim3 = urllib.request.urlopen(f"{self.BASE}/api/simulate/unsupported?parameter=ambient_humidity")
        self.assertEqual(req_sim3.status, 200)
        sim3 = json.loads(req_sim3.read().decode("utf-8"))
        self.assertEqual(sim3["status"], "UNSUPPORTED_BY_DATASET")
        self.assertFalse(sim3["supported"])
        print("[STEP 13 OK] Simulation operates strictly for supported variables and rejects unmodeled variables cleanly")

    def test_step_14_to_15_no_hardcoding_and_reproducibility(self):
        # 14. No values are hardcoded - values change between scenarios
        req1 = urllib.request.urlopen(f"{self.BASE}/api/production?scenario_id=1&model=model2")
        d1 = json.loads(req1.read().decode("utf-8"))
        req2 = urllib.request.urlopen(f"{self.BASE}/api/production?scenario_id=5&model=model2")
        d2 = json.loads(req2.read().decode("utf-8"))
        self.assertNotEqual(d1["analytics"]["throughput"], d2["analytics"]["throughput"])
        self.assertNotEqual(d1["bottleneck"]["severity"], d2["bottleneck"]["severity"])

        # 15. Refresh/restart produces reproducible results
        req1_again = urllib.request.urlopen(f"{self.BASE}/api/production?scenario_id=1&model=model2")
        d1_again = json.loads(req1_again.read().decode("utf-8"))
        self.assertEqual(d1["analytics"]["throughput"], d1_again["analytics"]["throughput"])
        print("[STEP 14-15 OK] Dynamic dataset values validated; reproducible results verified across calls")


if __name__ == "__main__":
    unittest.main()
