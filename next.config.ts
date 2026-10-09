import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  experimental: {
    // volver a una sección visitada hace menos de 60 s la muestra al instante, sin ir al servidor
    // (los datos se sincronizan cada 10 min; guardar, o cambiar de cuenta, descarta esta memoria)
    staleTimes: { dynamic: 60 },
  },
};

export default nextConfig;
