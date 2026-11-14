import { Router } from "express";
import { pool } from "./db";
import { authenticate, AuthedRequest, audit } from "./http";

export const languageRouter = Router();
const SUPPORTED = new Set(["en", "tr", "ar", "ru"]);
export function isSupportedLanguage(value: unknown): value is "en" | "tr" | "ar" | "ru" {
  return typeof value === "string" && SUPPORTED.has(value);
}

/** User profile preference takes precedence over browser language; no IP-based lookup. */
languageRouter.patch("/api/me/language", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const language: unknown = req.body?.language;
    if (!isSupportedLanguage(language))
      return res.status(400).json({ error: "INVALID_LANGUAGE" });
    const result = await pool.query(
      "UPDATE users SET language = $1 WHERE id = $2 RETURNING language",
      [language, req.auth!.sub]
    );
    if (!result.rowCount) return res.status(404).json({ error: "NOT_FOUND" });
    await audit(pool, req.auth!.sub, req.auth!.agencyId, "user.language.updated", "user", req.auth!.sub);
    return res.json({ language: result.rows[0].language });
  } catch (error) { next(error); }
});
