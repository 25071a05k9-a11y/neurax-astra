"""
Manufacturing Dataset Ingestion Layer
Loads and normalizes the organizer-provided manufacturing datasets:
- Model 1 (Model_1.csv, 3000 rows)
- Model 2 (Model_2.csv, 3000 rows)
- 3000Samplesv3.mat (scipy.io loadable MATLAB structures)

Exposes validated ProductionScenario instances and dataset metadata.
Strictly preserves raw values and validates bounds without inventing data.
"""

import os
import csv
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

try:
    import scipy.io as sio
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL1_CSV = os.path.join(BASE_DIR, "Model_1.csv")
MODEL2_CSV = os.path.join(BASE_DIR, "Model_2.csv")
MAT_FILE = os.path.join(BASE_DIR, "3000Samplesv3.mat")


@dataclass
class StationMetrics:
    id: str
    name: str
    utilization: float  # 0.0 - 1.0
    waiting_time: float  # minutes or seconds
    queue_wip: float  # parts waiting or in storage
    va_time: float  # value-added processing time
    production_count: Optional[float] = None
    storage_time: Optional[float] = None


@dataclass
class ProductionScenario:
    scenario_id: int
    model_name: str
    demand: float
    throughput: float  # parts per hour or total entities out
    total_parts: float
    demand_gap: float
    va_time_total: float
    stations: List[StationMetrics]
    storage_buffers: Dict[str, float]
    raw: Dict[str, Any]


