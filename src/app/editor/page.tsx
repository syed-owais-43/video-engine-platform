import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { EditorApp } from "./editor";

export const metadata: Metadata = { title: "Editor" };

// The page itself holds no project data: the browser talks directly to the user's companion.
// The server only decides whether this user may use the editor.
export default async function EditorPage() {
  const user = await getCurrentUser();
  const active = user ? (await getAccess(user)).active : false;
  return <EditorApp signedIn={Boolean(user)} active={active} />;
}
