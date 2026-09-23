const { createLead } = require("../crmClient");

const sampleLead = {
  listingId: "listing_123",
  name: "Rina Rakoto",
  phone: "0341234567",
  email: "rina@example.com",
  message: "Intéressée par cette annonce, disponible pour visite ce week-end.",
};

describe("crmClient.createLead", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    process.env.CRM_API_TOKEN = "test-token";
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("429 puis succès : réessaie et retourne le lead créé", async () => {
    global.fetch
      .mockResolvedValueOnce({
        status: 429,
        headers: { get: (name) => (name === "Retry-After" ? "0" : null) },
      })
      .mockResolvedValueOnce({
        status: 201,
        json: async () => ({ id: "lead_1", createdAt: "2026-09-22T10:00:00Z" }),
      });

    const result = await createLead(sampleLead);

    expect(result).toEqual({ id: "lead_1", createdAt: "2026-09-22T10:00:00Z" });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const firstCallKey = global.fetch.mock.calls[0][1].headers["Idempotency-Key"];
    const secondCallKey = global.fetch.mock.calls[1][1].headers["Idempotency-Key"];
    expect(firstCallKey).toBe(secondCallKey);

    
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
  });

  test("500 à chaque tentative : épuise les réessais puis abandonne", async () => {
    global.fetch.mockResolvedValue({ status: 500 });

    await expect(createLead(sampleLead)).rejects.toMatchObject({
      name: "CrmError",
      status: 500,
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});