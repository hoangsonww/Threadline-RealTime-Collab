import type { Metadata } from "next";
import { RoomMembersPage } from "../../../../../components/room-members-page";

export const metadata: Metadata = { title: "Room members" };

export default async function RoomMembersRoute({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomMembersPage roomId={roomId} />;
}
