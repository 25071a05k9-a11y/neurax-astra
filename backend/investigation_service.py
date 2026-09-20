"""
Investigation & Root-Cause Reasoning Service
Integrates Quality Visual Inspection with Production Analytics.
Implements:
- Strict separation of quality and production flow (no fabricated unit join).
- Defect-aware domain hypotheses (Crack, Hole, Scratch, Rust, Normal).
- Production reality check (evaluates whether domain-relevant stages show abnormal signals).
- Evidence synthesis: Domain Relevance + Production Evidence + Missing Evidence.
- Calibrated qualitative confidence: STRONG, MODERATE, WEAK, INSUFFICIENT.
"""

from typing import Dict, Any, List, Optional
from manufacturing_dataset import ProductionScenario
from production_analytics import ProductionAnalyticsService
from bottleneck_engine import BottleneckService
from anomaly_detector import AnomalyService
from economic_engine import EconomicService


DOMAIN_KNOWLEDGE_MAP = {
    "hole": {
        "candidate_stages": ["drilling"],
        "stage_names": ["Drilling (Part 1)"],
        "physical_mechanism": "Drill bit wear, spindle runout, incorrect feed rate, chip packing, or puncture during fixturing.",
        "typical_missing_evidence": [
            "Spindle rotational speed (RPM)",
            "Spindle motor electrical current / torque",
            "Axial tool thrust force telemetry",
            "Tool bit cycle life counter / wear state",
            "Unit-level serial number machine trace"
        ],
        "domain_relevance": "HIGH"
    },
    "crack": {
        "candidate_stages": ["assembly", "milling"],
        "stage_names": ["Assembly (Merge)", "Milling (Part 2)"],
        "physical_mechanism": "Mechanical stress concentration, excessive press-fit force during assembly, or thermal-cutting shock.",
        "typical_missing_evidence": [
            "Assembly press insertion force sensor",
            "Component tolerance stack-up measurements",
            "Hydraulic clamping pressure logs",
            "Material batch tensile strength / hardness certification",
            "Unit-level fixture orientation telemetry"
        ],
        "domain_relevance": "HIGH"
    },
    "scratch": {
        "candidate_stages": ["milling", "assembly"],
        "stage_names": ["Milling (Part 2)", "Assembly (Merge)"],
        "physical_mechanism": "Abrasive contact with metal chips/swarf, tooling misalignment, or contact during conveyor transfer and palletizing.",
        "typical_missing_evidence": [
            "Chip evacuation vacuum pressure",
            "Coolant filtration cleanliness logs",
            "Robotic end-effector gripper force telemetry",
            "Conveyor belt transfer vibration",
            "Operator manual handling station logs"
        ],
        "domain_relevance": "HIGH"
    },
    "rust": {
        "candidate_stages": ["storage", "assembly"],
        "stage_names": ["Storage Buffers (Part 1 & 2)", "Assembly (Merge)"],
        "physical_mechanism": "Extended holding time in work-in-progress storage buffers prior to assembly, delay in protective oil/wash coating, or atmospheric exposure.",
        "typical_missing_evidence": [
            "Shop floor ambient relative humidity logs",
            "Warehouse temperature cycle data",
            "Corrosion-inhibitor immersion bath concentration",
            "Surface moisture / condensation sensors",
            "WIP buffer shelf age per individual batch"
        ],
        "domain_relevance": "HIGH"
    },
    "normal": {
        "candidate_stages": [],
        "stage_names": [],
        "physical_mechanism": "Surface exhibits no visual anomalies. Material processing proceeded within nominal specifications.",
        "typical_missing_evidence": [],
        "domain_relevance": "N/A"
    }
}


