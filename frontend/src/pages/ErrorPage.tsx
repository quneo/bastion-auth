import { Link, useSearchParams } from "react-router-dom";
import { Gate } from "../components/Gate";
import { useI18n } from "../i18n";

export function ErrorPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const code = params.get("code");
  const reason = code === "unknown_client" || code === "bad_redirect_uri" ? code : "generic";
  return (
    <Gate>
      <h1 className="wall-title">{t(`error.${reason}.title`)}</h1>
      <p className="wall-lead">{t(`error.${reason}.body`)}</p>
      <Link className="btn btn-quiet" to="/">
        {t("error.home")}
      </Link>
    </Gate>
  );
}
