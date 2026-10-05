import type { ReactNode } from "react";
import { LangSwitch, useI18n } from "../i18n";
import { Mark, type MarkState } from "./Mark";

/** Sign-in layout: a paper wall on the left, the fortress wallpaper behind. */
export function Gate({ mark = "idle", children }: { mark?: MarkState; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="gate">
      <section className="wall">
        <div className="wall-brand">
          <Mark state={mark} />
          <span className="wall-brand-name">Bastion</span>
          <LangSwitch />
        </div>
        <div className="wall-body">{children}</div>
        <p className="wall-foot">{t("brand.foot")}</p>
      </section>
    </main>
  );
}
