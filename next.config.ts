import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tesseract.js", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/reconciliation": [
      "node_modules/tesseract.js/src/**/*",
      "node_modules/tesseract.js-core/tesseract-core*",
      "node_modules/tesseract.js-core/package.json",
      "node_modules/wasm-feature-detect/package.json",
      "node_modules/wasm-feature-detect/dist/cjs/**/*",
      "node_modules/bmp-js/**/*",
      "node_modules/regenerator-runtime/**/*",
      "node_modules/is-url/**/*",
      "node_modules/@tesseract.js-data/eng/package.json",
      "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
    ],
  },
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  experimental: {
    // volver a una sección visitada hace menos de 60 s la muestra al instante, sin ir al servidor
    // (los datos se sincronizan cada 10 min; guardar, o cambiar de cuenta, descarta esta memoria)
    staleTimes: { dynamic: 60 },
  },
};

export default nextConfig;
