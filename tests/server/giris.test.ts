import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import app from "../../server/app";

test("GET /giris returns HTML with a restrictive same-origin CSP", async () => {
  const server = app.listen(0);
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/giris`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    assert.match(response.headers.get("content-security-policy") || "", /connect-src 'self'/);
    const html = await response.text();
    assert.match(html, /lang="tr"/);
    assert.match(html, /Şifre değiştir/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
