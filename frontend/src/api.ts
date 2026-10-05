import type { Key, T } from "./i18n";

export type GroupRef = { id: number; name: string };

export type User = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  is_active: boolean;
  is_admin: boolean;
  groups: GroupRef[];
  totp_enrolled: boolean;
  created_at: string;
  last_login_at: string | null;
};

export type Me = User & { recovery_codes_left: number; password_changed_at: string };

export type SessionInfo = {
  id: string;
  current?: boolean;
  created_at: string;
  last_seen_at: string;
  ip: string | null;
  user_agent: string | null;
};

export type Group = {
  id: number;
  name: string;
  description: string;
  is_system: boolean;
  member_count: number;
  created_at: string;
};

export type Project = {
  id: number;
  name: string;
  description: string;
  url: string | null;
  client_id: string;
  redirect_uris: string[];
  allow_all_users: boolean;
  allowed_groups: GroupRef[];
  is_active: boolean;
  created_at: string;
  secret_rotated_at: string;
};

export type Service = { id: number; name: string; description: string; url: string | null };

export type AuditEvent = {
  id: number;
  ts: string;
  event: string;
  success: boolean;
  actor: string | null;
  target: string | null;
  project: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Bastion": "1",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.detail;
    if (Array.isArray(detail)) {
      // FastAPI validation errors
      const first = detail[0];
      throw new ApiError(res.status, "validation", {
        field: [...(first?.loc ?? [])].reverse().find((part) => typeof part === "string"),
        message: String(first?.msg ?? "").replace(/^Value error, /, ""),
      });
    }
    throw new ApiError(res.status, detail?.code ?? "error", detail ?? {});
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function errorText(err: unknown, t: T): string {
  if (err instanceof ApiError) {
    if (err.code === "locked") {
      return t("err.locked", { n: Math.max(1, Math.ceil(Number(err.data.retry_after ?? 60) / 60)) });
    }
    if (err.code === "validation") {
      const field = `field.${String(err.data.field ?? "")}`;
      return field in fieldKeys ? t(field as Key) : String(err.data.message || t("err.validation"));
    }
    if (err.code === "bad_code" && typeof err.data.attempts_left === "number") {
      return t("err.bad_code_left", { n: err.data.attempts_left });
    }
    const key = `err.${err.code}`;
    return key in errKeys ? t(key as Key) : t("err.generic");
  }
  return t("err.network");
}

const fieldKeys = Object.fromEntries(
  ["username", "password", "new_password", "email", "url", "redirect_uris", "name", "display_name"].map((f) => [`field.${f}`, 1]),
);
const errKeys = Object.fromEntries(
  [
    "bad_credentials", "bad_code", "challenge_expired", "bad_password", "bad_setup_token", "setup_done",
    "username_taken", "group_exists", "cannot_disable_self", "cannot_leave_admins", "cannot_delete_self",
    "last_admin", "system_group", "not_signed_in", "admins_only", "csrf", "unknown_group",
  ].map((c) => [`err.${c}`, 1]),
);
