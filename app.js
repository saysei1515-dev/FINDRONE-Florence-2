const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas ? canvas.getContext("2d") : null;
const statusEl = document.getElementById("status");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton"); // ダミー

const SERVER_URL_STORAGE_KEY = "findrone_colab_server_url";
const CAMERA_ID_STORAGE_KEY = "findrone_colab_camera_id";
const AUTO_CONNECT_KEY = "findrone_colab_auto_connect";

let isSearching = false;
let searchTimer = null;
let isRequestInFlight = false;
let lastSaveTime = 0;
let currentFinalizedKeyword = "";
let hasAutoConnected = false;

// 物体名ごとの履歴データ: { [labelName]: [ { id, dataUrl }, ... ] }
let historyByObject = {};
let selectedObjectFolder = null;

function setStatus(text, color = "#a2759e") {
  if (statusEl) {
    statusEl.innerText = text;
    statusEl.style.color = color;
  }
}

function setConnectionStatus(text, color = "#8c7388") {
  const connStatus = document.getElementById("connectionStatus");
  if (connStatus) {
    connStatus.innerText = text;
    connStatus.style.color = color;
  }
}

// 画面遷移
window.goToTab = function (tabName) {
  document.querySelectorAll(".tab-content").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));

  if (tabName === "home") {
    document.getElementById("homeTab")?.classList.add("active");
    document.getElementById("nav-home")?.classList.add("active");
  } else if (tabName === "search") {
    document.getElementById("searchTab")?.classList.add("active");
    document.getElementById("nav-search")?.classList.add("active");
  } else if (tabName === "setting") {
    document.getElementById("settingTab")?.classList.add("active");
    document.getElementById("nav-setting")?.classList.add("active");
  }
};

// 入力されたIPまたはngrok URLをベースURLに整える
function buildBaseUrl(rawInput) {
  let cleaned = (rawInput || "").trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  return `http://${cleaned}:5000`;
}

// 起動時の初期化（保存値の復元）
function initSavedSettings() {
  const serverIpInput = document.getElementById("serverIp");
  const pcIdInput = document.getElementById("pcIdInput");

  try {
    const savedUrl = localStorage.getItem(SERVER_URL_STORAGE_KEY);
    const savedId = localStorage.getItem(CAMERA_ID_STORAGE_KEY);

    if (savedUrl && serverIpInput) serverIpInput.value = savedUrl;
    if (savedId && pcIdInput) pcIdInput.value = savedId;
  } catch (err) {
    console.warn("設定の初期化に失敗:", err);
  }
}

// PeerJS 準備完了後に自動接続を実行する
function tryAutoConnectIfNeeded() {
  if (hasAutoConnected) return;
  try {
    const savedUrl = (localStorage.getItem(SERVER_URL_STORAGE_KEY) || "").trim();
    const savedId = (localStorage.getItem(CAMERA_ID_STORAGE_KEY) || "").trim();
    const shouldAuto = localStorage.getItem(AUTO_CONNECT_KEY) === "true";

    if (shouldAuto && savedUrl && savedId) {
      hasAutoConnected = true;
      console.log("自動接続を開始します...");
      window.connectToPC();
    }
  } catch (err) {
    console.warn("自動接続判定に失敗:", err);
  }
}

// 「この設定で保存」ボタン
window.saveAllSettings = function () {
  const serverIpInput = document.getElementById("serverIp");
  const pcIdInput = document.getElementById("pcIdInput");

  const rawUrl = serverIpInput ? serverIpInput.value.trim() : "";
  const rawId = pcIdInput ? pcIdInput.value.trim() : "";

  try {
    localStorage.setItem(SERVER_URL_STORAGE_KEY, rawUrl);
    localStorage.setItem(CAMERA_ID_STORAGE_KEY, rawId);
    localStorage.setItem(AUTO_CONNECT_KEY, "true");
    setConnectionStatus("設定を保存しました。接続処理を実行中...", "#2e7d63");
    if (rawId) {
      window.connectToPC();
    }
    alert("設定を保存しました！次回からも自動接続されます");
  } catch (err) {
    console.warn("保存に失敗:", err);
    alert("保存中にエラーが発生しました。");
  }
};

