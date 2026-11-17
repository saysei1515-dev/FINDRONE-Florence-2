import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let vision = undefined;

const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const connStatus = document.getElementById("connectionStatus");

let lastVideoTime = -1;
let currentSearchWord = "cup";
let lastSaveTime = 0; 

// PeerJS初期化
const peer = new Peer();
let conn = null;

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite"
};

// 初期AIロード（標準モデルに固定）
async function initializeAI() {
  status.innerText = "ステータス: AIモデルをロード中...";
  status.style.color = "#ffc107";
  
  try {
    vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
    );
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelPaths.lite0,
        delegate: "GPU"
      },
      scoreThreshold: 0.3,
      runningMode: runningMode
    });
    status.innerText = "ステータス: PCのIDを入力して接続してください";
    status.style.color = "#007bff";
  } catch (err) {
    console.error("AIのロードに失敗しました:", err);
    status.innerText = "エラー: AIのロードに失敗しました";
    status.style.color = "#ff4444";
  }
}
initializeAI();

// PC接続
window.connectToPC = function() {
  const pcId = document.getElementById("pcIdInput").value.trim();
  if (!pcId) { alert("PCのIDを入力してください！"); return; }
  
  connStatus.innerText = "ステータス: 接続中...";
  conn = peer.connect(pcId);
  
  conn.on('open', () => {
    connStatus.innerText = "ステータス: 接続完了 ✅";
    connStatus.style.color = "#28a745";
    startButton.disabled = false;
    startButton.innerText = "遠隔カメラ起動 & 探索スタート";
    status.innerText = "ステータス: 準備完了";
    status.style.color = "#00ff00";
  });
};

peer.on('call', (call) => {
  call.answer();
  call.on('stream', (remoteStream) => {
    video.srcObject = remoteStream;
    webcamRunning = true;
    startButton.style.display = "none";
    stopButton.style.display = "block";
    status.innerText = `ステータス: 探索中... (${currentSearchWord})`;
    status.style.color = "#00ff00";
    video.onloadeddata = () => { predictWebcam(); };
  });
});

// ターゲットの更新（入力された文字をそのままセット）
window.updateTarget = function() {
  let inputVal = document.getElementById("targetObject").value.trim().toLowerCase();
  if (!inputVal) { alert("探すものを入力してください！"); return; }
  
  currentSearchWord = inputVal;
  status.innerText = `🎯 「${currentSearchWord}」を探します`;
  status.style.color = "#00ff00";
};

// カメラ起動（バリデーション付き）
window.startCamera = function() {
  const inputVal = document.getElementById("targetObject").value.trim();
  if (!inputVal) {
    alert("探すものを入力してください！");
    document.getElementById("targetObject").focus();
    return;
  }
  if (!conn || !conn.open) { alert("先にPCと接続してください！"); return; }
  
  currentSearchWord = inputVal.toLowerCase();
  conn.send({ action: 'start', keyword: currentSearchWord, smartphoneId: peer.id });
  status.innerText = "ステータス: 遠隔カメラ起動要求を送信中...";
};

// カメラ停止
window.stopCamera = function() {
  if (conn && conn.open) conn.send({ action: 'stop' });
  webcamRunning = false;
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました";
};

// ================= リアルタイム推論ループ =================
async function predictWebcam() {
  if (!webcamRunning) return;
  
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
  }

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let foundTarget = false;

      if (objectDetector) {
        const detections = objectDetector.detectForVideo(video, performance.now());
        if (detections && detections.detections) {
          const scaleX = canvas.width / video.videoWidth;
          const scaleY = canvas.height / video.videoHeight;
          
          for (let detection of detections.detections) {
            const categoryName = detection.categories[0].categoryName.toLowerCase();
            const score = Math.round(detection.categories[0].score * 100);
            
            if (categoryName.includes(currentSearchWord)) {
              foundTarget = true;
              const bbox = detection.boundingBox;
              const x = bbox.originX * scaleX;
              const y = bbox.originY * scaleY;
              const width = bbox.width * scaleX;
              const height = bbox.height * scaleY;

              ctx.strokeStyle = "#00ff00";
              ctx.lineWidth = 4;
              ctx.strokeRect(x, y, width, height);
              
              ctx.fillStyle = "rgba(0, 255, 0, 0.7)";
              ctx.fillRect(x, y > 25 ? y - 25 : 0, width, 25);
              
              ctx.fillStyle = "#000";
              ctx.font = "bold 14px sans-serif";
              ctx.fillText(`${categoryName} ${score}%`, x + 5, y > 25 ? y - 7 : 18);

              const now = Date.now();
              if (now - lastSaveTime > 3000) {
                saveFoundImage(bbox);
                lastSaveTime = now;
              }
            }
          }
        }
      }

      if (foundTarget) {
        status.innerText = `🎉 発見しました！`;
        status.style.color = "#00ff00";
      } else {
        status.innerText = `🔍 探索中... (${currentSearchWord})`;
        status.style.color = "#aaa";
      }
    } catch (e) { 
      console.error(e); 
    }
  }

  if (webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }
}

// ================= 発見履歴・フォルダ機能用スクリプト =================
window.openHistoryFolder = function() {
  document.getElementById("historyFolderModal").style.display = "flex";
};

window.closeHistoryFolder = function() {
  document.getElementById("historyFolderModal").style.display = "none";
};

window.clearGallery = function() {
  document.getElementById("imageGallery").innerHTML = "";
};

function addGalleryThumbnail(dataUrl) {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;
  
  const img = document.createElement("img");
  img.src = dataUrl;
  img.style.cssText = "width: 100%; height: 100px; object-fit: cover; border-radius: 6px; border: 2px solid #00ff00; cursor: pointer;";
  img.onclick = () => {
    const modal = document.getElementById("imagePreviewModal");
    const previewImg = document.getElementById("previewImage");
    if (modal && previewImg) {
      previewImg.src = dataUrl;
      modal.style.display = "flex";
    }
  };
  gallery.prepend(img);
}

window.closePreview = function() {
  const modal = document.getElementById("imagePreviewModal");
  if (modal) {
    modal.style.display = "none";
  }
};

function saveFoundImage(bbox) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = bbox.width; 
  tempCanvas.height = bbox.height;
  tempCanvas.getContext("2d").drawImage(video, bbox.originX, bbox.originY, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
  addGalleryThumbnail(tempCanvas.toDataURL("image/jpeg"));
}
