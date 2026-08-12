import { ImageResponse } from "next/og";

// Same dot-grid mark as icon.tsx/apple-icon.tsx, scaled up for the PWA
// manifest's 192x192 slot (Android/Chrome install icon).
export function GET() {
  const size = 192;
  const dot = 23;
  const gap = 13;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#101216",
      }}
    >
      <div style={{ display: "flex", gap }}>
        {[0, 1, 2].map((column) => (
          <div key={column} style={{ display: "flex", flexDirection: "column", gap }}>
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                style={{
                  width: dot,
                  height: dot,
                  background: column === 1 && row !== 1 ? "#52e0a2" : "#b9f9da",
                  borderRadius: dot / 3.7,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>,
    { width: size, height: size },
  );
}
