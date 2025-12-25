import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncHandler = (req: Request, res: Response) => Promise<void> | void;

/**
 * Wraps route handlers to catch errors and forward them to error middleware
 *
 * Allows handlers to throw errors (including sync and async) instead of
 * manually catching and responding. Errors are passed to Express error middleware.
 */
export function asyncHandler(handler: AsyncHandler): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		Promise.resolve(handler(req, res)).catch(next);
	};
}
