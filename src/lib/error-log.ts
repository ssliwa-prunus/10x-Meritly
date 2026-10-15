import {
  FunctionsError,
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  isAuthError,
} from "@supabase/supabase-js";
import type { LoadErrorCode } from "@/types";

/**
 * One place that turns a Supabase or Edge Function error into an allow-listed, PII-free payload
 * and writes it to the Workers log with the ids and request context in scope.
 *
 * Allow-list (context/changes/log-mapped-errors/plan.md, Key Discoveries):
 * - PostgREST errors are plain parsed objects without `status` (it lives on the result), so the
 *   caller passes it in. `code` is always kept, even when "" (the transport signal); `message`
 *   unless the code is class 22 (it echoes the input); `details`/`hint` only for transport failures
 *   and codes whose details carry object names or counts, never row values (23xxx).
 * - An error object without a string `code` is a raw non-JSON body: `message` cut to 200 chars.
 * - Auth errors: `name`, `status`, `code`. Function errors: `name`, `status`, `causeName`, `causeMessage`.
 * Empty strings and absent values are omitted, except `code`, so payloads stay exact and compact.
 */

export interface LogContext {
  userId?: string;
  requestId?: string;
}

export type LogIds = Partial<
  Record<"projectId" | "milestoneId" | "employeeId" | "engagementId" | "jobRoleId" | "ownerId", string>
>;

export interface LogMeta {
  /** The PostgREST result's `status` (the error object has none). */
  status?: number;
  ids?: LogIds;
  log?: LogContext;
  /** The catalog code the caller maps this error to. */
  mappedTo?: string;
}

export interface FunctionErrorInfo {
  name: string;
  status?: number;
  code?: string;
  causeName?: string;
  causeMessage?: string;
}

type Fields = Record<string, string | number>;

const RAW_BODY_LIMIT = 200;

/** Copies only the keys that hold a number or a non-empty string. */
function compact(source: Record<string, unknown>): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" || (typeof value === "string" && value !== "")) out[key] = value;
  }
  return out;
}

const stringField = (source: object, key: string): string | undefined => {
  const value: unknown = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};

