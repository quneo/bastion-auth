import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText, type Group, type User } from "../../api";
import { Drawer, Field, Notice, Pager, useFeedback, useFitRows, usePaged, TABLE_RESERVE } from "../../components/ui";
import { useI18n } from "../../i18n";

function EditGroup({ group, users, onDone, onClose }: {
  group: Group; users: User[]; onDone: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const { confirm, toast } = useFeedback();
  const [description, setDescription] = useState(group.description);
  const [error, setError] = useState("");
  const members = users.filter((u) => u.groups.some((g) => g.id === group.id));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/api/admin/groups/${group.id}`, { description });
      toast(t("groups.saved"));
      onDone();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("groups.deleteTitle", { name: group.name }),
      body: t("groups.deleteBody"),
      action: t("groups.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/groups/${group.id}`);
      toast(t("groups.deleted"));
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  return (
    <Drawer title={group.name} subtitle={group.is_system ? t("groups.system") : undefined} onClose={onClose}>
      <form className="form-grid" onSubmit={save} style={{ alignItems: "end" }}>
        <Field label={t("groups.description")} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div><button className="btn" type="submit">{t("common.save")}</button></div>
      </form>
      <Notice>{error}</Notice>
      <div className="drawer-block">
        <h3>{t("groups.members")}: {members.length}</h3>
        {members.length ? (
          <div className="checks">
            {members.map((u) => (
              <p key={u.id}>
                {u.display_name} <span className="muted">{u.username}</span>
              </p>
            ))}
          </div>
        ) : (
          <p className="muted">{t("groups.nobody")}</p>
        )}
      </div>
      {!group.is_system && (
        <div className="drawer-block">
          <div><button className="btn btn-danger btn-small" type="button" onClick={remove}>{t("groups.delete")}</button></div>
        </div>
      )}
    </Drawer>
  );
}

export function GroupsPage() {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Group | null>(null);
  const fill = useRef<HTMLDivElement>(null);
  const pageSize = useFitRows(fill, 58, TABLE_RESERVE);
  const paged = usePaged(groups, pageSize);

  const load = useCallback(async () => {
    const [g, u] = await Promise.all([api.get<Group[]>("/api/admin/groups"), api.get<User[]>("/api/admin/users")]);
    setGroups(g);
    setUsers(u);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/api/admin/groups", form);
      toast(t("groups.created", { name: form.name }));
      setForm({ name: "", description: "" });
      await load();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("groups.title")}</h1>
          <p className="page-lead">{t("groups.lead")}</p>
        </div>
      </header>

      <form className="toolbar" onSubmit={create} style={{ alignItems: "flex-end", flex: "none" }}>
        <div style={{ width: 200 }}>
          <Field label={t("groups.name")} required placeholder="members" autoCapitalize="none" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div style={{ flex: "1 1 260px" }}>
          <Field label={t("groups.description")} placeholder={t("groups.descriptionPlaceholder")} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <button className="btn" type="submit">{t("groups.create")}</button>
      </form>
      {error && <div style={{ marginBottom: 14, flex: "none" }}><Notice>{error}</Notice></div>}

      <div className="fill" ref={fill}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "26%" }}>{t("groups.group")}</th>
                <th>{t("groups.description")}</th>
                <th style={{ width: "14%" }}>{t("groups.members")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((g) => (
                <tr key={g.id} className="clickable" onClick={() => setEditing(g)}>
                  <td>
                    <span className={g.name === "admins" ? "seal seal-admins" : "seal"}>{g.name}</span>
                  </td>
                  <td>{g.description || <span className="muted">{t("groups.noDescription")}</span>}</td>
                  <td className="num">{g.member_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={paged.page} pageSize={pageSize} total={paged.total} onPage={paged.setPage} />
      </div>

      {editing && <EditGroup group={editing} users={users} onDone={load} onClose={() => setEditing(null)} />}
    </>
  );
}
