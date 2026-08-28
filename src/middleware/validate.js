// Shared Zod validation for route inputs. Route files declare a schema instead
// of hand-rolling parseInt/regex checks, so NaN, unbounded, or negative values
// never reach the DB layer — invalid input is a 400 through the AppError
// envelope ({ error, code }), same shape the controllers' Zod checks produce.
//
// On success the parsed (coerced, defaulted, unknown-keys-stripped) data
// REPLACES req.query / req.body, so handlers read the same properties they
// always did and get clean values. Numeric query params should use
// z.coerce.number().int().min().max() — bounds are the point.
import { AppError } from './errorHandler.js';

function issueList(error) {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

function makeValidator(source, label, code) {
  return (schema) =>
    function validate(req, _res, next) {
      const parsed = schema.safeParse(req[source] ?? {});
      if (!parsed.success) {
        return next(new AppError(`Invalid ${label}: ${issueList(parsed.error)}`, 400, code));
      }
      // req.query is an accessor on Express's request prototype (no setter), so a
      // plain assignment throws in strict mode — shadow it on the instance instead.
      Object.defineProperty(req, source, {
        value: parsed.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      next();
    };
}

export const validateQuery = makeValidator('query', 'query parameters', 'invalid_query');
export const validateBody = makeValidator('body', 'request body', 'invalid_body');
