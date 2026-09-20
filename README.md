# ASTRA: Visual Inspection & Manufacturing Intelligence Platform

**NEURAX Hackathon 3.0 — AI in Industry & Automation**  
**Problem Statement:** Visual Inspection & Defect Root-Cause Assistant  
**Pipeline:** Detect → Localize → Verify → Investigate → Quantify → Simulate → Recommend

**Repository:** https://github.com/25071a05k9-a11y/neurax-astra

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v18+ (tested on Node v20/v22)
- **Python**: 3.10+ (tested on Python 3.12)
- Optional: provider credentials for the AI Copilot agent.

---

### Step 1: Start the Backend (Port 5000)
The backend provides deterministic computer vision defect detection, discrete-event simulation analytics, bottleneck detection, and economic impact calculations.

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```
> The backend server starts at **`http://127.0.0.1:5000`**.

Alternatively, you can run the modular FastAPI server:
```bash
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 5000 --reload
```
Use this instead of `python app.py` when you want auto-reload.

---

### Step 2: Start the AI Agent Server (Port 8000)
The Agent Server orchestrates LLM reasoning, LangChain tool execution, live tool traces, and proxies deterministic backend requests.

```bash
cd frontend
npm install
# Windows: copy .env.example .env
# macOS/Linux: cp .env.example .env
node agent_server.mjs
```
> Listens at **`http://127.0.0.1:8000`**. Configure your model provider in `frontend/.env`.

---

### Step 3: Start the Frontend UI (Port 5173)
The frontend features a cybernetic 3D digital twin factory (Three.js), real-time conveyor and robotic motion, defect inspection drawer, and live interactive tool execution traces.

```bash
cd frontend
npm run dev
```
> Open your browser at **`http://localhost:5173`**.

*Note:* A pre-compiled production build is also included in `frontend/dist/`. You can preview it immediately with `npm run preview`.

---

## ⚡ Quick Launcher Scripts (Windows)

For 1-click execution on Windows:
- **`START_ALL.bat`**: Launches the backend, agent server, and opens the frontend UI in your browser.
- **`start_backend.bat`**: Launches only the Python backend.
- **`start_agent.bat`**: Launches only the Node.js agent server.
- **`start_frontend.bat`**: Launches the Vite development server.

---

## 📁 Repository Structure

