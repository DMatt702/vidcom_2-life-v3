import QRCode from "qrcode";

export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url).searchParams.get("url")!;
  const svg = await QRCode.toString(url, { type: "svg" });
  return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
};
