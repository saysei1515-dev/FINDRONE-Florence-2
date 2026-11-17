let video = document.getElementById("video");
let canvas = document.getElementById("outputCanvas");
let ctx = canvas.getContext("2d");
let status = document.getElementById("status");
let startButton = document.getElementById("startButton");
let stopButton = document.getElementById("stopButton");
let connStatus = document.getElementById("connectionStatus");

let isSearching = false;
let searchTimer = null;
let isRequestInFlight = false;
let currentSearchWord = "cup";
let lastSaveTime = 0;

// PeerJS初期化（ページ読み込み時に自動でバックグラウンド接続待機）
const peer = new Peer();
let conn = null;

// 📖 よく使う日本語・カタカナを英語に変換する辞書マップ
const jpToEnMap = {
  // ギター・楽器系
  "ギター": "guitar", "アコギ": "guitar", "エレキ": "guitar",
  "ベース": "bass", "ピアノ": "piano", "ドラム": "drum",
  
  // 日用品・ガジェット系
  "コップ": "cup", "カップ": "cup", "マグカップ": "cup",
  "ペン": "pen", "ボールペン": "pen", "ノート": "book",
  "スマホ": "cell phone", "スマートフォン": "cell phone", "携帯": "cell phone",
  "パソコン": "laptop", "ノートパソコン": "laptop", "PC": "laptop",
  "本": "book", "書籍": "book", "雑誌": "book",
  "ボトル": "bottle", "ペットボトル": "bottle", "水筒": "bottle",
  "イス": "chair", "椅子": "chair",
  "机": "dining table", "テーブル": "dining table",
  "時計": "clock", "腕時計": "clock",
  "リモコン": "remote", "めがね": "glasses", "メガネ": "glasses",
  "バッグ": "bag", "かばん": "bag", "リュック": "backpack",
  
  // 人・その他
  "人": "person", "ひと": "person"
};

// 起動時にスマホ側のカメラをプレビュー表示しておく
async function initCameraPreview() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "environment" }, 
      audio: false 
    });
    video.srcObject = stream;
    status.innerText = "ステータス: 準備完了 (探索スタートを押してください)";
    status.style.color = "#00ff00";
  } catch (err) {
    console.error("カメラ起動エラー:", err);
    status.innerText = "エラー: カメラの起動に失敗しました";
    status.style.color = "#ff4444";
  }
}
initCameraPreview();

// ターゲットの更新（辞書マップによる即時変換）
window.updateTarget = function() {
  let inputVal = document.getElementById("targetObject").value.trim();
  if (!inputVal) { alert("探すものを入力してください！"); return; }

  let searchWord = inputVal.toLowerCase();

  if (jpToEnMap[inputVal]) {
    searchWord = jpToEnMap[inputVal];
  } else if (/^[a-zA-Z0-9\s]+$/.test(inputVal)) {
    searchWord = inputVal.toLowerCase();
  }

  currentSearchWord = searchWord;
  status.innerText = `🎯 「${inputVal}」 (${currentSearchWord}) を探します`;
  status.style.color = "#00ff00";
  document.getElementById("targetObject").value = currentSearchWord;
};

// 探索スタート（IPアドレスを入力して即座にYOLO-Worldへ送信開始）
window.startCamera = function() {
  const inputVal = document.getElementById("targetObject").value.trim();
  const pcIp = document.getElementById("pcIdInput").value.trim();

  if (!inputVal) {
    alert("探すものを入力してください！");
    document.getElementById("targetObject").focus();
    return;
  }
  if (!pcIp) {
    alert("PCのIPアドレスを入力してください！");
    document.getElementById("pcIdInput").focus();
    return;
  }
  
  isSearching = true;
  
  startButton.style.display = "none";
  stopButton.style.display = "block";
  status.innerText = `🔍 「${currentSearchWord}」をYOLO-Worldで探索中...`;
  status.style.color = "#00ff00";

  // 約0.5秒（500ms）ごとにフレームをPCサーバーへ送信
  searchTimer = setInterval(async () => {
    if (!isSearching || isRequestInFlight || video.videoWidth === 0) return;
    await sendFrameToPC();
  }, 500);
};

// 探索ストップ
window.stopCamera = function() {
  isSearching = false;
  clearInterval(searchTimer);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました";
  status.style.color = "#aaa";
};

// PCのFlaskサーバー（YOLO-World）へフレームを送信して検出結果を受け取る
async function sendFrameToPC() {
  isRequestInFlight = true;

  try {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 320;
    tempCanvas.height = Math.round(video.videoHeight * (320 / video.videoWidth));
    const tCtx = tempCanvas.getContext("2d");
    tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, "image/jpeg", 0.6));
    if (!blob) { isRequestInFlight = false; return; }

    const formData = new FormData();
    formData.append("image", blob, "frame.jpg");
    formData.append("keyword", currentSearchWord);

    const pcIp = document.getElementById("pcIdInput").value.trim();
    const response = await fetch(`http://${pcIp}:5000/detect`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) throw new Error("サーバー応答エラー");

    const data = await response.json();
    drawDetections(data.detections);

  } catch (err) {
    console.error("通信エラー:", err);
  } finally {
    isRequestInFlight = false;
  }
}

// 検出されたバウンディングボックスの描画
function drawDetections(detections) {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!detections || detections.length === 0) return;

  const scaleX = canvas.width / video.videoWidth;
  const scaleY = canvas.height / video.videoHeight;

  detections.forEach(det => {
    const [ymin, xmin, ymax, xmax] = det.box_2d;
    const x = (xmin / 1000) * video.videoWidth * scaleX;
    const y = (ymin / 1000) * video.videoHeight * scaleY;
    const w = ((xmax - xmin) / 1000) * video.videoWidth * scaleX;
    const h = ((ymax - ymin) / 1000) * video.videoHeight * scaleY;

    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = "rgba(0, 255, 0, 0.7)";
    ctx.fillRect(x, y > 25 ? y - 25 : 0, w, 25);

    ctx.fillStyle = "#000";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(`${det.label} (${det.confidence})`, x + 5, y > 25 ? y - 7 : 18);

    // 3秒に1回、発見した画像を履歴（フォルダ）に保存
    const now = Date.now();
    if (now - lastSaveTime > 3000) {
      saveFoundImage({ x: x/scaleX, y: y/scaleY, width: w/scaleX, height: h/scaleY });
      lastSaveTime = now;
    }
  });
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
  tempCanvas.getContext("2d").drawImage(video, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
  addGalleryThumbnail(tempCanvas.toDataURL("image/jpeg"));
}
