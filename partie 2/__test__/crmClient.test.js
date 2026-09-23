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

    // La clé d'idempotence doit être identique sur les deux tentatives
    const firstCallKey = global.fetch.mock.calls[0][1].headers["Idempotency-Key"];
    const secondCallKey = global.fetch.mock.calls[1][1].headers["Idempotency-Key"];
    expect(firstCallKey).toBe(secondCallKey);

    // Le token ne doit jamais fuiter dans un message d'erreur (ici, pas d'erreur,
    // mais on vérifie qu'il n'apparaît que dans l'en-tête Authorization)
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
  });

  test("500 à chaque tentative : épuise les réessais puis abandonne", async () => {
    global.fetch.mockResolvedValue({ status: 500 });

    await expect(createLead(sampleLead)).rejects.toMatchObject({
      name: "CrmError",
      status: 500,
    });

    // MAX_ATTEMPTS = 3 : une tentative initiale + 2 réessais
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test("400 : erreur définitive, aucun réessai", async () => {
    global.fetch.mockResolvedValueOnce({ status: 400 });

    await expect(createLead(sampleLead)).rejects.toMatchObject({
      name: "CrmError",
      status: 400,
      retryable: false,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
