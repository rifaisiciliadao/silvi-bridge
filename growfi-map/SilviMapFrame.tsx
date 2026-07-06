import type { CSSProperties } from "react";

type SilviMapFrameProps = {
  apiUrl?: string;
  className?: string;
  src?: string;
  style?: CSSProperties;
  title?: string;
};

export function SilviMapFrame({
  apiUrl,
  className,
  src = "/map/",
  style,
  title = "Silvi live project map"
}: SilviMapFrameProps) {
  return (
    <iframe
      className={className}
      src={withApiUrl(src, apiUrl)}
      style={{ width: "100%", minHeight: 520, border: 0, ...style }}
      title={title}
    />
  );
}

function withApiUrl(src: string, apiUrl?: string) {
  if (!apiUrl) {
    return src;
  }

  return `${src}${src.includes("?") ? "&" : "?"}api=${encodeURIComponent(apiUrl)}`;
}
