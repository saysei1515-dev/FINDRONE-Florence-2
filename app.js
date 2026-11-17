const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");

let isSearching = false;
let searchTimer = null;
let isRequestInFlight = false;
let lastSaveTime = 0;

// 1. スマホの背面カメラを即座に起動
async function initCamera() {
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
    status.innerText = "エラー: カメラ権限が許可されていません";
    status.style.color = "#ff4444";
  }
}
initCamera();

// 2. 検索ワードの決定＆サーバーでの翻訳（決定ボタンを押した時）
window.updateTarget = async function() {
  const serverIp = document.getElementById("serverIp").value.trim();
  const inputElement = document.getElementById("targetObject");
  const keyword = inputElement.value.trim();

  if (!keyword) {
    alert("探すものを入力してください！");
    return;
  }
  if (!serverIp) {
    alert("先にお手元のPCのIPアドレスを入力してください！");
    document.getElementById("serverIp").focus();
    return;
  }

  status.innerText = "🔄 サーバーで翻訳中...";
  status.style.color = "#ffc107";

  try {
    const response = await fetch(`http://${serverIp}:5000/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: keyword })
    });

    if (!response.ok) throw new Error("翻訳サーバーエラー");

    const data = await response.json();
    
    // ★ 翻訳された英語を入力欄に上書き！
    inputElement.value = data.translated;
    
    status.innerText = `🎯 「${keyword}」➔ 英語: [${data.translated}] に設定しました`;
    status.style.color = "#00ff00";

  } catch (err) {
    console.error("翻訳リクエストエラー:", err);
    status.innerText = "⚠️ 翻訳に失敗しました（入力値をそのまま使用します）";
    status.style.color = "#ff4444";
  }
};

// 3. 探索スタート（ループ開始）
window.startDetection = async function() {
  const serverIp = document.getElementById("serverIp").value.trim();
  const inputVal = document.getElementById("targetObject").value.trim();

  if (!serverIp) {
    alert("PCのIPアドレスを入力してください！");
    document.getElementById("serverIp").focus();
    return;
  }
  if (!inputVal) {
    alert("探すものを入力してください！");
    document.getElementById("targetObject").focus();
    return;
  }

  // スタート時にもし翻訳がまだなら自動で一度翻訳＆上書きを実行
  await window.updateTarget();
  const finalizedKeyword = document.getElementById("targetObject").value.trim();

  isSearching = true;
  startButton.style.display = "none";
  stopButton.style.display = "block";
  status.innerText = `🔍 「${finalizedKeyword}」をYOLO-Worldで探索中...`;
  status.style.color = "#00ff00";

  // 0.5秒ごとにPCサーバーへフレームを送信（翻訳済みの英語キーワードを送信）
  searchTimer = setInterval(async () => {
    if (!isSearching || isRequestInFlight || video.videoWidth === 0) return;
    await sendFrameToPC(serverIp, finalizedKeyword);
  }, 500);
};

// 4. 探索ストップ
window.stopDetection = function() {
  isSearching = false;
  clearInterval(searchTimer);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました";
  status.style.color = "#aaa";
};

// 5. PCサーバーへ画像と翻訳済みキーワードを送信
async function sendFrameToPC(ip, keyword) {
  isRequestInFlight = true;
  try {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 320;
    tempCanvas.height = Math.round(video.videoHeight * (320 / video.videoWidth));
    const tCtx = tempCanvas.getContext("2d");
    tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, "image/jpeg", 0.6));
    if (!blob) {
      isRequestInFlight = false;
      return;
    }

    const formData = new FormData();
    formData.append("image", blob, "frame.jpg");
    formData.append("keyword", keyword);

    const response = await fetch(`http://${ip}:5000/detect`, {
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

// 6. 検出枠（バウンディングボックス）の描画 ＆ 履歴保存
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

    const now = Date.now();
    if (now - lastSaveTime > 3000) {
      saveFoundImage({ x: x/scaleX, y: y/scaleY, width: w/scaleX, height: h/scaleY });
      lastSaveTime = now;
    }
  });
}

// ================= 発見履歴・フォルダ機能 =================
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
  if (modal) modal.style.display = "none";
};

function saveFoundImage(bbox) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = bbox.width;
  tempCanvas.height = bbox.height;
  tempCanvas.getContext("2d").drawImage(video, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
  addGalleryThumbnail(tempCanvas.toDataURL("image/jpeg"));
}