// PeerJS ＆ 遠隔カメラ接続管理
const peer = typeof Peer !== "undefined" ? new Peer() : null;
let conn = null;
let webcamRunning = false;
let html5QrCode = null;

if (peer) {
  peer.on("open", (id) => {
    console.log("スマホ側 Peer ID:", id);
    tryAutoConnectIfNeeded();
  });

  peer.on("call", (call) => {
    call.answer();
    call.on("stream", (remoteStream) => {
      if (video) {
        video.srcObject = remoteStream;
      }
      webcamRunning = true;
      setStatus(`ステータス: 探索中... (${currentFinalizedKeyword})`, "#247a5d");
    });
  });

  peer.on("error", (err) => {
    console.error("Peerインスタンスエラー:", err);
  });
}

// 単独接続ボタン用
window.connectToServerOnly = function () {
  const serverIpInput = document.getElementById("serverIp");
  const url = serverIpInput ? serverIpInput.value.trim() : "";
  if (!url) {
    alert("IPアドレスまたはURLを入力してください！");
    return;
  }
  try {
    localStorage.setItem(SERVER_URL_STORAGE_KEY, url);
  } catch (e) {}
  setConnectionStatus("サーバーURLを保存しました", "#2e7d63");
  alert("サーバーのアドレスを登録しました");
};

// PC接続ボタン
window.connectToPC = function () {
  const pcIdInput = document.getElementById("pcIdInput");
  const pcId = pcIdInput ? pcIdInput.value.trim() : "";
  if (!pcId) {
    alert("PCのIDを入力してください！");
    return;
  }
  if (!peer) {
    alert("PeerJSの読み込みに失敗しました。");
    return;
  }

  setStatus("ステータス: PCに接続中...", "#b57c18");
  setConnectionStatus("ステータス: PCに接続中...", "#b57c18");

  if (conn) {
    try {
      conn.close();
    } catch (e) {}
  }

  conn = peer.connect(pcId);
  conn.on("open", () => {
    setStatus("ステータス: PC接続完了 ✅", "#247a5d");
    setConnectionStatus("ステータス: 接続完了 ✅", "#2e7d63");
    if (startButton) {
      startButton.disabled = false;
      startButton.innerText = "探索開始";
    }
  });

  conn.on("error", (err) => {
    console.error("Peer接続エラー:", err);
    setStatus("エラー: PCとの接続に失敗しました", "#c94a63");
    setConnectionStatus("ステータス: 接続に失敗しました ✕", "#c94a63");
  });
};

// QRコードスキャン機能（切り替えトグル式）
let isScanning = false;
window.toggleQrScanner = async function () {
  const btn = document.getElementById("btn-qr");
  const readerContainer = document.getElementById("qr-reader");
  if (!readerContainer) return;

  if (!isScanning) {
    if (typeof Html5Qrcode === "undefined") {
      alert("QRライブラリの読み込みに失敗しました。");
      return;
    }

    readerContainer.style.display = "block";
    if (btn) {
      btn.innerHTML = `<i class="bi bi-x-circle-fill"></i> QRスキャン停止`;
      btn.classList.add("active-stop");
    }
    isScanning = true;

    try {
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
      } else if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 170, height: 170 }, aspectRatio: 1.0 },
        async (decodedText) => {
          const pcIdInput = document.getElementById("pcIdInput");
          if (pcIdInput) pcIdInput.value = decodedText.trim();

          if (html5QrCode && html5QrCode.isScanning) {
            try {
              await html5QrCode.stop();
            } catch (e) {}
          }
          isScanning = false;
          if (btn) {
            btn.innerHTML = `<i class="bi bi-qr-code-scan"></i> QRコードカメラ起動`;
            btn.classList.remove("active-stop");
          }
          readerContainer.style.display = "none";
          setStatus("✅ IDを取得しました！設定保存か接続を押してください", "#247a5d");
          setConnectionStatus("✅ IDを取得しました！「この設定で保存」または「接続」を押してください", "#2e7d63");
        },
        () => {}
      );
    } catch (err) {
      console.error(err);
      isScanning = false;
      if (btn) {
        btn.innerHTML = `<i class="bi bi-qr-code-scan"></i> QRコードカメラ起動`;
        btn.classList.remove("active-stop");
      }
      readerContainer.style.display = "none";
    }
  } else {
    isScanning = false;
    if (btn) {
      btn.innerHTML = `<i class="bi bi-qr-code-scan"></i> QRコードカメラ起動`;
      btn.classList.remove("active-stop");
    }
    if (html5QrCode && html5QrCode.isScanning) {
      html5QrCode
        .stop()
        .then(() => {
          readerContainer.style.display = "none";
        })
        .catch(() => {
          readerContainer.style.display = "none";
        });
    } else {
      readerContainer.style.display = "none";
    }
  }
};

