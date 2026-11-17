let isSearching = false;
let isRequestInFlight = false;
let searchTimer = null;
let currentSearchWord = "pen";

let cachedDetections = [];
let boxExpireTime = 0;

const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");

// 初期化：保存済みIPの復元
window.addEventListener('DOMContentLoaded', () => {
  const savedIp = localStorage.getItem("pc_server_ip");
  if (savedIp) {
    document.getElementById("serverIpInput").value = savedIp;
  }
});

window.saveIp = function() {
  const ip = document.getElementById("serverIpInput").value.trim();
  if (!ip) { alert("IPアドレスを入力してください！"); return; }
  localStorage.setItem("pc_server_ip", ip);
  status.innerText = "ステータス: IPアドレスを保存しました ✅";
  status.style.color = "#28a745";
};

// COCOデータセット一覧（日本語・英語対応サジェスト）
const cocoItems = [
  { en: "person", jp: "ヒト" }, { en: "bicycle", jp: "ジテンシャ" }, { en: "car", jp: "クルマ" },
  { en: "backpack", jp: "リュック" }, { en: "umbrella", jp: "カサ" }, { en: "handbag", jp: "ハンドバッグ" },
  { en: "bottle", jp: "ボトル" }, { en: "cup", jp: "コップ" }, { en: "chair", jp: "イス" },
  { en: "laptop", jp: "パソコン" }, { en: "mouse", jp: "マウス" }, { en: "keyboard", jp: "キーボード" },
  { en: "cell phone", jp: "スマホ" }, { en: "book", jp: "ホン" }, { en: "clock", jp: "トケイ" }
];

window.filterSuggestions = function() {
  const input = document.getElementById("targetObject");
  const query = input.value.trim().toLowerCase();
  const box = document.getElementById("customSuggestions");
  if (!query) {
    box.style.display = "none";
    return;
  }
  const matched = cocoItems.filter(item => 
    item.en.toLowerCase().includes(query) || item.jp.includes(query)
  );
  if (matched.length === 0) {
    box.style.display = "none";
    return;
  }
  box.innerHTML = "";
  matched.forEach(item => {
    const div = document.createElement("div");
    div.style.cssText = "padding: 8px 10px; font-size: 13px; color: #fff; cursor: pointer; border-bottom: 1px solid #333; text-align: left;";
    div.innerHTML = `${item.jp} <span style="color: #aaa; font-size: 11px;">(${item.en})</span>`;
    div.onmousedown = (e) => {
      e.preventDefault(); 
      input.value = item.en;
      box.style.display = "none";
      window.updateTarget();
    };
    box.appendChild(div);
  });
  box.style.display = "block";
};

window.updateTarget = function() {
  const customSuggestions = document.getElementById("customSuggestions");
  if (customSuggestions) customSuggestions.style.display = "none";
  let inputVal = document.getElementById("targetObject").value.trim().toLowerCase();
  if (!inputVal) { alert("探すものを入力してください！"); return; }
  currentSearchWord = inputVal;
  status.innerText = `🎯 「${currentSearchWord}」を探します`;
  status.style.color = "#00ff00";
};

// 探索スタート（カメラ起動 ＆ ループ開始）
window.startCameraAndSearch = async function() {
  const ip = document.getElementById("serverIpInput").value.trim();
  if (!ip) { alert("先にパソコンのIPアドレスを入力・保存してください！"); return; }

  const inputVal = document.getElementById("targetObject").value.trim();
  if (!inputVal) {
    alert("探すものを入力してください！");
    document.getElementById("targetObject").focus();
    return;
  }
  currentSearchWord = inputVal.toLowerCase();

  startButton.style.display = "none";
  stopButton.style.display = "block";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    
    beginDetectionLoop();
  } catch (err) {
    alert("カメラ起動エラー: " + err.message);
    stopSearch();
  }
};

function beginDetectionLoop() {
  if (isSearching) return;
  isSearching = true;
  status.innerText = `🔍 PCサーバーへ映像を送信して「${currentSearchWord}」を探索中...`;
  status.style.color = "#00ff00";
  renderOverlayLoop();

  // 約1.5秒ごとにPCサーバーへフレームを送信
  searchTimer = setInterval(async () => {
    if (!isSearching || isRequestInFlight || video.videoWidth === 0) return;
    await sendFrameToPC();
  }, 500);
}

