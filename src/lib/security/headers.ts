export function securityHeaders(appUrl: string | undefined) {
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    {
      key: "Content-Security-Policy",
      value: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; ${scriptSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    },
  ];
  if (appUrl?.startsWith("https://")) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
