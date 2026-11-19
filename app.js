import os
import cv2
import torch
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLOWorld
from deep_translator import MyMemoryTranslator
from pyngrok import ngrok

try:
    from google.colab import userdata
except ImportError:
    userdata = None

app = Flask(__name__)
CORS(app)


def load_ngrok_token() -> str:
    token = ""
    if userdata is not None:
        try:
            token = (userdata.get("NGROK_AUTHTOKEN") or "").strip()
        except Exception:
            token = ""
    if not token:
        token = os.environ.get("NGROK_AUTHTOKEN", "").strip()
    return token


ngrok_token = load_ngrok_token()
if ngrok_token:
    try:
        ngrok.set_auth_token(ngrok_token)
        print("✅ ngrokトークンを読み込みました")
    except Exception as e:
        print(f"⚠️ ngrokトークンの設定で警告が出ました: {e}")

device = "cuda" if torch.cuda.is_available() else "cpu"
use_half = device == "cuda"
print(f"🖥️ 実行デバイス: {device} (half={use_half})")

print("YOLO-World AIモデルを読み込んでいます...")
model = YOLOWorld("yolov8s-worldv2.pt").to(device)
print("モデルの読み込みが完了しました！")

translator = MyMemoryTranslator(source="japanese", target="english")
translation_cache = {}
current_model_class = None


@app.route("/translate", methods=["POST"])
def translate_word():
    keyword_jp = ""
    try:
        data = request.get_json(silent=True) or {}
        keyword_jp = str(data.get("keyword", "")).strip()

        if not keyword_jp:
            return jsonify({"translated": "cup"})

        if keyword_jp in translation_cache:
            target_word = translation_cache[keyword_jp]
            return jsonify({"translated": target_word})

        if any(ord(c) > 127 for c in keyword_jp):
            try:
                translated = translator.translate(keyword_jp)
                target_word = translated.strip().lower() if translated else keyword_jp.lower()
                translation_cache[keyword_jp] = target_word
            except Exception as e:
                print(f"⚠️ 翻訳AIエラー: {e}")
                target_word = keyword_jp.lower()
        else:
            target_word = keyword_jp.lower()
            translation_cache[keyword_jp] = target_word

        return jsonify({"translated": target_word})
    except Exception as e:
        print(f"翻訳ルートエラー: {e}")
        fallback = keyword_jp.lower() if keyword_jp else "cup"
        return jsonify({"translated": fallback}), 500


@app.route("/detect", methods=["POST"])
def res_detect():
    global current_model_class
    try:
        file = request.files.get("image")
        target_word = request.form.get("keyword", "").strip().lower() or "cup"

        if not file:
            return jsonify({"error": "画像がありません"}), 400

        npimg = np.frombuffer(file.read(), np.uint8)
        img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)

        if img is None:
            return jsonify({"error": "画像のデコードに失敗しました"}), 400

        # クラスが変わったときだけ set_classes を呼ぶ
        if current_model_class != target_word:
            model.set_classes([target_word])
            current_model_class = target_word
            print(f"🎯 検出クラス切替: [{target_word}]")

        results = model(
            img,
            imgsz=320,
            conf=0.15,
            half=use_half,
            device=device,
            verbose=False,
        )

        detections = []
        h, w, _ = img.shape

        for r in results:
            for box in r.boxes:
                xyxy = box.xyxy[0].tolist()
                xmin = int((xyxy[0] / w) * 1000)
                ymin = int((xyxy[1] / h) * 1000)
                xmax = int((xyxy[2] / w) * 1000)
                ymax = int((xyxy[3] / h) * 1000)
                conf = float(box.conf[0])

                detections.append({
                    "box_2d": [ymin, xmin, ymax, xmax],
                    "label": target_word,
                    "confidence": round(conf, 2),
                })

        return jsonify({"detections": detections})
    except Exception as e:
        print(f"エラー発生: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    try:
        ngrok.kill()
    except Exception:
        pass

    tunnel = ngrok.connect(5000)
    public_url = tunnel.public_url if hasattr(tunnel, "public_url") else str(tunnel)
    print("==================================================")
    print("🌍 外部公開URL (FINDRONEアプリのURL欄に入力):")
    print(public_url)
    print("==================================================")

    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
