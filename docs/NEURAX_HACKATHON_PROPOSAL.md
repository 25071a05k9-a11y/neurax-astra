# Visual Inspection & Defect Root-Cause Assistant

> **Industrial Quality Intelligence for Manufacturing**
>
> **Detect → Localize → Verify → Investigate → Quantify → Simulate → Recommend**

---

## NEURAX Hackathon 3.0

**Domain:** AI in Industry and Automation  
**Problem Statement:** Visual Inspection & Defect Root-Cause Assistant

---

# Executive Summary

Manufacturing quality problems are rarely isolated.

A visible crack, scratch, hole, rust patch, or other surface defect may be connected to a broader production issue:

- a specific production batch,
- a changing process condition,
- an overloaded or slow station,
- excessive work-in-progress,
- downtime,
- scrap or rework,
- reduced throughput,
- and eventually reduced profitability.

Most inspection systems answer only:

> **“Is this product defective?”**

Our proposed system goes further:

> **“What defect is present, where is it, how reliable is the result, what production evidence is associated with it, where is the flow constrained, what is the operational and financial impact, and what should be investigated next?”**

This project is designed as a **software-only industrial decision-support system** that connects:

**Quality + Production Flow + Economics + Explainable Investigation**

---

# 1. Problem Understanding

High-throughput manufacturing creates a difficult decision problem because three things interact continuously:

### Product Quality
Is the manufactured unit acceptable or defective?

### Production Health
Are stations, queues, cycle times, downtime, utilization, rework, or changeovers restricting the line?

### Economics
How much do these quality and flow problems affect output, cost, margin, and profitability?

Treating these as separate dashboards loses the most valuable information:

> **the relationship between them.**

Our system is therefore designed to create a continuously updated industrial view rather than a standalone defect classifier.

---

# 2. Core Product Thesis

The project is built around one idea:

## A defect should start an investigation, not end one.

A normal inspection pipeline may stop here:

```text
IMAGE
  ↓
CRACK DETECTED
```

Our pipeline continues:

```text
IMAGE
  ↓
DEFECT DETECTION
  ↓
DEFECT LOCALIZATION
  ↓
INDEPENDENT VERIFICATION
  ↓
KNOWN / UNKNOWN DECISION
  ↓
SIMILAR-CASE SEARCH
  ↓
BATCH / PROCESS ANALYSIS
  ↓
BOTTLENECK ANALYSIS
  ↓
THROUGHPUT IMPACT
  ↓
ECONOMIC IMPACT
  ↓
ROOT-CAUSE HYPOTHESES
  ↓
WHAT-IF SIMULATION
  ↓
EVIDENCE-BACKED RECOMMENDATION
```

---

# 3. What Makes This Different

We do not want the final product to look like:

- an image classifier,
- a generic chatbot,
- a static KPI dashboard,
- or a black-box recommendation engine.

Instead, the system is designed around **evidence-first industrial investigation**.

## Key Differentiators

### 1. Dual-Stage Visual Inspection
A specialized defect-analysis engine produces the initial classification, mask, coordinates, and annotated output.

A second reasoning stage independently evaluates the visual evidence.

The system does not blindly trust the first result.

---

### 2. Explicit Uncertainty
If inspection systems disagree, the product can return:

```text
UNCERTAIN — REVIEW REQUIRED
```

instead of forcing a potentially unsafe classification.

---

### 3. Unknown / Novel Defect Handling
A low-confidence sample is not automatically forced into an existing category.

The system can flag:

```text
UNKNOWN / NOVEL DEFECT
```

for human review or further investigation.

---

### 4. Root-Cause Hypotheses, Not Unsupported Claims
The system distinguishes between:

```text
CORRELATION
```

and:

```text
PROVEN CAUSATION
```

A recommendation must be backed by measurable production evidence.

---

### 5. Quality + Flow + Money in One Investigation
A defect is analyzed together with:

- production behavior,
- bottlenecks,
- throughput,
- scrap,
- rework,
- and economic impact.

---

### 6. Counterfactual / What-If Simulation
Instead of only saying:

> “Station M3 is slow.”

the system can evaluate:

> “What happens if M3 cycle time improves from 71 sec to 55 sec?”

and estimate the likely effect on:

- throughput,
- WIP,
- defect rate,
- scrap,
- rework,
- and margin.

---

# 4. Visual Inspection Pipeline

