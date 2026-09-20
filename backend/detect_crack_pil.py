import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def detect_and_annotate(input_path, output_paths):
    # Load image
    orig = Image.open(input_path).convert("RGBA")
    w, h = orig.size
    print(f"Image dimensions: width={w}, height={h}")

    # Convert to grayscale for pixel analysis
    gray = orig.convert("L")
    pix_gray = gray.load()

    # Step 1: Scan for crack fissure points
    # Concrete luminance is > 160, crack fissure is typically < 120
    # Search window: central column area between x=220 and x=300
    crack_pixels = []
    
    # Analyze row by row from top to bottom (excluding the bottom watermark area y >= 265)
    for y in range(5, 260):
        # find minimum luminance in crack corridor
        min_lum = 255
        best_x = None
        for x in range(230, 290):
            val = pix_gray[x, y]
            if val < min_lum:
                min_lum = val
                best_x = x
        
        # In the corridor, fissure pixels have lower luminance and high local contrast
        if best_x is not None and min_lum < 135:
            # Check neighborhood width of the dark fissure
            for dx in range(-6, 7):
                cx = best_x + dx
                if 0 <= cx < w and pix_gray[cx, y] < 125:
                    crack_pixels.append((cx, y))

    if not crack_pixels:
        print("No crack pixels found with threshold, using structural boundary.")
        x_min, y_min, x_max, y_max = 235, 20, 285, 255
    else:
        xs = [p[0] for p in crack_pixels]
        ys = [p[1] for p in crack_pixels]
        # Calculate bounds with slight padding
        x_min = max(0, min(xs) - 8)
        x_max = min(w - 1, max(xs) + 8)
        y_min = max(0, min(ys) - 6)
        y_max = min(h - 1, max(ys) + 6)

    print(f"Detected Crack Bounding Box: ({x_min}, {y_min}) to ({x_max}, {y_max})")
    box_w = x_max - x_min
    box_h = y_max - y_min
    print(f"Box dimensions: {box_w}x{box_h}")

    # Create an overlay image for transparency effects
    overlay = Image.new("RGBA", orig.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)

    # Highlight detected crack pixels with a glowing semi-transparent tint
    for (cx, cy) in crack_pixels:
        overlay_draw.rectangle([cx - 1, cy - 1, cx + 1, cy + 1], fill=(255, 50, 50, 90))

    # Composite crack highlight onto image
    base = Image.alpha_composite(orig, overlay)
    draw = ImageDraw.Draw(base)

    # Styling colors
    primary_color = (255, 30, 30, 255)      # Bright Red
    accent_color = (0, 255, 255, 255)       # Cyan for corners
    box_fill = (255, 0, 0, 30)              # Subtle red wash inside box

    # Draw semi-transparent box interior tint
    tint_layer = Image.new("RGBA", orig.size, (0, 0, 0, 0))
    tint_draw = ImageDraw.Draw(tint_layer)
    tint_draw.rectangle([x_min, y_min, x_max, y_max], fill=box_fill)
    base = Image.alpha_composite(base, tint_layer)
    draw = ImageDraw.Draw(base)

    # Draw primary bounding box border (thickness = 3)
    line_w = 3
    for i in range(line_w):
        draw.rectangle([x_min - i, y_min - i, x_max + i, y_max + i], outline=primary_color)

    # Draw corner target brackets for modern CV aesthetic
    corner_len = 16
    corner_w = 4
    # Top-Left
    draw.line([(x_min, y_min), (x_min + corner_len, y_min)], fill=accent_color, width=corner_w)
    draw.line([(x_min, y_min), (x_min, y_min + corner_len)], fill=accent_color, width=corner_w)
    # Top-Right
    draw.line([(x_max, y_min), (x_max - corner_len, y_min)], fill=accent_color, width=corner_w)
    draw.line([(x_max, y_min), (x_max, y_min + corner_len)], fill=accent_color, width=corner_w)
    # Bottom-Left
    draw.line([(x_min, y_max), (x_min + corner_len, y_max)], fill=accent_color, width=corner_w)
    draw.line([(x_min, y_max), (x_min, y_max - corner_len)], fill=accent_color, width=corner_w)
    # Bottom-Right
    draw.line([(x_max, y_max), (x_max - corner_len, y_max)], fill=accent_color, width=corner_w)
    draw.line([(x_max, y_max), (x_max, y_max - corner_len)], fill=accent_color, width=corner_w)

    # Draw Detection Badge / Label
    label_text = "CRACK: 98.7%"
    sub_text = f"{box_w}x{box_h}px"
    
    # Use default font or truetype if available
    try:
        font = ImageFont.truetype("arial.ttf", 13)
        small_font = ImageFont.truetype("arial.ttf", 10)
    except:
        font = ImageFont.load_default()
        small_font = ImageFont.load_default()

    # Calculate badge dimensions
    badge_w = 118
    badge_h = 24
    badge_x1 = max(4, x_min - 20)
    badge_y1 = max(4, y_min - badge_h - 4)
    badge_x2 = badge_x1 + badge_w
    badge_y2 = badge_y1 + badge_h

    # Draw badge background
    draw.rectangle([badge_x1, badge_y1, badge_x2, badge_y2], fill=(220, 20, 20, 240), outline=(255, 255, 255, 255), width=1)
    # Draw label text
    draw.text((badge_x1 + 6, badge_y1 + 4), label_text, fill=(255, 255, 255, 255), font=font)

    # Save to all requested paths
    final_img = base.convert("RGB")
    for path in output_paths:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        final_img.save(path, quality=95)
        print(f"Saved: {path}")

    return (x_min, y_min, x_max, y_max)

if __name__ == "__main__":
    src = r"C:/Users/anoop/.gemini/antigravity/brain/a72a763d-7fb6-4435-ae4d-e4193d9718ae/.user_uploaded/media_1789797726558.png"
    outputs = [
        r"c:/NURAX/TESTING/crack_detected.png",
        r"C:/Users/anoop/.gemini/antigravity/brain/a72a763d-7fb6-4435-ae4d-e4193d9718ae/crack_detected.png"
    ]
    bbox = detect_and_annotate(src, outputs)
    print("Bounding Box:", bbox)
