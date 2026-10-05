import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorText, type Group, type Project } from "../../api";
import { CopyButton, date, Drawer, Field, Notice, TextArea, useFeedback } from "../../components/ui";
import { GroupPicker, Seals } from "./Users";

type Form = {
  name: string;
  description: string;
  url: string;
  redirect_uris: string;
  allow_all_users: boolean;
  group_ids: number[];
};

const emptyForm: Form = { name: "", description: "", url: "", redirect_uris: "", allow_all_users: false, group_ids: [] };

const toBody = (f: Form) => ({
  name: f.name,
  description: f.description,
  url: f.url || null,
  redirect_uris: f.redirect_uris.split("\n").map((s) => s.trim()).filter(Boolean),
  allow_all_users: f.allow_all_users,
  group_ids: f.group_ids,
});

function ProjectFields({ form, setForm, groups }: { form: Form; setForm: (f: Form) => void; groups: Group[] }) {
  return (
    <>
      <Field label="Название" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="MoneyChichhi" />
      <Field label="Описание" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="Общий бюджет" />
      <Field label="Адрес сервиса" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
        placeholder="http://192.168.31.93:8080" hint="Ссылка на главной странице Bastion." />
      <TextArea label="Адреса возврата (OIDC)" value={form.redirect_uris} spellCheck={false}
        onChange={(e) => setForm({ ...form, redirect_uris: e.target.value })}
        placeholder={"http://192.168.31.93:2283/auth/login\napp.immich:///oauth-callback"}
        hint="По одному на строку. Нужны, только если сервис входит через страницу Bastion." />
      <div className="field">
        <span className="field-label">Кого пускать</span>
        <label className="check">
          <input type="checkbox" checked={form.allow_all_users}
            onChange={(e) => setForm({ ...form, allow_all_users: e.target.checked })} />
          <span>Всех активных людей</span>
        </label>
        {!form.allow_all_users && (
          <GroupPicker groups={groups} value={form.group_ids} onChange={(ids) => setForm({ ...form, group_ids: ids })} />
        )}
      </div>
    </>
  );
}

function Credentials({ project, secret }: { project: Project; secret: string }) {
  const origin = window.location.origin;
  const discovery = `${origin}/.well-known/openid-configuration`;
  const rows: [string, string][] = [
    ["client_id", project.client_id],
    ["client_secret", secret],
    ["Issuer", origin],
    ["Discovery", discovery],
  ];
  return (
    <div className="reveal">
      <strong>Секрет показывается один раз</strong>
      <p>Вставьте эти значения в настройки сервиса. Потерянный секрет можно только выпустить заново.</p>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd className="copyable">{v}</dd>
            <CopyButton value={v} label="Копировать" />
          </div>
        ))}
      </dl>
    </div>
  );
}

function Integration({ project }: { project: Project }) {
  const origin = window.location.origin;
  return (
    <div className="drawer-block">
      <h3>Как подключить</h3>
      <p>
        <strong>Через страницу Bastion (OIDC).</strong> Для Immich и любых сервисов с кнопкой «Войти через…». Укажите
        Issuer <code>{origin}</code>, client_id и секрет, scope <code>openid profile email groups</code>.
      </p>
      <p>
        <strong>Своей формой входа.</strong> Бэкенд проекта отправляет логин, пароль и код:
      </p>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.8125rem", padding: 12,
        background: "var(--paper-raised)", border: "1px solid var(--rule)", borderRadius: 3 }}>
{`POST ${origin}/api/v1/authenticate
Authorization: Basic base64(${project.client_id}:<secret>)
Content-Type: application/json

{"username": "...", "password": "...", "totp_code": "123456"}`}
      </pre>
    </div>
  );
}

