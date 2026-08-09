import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "linear-gradient(160deg, #101216 0%, #171a20 60%, #101216 100%)",
        color: "#f5f7fb",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", gap: 5 }}>
          {[0, 1, 2].map((column) => (
            <div key={column} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  style={{
                    width: 10,
                    height: 10,
                    background: column === 1 && row !== 1 ? "#52e0a2" : "#b9f9da",
                    borderRadius: 3,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <span style={{ fontSize: 32, letterSpacing: -1, color: "#a3adbe" }}>threadline</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 920 }}>
        <span style={{ fontSize: 68, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
          Meet now. Return smarter.
        </span>
        <span style={{ fontSize: 28, color: "#a3adbe", lineHeight: 1.4 }}>
          A room-centered workspace for live engineering collaboration and durable session records.
        </span>
      </div>
    </div>,
    size,
  );
}
