import type { ReactNode } from "react";
import { Mark, type MarkState } from "./Mark";

/** Sign-in layout: a paper wall on the left, the fortress wallpaper behind. */
export function Gate({ mark = "idle", children }: { mark?: MarkState; children: ReactNode }) {
  return (
    <main className="gate">
      <section className="wall">
        <div className="wall-brand">
          <Mark state={mark} />
          <span className="wall-brand-name">Bastion</span>
        </div>
        <div className="wall-body">{children}</div>
        <p className="wall-foot">Один вход для всех сервисов цитадели</p>
      </section>
    </main>
  );
}
