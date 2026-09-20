from __future__ import annotations
from typing import Any

MECHANISMS={
    "rust":{"domain":["storage dwell","WIP accumulation","downstream congestion","surface-treatment context"],"terms":["storage","warehouse","dwell","wip","queue","assembly","paint","coating"]},
    "crack":{"domain":["drilling","machining","assembly stress","pressing/stamping where present"],"terms":["drill","machin","assembly","press","stamp","force","load"]},
    "scratch":{"domain":["material handling","milling contact","queues","forklift activity","transfers"],"terms":["handling","mill","queue","forklift","transfer","transport"]},
    "hole":{"domain":["drilling","punching","blanking","related process stress"],"terms":["drill","punch","blank","press","stress"]},
}

def investigate(defect_type:str,production:dict[str,Any]|None)->dict[str,Any]:
    defect=defect_type.strip().lower();mechanism=MECHANISMS.get(defect)
    if not mechanism:
        return {"defect_type":defect,"domain_relevance":[],"production_evidence":[],"contradictory_evidence":[],"missing_evidence":["Known defect class"],"direct_traceability":"Not available","evidence_strength":"insufficient","classification":"hypothesis"}
    evidence=[];contradictions=[]
    if production:
        def walk(prefix:str,value:Any):
            if isinstance(value,dict):
                for key,child in value.items():walk(f"{prefix}.{key}" if prefix else str(key),child)
            elif isinstance(value,list):
                for index,child in enumerate(value):walk(f"{prefix}[{index}]",child)
            elif isinstance(value,(int,float)):
                key=prefix.lower()
                if any(term in key for term in mechanism["terms"]):evidence.append({"metric":prefix,"value":value,"kind":"production_evidence"})
        walk("",production)
    missing=["Direct unit-to-machine join","Part-level process history"]
    if defect=="rust":missing.extend(["Humidity/environment measurements","Protective coating history"])
    elif defect=="crack":missing.extend(["Tool condition","Force/load history","Material certificate"])
    elif defect=="scratch":missing.extend(["Handling observation/video","Fixture/contact condition"])
    elif defect=="hole":missing.extend(["Engineering drawing/specification","Tool history"])
    strength="moderate" if len(evidence)>=2 else "limited" if evidence else "insufficient"
    return {"defect_type":defect,"domain_relevance":mechanism["domain"],"production_evidence":evidence,"contradictory_evidence":contradictions,"missing_evidence":missing,"direct_traceability":"Not available","evidence_strength":strength,"classification":"hypothesis","statement":"These are investigation targets supported by domain relevance and available production evidence; they are not a proven root cause."}
