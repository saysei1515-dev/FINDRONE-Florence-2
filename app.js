const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas ? canvas.getContext("2d") : null;
const statusEl = document.getElementById("status");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");

const SERVER_URL_STORAGE_KEY = "findrone_colab_server_url";

let isSearching = false;
let searchTimer = null;
let isRequestInFlight = false;
let lastSaveTime = 0;
let currentFinalizedKeyword = "cup"; // 翻訳・確定された検索キーワード

function setStatus(text, color = "#00ffcc") {
  if (statusEl) {
    statusEl.innerText = text;
    statusEl.style.color = color;
  }
}

// 入力されたIPまたはngrok URLをベースURLに整える
function buildBaseUrl(rawInput) {
  let cleaned = (rawInput || "").trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  return `http://${cleaned}:5000`;
}

// 保存済みサーバーURLの読み込みと自動保存の設定
function initSavedServerUrl() {
  const serverIpInput = document.getElementById("serverIp");
  if (!serverIpInput) return;

  try {
    const savedUrl = localStorage.getItem(SERVER_URL_STORAGE_KEY);
    if (savedUrl && !serverIpInput.value.trim()) {
      serverIpInput.value = savedUrl;
    }
  } catch (err) {
    console.warn("保存済みURLの読み込みに失敗:", err);
  }

  serverIpInput.addEventListener("change", () => {
    saveServerUrl(serverIpInput.value);
  });
}

function saveServerUrl(rawInput) {
  const cleaned = (rawInput || "").trim();
  try {
    if (cleaned) {
      localStorage.setItem(SERVER_URL_STORAGE_KEY, cleaned);
    }
  } catch (err) {
    console.warn("URLの保存に失敗:", err);
  }
}

initSavedServerUrl();

// ================= PeerJS ＆ 遠隔カメラ接続管理 =================
const peer = typeof Peer !== "undefined" ? new Peer() : null;
let conn = null;
let webcamRunning = false;
let html5QrCode = null;

if (peer) {
  peer.on("open", (id) => {
    console.log("スマホ側 Peer ID:", id);
  });

  peer.on("call", (call) => {
    call.answer();
    call.on("stream", (remoteStream) => {
      if (video) {
        video.srcObject = remoteStream;
      }
      webcamRunning = true;
      setStatus(`ステータス: 探索中... (${currentFinalizedKeyword})`, "#00ff00");
    });
  });
}

// PC接続ボタン
window.connectToPC = function () {
  const pcIdInput = document.getElementById("pcIdInput");
  const pcId = pcIdInput ? pcIdInput.value.trim() : "";
  if (!pcId) {
    alert("PCのIDを入力してください！");
    return;
  }
  if (!peer) {
    alert("PeerJSの読み込みに失敗しました。通信環境を確認してください。");
    return;
  }

  setStatus("ステータス: PCに接続中...", "#ffc107");

  conn = peer.connect(pcId);
  conn.on("open", () => {
    setStatus("ステータス: PC接続完了 ✅", "#00ff00");
    if (startButton) {
      startButton.disabled = false;
      startButton.innerText = "遠隔カメラ起動 & 探索スタート";
    }
    const connStatus = document.getElementById("connectionStatus");
    if (connStatus) {
      connStatus.innerText = "ステータス: 接続完了 ✅";
      connStatus.style.color = "#28a745";
    }
  });

  conn.on("error", (err) => {
    console.error("Peer接続エラー:", err);
    setStatus("エラー: PCとの接続に失敗しました", "#ff4444");
  });
};

