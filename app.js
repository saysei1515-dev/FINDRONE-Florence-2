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

// ================= PeerJS ＆ 遠隔カメラ接続管理 =================
const peer = new Peer();
let conn = null;
let webcamRunning = false;
let html5QrCode = null;

peer.on('open', (id) => {
  console.log("スマホ側 Peer ID:", id);
});

// 別PCからのカメラ映像（ストリーム）を受信したときの処理
peer.on('call', (call) => {
  call.answer();
  call.on('stream', (remoteStream) => {
    video.srcObject = remoteStream;
    webcamRunning = true;
    status.innerText = "ステータス: 遠隔カメラ映像を受信中...";
    status.style.color = "#00ff00";
  });
});

// PC接続ボタン
window.connectToPC = function() {
  const pcId = document.getElementById("pcIdInput").value.trim();
  if (!pcId) {
    alert("PCのIDを入力してください！");
    return;
  }
  status.innerText = "ステータス: PCに接続中...";
  status.style.color = "#ffc107";

  conn = peer.connect(pcId);
  conn.on('open', () => {
    status.innerText = "ステータス: PC接続完了 ✅ (カメを起動を押してください)";
    status.style.color = "#00ff00";
    if (startButton) {
      startButton.disabled = false;
      startButton.innerText = "カメラを起動する"; // ← 接続完了後に表示を変更
    }
    const connStatus = document.getElementById("connectionStatus");
    if (connStatus) {
      connStatus.innerText = "ステータス: 接続完了 ✅";
      connStatus.style.color = "#28a745";
    }
  });
  conn.on('error', (err) => {
    console.error("Peer接続エラー:", err);
    status.innerText = "エラー: PCとの接続に失敗しました";
    status.style.color = "#ff4444";
  });
};

// QRコードスキャン機能（別PCのIDを読み取る）
window.startQrScanner = function() {
  const readerContainer = document.getElementById("qr-reader");
  if (readerContainer) readerContainer.style.display = "block";

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("qr-reader");
  }

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 200, height: 200 } },
    (decodedText) => {
      const pcIdInput = document.getElementById("pcIdInput");
      if (pcIdInput) pcIdInput.value = decodedText;
      window.stopQrScanner();
      alert("PCのIDを読み込みました！「接続」ボタンを押してください。");
    },
    (errorMessage) => {}
  ).catch(err => {
    alert("カメラの起動に失敗しました: " + err);
  });
};

window.stopQrScanner = function() {
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop().then(() => {
      const readerContainer = document.getElementById("qr-reader");
      if (readerContainer) readerContainer.style.display = "none";
    }).catch(err => {
      console.error("QRスキャナーの停止に失敗しました:", err);
    });
  }
};


// ================= 検索ワード翻訳（決定ボタン） =================
window.updateTarget = async function() {
  const serverIp = document.getElementById("serverIp").value.trim();
  const inputElement = document.getElementById("targetObject");
  const keyword = inputElement.value.trim();

  if (!keyword) {
    alert("探すものを入力してください！");
    return;
  }
  if (!serverIp) {
    alert("PCのIPアドレスを入力してください！");
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
    inputElement.value = data.translated;
    
    status.innerText = `🎯 「${keyword}」➔ 英語: [${data.translated}] に設定しました`;
    status.style.color = "#00ff00";

  } catch (err) {
    console.error("翻訳リクエストエラー:", err);
    status.innerText = "⚠️ 翻訳に失敗しました（入力値をそのまま使用します）";
    status.style.color = "#ff4444";
  }
};


// ================= 探索スタート・ストップ =================
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
  if (!conn || !conn.open) {
    alert("先にPCと接続してください！");
    return;
  }

  // 1. 翻訳がまだなら一度翻訳を実行
  await window.updateTarget();
  const finalizedKeyword = document.getElementById("targetObject").value.trim();

  // 2. 別PCへ遠隔カメラ起動の指示を送信
  conn.send({ action: 'start', keyword: finalizedKeyword, smartphoneId: peer.id });

  isSearching = true;
  startButton.style.display = "none";
  stopButton.style.display = "block";
  status.innerText = `🔍 「${finalizedKeyword}」をYOLO-Worldで探索中...`;
  status.style.color = "#00ff00";

  // 3. 0.5秒ごとにPCサーバーへフレームを送信し、YOLO-World検出を実行
  searchTimer = setInterval(async () => {
    if (!isSearching || isRequestInFlight || video.videoWidth === 0) return;
    await sendFrameToPC(serverIp, finalizedKeyword);
  }, 500);
};

window.stopDetection = function() {
  isSearching = false;
  clearInterval(searchTimer);
  
  if (conn && conn.open) {
    conn.send({ action: 'stop' });
  }

  webcamRunning = false;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました";
  status.style.color = "#aaa";
};


// ================= PCサーバーへ画像送信 ＆ 検出 =================
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


// ================= 検出枠の描画 ＆ 履歴保存 =================
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
  const modal = document.getElementById("historyFolderModal");
  if (modal) modal.style.display = "flex";
};

window.closeHistoryFolder = function() {
  const modal = document.getElementById("historyFolderModal");
  if (modal) modal.style.display = "none";
};

window.clearGallery = function() {
  const gallery = document.getElementById("imageGallery");
  if (gallery) gallery.innerHTML = "";
};

function addGalleryThumbnail(dataUrl) {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;

  const img = document.createElement("img");
  img.src = dataUrl;
  img.style.cssText = "width: 100px; height: 100px; object-fit: cover; border-radius: 6px; border: 2px solid #00ff00; cursor: pointer; flex-shrink: 0;";
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