async function sendFrameToPC() {
  const ip = document.getElementById("serverIpInput").value.trim();
  const keyword = currentSearchWord;

  isRequestInFlight = true;
  try {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 480;
    tempCanvas.height = Math.round(video.videoHeight * (480 / video.videoWidth));
    const tCtx = tempCanvas.getContext("2d");
    tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    tempCanvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append("image", blob, "frame.jpg");
      formData.append("keyword", keyword);

      try {
        const response = await fetch(`http://${ip}:5000/detect`, {
          method: "POST",
          body: formData
        });
        const data = await response.json();

        if (data.detections && data.detections.length > 0) {
          cachedDetections = data.detections;
          boxExpireTime = Date.now() + 2500;
          status.innerText = `🎉 発見しました！ (${data.detections.length}件)`;
          status.style.color = "#00ff00";
          addGalleryThumbnail(drawBoxOnSnapshot(tempCanvas, data.detections));
        } else {
          status.innerText = `🔍 探索中...（「${keyword}」未検出）`;
          status.style.color = "#ffc107";
        }
      } catch (netErr) {
        console.error(netErr);
        status.innerText = "通信エラー: PCサーバーに接続できません";
        status.style.color = "#dc3545";
      } finally {
        isRequestInFlight = false;
      }
    }, "image/jpeg", 0.75);

  } catch (e) {
    isRequestInFlight = false;
  }
}

// リアルタイム映像の上にバウンディングボックスを重ねて描画
function renderOverlayLoop() {
  if (!isSearching) return;

  if (video.clientWidth > 0 && video.clientHeight > 0) {
    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
    }
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (Date.now() < boxExpireTime && cachedDetections.length > 0) {
    cachedDetections.forEach(item => {
      if (!item.box_2d || item.box_2d.length < 4) return;
      const [ymin, xmin, ymax, xmax] = item.box_2d;

      // 0〜1000の正規化座標を現在のCanvasサイズに変換
      const x = (xmin / 1000) * canvas.width;
      const y = (ymin / 1000) * canvas.height;
      const w = ((xmax - xmin) / 1000) * canvas.width;
      const h = ((ymax - ymin) / 1000) * canvas.height;

      ctx.strokeStyle = "#00ff00";
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = "rgba(0, 255, 0, 0.85)";
      ctx.fillRect(x, y > 24 ? y - 24 : 0, Math.max(w, 110), 24);
      ctx.fillStyle = "#000";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(`${item.label} (${item.confidence})`, x + 6, y > 24 ? y - 7 : 17);
    });
  }

  requestAnimationFrame(renderOverlayLoop);
}

window.stopSearch = function() {
  isSearching = false;
  clearInterval(searchTimer);
  cachedDetections = [];
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました";
  status.style.color = "#ffc107";
};

// 発見履歴サムネイル生成
function drawBoxOnSnapshot(sourceCanvas, detections) {
  const snap = document.createElement("canvas");
  snap.width = sourceCanvas.width;
  snap.height = sourceCanvas.height;
  const sCtx = snap.getContext("2d");
  sCtx.drawImage(sourceCanvas, 0, 0);

  detections.forEach(item => {
    if (!item.box_2d || item.box_2d.length < 4) return;
    const [ymin, xmin, ymax, xmax] = item.box_2d;
    const x = (xmin / 1000) * snap.width;
    const y = (ymin / 1000) * snap.height;
    const w = ((xmax - xmin) / 1000) * snap.width;
    const h = ((ymax - ymin) / 1000) * snap.height;

    sCtx.strokeStyle = "#00ff00";
    sCtx.lineWidth = 3;
    sCtx.strokeRect(x, y, w, h);
  });
  return snap.toDataURL("image/jpeg", 0.8);
}

function addGalleryThumbnail(dataUrl) {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;
  const img = document.createElement("img");
  img.src = dataUrl;
  img.style.cssText = "width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 2px solid #00ff00; cursor: pointer; flex-shrink: 0;";
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

window.clearGallery = function() {
  document.getElementById("imageGallery").innerHTML = "";
};
