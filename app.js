let video = document.getElementById("video");
let canvas = document.getElementById("overlay");
let ctx = canvas.getContext("2d");
let status = document.getElementById("status");

let isSearching = false;
let searchTimer = null;
let isRequestInFlight = false;
let currentSearchWord = "guitar";

// カメラ起動
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    status.innerText = "カメラ起動完了。探すものを入力してください。";
  } catch (err) {
    console.error("カメラ起動エラー:", err);
    status.innerText = "カメラの起動に失敗しました。";
  }
}

// 🌐 翻訳API（MyMemory）を使った堅牢な自動翻訳関数
async function translateToEnglish(text) {
  // すでに半角英数字のみの場合はそのまま返す
  if (/^[a-zA-Z0-9\s]+$/.test(text)) {
    return text.trim().toLowerCase();
  }

  try {
    status.innerText = `🔄 「${text}」を翻訳中...`;
    
    // MyMemory翻訳APIへリクエスト
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ja|en`;
    const res = await fetch(url);
    const data = await res.json();

    if (data && data.responseData && data.responseData.translatedText) {
      let translated = data.responseData.translatedText.trim().toLowerCase();
      
      // 警告文やエラーが含まれていないかチェック
      if (translated && !translated.includes("MYMEMORY WARNING") && !translated.includes("QUERY LENGTH")) {
        console.log(`翻訳成功: ${text} -> ${translated}`);
        return translated;
      }
    }
  } catch (e) {
    console.error("翻訳通信エラー:", e);
  }

  // 翻訳に失敗した場合は、そのままの文字を返す
  return text.trim().toLowerCase();
}

window.updateTarget = function() {
  let inputVal = document.getElementById("targetObject").value.trim();
  if (!inputVal) { alert("探すものを入力してください！"); return; }

  status.innerText = `🎯 「${inputVal}」の準備中...`;
  status.style.color = "#ffc107";

  // 非同期でAPI翻訳を実行
  translateToEnglish(inputVal).then(englishWord => {
    currentSearchWord = englishWord;
    status.innerText = `🎯 「${inputVal}」 ➔ 翻訳[${currentSearchWord}] を探します`;
    status.style.color = "#00ff00";
    
    // 確認用に入力欄の文字を英語（または変換後の文字）に書き換える
    document.getElementById("targetObject").value = currentSearchWord;
  });
};

window.toggleSearch = function() {
  const btn = document.getElementById("searchBtn");
  const ip = document.getElementById("serverIp").value.trim();

  if (!ip) {
    alert("PCのIPアドレスを入力してください！");
    return;
  }

  isSearching = !isSearching;

  if (isSearching) {
    btn.innerText = "探索ストップ";
    btn.style.background = "#d9534f";
    status.innerText = `🔍 「${currentSearchWord}」を探索中...`;
    
    // 約0.5秒（500ms）ごとにフレームを送信
    searchTimer = setInterval(async () => {
      if (!isSearching || isRequestInFlight || video.videoWidth === 0) return;
      await sendFrameToPC(ip);
    }, 500);

  } else {
    btn.innerText = "探索スタート";
    btn.style.background = "#0275d8";
    status.innerText = "探索を停止しました";
    clearInterval(searchTimer);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
};

async function sendFrameToPC(ip) {
  isRequestInFlight = true;

  try {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 320; // 軽量化のための幅320px
    tempCanvas.height = Math.round(video.videoHeight * (320 / video.videoWidth));
    const tCtx = tempCanvas.getContext("2d");
    tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, "image/jpeg", 0.6));
    if (!blob) { isRequestInFlight = false; return; }

    const formData = new FormData();
    formData.append("image", blob, "frame.jpg");
    formData.append("keyword", currentSearchWord);

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

function drawDetections(detections) {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!detections || detections.length === 0) return;

  detections.forEach(det => {
    const [ymin, xmin, ymax, xmax] = det.box_2d;
    const x = (xmin / 1000) * canvas.width;
    const y = (ymin / 1000) * canvas.height;
    const w = ((xmax - xmin) / 1000) * canvas.width;
    const h = ((ymax - ymin) / 1000) * canvas.height;

    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = "#00ff00";
    ctx.font = "16px sans-serif";
    ctx.fillText(`${det.label} (${det.confidence})`, x, y > 20 ? y - 5 : y + 20);
  });
}

window.onload = startCamera;
