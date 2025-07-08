let screenCount = 0;
let recorders = [];
let micStream = null;
let zip = new JSZip();
const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true });

async function getMicrophone() {
  if (!micStream) {
    const noiseCancel = document.getElementById("noiseToggle").checked;
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: noiseCancel,
        noiseSuppression: noiseCancel,
        autoGainControl: noiseCancel
      }
    });
  }
}

function enhancePreview(videoEl) {
  const update = () => videoEl.requestVideoFrameCallback(() => update());
  update();
}

async function addScreen() {
  await getMicrophone();
  screenCount++;

  const container = document.getElementById("screens");
  const id = `screen-${screenCount}`;

  const div = document.createElement("div");
  div.className = "screen-control";
  div.id = id;

  div.innerHTML = `
    <h2>Screen ${screenCount}</h2>
    <button onclick="selectScreen('${id}')">Select Screen</button>
    <input type="text" class="rename-input" value="Screen ${screenCount}" onchange="renameScreen('${id}', this.value)" />
    <video id="${id}-video" autoplay muted playsinline></video>
  `;

  container.appendChild(div);

  recorders.push({
    id,
    stream: null,
    recorder: null,
    chunks: [],
    name: `Screen ${screenCount}`
  });
}

function renameScreen(id, newName) {
  const rec = recorders.find(r => r.id === id);
  if (rec) rec.name = newName;
}

async function selectScreen(id) {
  await getMicrophone();

  const screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 30, max: 60 },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: true
  });

  const combinedStream = new MediaStream([
    ...screenStream.getVideoTracks(),
    ...screenStream.getAudioTracks(),
    ...micStream.getAudioTracks()
  ]);

  const videoEl = document.getElementById(`${id}-video`);
  videoEl.srcObject = combinedStream;
  enhancePreview(videoEl);

  const rec = recorders.find(r => r.id === id);
  if (rec) rec.stream = combinedStream;
}

function startAll() {
  for (const r of recorders) {
    if (!r.stream) continue;

    r.chunks = [];
    r.recorder = new MediaRecorder(r.stream, { mimeType: "video/webm;codecs=vp9,opus" });
    r.recorder.ondataavailable = e => r.chunks.push(e.data);
    r.recorder.start();
  }
  document.getElementById("status").textContent = "🎬 Recording...";
}

function pauseAll() {
  for (const r of recorders) {
    if (r.recorder?.state === "recording") r.recorder.pause();
  }
  document.getElementById("status").textContent = "⏸️ Paused";
}

function resumeAll() {
  for (const r of recorders) {
    if (r.recorder?.state === "paused") r.recorder.resume();
  }
  document.getElementById("status").textContent = "▶️ Resumed";
}

function stopAll() {
  let pending = recorders.length;
  const blobs = [];

  for (const r of recorders) {
    if (r.recorder?.state === "recording" || r.recorder?.state === "paused") {
      r.recorder.onstop = () => {
        const blob = new Blob(r.chunks, { type: "video/webm" });
        blobs.push({ name: r.name, blob });
        pending--;
        if (pending === 0) convertAndZip(blobs);
      };
      r.recorder.stop();
    } else {
      pending--;
    }
  }

  document.getElementById("status").textContent = "⏳ Processing...";
}

async function convertAndZip(blobs) {
  if (!ffmpeg.isLoaded()) await ffmpeg.load();

  for (const { name, blob } of blobs) {
    const fileName = `${name.replace(/\s+/g, "_").toLowerCase()}`;
    const webmName = `${fileName}.webm`;
    const mp4Name = `${fileName}.mp4`;

    ffmpeg.FS("writeFile", webmName, await fetchFile(blob));
    await ffmpeg.run("-i", webmName, mp4Name);
    const mp4Data = ffmpeg.FS("readFile", mp4Name);

    zip.file(mp4Name, mp4Data.buffer);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = "DualCast_Recordings.zip";
  a.click();

  document.getElementById("status").textContent = "✅ Download Ready!";
}