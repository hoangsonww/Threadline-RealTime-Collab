import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#101216",
        border: "2px solid #52e0a2",
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", gap: 2 }}>
        {[0, 1, 2].map((column) => (
          <div key={column} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                style={{
                  width: 4,
                  height: 4,
                  background: column === 1 && row !== 1 ? "#52e0a2" : "#b9f9da",
                  borderRadius: 1,
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
