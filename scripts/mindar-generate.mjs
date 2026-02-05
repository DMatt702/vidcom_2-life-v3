import puppeteer from "puppeteer";

const pairId = process.env.PAIR_ID || process.argv[2];
const imagePublicUrl = process.env.IMAGE_PUBLIC_URL || process.argv[3];
const apiBaseInput = process.env.API_BASE || process.argv[4] || "https://vidcom-api-staging.vidcomfilmworks.workers.dev";
const jobSecret = process.env.MINDAR_JOB_SECRET || "";

const apiBase = apiBaseInput.replace(/\/+$/, "");

function log(message) {
  console.log(`[mindar] ${message}`);
}

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postJobComplete(payload) {
  const resp = await fetch(`${apiBase}/jobs/mindar/complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-job-secret": jobSecret
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    log(`Failed to report job completion: ${resp.status} ${text}`);
  }
}

async function downloadImageDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status})`);
  }
  const mime = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  const base64 = buf.toString("base64");
  return { dataUrl: `data:${mime};base64,${base64}`, size: buf.length, mime };
}

async function compileMindTarget(dataUrl) {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({
      url: "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js"
    });
    const base64 = await page.evaluate(async (imageDataUrl) => {
      const img = new Image();
      img.src = imageDataUrl;
      await img.decode();
      const compiler = new window.MINDAR.Compiler();
      await compiler.compileImageTargets([img], () => {});
      const buffer = await compiler.exportData();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }, dataUrl);
    return Buffer.from(base64, "base64");
  } finally {
    await browser.close();
  }
}

async function uploadMindFile(buffer) {
  const filename = `pair-${pairId}.mind`;
  const signRes = await fetch(`${apiBase}/uploads/sign`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-job-secret": jobSecret
    },
    body: JSON.stringify({
      kind: "mind",
      mime: "application/octet-stream",
      filename,
      size: buffer.length
    })
  });
  if (!signRes.ok) {
    const text = await signRes.text();
    throw new Error(`Upload sign failed (${signRes.status}): ${text}`);
  }
  const sign = (await readJsonSafe(signRes)) || {};
  if (!sign.uploadUrl || !sign.r2Key) {
    throw new Error("Upload sign response missing uploadUrl/r2Key");
  }

  const putRes = await fetch(sign.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: buffer
  });
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`Upload put failed (${putRes.status}): ${text}`);
  }

  const completeRes = await fetch(`${apiBase}/uploads/complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-job-secret": jobSecret
    },
    body: JSON.stringify({
      kind: "mind",
      r2Key: sign.r2Key,
      mime: "application/octet-stream",
      filename,
      size: buffer.length
    })
  });
  if (!completeRes.ok) {
    const text = await completeRes.text();
    throw new Error(`Upload complete failed (${completeRes.status}): ${text}`);
  }
  const asset = await readJsonSafe(completeRes);
  if (!asset?.id) {
    throw new Error("Upload complete response missing asset id");
  }
  return asset.id;
}

async function main() {
  if (!pairId || !imagePublicUrl) {
    throw new Error("PAIR_ID and IMAGE_PUBLIC_URL are required.");
  }
  if (!jobSecret) {
    throw new Error("MINDAR_JOB_SECRET is required.");
  }

  log(`Downloading image: ${imagePublicUrl}`);
  const { dataUrl } = await downloadImageDataUrl(imagePublicUrl);

  log("Compiling MindAR target...");
  const mindBuffer = await compileMindTarget(dataUrl);
  log(`Compiled .mind (${mindBuffer.length} bytes)`);

  log("Uploading .mind file...");
  const mindAssetId = await uploadMindFile(mindBuffer);
  log(`Uploaded .mind asset: ${mindAssetId}`);

  await postJobComplete({ pairId, mindAssetId });
  log("Done.");
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`Error: ${message}`);
  if (pairId && jobSecret) {
    await postJobComplete({ pairId, error: message });
  }
  process.exit(1);
});
