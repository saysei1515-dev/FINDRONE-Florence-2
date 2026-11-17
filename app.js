let video = document.getElementById("video");
let canvas = document.getElementById("overlay");
let ctx = canvas.getContext("2d");
let status = document.getElementById("status");

let isSearching = false;
let searchTimer = null;
let isRequestInFlight = false;
let currentSearchWord = "guitar";

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
  "机": "desk", "テーブル": "dining table",
  "時計": "clock", "腕時計": "clock",
  "リモコン": "remote", "めがね": "glasses", "メガネ": "glasses",
  "バッグ": "bag", "かばん": "bag", "リュック": "backpack",
  
  // 人・その他
  "人": "person", "ひと": "person"
};

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

window.updateTarget = function() {
  let inputVal = document.getElementById("targetObject").value.trim();
  if (!inputVal) { alert("探すものを入力してください！"); return; }

  let searchWord = inputVal.toLowerCase();

  // 辞書に登録されている日本語・カタカナなら英語に変換
  if (jpToEnMap[inputVal]) {
    searchWord = jpToEnMap[inputVal];
  } 
  // すでに英語が入力されている場合はそのまま
  else if (/^[a-zA-Z0-9\s]+$/.test(inputVal)) {
    searchWord = inputVal.toLowerCase();
  }

  currentSearchWord = searchWord;
  status.innerText = `🎯 「${inputVal}」 (${currentSearchWord}) を探します`;
  status.style.color = "#00ff00";
  
  // 入力欄も変換後の文字に更新
  document.getElementById("targetObject").value = currentSearchWord;
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
    tempCanvas.width = 320; // 320pxに縮小して軽量化
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