// (既存互換ダミー)
window.startQrScanner = () => !isScanning && window.toggleQrScanner();
window.stopQrScanner = () => isScanning && window.toggleQrScanner();

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
    goToTab("setting");
    if (serverIpInput) serverIpInput.focus();
    return;
  }

  // 探す物体を切り替えた瞬間に、表示中のバウンディングボックスを消去
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const baseUrl = buildBaseUrl(rawServerInput);
  setStatus("🔄 サーバーで翻訳中...", "#b57c18");

  try {
    const response = await fetch(`${baseUrl}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({ keyword: keyword }),
    });

    if (!response.ok) throw new Error("翻訳エラー");

    const data = await response.json();
    const translatedWord = (data.translated || keyword).trim();

    if (inputElement) inputElement.value = translatedWord;
    currentFinalizedKeyword = translatedWord;

    if (isSearching) {
      setStatus(`🔍 「${currentFinalizedKeyword}」を探索中... (変更適用)`, "#247a5d");
    } else {
      setStatus(`🎯 「${keyword}」➔ 英語: [${currentFinalizedKeyword}] に設定しました`, "#247a5d");
    }
  } catch (err) {
    console.error(err);
    currentFinalizedKeyword = keyword;
    setStatus(`⚠️ 翻訳に失敗しました（「${currentFinalizedKeyword}」を使用）`, "#c94a63");
  }
};

// ================= 探索スタート・ストップ（トグルカラー化） =================
window.startDetection = async function () {
  if (!isSearching) {
    const serverIpInput = document.getElementById("serverIp");
    const inputElement = document.getElementById("targetObject");
    const rawServerInput = serverIpInput ? serverIpInput.value.trim() : "";
    const inputVal = inputElement ? inputElement.value.trim() : "";

    if (!rawServerInput) {
      alert("サーバーのURLを設定画面で入力してください！");
      goToTab("setting");
      return;
    }
    if (!inputVal && !currentFinalizedKeyword) {
      alert("探すものを入力してください！");
      if (inputElement) inputElement.focus();
      return;
    }
    if (!conn || !conn.open) {
      alert("先にPCと接続してください！");
      goToTab("setting");
      return;
    }

    if (inputVal) {
      await window.updateTarget();
    }

    conn.send({
      action: "start",
      keyword: currentFinalizedKeyword,
      smartphoneId: peer ? peer.id : "",
    });

    isSearching = true;
    if (startButton) {
      startButton.innerText = "探索終了";
      startButton.classList.add("active-stop");
    }
    setStatus(`🔍 「${currentFinalizedKeyword}」をYOLO-Worldで探索中...`, "#247a5d");

    searchTimer = setInterval(async () => {
      if (!isSearching || isRequestInFlight || !video || video.videoWidth === 0) return;
      await sendFrameToPC(serverIpInput ? serverIpInput.value.trim() : "", currentFinalizedKeyword);
    }, 500);
  } else {
    isSearching = false;
    clearInterval(searchTimer);

    if (conn && conn.open) conn.send({ action: "stop" });

    webcamRunning = false;
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (startButton) {
      startButton.innerText = "探索開始";
      startButton.classList.remove("active-stop");
    }
    setStatus("ステータス: 停止しました", "#8c7388");
  }
};

// 既存ボタン互換ダミー
window.stopDetection = () => isSearching && window.startDetection();

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
      headers: { "ngrok-skip-browser-warning": "true" },
      body: formData,
    });

    if (!response.ok) throw new Error("サーバー応答エラー");

    const data = await response.json();
    drawDetections(data.detections);
  } catch (err) {
    console.error(err);
  } finally {
    isRequestInFlight = false;
  }
}

// ================= 検出枠の描画（object-fit: cover 補正） ＆ 履歴保存 =================
function drawDetections(detections) {
  if (!canvas || !ctx || !video) return;
  if (!video.videoWidth || !video.videoHeight) return;

  const viewWidth = video.clientWidth || canvas.clientWidth;
  const viewHeight = video.clientHeight || canvas.clientHeight;
  if (!viewWidth || !viewHeight) return;

  canvas.width = viewWidth;
  canvas.height = viewHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!detections || detections.length === 0) return;

  const videoRatio = video.videoWidth / video.videoHeight;
  const viewRatio = viewWidth / viewHeight;

  let renderWidth, renderHeight, offsetX, offsetY;
  if (viewRatio > videoRatio) {
    renderWidth = viewWidth;
    renderHeight = viewWidth / videoRatio;
    offsetX = 0;
    offsetY = (viewHeight - renderHeight) / 2;
  } else {
    renderHeight = viewHeight;
    renderWidth = viewHeight * videoRatio;
    offsetX = (viewWidth - renderWidth) / 2;
    offsetY = 0;
  }

  detections.forEach((det) => {
    const [ymin, xmin, ymax, xmax] = det.box_2d;

    const x = offsetX + (xmin / 1000) * renderWidth;
    const y = offsetY + (ymin / 1000) * renderHeight;
    const w = ((xmax - xmin) / 1000) * renderWidth;
    const h = ((ymax - ymin) / 1000) * renderHeight;

    ctx.strokeStyle = "#00e676";
    ctx.lineWidth = 3.5;
    ctx.strokeRect(x, y, w, h);

    const labelText = `${det.label} (${det.confidence})`;
    ctx.font = "bold 13px sans-serif";
    const textWidth = ctx.measureText(labelText).width;
    const badgeW = Math.max(w, textWidth + 12);
    const badgeH = 22;
    const badgeY = y > badgeH + 2 ? y - badgeH - 2 : y + 2;

    ctx.fillStyle = "rgba(181, 242, 214, 0.92)";
    ctx.fillRect(x, badgeY, badgeW, badgeH);

    ctx.fillStyle = "#1f4d3d";
    ctx.fillText(labelText, x + 6, badgeY + 15);

    const now = Date.now();
    if (now - lastSaveTime > 3000) {
      const objectName = (det.label || currentFinalizedKeyword || "未分類").trim();
      saveFoundImage(
        {
          x: (xmin / 1000) * video.videoWidth,
          y: (ymin / 1000) * video.videoHeight,
          width: ((xmax - xmin) / 1000) * video.videoWidth,
          height: ((ymax - ymin) / 1000) * video.videoHeight,
        },
        objectName
      );
      lastSaveTime = now;
    }
  });
}

// ================= 発見履歴・フォルダ機能 =================
function renderHistoryModal() {
  const gallery = document.getElementById("imageGallery");
  const titleEl = document.getElementById("historyModalTitle");
  const backBtn = document.getElementById("backToFoldersBtn");
  if (!gallery) return;

  gallery.innerHTML = "";

  // 特定の物体フォルダを開いている場合
  if (selectedObjectFolder) {
    if (titleEl) titleEl.innerText = `📁 ${selectedObjectFolder}`;
    if (backBtn) backBtn.style.display = "inline-flex";

    const photos = historyByObject[selectedObjectFolder] || [];
    if (photos.length === 0) {
      gallery.innerHTML = `<div class="empty-history-msg">この物体の写真はありません</div>`;
      return;
    }

    const grid = document.createElement("div");
    grid.className = "photo-grid";

    photos.forEach((photo) => {
      const item = document.createElement("div");
      item.className = "photo-item";

      const img = document.createElement("img");
      img.src = photo.dataUrl;
      img.onclick = () => {
        const modal = document.getElementById("imagePreviewModal");
        const previewImg = document.getElementById("previewImage");
        if (modal && previewImg) {
          previewImg.src = photo.dataUrl;
          modal.style.display = "flex";
        }
      };

      const delBtn = document.createElement("button");
      delBtn.className = "corner-delete-btn";
      delBtn.innerText = "✕";
      delBtn.title = "この写真を削除";
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteSinglePhoto(selectedObjectFolder, photo.id);
      };

      item.appendChild(img);
      item.appendChild(delBtn);
      grid.appendChild(item);
    });

    gallery.appendChild(grid);
    return;
  }

  // 物体名一覧（フォルダ一覧）を表示
  if (titleEl) titleEl.innerText = "📂 発見した物体一覧";
  if (backBtn) backBtn.style.display = "none";

  const objectNames = Object.keys(historyByObject).filter(
    (name) => Array.isArray(historyByObject[name]) && historyByObject[name].length > 0
  );

  if (objectNames.length === 0) {
    gallery.innerHTML = `<div class="empty-history-msg">まだ発見した物体の履歴はありません</div>`;
    return;
  }

  const folderGrid = document.createElement("div");
  folderGrid.className = "folder-list-grid";

  objectNames.forEach((objName) => {
    const photos = historyByObject[objName];
    const latestPhoto = photos[0];

    const card = document.createElement("div");
    card.className = "folder-card";
    card.onclick = () => {
      selectedObjectFolder = objName;
      renderHistoryModal();
    };

    const delFolderBtn = document.createElement("button");
    delFolderBtn.className = "corner-delete-btn";
    delFolderBtn.innerText = "✕";
    delFolderBtn.title = `${objName} の写真をすべて削除`;
    delFolderBtn.onclick = (e) => {
      e.stopPropagation();
      deleteObjectFolder(objName);
    };

    const thumb = document.createElement("img");
    thumb.className = "folder-thumb";
    thumb.src = latestPhoto.dataUrl;

    const nameLabel = document.createElement("div");
    nameLabel.className = "folder-name";
    nameLabel.innerText = objName;

    const countLabel = document.createElement("div");
    countLabel.className = "folder-count";
    countLabel.innerText = `${photos.length}枚`;

    card.appendChild(delFolderBtn);
    card.appendChild(thumb);
    card.appendChild(nameLabel);
    card.appendChild(countLabel);
    folderGrid.appendChild(card);
  });

  gallery.appendChild(folderGrid);
}

function deleteSinglePhoto(objName, photoId) {
  if (!historyByObject[objName]) return;
  historyByObject[objName] = historyByObject[objName].filter((p) => p.id !== photoId);
  if (historyByObject[objName].length === 0) {
    delete historyByObject[objName];
    selectedObjectFolder = null;
  }
  renderHistoryModal();
}

function deleteObjectFolder(objName) {
  if (!historyByObject[objName]) return;
  delete historyByObject[objName];
  if (selectedObjectFolder === objName) {
    selectedObjectFolder = null;
  }
  renderHistoryModal();
}

window.backToFolderList = function () {
  selectedObjectFolder = null;
  renderHistoryModal();
};

window.openHistoryFolder = function () {
  selectedObjectFolder = null;
  renderHistoryModal();
  const modal = document.getElementById("historyFolderModal");
  if (modal) modal.style.display = "flex";
};

window.closeHistoryFolder = function () {
  selectedObjectFolder = null;
  const modal = document.getElementById("historyFolderModal");
  if (modal) modal.style.display = "none";
};

window.clearGallery = function () {
  historyByObject = {};
  selectedObjectFolder = null;
  renderHistoryModal();
};

function addGalleryThumbnail(dataUrl, objectName = "未分類") {
  const key = (objectName || "未分類").trim();
  if (!historyByObject[key]) {
    historyByObject[key] = [];
  }
  historyByObject[key].unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dataUrl: dataUrl,
  });

  const modal = document.getElementById("historyFolderModal");
  if (modal && modal.style.display === "flex") {
    renderHistoryModal();
  }
}

window.closePreview = function () {
  const modal = document.getElementById("imagePreviewModal");
  if (modal) modal.style.display = "none";
};

function saveFoundImage(bbox, objectName = "未分類") {
  if (!video || !video.videoWidth || !video.videoHeight || bbox.width <= 0 || bbox.height <= 0) return;

  const sx = Math.max(0, Math.min(video.videoWidth, bbox.x));
  const sy = Math.max(0, Math.min(video.videoHeight, bbox.y));
  const sw = Math.max(1, Math.min(video.videoWidth - sx, bbox.width));
  const sh = Math.max(1, Math.min(video.videoHeight - sy, bbox.height));

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sw;
  tempCanvas.height = sh;
  tempCanvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  addGalleryThumbnail(tempCanvas.toDataURL("image/jpeg"), objectName);
}

// 保存データ読み込み
initSavedSettings();