// QRコードスキャン機能（別PCのIDを読み取る）
window.startQrScanner = async function () {
  const readerContainer = document.getElementById("qr-reader");
  if (!readerContainer) {
    console.error("#qr-reader が見つかりません");
    return;
  }

  if (typeof Html5Qrcode === "undefined") {
    setStatus("⚠️ QRライブラリ(Html5Qrcode)が読み込まれていません", "#ff4444");
    alert("QRスキャナーライブラリの読み込みに失敗しました。通信環境や再読み込みを確認してください。");
    return;
  }

  readerContainer.style.display = "block";
  setStatus("📷 QRスキャナーを起動中...", "#ffc107");

  try {
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("qr-reader");
    } else if (html5QrCode.isScanning) {
      await html5QrCode.stop();
    }

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 180, height: 180 } },
      (decodedText) => {
        const pcIdInput = document.getElementById("pcIdInput");
        if (pcIdInput) pcIdInput.value = decodedText.trim();
        window.stopQrScanner();
        setStatus("✅ PCのIDを読み込みました！「接続」を押してください", "#00ff00");
        alert("PCのIDを読み込みました！「接続」ボタンを押してください。");
      },
      () => {}
    );
  } catch (err) {
    console.error("QRカメラ起動エラー:", err);
    setStatus(`⚠️ カメラの起動に失敗しました: ${err?.name || err}`, "#ff4444");
    alert("カメラの起動に失敗しました: " + err);
  }
};

window.stopQrScanner = function () {
  const readerContainer = document.getElementById("qr-reader");
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode
      .stop()
      .then(() => {
        if (readerContainer) readerContainer.style.display = "none";
      })
      .catch((err) => {
        console.error("QRスキャナーの停止に失敗しました:", err);
        if (readerContainer) readerContainer.style.display = "none";
      });
  } else if (readerContainer) {
    readerContainer.style.display = "none";
  }
};

