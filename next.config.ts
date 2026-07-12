import type { NextConfig } from "next";

// iframe 삽입을 허용할 도메인 (단꿈넷 + 아임웹)
const FRAME_ANCESTORS = [
  "'self'",
  "https://danggum.net",
  "https://*.danggum.net",
  "https://danggum.imweb.me",
  "https://*.imweb.me",
].join(" ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            // 지정 도메인에서만 iframe 삽입 허용 (그 외 차단)
            key: "Content-Security-Policy",
            value: `frame-ancestors ${FRAME_ANCESTORS};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
