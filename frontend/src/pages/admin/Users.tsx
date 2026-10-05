import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText, type Group, type SessionInfo, type User } from "../../api";
import { useAuth } from "../../auth";
import { Drawer, Field, Notice, Pager, Tabs, useFeedback, useFitRows, useFormat, usePaged, TABLE_RESERVE } from "../../components/ui";
import { useI18n } from "../../i18n";

type UserDetail = User & { recovery_codes_left: number; sessions: SessionInfo[] };

export function Seals({ groups }: { groups: { id: number; name: string }[] }) {
  const { t } = useI18n();
  if (!groups.length) return <span className="muted">{t("common.noGroups")}</span>;
  return (
    <span className="seals">
      {groups.map((g) => (
        <span key={g.id} className={g.name === "admins" ? "seal seal-admins" : "seal"}>
          {g.name}
        </span>
      ))}
    </span>
  );
}

export function GroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: Group[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const { t } = useI18n();
  if (!groups.length) return <p className="muted">{t("common.noGroupsYet")}</p>;
  return (
    <div className="checks">
      {groups.map((g) => (
        <label key={g.id} className="check">
          <input
            type="checkbox"
            checked={value.includes(g.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, g.id] : value.filter((id) => id !== g.id))}
          />
          <span>
            {g.name}
            {g.description && <small>{g.description}</small>}
          </span>
        </label>
      ))}
    </div>
  );
}

function CreateUser({ groups, onDone, onClose }: { groups: Group[]; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ username: "", display_name: "", email: "", password: "" });
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const { toast } = useFeedback();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/api/admin/users", { ...form, email: form.email || null, group_ids: groupIds });
      toast(t("people.created", { name: form.display_name }));
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  return (
    <Drawer title={t("people.newTitle")} subtitle={t("people.newLead")} onClose={onClose}>
      <form className="form-stack" style={{ maxWidth: "none" }} onSubmit={submit}>
        <div className="form-grid">
          <Field label={t("people.username")} required autoCapitalize="none" spellCheck={false} value={form.username}
            placeholder={t("people.usernameHint")} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <Field label={t("common.name")} required value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          <Field label={t("common.email")} type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field label={t("people.tempPassword")} type="password" autoComplete="new-password" required minLength={10}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            hint={t("people.tempHint")} />
          <div className="field span-2">
            <span className="field-label">{t("common.groups")}</span>
            <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
          </div>
        </div>
        <Notice>{error}</Notice>
        <div><button className="btn" type="submit">{t("people.create")}</button></div>
      </form>
    </Drawer>
  );
}

