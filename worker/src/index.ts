export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/event") {
      return new Response("Not Implemented", { status: 501 });
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler;
