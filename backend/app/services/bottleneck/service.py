from __future__ import annotations
from typing import Any

SIGNALS=("utilization","waiting","queue","wip","blocking","starvation","throughput_restriction")
WEIGHTS={"utilization":.30,"waiting":.20,"queue":.17,"wip":.12,"blocking":.08,"starvation":.05,"throughput_restriction":.08}

def _normalize(values:list[float],value:float)->float:
    lo=min(values);hi=max(values)
    if hi-lo<1e-9:return .5
    return max(0,min(1,(value-lo)/(hi-lo)))

def rank_bottlenecks(stations:list[dict[str,Any]])->list[dict[str,Any]]:
    distributions={signal:[float(s[signal]) for s in stations if isinstance(s.get(signal),(int,float))] for signal in SIGNALS}
    results=[]
    for station in stations:
        contributions=[];weighted=0.0;available_weight=0.0;missing=[]
        for signal in SIGNALS:
            value=station.get(signal);values=distributions[signal]
            if not isinstance(value,(int,float)) or not values:
                missing.append(signal);continue
            normalized=_normalize(values,float(value)) if len(values)>1 else (max(0,min(1,float(value)/100)) if signal=="utilization" else .5)
            weight=WEIGHTS[signal];weighted+=normalized*weight;available_weight+=weight
            contributions.append({"signal":signal,"value":float(value),"normalized":round(normalized,4),"weight":weight,"contribution":round(normalized*weight,4)})
        score=round(weighted/available_weight*100,1) if available_weight else 0.0
        severity="critical" if score>=80 else "high" if score>=65 else "moderate" if score>=45 else "low"
        results.append({"station":station.get("station","Unknown"),"score":score,"severity":severity,"evidence":contributions,"missing_signals":missing,"normalization":"Score is re-normalized over available signals only."})
    return sorted(results,key=lambda item:item["score"],reverse=True)