The supplied inspection dataset contains the following current visual categories:

- **Crack**
- **Hole**
- **Rust**
- **Scratch**
- **Normal**

Each inspection image is processed to generate multiple forms of evidence.

```text
                INPUT IMAGE
                     │
                     ▼
          SPECIALIZED INSPECTION
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
     CLASS        DEFECT MASK   COORDINATES
        │            │            │
        └────────────┼────────────┘
                     ▼
              ANNOTATED IMAGE
                     │
                     ▼
           INDEPENDENT VISUAL CHECK
                     │
          ┌──────────┼───────────┐
          ▼          ▼           ▼
        AGREE     DISAGREE      UNKNOWN
          │          │           │
          ▼          ▼           ▼
      ACCEPTED    UNCERTAIN   HUMAN REVIEW
```

The final inspection view can include:

- original image,
- annotated image,
- binary defect mask,
- defect category,
- location,
- bounding region,
- coverage,
- agreement/disagreement status.

---

# 5. Why Multiple Visual Outputs Matter

For one sample, the system can present:

### Original
The untouched inspection image.

### Annotated
The predicted defect region highlighted for the operator.

### Mask
The exact pixels the system considers defective.

This makes inspection explainable.

A judge or operator can immediately ask:

> “Did the system detect the actual defect, or merely classify the image correctly?”

---

# 6. Confidence and Trust Model

A single confidence number can be misleading.

Our architecture treats different forms of confidence separately.

Example:

```text
Visual Classification Confidence
Localization Confidence
Novelty / Unknown Confidence
Root-Cause Evidence Strength
Bottleneck Confidence
Economic Forecast Confidence
```

These values represent different questions.

For example:

> High confidence that a crack exists does not mean high confidence about what caused the crack.

This separation is essential for trustworthy industrial decision support.

---

# 7. Production Intelligence

The production dataset is analyzed independently from the image dataset.

The production-analysis layer can evaluate signals such as:

- processing time,
- cycle time,
- station capacity,
- utilization,
- work-in-progress,
- queue buildup,
- downtime,
- changeovers,
- scrap,
- rework,
- production flow,
- demand,
- throughput.

Example:

```text
M1 → M2 → M3 → M4 → M5

47s   49s   71s   51s   46s
             ↑
         BOTTLENECK
```

The system should not stop at:

> “M3 is the bottleneck.”

It should continue:

> “How much output is being lost because of M3?”

---

# 8. Root-Cause Investigation

The investigation engine combines quality evidence with available production evidence.

A result may look like:

```text
ROOT-CAUSE HYPOTHESES

H1 — Process condition associated with Station M3
Evidence Strength: STRONG

H2 — Batch-level variation
Evidence Strength: MODERATE

H3 — Material-related variation
Evidence Strength: LOW
```

Each hypothesis should include:

- supporting observations,
- relevant batch/process information,
- comparable historical cases,
- contradictory evidence,
- confidence,
- and limitations.

Example:

```text
Evidence:
- 29 / 41 comparable failures occurred around M3
- defect frequency increased during the same period
- M3 cycle time deviated from its recent baseline
- similar defect behavior was not observed at the same rate elsewhere
```

The system should then state:

> **Strong association detected. Causation is not yet proven.**

---

# 9. Bottleneck Analysis

A production bottleneck can emerge from more than one cause.

The system therefore evaluates:

```text
Cycle-Time Imbalance
        +
Station Capacity
        +
WIP Accumulation
        +
Downtime
        +
Changeovers
        +
Rework Loops
        +
Utilization
```

The product should explain **why** a station is classified as constrained.

Example:

```text
Station M3

Cycle time:
+43% above line median

Queue before station:
3.2× normal

Utilization:
High

Downtime:
Above recent baseline

Result:
Likely production constraint
```

---

# 10. Economic Intelligence

Operational problems become valuable only when their business impact is understood.

The economic-analysis layer can estimate:

- scrap cost,
- rework cost,
- lost contribution,
- output loss,
- production cost,
- expected margin,
- profitability impact.

Example:

```text
Planned Output:
1,000 units/day

Projected Output:
846 units/day

Estimated Throughput Loss:
154 units/day

Rework Loss:
Calculated from available economic data

Scrap Loss:
Calculated from available economic data

Margin Impact:
Estimated from available production + economic evidence
```

All calculations should be traceable to dataset values.

