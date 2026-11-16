const video = document.getElementById('webcam');
const canvas = document.getElementById('outputCanvas');
const ctx = canvas.getContext('2d');
const targetInput = document.getElementById('targetInput');
const updateBtn = document.getElementById('updateBtn');

let session = null;
let currentPrompt = "blue pencil case";

// 1. スマホのバックカメラを起動
async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // 外向きカメラ
                width: { ideal: 640 },
                height: { ideal: 640 }
            }
        });
        video.srcObject = stream;
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
        });
    } catch (err) {
        console.error("カメラの起動に失敗しました:", err);
        alert("カメラのアクセスが許可されていないか、利用できません。");
    }
}

// 2. ONNX Runtime Webでモデルをロード
async function loadModel() {
    console.log("AIモデルをロード中...");
    try {
        // WebGPUが利用可能なら優先し、フォールバックとしてWASMを使用
        session = await ort.InferenceSession.create('./yolov8s-worldv2.onnx', {
            executionProviders: ['webgpu', 'wasm']
        });
        console.log("AIモデルのロード完了！");
    } catch (e) {
        console.error("モデルのロードに失敗しました:", e);
        alert("AIモデルのロードに失敗しました。コンソールを確認してください。");
    }
}

// 3. ユーザーが言葉を変更したときの処理
updateBtn.addEventListener('click', () => {
    currentPrompt = targetInput.value.trim();
    console.log(`検出ワードが変更されました: ${currentPrompt}`);
    // （※YOLO-Worldの動的プロンプト対応の拡張ポイント）
    alert(`検出ターゲットを "${currentPrompt}" に更新しました`);
});

// 4. 画像の前処理（Canvasからモデル入力の640x640テンソルへ変換）
function preprocess(videoElement) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 640;
    tempCanvas.height = 640;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(videoElement, 0, 0, 640, 640);

    const imgData = tempCtx.getImageData(0, 0, 640, 640);
    const pixels = imgData.data;

    const red = new Float32Array(640 * 640);
    const green = new Float32Array(640 * 640);
    const blue = new Float32Array(640 * 640);

    for (let i = 0; i < pixels.length / 4; i++) {
        red[i] = pixels[i * 4] / 255.0;
        green[i] = pixels[i * 4 + 1] / 255.0;
        blue[i] = pixels[i * 4 + 2] / 255.0;
    }

    const input = new Float32Array(3 * 640 * 640);
    input.set(red, 0);
    input.set(green, 640 * 640);
    input.set(blue, 2 * 640 * 640);

    return new ort.Tensor('float32', input, [1, 3, 640, 640]);
}

// 5. メインの検出ループ
async function detectionLoop() {
    if (session && video.readyState === video.HAVE_ENOUGH_DATA) {
        // キャンバスをクリア
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        try {
            // 前処理と推論の実行
            const inputTensor = preprocess(video);
            const feeds = { images: inputTensor };
            const results = await session.run(feeds);
            
            // 出力テンソルの取得（モデル構造に応じたパース処理）
            const outputKey = Object.keys(results)[0];
            const outputData = results[outputKey].data;

            // 簡易的なバウンディングボックス描画のプレースホルダー
            // （※出力の形状に合わせてここに座標計算とctx.strokeRectを実装します）
            
        } catch (err) {
            console.error("推論エラー:", err);
        }
    }

    requestAnimationFrame(detectionLoop);
}

// アプリの初期化
async function main() {
    await setupCamera();
    await loadModel();
    detectionLoop();
}

main();
