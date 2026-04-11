export default {
  async fetch(request, env, ctx) {
    const GAS_URL = "https://script.google.com/macros/s/AKfycbyte-YGaUUvrbN53qI9_ES-GKiPtX5yZrsDpQLdGRZVyCIenTyG2w7HpwVsW9zSzZWY/exec";

    const apiSecret = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!apiSecret || apiSecret !== env.API_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Route /read and /write to the same GAS endpoint
    const path = new URL(request.url).pathname;
    if (path !== "/read" && path !== "/write") {
      return new Response(JSON.stringify({ ok: false, error: "invalid path, use /read or /write" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const bodyText = await request.text();
    let bodyObj = {};
    try { bodyObj = JSON.parse(bodyText); } catch (e) {}
    
    bodyObj._gateway_secret = env.GAS_SECRET;
    const outgoingBody = JSON.stringify(bodyObj);
    
    const firstRes = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: outgoingBody,
      redirect: "manual",
    });

    const location = firstRes.headers.get("location");
if (!location) {
  return new Response(await firstRes.text(), {
    status: firstRes.status,
    headers: { "Content-Type": "application/json" },
  });
}

let redirectUrl;
try {
  redirectUrl = new URL(location);
} catch {
  return new Response(JSON.stringify({ ok: false, error: "invalid redirect location" }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}

const host = redirectUrl.hostname;
const isHttps = redirectUrl.protocol === "https:";
const isAllowed =
  host === "script.google.com" || host.endsWith(".google.com") ||
  host === "script.googleusercontent.com" || host.endsWith(".googleusercontent.com");

if (!isHttps || !isAllowed) {
  return new Response(JSON.stringify({ ok: false, error: "untrusted redirect host" }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}

let result;
let resultStatus = 200;
try {
  const secondRes = await fetch(redirectUrl.toString(), { method: "GET" });
  result = await secondRes.text();
  if (!secondRes.ok) {
    resultStatus = secondRes.status;
  }
} catch (err) {
  return new Response(JSON.stringify({ ok: false, error: "GAS redirect fetch failed: " + err.message }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}

    return new Response(result, {
      status: resultStatus,
      headers: { "Content-Type": "application/json" },
    });
  },
};