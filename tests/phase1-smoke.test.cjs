const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync("app.js", "utf8");
const start = app.indexOf("function getDriveFileId(url)");
const end = app.indexOf("/* =========================================================", start);
assert.notEqual(start, -1, "getDriveFileId must exist");
assert.notEqual(end, -1, "Drive helper section must have a boundary");

const context = { URL };
vm.runInNewContext(app.slice(start, end), context);

test("accepts supported HTTPS Google Drive URL formats", () => {
  assert.equal(context.getDriveFileId("https://drive.google.com/file/d/Abc_123-x/view"), "Abc_123-x");
  assert.equal(context.getDriveFileId("https://drive.google.com/open?id=Abc_123-x"), "Abc_123-x");
  assert.equal(context.getDriveFileId("https://docs.google.com/uc?id=Abc_123-x"), "Abc_123-x");
  assert.equal(context.getDriveFileId("https://drive.usercontent.google.com/download?id=Abc_123-x"), "Abc_123-x");
});

test("rejects non-HTTPS, untrusted hosts, malformed URLs, and invalid IDs", () => {
  assert.equal(context.getDriveFileId("http://drive.google.com/file/d/abc/view"), "");
  assert.equal(context.getDriveFileId("https://evil.example/file/d/abc/view"), "");
  assert.equal(context.getDriveFileId("https://drive.google.com.evil.example/file/d/abc/view"), "");
  assert.equal(context.getDriveFileId("javascript:alert(1)"), "");
  assert.equal(context.getDriveFileId("not a URL"), "");
  assert.equal(context.getDriveFileId("https://drive.google.com/open?id=bad%2Fid"), "");
  assert.equal(context.getDriveFileId(""), "");
  assert.equal(context.getDriveFileId(null), "");
});

test("builds preview and image URLs only for validated Drive IDs", () => {
  assert.equal(
    context.getDrivePreviewUrl("https://drive.google.com/file/d/abc_123/view"),
    "https://drive.google.com/file/d/abc_123/preview"
  );
  assert.equal(context.getDrivePreviewUrl("https://evil.example/file/d/abc"), "");
  assert.equal(context.getDriveImageUrls("https://evil.example/file/d/abc").length, 0);
  assert.equal(context.getDriveImageUrls("https://drive.google.com/file/d/abc/view").length, 3);
});

test("keeps key Phase 1 safeguards present in application code", () => {
  assert.match(app, /Promise\.allSettled\s*\(/, "optional asset sheets should fail independently");
  assert.match(app, /coverResult\.status === "fulfilled"/, "covers sheet should be optional");
  assert.match(app, /audioResult\.status === "fulfilled"/, "Hi-Res sheet should be optional");
  assert.match(app, /const safeId = \//, "sheet-provided media IDs should be restricted");
  assert.match(app, /const embeddedHiResCount = numberValue\(c\[12\]\)/, "embedded Hi-Res field should be treated as a count");
  assert.match(app, /if \(retryButton\) retryButton\.addEventListener\("click", loadAllData\)/, "retry should use an event listener");
});
