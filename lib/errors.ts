export class DownloadError extends Error {
  constructor(message: string, public code = "UNAVAILABLE", public status = 422) {
    super(message);
    this.name = "DownloadError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof DownloadError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
    return Response.json({ error: "The source took too long. Please try the link again.", code: "TIMEOUT" }, { status: 504 });
  }
  // Do not log signed URLs, provider responses, or the user's link.
  console.error("Downloader failed:", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "Couldn't reach the source. Try again in a moment.", code: "UPSTREAM" }, { status: 502 });
}
