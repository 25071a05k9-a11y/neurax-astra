"""
Batch Defect Processing & Coordinate Generator
Processes all images in train.zip, saves annotated bounding box images,
saves binary white mark masks, and exports exact coordinates to CSV & JSON.
"""

import os
import sys
import time
import zipfile
import csv
import json
import cv2
import numpy as np
from defect_detector import DefectDetector

ZIP_PATH = r"C:\Users\anoop\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\C17CC801473B9BC7BFBC2C7550AE4A868272AFC3\transfers\2026-38\train.zip"
OUTPUT_DIR = r"C:\NURAX\TESTING\batch_output"

def run_batch(category="crack", limit=None, save_images=True):
    detector = DefectDetector()
    
    cat_dir_ann = os.path.join(OUTPUT_DIR, "annotated", category)
    cat_dir_mask = os.path.join(OUTPUT_DIR, "white_marks", category)
    
    if save_images:
        os.makedirs(cat_dir_ann, exist_ok=True)
        os.makedirs(cat_dir_mask, exist_ok=True)

    print(f"\n=======================================================")
    print(f"[INFO] Processing category: {category.upper()}")
    print(f"[INFO] Source archive: {ZIP_PATH}")
    print(f"=======================================================")

    with zipfile.ZipFile(ZIP_PATH, 'r') as z:
        all_files = sorted([f for f in z.namelist() if f.startswith(f"train/{category}/") and f.endswith(".png")])
        if limit:
            all_files = all_files[:limit]
        
        total = len(all_files)
        print(f"Found {total} images to process.")

        records = []
        t0 = time.time()
        
        for idx, file_path in enumerate(all_files):
            fname = os.path.basename(file_path)
            raw = z.read(file_path)
            im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)

            res = detector.analyze(im, mode=category)
            ob = res.get("overall_box")
            
            if save_images:
                cv2.imwrite(os.path.join(cat_dir_ann, fname), res["annotated_bgr"])
                cv2.imwrite(os.path.join(cat_dir_mask, fname), res["mask_bgr"])

            if ob:
                records.append({
                    "filename": fname,
                    "category": category,
                    "defect_detected": True,
                    "xmin": ob["xmin"],
                    "ymin": ob["ymin"],
                    "xmax": ob["xmax"],
                    "ymax": ob["ymax"],
                    "width": ob["width"],
                    "height": ob["height"],
                    "center_x": ob["center_x"],
                    "center_y": ob["center_y"],
                    "defect_area_px": ob["area_px"],
                    "coverage_pct": ob["coverage_pct"],
                    "yolo_bbox": " ".join(map(str, ob["yolo"]))
                })
            else:
                records.append({
                    "filename": fname,
                    "category": category,
                    "defect_detected": False,
                    "xmin": 0, "ymin": 0, "xmax": 0, "ymax": 0,
                    "width": 0, "height": 0, "center_x": 0, "center_y": 0,
                    "defect_area_px": 0, "coverage_pct": 0, "yolo_bbox": ""
                })

            if (idx + 1) % 100 == 0 or (idx + 1) == total:
                elapsed = time.time() - t0
                fps = (idx + 1) / max(0.001, elapsed)
                print(f"[{idx+1}/{total}] {fps:.1f} images/sec | Elapsed: {elapsed:.1f}s")

    elapsed_total = time.time() - t0
    
    # Save CSV
    csv_file = os.path.join(r"C:\NURAX\TESTING", f"{category}_coordinates.csv")
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "filename", "category", "defect_detected", "xmin", "ymin", "xmax", "ymax",
            "width", "height", "center_x", "center_y", "defect_area_px", "coverage_pct", "yolo_bbox"
        ])
        writer.writeheader()
        writer.writerows(records)

    # Save JSON
    json_file = os.path.join(r"C:\NURAX\TESTING", f"{category}_coordinates.json")
    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2)

    detected_count = sum(1 for r in records if r["defect_detected"])
    print(f"\n=======================================================")
    print(f"[SUCCESS] Finished {total} images in {elapsed_total:.2f}s ({total/max(0.001, elapsed_total):.1f} fps)")
    print(f"[METRIC] Defect Detection Rate: {detected_count}/{total} ({detected_count/total*100:.1f}%)")
    print(f"[OUTPUT] CSV Output: {csv_file}")
    print(f"[OUTPUT] JSON Output: {json_file}")
    if save_images:
        print(f"[OUTPUT] Annotated Images: {cat_dir_ann}")
        print(f"[OUTPUT] White Mark Masks: {cat_dir_mask}")
    print(f"=======================================================\n")
    return records

if __name__ == "__main__":
    cat = sys.argv[1] if len(sys.argv) > 1 else "crack"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
    run_batch(cat, limit=limit)
