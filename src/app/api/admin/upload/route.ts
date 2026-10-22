import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser, isAdmin } from "@/lib/auth";

// Issues one-time tokens so the admin's browser can upload large library ZIPs straight to Vercel
// Blob (serverless functions only accept a few MB per request). The admin panel then imports the
// uploaded ZIP by its URL.
export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const user = await getCurrentUser();
        if (!user || !isAdmin(user)) throw new Error("Admins only");
        if (!pathname.startsWith("uploads/") || !pathname.toLowerCase().endsWith(".zip")) throw new Error("Only ZIP files can be uploaded");
        return {
          allowedContentTypes: ["application/zip", "application/x-zip-compressed", "application/octet-stream", "multipart/x-zip"],
          maximumSizeInBytes: 2 * 1024 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