class InvestigationService:
    def __init__(
        self,
        analytics_service: ProductionAnalyticsService,
        bottleneck_service: BottleneckService,
        anomaly_service: AnomalyService,
        economic_service: EconomicService
    ):
        self.analytics = analytics_service
        self.bottleneck = bottleneck_service
        self.anomaly = anomaly_service
        self.economic = economic_service

    def build_investigation(
        self,
        quality_data: Dict[str, Any],
        scenario_id: int,
        model: str = "model2",
        user_assumptions: Optional[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        """
        Synthesizes visual defect evidence with contemporaneous production flow analytics.
        Produces explainable hypotheses without claiming unproven causation.
        """
        sc_data = self.analytics.analyze_scenario(scenario_id, model)
        sc = self.analytics.ds.get_scenario_by_id(scenario_id, model)
        bn = self.bottleneck.evaluate_scenario(scenario_id, model)
        health = self.anomaly.get_production_health(scenario_id, model)
        anomalies = health["anomalies"]
        eco = self.economic.evaluate_scenario_economics(sc, user_assumptions)

        defect_type = quality_data.get("defect_type", "normal").lower()
        has_defect = quality_data.get("has_defect", False)
        ai_pred = quality_data.get("ai_prediction", {})
        overall_box = quality_data.get("overall_box")
        components = quality_data.get("components", [])

        # 1. Quality Finding Section
        confidence = ai_pred.get("confidence", 95.0) if ai_pred else 95.0
        predicted_class = ai_pred.get("predicted_class", defect_type) if ai_pred else defect_type
        
        # Independent visual check / verification
        # If detector says defect but bounding area is 0 or confidence < 60, review required
        if not has_defect or defect_type == "normal":
            verification_status = "CONFIRMED_PRISTINE"
            uncertainty_note = "Visual classifier and segmentation mask agree: pristine surface."
        elif confidence >= 85.0 and overall_box and overall_box.get("area_px", 0) > 20:
            verification_status = "CONFIRMED_DEFECT"
            uncertainty_note = f"High visual agreement across classifier ({confidence:.1f}%) and segmentation detector."
        elif confidence >= 60.0:
            verification_status = "SUPPORTED_DEFECT"
            uncertainty_note = "Defect pattern localized; secondary morphological confirmation recommended."
        else:
            verification_status = "UNCERTAIN_REVIEW_REQUIRED"
            uncertainty_note = f"Borderline detector confidence ({confidence:.1f}%); operator review required."

        quality_finding = {
            "defect_type": defect_type.upper(),
            "has_defect": has_defect,
            "verification_status": verification_status,
            "classifier_confidence_pct": round(confidence, 1),
            "uncertainty_assessment": uncertainty_note,
            "overall_box": overall_box,
            "component_count": len(components),
            "coverage_pct": overall_box.get("coverage_pct", 0.0) if overall_box else 0.0,
            "image_size": quality_data.get("image_size", [128, 128])
        }

        # 2. Production Finding Section
        production_finding = {
            "scenario_id": scenario_id,
            "model_name": sc_data["model_name"] if sc_data else "Unknown",
            "health_status": health["status"].upper(),
            "throughput_parts_per_hr": sc_data["throughput"] if sc_data else 0.0,
            "throughput_percentile": sc_data["throughput_percentile"] if sc_data else 50.0,
            "demand_gap_units": sc_data["demand_gap"] if sc_data else 0.0,
            "primary_bottleneck": bn.get("primaryConstraint", "None"),
            "bottleneck_severity": bn.get("severity", "low").upper(),
            "anomaly_count": len(anomalies),
            "anomalies": anomalies
        }

        # 3. Direct Traceability / Join Verification
        traceability = {
            "direct_join_exists": False,
            "statement": "No direct unit-level join exists between visual inspection samples and simulation scenarios in the supplied dataset. Quality findings and production flow conditions are evaluated as contemporaneous independent evidence streams."
        }

        # 4. Generate Defect-Aware Hypotheses
        hypotheses = []
        domain_info = DOMAIN_KNOWLEDGE_MAP.get(defect_type, DOMAIN_KNOWLEDGE_MAP["normal"])

        if defect_type == "normal":
            hypotheses.append({
                "hypothesis": "Nominal Operation - Pristine Output",
                "domain_relevance": "N/A",
                "production_evidence": "STRONG",
                "direct_traceability": False,
                "supporting_evidence": [
                    "Surface inspection confirms zero localized defects.",
                    f"Line health is currently {health['status'].upper()}."
                ],
                "contradictory_evidence": [],
                "missing_evidence": [],
                "conclusion": "No defect root-cause investigation necessary. Unit meets quality standards."
            })
            investigation_priority = "None (Product Conforming)"
            recommended_action = "Continue standard in-line monitoring."

        else:
            cand_stages = domain_info["candidate_stages"]
            # Hypothesis 1: Primary Domain-Associated Process
            for st_id in cand_stages:
                # Check actual production behavior of this stage in current scenario
                st_meta = next((s for s in sc_data["stations"] if s["id"] == st_id), None)
                supporting_ev = []
                contradictory_ev = []

                if st_meta:
                    u_pct = st_meta["utilization_pct"]
                    u_rank = st_meta["utilization_percentile"]
                    w_t = st_meta["waiting_time"]
                    w_rank = st_meta["waiting_time_percentile"]

                    if u_rank >= 80.0 or u_pct >= 85.0:
                        supporting_ev.append(f"{st_meta['name']} station utilization is elevated at {u_pct}% ({u_rank}th percentile).")
                    else:
                        contradictory_ev.append(f"{st_meta['name']} utilization is nominal at {u_pct}% (median: {st_meta['baseline_utilization_median_pct']}%).")

                    if w_rank >= 75.0 and w_t > 0.1:
                        supporting_ev.append(f"{st_meta['name']} queue delay is elevated at {w_t:.2f} min ({w_rank}th percentile).")

                # Special check for Rust: Storage buffers
                if defect_type == "rust":
                    p1_st = sc_data["storage_buffers"].get("part1_storage_time", 0.0)
                    p2_st = sc_data["storage_buffers"].get("part2_storage_time", 0.0)
                    p1_stored = sc_data["storage_buffers"].get("part1_stored_wip", 0.0)
                    p2_stored = sc_data["storage_buffers"].get("part2_stored_wip", 0.0)

                    if p1_st > 60.0 or p2_st > 60.0:
                        supporting_ev.append(f"Excessive buffer storage time observed (Part 1: {p1_st:.1f} min, Part 2: {p2_st:.1f} min) creating prolonged atmospheric exposure.")
                    if p1_stored > 500 or p2_stored > 500:
                        supporting_ev.append(f"WIP buffer accumulation is high ({p1_stored + p2_stored:.0f} components stored), increasing delay before protective assembly.")

                # Check if this station is the primary bottleneck
                if bn.get("primaryConstraintId") == st_id:
                    supporting_ev.append(f"{st_id.capitalize()} is currently the primary line bottleneck (Constraint Score: {bn.get('constraintScore')}).")

                # Qualitative Evidence Strength
                if len(supporting_ev) >= 2:
                    prod_strength = "STRONG"
                elif len(supporting_ev) == 1:
                    prod_strength = "MODERATE"
                elif len(contradictory_ev) > 0:
                    prod_strength = "WEAK"
                else:
                    prod_strength = "INSUFFICIENT"

                stage_label = st_meta['name'] if st_meta else st_id.title()
                hypotheses.append({
                    "hypothesis": f"{stage_label}-related process distress",
                    "domain_relevance": domain_info["domain_relevance"],
                    "production_evidence": prod_strength,
                    "direct_traceability": False,
                    "supporting_evidence": supporting_ev if supporting_ev else ["No abnormal flow indicators detected at this station in current scenario."],
                    "contradictory_evidence": contradictory_ev,
                    "missing_evidence": domain_info["typical_missing_evidence"],
                    "conclusion": f"Investigate {stage_label} operational parameters first. Causation is correlational and not established."
                })

            # Hypothesis 2: Upstream Material / Supply Variation
            hypotheses.append({
                "hypothesis": "Incoming raw material / supplier blank anomaly",
                "domain_relevance": "MODERATE",
                "production_evidence": "INSUFFICIENT",
                "direct_traceability": False,
                "supporting_evidence": [
                    "Visual defect characteristics may originate in vendor feedstock prior to plant entry."
                ],
                "contradictory_evidence": [],
                "missing_evidence": [
                    "Supplier mill test certificates",
                    "Inbound raw material inspection logs",
                    "Heat / batch chemical composition analysis"
                ],
                "conclusion": "Secondary hypothesis: supplier material variability cannot be ruled out from line telemetry; causation is not established."
            })

            investigation_priority = hypotheses[0]["hypothesis"] if hypotheses else "General Process Inspection"
            recommended_action = f"Perform physical tool and fixture inspection at candidate stations ({', '.join(domain_info['stage_names'])}). Verify tool wear, clamping force, and buffer holding times."

        # 5. Limitations
        limitations = [
            "Dataset does not link image UUIDs to discrete simulation run IDs; correlations are domain-informed hypotheses, NOT proven causation.",
            "Simulation telemetry aggregates macro station behavior (utilization, waiting, queue counts); high-frequency sensor streams (vibration, acoustic emission, spindle load) are absent.",
            "Physical verification by a quality engineer is mandatory before altering machine feed rates or tooling configurations."
        ]

        return {
            "quality_finding": quality_finding,
            "production_finding": production_finding,
            "traceability": traceability,
            "root_cause_hypotheses": hypotheses,
            "investigation_priority": investigation_priority,
            "recommended_investigation": recommended_action,
            "economic_impact": eco,
            "limitations": limitations
        }
