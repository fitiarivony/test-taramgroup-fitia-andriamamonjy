const PAGE_SIZE = 20;

app.get("/api/listings", async (req, res) => {
  const { city, page } = req.query;

  if (city !== undefined && typeof city !== "string") {
    return res.status(400).json({ error: "Paramètre 'city' invalide" });
  }

  const pageNumber = Number.parseInt(page, 10);
  const safePage = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  const offset = (safePage - 1) * PAGE_SIZE;

  try {    const { rows } = await db.query(
      `SELECT id, title, price, city, agency_id, created_at
       FROM listings
       WHERE city = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [city, PAGE_SIZE, offset]
    );

    if (rows.length === 0) {
      return res.json([]);
    }

    const listingIds = rows.map((r) => r.id);
    const agencyIds = [...new Set(rows.map((r) => r.agency_id))];

    const [agenciesResult, photosResult] = await Promise.all([
      db.query("SELECT * FROM agencies WHERE id = ANY($1)", [agencyIds]),
      db.query("SELECT listing_id, url FROM photos WHERE listing_id = ANY($1)", [listingIds]),
    ]);

    const agencyById = new Map(agenciesResult.rows.map((a) => [a.id, a]));
    const photosByListingId = new Map();
    for (const photo of photosResult.rows) {
      const list = photosByListingId.get(photo.listing_id) ?? [];
      list.push(photo.url);
      photosByListingId.set(photo.listing_id, list);
    }

    const enrichedRows = rows.map((row) => ({
      ...row,
      agency: agencyById.get(row.agency_id) ?? null,
      photos: photosByListingId.get(row.id) ?? [],
    }));

    res.json(enrichedRows);
  } catch (err) {
    console.error("Erreur /api/listings:", err.message);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});