"""
Defect Detection & AI Classification Engine (v3.0)
- Machine Learning Defect Classifier (RandomForest on 25 morphological & geometric features)
- Predicts whether defect is Crack, Hole, Rust, Scratch, or Normal with model probability output
- High-precision dedicated segmentation pipelines for exact bounding box and coordinate extraction
"""

import cv2
import numpy as np
import base64
import os
import joblib

_LOCAL_MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "defect_classifier.joblib")
MODEL_PATH = _LOCAL_MODEL


class DefectDetector:
    def __init__(self):
        self.class_names = ['crack', 'hole', 'rust', 'scratch', 'normal']
        self.class_map = {
            'crack': 0,
            'hole': 1,
            'rust': 2,
            'scratch': 3,
            'normal': 4
        }
        self.color_map = {
            'crack': (0, 0, 245),      # Bright Red
            'hole': (255, 140, 0),     # Amber/Orange
            'rust': (0, 165, 255),     # Deep Amber
            'scratch': (255, 0, 200),  # Magenta
            'normal': (0, 220, 0)      # Green
        }
        
        # Load ML Classifier
        self.classifier = None
        if os.path.exists(MODEL_PATH):
            try:
                self.classifier = joblib.load(MODEL_PATH)
            except Exception as e:
                print(f"[WARN] Could not load classifier from {MODEL_PATH}: {e}")

    def extract_features(self, gray):
        """Extracts 25 discriminative features for classification."""
        smooth = cv2.bilateralFilter(gray, 7, 30, 30)
        
        # 1. Morphological
        k7 = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        k15 = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        bh = cv2.max(cv2.morphologyEx(smooth, cv2.MORPH_BLACKHAT, k7), cv2.morphologyEx(smooth, cv2.MORPH_BLACKHAT, k15))
        th = cv2.max(cv2.morphologyEx(smooth, cv2.MORPH_TOPHAT, k7), cv2.morphologyEx(smooth, cv2.MORPH_TOPHAT, k15))
        
        # 2. Background diff
        bg = cv2.medianBlur(smooth, 51)
        diff = cv2.subtract(bg, smooth)
        
        # 3. Hessian ridge
        blurred = cv2.GaussianBlur(gray.astype(np.float32), (5, 5), 1.2)
        dx = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
        dy = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)
        dxx = cv2.Sobel(dx, cv2.CV_32F, 1, 0, ksize=3)
        dyy = cv2.Sobel(dy, cv2.CV_32F, 0, 1, ksize=3)
        dxy = cv2.Sobel(dx, cv2.CV_32F, 0, 1, ksize=3)
        trace = dxx + dyy
        disc = np.sqrt(np.maximum(0.0, (dxx - dyy)**2 + 4.0 * dxy**2))
        l1 = np.maximum(0.0, 0.5 * (trace + disc))
        
        # 4. Shape & contour features
        _, dt = cv2.threshold(diff, 16, 255, cv2.THRESH_BINARY)
        cnts, _ = cv2.findContours(dt, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        sig_cnts = [c for c in cnts if cv2.contourArea(c) > 40]
        
        num_blobs = len(sig_cnts)
        max_area = max([cv2.contourArea(c) for c in sig_cnts]) if sig_cnts else 0
        
        circs, solids, extents = [], [], []
        for c in sig_cnts:
            a = cv2.contourArea(c)
            p = cv2.arcLength(c, True)
            circs.append(4 * np.pi * (a / (p * p)) if p > 0 else 0)
            ha = cv2.contourArea(cv2.convexHull(c))
            solids.append(a / ha if ha > 0 else 0)
            x, y, w, h = cv2.boundingRect(c)
            extents.append(a / float(w * h) if w * h > 0 else 0)
            
        feat = [
            float(gray.mean()), float(gray.std()), float(gray.min()), float(gray.max()),
            float(bh.max()), float(bh.mean()), float(np.percentile(bh, 99)), float(np.count_nonzero(bh > 20)),
            float(th.max()), float(th.mean()), float(np.percentile(th, 99)), float(np.count_nonzero(th > 20)),
            float(diff.max()), float(diff.mean()), float(np.count_nonzero(diff > 16)),
            float(l1.max()), float(l1.mean()), float(np.percentile(l1, 99)),
            float(num_blobs), float(max_area),
            float(max(circs) if circs else 0), float(np.mean(circs) if circs else 0),
            float(max(solids) if solids else 0), float(np.mean(solids) if solids else 0),
            float(np.mean(extents) if extents else 0)
        ]
        return np.array(feat, dtype=np.float32)

    def predict_defect(self, gray):
        """
        Predicts defect category and probability scores.
        Returns:
        - predicted_class: 'crack', 'hole', 'rust', 'scratch', or 'normal'
        - confidence: float (e.g. 99.4)
        - probabilities: dict of class -> pct
        """
        if self.classifier is None:
            raise RuntimeError('Defect classifier is unavailable; refusing to fabricate a classification or confidence.')
            
        feat = self.extract_features(gray).reshape(1, -1)
        probs = self.classifier.predict_proba(feat)[0]
        pred_idx = np.argmax(probs)
        pred_class = self.class_names[pred_idx]
        conf = round(float(probs[pred_idx]) * 100.0, 1)
        
        prob_dict = {
            self.class_names[i]: round(float(probs[i]) * 100.0, 1)
            for i in range(len(self.class_names))
        }
        return pred_class, conf, prob_dict

    def _hessian_line_filter(self, gray, sigmas=[0.8, 1.4, 2.0]):
        resp = np.zeros_like(gray, dtype=np.float32)
        gray_f = gray.astype(np.float32)
        for sigma in sigmas:
            ksize = int(2 * round(3 * sigma) + 1)
            blurred = cv2.GaussianBlur(gray_f, (ksize, ksize), sigma)
            dx = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
            dy = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)
            dxx = cv2.Sobel(dx, cv2.CV_32F, 1, 0, ksize=3)
            dyy = cv2.Sobel(dy, cv2.CV_32F, 0, 1, ksize=3)
            dxy = cv2.Sobel(dx, cv2.CV_32F, 0, 1, ksize=3)
            trace = dxx + dyy
            disc = np.sqrt(np.maximum(0.0, (dxx - dyy)**2 + 4.0 * dxy**2))
            lambda1 = 0.5 * (trace + disc)
            resp = np.maximum(resp, np.maximum(0.0, lambda1) * (sigma ** 1.3))
        return resp

    def detect_crack(self, gray, sens=1.0):
        """Ultra-precise crack segmentation with branch tracing."""
        h, w = gray.shape
        smooth = cv2.bilateralFilter(gray, 7, 30, 30)
        
        k7 = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        k15 = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        bh = cv2.max(cv2.morphologyEx(smooth, cv2.MORPH_BLACKHAT, k7), cv2.morphologyEx(smooth, cv2.MORPH_BLACKHAT, k15))
        
        hline = self._hessian_line_filter(smooth, [0.8, 1.3, 1.8])
        hline_norm = (hline / hline.max() * 255.0).astype(np.uint8) if hline.max() > 0 else np.zeros_like(gray)
            
        saliency = cv2.addWeighted(bh, 0.50, hline_norm, 0.50, 0)
        peak = float(saliency.max())
        
        if peak < (16.0 / sens):
            return np.zeros_like(gray), []
            
        t_strong = max(24.0, peak * 0.35 / sens)
        t_weak = max(8.0, peak * 0.12 / sens)
        
        strong = (saliency >= t_strong).astype(np.uint8) * 255
        weak = (saliency >= t_weak).astype(np.uint8) * 255
        
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(weak, connectivity=8)
        
        valid_labels = []
        for lbl in range(1, num_labels):
            if stats[lbl, cv2.CC_STAT_AREA] < 8:
                continue
            if np.any(strong[labels == lbl]):
                valid_labels.append(lbl)
                
        if not valid_labels:
            return np.zeros_like(gray), []
            
        main_lbl = max(valid_labels, key=lambda l: stats[l, cv2.CC_STAT_AREA])
        main_centroid = centroids[main_lbl]
        
        mask = np.zeros_like(gray)
        for lbl in valid_labels:
            dist = np.linalg.norm(centroids[lbl] - main_centroid)
            if dist < 140 or stats[lbl, cv2.CC_STAT_AREA] > 40:
                mask[labels == lbl] = 255
                
        k_bridge = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_bridge)
        
        pts = np.argwhere(mask > 0)
        if len(pts) == 0:
            return mask, []
            
        y1, x1 = pts.min(axis=0)
        y2, x2 = pts.max(axis=0)
        
        x1 = max(0, int(x1 - 1))
        y1 = max(0, int(y1 - 1))
        x2 = min(w - 1, int(x2 + 1))
        y2 = min(h - 1, int(y2 + 1))
        
        boxes = [{
            'xmin': x1,
            'ymin': y1,
            'xmax': x2,
            'ymax': y2,
            'width': int(x2 - x1 + 1),
            'height': int(y2 - y1 + 1),
            'area_px': len(pts),
            'type': 'crack'
        }]
        return mask, boxes

    def detect_hole(self, gray, sens=1.0):
        """
        High-precision solid circular/elliptical hole and halo segmentation.
        Completely captures soft gradient diffusion edges without fragmenting holes,
        eliminates interior hollow dropouts, and guarantees exactly 1 clean bounding box per hole.
        """
        h, w = gray.shape
        smooth = cv2.bilateralFilter(gray, 7, 30, 30)
        
        # 1. Background surface estimation via large morphological closing
        # 85x85 kernel cleanly bridges large holes up to ~110px without depressing background level
        k_bg = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (85, 85))
        bg = cv2.morphologyEx(smooth, cv2.MORPH_CLOSE, k_bg, borderType=cv2.BORDER_REPLICATE)
        diff = cv2.subtract(bg, smooth)
        
        peak = float(diff.max())
        if peak < (28.0 / sens):
            return np.zeros_like(gray), []
            
        # 2. Hysteresis dual-thresholding:
        # t_strong identifies true hole core depressions
        # t_weak expands outwards to capture complete soft gradient halos
        t_strong = max(26.0, peak * 0.38 / sens)
        t_weak = max(14.0, peak * 0.17 / sens)
        
        strong = (diff >= t_strong)
        weak = (diff >= t_weak).astype(np.uint8) * 255
        
        # 3. Morphological bridging to fuse halo-to-core transitions
        k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        weak_closed = cv2.morphologyEx(weak, cv2.MORPH_CLOSE, k_close)
        
        # 4. Fill internal pinholes and hollow cavities so the mask is 100% solid
        cnts, _ = cv2.findContours(weak_closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        solid = np.zeros_like(gray)
        for c in cnts:
            if cv2.contourArea(c) >= 50:
                cv2.drawContours(solid, [c], -1, 255, -1)
                
        # 5. Connected components analysis with physical validation
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
        
        raw_components = []
        for lbl in range(1, num_labels):
            area = stats[lbl, cv2.CC_STAT_AREA]
            if area < 60:
                continue
            # Seed validation: must contain sufficient strong core pixels
            s_count = np.count_nonzero(strong[labels == lbl])
            if s_count < 12 or (s_count / float(area)) < 0.08:
                continue
            # Geometry validation: holes are circular/elliptical, reject elongated streaks
            bw = stats[lbl, cv2.CC_STAT_WIDTH]
            bh = stats[lbl, cv2.CC_STAT_HEIGHT]
            ar = max(bw, bh) / float(max(1, min(bw, bh)))
            if ar > 3.0:
                continue
                
            bx1 = max(0, int(stats[lbl, cv2.CC_STAT_LEFT] - 2))
            by1 = max(0, int(stats[lbl, cv2.CC_STAT_TOP] - 2))
            bx2 = min(w - 1, int(stats[lbl, cv2.CC_STAT_LEFT] + bw + 2))
            by2 = min(h - 1, int(stats[lbl, cv2.CC_STAT_TOP] + bh + 2))
            
            raw_components.append({
                'xmin': bx1,
                'ymin': by1,
                'xmax': bx2,
                'ymax': by2,
                'width': int(bx2 - bx1 + 1),
                'height': int(by2 - by1 + 1),
                'area_px': int(area),
                'lbls': [lbl]
            })
            
        if not raw_components:
            return np.zeros_like(gray), []
            
        # 6. Bounding box deduplication & merging
        # Merges any nested, overlapping, or split boxes belonging to the same hole
        raw_components.sort(key=lambda b: b['area_px'], reverse=True)
        merged = []
        while raw_components:
            curr = raw_components.pop(0)
            i = 0
            while i < len(raw_components):
                other = raw_components[i]
                ix1 = max(curr['xmin'], other['xmin'])
                iy1 = max(curr['ymin'], other['ymin'])
                ix2 = min(curr['xmax'], other['xmax'])
                iy2 = min(curr['ymax'], other['ymax'])
                iw = max(0, ix2 - ix1)
                ih = max(0, iy2 - iy1)
                inter = iw * ih
                curr_area = curr['width'] * curr['height']
                other_area = other['width'] * other['height']
                ioa_min = inter / float(min(curr_area, other_area)) if min(curr_area, other_area) > 0 else 0
                iou = inter / float(curr_area + other_area - inter) if (curr_area + other_area - inter) > 0 else 0
                if ioa_min > 0.30 or iou > 0.25:
                    curr['xmin'] = min(curr['xmin'], other['xmin'])
                    curr['ymin'] = min(curr['ymin'], other['ymin'])
                    curr['xmax'] = max(curr['xmax'], other['xmax'])
                    curr['ymax'] = max(curr['ymax'], other['ymax'])
                    curr['width'] = int(curr['xmax'] - curr['xmin'] + 1)
                    curr['height'] = int(curr['ymax'] - curr['ymin'] + 1)
                    curr['area_px'] += other['area_px']
                    curr['lbls'].extend(other['lbls'])
                    raw_components.pop(i)
                else:
                    i += 1
            curr['type'] = 'hole'
            merged.append(curr)
            
        # 7. Final solid segmentation mask
        final_mask = np.zeros_like(gray)
        for c in merged:
            for l in c['lbls']:
                final_mask[labels == l] = 255
                
        merged.sort(key=lambda b: b['area_px'], reverse=True)
        return final_mask, merged

    def detect_rust(self, gray, sens=1.0):
        """
        High-precision oxidation cloud & patch segmentation using local texture roughness.
        Eliminates background illumination gradient false positives and accurately traces
        macroscopic rust formations without spilling into unblemished metal.
        """
        h, w = gray.shape
        # 1. Light Gaussian blur to eliminate sensor shot noise while preserving oxidation grain
        smooth = cv2.GaussianBlur(gray, (5, 5), 1.2)
        smooth_f = smooth.astype(np.float32)
        
        # 2. Local texture roughness (standard deviation)
        ksize = 9
        mean = cv2.blur(smooth_f, (ksize, ksize))
        sq_mean = cv2.blur(smooth_f**2, (ksize, ksize))
        lstd = np.sqrt(np.maximum(0, sq_mean - mean**2))
        
        # Guard: unblemished metal has negligible texture variation
        if lstd.max() < (6.0 / sens):
            return np.zeros_like(gray), []
            
        # Scale to 0..255 for adaptive Otsu thresholding
        lstd_u8 = np.clip(lstd * (255.0 / max(1.0, lstd.max())), 0, 255).astype(np.uint8)
        otsu_u8, _ = cv2.threshold(lstd_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        otsu_real = float(otsu_u8) * (float(lstd.max()) / 255.0)
        thresh_val = max(3.2 / sens, otsu_real * 0.75 / sens)
        binary = (lstd >= thresh_val).astype(np.uint8) * 255
        
        # 3. Morphological closing to bridge micro-granules inside oxidation bodies
        k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k_close)
        
        # 4. Fill solid contours so rust clouds are complete without internal pinholes
        contours, _ = cv2.findContours(closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        solid_mask = np.zeros_like(gray)
        for c in contours:
            if cv2.contourArea(c) >= 60:
                cv2.drawContours(solid_mask, [c], -1, 255, -1)
                
        # 5. Connected components analysis
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(solid_mask, connectivity=8)
        valid_indices = []
        for i in range(1, num_labels):
            if stats[i, cv2.CC_STAT_AREA] >= 100:
                valid_indices.append(i)
                
        if not valid_indices:
            return np.zeros_like(gray), []
            
        valid_indices.sort(key=lambda i: stats[i, cv2.CC_STAT_AREA], reverse=True)
        max_area = stats[valid_indices[0], cv2.CC_STAT_AREA]
        box_thresh = max(180, int(max_area * 0.04))
        
        mask = np.zeros_like(gray)
        boxes = []
        
        for idx in valid_indices:
            area = stats[idx, cv2.CC_STAT_AREA]
            mask[labels == idx] = 255
            if area >= box_thresh:
                x = stats[idx, cv2.CC_STAT_LEFT]
                y = stats[idx, cv2.CC_STAT_TOP]
                bw = stats[idx, cv2.CC_STAT_WIDTH]
                bh = stats[idx, cv2.CC_STAT_HEIGHT]
                boxes.append({
                    'xmin': max(0, int(x)),
                    'ymin': max(0, int(y)),
                    'xmax': min(w - 1, int(x + bw)),
                    'ymax': min(h - 1, int(y + bh)),
                    'width': int(bw),
                    'height': int(bh),
                    'area_px': int(area),
                    'type': 'rust'
                })
                if len(boxes) >= 6:
                    break
                    
        return mask, boxes

    def detect_scratch(self, gray, sens=1.0):
        """
        High-precision continuous linear gouge and specular bead segmentation.
        Traces complete intersecting and multi-branch scratches end-to-end without
        fragmenting lines into disconnected specks, and yields cohesive bounding boxes.
        """
        h, w = gray.shape
        smooth = cv2.bilateralFilter(gray, 7, 30, 30)
        bg = cv2.medianBlur(smooth, 51)
        diff = cv2.absdiff(smooth, bg)

        k11 = cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11))
        bh = cv2.morphologyEx(smooth, cv2.MORPH_BLACKHAT, k11)
        th = cv2.morphologyEx(smooth, cv2.MORPH_TOPHAT, k11)

        # Multi-scale Hessian dark line filter to trace continuous gouge troughs
        sigmas = [0.8, 1.4, 2.2]
        h_dark = np.zeros_like(gray, dtype=np.float32)
        gray_f = smooth.astype(np.float32)
        for s in sigmas:
            ksize = int(2 * round(3 * s) + 1)
            blurred = cv2.GaussianBlur(gray_f, (ksize, ksize), s)
            dx = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
            dy = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)
            dxx = cv2.Sobel(dx, cv2.CV_32F, 1, 0, ksize=3)
            dyy = cv2.Sobel(dy, cv2.CV_32F, 0, 1, ksize=3)
            dxy = cv2.Sobel(dx, cv2.CV_32F, 0, 1, ksize=3)
            trace = dxx + dyy
            disc = np.sqrt(np.maximum(0.0, (dxx - dyy)**2 + 4.0 * dxy**2))
            l1 = np.maximum(0.0, 0.5 * (trace + disc))
            h_dark = np.maximum(h_dark, l1 * (s ** 1.3))

        # Physical guard: unblemished metal has negligible diff, blackhat, and line response
        if diff.max() < (22.0 / sens) and bh.max() < (22.0 / sens) and th.max() < (22.0 / sens) and h_dark.max() < (160.0 / sens):
            return np.zeros_like(gray), []

        # Natural scaling for ridge responses
        h_scaled = np.clip(h_dark * (255.0 / 500.0), 0, 255).astype(np.uint8)

        # Combine gouge troughs (bh + Hessian) and specular beads (th + diff)
        gouge = cv2.max(bh * 2, h_scaled)
        beads = cv2.max(th * 2, diff * 2)
        saliency = cv2.max(gouge, beads)

        peak = float(saliency.max())
        if peak < (30.0 / sens):
            return np.zeros_like(gray), []

        # Hysteresis dual-thresholding: strong seeds validate real scratch structures
        t_strong = max(42.0, peak * 0.35 / sens)
        t_weak = max(18.0, peak * 0.14 / sens)

        strong = (saliency >= t_strong).astype(np.uint8) * 255
        weak = (saliency >= t_weak).astype(np.uint8) * 255

        # Morphological bridging along scratch trajectories
        k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        weak_closed = cv2.morphologyEx(weak, cv2.MORPH_CLOSE, k_close)

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(weak_closed, connectivity=8)

        valid_labels = []
        for lbl in range(1, num_labels):
            if stats[lbl, cv2.CC_STAT_AREA] < 50:
                continue
            # Must contain at least one strong seed pixel
            if np.any(strong[labels == lbl]):
                valid_labels.append(lbl)

        if not valid_labels:
            return np.zeros_like(gray), []

        raw_mask = np.zeros_like(gray)
        for lbl in valid_labels:
            raw_mask[labels == lbl] = 255

        # Bridge closely adjacent scratch branches and intersecting lines
        k_bridge = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, k_bridge)

        # Extract connected components on bridged mask
        num_final, final_labels, final_stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        final_indices = [i for i in range(1, num_final) if final_stats[i, cv2.CC_STAT_AREA] >= 60]
        final_indices.sort(key=lambda i: final_stats[i, cv2.CC_STAT_AREA], reverse=True)

        if not final_indices:
            return np.zeros_like(gray), []

        max_area = final_stats[final_indices[0], cv2.CC_STAT_AREA]

        boxes = []
        for idx in final_indices:
            area = final_stats[idx, cv2.CC_STAT_AREA]
            if area < max(100, int(max_area * 0.05)):
                continue
            x = final_stats[idx, cv2.CC_STAT_LEFT]
            y = final_stats[idx, cv2.CC_STAT_TOP]
            bw = final_stats[idx, cv2.CC_STAT_WIDTH]
            bh_box = final_stats[idx, cv2.CC_STAT_HEIGHT]
            boxes.append({
                'xmin': max(0, int(x - 2)),
                'ymin': max(0, int(y - 2)),
                'xmax': min(w - 1, int(x + bw + 2)),
                'ymax': min(h - 1, int(y + bh_box + 2)),
                'width': int(bw + 4),
                'height': int(bh_box + 4),
                'area_px': int(area),
                'type': 'scratch'
            })
            if len(boxes) >= 6:
                break

        return mask, boxes

    @staticmethod
    def is_color_image(img_bgr, threshold_ratio=0.02, threshold_diff=15):
        """
        Determines whether an image contains significant color channels
        or is effectively single-channel / grayscale.
        """
        if img_bgr is None or len(img_bgr.shape) < 3 or img_bgr.shape[2] == 1:
            return False
        b, g, r = cv2.split(img_bgr)
        diff = np.maximum(np.maximum(cv2.absdiff(b, g), cv2.absdiff(g, r)), cv2.absdiff(b, r))
        mean_diff = float(np.mean(diff))
        color_ratio = float(np.count_nonzero(diff > threshold_diff) / (img_bgr.shape[0] * img_bgr.shape[1]))
        return color_ratio > threshold_ratio or mean_diff > 4.0

    @staticmethod
    def render_unsupported_color_warning(img_bgr):
        """
        Covers the entire image in a semi-transparent red layout and adds a prominent
        warning banner indicating the model was not trained on this kind of image.
        """
        h, w = img_bgr.shape[:2]
        annotated = img_bgr.copy()

        # 1. Semi-transparent red wash over the entire image
        red_layer = np.zeros_like(img_bgr)
        red_layer[:] = (0, 0, 220)  # Red in BGR
        annotated = cv2.addWeighted(red_layer, 0.38, annotated, 0.62, 0)

        # 2. Centered warning card
        card_w = min(int(w * 0.94), max(110, int(w * 0.85)))
        card_h = min(int(h * 0.45), max(45, int(h * 0.24)))
        card_h = max(card_h, 75 if h >= 200 else 45)

        cx, cy = w // 2, h // 2
        x1 = max(0, cx - card_w // 2)
        y1 = max(0, cy - card_h // 2)
        x2 = min(w - 1, cx + card_w // 2)
        y2 = min(h - 1, cy + card_h // 2)

        card_overlay = annotated.copy()
        cv2.rectangle(card_overlay, (x1, y1), (x2, y2), (18, 18, 22), -1)
        cv2.addWeighted(card_overlay, 0.88, annotated, 0.12, 0, annotated)

        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 245), 2 if w >= 200 else 1)
        if x1 >= 2 and y1 >= 2 and w >= 200:
            cv2.rectangle(annotated, (x1 - 2, y1 - 2), (x2 + 2, y2 + 2), (255, 255, 255), 1)

        font = cv2.FONT_HERSHEY_DUPLEX
        if w >= 250 and h >= 200:
            f_scale = max(0.28, min(0.46, card_w / 700.0))
            lines = [
                ('[!] UNSUPPORTED IMAGE FORMAT', (0, 165, 255), f_scale * 0.92),
                ('MODEL WAS NOT TRAINED ON THIS', (255, 255, 255), f_scale * 1.02),
                ('KIND OF IMAGE', (255, 255, 255), f_scale * 1.02),
                ('Requires Grayscale Manufacturing Data', (200, 200, 200), f_scale * 0.78)
            ]
        else:
            f_scale = 0.25
            lines = [
                ('UNSUPPORTED FORMAT', (0, 165, 255), f_scale),
                ('NOT TRAINED ON THIS IMAGE', (255, 255, 255), f_scale),
                ('Requires Grayscale', (200, 200, 200), f_scale * 0.9)
            ]

        step_y = (y2 - y1) / (len(lines) + 1)
        for idx, (text, color, scale) in enumerate(lines):
            (tw, th), _ = cv2.getTextSize(text, font, scale, 1)
            line_y = int(y1 + step_y * (idx + 1) + th // 2)
            line_x = max(x1 + 2, cx - tw // 2)
            cv2.putText(annotated, text, (line_x, line_y), font, scale, color, 1, cv2.LINE_AA)

        return annotated

    def analyze(self, img_bgr, mode='auto', sensitivity=1.0, pad=2):
        """
        Complete AI Defect Analysis:
        1. Checks whether the image is grayscale or unsupported color format
        2. Predicts defect type & confidence using ML classifier
        3. Executes dedicated high-precision segmentation
        4. Generates bounding boxes, HUD labels, and exact coordinates
        """
        h, w = img_bgr.shape[:2]

        # Check for unsupported color/non-grayscale image
        if self.is_color_image(img_bgr):
            return {
                'annotated_bgr': img_bgr.copy(),
                'mask_bgr': np.zeros_like(img_bgr),
                'defect_type': 'unsupported',
                'ai_prediction': {
                    'predicted_class': 'unsupported',
                    'confidence': 0.0,
                    'probabilities': {'crack': 0.0, 'hole': 0.0, 'rust': 0.0, 'scratch': 0.0, 'normal': 0.0}
                },
                'image_size': {'width': w, 'height': h},
                'overall_box': None,
                'components': [],
                'has_defect': False,
                'is_supported': False,
                'error': "Model wasn't trained on this kind of image",
                'message': "Model was not trained on this kind of image (requires grayscale)"
            }

        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        
        # 1. AI Prediction & Probability
        ai_predicted_class, ai_confidence, ai_probabilities = self.predict_defect(gray)
        
        # 2. Determine target defect type
        mode_l = mode.lower()
        if mode_l in ['crack', 'hole', 'rust', 'scratch', 'normal']:
            active_type = mode_l
        else: # AUTO MODE: Uses AI Predicted Class!
            active_type = ai_predicted_class
            
        # 3. Dedicated Segmentation
        if active_type == 'crack':
            mask, components = self.detect_crack(gray, sensitivity)
        elif active_type == 'hole':
            mask, components = self.detect_hole(gray, sensitivity)
        elif active_type == 'rust':
            mask, components = self.detect_rust(gray, sensitivity)
        elif active_type == 'scratch':
            mask, components = self.detect_scratch(gray, sensitivity)
        else: # normal
            mask, components = np.zeros_like(gray), []

        # 4. Binary White Mark Mask
        white_mark_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
        
        # 5. Annotated Image
        annotated_bgr = img_bgr.copy()
        box_color = self.color_map.get(active_type, (0, 0, 245))
        accent_color = (255, 255, 0) # Cyan
        
        pts = np.argwhere(mask > 0)
        overall_box = None
        has_defect = len(pts) > 0 and active_type != 'normal'

        if has_defect:
            overlay = annotated_bgr.copy()
            overlay[mask > 0] = box_color
            cv2.addWeighted(overlay, 0.26, annotated_bgr, 0.74, 0, annotated_bgr)
            
            # Individual Boxes
            for idx, c in enumerate(components):
                x1, y1, x2, y2 = c['xmin'], c['ymin'], c['xmax'], c['ymax']
                bw = x2 - x1
                bh = y2 - y1
                cv2.rectangle(annotated_bgr, (x1, y1), (x2, y2), box_color, 2)
                
                c_len = min(8, min(bw, bh) // 3)
                if c_len > 2:
                    cv2.line(annotated_bgr, (x1, y1), (x1 + c_len, y1), accent_color, 2)
                    cv2.line(annotated_bgr, (x1, y1), (x1, y1 + c_len), accent_color, 2)
                    cv2.line(annotated_bgr, (x2, y1), (x2 - c_len, y1), accent_color, 2)
                    cv2.line(annotated_bgr, (x2, y1), (x2, y1 + c_len), accent_color, 2)
                    cv2.line(annotated_bgr, (x1, y2), (x1 + c_len, y2), accent_color, 2)
                    cv2.line(annotated_bgr, (x1, y2), (x1, y2 - c_len), accent_color, 2)
                    cv2.line(annotated_bgr, (x2, y2), (x2 - c_len, y2), accent_color, 2)
                    cv2.line(annotated_bgr, (x2, y2), (x2, y2 - c_len), accent_color, 2)

                badge_text = f"#{idx+1} {active_type.upper()}: {bw}x{bh}"
                font = cv2.FONT_HERSHEY_DUPLEX
                f_scale = 0.36
                (tw, th), _ = cv2.getTextSize(badge_text, font, f_scale, 1)
                
                bx1 = x1
                by1 = max(0, y1 - th - 6 if y1 >= th + 6 else y2 + 2)
                bx2 = min(w - 1, bx1 + tw + 6)
                by2 = by1 + th + 6
                
                cv2.rectangle(annotated_bgr, (bx1, by1), (bx2, by2), box_color, -1)
                cv2.rectangle(annotated_bgr, (bx1, by1), (bx2, by2), (255, 255, 255), 1)
                cv2.putText(annotated_bgr, badge_text, (bx1 + 3, by2 - 3), font, f_scale, (255, 255, 255), 1, cv2.LINE_AA)
                
                c['id'] = idx + 1
                c['class'] = active_type
                c['center_x'] = int((x1 + x2) / 2)
                c['center_y'] = int((y1 + y2) / 2)

            # Master Overall Bounding Box
            min_y, min_x = pts.min(axis=0)
            max_y, max_x = pts.max(axis=0)
            
            ox1 = max(0, int(min_x - pad))
            oy1 = max(0, int(min_y - pad))
            ox2 = min(w - 1, int(max_x + pad))
            oy2 = min(h - 1, int(max_y + pad))
            ow = ox2 - ox1
            oh = oy2 - oy1
            
            x_center = (ox1 + ox2) / (2.0 * w)
            y_center = (oy1 + oy2) / (2.0 * h)
            norm_w = ow / float(w)
            norm_h = oh / float(h)
            
            cls_id = self.class_map.get(active_type, 0)
            overall_box = {
                'xmin': ox1,
                'ymin': oy1,
                'xmax': ox2,
                'ymax': oy2,
                'width': ow,
                'height': oh,
                'center_x': int((ox1 + ox2) / 2),
                'center_y': int((oy1 + oy2) / 2),
                'area_px': len(pts),
                'coverage_pct': round((len(pts) / (w * h)) * 100, 2),
                'yolo': [cls_id, round(x_center, 6), round(y_center, 6), round(norm_w, 6), round(norm_h, 6)]
            }
        else:
            cv2.putText(annotated_bgr, "NORMAL: NO DEFECT DETECTED", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 0), 2, cv2.LINE_AA)

        return {
            'annotated_bgr': annotated_bgr,
            'mask_bgr': white_mark_bgr,
            'defect_type': active_type,
            'ai_prediction': {
                'predicted_class': ai_predicted_class,
                'confidence': ai_confidence,
                'probabilities': ai_probabilities
            },
            'image_size': {'width': w, 'height': h},
            'overall_box': overall_box,
            'components': components,
            'has_defect': has_defect
        }

    @staticmethod
    def encode_base64(img_bgr, ext='.png'):
        success, buffer = cv2.imencode(ext, img_bgr)
        if not success:
            raise ValueError("Could not encode image")
        return f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
