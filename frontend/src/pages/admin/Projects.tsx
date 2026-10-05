import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText, type Group, type Project } from "../../api";
import {
  CopyButton,
  Drawer,
  Field,
  Notice,
  Pager,
  Tabs,
  TextArea,
  useFeedback,
  useFitRows,
  useFormat,
  usePaged,
  TABLE_RESERVE,
} from "../../components/ui";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
  return (
    <div className="form-grid">
      <div className="form-stack" style={{ maxWidth: "none" }}>
        <Field label={t("projects.name")} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Service 1" />
        <Field label={t("projects.description")} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Field label={t("projects.url")} type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="http://service1.home.arpa" hint={t("projects.urlHint")} />
      </div>
      <div className="form-stack" style={{ maxWidth: "none" }}>
        <TextArea label={t("projects.redirects")} value={form.redirect_uris} spellCheck={false} rows={4}
          onChange={(e) => setForm({ ...form, redirect_uris: e.target.value })}
          placeholder={"http://service1.home.arpa/auth/callback"} hint={t("projects.redirectsHint")} />
        <div className="field">
          <span className="field-label">{t("projects.access")}</span>
          <label className="check">
            <input type="checkbox" checked={form.allow_all_users}
              onChange={(e) => setForm({ ...form, allow_all_users: e.target.checked })} />
            <span>{t("projects.allUsers")}</span>
          </label>
          {!form.allow_all_users && (
            <GroupPicker groups={groups} value={form.group_ids} onChange={(ids) => setForm({ ...form, group_ids: ids })} />
          )}
        </div>
      </div>
    </div>
  );
}

function Credentials({ project, secret }: { project: Project; secret: string }) {
  const { t } = useI18n();
  const origin = window.location.origin;
  const rows: [string, string][] = [
    ["client_id", project.client_id],
    ["client_secret", secret],
    ["Issuer", origin],
    ["Discovery", `${origin}/.well-known/openid-configuration`],
  ];
  return (
    <div className="reveal">
      <strong>{t("projects.secretOnce")}</strong>
      <p>{t("projects.secretOnceBody")}</p>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd className="copyable">{v}</dd>
            <CopyButton value={v} />
          </div>
        ))}
      </dl>
    </div>
  );
}

