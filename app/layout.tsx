import type { Metadata } from "next";

export const metadata: Metadata = {
  // without a title, warpcast won't validate your frame
  title: "memberfy",
  description: "...",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
