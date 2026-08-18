import { NextRequest } from "next/server";
import { requireApiUser, requireAthleteAccess } from "../../../lib/auth";
import { audit } from "../../../lib/workspace";
import { id, nowIso, platformEnv } from "../../../db/runtime";

export const dynamic = "force-dynamic";
const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg", "text/csv"]);

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(); const form = await request.formData();
    const athleteId = String(form.get("athleteId") ?? ""); const file = form.get("file");
    await requireAthleteAccess(user, athleteId, false);
    if (!(file instanceof File)) return new Response("Choose a file.", { status: 400 });
    if (!allowedTypes.has(file.type)) return new Response("Use a PDF, PNG, JPEG, or CSV file.", { status: 400 });
    if (file.size > 10 * 1024 * 1024) return new Response("Files are limited to 10 MB.", { status: 400 });
    const runtime = platformEnv(); if (!runtime.FILES) return new Response("Private file storage is unavailable.", { status: 503 });
    const attachmentId = id("file"); const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); const key = `${athleteId}/${attachmentId}/${safeName}`;
    await runtime.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { athleteId, ownerUserId: user.id } });
    await runtime.DB.prepare("INSERT INTO file_attachments (id, athlete_id, owner_user_id, object_key, file_name, content_type, size_bytes, category, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(attachmentId, athleteId, user.id, key, file.name, file.type, file.size, String(form.get("category") ?? "lactate_report"), form.get("relatedId") ? String(form.get("relatedId")) : null, nowIso()).run();
    await audit(user, "upload", "file_attachment", attachmentId, athleteId, { contentType: file.type, sizeBytes: file.size });
    return Response.json({ ok: true, id: attachmentId, fileName: file.name });
  } catch (error) { return error instanceof Response ? error : new Response(error instanceof Error ? error.message : "Upload failed.", { status: 400 }); }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(); const fileId = request.nextUrl.searchParams.get("id");
    if (!fileId) return new Response("File is required.", { status: 400 });
    const runtime = platformEnv(); const row = await runtime.DB.prepare("SELECT * FROM file_attachments WHERE id = ?").bind(fileId).first<Record<string, unknown>>();
    if (!row) return new Response("File not found.", { status: 404 });
    await requireAthleteAccess(user, String(row.athlete_id), false);
    const object = await runtime.FILES?.get(String(row.object_key)); if (!object) return new Response("File content not found.", { status: 404 });
    return new Response(object.body, { headers: { "content-type": String(row.content_type), "content-disposition": `attachment; filename="${String(row.file_name).replaceAll('"', '')}"`, "cache-control": "private, no-store" } });
  } catch (error) { return error instanceof Response ? error : new Response("File download failed.", { status: 400 }); }
}
