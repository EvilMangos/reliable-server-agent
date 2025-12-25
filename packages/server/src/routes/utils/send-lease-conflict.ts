import type { Response } from "express";

export function sendLeaseConflict(res: Response): void {
	res.status(409).json({ error: "Lease is not current" });
}
