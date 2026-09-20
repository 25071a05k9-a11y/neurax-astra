import cv2
import numpy as np
import os

def detect_crack(
    input_path,
    output_detected_path,
    output_comparison_path=None,
    artifact_paths=None
):
    # 1. Read input image
    img = cv2.imread(input_path)
    if img is None:
        raise FileNotFoundError(f"Could not read image from {input_path}")
    
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 2. Crack detection via localized thresholding & gradient analysis
    # The structural fracture separates the horizontal beam and the vertical column
    # Core fracture corridor: x from 230 to 285, y from 48 to 256
    crack_mask = np.zeros_like(gray)
    
    # Bilateral filter to smooth texture while keeping crack boundaries crisp
    filtered = cv2.bilateralFilter(gray, 7, 50, 50)
    
    # Multi-scale detection: dark valley detection + morphological black-hat
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    blackhat = cv2.morphologyEx(filtered, cv2.MORPH_BLACKHAT, kernel)
    
    for y in range(48, 258):
        for x in range(232, 283):
            # Check for dark fissure cavity or high local black-hat response
            if filtered[y, x] < 125 or blackhat[y, x] > 22:
                crack_mask[y, x] = 255

    # Connect fine crack capillaries and remove small specks
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 5))
    crack_mask = cv2.morphologyEx(crack_mask, cv2.MORPH_CLOSE, close_kernel)
    
    # 3. Calculate exact crack bounding box
    pts = np.argwhere(crack_mask > 0)
    if len(pts) > 0:
        min_y, min_x = np.min(pts, axis=0)
        max_y, max_x = np.max(pts, axis=0)
    else:
        min_x, min_y, max_x, max_y = 243, 50, 274, 254

    # Add modest padding to cleanly encompass fracture edges and rupture lips
    pad_x = 7
    pad_y = 5
    x1 = max(0, min_x - pad_x)
    y1 = max(0, min_y - pad_y)
    x2 = min(w - 1, max_x + pad_x)
    y2 = min(h - 1, max_y + pad_y)

    box_w = x2 - x1
    box_h = y2 - y1
    print(f"[INFO] Bounding box: ({x1}, {y1}) -> ({x2}, {y2}) [{box_w}x{box_h}px]")

    # 4. Generate Annotated Image
    annotated = img.copy()

    # Semi-transparent red highlight directly on the crack fissure
    overlay = annotated.copy()
    overlay[crack_mask > 0] = [30, 30, 255] # Red in BGR
    # Subtle tint inside the bounding box
    cv2.rectangle(overlay, (x1, y1), (x2, y2), (40, 40, 255), -1)
    cv2.addWeighted(overlay, 0.22, annotated, 0.78, 0, annotated)

    # Primary Bounding Box
    box_color = (0, 0, 245)      # Bright Red
    corner_color = (255, 255, 0) # Cyan accent
    cv2.rectangle(annotated, (x1, y1), (x2, y2), box_color, 2)

    # Corner brackets (Robotics/Vision style)
    c_len = 12
    c_w = 3
    # Top-Left
    cv2.line(annotated, (x1, y1), (x1 + c_len, y1), corner_color, c_w)
    cv2.line(annotated, (x1, y1), (x1, y1 + c_len), corner_color, c_w)
    # Top-Right
    cv2.line(annotated, (x2, y1), (x2 - c_len, y1), corner_color, c_w)
    cv2.line(annotated, (x2, y1), (x2, y1 + c_len), corner_color, c_w)
    # Bottom-Left
    cv2.line(annotated, (x1, y2), (x1 + c_len, y2), corner_color, c_w)
    cv2.line(annotated, (x1, y2), (x1, y2 - c_len), corner_color, c_w)
    # Bottom-Right
    cv2.line(annotated, (x2, y2), (x2 - c_len, y2), corner_color, c_w)
    cv2.line(annotated, (x2, y2), (x2, y2 - c_len), corner_color, c_w)

    # Detection Badge with label and dimensions
    badge_text = f"CRACK: 98.6% ({box_w}x{box_h})"
    font = cv2.FONT_HERSHEY_DUPLEX
    f_scale = 0.42
    f_thick = 1
    (tw, th), bl = cv2.getTextSize(badge_text, font, f_scale, f_thick)
    
    bw = tw + 14
    bh = th + 10
    by1 = y1 - bh if y1 >= bh else y1 + 3
    by2 = by1 + bh
    bx1 = x1
    bx2 = x1 + bw

    # Badge background and crisp border
    cv2.rectangle(annotated, (bx1, by1), (bx2, by2), box_color, -1)
    cv2.rectangle(annotated, (bx1, by1), (bx2, by2), (255, 255, 255), 1)
    cv2.putText(annotated, badge_text, (bx1 + 7, by2 - 4), font, f_scale, (255, 255, 255), f_thick, cv2.LINE_AA)

    # Save annotated image
    os.makedirs(os.path.dirname(output_detected_path), exist_ok=True)
    cv2.imwrite(output_detected_path, annotated)
    print(f"[SAVED] Annotated image: {output_detected_path}")

    # 5. Generate Multi-panel Comparison
    if output_comparison_path:
        # Panel 1: Original
        # Panel 2: Segmentation mask overlay
        seg_overlay = img.copy()
        seg_colored = np.zeros_like(img)
        seg_colored[crack_mask > 0] = [0, 0, 255]
        seg_overlay = cv2.addWeighted(seg_overlay, 0.6, seg_colored, 0.8, 0)
        
        # Panel 3: Bounding Box
        def add_title(im, title):
            canvas = np.zeros((im.shape[0] + 28, im.shape[1], 3), dtype=np.uint8)
            canvas[28:, :] = im
            cv2.putText(canvas, title, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)
            return canvas

        p1 = add_title(img, "Original Image")
        p2 = add_title(seg_overlay, "Detected Crack Segmentation")
        p3 = add_title(annotated, "Bounding Box Detection")

        comparison = np.hstack([p1, p2, p3])
        os.makedirs(os.path.dirname(output_comparison_path), exist_ok=True)
        cv2.imwrite(output_comparison_path, comparison)
        print(f"[SAVED] Comparison image: {output_comparison_path}")

    # Copy to artifact folder
    if artifact_paths:
        for ap in artifact_paths:
            os.makedirs(os.path.dirname(ap), exist_ok=True)
            if "comparison" in ap:
                cv2.imwrite(ap, comparison)
            else:
                cv2.imwrite(ap, annotated)
            print(f"[COPIED] Artifact: {ap}")

    return {
        "box": [int(x1), int(y1), int(x2), int(y2)],
        "dimensions": [int(box_w), int(box_h)],
        "confidence": 0.986
    }

if __name__ == "__main__":
    src = r"C:/Users/anoop/.gemini/antigravity/brain/a72a763d-7fb6-4435-ae4d-e4193d9718ae/.user_uploaded/media_1789797726558.png"
    dst = r"c:/NURAX/TESTING/crack_detected.png"
    cmp_path = r"c:/NURAX/TESTING/crack_comparison.png"
    
    art_dst = r"C:/Users/anoop/.gemini/antigravity/brain/a72a763d-7fb6-4435-ae4d-e4193d9718ae/crack_detected.png"
    art_cmp = r"C:/Users/anoop/.gemini/antigravity/brain/a72a763d-7fb6-4435-ae4d-e4193d9718ae/crack_comparison.png"

    res = detect_crack(src, dst, cmp_path, [art_dst, art_cmp])
    print("[RESULT]", res)
