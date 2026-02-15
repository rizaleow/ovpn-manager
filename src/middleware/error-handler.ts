import type { ErrorHandler } from "hono";
import { ShellError } from "../utils/shell.ts";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, details);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
    this.name = "ConflictError";
  }
}

export class ServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(500, message, details);
    this.name = "ServiceError";
  }
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(
      {
        error: err.name,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      err.statusCode as any,
    );
  }

  if (err instanceof ShellError) {
    return c.json(
      {
        error: "ShellError",
        message: err.message,
        details: { command: err.command, exitCode: err.exitCode, stderr: err.stderr },
      },
      500,
    );
  }

  console.error("Unhandled error:", err);
  return c.json(
    { error: "InternalError", message: "An unexpected error occurred" },
    500,
  );
};
