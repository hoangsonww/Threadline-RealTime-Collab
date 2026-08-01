import { RoomWorkspace } from "../../../../components/room-workspace";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomWorkspace roomId={roomId} />;
}
