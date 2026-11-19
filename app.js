// 💡 入力されたIPまたはngrok URLをベースURLに整える関数（新規追加）
function buildBaseUrl(rawInput) {
  let cleaned = (rawInput || "").trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  return `http://${cleaned}:5000`;
}

// QRコードスキャン機能（別PCのIDを読み取る・既存機能を維持）
window.startQrScanner = async function() {
  const readerContainer = document.getElementById("qr-reader");
  if (readerContainer) readerContainer.style.display = "block";

  if (typeof Html5Qrcode === "undefined") {
    status.innerText = "⚠️ QRスキャナーライブラリが読み込まれていません";
    status.style.color = "#ff4444";
    return;
  }

  try {
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("qr-reader");
    } else if (html5QrCode.isScanning) {
      await html5QrCode.stop();
    }

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 200, height: 200 } },
      (decodedText) => {
        const pcIdInput = document.getElementById("pcIdInput");
        if (pcIdInput) pcIdInput.value = decodedText;
        window.stopQrScanner();
        alert("PCのIDを読み込みました！「接続」ボタンを押してください。");
      },
      () => {}
    );
  } catch (err) {
    console.error("QRカメラ起動エラー:", err);
    status.innerText = `⚠️ カメラの起動に失敗しました: ${err?.name || err}`;
    status.style.color = "#ff4444";
    alert("カメラの起動に失敗しました: " + err);
  }
};


// ================= 検索ワード翻訳（決定ボタン） =================
window.updateTarget = async function() {
  const rawServerInput = document.getElementById("serverIp").value.trim();
  const inputElement = document.getElementById("targetObject");
  const keyword = inputElement.value.trim();

  if (!keyword) {
    alert("探すものを入力してください！");
    return;
  }
  if (!rawServerInput) {
    alert("サーバーのURLまたはIPアドレスを入力してください！");
    document.getElementById("serverIp").focus();
    return;
  }

  const baseUrl = buildBaseUrl(rawServerInput);
  status.innerText = "🔄 サーバーで翻訳中...";
  status.style.color = "#ffc107";

  try {
    const response = await fetch(`${baseUrl}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true"
      },
      body: JSON.stringify({ keyword: keyword })
    });

    if (!response.ok) throw new Error("翻訳サーバーエラー");

    const data = await response.json();
    const translatedWord = (data.translated || keyword).trim();

    // 1. 入力欄を翻訳後の英語に上書き
    inputElement.value = translatedWord;
    // 2. 確定キーワードを更新
    currentFinalizedKeyword = translatedWord;

    status.innerText = `🎯 「${keyword}」➔ 英語: [${currentFinalizedKeyword}] に設定しました`;
    status.style.color = "#00ff00";

    // 💡 すでに探索スタート中の場合は、決定ボタンを押して翻訳された瞬間に随時切り替える
    if (isSearching) {
      status.innerText = `🔍 「${currentFinalizedKeyword}」を探索中... (変更適用)`;
      status.style.color = "#00ff00";
    }

  } catch (err) {
    console.error("翻訳リクエストエラー:", err);
    // 💡 翻訳に失敗しても "cup" のままにせず、入力値をそのまま確定キーワードにする
    currentFinalizedKeyword = keyword;
    status.innerText = `⚠️ 翻訳に失敗しました（「${currentFinalizedKeyword}」をそのまま使用します）`;
    status.style.color = "#ff4444";
  }
};


// ================= 探索スタート・ストップ =================
window.startDetection = async function() {
  const rawServerInput = document.getElementById("serverIp").value.trim();
  const inputVal = document.getElementById("targetObject").value.trim();

  if (!rawServerInput) {
    alert("サーバーのURLまたはIPアドレスを入力してください！");
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

  // スタート時にもし翻訳がまだなら一度翻訳を実行して確定させる
  await window.updateTarget();

  // 別PCへ遠隔カメラ起動の指示を送信
  conn.send({ action: 'start', keyword: currentFinalizedKeyword, smartphoneId: peer.id });

  isSearching = true;
  startButton.style.display = "none";
  stopButton.style.display = "block";
  status.innerText = `🔍 「${currentFinalizedKeyword}」をYOLO-Worldで探索中...`;
  status.style.color = "#00ff00";

  // 0.5秒ごとにサーバーへフレームと確定済みキーワードを送信
  searchTimer = setInterval(async () => {
    if (!isSearching || isRequestInFlight || video.videoWidth === 0) return;
    const currentServerInput = document.getElementById("serverIp").value.trim();
    await sendFrameToPC(currentServerInput, currentFinalizedKeyword);
  }, 500);
};


// ================= サーバーへ画像送信 ＆ 検出 =================
async function sendFrameToPC(serverInput, keyword) {
  isRequestInFlight = true;
  try {
    const baseUrl = buildBaseUrl(serverInput);
    if (!baseUrl) {
      isRequestInFlight = false;
      return;
    }

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

    const response = await fetch(`${baseUrl}/detect`, {
      method: "POST",
      headers: {
        "ngrok-skip-browser-warning": "true"
      },
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
