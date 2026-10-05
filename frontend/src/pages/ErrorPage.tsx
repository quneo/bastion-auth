import { Link, useSearchParams } from "react-router-dom";
import { Gate } from "../components/Gate";

const reasons: Record<string, { title: string; body: string }> = {
  unknown_client: {
    title: "Сервис не зарегистрирован",
    body: "Bastion не знает сервис, который отправил вас сюда, или он отключён. Проверьте client_id в его настройках.",
  },
  bad_redirect_uri: {
    title: "Неизвестный адрес возврата",
    body: "Сервис попросил вернуть вас на адрес, которого нет в его настройках в Bastion. Добавьте этот адрес в проект.",
  },
};

export function ErrorPage() {
  const [params] = useSearchParams();
  const reason = reasons[params.get("code") ?? ""] ?? {
    title: "Не получилось продолжить",
    body: "Вернитесь в сервис и попробуйте войти ещё раз.",
  };
  return (
    <Gate>
      <h1 className="wall-title">{reason.title}</h1>
      <p className="wall-lead">{reason.body}</p>
      <Link className="btn btn-quiet" to="/">
        На главную Bastion
      </Link>
    </Gate>
  );
}
