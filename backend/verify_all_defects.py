"""
Comprehensive Verification Suite across All 5 Defect Types
Tests 50 random samples of each class (250 images total):
- scratch
- crack
- hole
- rust
- normal
Verifies:
1. Prediction accuracy
2. Segmentation mask validity & coverage
3. Bounding box validity & component count
4. Zero false alarms on normal images
Generates multi-type comparison grids.
"""

import zipfile
import cv2
import numpy as np
import random
import os
import time
from defect_detector import DefectDetector

ZIP_PATH = r"C:\Users\anoop\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\C17CC801473B9BC7BFBC2C7550AE4A868272AFC3\transfers\2026-38\train.zip"
OUTPUT_DIR = r"C:\NURAX\TESTING\test_results"
os.makedirs(OUTPUT_DIR, exist_ok=True)

det = DefectDetector()
z = zipfile.ZipFile(ZIP_PATH)

classes = ['crack', 'hole', 'rust', 'scratch', 'normal']
samples_per_class = 50

random.seed(1337)

results = {cls: {'total': 0, 'pred_correct': 0, 'seg_correct': 0, 'boxes_valid': 0, 'coverage_list': []} for cls in classes}

grid_samples = {cls: [] for cls in classes}

print("=" * 70)
print(f"STARTING COMPREHENSIVE 250-IMAGE VERIFICATION SUITE")
print("=" * 70)

t0 = time.time()

for cls in classes:
    all_files = [f for f in z.namelist() if f.startswith(f'train/{cls}/') and f.endswith('.png')]
    selected = random.sample(all_files, samples_per_class)
    
    print(f"\nEvaluating Class: {cls.upper()} ({samples_per_class} images)...")
    
    for idx, fname in enumerate(selected):
        raw = z.read(fname)
        im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        
        # Analyze using AUTO mode
        res = det.analyze(im, mode='auto')
        
        pred = res['ai_prediction']['predicted_class']
        conf = res['ai_prediction']['confidence']
        mask = res['mask_bgr'][:, :, 0] # 1-channel mask
        comps = res['components']
        ob = res['overall_box']
        has_defect = res['has_defect']
        
        results[cls]['total'] += 1
        
        # 1. Prediction check
        if pred == cls:
            results[cls]['pred_correct'] += 1
            
        # 2. Segmentation & Defect decision check
        if cls == 'normal':
            # Normal should have NO defect, 0 coverage, 0 boxes
            if not has_defect and np.count_nonzero(mask) == 0 and len(comps) == 0:
                results[cls]['seg_correct'] += 1
                results[cls]['boxes_valid'] += 1
        else:
            # Defect images should have defect detected, non-empty mask, valid bounding boxes
            pts = np.count_nonzero(mask)
            cov = (pts / (im.shape[0] * im.shape[1])) * 100
            results[cls]['coverage_list'].append(cov)
            
            if has_defect and pts > 0:
                results[cls]['seg_correct'] += 1
            if len(comps) >= 1 and ob is not None:
                results[cls]['boxes_valid'] += 1
                
        # Collect first 5 for the visual showcase grid
        if idx < 5:
            grid_samples[cls].append({
                'fname': os.path.basename(fname),
                'orig': im,
                'mask': res['mask_bgr'],
                'ann': res['annotated_bgr']
            })

t1 = time.time()

print("\n" + "=" * 70)
print(f"VERIFICATION RESULTS SUMMARY (Time: {t1 - t0:.1f}s)")
print("=" * 70)

for cls in classes:
    tot = results[cls]['total']
    p_acc = (results[cls]['pred_correct'] / tot) * 100
    s_acc = (results[cls]['seg_correct'] / tot) * 100
    b_acc = (results[cls]['boxes_valid'] / tot) * 100
    covs = results[cls]['coverage_list']
    mean_cov = np.mean(covs) if covs else 0.0
    print(f"[{cls.upper():7s}] Pred Acc: {p_acc:5.1f}% | Seg/Det Acc: {s_acc:5.1f}% | Boxes Valid: {b_acc:5.1f}% | Mean Cov: {mean_cov:4.1f}%")

print("=" * 70)

# Build Comprehensive Multi-Type Visual Grid:
# 5 rows (one per class), each row has 5 samples.
# Each sample shows Original, Mask, Annotated side-by-side or stacked.
# Let's create an annotated montage for each class (5 images wide)
for cls in classes:
    col_imgs = []
    for s in grid_samples[cls]:
        # stack orig, mask, ann vertically
        sample_col = np.vstack([s['orig'], s['mask'], s['ann']])
        col_imgs.append(sample_col)
    cls_row = np.hstack(col_imgs)
    out_path = os.path.join(OUTPUT_DIR, f"grid_{cls}.png")
    cv2.imwrite(out_path, cls_row)
    print(f"Saved visual grid for {cls}: {out_path}")

# Create Master 5-Class Overview Montage
# For each class, pick 1 representative example and show [Orig | Mask | Annotated]
master_rows = []
for cls in classes:
    rep = grid_samples[cls][0]
    row = np.hstack([rep['orig'], rep['mask'], rep['ann']])
    # add label banner
    banner = np.zeros((row.shape[0], 120, 3), dtype=np.uint8)
    cv2.putText(banner, cls.upper(), (10, row.shape[0]//2), cv2.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 1)
    master_rows.append(np.hstack([banner, row]))

master_grid = np.vstack(master_rows)
master_out = os.path.join(OUTPUT_DIR, "all_defects_master_grid.png")
cv2.imwrite(master_out, master_grid)
print(f"Saved master showcase grid: {master_out}")
