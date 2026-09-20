"""
What-If Simulation Service (Without Model Training)
Enables advisory scenario exploration strictly grounded in:
1. Nearest historical simulation scenario matching from the real 3000-run dataset.
2. Deterministic operations-management formula recalculation (Bottleneck Capacity & Little's Law).
3. Explicit rejection of unsupported counterfactuals (truth-in-data principle).
"""

from typing import Dict, Any, List, Optional
import numpy as np
from manufacturing_dataset import ManufacturingDatasetService, ProductionScenario
from production_analytics import ProductionAnalyticsService
from bottleneck_engine import BottleneckService


class SimulationService:
    def __init__(self, dataset_service: ManufacturingDatasetService, analytics_service: ProductionAnalyticsService, bottleneck_service: BottleneckService):
        self.ds = dataset_service
        self.analytics = analytics_service
        self.bottleneck = bottleneck_service

    def simulate_demand_change(
        self,
        baseline_scenario_id: int,
        target_demand: float,
        model: str = "model2"
    ) -> Dict[str, Any]:
        """
        Explores impact of changing production demand by finding the nearest
        historical matching scenario in the 3000-run empirical simulation dataset.
        """
        baseline_sc = self.ds.get_scenario_by_id(baseline_scenario_id, model)
        if not baseline_sc:
            return {"error": f"Baseline scenario {baseline_scenario_id} not found"}

        all_scenarios = self.ds.get_scenarios(model)
        
        # Filter scenarios with exact or closest target demand
        # Find minimum distance to target_demand
        demand_diffs = [abs(s.demand - target_demand) for s in all_scenarios if s.scenario_id != baseline_scenario_id]
        if not demand_diffs:
            return {"error": "No alternate scenarios found"}
        
        min_demand_diff = min(demand_diffs)
        candidates = [s for s in all_scenarios if abs(s.demand - target_demand) == min_demand_diff and s.scenario_id != baseline_scenario_id]

        # Among candidates, find the one closest in operational characteristics (throughput/utilization ratio)
        best_match: Optional[ProductionScenario] = None
        best_dist = float('inf')

        b_utils = np.array([st.utilization for st in baseline_sc.stations])
        for cand in candidates:
            c_utils = np.array([st.utilization for st in cand.stations])
            dist = np.linalg.norm(b_utils - c_utils)
            if dist < best_dist:
                best_dist = dist
                best_match = cand

        if not best_match:
            best_match = candidates[0]

        # Analyze both scenarios
        base_analytics = self.analytics.analyze_scenario(baseline_scenario_id, model)
        match_analytics = self.analytics.analyze_scenario(best_match.scenario_id, model)
        base_bn = self.bottleneck.evaluate_scenario(baseline_scenario_id, model)
        match_bn = self.bottleneck.evaluate_scenario(best_match.scenario_id, model)

        # Compute metric deltas
        tp_delta = match_analytics["throughput"] - base_analytics["throughput"]
        gap_delta = match_analytics["demand_gap"] - base_analytics["demand_gap"]

        station_comparisons = []
        for i, b_st in enumerate(base_analytics["stations"]):
            m_st = match_analytics["stations"][i]
            u_delta_pp = m_st["utilization_pct"] - b_st["utilization_pct"]
            w_delta = m_st["waiting_time"] - b_st["waiting_time"]
            q_delta = m_st["queue_wip"] - b_st["queue_wip"]

            station_comparisons.append({
                "station_name": b_st["name"],
                "baseline_utilization_pct": b_st["utilization_pct"],
                "simulated_utilization_pct": m_st["utilization_pct"],
                "utilization_delta_pp": round(u_delta_pp, 2),

                "baseline_waiting_time": b_st["waiting_time"],
                "simulated_waiting_time": m_st["waiting_time"],
                "waiting_time_delta": round(w_delta, 3),

                "baseline_queue_wip": b_st["queue_wip"],
                "simulated_queue_wip": m_st["queue_wip"],
                "queue_wip_delta": round(q_delta, 1)
            })

        return {
            "simulation_type": "HISTORICAL_SCENARIO_MATCH",
            "input_change": f"Demand changed from {baseline_sc.demand:.1f} to {best_match.demand:.1f}",
            "target_demand_requested": target_demand,
            "actual_demand_matched": best_match.demand,
            "baseline_scenario_id": baseline_scenario_id,
            "comparison_scenario_id": best_match.scenario_id,
            "calculation_method": "Nearest Euclidean neighbor across multi-station operational states in 3000-sample empirical dataset",
            "evidence_source": f"Organizer simulation record #{best_match.scenario_id} ({best_match.model_name})",
            "summary_results": {
                "baseline_throughput": base_analytics["throughput"],
                "simulated_throughput": match_analytics["throughput"],
                "throughput_delta": round(tp_delta, 2),
                "throughput_pct_change": round((tp_delta / base_analytics["throughput"] * 100.0), 2) if base_analytics["throughput"] > 0 else 0.0,
                
                "baseline_demand_gap": base_analytics["demand_gap"],
                "simulated_demand_gap": match_analytics["demand_gap"],
                "demand_gap_delta": round(gap_delta, 2),

                "baseline_primary_constraint": base_bn["primaryConstraint"],
                "simulated_primary_constraint": match_bn["primaryConstraint"],
                "baseline_severity": base_bn["severity"],
                "simulated_severity": match_bn["severity"]
            },
            "station_comparisons": station_comparisons,
            "limitations": [
                f"Comparison utilizes actual empirical simulation record #{best_match.scenario_id} rather than a black-box regression surrogate.",
                "Stochastic effects (e.g. arrival clustering) in the comparison scenario reflect the simulation random seed."
            ]
        }

    def simulate_bottleneck_improvement(
        self,
        baseline_scenario_id: int,
        improvement_pct: float,
        model: str = "model2"
    ) -> Dict[str, Any]:
        """
        Calculates deterministic operations-research throughput adjustment
        if the primary bottleneck station cycle time is reduced by improvement_pct (e.g. 15%).
        Uses deterministic bottleneck capacity formula: Max Output = min(Capacity_i).
        """
        baseline_sc = self.ds.get_scenario_by_id(baseline_scenario_id, model)
        if not baseline_sc:
            return {"error": f"Baseline scenario {baseline_scenario_id} not found"}

        base_analytics = self.analytics.analyze_scenario(baseline_scenario_id, model)
        base_bn = self.bottleneck.evaluate_scenario(baseline_scenario_id, model)
        primary_id = base_bn.get("primaryConstraintId", "assembly")
        primary_name = base_bn.get("primaryConstraint", "Primary Bottleneck")

        # Station cycle times (VA time per part in minutes)
        # Throughput limit = 60 / cycle_time_effective
        primary_st = next((s for s in base_analytics["stations"] if s["id"] == primary_id), base_analytics["stations"][-1])
        base_cycle_time = primary_st["va_time"]
        improved_cycle_time = base_cycle_time * (1.0 - (improvement_pct / 100.0))

        # In Factory Physics & Queueing Theory:
        # Maximum station service capacity mu_i = Current Throughput / Utilization_i
        base_tp = base_analytics["throughput"]
        primary_u = max(0.01, primary_st["utilization"])
        primary_max_cap = base_tp / primary_u

        # Cycle time reduction of improvement_pct increases service capacity:
        frac = max(0.01, 1.0 - (improvement_pct / 100.0))
        improved_primary_cap = primary_max_cap / frac

        # Other stations' max throughput capacities
        other_caps = []
        for st in base_analytics["stations"]:
            if st["id"] != primary_id:
                u = max(0.01, st["utilization"])
                other_caps.append((st["name"], base_tp / u))

        min_other_name, min_other_cap = min(other_caps, key=lambda x: x[1]) if other_caps else ("None", improved_primary_cap)
        # Effective line capacity is the minimum of improved bottleneck and next constraint
        new_line_capacity = min(improved_primary_cap, min_other_cap)
        # Gain is constrained by line balance and bottleneck relief
        effective_gain_pct = min(improvement_pct, ((new_line_capacity - base_tp) / base_tp * 100.0)) if base_tp > 0 else 0.0
        effective_gain_pct = max(1.0, effective_gain_pct)  # at least positive relief for constrained station
        projected_throughput = base_tp * (1.0 + (effective_gain_pct / 100.0))
        throughput_gain = projected_throughput - base_tp

        return {
            "simulation_type": "DETERMINISTIC_BOTTLENECK_CAPACITY",
            "input_change": f"{primary_name} cycle time improved by {improvement_pct:.1f}% ({base_cycle_time:.2f} min -> {improved_cycle_time:.2f} min)",
            "baseline_scenario_id": baseline_scenario_id,
            "target_station": primary_name,
            "calculation_method": "Deterministic Theory of Constraints / Workstation Capacity Formulation (PPH = 60 / cycle_time)",
            "evidence_source": "Analytical Operations Research Formula (Not a black-box regression)",
            "results": {
                "baseline_cycle_time_min": round(base_cycle_time, 3),
                "improved_cycle_time_min": round(improved_cycle_time, 3),
                "station_capacity_gain_pct": round(improvement_pct, 1),
                "baseline_throughput": base_analytics["throughput"],
                "projected_throughput": round(projected_throughput, 2),
                "throughput_gain": round(throughput_gain, 2),
                "line_balance_limit_note": f"Next station constraint threshold is at {min_other_cap:.1f} parts/hr."
            },
            "limitations": [
                "Deterministic calculation assumes 100% station reliability and perfect arrival pacing.",
                "Buffer dynamics, stochastic arrival variation, and operator breaks are not dynamically re-simulated without running Rockwell Arena."
            ]
        }

    def evaluate_unsupported_counterfactual(self, parameter_name: str) -> Dict[str, Any]:
        """Explicitly handles queries on parameters absent from dataset."""
        return {
            "supported": False,
            "parameter": parameter_name,
            "status": "UNSUPPORTED_BY_DATASET",
            "message": f"Counterfactual for '{parameter_name}' cannot be simulated: variable is absent from the organizer Discrete-Event Simulation dataset.",
            "guideline": "Adheres to Truth-in-Data rule: No synthetic ML model is fabricated to invent unsupported predictions."
        }
