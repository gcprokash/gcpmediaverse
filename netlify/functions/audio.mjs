const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{10,200}$/;

function parseRange(value) {
  if (!value) return { start: 0, end: MAX_CHUNK_BYTES - 1, supplied: false };
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : start + MAX_CHUNK_BYTES - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, start + MAX_CHUNK_BYTES - 1), supplied: true };
}

function audioResponseError(message, status = 502) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

export default async (request) => {
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId") || "";
  const requestedMime = (url.searchParams.get("mime") || "").toLowerCase();
  const allowedMimes = new Set(["audio/mp4", "audio/mpeg", "audio/aac", "audio/wav", "audio/flac", "audio/ogg", "audio/webm"]);
  const forcedMime = allowedMimes.has(requestedMime) ? requestedMime : "";

  if (!FILE_ID_PATTERN.test(fileId)) {
    return audioResponseError("A valid Google Drive fileId is required.", 400);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return audioResponseError("Method not allowed.", 405);
  }

  const range = parseRange(request.headers.get("range"));
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": "bytes */*", "accept-ranges": "bytes" }
    });
  }

  const endpoints = [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
    `https://drive.google.com/uc?export=media&id=${encodeURIComponent(fileId)}`
  ];

  let upstream = null;
  let lastFailure = "Google Drive did not return an audio stream.";

  for (const endpoint of endpoints) {
    try {
      const headers = new Headers({
        "range": `bytes=${range.start}-${range.end}`,
        "accept": "audio/*, application/octet-stream;q=0.9, */*;q=0.8"
      });
      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        redirect: "follow"
      });
      const type = (response.headers.get("content-type") || "").toLowerCase();
      const looksLikeAudio = type.startsWith("audio/") ||
        type.includes("application/octet-stream") ||
        type.includes("application/mp4");

      if (!response.ok || !looksLikeAudio) {
        lastFailure = !response.ok
          ? `Google Drive returned HTTP ${response.status}.`
          : "Google Drive returned a non-audio response (possibly a confirmation or permission page).";
        try { await response.body?.cancel(); } catch {}
        continue;
      }

      upstream = response;
      break;
    } catch (error) {
      lastFailure = error?.message || lastFailure;
    }
  }

  if (!upstream) return audioResponseError(lastFailure);

  const upstreamRange = upstream.headers.get("content-range");
  const contentLength = upstream.headers.get("content-length");
  const upstreamType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const responseMime = forcedMime || (upstreamType === "application/mp4" || upstreamType === "video/mp4" ? "audio/mp4" : upstreamType.startsWith("audio/") ? upstreamType : "application/octet-stream");
  const headers = new Headers({
    "content-type": responseMime,
    "content-disposition": "inline",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range"
  });

  if (upstream.status === 206 && upstreamRange) {
    headers.set("content-range", upstreamRange);
    if (contentLength) headers.set("content-length", contentLength);
    if (request.method === "HEAD") {
      try { await upstream.body?.cancel(); } catch {}
      return new Response(null, { status: 206, headers });
    }
    return new Response(upstream.body, { status: 206, headers });
  }

  // Some Drive endpoints ignore Range. Only allow a bounded first chunk;
  // non-zero seeks cannot be served correctly without upstream range support.
  if (upstream.status === 200 && range.start === 0 && upstream.body) {
    const total = Number(contentLength);
    const cap = MAX_CHUNK_BYTES;
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        let sent = 0;
        try {
          while (sent < cap) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = cap - sent;
            const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
            controller.enqueue(chunk);
            sent += chunk.byteLength;
            if (chunk.byteLength < value.byteLength) {
              await reader.cancel();
              break;
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
      cancel() {
        upstream.body?.cancel();
      }
    });
    const partialLength = Number.isFinite(total) ? Math.min(total, cap) : cap;
    if (Number.isFinite(total)) {
      headers.set("content-range", `bytes 0-${Math.max(0, partialLength - 1)}/${total}`);
      headers.set("content-length", String(partialLength));
      return new Response(stream, { status: total > partialLength ? 206 : 200, headers });
    }
    return new Response(stream, { status: 200, headers });
  }

  try { await upstream.body?.cancel(); } catch {}
  return audioResponseError("Google Drive did not honor the byte-range request. Streaming was stopped to avoid sending incorrect audio.", 502);
};

export const config = {
  path: "/api/audio"
};