---

# 11. What-If Simulation

The product includes an advisory simulation layer.

Example:

```text
CURRENT STATE

M3 Cycle Time:
71 sec

Throughput:
846 units/day
```

User selects:

```text
SIMULATE:
M3 Cycle Time → 55 sec
```

The system can estimate:

```text
SIMULATED STATE

Throughput:
↑

WIP:
↓

Rework:
↓

Expected Margin:
↑
```

Predictions remain advisory.

No production equipment is modified.

---

# 12. Full System Architecture

```text
                        DATA SOURCES
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
   INSPECTION DATA      PRODUCTION DATA     ECONOMIC DATA
          │                  │                  │
          ▼                  ▼                  ▼
   VISUAL INSPECTION    FLOW ANALYTICS      COST ENGINE
          │                  │                  │
          │          ┌───────┴────────┐         │
          │          ▼                ▼         │
          │     BOTTLENECK        PROCESS       │
          │      ANALYSIS       CORRELATION     │
          │          │                │         │
          └──────────┴────────┬───────┴─────────┘
                              │
                              ▼
                       EVIDENCE PACKAGE
                              │
                              ▼
                    INVESTIGATION ENGINE
                              │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
           EXPLAIN        HYPOTHESIZE      SIMULATE
               │              │              │
               └──────────────┼──────────────┘
                              ▼
                     DECISION-SUPPORT UI
```

---

# 13. Judge Interaction Flow

The system is designed so the judge does not need to know what question to ask first.

## Step 1 — Load Dataset
Inspection, production, and economic datasets are loaded.

## Step 2 — Automatic Overview
The dashboard surfaces:

- total units analyzed,
- defect distribution,
- unknown samples,
- quality trends,
- bottleneck candidates,
- major production anomalies,
- estimated economic impact.

## Step 3 — Drill Into a Unit
The judge selects a product.

The system shows:

```text
Original
Annotated
Mask
Defect Type
Location
Verification Result
Uncertainty
```

## Step 4 — Investigate Production Context
The judge can inspect:

- batch,
- station,
- production conditions,
- similar cases,
- trends,
- bottleneck evidence.

## Step 5 — Simulate
The judge can test a hypothetical process change.

## Step 6 — Ask Questions
Examples:

- Why did defect frequency increase?
- Which station is currently most constrained?
- Which batch has the highest defect rate?
- Why was this sample marked uncertain?
- What evidence supports this root-cause hypothesis?
- What happens if cycle time improves by 15%?

---

# 14. Example Final Investigation

```text
INDUSTRIAL INVESTIGATION
────────────────────────────────

Unit:
U003

Quality Status:
DEFECTIVE

Defect:
SURFACE CRACK

Visual Result:
SUPPORTED

Location:
Upper-right region

────────────────────────────────

PRODUCTION CONTEXT

Batch:
B204

Associated Station:
M3

Cycle-Time Status:
ABNORMAL

────────────────────────────────

ROOT-CAUSE HYPOTHESES

#1 Process condition around M3
Evidence: STRONG

#2 Batch-level variation
Evidence: MODERATE

#3 Material variation
Evidence: LOW

────────────────────────────────

BOTTLENECK ANALYSIS

Station:
M3

Cycle Time:
71 sec

Line Median:
49 sec

Production Constraint:
LIKELY

────────────────────────────────

ECONOMIC IMPACT

Throughput Impact:
Calculated from production data

Scrap / Rework Impact:
Calculated from economic data

Expected Margin Effect:
Estimated with uncertainty

────────────────────────────────

RECOMMENDATION

Investigate the abnormal production conditions
associated with M3.

Run a controlled simulation before making
physical process changes.

────────────────────────────────

LIMITATION

Observed relationships are evidence-backed
correlations and must not automatically be
interpreted as proven causation.
```

---

# 15. UI / UX Direction

The product should feel like an **industrial command center**, not a generic admin dashboard.

## Main Dashboard

```text
┌───────────────────────────────────────────────────┐
│ QUALITY & PRODUCTION INTELLIGENCE                 │
├───────────────────────────────────────────────────┤
│                                                   │
│ Units       Defective      Unknown     Health     │
│ 4,820       312            18          DEGRADED   │
│                                                   │
│ Defect Rate        Current Constraint             │
│ 6.47%              Station M3                     │
│                                                   │
├───────────────────────────────────────────────────┤
│ ACTIVE FINDINGS                                   │
│                                                   │
│ ↑ Defect frequency changed                        │
│ ↑ M3 cycle time changed                           │
│ ↑ WIP building before M3                          │
│                                                   │
│                [ INVESTIGATE ]                    │
└───────────────────────────────────────────────────┘
```