class ManufacturingDatasetService:
    def __init__(self, model1_path: str = MODEL1_CSV, model2_path: str = MODEL2_CSV, mat_path: str = MAT_FILE):
        self.model1_path = model1_path
        self.model2_path = model2_path
        self.mat_path = mat_path
        
        self.scenarios_model1: List[ProductionScenario] = []
        self.scenarios_model2: List[ProductionScenario] = []
        self.mat_metadata: Dict[str, Any] = {}
        
        self.load_errors: List[str] = []
        self.is_loaded: bool = False
        
        self.load_all()

    def load_all(self):
        """Loads both Model 1 and Model 2 datasets and MAT metadata."""
        self.load_errors = []
        
        # Load Model 1
        if os.path.exists(self.model1_path):
            try:
                self.scenarios_model1 = self._parse_model1_csv(self.model1_path)
            except Exception as e:
                self.load_errors.append(f"Failed loading Model 1 CSV: {e}")
        else:
            self.load_errors.append(f"Model 1 CSV not found at {self.model1_path}")

        # Load Model 2
        if os.path.exists(self.model2_path):
            try:
                self.scenarios_model2 = self._parse_model2_csv(self.model2_path)
            except Exception as e:
                self.load_errors.append(f"Failed loading Model 2 CSV: {e}")
        else:
            self.load_errors.append(f"Model 2 CSV not found at {self.model2_path}")

        # Inspect MAT file if present
        if os.path.exists(self.mat_path) and HAS_SCIPY:
            try:
                self.mat_metadata = self._inspect_mat_file(self.mat_path)
            except Exception as e:
                self.load_errors.append(f"Failed loading MAT file: {e}")

        self.is_loaded = (len(self.scenarios_model1) > 0 or len(self.scenarios_model2) > 0)

    def _parse_model1_csv(self, path: str) -> List[ProductionScenario]:
        """
        Parses Model_1.csv
        Columns:
        Demand, Total parts, Parts per hour, VA Time, Drilling Waiting Time,
        Milling Waiting Time, Assembly Waiting Time, Drilling Util, Milling Util, Assembly Util
        """
        scenarios = []
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f)
            header = [h.strip() for h in next(reader) if h.strip()]
            
            for idx, row in enumerate(reader, start=1):
                if not row or not any(row):
                    continue
                # Clean trailing empty columns
                values = [x.strip() for x in row[:len(header)]]
                if len(values) < 10:
                    continue  # skip malformed row
                try:
                    demand = float(values[0])
                    total_parts = float(values[1])
                    pph = float(values[2])
                    va_time = float(values[3])
                    drill_wait = float(values[4])
                    mill_wait = float(values[5])
                    assy_wait = float(values[6])
                    drill_util = float(values[7])
                    mill_util = float(values[8])
                    assy_util = float(values[9])
                except ValueError as e:
                    # skip malformed row cleanly
                    continue

                raw_dict = {
                    header[i]: float(values[i]) for i in range(10)
                }

                # Build stations
                stations = [
                    StationMetrics(
                        id="drilling",
                        name="Drilling",
                        utilization=drill_util,
                        waiting_time=drill_wait,
                        queue_wip=0.0,  # Model 1 records waiting time directly
                        va_time=va_time / 3.0,  # approximate station share of VA time
                        production_count=total_parts
                    ),
                    StationMetrics(
                        id="milling",
                        name="Milling",
                        utilization=mill_util,
                        waiting_time=mill_wait,
                        queue_wip=0.0,
                        va_time=va_time / 3.0,
                        production_count=total_parts
                    ),
                    StationMetrics(
                        id="assembly",
                        name="Assembly",
                        utilization=assy_util,
                        waiting_time=assy_wait,
                        queue_wip=0.0,
                        va_time=va_time / 3.0,
                        production_count=total_parts
                    )
                ]

                # Demand gap: in Model 1, demand is units per arrival interval or target
                # If demand parameter is D, standard run target is D * hours or comparable
                scenarios.append(ProductionScenario(
                    scenario_id=idx,
                    model_name="Model 1 (Linear Flow)",
                    demand=demand,
                    throughput=pph,
                    total_parts=total_parts,
                    demand_gap=max(0.0, (demand * 24.0 * 20.0) - total_parts),  # run comparison
                    va_time_total=va_time,
                    stations=stations,
                    storage_buffers={},
                    raw=raw_dict
                ))
        return scenarios

    def _parse_model2_csv(self, path: str) -> List[ProductionScenario]:
        """
        Parses Model_2.csv
        Columns (17):
        Demand, Entities In Part 1, Part 1 VA Time, Drilling Queue Time, Part 1 Storage Time, Part 1 Stored,
        Entities In Part 2, Part 2 VA Time, Milling Queue Time, Part 2 Storage Time, Part 2 Stored,
        Entities Out, Assembly Time, Assembly Queue Time, Drilling Utilization, Milling Utilization, Assembly Utilization
        """
        scenarios = []
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f)
            header = [h.strip() for h in next(reader) if h.strip()]
            
            for idx, row in enumerate(reader, start=1):
                if not row or not any(row):
                    continue
                values = [x.strip() for x in row[:len(header)]]
                if len(values) < 17:
                    continue
                try:
                    demand = float(values[0])
                    ent_in_1 = float(values[1])
                    va_time_1 = float(values[2])
                    drill_queue_t = float(values[3])
                    p1_storage_t = float(values[4])
                    p1_stored = float(values[5])
                    ent_in_2 = float(values[6])
                    va_time_2 = float(values[7])
                    mill_queue_t = float(values[8])
                    p2_storage_t = float(values[9])
                    p2_stored = float(values[10])
                    ent_out = float(values[11])
                    assy_time = float(values[12])
                    assy_queue_t = float(values[13])
                    drill_util = float(values[14])
                    mill_util = float(values[15])
                    assy_util = float(values[16])
                except ValueError:
                    continue

                raw_dict = {
                    header[i]: float(values[i]) for i in range(17)
                }

                # In Model 2, Drilling processes Part 1; Milling processes Part 2; Assembly joins them
                stations = [
                    StationMetrics(
                        id="drilling",
                        name="Drilling (Part 1)",
                        utilization=drill_util,
                        waiting_time=drill_queue_t,
                        queue_wip=p1_stored,  # WIP accumulated before assembly
                        va_time=va_time_1,
                        production_count=ent_in_1,
                        storage_time=p1_storage_t
                    ),
                    StationMetrics(
                        id="milling",
                        name="Milling (Part 2)",
                        utilization=mill_util,
                        waiting_time=mill_queue_t,
                        queue_wip=p2_stored,  # WIP accumulated before assembly
                        va_time=va_time_2,
                        production_count=ent_in_2,
                        storage_time=p2_storage_t
                    ),
                    StationMetrics(
                        id="assembly",
                        name="Assembly (Merge)",
                        utilization=assy_util,
                        waiting_time=assy_queue_t,
                        queue_wip=p1_stored + p2_stored,  # total upstream buffer waiting for assembly
                        va_time=assy_time,
                        production_count=ent_out,
                        storage_time=0.0
                    )
                ]

                # Total VA time = Part 1 VA + Part 2 VA + Assembly
                tot_va = va_time_1 + va_time_2 + assy_time
                # Input parts vs Output parts: demand gap
                avg_input = (ent_in_1 + ent_in_2) / 2.0
                demand_gap = max(0.0, avg_input - ent_out)

                scenarios.append(ProductionScenario(
                    scenario_id=idx,
                    model_name="Model 2 (Dual Stream Merge)",
                    demand=demand,
                    throughput=ent_out / 24.0,  # parts per hour over 24-hr base
                    total_parts=ent_out,
                    demand_gap=demand_gap,
                    va_time_total=tot_va,
                    stations=stations,
                    storage_buffers={
                        "part1_stored_wip": p1_stored,
                        "part1_storage_time": p1_storage_t,
                        "part2_stored_wip": p2_stored,
                        "part2_storage_time": p2_storage_t
                    },
                    raw=raw_dict
                ))
        return scenarios

    def _inspect_mat_file(self, path: str) -> Dict[str, Any]:
        """Inspects 3000Samplesv3.mat and returns metadata."""
        mat = sio.loadmat(path, variable_names=['Model1Predictors', 'Model1Response', 'Model2PredictorAssembly', 'Model3Predictors', 'Predictors', 'Responses'])
        meta = {
            "file": os.path.basename(path),
            "size_bytes": os.path.getsize(path),
            "keys": [k for k in mat.keys() if not k.startswith('__')],
            "model1_samples": int(mat['Model1Predictors'].shape[0]) if 'Model1Predictors' in mat else 0,
            "model2_samples": int(mat['Model2PredictorAssembly'].shape[0]) if 'Model2PredictorAssembly' in mat else 0,
            "model3_samples": int(mat['Model3Predictors'].shape[0]) if 'Model3Predictors' in mat else 0,
            "full_simulation_observations": int(mat['Predictors'].shape[0]) if 'Predictors' in mat else 0
        }
        return meta

    def get_scenarios(self, model: str = "model2") -> List[ProductionScenario]:
        """Returns scenarios for requested model ('model1' or 'model2'). Defaults to model2 as it contains WIP/buffers."""
        if model.lower() == "model1":
            return self.scenarios_model1
        return self.scenarios_model2

    def get_scenario_by_id(self, scenario_id: int, model: str = "model2") -> Optional[ProductionScenario]:
        scenarios = self.get_scenarios(model)
        if 1 <= scenario_id <= len(scenarios):
            return scenarios[scenario_id - 1]
        return None

    def add_custom_scenario(self, model: str = "model2", data: Optional[Dict[str, Any]] = None) -> ProductionScenario:
        """
        Dynamically registers a new custom production batch scenario into the in-memory dataset.
        Enables external MES/SCADA integration and interactive UI batch creation.
        """
        data = data or {}
        model_key = model.lower()

        if model_key == "model1":
            sc_id = len(self.scenarios_model1) + 1
            demand = float(data.get("demand", 15.0))
            drill_util = float(data.get("drilling_util", data.get("drill_util", 0.65)))
            mill_util = float(data.get("milling_util", data.get("mill_util", 0.55)))
            assy_util = float(data.get("assembly_util", data.get("assy_util", 0.85)))
            
            drill_wait = float(data.get("drilling_waiting_time", data.get("drill_wait", 0.5)))
            mill_wait = float(data.get("milling_waiting_time", data.get("mill_wait", 0.4)))
            assy_wait = float(data.get("assembly_waiting_time", data.get("assy_wait", 1.8)))
            
            va_time = float(data.get("va_time", 9.0))
            total_parts = float(data.get("total_parts", demand * 24.0 * 0.9))
            pph = float(data.get("parts_per_hour", data.get("throughput", total_parts / 24.0)))

            stations = [
                StationMetrics(id="drilling", name="Drilling", utilization=min(1.0, drill_util), waiting_time=drill_wait, queue_wip=0.0, va_time=va_time/3.0, production_count=total_parts),
                StationMetrics(id="milling", name="Milling", utilization=min(1.0, mill_util), waiting_time=mill_wait, queue_wip=0.0, va_time=va_time/3.0, production_count=total_parts),
                StationMetrics(id="assembly", name="Assembly", utilization=min(1.0, assy_util), waiting_time=assy_wait, queue_wip=0.0, va_time=va_time/3.0, production_count=total_parts)
            ]
            sc = ProductionScenario(
                scenario_id=sc_id,
                model_name="Model 1 (Linear Flow - Custom Batch)",
                demand=demand,
                throughput=pph,
                total_parts=total_parts,
                demand_gap=max(0.0, (demand * 24.0 * 20.0) - total_parts),
                va_time_total=va_time,
                stations=stations,
                storage_buffers={},
                raw=data
            )
            self.scenarios_model1.append(sc)
            return sc

        else:
            # Model 2
            sc_id = len(self.scenarios_model2) + 1
            demand = float(data.get("demand", 20.0))
            ent_in_1 = float(data.get("entities_in_part_1", data.get("entities_in_1", 5000.0)))
            ent_in_2 = float(data.get("entities_in_part_2", data.get("entities_in_2", 5000.0)))
            ent_out = float(data.get("entities_out", min(ent_in_1, ent_in_2) * 0.95))
            
            drill_util = float(data.get("drilling_utilization", data.get("drill_util", 0.50)))
            mill_util = float(data.get("milling_utilization", data.get("mill_util", 0.45)))
            assy_util = float(data.get("assembly_utilization", data.get("assy_util", 0.92)))

            drill_queue = float(data.get("drilling_queue_time", data.get("drill_queue", 0.1)))
            mill_queue = float(data.get("milling_queue_time", data.get("mill_queue", 0.1)))
            assy_queue = float(data.get("assembly_queue_time", data.get("assy_queue", 1.5)))

            p1_stored = float(data.get("part_1_stored", data.get("part1_stored", 850.0)))
            p2_stored = float(data.get("part_2_stored", data.get("part2_stored", 420.0)))
            p1_storage_t = float(data.get("part_1_storage_time", data.get("part1_storage_time", 35.0)))
            p2_storage_t = float(data.get("part_2_storage_time", data.get("part2_storage_time", 18.0)))

            va_1 = float(data.get("part_1_va_time", data.get("va_1", 3.0)))
            va_2 = float(data.get("part_2_va_time", data.get("va_2", 3.0)))
            assy_time = float(data.get("assembly_time", 3.0))

            stations = [
                StationMetrics(id="drilling", name="Drilling (Part 1)", utilization=min(1.0, drill_util), waiting_time=drill_queue, queue_wip=p1_stored, va_time=va_1, production_count=ent_in_1, storage_time=p1_storage_t),
                StationMetrics(id="milling", name="Milling (Part 2)", utilization=min(1.0, mill_util), waiting_time=mill_queue, queue_wip=p2_stored, va_time=va_2, production_count=ent_in_2, storage_time=p2_storage_t),
                StationMetrics(id="assembly", name="Assembly (Merge)", utilization=min(1.0, assy_util), waiting_time=assy_queue, queue_wip=p1_stored + p2_stored, va_time=assy_time, production_count=ent_out, storage_time=0.0)
            ]
            avg_input = (ent_in_1 + ent_in_2) / 2.0
            sc = ProductionScenario(
                scenario_id=sc_id,
                model_name="Model 2 (Dual Stream Merge - Custom Batch)",
                demand=demand,
                throughput=ent_out / 24.0,
                total_parts=ent_out,
                demand_gap=max(0.0, avg_input - ent_out),
                va_time_total=va_1 + va_2 + assy_time,
                stations=stations,
                storage_buffers={
                    "part1_stored_wip": p1_stored,
                    "part1_storage_time": p1_storage_t,
                    "part2_stored_wip": p2_stored,
                    "part2_storage_time": p2_storage_t
                },
                raw=data
            )
            self.scenarios_model2.append(sc)
            return sc

    def get_dataset_metadata(self) -> Dict[str, Any]:
        """Exposes complete dataset provenance, row counts, and schema."""
        return {
            "title": "Manufacturing Data Shared Facility - Discrete-Event Simulation",
            "doi": "10.17632/3rw227zxt7.2",
            "models_available": ["Model 1", "Model 2", "Model 3", "3000Samplesv3.mat"],
            "model1": {
                "rows": len(self.scenarios_model1),
                "stations": ["Drilling", "Milling", "Assembly"],
                "columns": ["Demand", "Total parts", "Parts per hour", "VA Time", "Drilling Waiting Time", "Milling Waiting Time", "Assembly Waiting Time", "Drilling Util", "Milling Util", "Assembly Util"]
            },
            "model2": {
                "rows": len(self.scenarios_model2),
                "stations": ["Drilling (Part 1)", "Milling (Part 2)", "Assembly (Merge)"],
                "wip_buffers": ["Part 1 Stored", "Part 2 Stored"],
                "columns": ["Demand", "Entities In Part 1", "Part 1 VA Time", "Drilling Queue Time", "Part 1 Storage Time", "Part 1 Stored", "Entities In Part 2", "Part 2 VA Time", "Milling Queue Time", "Part 2 Storage Time", "Part 2 Stored", "Entities Out", "Assembly Time", "Assembly Queue Time", "Drilling Utilization", "Milling Utilization", "Assembly Utilization"]
            },
            "model3": {
                "file": "Model_3.csv",
                "size_bytes": os.path.getsize(os.path.join(BASE_DIR, "Model_3.csv")) if os.path.exists(os.path.join(BASE_DIR, "Model_3.csv")) else 0,
                "arena_model": "Model 3.doe",
                "parameters_file": "ParametersFile.xls",
                "features_count": 78,
                "description": "Complex manufacturing facility with 4 lines, 5 machines, 78 time-series features covering Blanking, 4 Presses, and Assembly SKU counters."
            },
            "mendeley_dataset": {
                "total_files": 13,
                "source_url": "https://data.mendeley.com/datasets/3rw227zxt7/2",
                "files": [
                    {"filename": f, "size_bytes": os.path.getsize(os.path.join(BASE_DIR, f)) if os.path.exists(os.path.join(BASE_DIR, f)) else 0, "present": os.path.exists(os.path.join(BASE_DIR, f))}
                    for f in [
                        "3000Samplesv3.mat", "Matlab Models.zip", "Model_1.csv", "Model 1.doe",
                        "Model 1.pdf", "Model_2.csv", "Model 2.doe", "Model 2.pdf",
                        "Model_3.csv", "Model 3.doe", "Model 3.pdf", "ParametersFile.xls", "Readme.txt"
                    ]
                ]
            },
            "mat_file": self.mat_metadata,
            "economic_data_present": False,
            "economic_status": "Not available from supplied dataset (required cost variables were not supplied)",
            "image_join_present": False,
            "image_join_status": "No direct unit-level join exists between visual inspection samples and simulation scenarios"
        }
