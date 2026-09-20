from typing import Any, Literal
from pydantic import BaseModel, Field

EvidenceKind = Literal["measured", "calculated", "hypothesis", "simulated", "user_assumption", "unavailable"]

class EvidenceItem(BaseModel):
    label: str
    value: Any = None
    kind: EvidenceKind
    source: str | None = None

class InvestigationRequest(BaseModel):
    model: int = Field(ge=1, le=3)
    scenario_id: str | None = None
    defect_type: str
    production: dict[str, Any] | None = None

class SimulationRequest(BaseModel):
    model: int = Field(ge=1, le=3)
    scenario_id: str | None = None
    changes: dict[str, float]

class EconomicsRequest(BaseModel):
    defective_units: int = Field(default=0, ge=0)
    scrap_units: int = Field(default=0, ge=0)
    rework_units: int = Field(default=0, ge=0)
    lost_output_units: int = Field(default=0, ge=0)
    scrap_cost_per_unit: float | None = Field(default=None, ge=0)
    rework_cost_per_unit: float | None = Field(default=None, ge=0)
    value_per_lost_unit: float | None = Field(default=None, ge=0)
    contribution_margin_per_unit: float | None = Field(default=None, ge=0)

class AnalysisContextRequest(BaseModel):
    model: int = Field(ge=1, le=3)
    scenario_id: str
    inspection_batch_id: str | None = None

class BatchAnalysisUpdate(BaseModel):
    answer: str = ""
    render_blocks: list[dict[str, Any]] = Field(default_factory=list)
    model: str | None = None

class ConversationMessageRequest(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str
    render_blocks: list[dict[str, Any]] = Field(default_factory=list)
