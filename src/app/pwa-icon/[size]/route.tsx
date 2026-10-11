import { ImageResponse } from "next/og";

const SIZES = [192, 512];

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

// App icon, drawn in code so no image files need to be maintained.
export async function GET(_request: Request, { params }: RouteContext<"/pwa-icon/[size]">) {
  const size = Number((await params).size);
  if (!SIZES.includes(size)) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2433b8",
          color: "#ffffff",
          fontSize: size * 0.52,
          fontWeight: 700,
        }}
      >
        ₪
      </div>
    ),
    { width: size, height: size },
  );
}
