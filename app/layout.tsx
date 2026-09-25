import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Miranova · Pedidos Drop",
  description: "Pedidos recibidos desde Drop para la proveeduría Miranova",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
