import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

export default function Tooltip({ text, pos = "left", delay, className, portal = false, open, children }: {
  text: string;
  pos?: "left" | "right" | "top" | "bottom";
  /** Delay only the appearance; hiding remains immediate. */
  delay?: number;
  className?: string;
  /** Render above clipping and scrolling containers such as the sidebar. */
  portal?: boolean;
  /** Controlled visibility. Omit to retain the default hover/focus behavior. */
  open?: boolean;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);
  const controlled = open !== undefined;

  const positionPortal = useCallback(() => {
    if (!portal || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const gap = 7;
    const positions: Record<NonNullable<typeof pos>, CSSProperties> = {
      left: { left: rect.left - gap, top: rect.top + rect.height / 2, transform: "translate(-100%, -50%)" },
      right: { left: rect.right + gap, top: rect.top + rect.height / 2, transform: "translateY(-50%)" },
      top: { left: rect.left + rect.width / 2, top: rect.top - gap, transform: "translate(-50%, -100%)" },
      bottom: { left: rect.left + rect.width / 2, top: rect.bottom + gap, transform: "translateX(-50%)" },
    };
    setPortalStyle(positions[pos]);
  }, [portal, pos]);

  useLayoutEffect(() => {
    if (!portal || open !== true) {
      if (controlled) setPortalStyle(null);
      return;
    }
    positionPortal();
    window.addEventListener("resize", positionPortal);
    window.addEventListener("scroll", positionPortal, true);
    return () => {
      window.removeEventListener("resize", positionPortal);
      window.removeEventListener("scroll", positionPortal, true);
    };
  }, [controlled, open, portal, positionPortal]);

  return (
    <span
      ref={anchorRef}
      className={`tooltip-wrap tooltip-wrap--${pos}${controlled ? ` tooltip-wrap--controlled${open ? " tooltip-wrap--open" : ""}` : ""}${delay ? " tooltip-wrap--delayed" : ""}${className ? ` ${className}` : ""}`}
      style={delay ? ({ "--tooltip-delay": `${delay}ms` } as CSSProperties) : undefined}
      onMouseEnter={controlled ? undefined : positionPortal}
      onMouseLeave={controlled ? undefined : () => portal && setPortalStyle(null)}
      onFocus={controlled ? undefined : positionPortal}
      onBlur={controlled ? undefined : () => portal && setPortalStyle(null)}
    >
      {children}
      {!portal && open !== false && <span className="tooltip-tip">{text}</span>}
      {portal && open !== false && portalStyle && createPortal(
        <span className={`tooltip-tip tooltip-tip--portal${className ? ` ${className}-tip` : ""}`} style={portalStyle}>{text}</span>,
        document.body,
      )}
    </span>
  );
}
