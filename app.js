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
    }
}

// 3. ユーザーが言葉を変更したときの処理
updateBtn.addEventListener('click', () => {
    currentPrompt = targetInput.value.trim();
    console.log(`検出ワードが変更されました: ${currentPrompt}`);
    // ※ここで新しい言葉に応じたテキスト特徴量の更新処理をフックします
});

// 4. メインの検出ループ
async function detectionLoop() {
    if (!session) {
        requestAnimationFrame(detectionLoop);
        return;
    }

    // キャンバスに現在のビデオフレームを描画
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // TODO: 
    // 1. canvasから画像データを取得し、モデルの入力サイズ（例: 640x640）にリサイズ・正規化する
    // 2. session.run() を実行して推論結果を得る
    // 3. バウンディングボックスと設定された言葉（currentPrompt）を画面に描画する

    requestAnimationFrame(detectionLoop);
}

// アプリの初期化
async function main() {
    await setupCamera();
    await loadModel();
    detectionLoop();
}

main();
