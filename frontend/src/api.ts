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
        field: first?.loc?.[first.loc.length - 1],
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

const messages: Record<string, string> = {
  bad_credentials: "Неверный логин или пароль.",
  bad_code: "Код не подошёл. Проверьте время на телефоне и введите новый код.",
  challenge_expired: "Слишком долго или слишком много попыток. Войдите заново.",
  bad_password: "Текущий пароль указан неверно.",
  bad_setup_token: "Ключ настройки не подошёл. Возьмите его из логов контейнера.",
  setup_done: "Bastion уже настроен. Войдите своим аккаунтом.",
  username_taken: "Такой логин уже занят.",
  group_exists: "Группа с таким именем уже есть.",
  cannot_disable_self: "Себя отключить нельзя.",
  cannot_leave_admins: "Нельзя убрать себя из группы admins.",
  cannot_delete_self: "Себя удалить нельзя.",
  last_admin: "Должен остаться хотя бы один активный администратор.",
  system_group: "Группу admins удалить нельзя.",
  not_signed_in: "Сессия закончилась. Войдите снова.",
  admins_only: "Это доступно только администраторам.",
  csrf: "Запрос отклонён. Обновите страницу.",
  unknown_group: "Одна из выбранных групп уже удалена. Обновите страницу.",
};

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "locked") {
      const minutes = Math.max(1, Math.ceil(Number(err.data.retry_after ?? 60) / 60));
      return `Слишком много неудачных попыток. Попробуйте через ${minutes} мин.`;
    }
    if (err.code === "validation") return String(err.data.message || "Проверьте заполненные поля.");
    if (err.code === "bad_code" && typeof err.data.attempts_left === "number") {
      return `Код не подошёл. Осталось попыток: ${err.data.attempts_left}.`;
    }
    return messages[err.code] ?? "Что-то пошло не так. Попробуйте ещё раз.";
  }
  return "Нет связи с сервером. Проверьте сеть и попробуйте ещё раз.";
}