function Integration({ project }: { project: Project }) {
  const { t } = useI18n();
  const origin = window.location.origin;
  const [before, rest] = t("projects.oidcBody").split("{issuer}");
  const [middle, after] = rest.split("{scope}");
  return (
    <div className="form-stack" style={{ maxWidth: "none" }}>
      <p>
        <strong>{t("projects.oidcTitle")}.</strong> {before}
        <code>{origin}</code>
        {middle}
        <code>openid profile email groups</code>
        {after}
      </p>
      <p>
        <strong>{t("projects.formTitle")}.</strong> {t("projects.formBody")}
      </p>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 12,
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
  const { t } = useI18n();
  const fmt = useFormat();
  const { confirm, toast } = useFeedback();
  const [tab, setTab] = useState<"settings" | "connect" | "secret">("settings");
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
      toast(t("projects.saved"));
      onDone();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  const rotate = async () => {
    const ok = await confirm({
      title: t("projects.rotateTitle"),
      body: t("projects.rotateBody"),
      action: t("projects.rotate"),
      danger: true,
    });
    if (!ok) return;
    const res = await api.post<{ client_secret: string }>(`/api/admin/projects/${project.id}/rotate-secret`);
    setSecret(res.client_secret);
    onDone();
  };

  const toggle = async () => {
    await api.patch(`/api/admin/projects/${project.id}`, { is_active: !project.is_active });
    toast(project.is_active ? t("projects.closedToast") : t("projects.openedToast"));
    onDone();
    onClose();
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("projects.deleteTitle", { name: project.name }),
      body: t("projects.deleteBody"),
      action: t("projects.deleteAction"),
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/admin/projects/${project.id}`);
    toast(t("projects.deleted"));
    onDone();
    onClose();
  };

  return (
    <Drawer title={project.name} subtitle={t("projects.registeredOn", { date: fmt.date(project.created_at) })} onClose={onClose}>
      <Tabs
        tabs={[
          { key: "settings", label: t("projects.tabSettings") },
          { key: "connect", label: t("projects.tabConnect") },
          { key: "secret", label: t("projects.tabSecret") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "settings" && (
        <form className="form-stack" style={{ maxWidth: "none" }} onSubmit={save}>
          <ProjectFields form={form} setForm={setForm} groups={groups} />
          <Notice>{error}</Notice>
          <div><button className="btn" type="submit">{t("common.save")}</button></div>
        </form>
      )}
      {tab === "connect" && (
        <>
          <dl className="kv">
            <dt>client_id</dt>
            <dd className="copyable">{project.client_id}</dd>
            <CopyButton value={project.client_id} />
          </dl>
          <Integration project={project} />
        </>
      )}
      {tab === "secret" && (
        <>
          {secret && <Credentials project={project} secret={secret} />}
          <p className="muted">{t("projects.secretIssued", { date: fmt.date(project.secret_rotated_at) })}</p>
          <div className="row-actions">
            <button className="btn btn-quiet btn-small" type="button" onClick={rotate}>{t("projects.rotate")}</button>
            <button className="btn btn-quiet btn-small" type="button" onClick={toggle}>
              {project.is_active ? t("projects.close") : t("projects.reopen")}
            </button>
            <button className="btn btn-danger btn-small" type="button" onClick={remove}>{t("projects.delete")}</button>
          </div>
        </>
      )}
    </Drawer>
  );
}

function CreateProject({ groups, onDone, onClose }: { groups: Group[]; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<Form>(emptyForm);
  const [created, setCreated] = useState<{ project: Project; client_secret: string } | null>(null);
  const [tab, setTab] = useState<"credentials" | "connect">("credentials");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await api.post<{ project: Project; client_secret: string }>("/api/admin/projects", toBody(form));
      setCreated(res);
      onDone();
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  if (created) {
    return (
      <Drawer title={created.project.name} subtitle={t("projects.registered")} onClose={onClose}>
        <Tabs
          tabs={[
            { key: "credentials", label: t("projects.tabCredentials") },
            { key: "connect", label: t("projects.tabConnect") },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "credentials" ? (
          <Credentials project={created.project} secret={created.client_secret} />
        ) : (
          <Integration project={created.project} />
        )}
        <div><button className="btn" type="button" onClick={onClose}>{t("projects.secretSaved")}</button></div>
      </Drawer>
    );
  }

  return (
    <Drawer title={t("projects.newTitle")} subtitle={t("projects.newLead")} onClose={onClose}>
      <form className="form-stack" style={{ maxWidth: "none" }} onSubmit={submit}>
        <ProjectFields form={form} setForm={setForm} groups={groups} />
        <Notice>{error}</Notice>
        <div><button className="btn" type="submit">{t("projects.register")}</button></div>
      </form>
    </Drawer>
  );
}

export function ProjectsPage() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const fill = useRef<HTMLDivElement>(null);
  const pageSize = useFitRows(fill, 58, TABLE_RESERVE);
  const paged = usePaged(projects, pageSize);

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
          <h1 className="page-title">{t("projects.title")}</h1>
          <p className="page-lead">{t("projects.lead")}</p>
        </div>
        <button className="btn" type="button" onClick={() => setCreating(true)}>{t("projects.register")}</button>
      </header>

      {projects && projects.length === 0 && (
        <div className="empty">
          <p>{t("projects.empty")}</p>
        </div>
      )}

      <div className="fill" ref={fill}>
        {projects && projects.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: "40%" }}>{t("projects.project")}</th>
                    <th>{t("projects.whoGetsIn")}</th>
                    <th style={{ width: "16%" }}>{t("projects.signIn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.slice.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => setEditing(p.id)}>
                      <td>
                        <span className="primary">{p.name}</span>
                        <span className="secondary">{p.client_id}</span>
                      </td>
                      <td>{p.allow_all_users ? t("projects.everyone") : <Seals groups={p.allowed_groups} />}</td>
                      <td>
                        {p.is_active ? (
                          <span className="status">{t("projects.open")}</span>
                        ) : (
                          <span className="status status-off">{t("projects.closed")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={paged.page} pageSize={pageSize} total={paged.total} onPage={paged.setPage} />
          </>
        )}
      </div>

      {creating && <CreateProject groups={groups} onDone={load} onClose={() => setCreating(false)} />}
      {current && (
        <EditProject key={current.id} project={current} groups={groups} onDone={load} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
