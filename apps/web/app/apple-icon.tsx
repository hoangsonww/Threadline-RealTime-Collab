import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
      <div style={{ display: "flex", gap: 12 }}>
        {[0, 1, 2].map((column) => (
          <div key={column} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                style={{
                  width: 22,
                  height: 22,
                  background: column === 1 && row !== 1 ? "#52e0a2" : "#b9f9da",
                  borderRadius: 6,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
