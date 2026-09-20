from __future__ import annotations
from ...schemas import EconomicsRequest

def calculate(request:EconomicsRequest)->dict:
    assumptions={key:value for key,value in {
        "scrap_cost_per_unit":request.scrap_cost_per_unit,
        "rework_cost_per_unit":request.rework_cost_per_unit,
        "value_per_lost_unit":request.value_per_lost_unit,
        "contribution_margin_per_unit":request.contribution_margin_per_unit,
    }.items() if value is not None}
    if not assumptions:
        return {"status":"Economic data unavailable","assumptions":{},"calculated":{}}
    calculated={}
    if request.scrap_cost_per_unit is not None:calculated["scrap_loss"]=round(request.scrap_units*request.scrap_cost_per_unit,2)
    if request.rework_cost_per_unit is not None:calculated["rework_loss"]=round(request.rework_units*request.rework_cost_per_unit,2)
    if request.value_per_lost_unit is not None:calculated["lost_output_value"]=round(request.lost_output_units*request.value_per_lost_unit,2)
    if request.contribution_margin_per_unit is not None:calculated["estimated_margin_impact"]=round(request.lost_output_units*request.contribution_margin_per_unit,2)
    return {"status":"Calculated","assumptions":{key:{"value":value,"kind":"user_assumption"} for key,value in assumptions.items()},"calculated":{key:{"value":value,"kind":"calculated"} for key,value in calculated.items()}}