function EditUser({
  userId,
  groups,
  onDone,
  onClose,
}: {
  userId: string;
  groups: Group[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const fmt = useFormat();
  const { me } = useAuth();
  const { confirm, toast } = useFeedback();
  const [tab, setTab] = useState<"profile" | "security">("profile");
  const [user, setUser] = useState<UserDetail | null>(null);
  const [form, setForm] = useState({ display_name: "", email: "" });
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const u = await api.get<UserDetail>(`/api/admin/users/${userId}`);
    setUser(u);
    setForm({ display_name: u.display_name, email: u.email ?? "" });
    setGroupIds(u.groups.map((g) => g.id));
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;
  const self = user.id === me?.id;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError("");
    try {
      await fn();
      toast(done);
      await load();
      onDone();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act(
      () => api.patch(`/api/admin/users/${user.id}`, { ...form, email: form.email || null, group_ids: groupIds }),
      t("people.saved"),
    );
  };

  const setPw = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api.post(`/api/admin/users/${user.id}/password`, { password });
      setPassword("");
    }, t("people.passwordSet"));
  };

  const resetTotp = async () => {
    const ok = await confirm({
      title: t("people.unbindTitle"),
      body: t("people.unbindBody", { name: user.display_name }),
      action: t("people.unbind"),
      danger: true,
    });
    if (ok) await act(() => api.post(`/api/admin/users/${user.id}/reset-totp`), t("people.unbound"));
  };

  const toggleActive = async () => {
    if (user.is_active) {
      const ok = await confirm({
        title: t("people.disableTitle"),
        body: t("people.disableBody", { name: user.display_name }),
        action: t("people.disable"),
        danger: true,
      });
      if (!ok) return;
    }
    await act(
      () => api.patch(`/api/admin/users/${user.id}`, { is_active: !user.is_active }),
      user.is_active ? t("people.disabledToast") : t("people.enabledToast"),
    );
  };

  const signOut = () => act(() => api.post(`/api/admin/users/${user.id}/sign-out`), t("people.endedAll"));

  const remove = async () => {
    const ok = await confirm({
      title: t("people.deleteTitle", { name: user.display_name }),
      body: t("people.deleteBody"),
      action: t("people.deleteAction"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/users/${user.id}`);
      toast(t("people.deleted"));
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  return (
    <Drawer
      title={user.display_name}
      subtitle={t("people.subtitle", { user: user.username, ago: fmt.ago(user.last_login_at) })}
      onClose={onClose}
    >
      <Tabs
        tabs={[
          { key: "profile", label: t("people.tabProfile") },
          { key: "security", label: t("people.tabSecurity") },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Notice>{error}</Notice>

      {tab === "profile" && (
        <form className="form-stack" style={{ maxWidth: "none" }} onSubmit={save}>
          <div className="form-grid">
            <Field label={t("common.name")} required value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            <Field label={t("common.email")} type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div className="field span-2">
              <span className="field-label">{t("common.groups")}</span>
              <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
            </div>
          </div>
          <div><button className="btn" type="submit">{t("common.save")}</button></div>
        </form>
      )}

      {tab === "security" && (
        <>
          <form className="form-grid" onSubmit={setPw} style={{ alignItems: "end" }}>
            <Field label={t("people.newPassword")} type="password" autoComplete="new-password" required minLength={10}
              value={password} onChange={(e) => setPassword(e.target.value)}
              hint={self ? undefined : t("people.signsOut")} />
            <div style={{ paddingBottom: self ? 0 : 24 }}>
              <button className="btn btn-quiet" type="submit">{t("people.setPassword")}</button>
            </div>
          </form>

          <div className="drawer-block">
            <h3>{t("people.phoneAndSessions")}</h3>
            <p className="muted">
              {user.totp_enrolled
                ? t("people.phoneBound", { n: user.recovery_codes_left })
                : t("people.phoneNotBound")}{" "}
              {t("people.sessions", { n: user.sessions.length })}
            </p>
            {user.sessions.slice(0, 3).map((s) => (
              <p key={s.id} className="muted" style={{ fontSize: "0.875rem" }}>
                {fmt.device(s.user_agent)}, {s.ip ?? t("common.unknownIp")}, {fmt.ago(s.last_seen_at)}
              </p>
            ))}
            <div className="row-actions">
              {user.totp_enrolled && (
                <button className="btn btn-quiet btn-small" type="button" onClick={resetTotp}>{t("people.unbind")}</button>
              )}
              {user.sessions.length > 0 && (
                <button className="btn btn-quiet btn-small" type="button" onClick={signOut}>{t("people.endAll")}</button>
              )}
            </div>
          </div>

          {!self && (
            <div className="drawer-block">
              <h3>{t("people.access")}</h3>
              <div className="row-actions">
                <button className="btn btn-quiet btn-small" type="button" onClick={toggleActive}>
                  {user.is_active ? t("people.disable") : t("people.enable")}
                </button>
                <button className="btn btn-danger btn-small" type="button" onClick={remove}>{t("people.delete")}</button>
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

export function UsersPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const [users, setUsers] = useState<User[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const fill = useRef<HTMLDivElement>(null);
  const pageSize = useFitRows(fill, 58, TABLE_RESERVE);
  const paged = usePaged(users, pageSize);

  const load = useCallback(async () => {
    const [u, g] = await Promise.all([api.get<User[]>("/api/admin/users"), api.get<Group[]>("/api/admin/groups")]);
    setUsers(u);
    setGroups(g);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const withoutTotp = users?.filter((u) => u.is_active && !u.totp_enrolled).length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("people.title")}</h1>
          <p className="page-lead">{t("people.lead")}</p>
        </div>
        <button className="btn" type="button" onClick={() => setCreating(true)}>{t("people.add")}</button>
      </header>

      {withoutTotp > 0 && (
        <div style={{ marginBottom: 16, flex: "none" }}>
          <Notice kind="info">{t("people.waiting", { n: withoutTotp })}</Notice>
        </div>
      )}

      <div className="fill" ref={fill}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "34%" }}>{t("people.person")}</th>
                <th>{t("common.groups")}</th>
                <th style={{ width: "18%" }}>{t("people.phone")}</th>
                <th style={{ width: "16%" }}>{t("people.lastSignIn")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setEditing(u.id)}>
                  <td>
                    <button type="button" className="link-button primary" style={{ textDecoration: "none", color: "inherit" }}
                      onClick={(e) => { e.stopPropagation(); setEditing(u.id); }}>
                      {u.display_name}
                    </button>
                    <span className="secondary">{u.username}{u.email ? `, ${u.email}` : ""}</span>
                  </td>
                  <td><Seals groups={u.groups} /></td>
                  <td>
                    {!u.is_active ? (
                      <span className="status status-off">{t("people.disabled")}</span>
                    ) : u.totp_enrolled ? (
                      <span className="status">{t("people.bound")}</span>
                    ) : (
                      <span className="status status-warn">{t("people.pending")}</span>
                    )}
                  </td>
                  <td className="num">{fmt.ago(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={paged.page} pageSize={pageSize} total={paged.total} onPage={paged.setPage} />
      </div>

      {creating && <CreateUser groups={groups} onDone={load} onClose={() => setCreating(false)} />}
      {editing && <EditUser userId={editing} groups={groups} onDone={load} onClose={() => setEditing(null)} />}
    </>
  );
}