## Investigation View

```text
┌───────────────────────────────────────────────────┐
│ UNIT INVESTIGATION — U003                         │
├───────────────────────────────────────────────────┤
│ ORIGINAL       ANNOTATED       MASK               │
│ [image]        [image]         [image]            │
│                                                   │
│ DEFECT: CRACK             STATUS: SUPPORTED        │
├───────────────────────────────────────────────────┤
│ EVIDENCE                                          │
│ Visual detector ................. Crack           │
│ Independent verification ........ Supported       │
│ Localization .................... Valid region     │
├───────────────────────────────────────────────────┤
│ PRODUCTION CONTEXT                                │
│ Batch B204 | Station M3 | Cycle time abnormal     │
├───────────────────────────────────────────────────┤
│ ROOT-CAUSE HYPOTHESES                             │
│ #1 Process condition ............ Strong           │
│ #2 Batch variation .............. Moderate         │
│ #3 Material variation ........... Weak             │
├───────────────────────────────────────────────────┤
│ IMPACT                                            │
│ Throughput ↓ | Rework ↑ | Margin ↓                │
│                                                   │
│              [ SIMULATE CHANGE ]                  │
└───────────────────────────────────────────────────┘
```

The interface should prioritize:

- evidence,
- clarity,
- trends,
- uncertainty,
- actionable drill-down.

Avoid excessive decoration that hides operational information.

---

# 16. Evaluation Strategy

## Defect Detection
- Accuracy
- Precision
- Recall
- F1-score
- Confusion matrix

## False Accept / False Reject
- Missed-defect rate
- Unnecessary rejection rate

## Localization
- Bounding-region quality
- Mask quality
- overlap / localization metrics where ground truth exists

## Robustness
- lighting variation,
- orientation changes,
- batch variation,
- unseen samples,
- novel conditions.

## Root-Cause Analysis
- evidence validity,
- repeatability,
- consistency with process/batch data.

## Bottleneck Analysis
- cycle-time analysis,
- queue / WIP behavior,
- station-capacity reasoning,
- throughput estimation.

## Economic Analysis
- scrap-loss estimation,
- rework-loss estimation,
- output impact,
- margin / profitability estimation.

## System Reliability
- reproducibility,
- runtime stability,
- deterministic analytical outputs where appropriate,
- traceable evidence.

---

# 17. Reliability Principles

### Evidence Before Explanation
No major conclusion should exist without supporting data.

### No Forced Classification
Low-confidence or conflicting visual results may be marked uncertain.

### Correlation Is Not Causation
Root-cause hypotheses must clearly communicate limitations.

### Progressive Analysis
Fast inspection and deeper industrial analysis may complete at different stages.

### Human Oversight
Uncertain and novel cases can be escalated.

### Reproducibility
Analytical steps should be repeatable and inspectable.

---

# 18. Scope and Safety

This is a **software-only decision-support system**.

It does not:

- control production machinery,
- modify machine parameters,
- operate PLCs,
- perform robotic sorting,
- autonomously alter the production line.

All recommendations, interventions, and profitability estimates remain:

```text
SIMULATED
or
ADVISORY
```

---

# 19. Checkpoint 01 Focus

At Checkpoint 01, the project is being presented around three core areas:

### Problem Understanding
We treat defect detection as one part of a larger industrial decision problem.

### Architecture
The solution separates visual inspection, production analytics, economic analysis, evidence synthesis, and simulation.

### Approach
The system prioritizes measurable outputs, uncertainty handling, explainability, and evidence-backed decision support.

No feature is considered complete unless it can be validated against the supplied data.

---

# 20. Product Vision

The final product should help a manufacturing operator move from:

> **“Something is defective.”**

to:

> **“We know what failed, where it failed, how reliable that conclusion is, what production evidence is associated with it, what the operational and financial impact may be, and what should be investigated or simulated next.”**

---

# Final Principle

## Detect → Localize → Verify → Investigate → Quantify → Simulate → Recommend

**Our objective is not to build another defect detector.  
Our objective is to build an industrial investigation system.**
