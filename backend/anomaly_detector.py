"""
Anomaly Detector & Production Health Service
Distribution-based statistical anomaly detection (IQR, Percentiles, Z-scores).
Calculates system-wide Production Health Summary:
status: 'healthy' | 'warning' | 'degraded' | 'critical'
based on measurable metrics and historical dataset baselines.
"""

from typing import Dict, Any, List, Optional
import numpy as np
from production_analytics import ProductionAnalyticsService
from bottleneck_engine import BottleneckService


class AnomalyService:
    def __init__(self, analytics_service: ProductionAnalyticsService, bottleneck_service: BottleneckService):
        self.analytics = analytics_service
        self.bottleneck = bottleneck_service

    def detect_anomalies(self, scenario_id: int, model: str = "model2") -> List[Dict[str, Any]]:
        """
        Evaluates a scenario against the historical baseline using IQR, percentiles, and z-score.
        Detects utilization spikes, waiting time anomalies, WIP surges, and throughput deficits.
        """
        sc_data = self.analytics.analyze_scenario(scenario_id, model)
        if not sc_data:
            return []

        baseline = self.analytics.get_baseline(model)
        anomalies = []

        # 1. Check Stations (Utilization and Waiting Time)
        for st in sc_data["stations"]:
            sid = st["id"]
            name = st["name"]
            
            # Utilization
            u = st["utilization"]
            u_base = baseline.get(f"{sid}_utilization", {})
            if u_base:
                med = u_base["median"]
                std = u_base["std"]
                p95 = u_base["p95"]
                p99 = u_base["p99"]
                iqr = u_base["iqr"]
                q75 = u_base["p75"]
                z = (u - u_base["mean"]) / std if std > 0 else 0.0

                is_iqr_outlier = u > (q75 + 1.5 * iqr)
                is_p95 = u >= p95

                if u >= p99 or z > 2.5:
                    anomalies.append({
                        "metric": f"{name} Utilization",
                        "station": name,
                        "type": "UTILIZATION_CRITICAL",
                        "observed_value": round(st["utilization_pct"], 2),
                        "unit": "%",
                        "historical_median": round(med * 100.0, 2),
                        "percentile": st["utilization_percentile"],
                        "z_score": round(z, 2),
                        "severity": "CRITICAL",
                        "status": "Severe Saturation",
                        "evidence": f"Utilization is at {st['utilization_pct']}% (historical median: {med*100:.1f}%, z-score: +{z:.1f}σ)."
                    })
                elif is_p95 or is_iqr_outlier or z > 1.8:
                    anomalies.append({
                        "metric": f"{name} Utilization",
                        "station": name,
                        "type": "UTILIZATION_HIGH",
                        "observed_value": round(st["utilization_pct"], 2),
                        "unit": "%",
                        "historical_median": round(med * 100.0, 2),
                        "percentile": st["utilization_percentile"],
                        "z_score": round(z, 2),
                        "severity": "WARNING",
                        "status": "Elevated Utilization",
                        "evidence": f"Utilization exceeds 95th percentile at {st['utilization_pct']}% (median: {med*100:.1f}%)."
                    })

            # Waiting Time / Queue Time
            w = st["waiting_time"]
            w_base = baseline.get(f"{sid}_waiting_time", {})
            if w_base:
                w_med = w_base["median"]
                w_std = w_base["std"]
                w_p95 = w_base["p95"]
                w_iqr = w_base["iqr"]
                w_q75 = w_base["p75"]
                w_z = (w - w_base["mean"]) / w_std if w_std > 0 else 0.0

                if w >= w_p95 and w > 0.5:
                    sev = "CRITICAL" if w_z > 2.5 else "WARNING"
                    anomalies.append({
                        "metric": f"{name} Waiting Delay",
                        "station": name,
                        "type": "WAITING_TIME_ANOMALY",
                        "observed_value": round(w, 2),
                        "unit": "min",
                        "historical_median": round(w_med, 2),
                        "percentile": st["waiting_time_percentile"],
                        "z_score": round(w_z, 2),
                        "severity": sev,
                        "status": "Abnormal Waiting Time",
                        "evidence": f"Waiting time is {w:.2f} min vs historical median {w_med:.2f} min ({st['waiting_time_percentile']}th percentile)."
                    })

        # 2. Check WIP Accumulation
        for k, v in sc_data.get("storage_buffers", {}).items():
            if "stored" in k:
                b_base = baseline.get(k, {})
                if b_base:
                    b_med = b_base["median"]
                    b_p95 = b_base["p95"]
                    b_std = b_base["std"]
                    b_z = (v - b_base["mean"]) / b_std if b_std > 0 else 0.0
                    if v >= b_p95 and v > 50:
                        anomalies.append({
                            "metric": k.replace("_", " ").title(),
                            "station": "Buffer Storage",
                            "type": "WIP_SURGE",
                            "observed_value": round(v, 0),
                            "unit": "parts",
                            "historical_median": round(b_med, 0),
                            "percentile": round(self.analytics._calculate_percentile_rank(k, v, model), 1),
                            "z_score": round(b_z, 2),
                            "severity": "CRITICAL" if v > b_p95 * 1.5 else "WARNING",
                            "status": "Severe WIP Buildup",
                            "evidence": f"Storage buffer {k} contains {v:.0f} parts waiting, far exceeding historical median of {b_med:.0f}."
                        })

        # 3. Check Throughput Deficit
        tp = sc_data["throughput"]
        tp_base = baseline.get("throughput", {})
        if tp_base:
            tp_med = tp_base["median"]
            tp_p10 = tp_base["p10"]
            tp_std = tp_base["std"]
            tp_z = (tp - tp_base["mean"]) / tp_std if tp_std > 0 else 0.0
            if tp <= tp_p10:
                anomalies.append({
                    "metric": "Throughput Rate",
                    "station": "Line Output",
                    "type": "THROUGHPUT_DEFICIT",
                    "observed_value": round(tp, 1),
                    "unit": "parts/hr",
                    "historical_median": round(tp_med, 1),
                    "percentile": sc_data["throughput_percentile"],
                    "z_score": round(tp_z, 2),
                    "severity": "WARNING",
                    "status": "Unusually Low Output",
                    "evidence": f"Line throughput is restricted to {tp:.1f} parts/hr (bottom 10% of historical distribution)."
                })

        # 4. Check Capacity Imbalance
        imb = sc_data["capacity_imbalance"]["spread"]
        imb_base = baseline.get("capacity_imbalance", {})
        if imb_base:
            imb_med = imb_base["median"]
            imb_p95 = imb_base["p95"]
            if imb >= imb_p95:
                anomalies.append({
                    "metric": "Line Capacity Imbalance",
                    "station": "System Flow",
                    "type": "IMBALANCE_ANOMALY",
                    "observed_value": round(imb * 100.0, 1),
                    "unit": "pp spread",
                    "historical_median": round(imb_med * 100.0, 1),
                    "percentile": sc_data["capacity_imbalance"]["percentile"],
                    "z_score": 0.0,
                    "severity": "WARNING",
                    "status": "Severe Line Imbalance",
                    "evidence": f"Spread between most and least loaded stations is {imb*100:.1f} percentage points ({sc_data['capacity_imbalance']['percentile']}th percentile)."
                })

        return anomalies

    def get_production_health(self, scenario_id: int, model: str = "model2") -> Dict[str, Any]:
        """
        Aggregates production analytics, bottleneck constraints, and statistical anomalies
        into a standardized production-health summary.
        """
        sc_data = self.analytics.analyze_scenario(scenario_id, model)
        if not sc_data:
            return {
                "status": "unknown",
                "error": f"Scenario {scenario_id} not found"
            }

        bn = self.bottleneck.evaluate_scenario(scenario_id, model)
        anomalies = self.detect_anomalies(scenario_id, model)

        # Identify high utilization stations (> 85%) and high waiting stations (> 75th percentile)
        high_util_stations = [
            st["name"] for st in sc_data["stations"] if st["utilization"] >= 0.85
        ]
        high_waiting_stations = [
            st["name"] for st in sc_data["stations"] if st["waiting_time_percentile"] >= 75.0 and st["waiting_time"] > 0.2
        ]

        # Determine overall health status
        # critical: bottleneck is critical OR any anomaly is CRITICAL severity
        # degraded: bottleneck is high OR >= 2 WARNING anomalies OR demand_gap > 500
        # warning: 1 WARNING anomaly OR bottleneck is moderate
        # healthy: no critical/high bottleneck, low anomalies, balanced line
        has_critical_anomaly = any(a["severity"] == "CRITICAL" for a in anomalies)
        warning_count = sum(1 for a in anomalies if a["severity"] == "WARNING")
        bn_sev = bn.get("severity", "low")

        if bn_sev == "critical" or has_critical_anomaly:
            status = "critical"
        elif bn_sev == "high" or warning_count >= 2 or sc_data["demand_gap"] > 1000:
            status = "degraded"
        elif bn_sev == "moderate" or warning_count >= 1 or sc_data["demand_gap"] > 200:
            status = "warning"
        else:
            status = "healthy"

        return {
            "status": status,
            "scenario_id": scenario_id,
            "throughput": sc_data["throughput"],
            "demand": sc_data["demand"],
            "demandGap": sc_data["demand_gap"],
            "primaryConstraint": bn.get("primaryConstraint", "None"),
            "constraintSeverity": bn.get("severity", "low"),
            "highUtilizationStations": high_util_stations,
            "highWaitingStations": high_waiting_stations,
            "anomalies": anomalies,
            "anomalyCount": len(anomalies)
        }
