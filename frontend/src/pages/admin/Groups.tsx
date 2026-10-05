import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorText, type Group, type User } from "../../api";
import { Drawer, Field, Notice, useFeedback } from "../../components/ui";

function EditGroup({ group, users, onDone, onClose }: {
  group: Group; users: User[]; onDone: () => void; onClose: () => void;
}) {
  const { confirm, toast } = useFeedback();
  const [description, setDescription] = useState(group.description);
  const [error, setError] = useState("");
  const members = users.filter((u) => u.groups.some((g) => g.id === group.id));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/api/admin/groups/${group.id}`, { description });
      toast("Описание сохранено");
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Удалить группу ${group.name}?`,
      body: "Люди останутся, но потеряют доступ к проектам, которые открыты только этой группе.",
      action: "Удалить группу",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/groups/${group.id}`);
      toast("Группа удалена");
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Drawer title={group.name} subtitle={group.is_system ? "Системная группа: полный доступ к Bastion" : undefined} onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <Field label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Notice>{error}</Notice>
        <div><button className="btn" type="submit">Сохранить</button></div>
      </form>
      <div className="drawer-block">
        <h3>Участники</h3>
        {members.length ? (
          members.map((u) => (
            <p key={u.id}>
              {u.display_name} <span className="muted">{u.username}</span>
            </p>
          ))
        ) : (
          <p className="muted">Пока никого. Добавить человека в группу можно в разделе «Люди».</p>
        )}
      </div>
      {!group.is_system && (
        <div className="drawer-block">
          <div><button className="btn btn-danger btn-small" type="button" onClick={remove}>Удалить группу</button></div>
        </div>
      )}
    </Drawer>
  );
}

export function GroupsPage() {
  const { toast } = useFeedback();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Group | null>(null);

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
      toast(`Группа ${form.name} создана`);
      setForm({ name: "", description: "" });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Группы</h1>
          <p className="page-lead">
            Группа — это пропуск. Проекту указываете группы, и в него пускают только их участников.
          </p>
        </div>
      </header>

      <form className="toolbar" onSubmit={create} style={{ alignItems: "flex-end", marginBottom: 28 }}>
        <div style={{ width: 200 }}>
          <Field label="Название" required placeholder="family" autoCapitalize="none" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div style={{ flex: "1 1 260px" }}>
          <Field label="Описание" placeholder="Для чего эта группа" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <button className="btn" type="submit">Создать группу</button>
      </form>
      {error && <div style={{ marginBottom: 20 }}><Notice>{error}</Notice></div>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Группа</th><th>Описание</th><th>Участников</th></tr>
          </thead>
          <tbody>
            {groups?.map((g) => (
              <tr key={g.id} className="clickable" onClick={() => setEditing(g)}>
                <td>
                  <span className={g.name === "admins" ? "seal seal-admins" : "seal"}>{g.name}</span>
                </td>
                <td>{g.description || <span className="muted">без описания</span>}</td>
                <td className="num">{g.member_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <EditGroup group={editing} users={users} onDone={load} onClose={() => setEditing(null)} />}
    </>
  );
}
