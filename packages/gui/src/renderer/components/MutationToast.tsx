import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle, XCircle } from "@phosphor-icons/react";

/**
 * 全局 mutation toast:统一的写操作 pending/成功/失败反馈。
 *
 * 之前所有 mutation(拖拽转态、progress、决策裁决)只有 error 分支、没有
 * pending/success 反馈,用户无法区分「写了没成」和「啥也没发生」。
 * 这里提供一个 ToastProvider + useToast hook,让 mutation 调用点统一反馈。
 *
 * 复用 ExecutionEvidenceView 的 .ee-toast CSS(styles.css 已定义)。
 */

export type ToastTone = "success" | "error";

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

type ShowToast = (message: string, tone: ToastTone) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

const AUTO_DISMISS_MS = 2800;
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const show = useCallback<ShowToast>((message, tone) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((entry) => entry.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-1.5">
        {toasts.map((entry) => (
          <div
            key={entry.id}
            className="ee-toast ee-toast-show pointer-events-auto"
            role="status"
          >
            {entry.tone === "success" ? (
              <CheckCircle weight="bold" className="text-status-done" />
            ) : (
              <XCircle weight="bold" className="text-danger" />
            )}
            <span>{entry.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
