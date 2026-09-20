"""
Production Analytics Service
Calculates deterministic production metrics for scenarios and precomputes
dataset baseline distributions (min, max, mean, median, percentiles, IQR, std).
Supports both Model 1 and Model 2 schemas.
"""

from typing import List, Dict, Any, Optional
import numpy as np
from manufacturing_dataset import ManufacturingDatasetService, ProductionScenario, StationMetrics


class ProductionAnalyticsService:
    def __init__(self, dataset_service: ManufacturingDatasetService):
        self.ds = dataset_service
        self.baselines_model1 = self._compute_baselines(self.ds.get_scenarios("model1"))
        self.baselines_model2 = self._compute_baselines(self.ds.get_scenarios("model2"))

    def _compute_baselines(self, scenarios: List[ProductionScenario]) -> Dict[str, Any]:
        """Computes distribution statistics across all scenarios in a dataset."""
        if not scenarios:
            return {}

        metrics_pool: Dict[str, List[float]] = {
            "demand": [],
            "throughput": [],
            "total_parts": [],
            "demand_gap": [],
            "va_time_total": [],
            "capacity_imbalance": []
        }

        # Dynamically discover station names
        station_ids = [st.id for st in scenarios[0].stations]
        for sid in station_ids:
            metrics_pool[f"{sid}_utilization"] = []
            metrics_pool[f"{sid}_waiting_time"] = []
            metrics_pool[f"{sid}_queue_wip"] = []

        # Buffers if present
        for k in scenarios[0].storage_buffers.keys():
            metrics_pool[k] = []

        for sc in scenarios:
            metrics_pool["demand"].append(sc.demand)
            metrics_pool["throughput"].append(sc.throughput)
            metrics_pool["total_parts"].append(sc.total_parts)
            metrics_pool["demand_gap"].append(sc.demand_gap)
            metrics_pool["va_time_total"].append(sc.va_time_total)

            utils = [st.utilization for st in sc.stations]
            # Imbalance = max utilization - min utilization (spread)
            imbalance = max(utils) - min(utils) if utils else 0.0
            metrics_pool["capacity_imbalance"].append(imbalance)

            for st in sc.stations:
                metrics_pool[f"{st.id}_utilization"].append(st.utilization)
                metrics_pool[f"{st.id}_waiting_time"].append(st.waiting_time)
                metrics_pool[f"{st.id}_queue_wip"].append(st.queue_wip)

            for k, v in sc.storage_buffers.items():
                metrics_pool[k].append(v)

        baselines: Dict[str, Dict[str, float]] = {}
        for k, vals in metrics_pool.items():
            arr = np.array(vals, dtype=np.float64)
            if len(arr) == 0:
                continue
            q25 = float(np.percentile(arr, 25))
            q75 = float(np.percentile(arr, 75))
            baselines[k] = {
                "min": float(arr.min()),
                "max": float(arr.max()),
                "mean": float(arr.mean()),
                "std": float(arr.std()),
                "median": float(np.median(arr)),
                "p10": float(np.percentile(arr, 10)),
                "p25": q25,
                "p75": q75,
                "p90": float(np.percentile(arr, 90)),
                "p95": float(np.percentile(arr, 95)),
                "p99": float(np.percentile(arr, 99)),
                "iqr": float(q75 - q25)
            }

        return baselines

    def get_baseline(self, model: str = "model2") -> Dict[str, Any]:
        return self.baselines_model1 if model.lower() == "model1" else self.baselines_model2

    def analyze_scenario(self, scenario_id: int, model: str = "model2") -> Optional[Dict[str, Any]]:
        """
        Produces complete deterministic analytics for a given scenario,
        including absolute deviations from dataset median and percentiles.
        """
        sc = self.ds.get_scenario_by_id(scenario_id, model)
        if not sc:
            return None

        baseline = self.get_baseline(model)
        
        # Station analysis
        stations_analysis = []
        utils = [st.utilization for st in sc.stations]
        imbalance = max(utils) - min(utils) if utils else 0.0

        for st in sc.stations:
            util_base = baseline.get(f"{st.id}_utilization", {})
            wait_base = baseline.get(f"{st.id}_waiting_time", {})
            queue_base = baseline.get(f"{st.id}_queue_wip", {})

            util_med = util_base.get("median", 0.0)
            wait_med = wait_base.get("median", 0.0)
            queue_med = queue_base.get("median", 0.0)

            # Compute percentiles for this scenario's values
            # Percentile rank = % of historical values <= current value
            util_rank = self._calculate_percentile_rank(f"{st.id}_utilization", st.utilization, model)
            wait_rank = self._calculate_percentile_rank(f"{st.id}_waiting_time", st.waiting_time, model)
            queue_rank = self._calculate_percentile_rank(f"{st.id}_queue_wip", st.queue_wip, model)

            stations_analysis.append({
                "id": st.id,
                "name": st.name,
                "utilization": round(st.utilization, 4),
                "utilization_pct": round(st.utilization * 100.0, 2),
                "baseline_utilization_median_pct": round(util_med * 100.0, 2),
                "utilization_deviation_pp": round((st.utilization - util_med) * 100.0, 2),
                "utilization_percentile": round(util_rank, 1),
                
                "waiting_time": round(st.waiting_time, 4),
                "baseline_waiting_median": round(wait_med, 4),
                "waiting_time_deviation": round(st.waiting_time - wait_med, 4),
                "waiting_time_percentile": round(wait_rank, 1),

                "queue_wip": round(st.queue_wip, 1),
                "baseline_queue_median": round(queue_med, 1),
                "queue_deviation": round(st.queue_wip - queue_med, 1),
                "queue_percentile": round(queue_rank, 1),

                "va_time": round(st.va_time, 4),
                "production_count": st.production_count,
                "storage_time": round(st.storage_time, 4) if st.storage_time is not None else None
            })

        # Value added vs Non-value added time
        total_waiting_time = sum(st.waiting_time for st in sc.stations)
        total_storage_time = sum(sc.storage_buffers.get(k, 0.0) for k in sc.storage_buffers if "storage_time" in k)
        nva_time = total_waiting_time + total_storage_time

        imbalance_base = baseline.get("capacity_imbalance", {})
        imb_med = imbalance_base.get("median", 0.0)
        imb_rank = self._calculate_percentile_rank("capacity_imbalance", imbalance, model)

        # Throughput vs demand
        tp_base = baseline.get("throughput", {})
        tp_med = tp_base.get("median", 0.0)
        tp_rank = self._calculate_percentile_rank("throughput", sc.throughput, model)

        return {
            "scenario_id": sc.scenario_id,
            "model_name": sc.model_name,
            "demand": sc.demand,
            "throughput": round(sc.throughput, 2),
            "throughput_baseline_median": round(tp_med, 2),
            "throughput_deviation": round(sc.throughput - tp_med, 2),
            "throughput_percentile": round(tp_rank, 1),
            "total_parts": sc.total_parts,
            "demand_gap": round(sc.demand_gap, 2),
            "stations": stations_analysis,
            "time_breakdown": {
                "value_added_time": round(sc.va_time_total, 4),
                "non_value_added_time": round(nva_time, 4),
                "waiting_time_total": round(total_waiting_time, 4),
                "storage_time_total": round(total_storage_time, 4),
                "transportation_time": "Not available from supplied dataset (transport telemetry not captured in simulation export)"
            },
            "capacity_imbalance": {
                "spread": round(imbalance, 4),
                "spread_pct": round(imbalance * 100.0, 2),
                "baseline_median_pct": round(imb_med * 100.0, 2),
                "deviation_pp": round((imbalance - imb_med) * 100.0, 2),
                "percentile": round(imb_rank, 1)
            },
            "storage_buffers": sc.storage_buffers,
            "raw": sc.raw
        }

    def _calculate_percentile_rank(self, metric: str, value: float, model: str) -> float:
        """Calculates exact percentile rank of a value against the historical dataset distribution."""
        scenarios = self.ds.get_scenarios(model)
        if not scenarios:
            return 50.0

        all_vals = []
        if metric == "demand":
            all_vals = [s.demand for s in scenarios]
        elif metric == "throughput":
            all_vals = [s.throughput for s in scenarios]
        elif metric == "capacity_imbalance":
            all_vals = [max(st.utilization for st in s.stations) - min(st.utilization for st in s.stations) for s in scenarios]
        elif "_utilization" in metric:
            sid = metric.replace("_utilization", "")
            for s in scenarios:
                for st in s.stations:
                    if st.id == sid:
                        all_vals.append(st.utilization)
        elif "_waiting_time" in metric:
            sid = metric.replace("_waiting_time", "")
            for s in scenarios:
                for st in s.stations:
                    if st.id == sid:
                        all_vals.append(st.waiting_time)
        elif "_queue_wip" in metric:
            sid = metric.replace("_queue_wip", "")
            for s in scenarios:
                for st in s.stations:
                    if st.id == sid:
                        all_vals.append(st.queue_wip)
        else:
            return 50.0

        if not all_vals:
            return 50.0
        arr = np.array(all_vals)
        rank = (np.count_nonzero(arr <= value) / len(arr)) * 100.0
        return float(rank)
