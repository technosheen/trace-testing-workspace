import { lookup } from "node:dns/promises";
import net from "node:net";

export function privateAddress(address) {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (a.includes(":")) {
    if (a.startsWith("::ffff:")) {
      const tail = a.slice(7);
      if (net.isIP(tail) === 4) return privateAddress(tail);
      const parts = tail.split(":");
      if (parts.length === 2) {
        const n = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
        return privateAddress(
          [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."),
        );
      }
      return true;
    }
    return (
      (!a.startsWith("2") && !a.startsWith("3")) || a.startsWith("2001:db8:")
    );
  }
  const [x, y] = a.split(".").map(Number);
  return (
    x === 0 ||
    x === 10 ||
    x === 127 ||
    x >= 224 ||
    (x === 169 && y === 254) ||
    (x === 172 && y >= 16 && y <= 31) ||
    (x === 192 && (y === 168 || y === 0)) ||
    (x === 100 && y >= 64 && y <= 127) ||
    (x === 198 && [18, 19, 51].includes(y)) ||
    (x === 203 && y === 0)
  );
}
export function isDemo(url) {
  return (
    url.origin === `http://127.0.0.1:${process.env.PORT || 4310}` &&
    /^\/demo(?:\/|$)/.test(url.pathname)
  );
}
export async function validateTarget(value, allowDemo = true) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Use an HTTP or HTTPS URL without embedded credentials.");
  if (allowDemo && isDemo(url)) return url;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
    throw new Error(
      "This version supports public websites and the built-in demo. Private network targets are not enabled.",
    );
  return url;
}
export function safeNavigation(url) {
  return (
    !/logout|log-out|signout|sign-out|unsubscribe|delete|remove|destroy|purchase|checkout|payment/i.test(
      url.pathname,
    ) && !url.search
  );
}
