"""
Economic Analysis Engine
Adheres to strict truth-in-data principles:
- The organizer simulation dataset contains ONLY physical/operational discrete-event variables.
- Raw dataset inspection explicitly reports:
  "Economic impact unavailable: required cost variables were not supplied."
- When user-configurable assumptions are provided, the engine clearly delineates
  'Dataset-derived values' vs 'User-provided assumptions'.
"""

from typing import Dict, Any, Optional
from manufacturing_dataset import ProductionScenario


class EconomicService:
    def __init__(self):
        # The organizer dataset does not include cost/pricing telemetry
        self.dataset_has_economics = False

    def evaluate_scenario_economics(
        self,
        scenario: ProductionScenario,
        user_assumptions: Optional[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        """
        Evaluates economic impact for a production scenario.
        If user_assumptions is None or empty, returns official unavailable report.
        If user_assumptions is provided, computes advisory estimates clearly labeled as assumptions.
        """
        base_report = {
            "dataset_economic_data_available": False,
            "status": "UNAVAILABLE_FROM_DATASET",
            "official_message": "Economic impact unavailable: required cost variables were not supplied.",
            "missing_dataset_variables": [
                "unit_sales_price",
                "raw_material_cost",
                "direct_labor_rate",
                "machine_depreciation_hourly",
                "scrap_penalty_cost",
                "rework_labor_cost"
            ],
            "scenario_id": scenario.scenario_id,
            "operational_throughput_parts": scenario.total_parts,
            "operational_demand_gap": scenario.demand_gap,
            "assumptions_applied": False,
            "advisory_calculations": None
        }

        if not user_assumptions:
            return base_report

        # User assumptions provided
        unit_price = float(user_assumptions.get("unit_price", 120.0))
        unit_cost = float(user_assumptions.get("unit_material_cost", 40.0))
        scrap_cost = float(user_assumptions.get("scrap_cost_per_unit", 50.0))
        rework_cost = float(user_assumptions.get("rework_cost_per_unit", 20.0))
        hourly_downtime = float(user_assumptions.get("downtime_cost_per_hr", 450.0))

        # Output calculations
        gross_revenue = scenario.total_parts * unit_price
        material_cost_total = scenario.total_parts * unit_cost
        contribution_margin = gross_revenue - material_cost_total
        margin_pct = (contribution_margin / gross_revenue * 100.0) if gross_revenue > 0 else 0.0

        # Loss due to demand gap (lost sales volume)
        unit_contribution = unit_price - unit_cost
        lost_throughput_value = scenario.demand_gap * unit_contribution

        # Waiting time non-productive cost estimate
        total_waiting_hours = sum(st.waiting_time for st in scenario.stations) / 60.0
        waiting_delay_cost = total_waiting_hours * hourly_downtime

        base_report["assumptions_applied"] = True
        base_report["status"] = "USER_ASSUMPTIONS_MODE"
        base_report["user_assumptions"] = {
            "unit_price": unit_price,
            "unit_material_cost": unit_cost,
            "scrap_cost_per_unit": scrap_cost,
            "rework_cost_per_unit": rework_cost,
            "downtime_cost_per_hr": hourly_downtime
        }
        base_report["advisory_calculations"] = {
            "source_classification": "User-provided assumptions (not present in raw simulation dataset)",
            "estimated_gross_revenue": round(gross_revenue, 2),
            "estimated_material_cost": round(material_cost_total, 2),
            "estimated_contribution_margin": round(contribution_margin, 2),
            "margin_percentage": round(margin_pct, 2),
            "lost_throughput_opportunity_cost": round(lost_throughput_value, 2),
            "waiting_delay_idle_cost": round(waiting_delay_cost, 2),
            "disclaimer": "These figures are strictly advisory projections derived from operator-supplied parameters. The underlying simulation dataset does not contain audited accounting ledgers."
        }

        return base_report