function EditProject({ project, groups, onDone, onClose }: {
  project: Project; groups: Group[]; onDone: () => void; onClose: () => void;
}) {
  const { confirm, toast } = useFeedback();
  const [form, setForm] = useState<Form>({
    name: project.name,
    description: project.description,
    url: project.url ?? "",
    redirect_uris: project.redirect_uris.join("\n"),
    allow_all_users: project.allow_all_users,
    group_ids: project.allowed_groups.map((g) => g.id),
  });
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState("");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.patch(`/api/admin/projects/${project.id}`, toBody(form));
      toast("Проект сохранён");
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const rotate = async () => {
    const ok = await confirm({
      title: "Выпустить новый секрет?",
      body: "Старый секрет сразу перестанет работать. Сервис не сможет входить, пока вы не вставите новый.",
      action: "Выпустить секрет",
      danger: true,
    });
    if (!ok) return;
    const res = await api.post<{ client_secret: string }>(`/api/admin/projects/${project.id}/rotate-secret`);
    setSecret(res.client_secret);
    onDone();
  };

  const toggle = async () => {
    await api.patch(`/api/admin/projects/${project.id}`, { is_active: !project.is_active });
    toast(project.is_active ? "Вход в проект закрыт" : "Вход в проект открыт");
    onDone();
    onClose();
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Удалить ${project.name}?`,
      body: "Сервис больше не сможет входить через Bastion. Это нельзя отменить.",
      action: "Удалить проект",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/admin/projects/${project.id}`);
    toast("Проект удалён");
    onDone();
    onClose();
  };

  return (
    <Drawer title={project.name} subtitle={`Зарегистрирован ${date(project.created_at)}`} onClose={onClose}>
      {secret && <Credentials project={project} secret={secret} />}
      <dl className="kv">
        <dt>client_id</dt>
        <dd className="copyable">{project.client_id}</dd>
        <CopyButton value={project.client_id} label="Копировать" />
      </dl>
      <form className="form-stack" onSubmit={save}>
        <ProjectFields form={form} setForm={setForm} groups={groups} />
        <Notice>{error}</Notice>
        <div><button className="btn" type="submit">Сохранить</button></div>
      </form>
      <Integration project={project} />
      <div className="drawer-block">
        <h3>Секрет и доступ</h3>
        <p className="muted">Секрет выпущен {date(project.secret_rotated_at)}.</p>
        <div className="row-actions">
          <button className="btn btn-quiet btn-small" type="button" onClick={rotate}>Выпустить новый секрет</button>
          <button className="btn btn-quiet btn-small" type="button" onClick={toggle}>
            {project.is_active ? "Закрыть вход" : "Открыть вход"}
          </button>
          <button className="btn btn-danger btn-small" type="button" onClick={remove}>Удалить</button>
        </div>
      </div>
    </Drawer>
  );
}

function CreateProject({ groups, onDone, onClose }: { groups: Group[]; onDone: () => void; onClose: () => void }) {
  const [form, setForm] = useState<Form>(emptyForm);
  const [created, setCreated] = useState<{ project: Project; client_secret: string } | null>(null);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await api.post<{ project: Project; client_secret: string }>("/api/admin/projects", toBody(form));
      setCreated(res);
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (created) {
    return (
      <Drawer title={created.project.name} subtitle="Проект зарегистрирован" onClose={onClose}>
        <Credentials project={created.project} secret={created.client_secret} />
        <Integration project={created.project} />
        <div><button className="btn" type="button" onClick={onClose}>Секрет сохранён, закрыть</button></div>
      </Drawer>
    );
  }

  return (
    <Drawer title="Новый проект" subtitle="Сервис, который будет пускать людей через Bastion." onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <ProjectFields form={form} setForm={setForm} groups={groups} />
        <Notice>{error}</Notice>
        <div><button className="btn" type="submit">Зарегистрировать проект</button></div>
      </form>
    </Drawer>
  );
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [p, g] = await Promise.all([api.get<Project[]>("/api/admin/projects"), api.get<Group[]>("/api/admin/groups")]);
    setProjects(p);
    setGroups(g);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = projects?.find((p) => p.id === editing);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Проекты</h1>
          <p className="page-lead">Сервисы, которые пускают людей через Bastion: свои проекты, Immich и всё остальное.</p>
        </div>
        <button className="btn" type="button" onClick={() => setCreating(true)}>Зарегистрировать проект</button>
      </header>

      {projects && projects.length === 0 && (
        <div className="empty">
          <p>Проектов пока нет. Зарегистрируйте первый — получите client_id и секрет для его настроек.</p>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Проект</th><th>Кого пускает</th><th>Вход</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setEditing(p.id)}>
                  <td>
                    <span className="primary">{p.name}</span>
                    <span className="secondary">{p.client_id}</span>
                  </td>
                  <td>{p.allow_all_users ? "всех" : <Seals groups={p.allowed_groups} />}</td>
                  <td>
                    {p.is_active ? <span className="status">открыт</span> : <span className="status status-off">закрыт</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateProject groups={groups} onDone={load} onClose={() => setCreating(false)} />}
      {current && (
        <EditProject key={current.id} project={current} groups={groups} onDone={load}
          onClose={() => setEditing(null)} />
      )}
    </>
  );
}