```
ASTRA/
├── frontend/                     # React 19 + Vite + Three.js 3D Digital Twin UI
│   ├── src/                      # App components, 3D scene, tool trace cards
│   │   ├── App.tsx               # Main dashboard & telemetry interface
│   │   ├── FactoryScene.tsx      # Three.js interactive 3D factory twin
│   │   ├── ToolExecutionCard.tsx # Real-time tool execution UI & result viewer
│   │   ├── MarkdownRenderer.tsx  # Markdown & KaTeX LaTeX math renderer
│   │   ├── ModelBuilder.tsx      # Scenario & line builder
│   │   ├── productionMotion.ts   # Continuous conveyor transport physics
│   │   ├── robotMotion.ts        # 6-DOF robotic arm kinematics
│   │   └── styles.css            # Cybernetic industrial styling
│   ├── dist/                     # Pre-compiled production build bundle
│   ├── lib/                      # Agent core, provider integration, tool registry
│   ├── agent_server.mjs          # Node.js LangChain / Agent server
│   ├── package.json              # Frontend & agent dependencies
│   ├── vite.config.ts            # Proxy configuration to the agent server (Port 8000)
│   └── .env.example              # Environment variables template
│
├── backend/                      # Deterministic Python Backend & Engines
│   ├── app.py                    # Unified HTTP & API server (Port 5000)
│   ├── defect_detector.py        # Computer vision & defect localization
│   ├── defect_classifier.joblib  # Trained defect classification model weights
│   ├── manufacturing_dataset.py  # Discrete-event simulation dataset ingestion
│   ├── production_analytics.py   # Throughput, utilization, WIP metrics
│   ├── bottleneck_engine.py      # Deterministic bottleneck evaluation engine
│   ├── anomaly_detector.py       # Statistical anomaly detection
│   ├── economic_engine.py        # Scrap, downtime, and cost calculation
│   ├── investigation_service.py  # Root-cause analysis & hypothesis generation
│   ├── simulation_service.py     # What-if nearest-scenario matching
│   ├── app/                      # FastAPI application implementation
│   └── requirements.txt          # Python dependencies
│
├── sample_data/                  # Representative Dataset Samples
│   ├── Model_1.csv               # Model 1 simulation data (3,000 rows)
│   ├── Model_2.csv               # Model 2 simulation data (3,000 rows)
│   ├── Model_3_sample.csv        # Model 3 representative sample (500 rows)
│   ├── ParametersFile.xls        # Simulation parameters & machine specifications
│   ├── dataset_meta.json         # Mendeley Data DOI provenance
│   ├── Model 1.doe / .pdf        # Arena simulation source & flow diagrams
│   ├── Model 2.doe / .pdf
│   └── Model 3.doe / .pdf
│
├── sample_images/                # Curated Test Images for Defect Detection
│   ├── crack/                    # Crack defect test samples
│   ├── hole/                     # Hole defect test samples
│   ├── rust/                     # Rust defect test samples
│   ├── scratch/                  # Scratch defect test samples
│   └── normal/                   # Defect-free surface test samples
│
├── docs/                         # Extended Documentation
│   ├── NEURAX_HACKATHON_PROPOSAL.md # Complete hackathon technical proposal
│   └── ASTRA_Manufacturing_Intelligence_7slides.pptx # 7-slide presentation deck
│
├── START_ALL.bat                 # 1-Click launcher script
├── start_backend.bat
├── start_agent.bat
└── start_frontend.bat
```

## 📦 Included Data

The repository includes representative production CSVs in `sample_data/` and curated inspection images in `sample_images/` for local demos and testing. The same CSVs are also available in `backend/` because the backend scans that directory for bundled datasets.

Local configuration and generated runtime state are intentionally excluded from Git: `frontend/.env`, Python/Node caches, runtime logs, SQLite databases, uploaded files, and generated inspection artifacts. Copy `frontend/.env.example` to `frontend/.env` for local agent configuration.

The accompanying [7-slide presentation deck](docs/ASTRA_Manufacturing_Intelligence_7slides.pptx) is included under `docs/`.

---

## 🔬 Core Capabilities

1. **Visual Defect Detection & Localization**:
   - Detects and segments **Cracks**, **Holes**, **Rust**, and **Scratches** with bounding boxes, area measurements, and confidence scores.
   - Dual-mode: Saliency + Edge analysis for micro-cracks; color texture decomposition for rust; contour curvature for holes.
2. **Deterministic Bottleneck Engine**:
   - Ranks stations by utilization, queue WIP, and waiting time spreads.
   - Identifies active constraints (e.g. Drilling, Milling, Assembly) with transparent evidence.
3. **Distribution-Based Anomaly & Health Engine**:
   - Compares current operational parameters against empirical historical percentiles.
4. **Economic Impact Assessment**:
   - Quantifies lost output, downtime cost, scrap cost, and profit margins.
5. **AI Copilot & Live Tool Execution Trace UI**:
   - Integrates LangChain-based reasoning with real deterministic tools.
   - Shows live collapsible tool execution cards with inputs, duration, and formatted JSON/markdown outputs.
6. **3D Digital Twin Factory**:
   - Interactive 3D scene built with Three.js.
   - Continuous conveyor belt motion, machine processing portals, and synchronized robotic arm kinematics.

---

## ✅ Validation

Run the supported smoke checks from the repository root:

```bash
cd backend
python -m pytest -q tests

cd ../frontend
npm install
npm run build
```

The modular backend test suite covers the current FastAPI service. The older standalone scripts in `backend/` are retained for reference and are not the primary test entry point.