// ================= 検索ワード翻訳（決定ボタン） =================
window.updateTarget = async function () {
  const serverIpInput = document.getElementById("serverIp");
  const inputElement = document.getElementById("targetObject");
  const rawServerInput = serverIpInput ? serverIpInput.value.trim() : "";
  const keyword = inputElement ? inputElement.value.trim() : "";

  if (!keyword) {
    alert("探すものを入力してください！");
    return;
  }
  if (!rawServerInput) {
    alert("サーバーのURLまたはIPアドレスを入力してください！");
    if (serverIpInput) serverIpInput.focus();
    return;
  }

  saveServerUrl(rawServerInput);
  const baseUrl = buildBaseUrl(rawServerInput);
  setStatus("🔄 サーバーで翻訳中...", "#ffc107");

  try {
    const response = await fetch(`${baseUrl}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({ keyword: keyword }),
    });

    if (!response.ok) {
      throw new Error(`翻訳サーバーエラー (HTTP ${response.status})`);
    }

    const data = await response.json();
    const translatedWord = (data.translated || keyword).trim();

    if (inputElement) inputElement.value = translatedWord;
    currentFinalizedKeyword = translatedWord;

    if (isSearching) {
      setStatus(`🔍 「${currentFinalizedKeyword}」を探索中... (変更適用)`, "#00ff00");
    } else {
      setStatus(`🎯 「${keyword}」➔ 英語: [${currentFinalizedKeyword}] に設定しました`, "#00ff00");
    }
  } catch (err) {
    console.error("翻訳リクエストエラー:", err);
    currentFinalizedKeyword = keyword;
    setStatus(`⚠️ 翻訳に失敗しました（「${currentFinalizedKeyword}」をそのまま使用します）`, "#ff4444");
  }
};

// ================= 探索スタート・ストップ =================
window.startDetection = async function () {
  const serverIpInput = document.getElementById("serverIp");
  const inputElement = document.getElementById("targetObject");
  const rawServerInput = serverIpInput ? serverIpInput.value.trim() : "";
  const inputVal = inputElement ? inputElement.value.trim() : "";

  if (!rawServerInput) {
    alert("サーバーのURLまたはIPアドレスを入力してください！");
    if (serverIpInput) serverIpInput.focus();
    return;
  }
  if (!inputVal) {
    alert("探すものを入力してください！");
    if (inputElement) inputElement.focus();
    return;
  }
  if (!conn || !conn.open) {
    alert("先にPCと接続してください！");
    return;
  }

  saveServerUrl(rawServerInput);
  await window.updateTarget();

  conn.send({
    action: "start",
    keyword: currentFinalizedKeyword,
    smartphoneId: peer ? peer.id : "",
  });

  isSearching = true;
  if (startButton) startButton.style.display = "none";
  if (stopButton) stopButton.style.display = "block";
  setStatus(`🔍 「${currentFinalizedKeyword}」をYOLO-Worldで探索中...`, "#00ff00");

  searchTimer = setInterval(async () => {
    if (!isSearching || isRequestInFlight || !video || video.videoWidth === 0) return;
    const currentServerInput = serverIpInput ? serverIpInput.value.trim() : "";
    await sendFrameToPC(currentServerInput, currentFinalizedKeyword);
  }, 500);
};

window.stopDetection = function () {
  isSearching = false;
  clearInterval(searchTimer);

  if (conn && conn.open) {
    conn.send({ action: "stop" });
  }

  webcamRunning = false;
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  if (stopButton) stopButton.style.display = "none";
  if (startButton) startButton.style.display = "block";
  setStatus("ステータス: 停止しました", "#aaa");
};

// ================= サーバーへ画像送信 ＆ 検出 =================
async function sendFrameToPC(serverInput, keyword) {
  isRequestInFlight = true;
  try {
    const baseUrl = buildBaseUrl(serverInput);
    if (!baseUrl || !video || !video.videoWidth || !video.videoHeight) {
      isRequestInFlight = false;
      return;
    }

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 320;
    tempCanvas.height = Math.round(video.videoHeight * (320 / video.videoWidth));
    const tCtx = tempCanvas.getContext("2d");
    tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    const blob = await new Promise((resolve) =>
      tempCanvas.toBlob(resolve, "image/jpeg", 0.6)
    );
    if (!blob) {
      isRequestInFlight = false;
      return;
    }

    const formData = new FormData();
    formData.append("image", blob, "frame.jpg");
    formData.append("keyword", keyword);

    const response = await fetch(`${baseUrl}/detect`, {
      method: "POST",
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`サーバー応答エラー (HTTP ${response.status})`);
    }

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
  if (!canvas || !ctx || !video) return;

  if (video.videoWidth > 0 && video.videoHeight > 0) {
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!detections || detections.length === 0 || !video.videoWidth || !video.videoHeight) return;

  const scaleX = canvas.width / video.videoWidth;
  const scaleY = canvas.height / video.videoHeight;

  detections.forEach((det) => {
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
      saveFoundImage({
        x: x / scaleX,
        y: y / scaleY,
        width: w / scaleX,
        height: h / scaleY,
      });
      lastSaveTime = now;
    }
  });
}

// ================= 発見履歴・フォルダ機能 =================
window.openHistoryFolder = function () {
  const modal = document.getElementById("historyFolderModal");
  if (modal) modal.style.display = "flex";
};

window.closeHistoryFolder = function () {
  const modal = document.getElementById("historyFolderModal");
  if (modal) modal.style.display = "none";
};

window.clearGallery = function () {
  const gallery = document.getElementById("imageGallery");
  if (gallery) gallery.innerHTML = "";
};

function addGalleryThumbnail(dataUrl) {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;

  const img = document.createElement("img");
  img.src = dataUrl;
  img.style.cssText =
    "width: 100px; height: 100px; object-fit: cover; border-radius: 6px; border: 2px solid #00ff00; cursor: pointer; flex-shrink: 0;";
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

window.closePreview = function () {
  const modal = document.getElementById("imagePreviewModal");
  if (modal) modal.style.display = "none";
};

function saveFoundImage(bbox) {
  if (!video || !video.videoWidth || !video.videoHeight || bbox.width <= 0 || bbox.height <= 0) {
    return;
  }
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = bbox.width;
  tempCanvas.height = bbox.height;
  tempCanvas.getContext("2d").drawImage(
    video,
    bbox.x,
    bbox.y,
    bbox.width,
    bbox.height,
    0,
    0,
    bbox.width,
    bbox.height
  );
  addGalleryThumbnail(tempCanvas.toDataURL("image/jpeg"));
}
