import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

/**
 * MIG-01 support: the panel uploads a migration bundle rather than naming a file on the
 * server, and a multipart body only works if nothing declares a content type over it —
 * the browser has to send the boundary it generated. Every other call stays JSON.
 */
describe("the admin HTTP client", () => {
  const sent: Array<{ input: any; init: any }> = [];

  beforeEach(() => {
    sent.length = 0;
    localStorage.setItem("admin_token", "test-token");
    vi.spyOn(global, "fetch").mockImplementation((async (input: any, init: any = {}) => {
      sent.push({ input, init });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch);
  });

  it("leaves a multipart body to carry its own boundary", async () => {
    const form = new FormData();
    form.append("bundle", new File(['{"products":[]}'], "bundle.json"));

    await api.upload("/admin/migrations/bundle", form);

    const headers = sent[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(sent[0].init.body).toBe(form);
  });

  it("still sends JSON as JSON", async () => {
    await api.post("/admin/migrations/start", { source_type: "file" });

    const headers = sent[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
