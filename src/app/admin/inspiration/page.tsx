import { LibraryAdmin } from "../library-admin";

// Importing a ZIP can take a while (unzipping, storing each file).
export const maxDuration = 60;

export default function AdminInspiration() {
  return <LibraryAdmin kind="ref" />;
}
