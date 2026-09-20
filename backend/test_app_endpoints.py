import urllib.request
import urllib.parse
import json
import zipfile
import base64

# 1. Test homepage
req = urllib.request.urlopen("http://localhost:5000/")
assert req.status == 200
html = req.read().decode('utf-8')
print("Homepage OK, status:", req.status, "Length:", len(html))

# 2. Test api/classes
req = urllib.request.urlopen("http://localhost:5000/api/classes")
assert req.status == 200
classes_data = json.loads(req.read().decode('utf-8'))
print("Classes API OK:", classes_data)

# 3. Test api/samples for scratch
req = urllib.request.urlopen("http://localhost:5000/api/samples?class=scratch")
assert req.status == 200
samples_data = json.loads(req.read().decode('utf-8'))
print("Samples API OK, scratch sample count:", len(samples_data.get('samples', [])))

# 4. Test api/analyze on scratch_00006.png
z = zipfile.ZipFile(r"C:\Users\anoop\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\C17CC801473B9BC7BFBC2C7550AE4A868272AFC3\transfers\2026-38\train.zip")
raw = z.read("train/scratch/scratch_00006.png")
b64_img = base64.b64encode(raw).decode('utf-8')

payload = json.dumps({
    "image": f"data:image/png;base64,{b64_img}",
    "mode": "auto",
    "sensitivity": 1.0
}).encode('utf-8')

req = urllib.request.Request("http://localhost:5000/api/analyze", data=payload, headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req)
assert resp.status == 200
result = json.loads(resp.read().decode('utf-8'))
print("Analyze API OK!")
print("  Defect Type:", result.get('defect_type'))
print("  AI Prediction:", result.get('ai_prediction'))
print("  Overall Box:", result.get('overall_box'))
print("  Component count:", len(result.get('components', [])))
for c in result.get('components', []):
    print("   ", c)

print("\nALL API AND SERVER ENDPOINTS VERIFIED SUCCESSFULLY!")
