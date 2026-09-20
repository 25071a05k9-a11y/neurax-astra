from __future__ import annotations
import math
from typing import Any
import numpy as np
from fastapi import HTTPException
from ..production.store import ProductionStore


def nearest_scenario(store:ProductionStore,model:int,scenario_id:str|None,changes:dict[str,float])->dict[str,Any]:
    dataset=store.frame_for_model(model)
    if not dataset:
        raise HTTPException(status_code=422,detail={"code":"simulation_dataset_required","message":"What-if matching requires a loaded organizer/user dataset; demo fixture values are not used to invent simulated outputs."})
    if not scenario_id:
        raise HTTPException(status_code=422,detail={"code":"dataset_scenario_required","message":"Select a dataset scenario before running what-if matching."})
    frame=dataset.frame
    index=store._scenario_index(scenario_id,len(frame))
    if index<0 or index>=len(frame):raise HTTPException(status_code=404,detail={"code":"invalid_scenario","message":"Scenario does not exist."})
    numeric=[column for column in dataset.numeric_columns if column in changes]
    if not numeric:raise HTTPException(status_code=422,detail={"code":"no_simulation_features","message":"None of the requested changes match numeric columns in the loaded dataset."})
    current=frame.iloc[index]
    target=np.array([float(changes.get(column,current[column])) for column in numeric],dtype=float)
    matrix=frame[numeric].to_numpy(dtype=float)
    med=np.nanmedian(matrix,axis=0);std=np.nanstd(matrix,axis=0);std=np.where(std<1e-9,1.0,std)
    clean=np.where(np.isfinite(matrix),matrix,med);target=np.where(np.isfinite(target),target,med)
    distances=np.linalg.norm((clean-target)/std,axis=1)
    distances[index]=np.inf if len(frame)>1 else distances[index]
    match=int(np.argmin(distances))
    if not math.isfinite(float(distances[match])):raise HTTPException(status_code=422,detail={"code":"no_simulation_match","message":"No valid nearest scenario could be found."})
    current_values={column:float(current[column]) if np.isfinite(current[column]) else None for column in numeric}
    alternative=frame.iloc[match]
    alternative_values={column:float(alternative[column]) if np.isfinite(alternative[column]) else None for column in numeric}
    return {"label":"Simulated / Advisory","method":"nearest-neighbor scenario matching","current_scenario":scenario_id,"matched_scenario":f"SC-{match+1:04d}","similarity_distance":round(float(distances[match]),6),"changed_features":numeric,"current_values":current_values,"requested_values":{column:changes[column] for column in numeric},"alternative_values":alternative_values,"deltas":{column:(alternative_values[column]-current_values[column]) if alternative_values[column] is not None and current_values[column] is not None else None for column in numeric},"limitations":["Nearest-neighbor matching does not establish causality.","Only dimensions present in the loaded dataset are compared."]}
