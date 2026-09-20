"""
Bottleneck Analysis Engine
Deterministic, multi-factor production constraint analysis.
Combines:
- Station utilization (relative to dataset distribution)
- Station waiting time / queue delay
- Upstream WIP buffer accumulation (storage queues)
- Downstream spare capacity (starvation vs blocking)
- Throughput restriction / demand gap

Transparently generates explainable evidence and derived severity levels.
"""

from typing import Dict, Any, List, Optional
from manufacturing_dataset import ProductionScenario
from production_analytics import ProductionAnalyticsService


class BottleneckService:
    def __init__(self, analytics_service: ProductionAnalyticsService):
        self.analytics = analytics_service

    def evaluate_scenario(self, scenario_id: int, model: str = "model2") -> Dict[str, Any]:
        """
        Evaluates the production constraint profile for a given scenario.
        Returns primary constraint, secondary constraints, evidence, severity, and limitations.
        """
        sc_data = self.analytics.analyze_scenario(scenario_id, model)
        if not sc_data:
            return {
                "error": f"Scenario {scenario_id} not found"
            }

        stations = sc_data["stations"]
        if not stations:
            return {"error": "No station data available in scenario"}

        baseline = self.analytics.get_baseline(model)
        demand = sc_data["demand"]
        demand_gap = sc_data["demand_gap"]

        # 1. Multi-factor constraint scoring per station
        scored_stations = []
        for i, st in enumerate(stations):
            score = 0.0
            reasons = []

            u = st["utilization"]
            u_pct = st["utilization_pct"]
            u_pctl = st["utilization_percentile"]
            w_pctl = st["waiting_time_percentile"]
            q_pctl = st["queue_percentile"]
            wait_t = st["waiting_time"]
            wip = st["queue_wip"]

            # Factor A: Utilization severity (0 to 40 points)
            # Calibrated to dataset distribution:
            if u_pctl >= 95.0 or u >= 0.95:
                score += 40.0
                reasons.append(f"Station utilization is critically elevated at {u_pct}% ({u_pctl}th dataset percentile).")
            elif u_pctl >= 80.0 or u >= 0.85:
                score += 28.0
                reasons.append(f"Station utilization is high at {u_pct}% ({u_pctl}th dataset percentile).")
            elif u_pctl >= 60.0 or u >= 0.70:
                score += 15.0
                reasons.append(f"Station utilization is moderately loaded at {u_pct}%.")
            else:
                score += max(0.0, u * 15.0)

            # Factor B: Waiting time delay (0 to 25 points)
            if w_pctl >= 95.0:
                score += 25.0
                reasons.append(f"Waiting time ({wait_t:.2f} min) is in the 95th+ percentile (+{st['waiting_time_deviation']:.2f} vs median).")
            elif w_pctl >= 75.0:
                score += 16.0
                reasons.append(f"Waiting time ({wait_t:.2f} min) is above the 75th percentile.")
            elif w_pctl >= 50.0:
                score += 8.0

            # Factor C: WIP / Queue accumulation (0 to 25 points)
            if q_pctl >= 90.0 and wip > 10.0:
                score += 25.0
                reasons.append(f"Upstream WIP accumulation is severe: {wip:.0f} parts waiting ({q_pctl}th percentile).")
            elif q_pctl >= 75.0 and wip > 5.0:
                score += 15.0
                reasons.append(f"Upstream queue has accumulated {wip:.0f} parts ({q_pctl}th percentile).")
            elif wip > 0:
                score += 5.0

            # Factor D: Downstream / Upstream interaction (0 to 10 points)
            # If this is Assembly, check if upstream buffers are flooded (downstream bottleneck)
            if st["id"] == "assembly":
                p1_stored = sc_data["storage_buffers"].get("part1_stored_wip", 0.0)
                p2_stored = sc_data["storage_buffers"].get("part2_stored_wip", 0.0)
                tot_stored = p1_stored + p2_stored
                if tot_stored > 500:
                    score += 10.0
                    reasons.append(f"Downstream bottleneck confirmed: upstream storage buffers contain {tot_stored:.0f} completed components blocked before assembly.")
            elif st["id"] in ["drilling", "milling"]:
                # Check downstream starvation: if this station is saturated while Assembly has spare capacity
                assy_st = next((s for s in stations if s["id"] == "assembly"), None)
                if assy_st and u >= 0.85 and assy_st["utilization"] < 0.60:
                    score += 10.0
                    reasons.append(f"Feeding station constraint: downstream Assembly has {round((1.0 - assy_st['utilization']) * 100, 1)}% spare capacity due to starvation.")

            scored_stations.append({
                "id": st["id"],
                "name": st["name"],
                "utilization": u,
                "utilization_pct": u_pct,
                "utilization_percentile": u_pctl,
                "waiting_time": wait_t,
                "waiting_time_percentile": w_pctl,
                "queue_wip": wip,
                "score": round(score, 1),
                "reasons": reasons
            })

        # Sort by constraint score descending
        scored_stations.sort(key=lambda x: x["score"], reverse=True)
        primary = scored_stations[0]

        # Secondary constraints: any station with score >= 40.0 or utilization >= 80% that is not primary
        secondary = [
            s["name"] for s in scored_stations[1:]
            if s["score"] >= 35.0 or s["utilization"] >= 0.80
        ]

        # Determine severity using transparent thresholds
        # Critical: primary score >= 65 and (util >= 0.90 or queue_wip in p90+)
        # High: score >= 45 or util >= 0.80
        # Moderate: score >= 25
        # Low: score < 25
        p_u = primary["utilization"]
        p_score = primary["score"]

        if p_score >= 65.0 or (p_u >= 0.95 and primary["waiting_time_percentile"] >= 80.0):
            severity = "critical"
        elif p_score >= 45.0 or p_u >= 0.85:
            severity = "high"
        elif p_score >= 25.0 or p_u >= 0.70:
            severity = "moderate"
        else:
            severity = "low"

        # Construct explainable evidence list
        evidence = list(primary["reasons"])
        if demand_gap > 0.0:
            evidence.append(f"Production restriction: line throughput gap of {demand_gap:.1f} units vs input arrivals.")

        # Limitations
        limitations = [
            "Bottleneck classification is deterministic based on discrete-event simulation run statistics.",
            "Station cycle times and queues represent run-level aggregates rather than second-by-second PLC machine signals.",
            "Tool degradation, operator shift fatigue, and unplanned electrical downtime are unmodeled in this simulation scenario."
        ]

        return {
            "scenario_id": scenario_id,
            "primaryConstraint": primary["name"],
            "primaryConstraintId": primary["id"],
            "constraintScore": primary["score"],
            "secondaryConstraints": secondary,
            "severity": severity,
            "evidence": evidence,
            "allStationScores": [
                {
                    "name": s["name"],
                    "id": s["id"],
                    "score": s["score"],
                    "utilization_pct": s["utilization_pct"],
                    "waiting_time": s["waiting_time"],
                    "queue_wip": s["queue_wip"]
                }
                for s in scored_stations
            ],
            "limitations": limitations
        }
