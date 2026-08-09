import type { Metadata } from "next";
import { RoomWorkspace } from "../../../../components/room-workspace";

export const metadata: Metadata = { title: "Room" };

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomWorkspace roomId={roomId} />;
}