const numberField = (source: object, key: string): number | undefined => {
  const value: unknown = (source as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
};

/** True when Postgres/PostgREST put only object names, counts or a stack into `details`/`hint`. */
function detailsAreSafe(code: string, status: number | undefined): boolean {
  return code === "" || status === 0 || code.startsWith("42") || code === "57014" || code.startsWith("PGRST");
}

/** The raw `Response` an HTTP or relay error carries, if it carries one. */
function responseOf(error: FunctionsError): Response | undefined {
  const context: unknown = error.context;
  const isResponseError = error instanceof FunctionsHttpError || error instanceof FunctionsRelayError;
  return isResponseError && context instanceof Response ? context : undefined;
}

/** What can be read from a function error without consuming the response body. */
function functionInfo(error: FunctionsError): FunctionErrorInfo {
  const context: unknown = error.context;
  if (error instanceof FunctionsFetchError && typeof context === "object" && context !== null) {
    const causeName = stringField(context, "name");
    const causeMessage = stringField(context, "message");
    return {
      name: error.name,
      ...(causeName === undefined ? {} : { causeName }),
      ...(causeMessage === undefined ? {} : { causeMessage }),
    };
  }
  const response = responseOf(error);
  return response ? { name: error.name, status: response.status } : { name: error.name };
}

function postgrestFields(error: object, status: number | undefined): Fields {
  const code = stringField(error, "code");
  const message = stringField(error, "message");
  if (code === undefined) {
    // A 2xx body that failed to parse is the payload itself (rows, names, amounts): log its size only.
    if (status !== undefined && status >= 200 && status < 300) return compact({ status, bodyLength: message?.length });
    return compact({ status, message: message?.slice(0, RAW_BODY_LIMIT) });
  }
  const safe = detailsAreSafe(code, status);
  return {
    code,
    ...compact({
      status,
      message: code.startsWith("22") ? undefined : message,
      details: safe ? stringField(error, "details") : undefined,
      hint: safe ? stringField(error, "hint") : undefined,
    }),
  };
}

/** A content-free name for a value that is not an error object. */
const typeName = (value: unknown): string => (value === null ? "null" : typeof value);

/** The allow-listed, loggable fields of any error value. `status` is the PostgREST result status. */
export function errorFields(error: unknown, status?: number): Fields {
  if (typeof error !== "object" || error === null) return { name: typeName(error) };
  if (isAuthError(error)) {
    return compact({ name: error.name, status: numberField(error, "status"), code: stringField(error, "code") });
  }
  if (error instanceof FunctionsError) return compact({ ...functionInfo(error) });
  return postgrestFields(error, status);
}

function payload(fields: Fields, meta: LogMeta | undefined): Fields {
  return { ...fields, ...compact({ ...meta?.ids, ...meta?.log, mappedTo: meta?.mappedTo }) };
}

function write(level: "error" | "warn", operation: string, data: Fields): void {
  if (level === "warn") {
    // eslint-disable-next-line no-console -- intentional: expected-but-notable failures in Workers observability logs
    console.warn(`${operation} failed`, data);
  } else {
    // eslint-disable-next-line no-console -- intentional: surfaces unexpected failures in Workers observability logs
    console.error(`${operation} failed`, data);
  }
}

/** Writes `${operation} failed` with the allow-listed error fields, ids, request context and mapped code. */
export function logError(level: "error" | "warn", operation: string, error: unknown, meta?: LogMeta): void {
  write(level, operation, payload(errorFields(error, meta?.status), meta));
}

/** Logs a failed read at error level; the caller shows the generic load failure. */
export function mapLoadError(operation: string, error: unknown, meta?: LogMeta): LoadErrorCode {
  logError("error", operation, error, meta);
  return "load_failed";
}

/** Longest `cf-ray` kept: Cloudflare's ids are ~20 chars; off Cloudflare the header is client-controlled. */
const REQUEST_ID_LIMIT = 64;

/** Request context for logs: the signed-in user's id and Cloudflare's `cf-ray` (absent locally). */
export function logContextFrom(locals: { user: { id: string } | null }, request: Request): LogContext {
  const context: LogContext = {};
  const userId = locals.user?.id;
  if (userId) context.userId = userId;
  const requestId = request.headers.get("cf-ray")?.slice(0, REQUEST_ID_LIMIT);
  if (requestId) context.requestId = requestId;
  return context;
}

/**
 * Reads an Edge Function error once: the response status and its `{ code }` body. The body is
 * consumed here (no other reader exists), so nothing is left unread. Not JSON leaves `code` undefined.
 */
export async function readFunctionError(error: unknown): Promise<FunctionErrorInfo> {
  if (!(error instanceof FunctionsError)) return { name: error instanceof Error ? error.name : typeName(error) };
  const info = functionInfo(error);
  const response = responseOf(error);
  if (!response) return info;
  try {
    const body: unknown = await response.json();
    const code = typeof body === "object" && body !== null ? stringField(body, "code") : undefined;
    return code === undefined ? info : { ...info, code };
  } catch {
    // Not JSON (e.g. an HTML gateway page) or an already-read body: the status alone is logged.
    return info;
  }
}

/**
 * Level for a function failure the caller could not map. An unknown `code` on a 4xx other than 404
 * means the Worker and the function drifted apart: warn. Everything else is an outage: error — a
 * 5xx, a 404 (an undeployed function answers the gateway's own `NOT_FOUND`), no code at all, or a
 * relay/network failure.
 */
export function functionFallbackLevel(error: unknown, info: FunctionErrorInfo): "warn" | "error" {
  const status = info.status;
  const drift =
    error instanceof FunctionsHttpError &&
    info.code !== undefined &&
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 404;
  return drift ? "warn" : "error";
}

/** Writes a function failure read by `readFunctionError`; `status` comes from `info`, not `meta`. */
export function logFunctionError(
  level: "error" | "warn",
  operation: string,
  info: FunctionErrorInfo,
  meta?: Omit<LogMeta, "status">,
): void {
  write(level, operation, payload(compact({ ...info }), meta));
}
